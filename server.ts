/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { Restaurant, MenuItem, GroupRoom, User, UserHistory, UserReport, UserFoodHistory } from "./src/types";
import { INITIAL_RESTAURANTS, INITIAL_MENU_ITEMS } from "./src/restaurantsData";
import { getDishImageUrl } from "./src/utils/mapUtils";
import cron from "node-cron";
import { initializeApp } from "firebase/app";
import { initializeFirestore, getFirestore, collection, doc, setDoc } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

// Fix Node dns resolution issue on some environments
dns.setDefaultResultOrder("ipv4first");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "20mb" }));

// Coords & Geographic Subdivisions (Bucketing) for National Central University (NCU)
const RESTAURANT_COORDS: Record<number, { lat: number; lng: number; area: string }> = {
  1: { lat: 24.9680, lng: 121.1932, area: "百花川區" },
  2: { lat: 24.9702, lng: 121.1912, area: "後門宵夜街" },
  3: { lat: 24.9698, lng: 121.1918, area: "後門宵夜街" },
  4: { lat: 24.9704, lng: 121.1910, area: "後門宵夜街" },
  5: { lat: 24.9694, lng: 121.1920, area: "後門宵夜街" },
  6: { lat: 24.9678, lng: 121.1911, area: "松苑食堂" },
  7: { lat: 24.9688, lng: 121.1922, area: "後門宵夜街" },
  8: { lat: 24.9692, lng: 121.1917, area: "後門宵夜街" },
  9: { lat: 24.9696, lng: 121.1916, area: "後門宵夜街" },
  10: { lat: 24.9669, lng: 121.1944, area: "女14舍區" }
};

// Low-power Haversine Distance helper
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // meters
}

// In-Memory Databases loaded with seed data
let restaurants: Restaurant[] = INITIAL_RESTAURANTS.map(r => {
  if (!r.img_url) {
    return { ...r, img_url: getRestaurantImageUrl(r.restaurant_id, r.category, r.name) };
  }
  return r;
});
let menuItems: MenuItem[] = INITIAL_MENU_ITEMS.map(m => {
  if (!m.img_url) {
    return { ...m, img_url: getDishImageUrl(m.item_name) };
  }
  return m;
});
let users: Record<string, User> = {
  "default_user": {
    user_id: "default_user",
    username: "中大美食小幫手",
    preference_tags: ["重口味", "熱食", "高CP值", "宵夜類"],
    blacklist_rest_ids: [],
    blacklist_ingredients: ["香菜"],
    blacklist_categories: [],
    blacklist_meals: []
  }
};
let userHistory: UserHistory[] = [];
let userFoodHistory: UserFoodHistory[] = [];
let groupRooms: Record<string, GroupRoom> = {};
let userReports: UserReport[] = [];

// Exposure Balancing System pools (Track impressions & acceptances)
let impressionCounts: Record<number, number> = {};
let acceptanceCounts: Record<number, number> = {};

// Lazy load Google GenAI Core
let aiClient: GoogleGenAI | null = null;
let aiRateLimitUntil: number = 0;

function getGeminiClient(): GoogleGenAI | null {
  if (Date.now() < aiRateLimitUntil) {
    return null; // Circuit break during rate limit
  }
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY") {
      try {
        aiClient = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });
        console.log("Gemini API initiated successfully with aistudio-build User-Agent.");
      } catch (err) {
        console.error("Failed to initialize GoogleGenAI client:", err);
      }
    } else {
      console.warn("GEMINI_API_KEY not found in env variables or remains at default placeholder. Dynamic AI calls will fall back to smart rule-based logic.");
    }
  }
  return aiClient;
}


// REST API Endpoints

// Zero-Leak Google Places Photo & Cache Proxy
app.get("/api/places-photo", async (req, res) => {
  const photoName = req.query.name as string;
  const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || process.env.GOOGLE_MAPS_API_KEY || firebaseConfig.apiKey || "";

  if (!photoName) {
    return res.status(400).send("Photo name is required");
  }
  
  if (!apiKey || apiKey === "YOUR_API_KEY") {
    // Elegant Unsplash redirection if no key
    return res.redirect("https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&h=350&q=80");
  }

  try {
    const googlePhotoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`;
    const response = await fetch(googlePhotoUrl);
    if (!response.ok) {
      throw new Error(`Google photo API returned status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.warn(`[Places Photo Proxy Error]: ${err.message || err}. Flowing fallback.`);
    res.redirect("https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&h=350&q=80");
  }
});

// Full-Stack Google & AI Diagnostics endpoint
app.get("/api/diagnostics", (req, res) => {
  const mapsKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const hasMapsKey = !!mapsKey && mapsKey !== "YOUR_API_KEY";
  const mapsKeySource = process.env.GOOGLE_MAPS_PLATFORM_KEY 
    ? "GOOGLE_MAPS_PLATFORM_KEY (環境變數)" 
    : process.env.GOOGLE_MAPS_API_KEY 
    ? "GOOGLE_MAPS_API_KEY (系統變數)" 
    : "無 (採用 Fallback NCU 預載核心資料)";
    
  const hasGeminiKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY";
  const hasFirebaseKey = !!firebaseConfig.apiKey;

  res.json({
    mapsKeyConfigured: hasMapsKey,
    mapsKeySource: mapsKeySource,
    geminiKeyConfigured: hasGeminiKey,
    firebaseKeyConfigured: hasFirebaseKey,
    environmentFallbackActive: !hasMapsKey
  });
});

// 1. Get List of Restaurants with Filters
app.get("/api/restaurants", (req, res) => {
  const { category, min_rating, max_distance, only_open, has_ac, is_vegetarian, is_midnight_snack } = req.query;
  
  let filtered = [...restaurants];
  
  if (category) {
    filtered = filtered.filter(r => r.category === category);
  }
  if (min_rating) {
    filtered = filtered.filter(r => r.rating >= parseFloat(min_rating as string));
  }
  if (max_distance) {
    filtered = filtered.filter(r => r.walking_distance <= parseInt(max_distance as string));
  }
  if (only_open === "true") {
    filtered = filtered.filter(r => r.is_open);
  }
  if (has_ac === "true") {
    filtered = filtered.filter(r => r.has_ac);
  }
  if (is_vegetarian === "true") {
    filtered = filtered.filter(r => r.is_vegetarian);
  }
  if (is_midnight_snack === "true") {
    filtered = filtered.filter(r => r.is_midnight_snack);
  }
  
  res.json(filtered);
});

// 2. Add/Edit Restaurant
app.post("/api/restaurants", (req, res) => {
  const restData = req.body;
  if (!restData.name || !restData.category) {
    return res.status(400).json({ error: "Restaurant name and category are required." });
  }

  const existingIndex = restaurants.findIndex(r => r.restaurant_id === restData.restaurant_id);
  if (existingIndex >= 0) {
    restaurants[existingIndex] = { ...restaurants[existingIndex], ...restData };
    res.json(restaurants[existingIndex]);
  } else {
    const newId = restaurants.length > 0 ? Math.max(...restaurants.map(r => r.restaurant_id)) + 1 : 1;
    const newRest: Restaurant = {
      restaurant_id: newId,
      name: restData.name,
      category: restData.category,
      walking_distance: Number(restData.walking_distance) || 5,
      rating: Number(restData.rating) || 4.0,
      popularity: Number(restData.popularity) || 50,
      avg_price: Number(restData.avg_price) || 100,
      is_open: restData.is_open !== undefined ? restData.is_open : true,
      is_group_friendly: restData.is_group_friendly || false,
      has_ac: restData.has_ac || false,
      has_seats: restData.has_seats || false,
      is_vegetarian: restData.is_vegetarian || false,
      has_takeout: restData.has_takeout || false,
      is_midnight_snack: restData.is_midnight_snack || false,
      img_url: restData.img_url || "",
      location_desc: restData.location_desc || "校外周邊",
      signature_dishes: restData.signature_dishes || [],
    };
    restaurants.push(newRest);
    res.json(newRest);
  }
});

