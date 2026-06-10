/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Restaurant } from "../types";
import { getMapCoords, getRestaurantCoords } from "../utils/mapUtils";

interface CampusMapProps {
  restaurants: Restaurant[];
  lovedRestIds: number[];
  blacklistRestIds: number[];
  selectedRestaurant: Restaurant | null;
  userLocation: { latitude: number; longitude: number } | null;
  onSelectRestaurant: (r: Restaurant) => void;
  mapTarget: { lat: number; lng: number } | null;
  mapZoom: number;
  setMapTarget: (target: { lat: number; lng: number } | null) => void;
  setMapZoom: (zoom: number | ((z: number) => number)) => void;
}

const getTodayBusinessHour = (businessHours?: string[]) => {
  if (!Array.isArray(businessHours) || businessHours.length === 0) {
    return "營業時間待補";
  }

  const today = new Date().getDay();
  // JS: Sunday=0, Monday=1...
  // Google weekdayDescriptions 通常順序是 Monday ~ Sunday
  const googleIndex = today === 0 ? 6 : today - 1;

  return businessHours[googleIndex] || businessHours[0] || "營業時間待補";
};

const parseBusinessTimeToMinutes = (timeText: string): number | null => {
  const text = timeText.trim().replace("：", ":");

  const match = text.match(/(上午|下午|晚上|凌晨|中午)?\s*(\d{1,2})[:：](\d{2})/);
  if (!match) return null;

  const period = match[1] || "";
  let hour = Number(match[2]);
  const minute = Number(match[3]);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  if ((period === "下午" || period === "晚上") && hour < 12) {
    hour += 12;
  }

  if ((period === "上午" || period === "凌晨") && hour === 12) {
    hour = 0;
  }

  if (period === "中午" && hour < 12) {
    hour += 12;
  }

  return hour * 60 + minute;
};

