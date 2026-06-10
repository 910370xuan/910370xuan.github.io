/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Restaurant, MenuItem } from "../types";
import { getRestaurantImageUrl, getMealImageUrl } from "../utils/imageUtils";
import { getRestaurantArea } from "../utils/mapUtils";
import { Heart, EyeOff, Sliders, Megaphone, Compass, Search, ChevronDown, ChevronUp, MapPin, Tag, Percent, Info, AlertCircle, CheckCircle2, Image, BookOpen } from "lucide-react";

interface ProfileExploreProps {
  restaurants: Restaurant[];
  menuItems: MenuItem[];
  lovedRestIds: number[];
  blacklistRestIds: number[];
  blacklistMeals: string[];
  username: string;
  onUpdateUsername: (name: string) => void;
  onToggleLoveRest: (id: number) => void;
  onToggleBlacklistRest: (id: number) => void;
  onToggleBlacklistMeal: (name: string) => void;
  onFocusRestaurantOnMap: (id: number) => void;
  deals: any[];
  userRole?: string;
  onUpdateRole?: (role: string) => void;
  mode?: "profile-only" | "explore-only" | "full";
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

export default function ProfileExplore({
  restaurants,
  menuItems,
  lovedRestIds,
  blacklistRestIds,
  blacklistMeals,
  username,
  onUpdateUsername,
  onToggleLoveRest,
  onToggleBlacklistRest,
  onToggleBlacklistMeal,
  onFocusRestaurantOnMap,
  deals,
  userRole,
  onUpdateRole,
  mode = "full"
}: ProfileExploreProps) {
  const [subTab, setSubTab] = useState<"settings" | "deals" | "directory">(() => {
    if (mode === "profile-only") return "settings";
    if (mode === "explore-only") return "directory";
    return "settings";
  });
  
  // Settings tab variables
  const [newBistMealInput, setNewBistMealInput] = useState("");
  
  // Directory tab variables
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState("all");
  const [expandedRestId, setExpandedRestId] = useState<number | null>(null);
  const [selectedDish, setSelectedDish] = useState<MenuItem | null>(null);
  
  // Diagnostics & Google Media Album configurations
  const [menuTabs, setMenuTabs] = useState<Record<number, "digital" | "photos">>({});
  const [diagnostics, setDiagnostics] = useState<{
    mapsKeyConfigured: boolean;
    mapsKeySource: string;
    geminiKeyConfigured: boolean;
    firebaseKeyConfigured: boolean;
    environmentFallbackActive: boolean;
  } | null>(null);
  const [showDiagModal, setShowDiagModal] = useState(false);
  const [selectedPhotoFullscreen, setSelectedPhotoFullscreen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/diagnostics")
      .then(res => res.json())
      .then(data => setDiagnostics(data))
      .catch(err => console.error("Error fetching diagnostics details:", err));
  }, []);

  const categories = ["all", "台式", "日式", "港式", "美式", "飲料", "點心", "蔬食.素食"];
  const safeText = (value: unknown, fallback = "") => {
    return typeof value === "string" ? value : fallback;
  };