// 3. Get Menu Items of specific Restaurant
app.get("/api/restaurants/:id/menu", (req, res) => {
  const restId = parseInt(req.params.id);
  let items = menuItems.filter(item => item.restaurant_id === restId);
  
  if (items.length === 0) {
    // Dynamically generate menu items for this restaurant to ensure it has a menu!
    const rest = restaurants.find(r => r.restaurant_id === restId);
    if (rest) {
      const category = rest.category || "飯";
      const googlePhotos = (rest as any).google_photos || [];
      
      let baseDishes = ["精選招牌料理", "人氣熱門特餐", "主廚推薦例湯"];
      if (category === "早餐") {
        baseDishes = ["經典起司蛋餅", "起司肉排三明治", "經典鮮奶茶"];
      } else if (category === "飲料") {
        baseDishes = ["珍珠鮮奶茶", "招牌經典拿鐵", "香醇四季青茶"];
      } else if (category === "麵食") {
        baseDishes = ["招牌川味牛肉麵", "經典炸醬乾麵", "鮮肉手工水餃 (10顆)"];
      } else if (category === "點心") {
        baseDishes = ["經典蜂蜜鬆餅", "香濃巧克力厚片", "原味脆皮雞蛋糕"];
      } else if (category === "鍋物") {
        baseDishes = ["招牌大腸臭臭鍋", "特濃牛奶起司鍋", "川味麻辣牛肉鍋"];
      } else if (category === "蔬食.素食") {
        baseDishes = ["什錦養生蔬食飯", "香乾大碗拌麵", "田園蔬果冷沙拉"];
      } else if (category === "飯") {
        baseDishes = ["古早味炸排骨飯", "日式厚切豬排丼", "香濃咖哩雞肉飯"];
      }
      
      const spawned = baseDishes.map((dish, idx) => {
        let dishImg = "";
        // Use Google photos if available, skipping the first one (used as cover)
        if (googlePhotos.length > idx + 1) {
          dishImg = googlePhotos[idx + 1];
        } else {
          dishImg = getDishImageUrl(dish);
        }
        
        return {
          menu_id: restId * 100 + idx,
          restaurant_id: restId,
          item_name: dish,
          price: 55 + (idx * 25) + (restId % 11),
          spicy_level: (idx === 2 && category === "麵食") ? "中辣" : "無辣",
          popularity_score: 8.2 + (idx * 0.5),
          tags: idx === 0 ? ["店內熱門"] : idx === 1 ? ["招牌推薦"] : ["主廚特製"],
          ingredients: idx === 0 ? ["本店特選主材"] : ["秘製香料醬"],
          img_url: dishImg,
          size_desc: "一人份"
        };
      });
      
      // Save to memory cache so subsequent queries are stable and allow admin editing
      menuItems.push(...(spawned as any));
      items = spawned as any;
    }
  }
  
  // Ensure every returned item has a premium img_url assigned
  const processedItems = items.map(item => {
    if (!item.img_url) {
      return {
        ...item,
        img_url: getDishImageUrl(item.item_name)
      };
    }
    return item;
  });
  
  res.json(processedItems);
});

// 4. Update/Add Menu Item
app.post("/api/restaurants/:id/menu", (req, res) => {
  const restId = parseInt(req.params.id);
  const mealData = req.body;
  if (!mealData.item_name || !mealData.price) {
    return res.status(400).json({ error: "Item name and price are required." });
  }

  const existingIndex = menuItems.findIndex(m => m.menu_id === mealData.menu_id);
  if (existingIndex >= 0) {
    menuItems[existingIndex] = { ...menuItems[existingIndex], ...mealData, restaurant_id: restId };
    res.json(menuItems[existingIndex]);
  } else {
    const newId = menuItems.length > 0 ? Math.max(...menuItems.map(m => m.menu_id)) + 1 : 1001;
    const newMeal: MenuItem = {
      menu_id: newId,
      restaurant_id: restId,
      item_name: mealData.item_name,
      price: Number(mealData.price),
      spicy_level: mealData.spicy_level || "無辣",
      popularity_score: Number(mealData.popularity_score) || 5,
      tags: mealData.tags || [],
      ingredients: mealData.ingredients || [],
      size_desc: mealData.size_desc || "一人份"
    };
    menuItems.push(newMeal);
    res.json(newMeal);
  }
});

// 5. Submit User Update Report (歇業, menu_update, price_update)
app.post("/api/reports", (req, res) => {
  const { restaurant_id, report_type, details } = req.body;
  const rest = restaurants.find(r => r.restaurant_id === restaurant_id);
  if (!rest) {
    return res.status(404).json({ error: "Restaurant not found." });
  }

  const newReport: UserReport = {
    report_id: Math.random().toString(36).substring(2, 9),
    restaurant_id,
    restaurant_name: rest.name,
    report_type,
    details,
    timestamp: new Date().toISOString(),
    status: "pending"
  };
  
  userReports.push(newReport);

  // If report is "closed", we dynamically disable restaurants for realism!
  if (report_type === "closed") {
    rest.is_open = false;
  }

  res.json({ success: true, report: newReport, alert: `感謝回報！${rest.name}的即時狀態已同步更新。` });
});

app.get("/api/reports", (req, res) => {
  res.json(userReports);
});

// Resolve Report (Store updates)
app.post("/api/reports/:id/resolve", (req, res) => {
  const report = userReports.find(r => r.report_id === req.params.id);
  if (report) {
    report.status = "resolved";
    res.json({ success: true, report });
  } else {
    res.status(404).json({ error: "Report not found." });
  }
});

// 6. Profile endpoints
app.post("/api/users/profile", (req, res) => {
  const { user_id, username, preference_tags, blacklist_rest_ids, blacklist_ingredients, blacklist_categories, blacklist_meals } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }

  const existingProfile = users[user_id];
  if (existingProfile) {
    users[user_id] = {
      ...existingProfile,
      username: username || existingProfile.username,
      preference_tags: preference_tags || existingProfile.preference_tags,
      blacklist_rest_ids: blacklist_rest_ids !== undefined ? blacklist_rest_ids : existingProfile.blacklist_rest_ids,
      blacklist_ingredients: blacklist_ingredients || existingProfile.blacklist_ingredients,
      blacklist_categories: blacklist_categories || existingProfile.blacklist_categories,
      blacklist_meals: blacklist_meals !== undefined ? blacklist_meals : (existingProfile.blacklist_meals || []),
    };
  } else {
    users[user_id] = {
      user_id,
      username: username || "NCU同學",
      preference_tags: preference_tags || ["熱食", "高CP值"],
      blacklist_rest_ids: blacklist_rest_ids || [],
      blacklist_ingredients: blacklist_ingredients || [],
      blacklist_categories: blacklist_categories || [],
      blacklist_meals: blacklist_meals || [],
    };
  }
  res.json(users[user_id]);
});

app.get("/api/users/:id", (req, res) => {
  const user_id = req.params.id;
  if (users[user_id]) {
    res.json({
      ...users[user_id],
      blacklist_meals: users[user_id].blacklist_meals || []
    });
  } else {
    // Return empty profile
    res.json({
      user_id,
      username: "新面孔同學",
      preference_tags: [],
      blacklist_rest_ids: [],
      blacklist_ingredients: [],
      blacklist_categories: [],
      blacklist_meals: []
    });
  }
});

// 7. Group decision room endpoints
app.post("/api/groups", (req, res) => {
  const { owner_id, owner_name } = req.body;
  const room_id = (Math.floor(Math.random() * 9000) + 1000).toString(); // 4 digit room code
  const newRoom: GroupRoom = {
    room_id,
    owner_id,
    owner_name,
    members: [{
      user_id: owner_id,
      username: owner_name,
      preference_tags: ["聚餐", "高CP值"],
      blacklist_ingredients: [],
      blacklist_categories: [],
      max_price: 300,
      max_distance: 10
    }]
  };
  groupRooms[room_id] = newRoom;
  res.json(newRoom);
});

app.get("/api/groups/:roomId", (req, res) => {
  const room = groupRooms[req.params.roomId];
  if (!room) {
    return res.status(404).json({ error: "Group room not found" });
  }
  res.json(room);
});

app.post("/api/groups/:roomId/join", (req, res) => {
  const room = groupRooms[req.params.roomId];
  if (!room) {
    return res.status(404).json({ error: "Group room not found" });
  }
  const { user_id, username, preference_tags, blacklist_ingredients, blacklist_categories, max_price, max_distance } = req.body;
  
  // Check if member already exists
  const existingIndex = room.members.findIndex(m => m.user_id === user_id);
  const member = {
    user_id,
    username,
    preference_tags: preference_tags || [],
    blacklist_ingredients: blacklist_ingredients || [],
    blacklist_categories: blacklist_categories || [],
    max_price: max_price || 250,
    max_distance: max_distance || 8
  };

  if (existingIndex >= 0) {
    room.members[existingIndex] = member;
  } else {
    room.members.push(member);
  }

  res.json(room);
});

app.post("/api/groups/:roomId/leave", (req, res) => {
  const room = groupRooms[req.params.roomId];
  if (!room) {
    return res.status(404).json({ error: "Group room not found" });
  }
  const { user_id } = req.body;
  room.members = room.members.filter(m => m.user_id !== user_id);
  res.json(room);
});