const isRestaurantOpenNow = (businessHours?: string[]) => {
  const todayText = getTodayBusinessHour(businessHours);

  if (!todayText || todayText === "營業時間待補") {
    return false;
  }

  if (/24\s*小時|24\s*hours|Open\s*24\s*hours/i.test(todayText)) {
    return true;
  }

  if (/休息|公休|未營業|Closed/i.test(todayText)) {
    return false;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const timePart = todayText.includes(":")
    ? todayText.slice(todayText.indexOf(":") + 1)
    : todayText;

  const segments = timePart
    .replace(/[–—－～~至到]/g, "-")
    .split(/[、,，;；]/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const parts = segment.split("-").map(s => s.trim()).filter(Boolean);

    if (parts.length < 2) continue;

    const start = parseBusinessTimeToMinutes(parts[0]);
    const end = parseBusinessTimeToMinutes(parts[1]);

    if (start === null || end === null) continue;

    // 跨日營業，例如 18:00 - 02:00
    if (end <= start) {
      if (nowMinutes >= start || nowMinutes < end) {
        return true;
      }
    } else {
      if (nowMinutes >= start && nowMinutes < end) {
        return true;
      }
    }
  }

  return false;
};

const simplifyBusinessHour = (text: string) => {
  return text
    .replace("星期一", "一")
    .replace("星期二", "二")
    .replace("星期三", "三")
    .replace("星期四", "四")
    .replace("星期五", "五")
    .replace("星期六", "六")
    .replace("星期日", "日")
    .replace("Monday", "一")
    .replace("Tuesday", "二")
    .replace("Wednesday", "三")
    .replace("Thursday", "四")
    .replace("Friday", "五")
    .replace("Saturday", "六")
    .replace("Sunday", "日");
};

export default function CampusMap({
  restaurants,
  lovedRestIds,
  blacklistRestIds,
  selectedRestaurant,
  userLocation,
  onSelectRestaurant,
  mapTarget,
  mapZoom,
  setMapTarget,
  setMapZoom
}: CampusMapProps) {
  return (
    <div className="relative w-full h-[380px] bg-[#fdfaf2] rounded-3xl overflow-hidden border border-[#e5e1da] shadow-inner font-sans">
      {/* Legend overlay */}
      <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-md py-2 px-2.5 rounded-2xl text-[10px] font-bold text-[#5a5a40] shadow-sm tracking-wide z-20 border border-[#e5e1da]/60 flex flex-col gap-1.5 min-w-[100px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-[#5a5a40] rounded-full inline-block shadow-sm"></span>
          <span>一般商家</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-rose-500 rounded-full inline-block shadow-sm"></span>
          <span>💖 我的最愛</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
          </span>
          <span>🛰️ 我的位置</span>
        </div>
      </div>

      {/* Map controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-20">
        <button
          onClick={() => setMapZoom(prev => Math.min(prev + 0.5, 4))}
          className="bg-white hover:bg-[#f5f5f0] border border-[#e5e1da] w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[#5a5a40] shadow-sm select-none cursor-pointer text-sm"
        >
          ＋
        </button>
        <button
          onClick={() => setMapZoom(prev => Math.max(prev - 0.5, 1))}
          className="bg-white hover:bg-[#f5f5f0] border border-[#e5e1da] w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[#5a5a40] shadow-sm select-none cursor-pointer text-sm"
        >
          －
        </button>
        <button
          onClick={() => {
            setMapTarget(null);
            setMapZoom(1);
          }}
          className="bg-[#5a5a40] text-white hover:bg-[#484833] text-[9px] font-bold py-1.5 px-2 rounded-xl shadow-md transition active:scale-95 cursor-pointer"
        >
          重置視野
        </button>
      </div>

      {/* Map viewport */}
      <div className="w-full h-full relative overflow-hidden bg-[#faf8f2]">
        <div
          className="w-full h-full relative"
          style={{
            transform: mapTarget
              ? `translate(${50 - getMapCoords(mapTarget.lat, mapTarget.lng).x * mapZoom}%, ${50 - getMapCoords(mapTarget.lat, mapTarget.lng).y * mapZoom}%) scale(${mapZoom})`
              : `translate(0%, 0%) scale(${mapZoom})`,
            transformOrigin: "0% 0%",
            transition: "transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)"
          }}
        >
          {/* 1. NCU topographic SVG map base */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* Grid coordinate lines */}
            <defs>
              <pattern id="map-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#f3efe2" strokeWidth="0.4" />
              </pattern>
              <linearGradient id="grass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e2edd5" />
                <stop offset="100%" stopColor="#c8e0b6" />
              </linearGradient>
              <linearGradient id="lake-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e0f2fe" />
                <stop offset="100%" stopColor="#bae6fd" />
              </linearGradient>
            </defs>
            <rect width="100" height="100" fill="url(#map-grid)" />

            {/* Green Forest/Pine Wood Backdrop patches for Central University natural landscaping */}
            <path d="M 5,5 Q 15,2 25,8 T 35,5 T 45,15 T 40,28 T 25,25 Z" fill="#ebf4e5" />
            <path d="M 75,5 Q 85,12 95,8 T 92,25 T 80,28 T 72,15 Z" fill="#ebf4e5" />
            <path d="M 68,68 Q 80,72 88,85 T 75,95 T 62,90 T 60,78 Z" fill="#e2edd5" opacity="0.6" />

            {/* Red Running Stadium / Track and Field (田徑場 - 55 in coordinate index) */}
            <rect x="70" y="22" width="15" height="10" rx="5" fill="#fca5a5" stroke="#ef4444" strokeWidth="0.5" opacity="0.8" />
            <rect x="72" y="23.5" width="11" height="7" rx="3.5" fill="#e2edd5" stroke="#f87171" strokeWidth="0.3" />
            <line x1="77.5" y1="22" x2="77.5" y2="32" stroke="#ef4444" strokeWidth="0.3" strokeDasharray="0.5,0.5" />

            {/* Main Outer Loop Ring Path (學府路) */}
            <path d="M 24,20 L 76,20 C 85,20 88,25 88,38 L 88,72 C 88,82 82,86 70,86 L 30,86 C 18,86 12,82 12,68 L 12,38 C 12,24 16,20 24,20 Z" fill="none" stroke="#dedcd0" strokeWidth="2.2" />
            <path d="M 24,20 L 76,20 C 85,20 88,25 88,38 L 88,72 C 88,82 82,86 70,86 L 30,86 C 18,86 12,82 12,68 L 12,38 C 12,24 16,20 24,20 Z" fill="none" stroke="#ffffff" strokeWidth="0.6" strokeDasharray="1.5,1.5" />

            {/* Inner Loop Circle */}
            <circle cx="50" cy="51" r="16" fill="none" stroke="#dedcd0" strokeWidth="1.2" />
            <circle cx="50" cy="51" r="16" fill="none" stroke="#ffffff" strokeWidth="0.4" strokeDasharray="1,1" />

            {/* Central Baihuachuan Wooden Walkway (百花川松濤林道 - horizontally cutting the campus) */}
            <path d="M 12,48 L 88,48" fill="none" stroke="#d6ccb8" strokeWidth="1.6" />
            <path d="M 12,48 L 88,48" fill="none" stroke="#5a5a40" strokeWidth="0.4" strokeDasharray="0.8,0.8" />
            {/* Forest along Baihuachuan */}
            <circle cx="20" cy="46" r="1" fill="#84a98c" />
            <circle cx="32" cy="46" r="1.2" fill="#84a98c" />
            <circle cx="45" cy="46" r="1" fill="#84a98c" />
            <circle cx="58" cy="46" r="1.3" fill="#84a98c" />
            <circle cx="68" cy="46" r="1" fill="#84a98c" />
            <circle cx="80" cy="46" r="1.1" fill="#84a98c" />

            {/* Main Entrance Road leading inside from Circular roundabout (中大路 / 百米松道) */}
            <path d="M 88,51 L 98,51" fill="none" stroke="#dedcd0" strokeWidth="3" />
            <path d="M 88,51 L 98,51" fill="none" stroke="#ffffff" strokeWidth="0.5" strokeDasharray="2,1" />
            <circle cx="91" cy="51" r="2.2" fill="none" stroke="#c0bba9" strokeWidth="0.8" />

            {/* Daxue Road (大學路) flanking the lower border */}
            <path d="M 5,83 L 90,83 C 94,83 95,80 95,74 L 95,51" fill="none" stroke="#e0ded4" strokeWidth="1" />

            {/* Connected building paths & sub-avenues */}
            <line x1="50" y1="20" x2="50" y2="86" stroke="#dedcd0" strokeWidth="0.8" />
            <line x1="28" y1="35" x2="72" y2="78" stroke="#dedcd0" strokeWidth="0.6" strokeDasharray="1,1" />

            {/* Large Taichi Lawn (太極大草坪 - Central green space) */}
            <ellipse cx="38" cy="51" rx="12" ry="9" fill="url(#grass-grad)" stroke="#adc993" strokeWidth="0.4" />
            {/* Taichi Bronze monument icon (太極銅雕 - landmark) */}
            <circle cx="38" cy="51" r="1.5" fill="#5a5a40" stroke="#FAF9F6" strokeWidth="0.3" />
            <circle cx="38" cy="51" r="0.6" fill="#1c1917" />

            {/* 中大湖 (NCU Lake - 71 in standard locations index) */}
            <path d="M 72,70 C 70,68 76,64 80,66 C 84,68 85,73 81,75 C 77,77 74,72 72,70 Z" fill="url(#lake-grad)" stroke="#a5f3fc" strokeWidth="0.5" />
            {/* Lake gazebo islet & island bridge */}
            <circle cx="78" cy="70" r="1.2" fill="#c2f5e9" stroke="#38bdf8" strokeWidth="0.2" />
            <line x1="75" y1="71" x2="78" y2="70" stroke="#b45309" strokeWidth="0.4" />

            {/* Core NCU Building outlines plotted as clean architectural solids */}
            {/* 🏛️ 中正圖書館 (Zhongzheng Main Library) */}
            <rect x="49" y="38" width="6" height="5" rx="0.5" fill="#fed7aa" stroke="#f97316" strokeWidth="0.4" />
            <rect x="50" y="39" width="4" height="2" fill="#fecdd3" opacity="0.6" />
            
            {/* 🏢 行政大樓 (Administration Portal) */}
            <rect x="54" y="56" width="6" height="4" rx="0.5" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.4" />
            
            {/* 🏟️ 依仁堂體育館 */}
            <rect x="68" y="36" width="5" height="4" rx="1.5" fill="#ddd" stroke="#999" strokeWidth="0.4" />

            {/* 🌲 松苑食堂 (Song-Yuan Cafeteria site in South Dorm village) */}
            <rect x="41" y="79" width="4" height="4" rx="0.5" fill="#fde047" stroke="#ca8a04" strokeWidth="0.4" />

            {/* 🥗 女十四舍區地下書香餐飲街 (Female Dorm 14 adjacent to Lake) */}
            <rect x="71" y="59" width="5" height="4" rx="0.5" fill="#fbcfe8" stroke="#db2777" strokeWidth="0.4" />
          </svg>

          {/* 2. Campus Landmark Labels */}
          <div className="absolute text-[7px] font-bold text-stone-700 select-none pointer-events-none bg-stone-100/90 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-sm border border-stone-200/50" style={{ left: "28%", top: "54%" }}>
            🌳 太極大草坪
          </div>
          <div className="absolute text-[7px] font-bold text-orange-950 select-none pointer-events-none bg-orange-50/90 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-sm border border-orange-200/50 flex items-center gap-0.5" style={{ left: "47%", top: "33%" }}>
            🏫 中正圖書館 (總圖)
          </div>
          <div className="absolute text-[7px] font-bold text-cyan-950 select-none pointer-events-none bg-cyan-50/90 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-sm border border-cyan-200/50" style={{ left: "75%", top: "74%" }}>
            💧 中大湖
          </div>
          <div className="absolute text-[7px] font-bold text-rose-700 select-none pointer-events-none bg-rose-50/90 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-sm border border-rose-200" style={{ left: "18%", top: "14%" }}>
            🍔 宵夜街後門
          </div>
          <div className="absolute text-[7px] font-bold text-emerald-900 select-none pointer-events-none bg-emerald-50/80 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-xs" style={{ left: "42%", top: "45%" }}>
            🚶 百花川步道
          </div>
          <div className="absolute text-[7px] font-bold text-stone-600 select-none pointer-events-none bg-stone-50/80 px-1 py-0.5 rounded" style={{ left: "80%", top: "44%" }}>
            🌲 正門圓環
          </div>
          <div className="absolute text-[7px] font-bold text-amber-950 select-none pointer-events-none bg-amber-50/90 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-sm border border-amber-200/50" style={{ left: "37%", top: "75%" }}>
            🌲 松苑食堂
          </div>
          <div className="absolute text-[7px] font-bold text-pink-950 select-none pointer-events-none bg-pink-50/90 backdrop-blur-[1px] px-1 py-0.5 rounded shadow-sm border border-pink-200/50" style={{ left: "67%", top: "54%" }}>
            🍲 女14舍餐廳
          </div>
          <div className="absolute text-[6px] font-medium text-red-700 select-none pointer-events-none" style={{ left: "74%", top: "25%" }}>
            🏃 田徑場
          </div>

          {/* 3. User Geolocation pulse indicator */}
          {userLocation && (
            <div
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none"
              style={{
                left: `${getMapCoords(userLocation.latitude, userLocation.longitude).x}%`,
                top: `${getMapCoords(userLocation.latitude, userLocation.longitude).y}%`
              }}
            >
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping"></span>
              <span className="relative block rounded-full h-3.5 w-3.5 bg-blue-600 border-2 border-white shadow-lg"></span>
            </div>
          )}

          {/* 4. Active restaurant pins */}
          {restaurants
            .filter(r => !blacklistRestIds.includes(r.restaurant_id))
            .map(r => {
              const coords = getRestaurantCoords(r);
              const { x, y } = getMapCoords(coords.lat, coords.lng);
              const isSelected = selectedRestaurant?.restaurant_id === r.restaurant_id;
              const isLoved = lovedRestIds.includes(r.restaurant_id);

              return (
                <button
                  key={r.restaurant_id}
                  onClick={() => onSelectRestaurant(r)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 flex flex-col items-center group cursor-pointer ${
                    isSelected ? "z-40 scale-125" : "z-10 hover:z-30 hover:scale-110"
                  }`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  {/* Selector focus pulsing ring */}
                  {isSelected && (
                    <span className="absolute -inset-3 rounded-full bg-amber-400 opacity-30 animate-pulse pointer-events-none"></span>
                  )}

                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold shadow-md border whitespace-nowrap transition-colors duration-200 ${
                      isSelected
                        ? "bg-[#5a5a40] text-amber-300 border-[#5a5a40]"
                        : isLoved
                        ? "bg-rose-500 text-white border-rose-400"
                        : "bg-white text-[#5a5a40] border-[#e5e1da]"
                    }`}
                  >
                    <span>{isLoved ? "❤️" : "📍"}</span>
                    <span className="max-w-[70px] truncate">{r.name}</span>
                  </div>

                  {/* Micro tooltip */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:block bg-stone-800 text-white text-[8px] py-1.5 px-2 rounded-lg shadow-lg z-50 whitespace-nowrap opacity-95 text-left">
                    <div>⭐ {r.rating} | 🚶 {r.walking_distance} mins | NT$ {r.avg_price}</div>
                    <div className={isRestaurantOpenNow((r as any).business_hours) ? "text-emerald-300" : "text-rose-300"}>
                      {isRestaurantOpenNow((r as any).business_hours) ? "🟢 營業中" : "🔴 目前未營業"}
                    </div>
                    <div className="max-w-[220px] truncate">
                      🕒 {simplifyBusinessHour(getTodayBusinessHour(r.business_hours))}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