  const safeNumber = (value: unknown, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const formatFixed = (value: unknown, digits = 1, fallback = 0) => {
    return safeNumber(value, fallback).toFixed(digits);
  };

  // Filters for Directory
  const filteredRestaurants = restaurants.filter(r => {
    const keyword = searchQuery.toLowerCase();
    const restName = safeText(r.name).toLowerCase();
    const restLocation = safeText(r.location_desc).toLowerCase();
    const signatureDishes = Array.isArray(r.signature_dishes) ? r.signature_dishes : [];

    const matchesSearch = restName.includes(keyword) ||
                          restLocation.includes(keyword) ||
                          signatureDishes.some(d => safeText(d).toLowerCase().includes(keyword));
    const matchesCategory = selectedCat === "all" || safeText(r.category) === selectedCat;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="bg-white rounded-3xl p-6 border border-[#e5e1da] shadow-sm flex flex-col gap-6 font-sans">
      {/* Sub tabs switches */}
      {mode !== "profile-only" && (
        <div className="flex border-b border-[#e5e1da]/50 pb-1 gap-2">
          {mode !== "explore-only" && (
            <button
              onClick={() => setSubTab("settings")}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                subTab === "settings"
                  ? "bg-[#5a5a40] text-white shadow-md"
                  : "bg-[#fbfbf9] hover:bg-[#e5e1da]/40 text-[#5a5a40]"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>偏好設定 & 黑名單</span>
            </button>
          )}

          <button
            onClick={() => setSubTab("deals")}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              subTab === "deals"
                ? "bg-[#5a5a40] text-white shadow-md"
                : "bg-[#fbfbf9] hover:bg-[#e5e1da]/40 text-[#5a5a40]"
            }`}
          >
            <Megaphone className="w-3.5 h-3.5" />
            <span>好康報報特惠 ({deals.length})</span>
          </button>

          <button
            onClick={() => setSubTab("directory")}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              subTab === "directory"
                ? "bg-[#5a5a40] text-white shadow-md"
                : "bg-[#fbfbf9] hover:bg-[#e5e1da]/40 text-[#5a5a40]"
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>全餐廳百寶箱</span>
          </button>
        </div>
      )}

      {/* SUB-TAB A: Settings & Blacklists */}
      {subTab === "settings" && (
        <div className="flex flex-col gap-6">
          <div className="bg-[#FAF8F5] p-5 rounded-2xl border border-[#e5e1da]/70 flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-[#8a8a70]">
              👤 個人美食身份證
            </h4>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <span className="text-xs text-[#3d3d3d] font-bold">我的暱稱:</span>
              <input
                type="text"
                value={username}
                onChange={(e) => onUpdateUsername(e.target.value)}
                placeholder="輸入您的中大暱稱"
                className="bg-white border border-[#e5e1da] rounded-xl px-3.5 py-1.5 text-xs text-[#5a5a40] font-bold focus:outline-none focus:border-[#5a5a40] flex-1 max-w-sm"
              />
            </div>
            {userRole && onUpdateRole && (
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <span className="text-xs text-[#3d3d3d] font-bold">校園身分:</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateRole("user")}
                    className={`px-3 py-1 text-xs font-bold rounded-lg border transition ${
                      userRole === "user"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-white text-stone-500 border-stone-200 hover:bg-stone-50 hover:text-stone-700"
                    }`}
                  >
                    🎓 學生 / 中大訪客
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateRole("merchant")}
                    className={`px-3 py-1 text-xs font-bold rounded-lg border transition ${
                      userRole === "merchant"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : "bg-white text-stone-500 border-stone-200 hover:bg-stone-50 hover:text-stone-700"
                    }`}
                  >
                    🏪 特約店家 / 商家代表
                  </button>
                  {userRole === "admin" && (
                    <span className="px-3 py-1 text-xs font-bold rounded-lg border bg-rose-50 text-rose-800 border-rose-200">
                      🛡️ 系統稽核管理員
                    </span>
                  )}
                </div>
              </div>
            )}
            <p className="text-[10px] text-[#8a8a70]">
              * 設定後，AI 與群組抽籤房將自動套用您的名字，並在推薦結果中加入貼心語氣。學生與店家登入分流將根據您的校園身分，解鎖對應的特許權限。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* BLACKLIST PART */}
            <div className="flex flex-col gap-4 border border-[#e5e1da]/50 p-5 rounded-2xl bg-[#fffcfc]">
              <h4 className="text-sm font-bold text-[#3d3d3d] flex items-center gap-1.5 font-serif">
                <EyeOff className="w-4 h-4 text-rose-500" />
                <span>避雷黑名單 (剔除防震)</span>
              </h4>
              <p className="text-[11px] text-[#8a8a70]">
                被標記的店家，或含有對應原料配方的餐點，將自動在任何抽籤卡與推薦演算法中，被系統剔除。
              </p>

              {/* Blacklisted restaurants */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-[#5a5a40]">🚫 已屏蔽店家 ({blacklistRestIds.length}) :</span>
                {blacklistRestIds.length === 0 ? (
                  <div className="text-[11px] text-[#8a8a70]/75 bg-[#fdfbfb] p-3 rounded-xl border border-dashed border-[#e5e1da] text-center">
                    目前乾淨無雷，美食世界大同！
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-[#FAF8F5] rounded-xl border border-[#e5e1da]/50">
                    {blacklistRestIds.map(id => {
                      const rest = restaurants.find(r => r.restaurant_id === id);
                      return (
                        <div key={id} className="flex items-center gap-1.5 bg-rose-50 text-rose-800 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-rose-100">
                          <span>{rest ? rest.name : `Restaurant #${id}`}</span>
                          <button
                            onClick={() => onToggleBlacklistRest(id)}
                            className="hover:text-rose-900 font-bold ml-1 cursor-pointer"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Blacklisted dishes */}
              <div className="flex flex-col gap-2 pt-2">
                <span className="text-xs font-bold text-[#5a5a40]">🍜 已屏蔽菜名關鍵字 ({blacklistMeals.length}) :</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="新增避雷菜餚 (例如: 香菜、牛、咖哩)"
                    value={newBistMealInput}
                    onChange={(e) => setNewBistMealInput(e.target.value)}
                    className="bg-white border border-[#e5e1da] rounded-xl px-3 py-1.5 text-xs text-[#5a5a40] flex-1 focus:outline-none focus:border-[#5a5a40]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (newBistMealInput.trim()) {
                          onToggleBlacklistMeal(newBistMealInput.trim());
                          setNewBistMealInput("");
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newBistMealInput.trim()) {
                        onToggleBlacklistMeal(newBistMealInput.trim());
                        setNewBistMealInput("");
                      }
                    }}
                    className="bg-rose-500 hover:bg-rose-600 text-white font-bold px-3 py-1.5 rounded-xl text-xs cursor-pointer"
                  >
                    新增
                  </button>
                </div>