// AI Recommender core operations using @google/genai & falls-back gracefully if key is absent
app.post("/api/ai-recommend", async (req, res) => {
  const { user_id, quick_mode, advanced_filters, search_query, recent_restaurant_ids, user_location, custom_restaurants, custom_menu_items } = req.body;
  
  // Step 1: Filter raw database with standard criteria immediately:
  let finalCandidates = custom_restaurants ? [...custom_restaurants] : [...restaurants];

  // Dynamic coordinates and Haversine distance calculations
  let currentAreaBucket = "校園百花川";
  if (user_location && user_location.latitude && user_location.longitude) {
    finalCandidates.forEach(r => {
      const coord = RESTAURANT_COORDS[r.restaurant_id];
      if (coord) {
        const distMeters = haversineDistance(
          user_location.latitude,
          user_location.longitude,
          coord.lat,
          coord.lng
        );
        // Estimate walking time: 1 minute ~ 80 meters walking speed
        r.walking_distance = Math.max(1, Math.round(distMeters / 80));
      }
    });

    // Find the closest bucketed area
    let closestDist = Infinity;
    Object.keys(RESTAURANT_COORDS).forEach(key => {
      const id = Number(key);
      const coord = RESTAURANT_COORDS[id];
      const dist = haversineDistance(user_location.latitude, user_location.longitude, coord.lat, coord.lng);
      if (dist < closestDist) {
        closestDist = dist;
        currentAreaBucket = coord.area;
      }
    });
  }
  
  // Apply quick weights
  const quick = quick_mode || "";
  if (quick === "近一點") {
    finalCandidates = finalCandidates.filter(r => r.walking_distance <= 3);
  } else if (quick === "便宜") {
    finalCandidates = finalCandidates.filter(r => r.avg_price <= 90);
  } else if (quick === "熱食") {
    finalCandidates = finalCandidates.filter(r => ["飯", "麵食", "鍋物", "午餐", "晚餐", "宵夜", "蔬食.素食"].includes(r.category));
  }

  // Apply Advanced filters (Fixes the activation button bug!)
  if (advanced_filters) {
    const { category, max_price, max_distance, has_ac, is_vegetarian, is_midnight_snack } = advanced_filters;
    if (category && category !== "All") {
      finalCandidates = finalCandidates.filter(r => r.category === category);
    }
    if (max_price) {
      finalCandidates = finalCandidates.filter(r => r.avg_price <= max_price);
    }
    if (max_distance) {
      finalCandidates = finalCandidates.filter(r => r.walking_distance <= max_distance);
    }
    if (has_ac) {
      finalCandidates = finalCandidates.filter(r => r.has_ac);
    }
    if (is_vegetarian) {
      finalCandidates = finalCandidates.filter(r => r.is_vegetarian);
    }
    if (is_midnight_snack) {
      finalCandidates = finalCandidates.filter(r => r.is_midnight_snack);
    }
  }

  // Apply Search Query Keywords (Simulated Natural Language filter)
  if (search_query && search_query.trim() !== "") {
    const q = search_query.toLowerCase().trim();
    finalCandidates = finalCandidates.filter(r => 
      r.name.toLowerCase().includes(q) || 
      r.category.toLowerCase().includes(q) ||
      r.location_desc.toLowerCase().includes(q) ||
      r.signature_dishes.some(d => d.toLowerCase().includes(q))
    );
  }

  // Fallback to all restaurants if criteria filtered out every item
  if (finalCandidates.length === 0) {
    finalCandidates = [...restaurants];
  }

  // Exclude blacklist if user is logged in
  const user = users[user_id] || users["default_user"];
  if (user) {
    // Avoid restaurants blocked explicitly
    if (user.blacklist_rest_ids && user.blacklist_rest_ids.length > 0) {
      finalCandidates = finalCandidates.filter(r => !user.blacklist_rest_ids.includes(r.restaurant_id));
    }
    // Avoid categories blocked
    if (user.blacklist_categories && user.blacklist_categories.length > 0) {
      finalCandidates = finalCandidates.filter(r => !user.blacklist_categories.includes(r.category));
    }
  }

  // Prevent immediate duplicates from infinite reroll (Reroll limit protection)
  const blockedPrev = recent_restaurant_ids || [];
  let selectable = finalCandidates.filter(r => !blockedPrev.includes(r.restaurant_id));
  if (selectable.length === 0) {
    selectable = finalCandidates; // Fallback to all if everyone was rolled recently
  }

  // Implement Recommendation Percentages: Preference 70%, Discovery (探索推薦) 20%, Random 10%
  const die = Math.random();
  let selectedCategoryStrategy = "偏好推薦";
  let targetRestaurant: Restaurant;

  if (die < 0.10) {
    // 10% completely Random
    selectedCategoryStrategy = "完全隨機";
    targetRestaurant = selectable[Math.floor(Math.random() * selectable.length)];
  } else if (die < 0.30) {
    // 20% Discovery exploration - Sort in ascending order of popularity (giving lower exposures or cold-spots a chance!)
    selectedCategoryStrategy = "新店探索";
    const sortedDiscovery = [...selectable].sort((a, b) => {
      const impA = impressionCounts[a.restaurant_id] || 0;
      const impB = impressionCounts[b.restaurant_id] || 0;
      return impA - impB || a.popularity - b.popularity;
    });
    targetRestaurant = sortedDiscovery[0] || selectable[0];
  } else {
    // 70% Preference Recommendation using the Exposure Balancing Algorithm matches
    selectedCategoryStrategy = "偏好推薦";
    
    const sortedPref = [...selectable].map(r => {
      let score = r.rating * 15;
      
      // preference matches
      const userPrefs = user ? user.preference_tags : [];
      userPrefs.forEach(p => {
        if (r.signature_dishes.some(d => d.includes(p)) || r.category.includes(p)) score += 25;
        if (p === "甜食" && r.category === "點心") score += 15;
        if (p === "小吃" && r.walking_distance <= 3) score += 10;
      });

      // --- Exposure Balancing Optimization ---
      const impressions = impressionCounts[r.restaurant_id] || 0;
      const acceptances = acceptanceCounts[r.restaurant_id] || 0;
      
      score -= impressions * 12; // penalize high monopoly
      if (impressions > 0) {
        score += (acceptances / impressions) * 20; // reward high acceptance ratios
      } else {
        score += 15; // cold-spot boost to test waters!
      }

      return { restaurant: r, finalScore: score };
    }).sort((a, b) => b.finalScore - a.finalScore);

    targetRestaurant = sortedPref[0]?.restaurant || selectable[0];
  }

  if (!targetRestaurant) {
    targetRestaurant = restaurants[0];
  }

  // Register an impression for exposure balancing
  impressionCounts[targetRestaurant.restaurant_id] = (impressionCounts[targetRestaurant.restaurant_id] || 0) + 1;

  // Pre-roll a food/dish item matching this restaurant right here to achieve single-roundtrip AI recommend
  const sourceMenuItems = custom_menu_items || menuItems;
  let choices = sourceMenuItems.filter(m => m.restaurant_id === targetRestaurant.restaurant_id);
  if (choices.length === 0) {
    choices = [
      { menu_id: 12341, restaurant_id: targetRestaurant.restaurant_id, item_name: "招牌主廚炒飯", price: 85, spicy_level: "無辣", popularity_score: 8.5, tags: ["店內熱門"], ingredients: ["蛋", "米飯"] },
      { menu_id: 12342, restaurant_id: targetRestaurant.restaurant_id, item_name: "超人氣排骨大餐", price: 100, spicy_level: "無辣", popularity_score: 9.0, tags: ["高人氣"], ingredients: ["豬排肉", "配菜"] }
    ];
  }
  const blockedMeals = user && user.blacklist_meals ? user.blacklist_meals : [];
  const exclusions: string[] = user && user.blacklist_ingredients ? user.blacklist_ingredients : [];
  let filteredChoices = choices.filter(item => {
    const matchesExclusion = exclusions.some(ex => {
      const hasBadIngredient = item.ingredients.some(i => i.includes(ex));
      const nameHasEx = item.item_name.includes(ex);
      return hasBadIngredient || nameHasEx;
    });
    if (matchesExclusion) return false;

    const matchesMealBlacklist = blockedMeals.some(bm => 
      item.item_name.toLowerCase().includes(bm.toLowerCase())
    );
    if (matchesMealBlacklist) return false;

    return true;
  });

  if (filteredChoices.length === 0) {
    filteredChoices = choices;
  }
  filteredChoices.sort((a, b) => b.popularity_score - a.popularity_score);
  const preSelectedMealIndex = Math.floor(Math.random() * Math.min(filteredChoices.length, 3));
  const preSelectedMeal = filteredChoices[preSelectedMealIndex] || choices[0];

  let itemAnalysis = `【超級強推】這道「${preSelectedMeal.item_name}」是本店最熱搜的餐點，完美滿足您今天的胃袋！`;
  let dishTag = preSelectedMeal.tags[0] || "店長推薦";

  // Add details about why selected & Gemini enhancement
  let reasonStringList = [
    `今天${targetRestaurant.is_open ? "營業中" : "暫停營業"}`,
    `定位您在【${currentAreaBucket}】，步行約 ${targetRestaurant.walking_distance} 分鐘`,
    `評價 ${targetRestaurant.rating} 顆星，曝光累積數為 ${impressionCounts[targetRestaurant.restaurant_id] || 1} 次`,
    `均消 NT$ ${targetRestaurant.avg_price} 元，符合小資預算與品質平衡`
  ];

  if (quick === "近一點" && targetRestaurant.walking_distance <= 3) {
    reasonStringList.push("符合「近一點」的極速可達需求");
  }
  if (quick === "便宜" && targetRestaurant.avg_price <= 90) {
    reasonStringList.push("符合「便宜」的小資省錢需求");
  }

  let aiTasteCommentary = "今天推薦非常迎合您的胃口！我們也為您在推薦庫中進行了探索比例優化。";
  let analysisOutput = `【${selectedCategoryStrategy}】本餐推薦「${targetRestaurant.name}」。主要是因為距離近、評價高，非常適合你！`;

  // Actually invoke Gemini API if possible for high quality natural language recommendations in Traditional Chinese
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const prompt = `
      我們正在為臺灣國立中央大學 (NCU) 的學生推薦午餐/晚餐。
      
      使用者背景與篩選條件:
      - 當前所在區域: ${currentAreaBucket}
      - 快速選擇模式: ${quick}
      - 特殊搜尋字詞: ${search_query || "無"}
      - 使用者飲食人格與偏好: ${user ? user.preference_tags.join(",") : "無特別偏好"}
      - 黑名單食材排除: ${user ? user.blacklist_ingredients.join(",") : "無"}
      
      被系統抽中的目標餐廳:
      - 名稱: ${targetRestaurant.name}
      - 分類: ${targetRestaurant.category}
      - 步行時間: ${targetRestaurant.walking_distance} 分鐘
      - 評分: ${targetRestaurant.rating} / 5.0
      - 招牌餐點: ${targetRestaurant.signature_dishes.join(", ")}
      - 均消價格: ${targetRestaurant.avg_price} NTD
      - 所在位置特色: ${targetRestaurant.location_desc}

      同時，我們在該餐廳菜單中為他抽選了以下餐點 (已過濾其抗拒食材):
      - 推薦餐點品名: ${preSelectedMeal.item_name}
      - 價格: ${preSelectedMeal.price} NTD
      - 特色與標籤: ${preSelectedMeal.tags.join(", ") || "無"}
      - 辣度: ${preSelectedMeal.spicy_level}
      - 食材配方: ${preSelectedMeal.ingredients.join(", ")}
      
      請依據上述資訊，使用繁體中文學生與Dcard美食板幽默、親切語氣生成一份整合式的推薦。
      輸出內容必須依照 JSON 格式，其 responseMimeType 為 "application/json"，結構 schema 如下:
      {
        "recommendation_reason": "結合被抽中之餐廳與步行時間等指標生成的 3-4 點簡短理由（不可有 markdown 點符號，不超過30字/點）的陣列",
        "ai_analysis": "一段親切、幽默的餐廳決策推薦總結（50字內），描述為什麼適合今天去這餐飲商家",
        "taste_commentary": "對使用者飲食人格 (Taste Profile) 的最新雷達回饋分析（50字內，例如：'你似乎在下雨天特別想念暖胃湯麵，建議來一份熱呼呼的美食！'）",
        "meal_tag": "一個極具創意的本餐推薦點評特徵標籤（5字內，例如：'肉控狂喜'、'小資首選'、'香氣爆發'）",
        "meal_analysis": "一兩句吃貨對當前抽出之「${preSelectedMeal.item_name}」的點評（45字內，指出這道菜如何巧妙避開不吃食材且口味極佳，具有台灣Dcard美食板風格）"
      }
      `;

      const response = await gemini.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recommendation_reason: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              ai_analysis: { type: Type.STRING },
              taste_commentary: { type: Type.STRING },
              meal_tag: { type: Type.STRING },
              meal_analysis: { type: Type.STRING }
            },
            required: ["recommendation_reason", "ai_analysis", "taste_commentary", "meal_tag", "meal_analysis"]
          }
        }
      });

      if (response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (parsed.recommendation_reason && parsed.recommendation_reason.length > 0) {
          reasonStringList = parsed.recommendation_reason;
        }
        if (parsed.ai_analysis) {
          analysisOutput = parsed.ai_analysis;
        }
        if (parsed.taste_commentary) {
          aiTasteCommentary = parsed.taste_commentary;
        }
        if (parsed.meal_tag) {
          dishTag = parsed.meal_tag;
        }
        if (parsed.meal_analysis) {
          itemAnalysis = parsed.meal_analysis;
        }
      }
    } catch (err: any) {
      if (err?.status === 429 || err?.message?.includes("429")) {
        console.warn("Gemini rate limit exceeded. Using local fallback rules. Halting for 35 seconds...");
        aiRateLimitUntil = Date.now() + 35000;
      } else {
        console.warn("Gemini compilation request failed, invoking fallback prompt generator:", err.message || err);
      }
    }
  }

  // Record action inside user history database
  const histItem: UserHistory = {
    history_id: Math.random().toString(36).substring(2, 9),
    user_id: user ? user.user_id : "guest",
    restaurant_id: targetRestaurant.restaurant_id,
    accepted: false, // Default false, flips to true on confirm selection interaction
    timestamp: new Date().toISOString(),
    recommend_reason: analysisOutput
  };
  userHistory.push(histItem);

  res.json({
    restaurant: targetRestaurant,
    strategy: selectedCategoryStrategy,
    reasons: reasonStringList,
    ai_summary: analysisOutput,
    taste_profile_update: aiTasteCommentary,
    recent_restaurant_ids: [...blockedPrev, targetRestaurant.restaurant_id].slice(-5), // maintain last 5 rolled to avoid loops
    rolled_dish: {
      meal: preSelectedMeal,
      tag: dishTag,
      analysis: itemAnalysis
    }
  });
});

