/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Restaurant } from "../types";

export const MAP_BOUNDS = {
  minLat: 24.9640,
  maxLat: 24.9720,
  minLng: 121.1890,
  maxLng: 121.1965
};

export const RESTAURANT_COORDS: Record<number, { lat: number; lng: number; area: string }> = {
  // 1-10 Basic default restaurants
  1: { lat: 24.9680, lng: 121.1923, area: "百花川區" }, // 小木屋鬆餅 (校內大草坪/百花川旁)
  2: { lat: 24.9702, lng: 121.1912, area: "後門宵夜街" },
  3: { lat: 24.9698, lng: 121.1918, area: "後門宵夜街" },
  4: { lat: 24.9704, lng: 121.1910, area: "後門宵夜街" },
  5: { lat: 24.9694, lng: 121.1920, area: "後門宵夜街" },
  6: { lat: 24.9655, lng: 121.1922, area: "松苑食堂" },     // 松苑排骨飯便當 (校內松苑美食廣場)
  7: { lat: 24.9688, lng: 121.1922, area: "後門宵夜街" },
  8: { lat: 24.9692, lng: 121.1917, area: "後門宵夜街" },
  9: { lat: 24.9696, lng: 121.1916, area: "後門宵夜街" },
  10: { lat: 24.9669, lng: 121.1944, area: "女14舍區" },    // 中大綠園素食閣 (女14舍地下美食街)

  // 11-16 On-campus restaurant additions (NCU Core Landmarks)
  11: { lat: 24.9658, lng: 121.1928, area: "松苑食堂" },    // 松果餐廳 Pine Cone (松平樓)
  12: { lat: 24.9654, lng: 121.1924, area: "松苑食堂" },    // LALA Kitchen (松苑餐廳旁)
  13: { lat: 24.9687, lng: 121.1916, area: "百花川區" },    // Shine Mood 鬆餅店 (志道樓旁)
  14: { lat: 24.9656, lng: 121.1920, area: "松苑食堂" },    // 中大松園餐廳 Louisa/BK 
  15: { lat: 24.9656, lng: 121.1932, area: "松苑食堂" },    // 灶蒲家火山丼 (九村宿舍食堂)
  16: { lat: 24.9681, lng: 121.1942, area: "百花川區" },    // 咖啡研究社 (活動中心)

  // 17-39 Off-campus / Late-Night street restaurants (clustered along streets outside Western Back Gate)
  17: { lat: 24.9705, lng: 121.1914, area: "後門宵夜街" },
  18: { lat: 24.9701, lng: 121.1908, area: "後門宵夜街" },
  19: { lat: 24.9703, lng: 121.1906, area: "後門宵夜街" },
  20: { lat: 24.9702, lng: 121.1909, area: "後門宵夜街" },
  21: { lat: 24.9697, lng: 121.1919, area: "後門宵夜街" },
  22: { lat: 24.9695, lng: 121.1918, area: "後門宵夜街" },
  23: { lat: 24.9700, lng: 121.1907, area: "後門宵夜街" },
  24: { lat: 24.9703, lng: 121.1911, area: "後門宵夜街" },
  25: { lat: 24.9693, lng: 121.1917, area: "後門宵夜街" },
  26: { lat: 24.9689, lng: 121.1921, area: "後門宵夜街" },
  27: { lat: 24.9700, lng: 121.1905, area: "後門宵夜街" },
  28: { lat: 24.9706, lng: 121.1915, area: "後門宵夜街" },
  29: { lat: 24.9701, lng: 121.1903, area: "後門宵夜街" },
  30: { lat: 24.9707, lng: 121.1913, area: "後門宵夜街" },
  31: { lat: 24.9705, lng: 121.1930, area: "後門宵夜街" },
  32: { lat: 24.9704, lng: 121.1901, area: "後門宵夜街" },
  33: { lat: 24.9699, lng: 121.1912, area: "後門宵夜街" },
  34: { lat: 24.9702, lng: 121.1905, area: "後門宵夜街" },
  35: { lat: 24.9701, lng: 121.1910, area: "後門宵夜街" },
  36: { lat: 24.9695, lng: 121.1915, area: "後門宵夜街" },
  37: { lat: 24.9700, lng: 121.1902, area: "後門宵夜街" },
  38: { lat: 24.9703, lng: 121.1907, area: "後門宵夜街" },
  39: { lat: 24.9698, lng: 121.1911, area: "後門宵夜街" }
};

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // in meters
}

export function getMapCoords(lat: number, lng: number) {
  const dLat = MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat;
  const dLng = MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng;
  const x = ((lng - MAP_BOUNDS.minLng) / dLng) * 100;
  const y = (1 - (lat - MAP_BOUNDS.minLat) / dLat) * 100; // coordinate screen is Y-down
  return { x, y };
}