                {blacklistMeals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-[#FAF8F5] rounded-xl border border-[#e5e1da]/50 mt-1">
                    {blacklistMeals.map(meal => (
                      <div key={meal} className="flex items-center gap-1.5 bg-rose-50 text-rose-800 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-rose-100">
                        <span>{meal}</span>
                        <button
                          onClick={() => onToggleBlacklistMeal(meal)}
                          className="hover:text-rose-900 font-bold ml-1 cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* LOVE LIST PART */}
            <div className="flex flex-col gap-4 border border-[#e5e1da]/50 p-5 rounded-2xl bg-[#fffdfd]">
              <h4 className="text-sm font-bold text-[#3d3d3d] flex items-center gap-1.5 font-serif">
                <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                <span>愛店關注牆 (權重加倍)</span>
              </h4>
              <p className="text-[11px] text-[#8a8a70]">
                加入關注的店家，智慧推薦演算法將拉抬其曝光權重、降低重複隨機阻力。抽中愛店時，地圖將迸發愛心雨貼圖！
              </p>

              <div className="flex flex-col gap-2 flex-1">
                {lovedRestIds.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-[#FAF8F5] rounded-2xl border border-dashed border-[#e5e1da] text-[#8a8a70]/75 gap-1.5">
                    <Heart className="w-8 h-8 text-[#8a8a70]/40" />
                    <span className="text-[11px]">還沒有被最愛認證的店家唷</span>
                    <span className="text-[10px] text-[#a0a08e]">可以在「餐廳百寶箱」給予最愛標記</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 overflow-y-auto max-h-60 p-1">
                    {lovedRestIds.map(id => {
                      const rest = restaurants.find(r => r.restaurant_id === id);
                      if (!rest) return null;
                      return (
                        <div key={id} className="flex items-center justify-between bg-white border border-[#e5e1da] p-3 rounded-xl shadow-sm hover:shadow-md transition">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">❤️</span>
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-bold text-[#3d3d3d]">{rest.name}</span>
                              <span className="text-[9px] text-[#8a8a70]">{rest.location_desc}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => onToggleLoveRest(id)}
                            className="text-[10px] bg-stone-50 hover:bg-rose-50 hover:text-rose-600 border border-[#e5e1da] text-stone-500 rounded-lg px-2 py-1 transition cursor-pointer"
                          >
                            不愛了
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB B: Hot Deals */}
      {subTab === "deals" && (
        <div className="flex flex-col gap-4">
          <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-200/50 text-left">
            <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1 font-serif">
              <Megaphone className="w-3.5 h-3.5" />
              <span>中大周邊商家今日促銷・促成校友經濟圈</span>
            </h4>
            <p className="text-[11px] text-amber-700/80 mt-1">
              由第六組安全審核通過的商家限定折價券，點擊
              <strong className="text-amber-900 mx-1">「📍 導航/地圖定位」</strong>
              ，首頁地圖將自動絲滑飛至該店，並彈出答案卡，領取今日餐點福袋！
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {deals.length === 0 ? (
              <div className="col-span-2 text-center p-12 bg-[#FAF8F5] rounded-3xl border border-dashed border-[#e5e1da] text-[#8a8a70]/70">
                暫時沒有上線的折價好康，歡迎至商家通道提案提交！
              </div>
            ) : (
              deals.map((deal) => {
                const rest = restaurants.find(r => r.restaurant_id === deal.restaurant_id || r.name === deal.restaurant_name);
                return (
                  <div key={deal.deal_id || deal.id} className="relative bg-white border border-[#e5e1da] rounded-2xl p-4 shadow-sm hover:shadow-md transition flex gap-3 text-left overflow-hidden">
                    {/* Corner Tag */}
                    <div className="absolute top-0 right-0 bg-amber-500 text-white text-[9px] font-bold py-0.5 px-2 rounded-bl-xl flex items-center gap-0.5 shadow-sm">
                      <Percent className="w-2.5 h-2.5" />
                      COUPON
                    </div>

                    <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-xl shrink-0 mt-1">
                      🎟️
                    </div>

                    <div className="flex-1 flex flex-col gap-1.5 justify-between pr-8">
                      <div>
                        <h4 className="text-xs font-bold text-[#3d3d3d] tracking-wide">
                          {deal.restaurant_name || (rest ? rest.name : "中央特約商家")}
                        </h4>
                        <p className="text-xs text-rose-600 font-bold leading-tight font-serif mt-0.5">
                          {deal.offer}
                        </p>
                        {deal.code && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-[9px] text-[#8a8a70]">券碼:</span>
                            <span className="text-[9px] font-mono bg-[#f4f4f0] text-[#5a5a40] px-1.5 py-0.5 rounded border border-[#e5e1da] font-bold">
                              {deal.code}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end gap-1.5 mt-2">
                        {rest && (
                          <button
                            onClick={() => onFocusRestaurantOnMap(rest.restaurant_id)}
                            className="bg-gradient-to-tr from-[#5a5a40] to-[#3d3d2e] text-white text-[10px] font-bold py-1.5 px-3 rounded-lg shadow-sm hover:shadow-md transition cursor-pointer flex items-center gap-1"
                          >
                            <MapPin className="w-3 h-3 text-amber-300" />
                            <span>📍 導航 / 地圖定位</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB C: All Restaurants */}
      {subTab === "directory" && (
        <div className="flex flex-col gap-4">
          {/* Diagnostics Alert ribbon */}
          <div className="bg-amber-500/10 border border-amber-200/50 rounded-2xl p-3 flex items-center justify-between gap-3 text-left">
            <div className="flex items-start gap-2 min-w-0">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h5 className="text-[11px] font-bold text-stone-850 flex items-center gap-1.5">
                  🗺️ Google Map 現場真實照檢視與圖資診斷
                  {diagnostics?.mapsKeyConfigured ? (
                    <span className="bg-emerald-100 text-emerald-800 text-[8px] px-1.5 py-0.2 rounded font-black whitespace-nowrap">API 授權已配置</span>
                  ) : (
                    <span className="bg-amber-100 text-amber-800 text-[8px] px-1.5 py-0.2 rounded font-black whitespace-nowrap">模擬演示中 (點按診斷)</span>
                  )}
                </h5>
                <p className="text-[9px] text-[#8a8a70] leading-normal truncate sm:whitespace-normal mt-0.5">
                  {diagnostics?.mapsKeyConfigured 
                    ? `已成功經由後端代理安全連通 Google Places 實景圖庫。各店家的現場顧客相片、實體紙本菜單照片均可不限 CORS 與 Referrer 安全解析！` 
                    : `未偵測到 GOOGLE_MAPS_PLATFORM_KEY。圖片採高擬真 fallback 資料。展開下方店家詳細菜單，點選手寫黑板風或相本，即可查看現場配對。`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowDiagModal(true)}
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 text-[9px] font-bold px-3 py-1.5 rounded-xl transition shrink-0 cursor-pointer shadow-2xs"
            >
              🔍 診斷圖資 API
            </button>
          </div>

          {/* Filters shelf */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#8a8a70]" />
              <input
                type="text"
                placeholder="搜尋店名、招牌菜名 (例如: 鬆餅、三寶飯、拉麵)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[#FAF8F5] border border-[#e5e1da] rounded-xl pl-9 pr-4 py-2 text-xs text-[#5a5a40] w-full focus:outline-none focus:border-[#5a5a40]"
              />
            </div>
            
            <div className="flex gap-1 overflow-x-auto pb-1 max-w-full md:max-w-md shrink-0 scrollbar-none">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCat(cat)}
                  className={`py-1.5 px-3 rounded-xl text-[10px] font-bold border transition whitespace-nowrap cursor-pointer ${
                    selectedCat === cat
                      ? "bg-[#5a5a40] border-[#5a5a40] text-white"
                      : "bg-[#fffdfa] border-[#e5e1da] text-[#8a8a70] hover:bg-[#e5e1da]/20"
                  }`}
                >
                  {cat === "all" ? "全部" : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Catalog grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-h-[500px] overflow-y-auto pr-1">
            {filteredRestaurants.length === 0 ? (
              <div className="col-span-3 text-center p-12 text-[#8a8a70] bg-[#FAF8F5] rounded-3xl border border-dashed border-[#e5e1da]">
                沒有找到符合過濾條件的店家，試試其他關鍵字吧！
              </div>
            ) : (
              filteredRestaurants.map((r) => {
                const isLoved = lovedRestIds.includes(r.restaurant_id);
                const isBlocked = blacklistRestIds.includes(r.restaurant_id);
                const isExpanded = expandedRestId === r.restaurant_id;
                
                // Fetch menu for this restaurant
                const restMenu = menuItems.filter(item => item.restaurant_id === r.restaurant_id);
                const businessHours = (r as any).business_hours as string[] | undefined;
                const todayBusinessHour = getTodayBusinessHour(businessHours);
                const isOpenNow = isRestaurantOpenNow(businessHours);
                
                return (
                  <div
                    key={r.restaurant_id}
                    className={`border rounded-2xl overflow-hidden bg-white shadow-sm transition flex flex-col justify-between ${
                      isBlocked 
                        ? "border-red-200 opacity-60 bg-red-50/20" 
                        : isLoved
                        ? "border-rose-200 bg-rose-50/5"
                        : "border-[#e5e1da]"
                    }`}
                  >
                    <div>
                      {/* Store image */}
                      <div className="h-28 w-full bg-[#f4f4f0] relative overflow-hidden">
                        <img
                          src={r.img_url || getRestaurantImageUrl(r.restaurant_id, r.category, r.name)}
                          alt={r.name}
                          className="w-full h-full object-cover opacity-85 hover:scale-105 transition duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-2 left-2 bg-stone-900/40 text-white text-[9px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm shadow-sm capitalize">
                          {r.category}
                        </div>
                        <div className="absolute top-2 right-2 flex gap-1">
                          <button
                            onClick={() => onToggleLoveRest(r.restaurant_id)}
                            className={`p-1.5 rounded-full backdrop-blur-sm shadow-md transition active:scale-90 cursor-pointer ${
                              isLoved 
                                ? "bg-rose-500 text-white" 
                                : "bg-white/80 hover:bg-white text-stone-500 hover:text-rose-500"
                            }`}
                            title={isLoved ? "取消關注" : "關注愛店"}
                          >
                            <Heart className={`w-3.5 h-3.5 ${isLoved ? "fill-white" : ""}`} />
                          </button>
                          
                          <button
                            onClick={() => onToggleBlacklistRest(r.restaurant_id)}
                            className={`p-1.5 rounded-full backdrop-blur-sm shadow-md transition active:scale-90 cursor-pointer ${
                              isBlocked 
                                ? "bg-rose-700 text-white" 
                                : "bg-white/80 hover:bg-white text-stone-500 hover:text-rose-700"
                            }`}
                            title={isBlocked ? "解鎖蔽雷" : "加入蔽雷名單"}
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Store facts */}
                      <div className="p-4 flex flex-col text-left gap-1.5">
                        <div className="flex items-start justify-between">
                          <h4 className="text-xs font-bold text-[#3d3d3d] tracking-wide font-serif">
                            {r.name}
                          </h4>
                          <span className="text-[10px] bg-amber-50 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-100">
                            ⭐{formatFixed(r.rating, 1, 4.2)}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1 items-center text-[10px] text-[#8a8a70] mt-0.5">
                          <span className="bg-[#FAF8F5] px-1 py-0.5 rounded border border-[#e5e1da]/50">
                            📍 {getRestaurantArea(r.restaurant_id, r.location_desc)}
                          </span>
                          <span>•</span>
                          <span>🚶 {r.walking_distance}分</span>
                          <span>•</span>
                          <span>均消${r.avg_price}</span>
                        </div>

                        <div className="flex flex-wrap gap-1 items-center text-[10px] mt-1">
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded-lg border ${
                              isOpenNow
                                ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                                : "bg-rose-50 text-rose-800 border-rose-100"
                            }`}
                          >
                            {isOpenNow ? "🟢 營業中" : "🔴 目前未營業"}
                          </span>
                          <span className="bg-amber-50 text-amber-800 font-bold px-1.5 py-0.5 rounded-lg border border-amber-100 max-w-full truncate">
                            🕒 {todayBusinessHour}
                          </span>
                        </div>

                        {r.signature_dishes && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {r.signature_dishes.map(d => (
                              <span key={d} className="text-[9px] bg-stone-50 text-[#8a8a70] px-1.5 py-0.5 rounded border border-[#e5e1da]/40">
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer accordion btn */}
                    <div className="border-t border-[#e5e1da]/45 p-2 bg-stone-50/50 flex flex-col gap-2">
                      <button
                        onClick={() => setExpandedRestId(isExpanded ? null : r.restaurant_id)}
                        className="w-full text-center text-[10px] font-bold text-[#5a5a40] hover:text-[#3d3d2e] py-1 flex items-center justify-center gap-1 cursor-pointer transition"
                      >
                        <span>{isExpanded ? "收合詳細菜單" : "👉 展開詳細菜單"}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="text-left bg-[#FAF9F6] border border-[#e5e1da]/60 p-2.5 rounded-xl flex flex-col gap-2 max-h-[360px] overflow-y-auto shadow-inner">
                          {/* Inner Tabs header */}
                          <div className="flex border-b border-[#e5e1da]/50 pb-1.5 gap-2 items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-stone-500 flex items-center gap-1">📖 菜單與圖片展示</span>
                            <div className="flex gap-0.5 bg-stone-200 p-0.5 rounded-lg border border-stone-200">
                              <button
                                onClick={() => setMenuTabs(prev => ({ ...prev, [r.restaurant_id]: "digital" }))}
                                className={`px-2 py-1 rounded-md text-[8px] font-black transition cursor-pointer ${
                                  (menuTabs[r.restaurant_id] || "digital") === "digital"
                                    ? "bg-white text-stone-800 shadow-xs border border-stone-200"
                                    : "text-stone-500 hover:text-stone-700"
                                }`}
                              >
                                🗂️ 數位精緻菜品
                              </button>
                              <button
                                onClick={() => setMenuTabs(prev => ({ ...prev, [r.restaurant_id]: "photos" }))}
                                className={`px-2 py-1 rounded-md text-[8px] font-black transition cursor-pointer flex items-center gap-0.5 ${
                                  (menuTabs[r.restaurant_id] || "digital") === "photos"
                                    ? "bg-white text-stone-800 shadow-xs border border-stone-200"
                                    : "text-stone-500 hover:text-stone-700"
                                }`}
                              >
                                📸 實物/實體菜單牆
                              </button>
                            </div>
                          </div>

                          {(menuTabs[r.restaurant_id] || "digital") === "digital" ? (
                            // Digital menu layout
                            restMenu.length === 0 ? (
                              <p className="text-[10px] text-[#8a8a70] italic text-center py-4">
                                暫無上架菜品
                              </p>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                <span className="text-[8px] text-[#8a8a70] px-1 pb-1 block border-b border-[#e5e1da]/45 border-dashed">
                                  💡 點擊品項可查看大圖
                                </span>
                                {restMenu.map((m, idx) => {
                                  const isBlacklistedMeal = blacklistMeals.includes(m.item_name);
                                  return (
                                    <div 
                                      key={idx} 
                                      onClick={() => setSelectedDish(m)}
                                      className={`flex justify-between items-center text-[10px] border border-stone-150 p-1.5 hover:border-amber-400 bg-white rounded-lg transition-all cursor-pointer shadow-sm hover:shadow-md ${
                                        isBlacklistedMeal ? "opacity-45 bg-[#FAF8F5]" : ""
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        {m.img_url && (
                                          <img 
                                            src={m.img_url} 
                                            alt={m.item_name}
                                            referrerPolicy="no-referrer"
                                            className="w-10 h-10 object-cover rounded-md border border-stone-100 flex-shrink-0 bg-stone-50"
                                            onError={(e) => {
                                              const target = e.target as HTMLImageElement;
                                              target.src = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=150&h=150&q=80";
                                            }}
                                          />
                                        )}
                                        <div className="flex flex-col min-w-0">
                                          <div className="flex items-center gap-1">
                                            <span className="font-bold text-[#3d3d3d] truncate">{m.item_name}</span>
                                            {m.spicy_level && m.spicy_level !== "無辣" && (
                                              <span className="text-[8px] bg-red-50 text-red-600 px-1 rounded font-semibold whitespace-nowrap">
                                                🌶️ {m.spicy_level}
                                              </span>
                                            )}
                                          </div>
                                          {m.ingredients && m.ingredients.length > 0 ? (
                                            <span className="text-[8px] text-[#8a8a70] truncate">
                                              配料: {m.ingredients.join(', ')}
                                            </span>
                                          ) : (
                                            <span className="text-[8px] text-[#afafa0] truncate">主廚匠心鮮製經典配方</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0 pl-1">
                                        <span className="font-bold text-rose-600 font-mono text-xs">${m.price}</span>
                                        {m.popularity_score && (
                                          <span className="text-[7px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded-sm scale-90 translate-x-[2px] font-semibold">
                                            🔥 {formatFixed(m.popularity_score, 1, 0)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          ) : (
                            // Physical/scanned menu gallery
                            <div>
                              {(r as any).google_photos && (r as any).google_photos.length > 0 ? (
                                <div className="flex flex-col gap-2">
                                  <span className="text-[8.5px] text-[#555540] italic block px-1.5 py-1 leading-normal bg-green-500/10 p-1.5 rounded-lg border border-green-200">
                                    🟢 本文資料由 Google Places 雲端直接加載 <strong>真實店家拍照/實體紙本菜單</strong>。點擊照片即可全螢幕查看真實菜品與大圖！
                                  </span>
                                  <div className="grid grid-cols-2 gap-2 mt-1 font-sans">
                                    {(r as any).google_photos.map((pUrl: string, idx: number) => (
                                      <div 
                                        key={idx}
                                        onClick={() => setSelectedPhotoFullscreen(pUrl)} 
                                        className="relative h-20 bg-stone-100 rounded-lg overflow-hidden border border-stone-200 shadow-2xs hover:shadow-md hover:border-amber-500 transition cursor-pointer"
                                      >
                                        <img 
                                          src={pUrl} 
                                          alt={`${r.name} 現場物實相片 ${idx + 1}`}
                                          className="w-full h-full object-cover"
                                          referrerPolicy="no-referrer"
                                          onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            target.src = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=150&h=150&q=80";
                                          }}
                                        />
                                        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[7px] px-1 rounded font-bold font-sans">
                                          實物影像 #{idx + 1}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                // Handwritten Chalk-Style Blackboard Fallboard for fallback data
                                <div className="bg-[#1e1e1a] border-4 border-[#5c4a37] rounded-xl p-3 shadow-inner text-amber-50 font-mono text-[9px] flex flex-col gap-2 select-none relative overflow-hidden backdrop-blur-xs">
                                  <div className="absolute top-1 right-2 text-[7px] text-amber-200/40 tracking-widest font-sans">CHALKBOARD</div>
                                  <h6 className="text-[9.5px] text-amber-200 font-bold border-b border-dashed border-amber-200/30 pb-1 text-center flex items-center justify-center gap-1">
                                    📋 {r.name} 現場手繪實體菜單推薦板 
                                  </h6>
                                  <div className="flex flex-col gap-1 my-1 leading-normal">
                                    {restMenu.map((m, idx) => (
                                      <div key={idx} className="flex justify-between items-center border-b border-stone-800/10 pb-0.5 text-[#fbf6ea]">
                                        <span className="font-semibold text-white">★ {m.item_name}</span>
                                        <div className="flex-1 mx-1 border-b border-dotted border-stone-600/30 h-1"></div>
                                        <span className="font-bold text-amber-300 font-mono">${m.price}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="text-[7.5px] text-stone-400 leading-relaxed bg-black/40 p-2 rounded-lg border border-white/5 flex flex-col gap-1">
                                    <span>
                                      💡 <strong>說明：</strong>此店家為落款在 NCU fallback 靜態美食推薦中。
                                    </span>
                                    <span>
                                      如需讀取實體紙本菜單照片與現場外觀，請確認上方 API 診斷！完成 GCP PLaces API 開通儲備並進行「一鍵校園美食同步」後，各餐廳的實際菜單照片即會於此相本全自動出現！
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Dish Detail Overlay Modal */}
      {selectedDish && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl overflow-hidden max-w-sm w-full shadow-2xl border border-[#e5e1da] flex flex-col relative">
            
            {/* Image section with relative badge */}
            <div className="relative h-48 w-full bg-stone-100 flex-shrink-0">
              <img 
                src={selectedDish.img_url} 
                alt={selectedDish.item_name} 
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&h=300&q=80";
                }}
              />
              
              {/* Close button */}
              <button 
                onClick={() => setSelectedDish(null)}
                className="absolute top-3 right-3 bg-white/80 hover:bg-white text-stone-700 hover:text-stone-900 px-2 py-1 rounded-full shadow-md backdrop-blur-xs transition cursor-pointer text-xs font-bold font-sans"
              >
                ✕
              </button>

              {/* Tag overlay */}
              {selectedDish.tags && selectedDish.tags.length > 0 && (
                <div className="absolute bottom-3 left-3 flex gap-1">
                  {selectedDish.tags.map(t => (
                    <span key={t} className="text-[8px] bg-amber-500 text-white font-bold px-2 py-0.5 rounded-full shadow-sm">
                      ✨ {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Content section */}
            <div className="p-5 flex flex-col gap-4 text-left">
              <div>
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-sm font-bold text-stone-800 tracking-wide">
                    {selectedDish.item_name}
                  </h3>
                  <span className="text-sm font-black text-rose-600 font-mono flex-shrink-0">
                    ${selectedDish.price}
                  </span>
                </div>
                
                <div className="flex gap-2 items-center text-[10px] text-stone-400 mt-1">
                  {selectedDish.size_desc && <span>分量: {selectedDish.size_desc}</span>}
                  {selectedDish.spicy_level && selectedDish.spicy_level !== "無辣" && (
                    <span className="text-red-500 font-bold bg-red-50 px-1.5 py-0.5 rounded">
                      🌶️ {selectedDish.spicy_level}
                    </span>
                  )}
                  {selectedDish.popularity_score && (
                    <span className="text-amber-600 bg-amber-50 font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      🔥 {formatFixed(selectedDish.popularity_score, 1, 0)} / 10
                    </span>
                  )}
                </div>
              </div>

              {/* Ingredients card */}
              <div className="bg-[#FAF9F6] border border-[#e5e1da]/50 p-3 rounded-2xl">
                <span className="text-[10px] font-bold text-stone-500 block mb-1">📋 食材與配料清單 ({selectedDish.ingredients?.length || 0})</span>
                {selectedDish.ingredients && selectedDish.ingredients.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedDish.ingredients.map(i => (
                      <span key={i} className="text-[9px] bg-white text-stone-600 px-2 py-0.5 rounded-md border border-[#e5e1da]/45 shadow-2xs">
                        {i}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-[#8a8a70] italic">
                    主廚特調新鮮配方，不含任何過敏成分。
                  </p>
                )}
              </div>

              {/* Blacklist block toggle */}
              <button
                type="button"
                onClick={() => {
                  onToggleBlacklistMeal(selectedDish.item_name);
                }}
                className={`w-full py-2.5 rounded-xl text-[10px] font-bold text-center border transition flex items-center justify-center gap-1 cursor-pointer ${
                  blacklistMeals.includes(selectedDish.item_name)
                    ? "bg-stone-50 hover:bg-stone-100 text-[#5a5a40] border-[#e5e1da]"
                    : "bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                }`}
              >
                <span>{blacklistMeals.includes(selectedDish.item_name) ? "🔓 從黑名單移除" : "🚫 黑名單此菜色 (不再推薦)"}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Diagnostics Modal Overlays */}
      {showDiagModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-[#e5e1da] flex flex-col gap-4 text-left relative">
            <button 
              onClick={() => setShowDiagModal(false)}
              className="absolute top-4 right-4 bg-stone-100 hover:bg-stone-200 text-stone-500 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold transition cursor-pointer"
            >
              ✕
            </button>

            <h3 className="text-sm font-bold text-stone-800 flex items-center gap-1.5 border-b border-dashed border-[#e5e1da] pb-2">
              ⚙️ Google API & 實地照相圖資診斷面板
            </h3>

            <div className="flex flex-col gap-3 text-xs text-stone-600">
              {/* Maps Key status */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex flex-col">
                  <span className="font-bold text-[10px]">Google Maps Platform 金鑰</span>
                  <span className="text-[9px] text-stone-400">來源: {diagnostics?.mapsKeySource || "偵測中..."}</span>
                </div>
                {diagnostics?.mapsKeyConfigured ? (
                  <span className="text-[9px] bg-green-50 text-green-700 px-2 py-0.5 rounded font-bold flex items-center gap-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> 連線正常
                  </span>
                ) : (
                  <span className="text-[9px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold flex items-center gap-0.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Mock Fallback
                  </span>
                )}
              </div>

              {/* Photos Troubleshooting list */}
              <div className="flex flex-col gap-1">
                <span className="font-bold text-[10px] text-stone-500">❓ 為什麼原生的真實照片有時會載入失敗？</span>
                <ul className="list-disc pl-4 text-[9px] text-stone-500 flex flex-col gap-1.5 leading-relaxed font-sans">
                  <li>
                    <strong className="text-stone-700">雲端帳單限制：</strong>
                    Google Places API (New) 規定獲取現場使用者相片要求其連入的 GCP 專案具備「可付費之有效帳單」。如超出配額，Google 將會拒絕提供媒體串流。
                  </li>
                  <li>
                    <strong className="text-stone-700">自訂 API 變數設定：</strong>
                    您可以至 AI Studio 側邊設定面板（OS Environment Variables）宣告 
                    <code className="bg-stone-100 px-1 py-0.5 rounded font-mono text-[8px] font-bold">GOOGLE_MAPS_PLATFORM_KEY</code> 
                    填入您的金鑰，並點擊系統頂部的同步鈕即可自由抓取高畫質現場照片與實際菜單！
                  </li>
                  <li>
                    <strong className="text-stone-700">安全中繼 Proxy 代理：</strong>
                    我們本版本增建了後端加密代理 
                    <code className="bg-stone-100 px-1 py-0.5 rounded font-mono text-[8px] font-bold">/api/places-photo</code> 
                    ，100% 隱蔽 Client 端的 API KEY 防止外流盜刷，亦跨過 Domain/Referrer 等跨來源問題！
                  </li>
                </ul>
              </div>
            </div>

            <button
              onClick={() => setShowDiagModal(false)}
              className="w-full bg-[#5a5a40] hover:bg-[#3d3d2e] text-white py-2.5 rounded-xl text-xs font-bold text-center transition cursor-pointer shadow-md"
            >
              確認並關閉
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Photo Lightbox Modal */}
      {selectedPhotoFullscreen && (
        <div 
          className="fixed inset-0 bg-stone-950/85 backdrop-blur-md z-55 flex items-center justify-center p-4"
          onClick={() => setSelectedPhotoFullscreen(null)}
        >
          <div className="max-w-3xl w-full max-h-[85vh] flex flex-col gap-2 relative">
            <button 
              onClick={() => setSelectedPhotoFullscreen(null)}
              className="absolute -top-7 right-0 text-white hover:text-stone-300 font-bold tracking-wide text-[10px] cursor-pointer flex items-center gap-1 bg-stone-800/40 px-3 py-1 rounded-full border border-white/20"
            >
              ✕ 關閉大圖
            </button>
            <div className="bg-white/5 rounded-3xl p-1 overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center h-full max-h-[75vh]">
              <img 
                src={selectedPhotoFullscreen} 
                alt="現場店家規格或紙本實體菜單大圖"
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[72vh] object-contain rounded-2xl"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&h=600&q=80";
                }}
              />
            </div>
            <div className="text-center text-white/50 text-[10px] tracking-wide mt-1.5 font-sans">
              ℹ️ 此為店家真實現場照片 / 紙本實體菜單相片（點選外部任何區域即可返回）
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