// AI Meal / MenuItem Smart Recommender
app.post("/api/ai-roll-food", async (req, res) => {
  const { restaurant_id, user_id, excluded_ingredients, custom_restaurants, custom_menu_items } = req.body;
  
  const sourceRestaurants = custom_restaurants || restaurants;
  const rest = sourceRestaurants.find(r => r.restaurant_id === restaurant_id);
  if (!rest) {
    return res.status(404).json({ error: "Restaurant not found." });
  }

  // Load menu items
  const sourceMenuItems = custom_menu_items || menuItems;
  let choices = sourceMenuItems.filter(m => m.restaurant_id === restaurant_id);
  if (choices.length === 0) {
    // If no menu exists, make a mock list
    choices = [
      { menu_id: 12341, restaurant_id, item_name: "招牌主廚炒飯", price: 85, spicy_level: "無辣", popularity_score: 8.5, tags: ["店內熱門"], ingredients: ["蛋", "米飯"] },
      { menu_id: 12342, restaurant_id, item_name: "超人氣排骨大餐", price: 100, spicy_level: "無辣", popularity_score: 9.0, tags: ["高人氣"], ingredients: ["豬排肉", "配菜"] }
    ];
  }

  // Look up user's blacklisted meals
  const user = users[user_id] || users["default_user"];
  const blockedMeals = user && user.blacklist_meals ? user.blacklist_meals : [];

  // Filter exclusions (coriander/香菜, beef/牛肉, seafood/海鮮, chili/辣椒)
  const exclusions: string[] = excluded_ingredients || [];
  let filteredChoices = choices.filter(item => {
    // 1. Check ingredients & name exclusions
    const matchesExclusion = exclusions.some(ex => {
      const hasBadIngredient = item.ingredients.some(i => i.includes(ex));
      const nameHasEx = item.item_name.includes(ex);
      return hasBadIngredient || nameHasEx;
    });
    if (matchesExclusion) return false;

    // 2. Check customized meal blacklist
    const matchesMealBlacklist = blockedMeals.some(bm => 
      item.item_name.toLowerCase().includes(bm.toLowerCase())
    );
    if (matchesMealBlacklist) return false;

    return true;
  });

  if (filteredChoices.length === 0) {
    filteredChoices = choices; // Fallback to all menu if too strict
  }

  // Roll randomly with weight to popularity_score
  filteredChoices.sort((a,b) => b.popularity_score - a.popularity_score);
  // Pick from top choices with some light variance
  const targetMealIndex = Math.floor(Math.random() * Math.min(filteredChoices.length, 3));
  const targetMeal = filteredChoices[targetMealIndex] || choices[0];

  // Default localized summary
  let itemAnalysis = `【強烈推薦】這道「${targetMeal.item_name}」是本店人氣首選，配料實在且完全避開了您所抗拒的食材！`;
  let dishTag = targetMeal.tags[0] || "店長推薦";

  // Trigger Gemini to analyze and add funny NCU student review line
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const prompt = `
      現在我們來到了一家 NCU 附近的餐廳「${rest.name}」。
      我們在菜單上抽取了這一道餐點給飢腸轆轆的中大同學:
      - 品名: ${targetMeal.item_name}
      - 價格: ${targetMeal.price} NTD
      - 特色與標籤: ${targetMeal.tags.join(", ")}
      - 辣度: ${targetMeal.spicy_level}
      - 食材配方: ${targetMeal.ingredients.join(", ")}
      - 同學希望避避開的食材: ${exclusions.join(", ") || "無"}

      請以極幽默親民的繁體中文學生語氣幫該菜色做出一段推薦分析！
      輸出格式必須為 JSON，responseMimeType 欄位為 "application/json"。其格式:
      {
        "meal_tag": "一個極具創意的推薦小標籤（5字內，例如：'隱藏菜單'、'小資首選'、'香氣爆發'）",
        "meal_analysis": "一兩句吃貨點評推薦語（45字內，指出這道菜如何巧妙避開不吃食材且口感出色，具有台灣網紅或Dcard美食板風格）"
      }
      `;

      const response = await gemini.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              meal_tag: { type: Type.STRING },
              meal_analysis: { type: Type.STRING }
            },
            required: ["meal_tag", "meal_analysis"]
          }
        }
      });

      if (response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (parsed.meal_tag) dishTag = parsed.meal_tag;
        if (parsed.meal_analysis) itemAnalysis = parsed.meal_analysis;
      }
    } catch (err: any) {
      if (err?.status === 429 || err?.message?.includes("429")) {
        console.warn("Gemini rate limit exceeded (food item review). Using local fallback.");
        aiRateLimitUntil = Date.now() + 35000;
      } else {
        console.warn("Failed to get food item review from Gemini:", err.message || err);
      }
    }
  }

  res.json({
    meal: targetMeal,
    tag: dishTag,
    analysis: itemAnalysis
  });
});