export function getRestaurantCoords(restaurant: Restaurant): { lat: number; lng: number } {
  if (restaurant.latitude && restaurant.longitude) {
    return { lat: restaurant.latitude, lng: restaurant.longitude };
  }
  const hardcoded = RESTAURANT_COORDS[restaurant.restaurant_id];
  if (hardcoded) {
    return { lat: hardcoded.lat, lng: hardcoded.lng };
  }
  
  // Deterministic fallbacks to place custom/dynamic submissions in the correct sub-areas
  const area = getRestaurantArea(restaurant.restaurant_id, restaurant.location_desc);
  const seed = restaurant.restaurant_id * 12345;
  const spreadLat = ((seed % 101) - 50) * 0.00002;
  const spreadLng = ((seed % 107) - 53) * 0.000018;

  if (area === "後門宵夜街") {
    return { lat: 24.9699 + spreadLat, lng: 121.1912 + spreadLng };
  } else if (area === "松苑食堂") {
    return { lat: 24.9655 + spreadLat, lng: 121.1922 + spreadLng };
  } else if (area === "女14舍區") {
    return { lat: 24.9669 + spreadLat, lng: 121.1944 + spreadLng };
  } else if (area === "百花川區") {
    return { lat: 24.9682 + spreadLat, lng: 121.1924 + spreadLng };
  } else {
    // default (e.g. front gate or campus circle area)
    return { lat: 24.9681 + spreadLat, lng: 121.1935 + spreadLng };
  }
}

export function getRestaurantArea(restaurantId: number, locationDesc: string): string {
  const areaMap: Record<number, string> = {
    1: "百花川區",
    2: "後門宵夜街",
    3: "後門宵夜街",
    4: "後門宵夜街",
    5: "後門宵夜街",
    6: "松苑食堂",
    7: "後門宵夜街",
    8: "後門宵夜街",
    9: "後門宵夜街",
    10: "女14舍區",
    11: "松苑食堂",
    12: "松苑食堂",
    13: "百花川區",
    14: "松苑食堂",
    15: "松苑食堂",
    16: "百花川區"
  };
  
  if (areaMap[restaurantId]) return areaMap[restaurantId];
  if (locationDesc.includes("百花川") || locationDesc.includes("志道樓") || locationDesc.includes("大草坪")) return "百花川區";
  if (locationDesc.includes("後門") || locationDesc.includes("宵夜") || locationDesc.includes("五興路") || locationDesc.includes("中央路") || locationDesc.includes("武興路")) return "後門宵夜街";
  if (locationDesc.includes("女十四") || locationDesc.includes("女14")) return "女14舍區";
  if (locationDesc.includes("松苑") || locationDesc.includes("松果") || locationDesc.includes("松平") || locationDesc.includes("九村") || locationDesc.includes("研一")) return "松苑食堂";
  return "校外周邊";
}

export function getDishImageUrl(itemName: string): string {
  const name = itemName || "";
  
  if (name.includes("鬆餅") || name.includes("松餅") || name.includes("Waffle")) {
    return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("拉麵") || name.includes("Ramen")) {
    return "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("牛肉麵") || name.includes("紅燒牛肉")) {
    return "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("乾麵") || name.includes("拌麵") || name.includes("肉燥麵") || name.includes("汕頭乾麵") || name.includes("榨菜肉絲")) {
    return "https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("義大利麵") || name.includes("培根麵") || name.includes("Pasta")) {
    return "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("湯包") || name.includes("小籠包") || name.includes("小籠湯包")) {
    return "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("水餃") || name.includes("蒸餃") || name.includes("餃子") || name.includes("鍋貼")) {
    return "https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("抄手") || name.includes("餛飩") || name.includes("扁食")) {
    return "https://images.unsplash.com/photo-1626201026410-b98a0bd0fc7e?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("燒臘") || name.includes("三寶") || name.includes("叉燒") || name.includes("烤鴨") || name.includes("油雞") || name.includes("燒肉")) {
    return "https://images.unsplash.com/photo-1583032015879-e50250913c90?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("滷肉飯") || name.includes("肉燥飯") || name.includes("爌肉飯") || name.includes("控肉飯")) {
    return "https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("排骨") || name.includes("炸排骨") || name.includes("排骨便當")) {
    return "https://images.unsplash.com/photo-1614956108154-b631e51e7fb2?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("雞腿") || name.includes("炸雞腿") || name.includes("烤雞腿")) {
    return "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("咖哩") || name.includes("Curry")) {
    return "https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("火鍋") || name.includes("小火鍋") || name.includes("鍋")) {
    return "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("刺身") || name.includes("生魚片") || name.includes("握壽司") || name.includes("壽司") || name.includes("丼飯") || name.includes("火山丼")) {
    return "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("蛋餅") || name.includes("起司蛋餅")) {
    return "https://images.unsplash.com/photo-1518492104633-130d0cc84637?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("三明治") || name.includes("土司") || name.includes("吐司")) {
    return "https://images.unsplash.com/photo-1509722747041-616f39b57569?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("漢堡") || name.includes("Burger")) {
    return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("沙拉") || name.includes("生菜") || name.includes("素") || name.includes("蔬食") || name.includes("健康餐")) {
    return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("炸雞") || name.includes("鹹酥雞") || name.includes("雞排") || name.includes("炸物")) {
    return "https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("厚片") || name.includes("紅豆餅") || name.includes("車輪餅") || name.includes("雞蛋糕") || name.includes("甜點") || name.includes("鬆餅") || name.includes("豆花") || name.includes("冰")) {
    return "https://images.unsplash.com/photo-1517433456452-f9633a875f6f?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("紅茶") || name.includes("綠茶") || name.includes("拿鐵") || name.includes("茶") || name.includes("咖啡") || name.includes("奶茶") || name.includes("手搖") || name.includes("美式")) {
    return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=300&h=200&q=80";
  }
  if (name.includes("酸辣湯") || name.includes("貢丸湯") || name.includes("味噌湯") || name.includes("湯")) {
    return "https://images.unsplash.com/photo-1547592165-e1d17fed6006?auto=format&fit=crop&w=300&h=200&q=80";
  }

  // Fallback default delicious food image
  return "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=300&h=200&q=80";
}