// Group decision Intersection algorithm with dynamic fallback
app.post("/api/groups/:roomId/decision", async (req, res) => {
  const room = req.body.room || groupRooms[req.params.roomId];
  if (!room) {
    return res.status(404).json({ error: "Group room not found" });
  }

  if (room.members.length === 0) {
    return res.status(400).json({ error: "Room has no active members to analyze." });
  }

  const sourceRestaurants = req.body.custom_restaurants || restaurants;
  const sourceMenuItems = req.body.custom_menu_items || menuItems;

  // Perform client-server group intersection logic:
  // Collect constraints
  const blacklistedCategories = Array.from(new Set(room.members.flatMap(m => m.blacklist_categories || [])));
  const blacklistedIngredients = Array.from(new Set(room.members.flatMap(m => m.blacklist_ingredients || [])));
  const maxAcceptablePrice = Math.min(...room.members.map(m => m.max_price));
  const maxAcceptableDistance = Math.max(...room.members.map(m => m.max_distance));
  const groupPreferences = Array.from(new Set(room.members.flatMap(m => m.preference_tags || [])));

  // Filter restaurants that fit budget, distance, category blacklist:
  let eligible = sourceRestaurants.filter(r => {
    if (r.avg_price > maxAcceptablePrice) return false;
    if (r.walking_distance > maxAcceptableDistance) return false;
    if (blacklistedCategories.includes(r.category)) return false;
    return true;
  });

  if (eligible.length === 0) {
    eligible = [...sourceRestaurants]; // fallback if constraints are completely impossible to overlap
  }

  // Rate them according to group preferences intersections:
  const ranked = eligible.map(r => {
    let intersectionPoints = 0;
    groupPreferences.forEach(p => {
      if (r.signature_dishes.some(d => d.includes(p)) || r.category.includes(p)) {
        intersectionPoints += 5;
      }
    });
    const finalScore = (r.rating * 10) + (r.popularity * 0.2) + intersectionPoints;
    return { restaurant: r, score: finalScore };
  }).sort((a,b) => b.score - a.score);

  const bestRestaurant = ranked[0]?.restaurant || sourceRestaurants[0];

  // Pick a food item from menu that avoids forbidden items for everyone
  let meals = sourceMenuItems.filter(m => m.restaurant_id === bestRestaurant.restaurant_id);
  if (meals.length === 0) meals = [{ menu_id: 9999, restaurant_id: bestRestaurant.restaurant_id, item_name: "店內招牌分享餐", price: 180, spicy_level: "無辣", popularity_score: 9.0, tags: ["聚會精選"], ingredients: [] }];

  const safeMeals = meals.filter(m => {
    return !blacklistedIngredients.some(bi => {
      return m.ingredients.some(ing => ing.includes(bi)) || m.item_name.includes(bi);
    });
  });

  const targetMeal = safeMeals[0] || meals[0];

  // Create an AI group compilation report text
  let groupConsensusRating = "85%";
  let sharedMealTag = "聚餐強推";
  let consensusIntro = "經過分析，大家共同偏好聚會氛圍與中等預算。此餐廳在座位空間與食物多樣性上為最大交集！";

  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const prompt = `
      我們正在進行多名 NCU 大學生的「群組美食決策 (Group Decision)」。
      
      群組成員人數: ${room.members.length} 人 (發起人: ${room.owner_name})
      群組成員名稱: ${room.members.map(m => m.username).join(", ")}
      
      群組共同約束條件:
      - 最高可接受之均消價格: ${maxAcceptablePrice} NTD
      - 最大可接受步行距離: ${maxAcceptableDistance} 分鐘以外
      - 群組內需避開的食材黑名單: ${blacklistedIngredients.join(", ") || "無"}
      - 大家輸入的愛好標記: ${groupPreferences.join(", ") || "無"}
      
      系統算出的最佳最大化交集餐廳:
      - 餐廳店名: ${bestRestaurant.name}
      - 均消: ${bestRestaurant.avg_price} NTD
      - 提供的主要聚餐餐點: ${targetMeal.item_name}
      
      請依據上述的眾人交集偏好、黑名單 constraints、與推薦餐廳餐點。
      在繁體中文下，生成一個 AI 解析報告。
      輸出格式為 JSON，其 responseMimeType 為 "application/json"，schema 結構:
      {
        "consensus_percentage": "最大共識契合度百分比字串 (例如：'92%')",
        "consensus_rationale": "一段流暢親民的共識評估文（60字內，解釋這家店如何完美調和大家的預算與口味偏好）",
        "meal_tag": "一個群組共享餐特有的小紅標籤（5字內，例如：'大豐收'、'眾人心願'、'安心聚餐'）"
      }
      `;

      const response = await gemini.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              consensus_percentage: { type: Type.STRING },
              consensus_rationale: { type: Type.STRING },
              meal_tag: { type: Type.STRING }
            },
            required: ["consensus_percentage", "consensus_rationale", "meal_tag"]
          }
        }
      });

      if (response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (parsed.consensus_percentage) groupConsensusRating = parsed.consensus_percentage;
        if (parsed.consensus_rationale) consensusIntro = parsed.consensus_rationale;
        if (parsed.meal_tag) sharedMealTag = parsed.meal_tag;
      }
    } catch (err: any) {
      if (err?.status === 429 || err?.message?.includes("429")) {
        console.warn("Gemini rate limit exceeded (group decision). Using local fallback.");
        aiRateLimitUntil = Date.now() + 35000;
      } else {
        console.warn("Failed to generate group decision summary with Gemini:", err.message || err);
      }
    }
  }

  res.json({
    room_id: room.room_id,
    consensus_percentage: groupConsensusRating,
    rationale: consensusIntro,
    restaurant: bestRestaurant,
    shared_meal: targetMeal,
    shared_meal_tag: sharedMealTag,
    all_eligible_count: eligible.length,
    intersections: {
      budget_cap: maxAcceptablePrice,
      distance_cap: maxAcceptableDistance,
      warning_ingredients: blacklistedIngredients,
      common_tags: groupPreferences,
      members_count: room.members.length
    }
  });
});


// Capture user accepted selections to reinforce dynamic weight and taste profiles
app.post("/api/history/accept", (req, res) => {
  const { user_id, restaurant_id, menu_id } = req.body;
  
  if (restaurant_id) {
    const rId = Number(restaurant_id);
    if (!acceptanceCounts[rId]) {
      acceptanceCounts[rId] = 0;
    }
    acceptanceCounts[rId]++;
  }

  if (menu_id) {
    const fHist: UserFoodHistory = {
      history_id: "fh_" + Math.random().toString(36).substring(2, 9),
      user_id: user_id || "guest",
      menu_id: Number(menu_id),
      accepted: true,
      timestamp: new Date().toISOString()
    };
    userFoodHistory.push(fHist);
  }

  res.json({ success: true, acceptanceCounts });
});


// Calculate user dynamic Taste Persona Radar profile
app.get("/api/users/:userId/taste-persona", (req, res) => {
  const { userId } = req.params;
  const { preference_tags } = req.query;
  const history = userHistory.filter(h => h.user_id === userId);
  const foodHistoryCount = userFoodHistory.filter(h => h.user_id === userId).length;
  
  let tags = ["高CP值", "熱食", "重口味"];
  if (preference_tags) {
    tags = (preference_tags as string).split(",").map(t => t.trim()).filter(Boolean);
  } else {
    const user = users[userId] || users["default_user"];
    if (user) {
      tags = user.preference_tags;
    }
  }
  
  let cpValueScore = 65;
  let spicyScore = 30;
  let midnightScore = 40;
  let healthyIndex = 50;
  let tasteRichness = 60;

  // Derive radar parameters based on user selections
  if (tags.includes("高CP值")) cpValueScore = 88;
  if (tags.includes("重口味")) tasteRichness = 85;
  if (tags.includes("辣") || tags.includes("辛辣")) spicyScore = 80;
  if (tags.includes("宵夜類") || tags.includes("宵夜")) midnightScore = 85;
  if (tags.includes("素食")) {
    healthyIndex = 95;
    tasteRichness = 40;
  }

  // Factor in accumulated acceptances
  if (foodHistoryCount > 0) {
    cpValueScore = Math.min(100, cpValueScore + 5);
    tasteRichness = Math.min(100, tasteRichness + 4);
  }

  let personaType = "綜合口味探索家";
  if (tags.includes("素食")) {
    personaType = "草食健康行旅者";
  } else if (cpValueScore > 80 && midnightScore > 70) {
    personaType = "極致小資深夜饕客";
  } else if (tasteRichness > 80) {
    personaType = "重口味美食獵人";
  } else if (cpValueScore > 80) {
    personaType = "精明高CP值鑑賞家";
  }

  res.json({
    persona_type: personaType,
    radar: {
      budget_control: cpValueScore,
      spicy_score: spicyScore,
      midnight_affinity: midnightScore,
      healthy_index: healthyIndex,
      taste_richness: tasteRichness
    },
    tags: tags.map(t => `✔ ${t}`)
  });
});


// Initialize Firebase for Backend Sync
const serverApp = initializeApp(firebaseConfig);
const serverDb = initializeFirestore(serverApp, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

// Delay helper
const sleepMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Deterministic ID Hash mapping
function generateNumericId(placeId: string): number {
  let hash = 5381;
  for (let i = 0; i < placeId.length; i++) {
    hash = (hash * 33) ^ placeId.charCodeAt(i);
  }
  return Math.abs(hash) % 1000000;
}

function getRestaurantImageUrl(restaurantId: number, category: string, name: string): string {
  const categoryMap: Record<string, string> = {
    "早餐": "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=500&h=350&q=80",
    "午餐": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&h=350&q=80",
    "晚餐": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=500&h=350&q=80",
    "宵夜": "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=500&h=350&q=80",
    "飯": "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=500&h=350&q=80",
    "麵食": "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=500&h=350&q=80",
    "點心": "https://images.unsplash.com/photo-1517433456452-f9633a875f6f?auto=format&fit=crop&w=500&h=350&q=80",
    "飲料": "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=500&h=350&q=80",
    "鍋物": "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=500&h=350&q=80",
    "蔬食.素食": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=500&h=350&q=80"
  };

  if (name.includes("鬆餅")) {
    return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=500&h=350&q=80";
  }
  return categoryMap[category] || "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=500&h=350&q=80";
};

// NCU Restaurants Places + Gemini API Sync Pipeline
async function runNCURestaurantSyncPipeline(): Promise<string[]> {
  const logs: string[] = [];
  logs.push(`[${new Date().toLocaleString()}] 🚀 啟動中央大學 (NCU) 周邊 1.5km 餐廳資料每月定期同步任務...`);

  const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || process.env.GOOGLE_MAPS_API_KEY || firebaseConfig.apiKey || "";
  const allPlaces = new Map<string, any>();
  const includedTypes = ["restaurant", "cafe", "bakery", "meal_takeaway"];

  if (apiKey && apiKey !== "YOUR_API_KEY") {
    logs.push(`[Google Places] 📡 使用 Google Places API (New) 撈取周邊餐廳 (半徑 1500m)...`);
    for (const type of includedTypes) {
      try {
        logs.push(`[Google Places] 撈取類型: ${type}...`);
        const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": [
              "places.id",
              "places.displayName",
              "places.formattedAddress",
              "places.rating",
              "places.regularOpeningHours",
              "places.currentOpeningHours",
              "places.internationalPhoneNumber",
              "places.nationalPhoneNumber",
              "places.websiteUri",
              "places.googleMapsUri",
              "places.location",
              "places.photos",
              "places.businessStatus"
            ].join(",")
          },
          body: JSON.stringify({
            includedTypes: [type],
            maxResultCount: 20,
            languageCode: "zh-TW",
            regionCode: "TW",
            locationRestriction: {
              circle: {
                center: { latitude: 24.9681, longitude: 121.1925 },
                radius: 1500.0
              }
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.places && Array.isArray(data.places)) {
            data.places.forEach((p: any) => {
              allPlaces.set(p.id, p);
            });
            logs.push(`[Google Places] 類型 ${type} 本次撈取成功，累計不重複店家: ${allPlaces.size} 家`);
          } else {
            logs.push(`[Google Places] 類型 ${type} 未獲取到店家資料。`);
          }
        } else {
          logs.push(`[Google Places] 類型 ${type} 請求失敗: ${response.status} ${await response.text()}`);
        }
      } catch (err: any) {
        logs.push(`[Google Places] ❌ 撈取類型 ${type} 失敗: ${err?.message || err}`);
      }
      // Delay 3 seconds (Rate LIMIT defense)
      await sleepMs(3000);
    }
  } else {
    logs.push(`[Google Places] ⚠️ 未偵測到有效的 GOOGLE_MAPS_PLATFORM_KEY 密鑰，啟用 NCU 本地 39 家初始餐廳做高擬真同步。`);
  }

  // Fallback to static lists if live Maps API fetched contains 0 items
  if (allPlaces.size === 0) {
    logs.push(`[Google Places] 📢 撈取到的店數為 0，安全載入 NCU 本地 ${INITIAL_RESTAURANTS.length} 家核心精選餐廳作為資料流 fallback。`);
    INITIAL_RESTAURANTS.forEach(r => {
      // Use coordinate layout hash
      const latlng = RESTAURANT_COORDS[r.restaurant_id] || { lat: 24.9681, lng: 121.1925, area: "後門宵夜街" };
      allPlaces.set(`fallback_ncu_${r.restaurant_id}`, {
        id: `fallback_ncu_${r.restaurant_id}`,
        displayName: { text: r.name },
        formattedAddress: r.location_desc || "桃園市中壢區五權里2鄰中大路300號",
        rating: r.rating || 4.2,
        regularOpeningHours: { weekdayDescriptions: ["Monday – Sunday: 11:00 AM – 8:00 PM"] },
        nationalPhoneNumber: "未提供聯絡電話",
        websiteUri: "",
        menuUri: "",
        location: { latitude: latlng.lat, longitude: latlng.lng }
      });
    });
  }

  const placesList = Array.from(allPlaces.values());
  logs.push(`[AI Semantic Tagging] 🤖 即將使用 Gemini 3.5 Flash 進行台灣在地餐點標籤分類...`);
  logs.push(`[AI Semantic Tagging] 提供店家總數: ${placesList.length} 家，分組批次處理（每組 20 家）。`);

  // Start Gemini analyzer
  const gemini = getGeminiClient();
  const semanticTags: Record<string, string[]> = {};

  if (!gemini) {
    logs.push(`[AI Semantic Tagging] ⚠️ 未偵測到 GEMINI_API_KEY。將自動啟用本地智能文本語意貼貼貼規則。`);
    placesList.forEach(p => {
      const name = p.displayName?.text || "";
      const isVeg = name.includes("素食") || name.includes("蔬食");
      const isMidnight = name.includes("宵夜");
      const isSnack = name.includes("點心") || name.includes("鬆餅") || name.includes("炸雞") || name.includes("紅豆餅") || name.includes("雞蛋糕");
      const isDrink = name.includes("飲料") || name.includes("咖啡") || name.includes("茶");
      const isHotpot = name.includes("鍋") || name.includes("火鍋");
      const isNoodle = name.includes("麵") || name.includes("拉麵") || name.includes("抄手");
      const isRice = name.includes("飯") || name.includes("便當") || name.includes("排骨") || name.includes("燒臘");
      const isBreakfast = name.includes("早餐") || name.includes("早午餐") || name.includes("蛋餅");

      const t: string[] = ["午餐", "晚餐"];
      if (isVeg) t.push("蔬食.素食");
      if (isMidnight) t.push("宵夜");
      if (isSnack) t.push("點心");
      if (isDrink) t.push("飲料");
      if (isHotpot) t.push("鍋物");
      if (isNoodle) t.push("麵食");
      if (isRice) t.push("飯");
      if (isBreakfast) t.push("早餐");
      semanticTags[p.id] = t;
    });
  } else {
    // Pack inside chunks of 20
    const chunkSize = 20;
    for (let i = 0; i < placesList.length; i += chunkSize) {
      const chunk = placesList.slice(i, i + chunkSize);
      const compactList = chunk.map(p => ({
        place_id: p.id,
        name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        weekday_descriptions: p.regularOpeningHours?.weekdayDescriptions || []
      }));

      logs.push(`[AI Semantic Tagging] 正在分類第 ${Math.floor(i/chunkSize) + 1} / ${Math.ceil(placesList.length/chunkSize)} 組 (${chunk.length} 家)...`);

      try {
        const prompt = `
您是台灣在地美食分類專家。請根據我們提供的商家名稱、地址、營業時間，
依據以下規定為這 ${chunk.length} 家餐廳貼上對應的分類標籤（可複選，每家至少貼上 1 個，至多 5 個標籤）：

分類標籤與定義規則：
- 早餐：適合早上吃、早點、早午餐、飯糰西式早點、蛋餅吐司、碗粿等
- 午餐：適合正餐中飯、便當、定食、簡餐等公館炒飯
- 晚餐：適合正餐晚飯、聚餐、熱炒等合菜燉飯
- 宵夜：營業時間包含 22:00 之後且提供正餐鹹食者、宵夜街滷味等
- 飯：主食為白飯、滷肉飯、丼飯、炒飯、咖哩飯等與燒臘便當
- 麵食：主食為拉麵、牛肉麵、義大利麵、烏龍麵、小吃麵攤、炒麵、水餃、抄手
- 點心：雞蛋糕、紅豆餅、下午茶、甜點、麵包、車輪餅、鬆餅、炸雞排等輕食
- 飲料：手搖飲、咖啡廳、果汁飲料店
- 鍋物：火鍋、麻辣鍋、涮涮鍋、小火鍋、薑母鴨、砂鍋鍋物
- 蔬食.素食：素食餐廳或有明確標示蔬食友善的店家

餐廳清單：
${JSON.stringify(compactList, null, 2)}

請務必返回對應 schema 格式的 JSON 陣列。
`;

        const response = await gemini.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are an expert Taiwanese cuisine categorization engine. You classify food merchants accurately into the specified Taiwanese culinary standard categories. Return exactly a JSON array matching the request schema.",
            responseMimeType: "application/json",
            maxOutputTokens: 2048,
            temperature: 0.2,
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  place_id: { type: Type.STRING },
                  cuisine_tags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["place_id", "cuisine_tags"]
              }
            }
          }
        });

        if (response.text) {
          const classified = JSON.parse(response.text.trim());
          if (Array.isArray(classified)) {
            classified.forEach((item: any) => {
              semanticTags[item.place_id] = item.cuisine_tags || [];
            });
          }
        }
      } catch (err: any) {
        logs.push(`[AI Semantic Tagging] ❌ 分類批次 ${Math.floor(i/chunkSize) + 1} 失敗: ${err?.message || err}`);
      }
      // Delay 3 seconds (Rate LIMIT defense)
      await sleepMs(3000);
    }
  }

  // Step 3: Upsert Clean Structured data to Firestore Firebase Database
  logs.push(`[Firebase Database] 🗄️ 開始將 ${placesList.length} 筆過濾後的乾淨資料寫入 Firebase Firestore...`);
  let successCount = 0;
  let failCount = 0;

  for (const place of placesList) {
    const numericId = generateNumericId(place.id);
    const tags = semanticTags[place.id] || ["午餐", "晚餐"];

    // Structure filtering and clean mapping
    const googlePhotos = place.photos && Array.isArray(place.photos) ? place.photos : [];
    const photoUrls = googlePhotos.map((ph: any) => 
      `/api/places-photo?name=${encodeURIComponent(ph.name)}`
    );
    
    const img_url = photoUrls.length > 0 
      ? photoUrls[0] 
      : getRestaurantImageUrl(numericId, tags[0] || "飯", place.displayName?.text || "");

    const openingHours =
      place.currentOpeningHours?.weekdayDescriptions ||
      place.regularOpeningHours?.weekdayDescriptions ||
      [];

    const isOpenNow =
      typeof place.currentOpeningHours?.openNow === "boolean"
        ? place.currentOpeningHours.openNow
        : typeof place.regularOpeningHours?.openNow === "boolean"
          ? place.regularOpeningHours.openNow
          : true;

    const clean_restaurant = {
      restaurant_id: numericId,
      place_id: place.id,
      name: place.displayName?.text || "",
      category: tags[0] || "飯",
      walking_distance: 3, // default estimate from central campus points
      rating: typeof place.rating === "number" ? place.rating : 4.0,
      popularity: Math.floor(Math.random() * 20) + 75,
      avg_price: 110,

      // Google Places 營業狀態
      is_open: isOpenNow,

      is_group_friendly: true,
      has_ac: true,
      has_seats: true,
      is_vegetarian: tags.includes("蔬食.素食"),
      has_takeout: true,
      is_midnight_snack: tags.includes("宵夜"),
      img_url: img_url,
      google_photos: photoUrls,
      location_desc: place.formattedAddress || "桃園市中壢區五權里2鄰中大路300號",
      signature_dishes: tags,
      cuisine_tags: tags,
      formatted_address: place.formattedAddress || "",

      // Google Places 營業時間
      business_hours: openingHours.length > 0 ? openingHours : ["營業時間待補"],

      phone_number: place.nationalPhoneNumber || place.internationalPhoneNumber || "無電話資訊",
      booking_method: place.websiteUri ? place.websiteUri : "電話訂位或現場候位",

      // menuUri 不是 Google Places API 正式可用欄位，不要再用 place.menuUri
      menu_url: place.websiteUri || "",

      // Google Maps / website 補充欄位
      google_maps_uri: place.googleMapsUri || "",
      website_uri: place.websiteUri || "",

      latitude: typeof place.location?.latitude === "number" ? place.location.latitude : undefined,
      longitude: typeof place.location?.longitude === "number" ? place.location.longitude : undefined,
      last_synced: new Date().toISOString()
    };

    try {
      // Upsert: merge true protects user reports/adjustments
      const docRef = doc(serverDb, "restaurants", numericId.toString());
      await setDoc(docRef, clean_restaurant, { merge: true });
      successCount++;
    } catch (err: any) {
      failCount++;
      console.error(`Firebase write error for ${clean_restaurant.name}:`, err);
    }
  }

  logs.push(`[Firebase Database] 🏁 寫入作業結束。成功: ${successCount} 筆, 失敗: ${failCount} 筆。`);
  
  return logs;
}

// Rebuild local memory caches from Firestore doc snapshot
app.get("/api/restaurants-update-cache", async (req, res) => {
  try {
    const { getDocs } = await import("firebase/firestore");
    const restSnap = await getDocs(collection(serverDb, "restaurants"));
    let restList: Restaurant[] = [];
    restSnap.forEach(doc => {
      restList.push(doc.data() as Restaurant);
    });
    if (restList.length > 0) {
      restList.sort((a,b) => a.restaurant_id - b.restaurant_id);
      restaurants = restList;
      console.log(`[Cache Sync] Synchronized ${restaurants.length} restaurants from Firestore to server cache memory.`);
    }
    res.json({ success: true, count: restaurants.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || err });
  }
});

// Seed or Reset the official 92-restaurant database from verified local repository
app.post("/api/admin/seed-restaurants-from-local", async (req, res) => {
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    let successCount = 0;
    let menuSuccessCount = 0;

    // Seed Restaurants
    for (const r of INITIAL_RESTAURANTS) {
      const img = r.img_url || getRestaurantImageUrl(r.restaurant_id, r.category, r.name);
      const cleanR = { ...r, img_url: img };
      const docRef = doc(serverDb, "restaurants", r.restaurant_id.toString());
      await setDoc(docRef, cleanR, { merge: true });
      successCount++;
    }

    // Seed Menu Items
    for (const m of INITIAL_MENU_ITEMS) {
      const img = m.img_url || getDishImageUrl(m.item_name);
      const cleanM = { ...m, img_url: img };
      const docRef = doc(serverDb, "restaurants", m.restaurant_id.toString(), "menu_items", m.menu_id.toString());
      await setDoc(docRef, cleanM, { merge: true });
      menuSuccessCount++;
    }

    // Synchronize cache in memory
    const { getDocs } = await import("firebase/firestore");
    const restSnap = await getDocs(collection(serverDb, "restaurants"));
    let restList: Restaurant[] = [];
    restSnap.forEach(d => {
      restList.push(d.data() as Restaurant);
    });
    if (restList.length > 0) {
      restList.sort((a,b) => a.restaurant_id - b.restaurant_id);
      restaurants = restList;
    }

    res.json({
      success: true,
      restaurantsSeeded: successCount,
      menuItemsSeeded: menuSuccessCount,
      totalCached: restaurants.length
    });
  } catch (err: any) {
    console.error("[Seeding Error]:", err);
    res.status(500).json({ success: false, error: err?.message || err });
  }
});

// Setup monthly crontab scheduled at 00:00 AM on the 1st of every month
cron.schedule("0 0 1 * *", async () => {
  console.log(`[CRON SCHEDULE] 📅 每月定時自動執行 Google Places + Gemini 1.5 餐廳資料庫備存更新任務啟動...`);
  try {
    const backupLogs = await runNCURestaurantSyncPipeline();
    console.log(`[CRON SCHEDULE] ✅ 每月定時任務成功完成。日誌總數: ${backupLogs.length}`);
  } catch (err) {
    console.error(`[CRON SCHEDULE] ❌ 每月定時自動任務失敗:`, err);
  }
});

// Trigger real pipeline manually via API endpoint
app.post("/api/restaurants/sync-places", async (req, res) => {
  try {
    const logs = await runNCURestaurantSyncPipeline();
    res.json({ success: true, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || err });
  }
});


// AI OCR Menu recognition system endpoint
app.post("/api/menu/ocr", async (req, res) => {
  const { base64, mimeType } = req.body ?? {};

  const imageBase64 =
    typeof base64 === "string"
      ? base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").trim()
      : "";

  const supportedMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
  const safeMimeType =
    typeof mimeType === "string" && supportedMimeTypes.includes(mimeType)
      ? mimeType
      : "image/jpeg";

  if (!imageBase64) {
    return res.status(400).json({
      success: false,
      error: "未收到菜單圖片 base64，請重新選擇圖片。",
    });
  }

  const gemini = getGeminiClient();
  if (!gemini) {
    return res.status(500).json({
      success: false,
      error: "尚未設定 GEMINI_API_KEY，無法進行真正的 AI OCR。",
    });
  }

  try {
    const imagePart = {
      inlineData: {
        mimeType: safeMimeType,
        data: imageBase64,
      },
    };

    const prompt = `
你是一位專業的繁體中文菜單 OCR 解析器。請只根據圖片中實際看得到的菜單文字進行辨識。

請輸出 JSON 陣列，不要輸出 markdown，不要輸出說明文字。每個項目格式如下：
[
  {
    "item_name": "圖片中實際出現的菜色名稱",
    "price": 80,
    "spicy_level": "無辣",
    "ingredients": ["可從菜名推測或圖片明確列出的主要食材"],
    "tags": ["圖片可判斷的特色標籤"]
  }
]

規則：
1. 只能擷取圖片中真的有出現的菜色，不可以自行生成不存在的菜色。
2. 如果圖片模糊或不是菜單，請回傳空陣列 []。
3. price 必須是數字；若圖片沒有價格，請填 0。
4. spicy_level 只能是「無辣」、「微辣」、「中辣」、「大辣」之一；無法判斷請填「無辣」。
`;

    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [imagePart, { text: prompt }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              item_name: { type: Type.STRING },
              price: { type: Type.NUMBER },
              spicy_level: { type: Type.STRING },
              ingredients: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ["item_name", "price", "spicy_level", "ingredients", "tags"],
          },
        },
      },
    });

    const rawText = response.text?.trim() || "[]";
    const parsed = JSON.parse(rawText);
    const items = Array.isArray(parsed) ? parsed : [];

    const normalizedItems = items
      .map((item: any) => ({
        item_name: String(item.item_name || item.name || "").trim(),
        price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
        spicy_level: ["無辣", "微辣", "中辣", "大辣"].includes(item.spicy_level)
          ? item.spicy_level
          : "無辣",
        ingredients: Array.isArray(item.ingredients)
          ? item.ingredients.map((x: any) => String(x)).filter(Boolean)
          : String(item.ingredients || "")
              .split(/[、,，\s]+/)
              .filter(Boolean),
        tags: Array.isArray(item.tags)
          ? item.tags.map((x: any) => String(x)).filter(Boolean)
          : [],
      }))
      .filter((item: any) => item.item_name);

    if (normalizedItems.length === 0) {
      return res.status(422).json({
        success: false,
        error: "AI 沒有從圖片中辨識出菜色。請確認照片清楚拍到菜單文字與價格。",
        items: [],
      });
    }

    return res.json({
      success: true,
      count: normalizedItems.length,
      items: normalizedItems,
    });
  } catch (err: any) {
    console.error("[Gemini Vision OCR Error]", err);

    const detail = err?.message || String(err);

    if (detail.includes("API_KEY_INVALID") || detail.includes("API key not valid")) {
      return res.status(500).json({
        success: false,
        error: "Gemini API Key 無效。請確認 .env.local 裡的 GEMINI_API_KEY 是從 Google AI Studio 建立的有效金鑰，不是 Google Maps Key 或 Firebase apiKey。",
        detail,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Gemini Vision OCR 解析失敗，請確認 GEMINI_API_KEY、模型權限與圖片格式。",
      detail,
    });
  }
});

function inferCategoryFromGooglePlace(place: any): string {
  const name = place.displayName?.text || "";
  const types = place.types || [];
  const primaryType = place.primaryType || "";

  if (
    name.includes("早餐") ||
    name.includes("早午餐") ||
    name.includes("蛋餅") ||
    primaryType.includes("breakfast")
  ) {
    return "早餐";
  }

  if (
    name.includes("咖啡") ||
    name.includes("茶") ||
    name.includes("飲料") ||
    types.includes("cafe")
  ) {
    return "飲料";
  }

  if (
    name.includes("麵") ||
    name.includes("拉麵") ||
    name.includes("牛肉麵") ||
    name.includes("義大利麵")
  ) {
    return "麵食";
  }

  if (
    name.includes("鍋") ||
    name.includes("火鍋") ||
    name.includes("涮涮鍋")
  ) {
    return "鍋物";
  }

  if (
    name.includes("素") ||
    name.includes("蔬食")
  ) {
    return "蔬食.素食";
  }

  if (
    name.includes("飯") ||
    name.includes("便當") ||
    name.includes("丼") ||
    name.includes("咖哩")
  ) {
    return "飯";
  }

  return "午餐";
}

function priceLevelToAvgPrice(priceLevel?: string): number {
  switch (priceLevel) {
    case "PRICE_LEVEL_INEXPENSIVE":
      return 80;
    case "PRICE_LEVEL_MODERATE":
      return 130;
    case "PRICE_LEVEL_EXPENSIVE":
      return 220;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 350;
    default:
      return 100;
  }
}

function isOpenLate(place: any): boolean {
  const descriptions = place.regularOpeningHours?.weekdayDescriptions || [];
  return descriptions.some((d: string) => {
    return d.includes("22:") || d.includes("23:") || d.includes("00:");
  });
}

app.post("/api/places/lookup-restaurant", async (req, res) => {
  const { queryText } = req.body;

  if (!queryText || !queryText.trim()) {
    return res.status(400).json({
      success: false,
      error: "請輸入餐廳名稱",
    });
  }

  const apiKey =
    process.env.GOOGLE_MAPS_PLATFORM_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    "";

  if (!apiKey || apiKey === "YOUR_API_KEY") {
    return res.status(500).json({
      success: false,
      error: "尚未設定 GOOGLE_MAPS_PLATFORM_KEY",
    });
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.rating",
          "places.priceLevel",
          "places.regularOpeningHours",
          "places.nationalPhoneNumber",
          "places.internationalPhoneNumber",
          "places.websiteUri",
          "places.googleMapsUri",
          "places.photos",
          "places.primaryType",
          "places.types",
          "places.businessStatus"
        ].join(",")
      },
      body: JSON.stringify({
        textQuery: `${queryText} 中央大學 中壢 餐廳`,
        languageCode: "zh-TW",
        regionCode: "TW",
        locationBias: {
          circle: {
            center: {
              latitude: 24.9681,
              longitude: 121.1925
            },
            radius: 1500
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        success: false,
        error: errText
      });
    }

    const data = await response.json();
    const place = data.places?.[0];

    if (!place) {
      return res.json({
        success: false,
        error: "Google Maps 找不到符合的餐廳"
      });
    }

    const photoName = place.photos?.[0]?.name || "";
    const photoUrl = photoName
      ? `/api/places-photo?name=${encodeURIComponent(photoName)}`
      : "";

    const normalized = {
      place_id: place.id,
      name: place.displayName?.text || queryText,
      category: inferCategoryFromGooglePlace(place),
      location_desc: place.formattedAddress || "",
      latitude: place.location?.latitude || 24.9681,
      longitude: place.location?.longitude || 121.1925,
      rating: typeof place.rating === "number" ? place.rating : 4.2,
      avg_price: priceLevelToAvgPrice(place.priceLevel),
      is_open: place.businessStatus !== "CLOSED_PERMANENTLY",
      has_ac: true,
      has_seats: true,
      is_vegetarian:
        (place.displayName?.text || "").includes("素") ||
        (place.displayName?.text || "").includes("蔬食"),
      is_midnight_snack: isOpenLate(place),
      phone_number: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
      business_hours: place.regularOpeningHours?.weekdayDescriptions || [],
      website_uri: place.websiteUri || "",
      google_maps_uri: place.googleMapsUri || "",
      menu_url: "",
      img_url: photoUrl
    };

    res.json({
      success: true,
      restaurant: normalized
    });
  } catch (err: any) {
    console.error("[Google Places Lookup Error]", err);
    res.status(500).json({
      success: false,
      error: err?.message || "Google Places 查詢失敗"
    });
  }
});

// Dev vs production Vite setup
const isProduction = process.env.NODE_ENV === "production";
if (!isProduction) {
  createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  }).then((vite) => {
    app.use(vite.middlewares);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Development Server is running on http://localhost:${PORT}`);
    });
  });
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Production Server is running on http://localhost:${PORT}`);
  });
}
