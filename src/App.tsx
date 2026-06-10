/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, MapPin, DollarSign, Star, Users, UtensilsCrossed, RefreshCw, 
  CheckCircle, Compass, Plus, X, Sliders, Clock, AlertCircle, Trash, 
  LogIn, LogOut, Heart, Megaphone, Shield, User, Camera, ArrowRight,
  BookOpen
} from "lucide-react";

// Types
import { Restaurant, MenuItem, GroupRoom, User as UserProfile, UserReport } from "./types";

// Firebase
import { auth, db, googleProvider, handleFirestoreError, OperationType } from "./lib/firebase";
import { signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, User as FirebaseUser } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, getDocs, collection, collectionGroup, query, where } from "firebase/firestore";

// Calculations & Images
import { getMapCoords, getRestaurantCoords, getRestaurantArea, haversineDistance } from "./utils/mapUtils";
import { getRestaurantImageUrl, getMealImageUrl } from "./utils/imageUtils";

// Modularized Components
import CampusMap from "./components/CampusMap";
import ProfileExplore from "./components/ProfileExplore";
import MerchantPortal from "./components/MerchantPortal";

const DEFAULT_PERSONAS = [
  { id: "p1", name: "元氣中大椰子樹", desc: "口氣元氣活力、對中央大學瞭若指掌、用語充滿校園感，熱愛點綴驚嘆號！", prompt: "中央大學椰子樹" },
  { id: "p2", name: "深夜讀書會學長", desc: "溫柔成熟、說話知性，會一邊分析步行耗能與營養成分、一邊提供暖心美食治癒。", prompt: "溫厚知性學長" },
  { id: "p3", name: "後門宵夜街攤友阿姨", desc: "本土熱情、說話常常加上『底迪/美眉』，誠懇公道，大推便宜能填飽肚子的大碗好康。", prompt: "熱情攤販阿姨" }
];


const safeNumber = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatFixed = (value: unknown, digits = 1, fallback = 0) => {
  return safeNumber(value, fallback).toFixed(digits);
};

const normalizeRestaurant = (raw: any, fallbackId = 0): Restaurant => {
  return {
    ...raw,
    restaurant_id: safeNumber(raw?.restaurant_id, fallbackId),
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : "未命名店家",
    category: typeof raw?.category === "string" && raw.category.trim() ? raw.category : "台式",
    walking_distance: safeNumber(raw?.walking_distance, 8),
    rating: safeNumber(raw?.rating, 4.2),
    popularity: safeNumber(raw?.popularity, 70),
    avg_price: safeNumber(raw?.avg_price, 100),
    is_open: typeof raw?.is_open === "boolean" ? raw.is_open : true,
    is_group_friendly: typeof raw?.is_group_friendly === "boolean" ? raw.is_group_friendly : true,
    has_ac: typeof raw?.has_ac === "boolean" ? raw.has_ac : true,
    has_seats: typeof raw?.has_seats === "boolean" ? raw.has_seats : true,
    is_vegetarian: typeof raw?.is_vegetarian === "boolean" ? raw.is_vegetarian : false,
    has_takeout: typeof raw?.has_takeout === "boolean" ? raw.has_takeout : true,
    is_midnight_snack: typeof raw?.is_midnight_snack === "boolean" ? raw.is_midnight_snack : false,
    img_url: typeof raw?.img_url === "string" ? raw.img_url : "",
    location_desc: typeof raw?.location_desc === "string" && raw.location_desc.trim() ? raw.location_desc : "中央大學周邊",
    signature_dishes: Array.isArray(raw?.signature_dishes) ? raw.signature_dishes : [],
    latitude: Number.isFinite(Number(raw?.latitude)) ? Number(raw.latitude) : undefined,
    longitude: Number.isFinite(Number(raw?.longitude)) ? Number(raw.longitude) : undefined,
  };
};

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

export default function App() {
  const [activeTab, setActiveTab] = useState<"home" | "explore" | "merchant">("home");
  const [homeSubMode, setHomeSubMode] = useState<"solo" | "group">("solo");

  // Authentication & Users
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<string>("user");
  const [username, setUsername] = useState<string>("中大美食客");

  // Custom Login Dialog State
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [loginRole, setLoginRole] = useState<"user" | "merchant" | "admin">("user");
  const [quickName, setQuickName] = useState<string>("");
  const [quickEmail, setQuickEmail] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  
  // Exclusions and Weights Pools
  const [lovedRestIds, setLovedRestIds] = useState<number[]>([]);
  const [blacklistRestIds, setBlacklistRestIds] = useState<number[]>([]);
  const [blacklistMeals, setBlacklistMeals] = useState<string[]>([]);
  const [preferenceTags, setPreferenceTags] = useState<string[]>(["重口味", "熱食", "CP值高"]);
  
  // Global Food Entries State
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [deals, setDeals] = useState<any[]>([
    { id: "d1", restaurant_id: 3, restaurant_name: "香之味燒臘", offer: "中大慶! 憑學生證精選三寶飯特惠折 10 元" , code: "NCU10" },
    { id: "d2", restaurant_id: 1, restaurant_name: "小木屋鬆餅", offer: "新品上市: 乳酪蜂蜜鬆餅限時特惠 55 元!", code: "WAFFLE" },
    { id: "d3", restaurant_id: 8, restaurant_name: "宵夜街脆皮起司蛋餅", offer: "加購小紅茶/豆漿只要半價 15 元!", code: "EGGBOGO" },
    { id: "d4", restaurant_id: 6, restaurant_name: "松苑排骨飯便當", offer: "買排骨便當免費升等超厚滷汁加值大碗！", code: "PINERICE" }
  ]);

  // Geolocation
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Home Filters
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterMaxPrice, setFilterMaxPrice] = useState<number>(300);
  const [filterMaxDistance, setFilterMaxDistance] = useState<number>(20); // in minutes
  const [filterFreeRefills, setFilterFreeRefills] = useState<boolean>(false);
  const [filterFreeSoupDrinks, setFilterFreeSoupDrinks] = useState<boolean>(false);
  const [filterInStore, setFilterInStore] = useState<boolean>(false);
  const [filterTakeout, setFilterTakeout] = useState<boolean>(false);

  // Selected Persona
  const [selectedPersona, setSelectedPersona] = useState<string>("p1");

  // Roulette Rolling Outcomes
  const [isRolling, setIsRolling] = useState(false);
  const [rollingIndex, setRollingIndex] = useState(0);
  const [recommendationResult, setRecommendationResult] = useState<{
    restaurant: Restaurant;
    reason: string;
    ai_generated?: boolean;
  } | null>(null);
  const [rolledDish, setRolledDish] = useState<MenuItem | null>(null);
  const [rerollCount, setRerollCount] = useState<number>(0);
  const [isMenuExpanded, setIsMenuExpanded] = useState<boolean>(false);

  // Group Rooms
  const [currentRoom, setCurrentRoom] = useState<GroupRoom | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState<string>("");
  const [groupMaxPrice, setGroupMaxPrice] = useState<number>(160);
  const [groupMaxDistance, setGroupMaxDistance] = useState<number>(8);
  const [loadingGroupDecision, setLoadingGroupDecision] = useState<boolean>(false);

  // Map settings
  const [mapTarget, setMapTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(1);

  // Toast / Status Alerts
  const [bannerAlert, setBannerAlert] = useState<string | null>(null);

  // Trigger floating status banner
  const triggerBannerAlert = (msg: string) => {
    setBannerAlert(msg);
    setTimeout(() => setBannerAlert(null), 5000);
  };

  // 1. Core authentication listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setFirebaseUser(user);
        setUsername(user.displayName || "中大新鮮人");
        
        const savedRole = localStorage.getItem("register_role_to_assign") || "user";
        const savedUsername = localStorage.getItem("register_username_to_assign") || user.displayName || "中大新鮮人";

        // Fetch or create profile record
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const uProfile = snap.data() as UserProfile;
          setUsername(uProfile.username || user.displayName || "中大美食客");
          
          let currentRole = uProfile.role || "user";
          // Safeguard: make sure 910370ctgs@gmail.com is always admin
          if (user.email === "910370ctgs@gmail.com") {
            currentRole = "admin";
            if (uProfile.role !== "admin") {
              await updateDoc(userRef, { role: "admin" });
            }
          }
          setUserRole(currentRole);
          
          setBlacklistRestIds(uProfile.blacklist_rest_ids || []);
          setBlacklistMeals(uProfile.blacklist_meals || []);
          setPreferenceTags(uProfile.preference_tags || []);
        } else {
          // New record
          let finalRole = savedRole;
          if (user.email === "910370ctgs@gmail.com") {
            finalRole = "admin";
          } else {
            // Check pre-authorized administrators
            try {
              if (user.email) {
                const usersRef = collection(db, "users");
                const q = query(usersRef, where("email", "==", user.email), where("role", "==", "admin"));
                const querySnap = await getDocs(q);
                if (!querySnap.empty) {
                  finalRole = "admin";
                } else if (savedRole === "admin") {
                  finalRole = "user"; // lock down unauthorized admin selected in modal
                }
              } else if (savedRole === "admin") {
                finalRole = "user";
              }
            } catch (e) {
              console.warn("Pre-auth admin verification failed:", e);
              if (savedRole === "admin") finalRole = "user";
            }
          }

          const initialProfile = {
            user_id: user.uid,
            username: savedUsername,
            email: user.email || "",
            role: finalRole,
            preference_tags: ["CP值高", "重口味"],
            blacklist_rest_ids: [],
            blacklist_ingredients: [],
            blacklist_categories: [],
            blacklist_meals: []
          };
          await setDoc(userRef, initialProfile);
          setUserRole(initialProfile.role);
          setUsername(initialProfile.username);
        }
      } else {
        setFirebaseUser(null);
        setUserRole("user");
      }
    });

    // Capture user geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude
          });
        },
        (err) => console.log("Geolocation permission block:", err)
      );
    }

    return unsub;
  }, []);

  // 2. Main data loader syncing from firestore + falls to local data
  const fetchAllData = async () => {
    // 1. Fetch Restaurants
    try {
      const restSnap = await getDocs(collection(db, "restaurants"));
      let restList: Restaurant[] = [];
      restSnap.forEach(doc => {
        const raw = doc.data();
        const fallbackId = Number(raw?.restaurant_id ?? doc.id) || restList.length + 1;
        restList.push(normalizeRestaurant(raw, fallbackId));
      });
      if (restList.length > 0) {
        setRestaurants(restList.sort((a,b) => a.restaurant_id - b.restaurant_id));
      } else {
        // Fallback seed
        const fallback = await import("./restaurantsData");
        setRestaurants(fallback.INITIAL_RESTAURANTS);
      }
    } catch (err) {
      console.error("Firestore read error restaurants, falling back to local list:", err);
      try {
        const fallback = await import("./restaurantsData");
        setRestaurants(fallback.INITIAL_RESTAURANTS);
      } catch (fallbackErr) {
        console.error("Critical: Failed to load local fallback restaurants:", fallbackErr);
      }
    }

    // 2. Fetch Menu items
    try {
      const menuSnap = await getDocs(collectionGroup(db, "menu_items"));
      let menuList: MenuItem[] = [];
      menuSnap.forEach(doc => {
        menuList.push(doc.data() as MenuItem);
      });
      if (menuList.length > 0) {
        setMenuItems(menuList);
      } else {
        const fallback = await import("./restaurantsData");
        setMenuItems(fallback.INITIAL_MENU_ITEMS);
      }
    } catch (err) {
      console.error("Firestore read menu error, falling back to local menu items:", err);
      try {
        const fallback = await import("./restaurantsData");
        setMenuItems(fallback.INITIAL_MENU_ITEMS);
      } catch (fallbackErr) {
        console.error("Critical: Failed to load local fallback menu items:", fallbackErr);
      }
    }

    // 3. Fetch Coupons
    try {
      const dealsSnap = await getDocs(collection(db, "deals"));
      let dealsList: any[] = [];
      dealsSnap.forEach(doc => {
        dealsList.push(doc.data());
      });
      if (dealsList.length > 0) {
        setDeals(dealsList);
      }
    } catch (err) {
      console.log("Deals Firestore read skip:", err);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Real-time group room sync
  useEffect(() => {
    if (!currentRoom || !currentRoom.room_id) return;
    const unsubRoom = onSnapshot(doc(db, "group_rooms", currentRoom.room_id), (snap) => {
      if (snap.exists()) {
        setCurrentRoom(snap.data() as GroupRoom);
      }
    });
    return unsubRoom;
  }, [currentRoom?.room_id]);

  // Sync profile details back to Firestore
  const updateProfileInDB = async (payload: Partial<UserProfile>) => {
    if (!firebaseUser) return;
    try {
      const userRef = doc(db, "users", firebaseUser.uid);
      await updateDoc(userRef, payload);
    } catch (err) {
      console.error("Failed to commit profile updates:", err);
    }
  };

  // Google Log In
  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      localStorage.setItem("register_role_to_assign", loginRole);
      localStorage.removeItem("register_username_to_assign"); // let Google displayName take precedence
      await signInWithPopup(auth, googleProvider);
      setIsLoginModalOpen(false);
      triggerBannerAlert("🔐 登入成功！已對接中大會員偏好資料庫。");
    } catch (err: any) {
      console.error("Google SSO failed:", err);
      setAuthError(err.message || "授權登入失敗");
      triggerBannerAlert("⚠️ Google 授權終止或遭瀏覽器阻擋！您可以點選【快速免密登入】立即進入體驗。");
    }
  };

  // Quick Passwordless login (Immune to iframe restrictions & popup blockers!)
  const handleQuickSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const cleanName = quickName.trim() || (loginRole === "merchant" ? "特約店家代表" : loginRole === "admin" ? "安全稽核學長" : "中大新鮮人");
      const cleanEmail = quickEmail.trim() || `ncu_${loginRole}_${Math.floor(1000 + Math.random() * 9000)}@ncu-roulette.edu.tw`;

      localStorage.setItem("register_role_to_assign", loginRole);
      localStorage.setItem("register_username_to_assign", cleanName);

      let finalRole = loginRole;
      if (loginRole === "admin") {
        if (cleanEmail === "910370ctgs@gmail.com") {
          finalRole = "admin";
        } else {
          // Check from Firestore if pre-authorized admin exists
          try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("email", "==", cleanEmail), where("role", "==", "admin"));
            const querySnap = await getDocs(q);
            if (!querySnap.empty) {
              finalRole = "admin";
            } else {
              finalRole = "user";
              alert(`⚠️ 帳號 ${cleanEmail} 尚未被設定為管理員！您的帳號身分已被安全的移轉為【學生/訪客】。\n請聯絡主管理員 910370ctgs@gmail.com 取得特許管理權限。`);
            }
          } catch (e) {
            console.error("Quick sign-in admin check failure:", e);
            finalRole = "user";
          }
        }
      }

      // Sign in anonymously to acquire a valid Firebase Auth UID
      await signInAnonymously(auth);

      // Immediately write database document in Firestore as standard user flow
      const user = auth.currentUser;
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
          user_id: user.uid,
          username: cleanName,
          email: cleanEmail,
          role: finalRole,
          preference_tags: preferenceTags.length > 0 ? preferenceTags : ["CP值高", "重口味"],
          blacklist_rest_ids: blacklistRestIds || [],
          blacklist_ingredients: [],
          blacklist_categories: [],
          blacklist_meals: blacklistMeals || []
        }, { merge: true });

        // Update local app state
        setUsername(cleanName);
        setUserRole(finalRole);
      }

      setIsLoginModalOpen(false);
      triggerBannerAlert(`👋 快速登入成功！您目前的身分是：【${finalRole === "merchant" ? "🏪 特約店家合作夥伴" : finalRole === "admin" ? "🛡️ 系統/小組安全稽核" : "🎓 學生 / 中大訪客"}】`);
    } catch (err: any) {
      console.error("Quick sign in failed:", err);
      setAuthError(err.message || "快速登入異常");
    }
  };

  // Sign out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setFirebaseUser(null);
      setBlacklistRestIds([]);
      setBlacklistMeals([]);
      setLovedRestIds([]);
      triggerBannerAlert("🔓 已成功登出。已清除本地特等隱私快取。");
    } catch (err) {
      console.error(err);
    }
  };

  // Toggles for Exclusions and Favs
  const handleToggleLoveRest = (id: number) => {
    const list = lovedRestIds.includes(id) 
      ? lovedRestIds.filter(x => x !== id) 
      : [...lovedRestIds, id];
    setLovedRestIds(list);
    triggerBannerAlert(lovedRestIds.includes(id) ? "💔 已取消關注該商家" : "💖 最愛標註成功！這道店在智慧輪盤權重已倍數拉升！");
  };

  const handleToggleBlacklistRest = (id: number) => {
    const list = blacklistRestIds.includes(id)
      ? blacklistRestIds.filter(x => x !== id)
      : [...blacklistRestIds, id];
    setBlacklistRestIds(list);
    updateProfileInDB({ blacklist_rest_ids: list });
    triggerBannerAlert(blacklistRestIds.includes(id) ? "🔓 已撤除屏蔽！該商家重回可選名單" : "🚫 防災警示！該商家已被屏蔽防踩雷");
  };

  const handleToggleBlacklistMeal = (meal: string) => {
    const list = blacklistMeals.includes(meal)
      ? blacklistMeals.filter(x => x !== meal)
      : [...blacklistMeals, meal];
    setBlacklistMeals(list);
    updateProfileInDB({ blacklist_meals: list });
    triggerBannerAlert(blacklistMeals.includes(meal) ? `🔓 已移除菜名 [${meal}] 避雷` : `🚫 已將關鍵字 [${meal}] 加入排雷屏斷`);
  };

  const handleUpdateUsername = (name: string) => {
    setUsername(name);
    updateProfileInDB({ username: name });
  };

  const handleUpdateRole = (role: string) => {
    setUserRole(role);
    updateProfileInDB({ role });
    triggerBannerAlert(`🛡️ 您的身分已被重設為：【${role === "merchant" ? "🏪 特約店家合作夥伴" : "🎓 學生 / 中大訪客"}】`);
  };

  // Hot Deal map focusing navigator
  const handleFocusRestaurantOnMap = (restId: number) => {
    const rest = restaurants.find(r => r.restaurant_id === restId);
    if (!rest) return;

    setActiveTab("home");
    const coords = getRestaurantCoords(rest);
    setMapTarget({ lat: coords.lat, lng: coords.lng });
    setMapZoom(2.8);

    // Auto load mock recommendation cards to view menu right away!
    setRecommendationResult({
      restaurant: rest,
      reason: "🎟️ 您點選了今日特惠 Coupons 導航。以下同步為您提供該商家招牌餐點與特選折扣券資訊！",
      ai_generated: false
    });
    const meals = menuItems.filter(item => item.restaurant_id === rest.restaurant_id);
    setRolledDish(meals.length > 0 ? meals[0] : null);
    setRerollCount(0);
    setIsMenuExpanded(true);
  };

  // SINGLE ROLL (LUCKY ROLL + AI RECOMMEND)
  const handleGenerateDecision = async (useAI = false) => {
    if (restaurants.length === 0) return;
    
    // Clear old result
    setRecommendationResult(null);
    setRolledDish(null);
    setRerollCount(0);
    setIsMenuExpanded(false);

    // Pre-filtering candidate lists
    const candidates = restaurants.filter(r => {
      // 1. Blacklist check
      if (blacklistRestIds.includes(r.restaurant_id)) return false;
      
      // 2. Custom Left constraints check
      if (filterCategory !== "all" && r.category !== filterCategory) return false;
      if (r.avg_price > filterMaxPrice) return false;
      if (r.walking_distance > filterMaxDistance) return false;
      if (filterFreeRefills && !r.is_group_friendly) return false;
      if (filterFreeSoupDrinks && !r.has_ac) return false;
      if (filterInStore && !r.has_seats) return false;
      if (filterTakeout && !r.has_takeout) return false;

      return true;
    });

    if (candidates.length === 0) {
      triggerBannerAlert("⚠️ 沒有符合過濾條件的店家！請放寬左側控制面板的價格或距離限制。");
      return;
    }

    setIsRolling(true);

    // Rolling animation loops simulating neon roulette wheel clicks
    let tickCount = 0;
    const interval = setInterval(() => {
      setRollingIndex(Math.floor(Math.random() * candidates.length));
      tickCount++;
      if (tickCount > 15) {
        clearInterval(interval);
        
        // Final selections
        const drawWinner = candidates[rollingIndex % candidates.length];
        const coords = getRestaurantCoords(drawWinner);

        // Slow Fly-to center coordinate
        setMapTarget({ lat: coords.lat, lng: coords.lng });
        setMapZoom(2.5);

        // Fetch corresponding dishes
        const dishes = menuItems.filter(m => m.restaurant_id === drawWinner.restaurant_id && !blacklistMeals.some(b => m.item_name.includes(b)));
        const finalDish = dishes.length > 0 ? dishes[Math.floor(Math.random() * dishes.length)] : null;

        if (useAI && firebaseUser) {
          // Run advanced Gemini recom API route (which provides custom persona descriptions!)
          fetchAIRecommend(drawWinner, finalDish);
        } else {
          setRecommendationResult({
            restaurant: drawWinner,
            reason: `🎯 命運之手替您做出了完美的抉擇！這道落在【${getRestaurantArea(drawWinner.restaurant_id, drawWinner.location_desc)}】的【${drawWinner.name}】是中大學弟妹一致熱推的經典美味，去試試吧！`,
            ai_generated: false
          });
          setRolledDish(finalDish);
          setIsRolling(false);
        }
      }
    }, 100);
  };

  // Gemini recommended call
  const fetchAIRecommend = async (winner: Restaurant, dish: MenuItem | null) => {
    try {
      const selectedPersonaPrompt = DEFAULT_PERSONAS.find(p => p.id === selectedPersona)?.prompt || "椰子樹";
      const res = await fetch("/api/ai-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: winner.restaurant_id,
          restaurant_name: winner.name,
          user_id: firebaseUser?.uid || "guest",
          user_name: username,
          coords: userLocation,
          persona: selectedPersonaPrompt,
          exclude_ingredients: blacklistMeals
        })
      });
      const data = await res.json();
      setRecommendationResult({
        restaurant: winner,
        reason: data.reason || `AI 分析完畢：大推您享用這道鮮美饗宴。`,
        ai_generated: true
      });
      setRolledDish(dish);
    } catch (err) {
      console.error("AI recommend route failed:", err);
      // Fallback
      setRecommendationResult({
        restaurant: winner,
        reason: `🌿 命定之選：熱情推薦這家超讚滋味小店！`,
        ai_generated: false
      });
      setRolledDish(dish);
    } finally {
      setIsRolling(false);
    }
  };

  // DOUBLE REROLL HANDLERS (with Max 3 protections constraint)
  const handleRerollEntireShop = () => {
    if (rerollCount >= 3) {
      triggerBannerAlert("🚫 鎖定防延遲防累機制已啟動！每餐最多僅可重新挑選 3 次，今天請尊重這道提案！");
      return;
    }
    setRerollCount(prev => prev + 1);
    handleGenerateDecision(recommendationResult?.ai_generated);
  };

  const handleRerollJustDish = () => {
    if (rerollCount >= 3) {
      triggerBannerAlert("🚫 鎖定防延遲防累機制已啟動！每餐最多僅可重新挑選 3 次，請珍惜食物，手刀出發吧！");
      return;
    }
    if (!recommendationResult) return;
    
    // Increment Reroll
    setRerollCount(prev => prev + 1);
    
    // Randomize meal entries under SAME shop only
    const candidates = menuItems.filter(m => m.restaurant_id === recommendationResult.restaurant.restaurant_id && !blacklistMeals.some(b => m.item_name.includes(b)));
    if (candidates.length <= 1) {
      triggerBannerAlert("💡 該店家目前沒有其餘菜名上線，直接吃這餐吧！");
      return;
    }
    const filtered = candidates.filter(m => m.menu_id !== rolledDish?.menu_id);
    const rolled = filtered[Math.floor(Math.random() * filtered.length)];
    setRolledDish(rolled);
    triggerBannerAlert("🍛 已重新抽調該店招牌菜色！");
  };

  // MULTI-USER ROOM ACTIONS
  const handleCreateGroup = async () => {
    if (!firebaseUser) {
      triggerBannerAlert("⚠️ 請先在右上角登入 Google 帳號再建立共識房！");
      return;
    }
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const newRoom: GroupRoom = {
      room_id: code,
      owner_id: firebaseUser.uid,
      owner_name: username,
      members: [{
        user_id: firebaseUser.uid,
        username: username,
        preference_tags: preferenceTags,
        blacklist_ingredients: blacklistMeals,
        blacklist_categories: [],
        max_price: groupMaxPrice,
        max_distance: groupMaxDistance
      }]
    };
    try {
      await setDoc(doc(db, "group_rooms", code), newRoom);
      setCurrentRoom(newRoom);
      triggerBannerAlert(`🚪 共識房 #${code} 建立成功！快複製代碼邀請室友進入。`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoinGroup = async () => {
    const code = roomCodeInput || currentRoom?.room_id;
    if (!code) {
      triggerBannerAlert("⚠️ 請輸入四位數代碼");
      return;
    }
    if (!firebaseUser) {
      triggerBannerAlert("⚠️ 請先登入配合群組房");
      return;
    }
    try {
      const roomRef = doc(db, "group_rooms", code);
      const snap = await getDoc(roomRef);
      if (snap.exists()) {
        const room = snap.data() as GroupRoom;
        
        // Upsert me
        const others = room.members.filter(m => m.user_id !== firebaseUser.uid);
        const meNode = {
          user_id: firebaseUser.uid,
          username: username,
          preference_tags: preferenceTags,
          blacklist_ingredients: blacklistMeals,
          blacklist_categories: [],
          max_price: groupMaxPrice,
          max_distance: groupMaxDistance
        };
        const updatedMembers = [...others, meNode];
        await updateDoc(roomRef, { members: updatedMembers });
        setCurrentRoom({ ...room, members: updatedMembers });
        triggerBannerAlert(`✔️ 成功加入並同步中大聚餐房 #${code}！`);
      } else {
        triggerBannerAlert("❌ 找不到此房間號碼，請向發起人核實！");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleGroupLeave = async () => {
    if (!currentRoom || !firebaseUser) return;
    try {
      const roomRef = doc(db, "group_rooms", currentRoom.room_id);
      const leftMembers = currentRoom.members.filter(m => m.user_id !== firebaseUser.uid);
      await updateDoc(roomRef, { members: leftMembers });
      setCurrentRoom(null);
      setRoomCodeInput("");
      triggerBannerAlert("🚪 已退出聚餐房");
    } catch (err) {
      console.error(err);
    }
  };

  const handleCalculateGroupDecision = async () => {
    if (!currentRoom) return;
    setLoadingGroupDecision(true);
    setRecommendationResult(null);
    setRolledDish(null);
    setRerollCount(0);
    setIsMenuExpanded(false);

    try {
      const res = await fetch(`/api/groups/${currentRoom.room_id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: currentRoom,
          custom_restaurants: restaurants,
          custom_menu_items: menuItems
        })
      });
      const data = await res.json();
      
      if (data.restaurant) {
        setMapTarget({ lat: data.restaurant.latitude || 24.9681, lng: data.restaurant.longitude || 121.1925 });
        setMapZoom(2.5);
        setRecommendationResult({
          restaurant: data.restaurant,
          reason: data.reason || `AI 共識分析結論：推薦聚餐選擇：${data.restaurant.name}。已幫忙隔開所有成員口中地雷及過预算！`,
          ai_generated: true
        });
        
        // Rolled group dish
        const matchingDishes = menuItems.filter(m => m.restaurant_id === data.restaurant.restaurant_id);
        setRolledDish(matchingDishes.length > 0 ? matchingDishes[0] : null);
        triggerBannerAlert("🎉 AI 共識聚餐引擎完美演算完成！");
      } else {
        triggerBannerAlert("⚠️ 演算警告：您的黑名單限制防護過厚或是預算過於嚴苛，未能找出最佳交集餐廳！");
      }
    } catch (err) {
      console.error("Group compute failure:", err);
      triggerBannerAlert("❌ 呼叫 AI 共識運算錯誤，請檢查網路！");
    } finally {
      setLoadingGroupDecision(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf8f5] text-[#3d3d3d] flex flex-col antialiased selection:bg-[#FAF6D5] selection:text-[#5a5a40]">
      
      {/* Floating Global Banner Notifications */}
      <AnimatePresence>
        {bannerAlert && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-tr from-[#3d3d2e] to-[#5a5a40] text-amber-300 font-bold px-6 py-3 rounded-full shadow-2xl border border-amber-300/20 text-xs flex items-center gap-2 tracking-wide"
          >
            <Sparkles className="w-4 h-4 text-amber-400 rotate-12" />
            <span>{bannerAlert}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top rolling promotional marquee */}
      <div className="w-full bg-[#5a5a40] text-white py-2 overflow-hidden relative z-30 shadow-md">
        <div className="w-full max-w-7xl mx-auto flex items-center justify-between px-4">
          <div className="flex items-center gap-1.5 shrink-0 z-10 bg-[#3d3d2e] px-2.5 py-1 rounded-xl text-[10px] font-bold tracking-wider uppercase text-amber-300 shadow">
            <Megaphone className="w-3.5 h-3.5 text-amber-300 animate-bounce" />
            <span>活動促銷跑馬燈</span>
          </div>

          <div className="flex-1 overflow-hidden relative h-5 flex items-center">
            <motion.div
              animate={{ x: [200, -1200] }}
              transition={{ repeat: Infinity, duration: 28, ease: "linear" }}
              className="flex gap-16 whitespace-nowrap text-[11px] font-bold text-amber-50"
            >
              {deals.map((deal, idx) => (
                <div key={idx} className="flex items-center gap-1.5 cursor-pointer hover:text-white" onClick={() => handleFocusRestaurantOnMap(deal.restaurant_id)}>
                  <span>★</span>
                  <span>【{deal.restaurant_name}】{deal.offer}</span>
                  {deal.code && (
                    <span className="bg-[#3d3d2e] text-amber-300 px-1.5 py-0.2 rounded text-[8px] font-mono border border-amber-300/10 font-bold">
                      COUPON: {deal.code}
                    </span>
                  )}
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Header Panel */}
      <header className="w-full bg-[#fdfdfb] border-b border-[#e5e1da]/50 sticky top-0 z-20 shadow-sm py-3 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          
          {/* Logo brand */}
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setActiveTab("home"); setMapTarget(null); setMapZoom(1); }}>
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-[#5a5a40] to-[#3d3d2e] flex items-center justify-center shadow">
              <UtensilsCrossed className="w-4.5 h-4.5 text-amber-300" />
            </div>
            <div className="text-left font-serif">
              <h1 className="text-sm sm:text-base font-bold text-[#3d3d2e] tracking-tight">中大美食抽抽樂</h1>
              <p className="text-[9px] text-[#8a8a70] uppercase font-sans">NCU Smart Food Roulette</p>
            </div>
          </div>

          {/* Navigation layout */}
          <div className="flex gap-1 bg-[#FAF9F5] border border-[#e5e1da]/40 p-1 rounded-2xl shadow-sm">
            <button
              onClick={() => setActiveTab("home")}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "home"
                  ? "bg-[#5a5a40] text-amber-300 shadow"
                  : "text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>智慧抽籤地圖</span>
            </button>

            <button
              onClick={() => setActiveTab("explore")}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "explore"
                  ? "bg-[#5a5a40] text-amber-300 shadow"
                  : "text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <Megaphone className="w-3.5 h-3.5" />
              <span>好康報報 & 百寶箱</span>
            </button>
            
            <button
              onClick={() => setActiveTab("merchant")}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "merchant"
                  ? "bg-[#5a5a40] text-amber-300 shadow"
                  : "text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>商務應援合作</span>
            </button>
          </div>

          {/* Google SSO Login card */}
          <div className="flex items-center gap-2">
            {!firebaseUser ? (
              <button
                onClick={() => {
                  setAuthError(null);
                  setIsLoginModalOpen(true);
                }}
                className="bg-[#5a5a40] hover:bg-[#484833] text-white text-xs font-bold py-1.8 px-4 rounded-xl shadow-sm transition active:scale-95 flex items-center gap-1 border border-[#484833] cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-amber-300" />
                <span className="hidden sm:inline-block">中大帳密/身分登入</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-[#f4f4f0]/70 p-1.5 pr-3 rounded-2xl border border-[#e5e1da] shadow-sm">
                <div 
                  onClick={() => setIsProfileModalOpen(true)}
                  className="flex items-center gap-2 cursor-pointer hover:bg-stone-200/50 p-1 rounded-xl transition-all active:scale-95 text-left"
                  title="點擊設定個人美食身份、愛店牆與黑名單"
                  id="header-user-avatar-trigger"
                >
                  <img
                    src={firebaseUser.photoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + username}
                    alt="Avatar"
                    className="w-6.5 h-6.5 rounded-full object-cover shadow-sm ring-1 ring-[#5a5a40]/30"
                    referrerPolicy="no-referrer"
                  />
                  <div className="text-left leading-none">
                    <span className="text-[10px] text-[#3d3d3d] font-bold block truncate max-w-[80px]">
                      {username}
                    </span>
                    <span className={`text-[8px] font-bold tracking-widest ${
                      userRole === "admin" ? "text-rose-700" : userRole === "merchant" ? "text-amber-700" : "text-emerald-700"
                    }`}>
                      {userRole === "admin" ? "SUPERADMIN" : userRole === "merchant" ? "🏪 店家代表" : "🎓 學生/訪客"}
                    </span>
                  </div>
                </div>
                
                <button
                  onClick={handleSignOut}
                  className="p-1 hover:bg-[#e5e1da] rounded-lg transition ml-1 cursor-pointer"
                  title="登出系統"
                >
                  <LogOut className="w-3 h-3 text-rose-800" />
                </button>
              </div>
            )}
          </div>

        </div>
      </header>

      {/* Main Container body */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6">
        
        {/* TAB 1: HOME & MAP DECISION CENTER */}
        {activeTab === "home" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Control Column (Filters or Group lobby) */}
            <div className="lg:col-span-4 space-y-5 flex flex-col h-full justify-between">
              
              {/* Solo/Group consensus mode chooser */}
              <div className="bg-white rounded-3xl p-5 border border-[#e5e1da] shadow-sm flex flex-col gap-4 text-left">
                <span className="text-[10px] font-bold text-[#8a8a70] uppercase tracking-wider">
                  🎯 決策運作模式
                </span>

                <div className="grid grid-cols-2 gap-2 bg-[#FAF8F5] p-1 rounded-2xl border border-[#e5e1da]/45 shadow-inner">
                  <button
                    onClick={() => { setHomeSubMode("solo"); setRecommendationResult(null); }}
                    className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                      homeSubMode === "solo"
                        ? "bg-[#5a5a40] text-white shadow"
                        : "text-[#5a5a40] hover:bg-white"
                    }`}
                  >
                    👤 一人抽籤防雷
                  </button>

                  <button
                    onClick={() => { setHomeSubMode("group"); setRecommendationResult(null); }}
                    className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                      homeSubMode === "group"
                        ? "bg-[#5a5a40] text-white shadow"
                        : "text-[#5a5a40] hover:bg-white"
                    }`}
                  >
                    👥 室友聚餐公約
                  </button>
                </div>

                <p className="text-[10px] text-[#8a8a70] leading-normal font-sans">
                  {homeSubMode === "solo" 
                    ? "自動剔除個人避雷黑名單 (香之味牛肉或香菜、地東日式大蒜等)，配合獨創 CP 值權衡算法。"
                    : "多人聚會好難喬？房主發起，室友輸入 4 碼進房。系統自動撈取所有房員飲食雷區、在極限步行內找寻共識解答！"
                  }
                </p>
              </div>

              {/* MODE A: SOLO ACTIVE FILTERS */}
              {homeSubMode === "solo" && (
                <div className="bg-white rounded-3xl p-5 border border-[#e5e1da] shadow-sm flex flex-col gap-5 text-left flex-1">
                  
                  <div className="flex justify-between items-center border-b border-[#e5e1da]/40 pb-2">
                    <span className="text-xs font-bold text-[#3d3d2e] tracking-wide flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5" />
                      <span>美食決策防呆濾鏡</span>
                    </span>
                    <button 
                      onClick={() => {
                        setFilterCategory("all");
                        setFilterMaxPrice(300);
                        setFilterMaxDistance(20);
                        setFilterFreeRefills(false);
                        setFilterFreeSoupDrinks(false);
                        setFilterInStore(false);
                        setFilterTakeout(false);
                      }}
                      className="text-[10px] text-[#8a8a70] font-bold hover:text-[#5a5a40] cursor-pointer"
                    >
                      重置過濾
                    </button>
                  </div>

                  {/* Filter elements */}
                  <div className="space-y-4">
                    
                    {/* Category Selector */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-[#5a5a40]">想吃什麼大分類 :</span>
                      <div className="grid grid-cols-4 gap-1">
                        {["all", "台式", "日式", "港式", "美式", "飲料", "點心", "蔬食.素食"].slice(0, 8).map(c => (
                          <button
                            key={c}
                            onClick={() => setFilterCategory(c)}
                            className={`py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                              filterCategory === c
                                ? "bg-[#5a5a40] text-amber-300 border-[#5a5a40]"
                                : "bg-white text-[#8a8a70] border-[#e5e1da] hover:bg-[#e5e1da]/20"
                            }`}
                          >
                            {c === "all" ? "不限" : c}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Price Slider */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-[#5a5a40]">每人預算上限 :</span>
                        <span className="font-bold font-mono text-rose-700">
                          {filterMaxPrice >= 500 ? "NT$ 500 元以上 / 不限" : `NT$ ${filterMaxPrice} 元以內`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="500"
                        step="10"
                        value={filterMaxPrice}
                        onChange={(e) => setFilterMaxPrice(Number(e.target.value))}
                        className="w-full accent-[#5a5a40]"
                      />
                    </div>

                    {/* Distance Slider */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-[#5a5a40]">能接受步行時間 :</span>
                        <span className="font-bold font-mono text-rose-700">🚶 {filterMaxDistance} 分鐘以內</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="1"
                        value={filterMaxDistance}
                        onChange={(e) => setFilterMaxDistance(Number(e.target.value))}
                        className="w-full accent-[#5a5a40]"
                      />
                    </div>

                    {/* Amenities Checkboxes */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#f4f4f0]">
                      <label className="flex items-center gap-1.5 text-xs text-[#3d3d2e] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterFreeRefills}
                          onChange={(e) => setFilterFreeRefills(e.target.checked)}
                          className="w-3.5 h-3.5 accent-[#5a5a40]"
                        />
                        <span>免費續飯/麵</span>
                      </label>

                      <label className="flex items-center gap-1.5 text-xs text-[#3d3d2e] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterFreeSoupDrinks}
                          onChange={(e) => setFilterFreeSoupDrinks(e.target.checked)}
                          className="w-3.5 h-3.5 accent-[#5a5a40]"
                        />
                        <span>附湯/飲料</span>
                      </label>

                      <label className="flex items-center gap-1.5 text-xs text-[#3d3d2e] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterInStore}
                          onChange={(e) => setFilterInStore(e.target.checked)}
                          className="w-3.5 h-3.5 accent-[#5a5a40]"
                        />
                        <span>內用席位</span>
                      </label>

                      <label className="flex items-center gap-1.5 text-xs text-[#3d3d2e] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterTakeout}
                          onChange={(e) => setFilterTakeout(e.target.checked)}
                          className="w-3.5 h-3.5 accent-[#5a5a40]"
                        />
                        <span>外帶外送</span>
                      </label>
                    </div>

                  </div>

                  {/* AI Persona block */}
                  <div className="bg-[#FAF9F5] p-4 rounded-2xl border border-[#e5e1da]/50 space-y-2 mt-2">
                    <span className="text-[10px] font-bold text-[#8a8a70] uppercase flex items-center gap-1.5 font-serif">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                      <span>AI 口語導購智囊</span>
                    </span>
                    
                    <select
                      value={selectedPersona}
                      onChange={(e) => setSelectedPersona(e.target.value)}
                      className="bg-white border border-[#e5e1da] p-2 rounded-xl text-xs font-bold text-[#5a5a40] w-full outline-none"
                    >
                      {DEFAULT_PERSONAS.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    
                    <p className="text-[10.5px] text-[#8a8a70]/95 leading-normal italic">
                      {DEFAULT_PERSONAS.find(p => p.id === selectedPersona)?.desc}
                    </p>
                  </div>

                  {/* BIG TRIGGER ROLL BUTTON */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-2">
                    <button
                      onClick={() => handleGenerateDecision(false)}
                      disabled={isRolling}
                      className="bg-gradient-to-tr from-[#5a5a40] to-[#3d3d2e] text-white py-4.5 px-4 rounded-2xl shadow-md hover:shadow-lg transition text-xs sm:text-sm font-semibold tracking-wide border border-[#5a5a40]/30 select-none cursor-pointer text-center"
                    >
                      {isRolling ? "命運之輪極速飛滾中..." : "🎰 一鍵交給命運！"}
                    </button>

                    <button
                      onClick={() => handleGenerateDecision(true)}
                      disabled={isRolling || !firebaseUser}
                      className="bg-[#3d3d2e] hover:bg-stone-900 text-amber-300 py-4.5 px-4 rounded-2xl shadow-md hover:shadow-lg transition text-xs sm:text-sm font-semibold tracking-wide border border-[#5a5a40]/50 select-none cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>{isRolling ? "AI 精耕細算中..." : "🤖 啟動 AI 推薦"}</span>
                    </button>
                  </div>
                  {!firebaseUser && (
                    <span className="text-[9px] text-[#8a8a70] text-center block mt-1">
                      * 登入後可啟用 AI 推薦及套用避雷屏蔽權限！
                    </span>
                  )}
                </div>
              )}

              {/* MODE B: GROUP ROOM CONSENSUS */}
              {homeSubMode === "group" && (
                <div className="bg-white rounded-3xl p-5 border border-[#e5e1da] shadow-sm flex flex-col gap-4 text-left flex-1 justify-between">
                  <div className="flex flex-col gap-3.5">
                    <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100 flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-emerald-800 tracking-wider flex items-center gap-1.5 font-serif">
                        <Users className="w-4 h-4 text-emerald-700" />
                        <span>多人口味難調？AI 交叉聚餐共識</span>
                      </h4>
                      <p className="text-[11px] text-emerald-700/80 leading-normal">
                        自動分析所有加入房員飲食雷區（如不吃牛肉、不辣等）、能接受步行分鐘與最高平均預算，一鍵幫大家決定吃什麼！
                      </p>
                    </div>

                    {!currentRoom ? (
                      <div className="flex flex-col gap-3 mt-1">
                        <button
                          onClick={handleCreateGroup}
                          className="text-left bg-gradient-to-tr from-[#5a5a40] to-[#3d3d2e] text-amber-300 font-bold py-4 px-4 rounded-2xl shadow flex flex-col justify-center items-start gap-1 cursor-pointer hover:shadow-lg transition active:scale-95 border border-[#5a5a40]/20 w-full"
                        >
                          <Plus className="w-5 h-5 text-amber-300" />
                          <span className="text-xs sm:text-sm font-serif text-white">建立聚餐共識房</span>
                          <span className="text-[10px] text-amber-200/80 font-normal">您將成為房主發起人</span>
                        </button>
                        
                        <div className="bg-stone-50 border border-[#e5e1da] p-4 rounded-2xl shadow-sm flex flex-col gap-2">
                          <span className="text-xs font-bold text-[#3d3d3d]">輸入室友 4 碼決策房號 :</span>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              maxLength={4}
                              placeholder="例如 : 2056"
                              value={roomCodeInput}
                              onChange={(e) => setRoomCodeInput(e.target.value)}
                              className="bg-white border border-[#e5e1da] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#5a5a40] leading-tight focus:outline-none focus:border-[#5a5a40] flex-1"
                            />
                            <button
                              onClick={handleJoinGroup}
                              className="bg-[#5a5a40] hover:bg-[#484833] text-white text-xs font-bold px-4 rounded-xl cursor-pointer transition shadow-sm"
                            >
                              加入聚餐
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-stone-50 border border-[#e5e1da] p-4 rounded-2xl flex flex-col gap-3 text-left shadow-sm">
                        
                        <div className="flex items-center justify-between border-b border-[#e5e1da] pb-2">
                          <div>
                            <span className="text-[10px] text-[#8a8a70] font-bold block">房主發起人: {currentRoom.owner_name}</span>
                            <h4 className="text-sm font-bold text-[#3d3d3d] font-serif">ROOM ROOM: #{currentRoom.room_id}</h4>
                          </div>
                          
                          <button 
                            onClick={handleGroupLeave}
                            className="text-[10.5px] text-rose-800 font-bold px-3 py-1.5 bg-rose-50 hover:bg-rose-100 rounded-xl cursor-pointer transition border border-rose-200"
                          >
                            離開房間
                          </button>
                        </div>

                        <div>
                          <p className="text-[10px] font-bold text-[#5a5a40] mb-2.5">
                            當前已進房成員名冊 ({currentRoom.members.length} 人) :
                          </p>
                          
                          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                            {currentRoom.members.map((mem) => (
                              <div key={mem.user_id} className="flex justify-between items-center text-xs bg-white py-2 px-3 rounded-xl border border-[#e5e1da] shadow-inner-sm">
                                <span className="font-semibold text-[#3d3d3d] flex items-center gap-1">
                                  <span>👤</span>
                                  <span>{mem.username}</span>
                                </span>
                                
                                <div className="text-[10px] text-[#8a8a70]">
                                  <span>${mem.max_price}元 </span>
                                  <span>| {mem.max_distance}分</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Host adjustments */}
                        <div className="flex flex-col gap-2 pt-2 border-t border-[#e5e1da] text-xs">
                          <span className="font-bold text-[#3d3d3d] block">同步調整我的群組限制 :</span>
                          
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span>最高分攤(NT$): </span>
                              <input 
                                type="number" 
                                value={groupMaxPrice}
                                onChange={(e) => {
                                  setGroupMaxPrice(Number(e.target.value));
                                }}
                                className="border border-[#e5e1da] rounded-xl w-full p-2.5 mt-1 font-bold text-rose-800 text-center bg-white"
                              />
                            </div>
                            <div>
                              <span>大家能走(分): </span>
                              <input 
                                type="number" 
                                value={groupMaxDistance}
                                onChange={(e) => {
                                  setGroupMaxDistance(Number(e.target.value));
                                }}
                                className="border border-[#e5e1da] rounded-xl w-full p-2.5 mt-1 font-bold text-rose-800 text-center bg-white"
                              />
                            </div>
                          </div>
                          
                          <button
                            onClick={handleJoinGroup}
                            className="bg-[#5a5a40]/10 hover:bg-[#5a5a40]/25 text-[#5a5a40] text-[10px] font-bold py-1.5 rounded-lg text-center cursor-pointer transition border border-dashed border-[#5a5a40]/30"
                          >
                            🔄 同步/更新我的以上數值到聚餐房中
                          </button>
                        </div>

                        <button
                          onClick={handleCalculateGroupDecision}
                          disabled={loadingGroupDecision || currentRoom.members.length === 0}
                          className="w-full bg-[#5a5a40] hover:bg-[#484833] text-white font-bold py-3 px-3 rounded-xl shadow-md text-xs sm:text-sm flex items-center justify-center gap-1.5 mt-2 transition cursor-pointer border border-[#484833]"
                        >
                          {loadingGroupDecision ? (
                            <>
                              <RefreshCw className="w-4 h-4 text-[#e5e1da] animate-spin" />
                              <span>AI 交叉篩除防踩雷運算中...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4 text-amber-300" />
                              <span>群組凝聚一鍵決策！</span>
                            </>
                          )}
                        </button>
                        
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Right Display Area */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* INTERACTIVE NCU VECTOR MAP (Flat fly-to transition) */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-semibold tracking-wide text-[#3d3d3d] flex items-center gap-2 font-serif">
                    <MapPin className="w-4 h-4 text-[#5a5a40]" />
                    <span>智慧地圖定位儀：中央大學生活圈 (1.5KM 內)</span>
                  </h3>
                  <span className="text-[11px] text-[#8a8a70]">
                    合格展示商家顆粒: <strong>{restaurants.filter(r => !blacklistRestIds.includes(r.restaurant_id)).length}</strong> 間 
                  </span>
                </div>
                
                <CampusMap
                  restaurants={restaurants}
                  lovedRestIds={lovedRestIds}
                  blacklistRestIds={blacklistRestIds}
                  selectedRestaurant={recommendationResult?.restaurant || null}
                  userLocation={userLocation}
                  onSelectRestaurant={(r) => {
                    const coords = getRestaurantCoords(r);
                    setMapTarget({ lat: coords.lat, lng: coords.lng });
                    setMapZoom(2.5);
                    setRecommendationResult({
                      restaurant: r,
                      reason: "🗣️ 您點擊了地圖大頭針，以下已為您調出店家專卡及動態推薦招牌料理！",
                      ai_generated: false
                    });
                    const dishes = menuItems.filter(m => m.restaurant_id === r.restaurant_id);
                    setRolledDish(dishes.length > 0 ? dishes[0] : null);
                    setRerollCount(0);
                    setIsMenuExpanded(false);
                  }}
                  mapTarget={mapTarget}
                  mapZoom={mapZoom}
                  setMapTarget={setMapTarget}
                  setMapZoom={setMapZoom}
                />
              </div>

              {/* ROULETTE / RECOMMENDATION CARD (Result Card Panel) */}
              <AnimatePresence mode="wait">
                {isRolling && (
                  <motion.div
                    key="rolling-card"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#fcfbf9] border border-dashed border-[#e5e1da] rounded-3xl p-12 text-center flex flex-col items-center justify-center gap-4 shadow-sm"
                  >
                    <RefreshCw className="w-10 h-10 text-[#5a5a40] animate-spin" />
                    <h3 className="text-lg font-bold text-[#3d3d3d] font-serif tracking-wider">
                      命運輪盤瘋狂空轉中...
                    </h3>
                    <p className="text-xs text-[#8a8a70] max-w-sm">
                      系統正在對齊您的黑名單防踩雷條約、冷氣配置與 GPS 地理座標，正為您從
                      <span className="text-[#3d3d3d] font-bold mx-1">【{restaurants.length}】</span>
                      家優質候選特約學餐中撈取！
                    </p>
                  </motion.div>
                )}

                {!isRolling && recommendationResult && (
                  <motion.div
                    key="recommendation-card"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-[#e5e1da] rounded-3xl p-5 sm:p-6 shadow flex flex-col md:flex-row gap-6 relative overflow-hidden"
                  >
                    
                    {/* Badge alert */}
                    <div className="absolute top-0 right-0 bg-yellow-500 text-[#3d3d2e] text-[9px] font-extrabold py-1 px-3 rounded-bl-xxl flex items-center gap-0.5 tracking-wider uppercase">
                      ★ TODAY'S DESTINY
                    </div>

                    {/* Left half - Restaurant visuals and stats */}
                    <div className="w-full md:w-5/12 shrink-0 flex flex-col gap-3">
                      <div className="h-44 w-full rounded-2xl bg-[#fdfdfb] relative overflow-hidden shadow-inner-sm">
                        <img
                          src={recommendationResult.restaurant.img_url || getRestaurantImageUrl(recommendationResult.restaurant.restaurant_id, recommendationResult.restaurant.category, recommendationResult.restaurant.name)}
                          alt={recommendationResult.restaurant.name}
                          className="w-full h-full object-cover opacity-90 transition duration-700"
                          referrerPolicy="no-referrer"
                        />
                        
                        <div className="absolute bottom-2 left-2 bg-stone-900/40 backdrop-blur-sm text-white px-2 py-0.5 rounded-full text-[10px] font-semibold">
                          ⭐ {formatFixed(recommendationResult.restaurant.rating, 1, 4.2)} / {getRestaurantArea(recommendationResult.restaurant.restaurant_id, recommendationResult.restaurant.location_desc)}
                        </div>
                      </div>

                      <div className="text-left py-1">
                        <h3 className="text-sm font-bold text-[#3d3d2e] font-serif break-words">
                          {recommendationResult.restaurant.name}
                        </h3>
                        
                        <div className="flex flex-wrap gap-1 items-center text-[10.5px] text-[#8a8a70] mt-1.5">
                          <span className="bg-[#FAF8F5] p-1 rounded border border-[#e5e1da] font-bold">{recommendationResult.restaurant.category}</span>
                          <span>•</span>
                          <span>步行 {recommendationResult.restaurant.walking_distance}分</span>
                          <span>•</span>
                          <span>均消價格 NT${recommendationResult.restaurant.avg_price}左右</span>
                        </div>

                        {/* Tags list */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="text-[9px] bg-sky-50 text-sky-800 font-bold px-1.5 py-0.5 rounded-lg border border-sky-100">
                            {recommendationResult.restaurant.has_ac ? "❄️ 有冷氣" : "💨 通風扇"}
                          </span>
                          <span className="text-[9px] bg-[#FAF9F0] text-[#5a5a40] font-bold px-1.5 py-0.5 rounded-lg border border-[#e5e1da]">
                            {recommendationResult.restaurant.is_vegetarian ? "🥗 提供蔬食" : "🥩 葷素皆備"}
                          </span>
                          {lovedRestIds.includes(recommendationResult.restaurant.restaurant_id) && (
                            <span className="text-[9px] bg-rose-50 text-rose-800 font-bold px-1.5 py-0.5 rounded-lg border border-rose-100 flex items-center gap-0.5">
                              ❤️ 最愛認證店
                            </span>
                          )}

                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-lg border ${
                            isRestaurantOpenNow((recommendationResult.restaurant as any).business_hours)
                              ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                              : "bg-rose-50 text-rose-800 border-rose-100"
                          }`}>
                            {isRestaurantOpenNow((recommendationResult.restaurant as any).business_hours)
                              ? "🟢 營業中"
                              : "🔴 目前未營業"}
                          </span>

                          <span className="text-[9px] bg-amber-50 text-amber-800 font-bold px-1.5 py-0.5 rounded-lg border border-amber-100">
                            🕒 {getTodayBusinessHour((recommendationResult.restaurant as any).business_hours)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right half - Recommended Menu Dish detail cards */}
                    <div className="flex-1 flex flex-col justify-between text-left gap-4">
                      
                      <div className="space-y-3">
                        {/* Text explanation */}
                        <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-[#e5e1da]/60">
                          <span className="text-[9.5px] font-bold text-[#8a8a70] uppercase flex items-center gap-1.5 font-serif mb-1">
                            {recommendationResult.ai_generated ? "🤖 AI 導購助理智能分析 :" : "🎯 命運輪盤精準判決 :"}
                          </span>
                          <p className="text-xs text-[#3d3d3d] leading-relaxed break-words font-sans whitespace-pre-line">
                            {recommendationResult.reason}
                          </p>
                        </div>

                        {/* Dish profile */}
                        {rolledDish && (
                          <div className="border border-[#e5e1da]/60 rounded-2xl p-4 bg-gradient-to-tr from-[#fdfbf7] to-white flex gap-3 relative overflow-hidden items-center shadow-inner-sm">
                            <div className="absolute top-2 right-2 bg-rose-500 fill-rose-500 text-white text-[8px] font-bold py-0.5 px-2 rounded-full">
                              今日命定餐點
                            </div>

                            <img
                              src={rolledDish.img_url || getMealImageUrl(rolledDish.item_name, rolledDish.price)}
                              alt={rolledDish.item_name}
                              className="w-14 h-14 rounded-xl object-cover shrink-0 shadow border border-[#FAF8F5]"
                              referrerPolicy="no-referrer"
                            />

                            <div className="flex-1 min-w-0 pr-12">
                              <h4 className="text-xs font-bold text-[#3d3d3d] truncate">
                                {rolledDish.item_name}
                              </h4>
                              <p className="text-[10px] text-[#8a8a70] mt-0.5 truncate">
                                {rolledDish.ingredients && rolledDish.ingredients.length > 0 
                                  ? `配料: ${rolledDish.ingredients.join(', ')}`
                                  : "精緻鮮烹美味，口感層次絕妙"
                                }
                              </p>
                              <div className="text-xs font-bold text-rose-600 font-mono mt-1">${rolledDish.price}</div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Detailed Menu items expansion */}
                      {isMenuExpanded && (
                        <div className="bg-[#FAF9F5]/40 border border-[#e5e1da]/50 p-3 rounded-2xl">
                          <span className="text-[10px] font-bold text-[#5a5a40] block mb-2">
                            📖 該商家其他熱架招牌料理目錄 :
                          </span>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {menuItems
                              .filter(m => m.restaurant_id === recommendationResult.restaurant.restaurant_id)
                              .map((m, idx) => (
                                <div key={idx} className="flex justify-between items-center text-[10.5px] border-b border-[#FAF9F5] pb-1 hover:bg-white px-1.5 py-0.5 rounded transition">
                                  <span className="font-semibold text-[#3d3d3d]">{m.item_name}</span>
                                  <div className="flex gap-2 items-center font-mono">
                                    <span className="text-[9px] text-[#8a8a70]">
                                      {m.spicy_level !== "無辣" ? `🌶️ ${m.spicy_level}` : "無辣"}
                                    </span>
                                    <span className="font-bold text-rose-650">${m.price}</span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* DOUBLE REROLL BUTTON TRIGGERS with warning locked counts */}
                      <div className="pt-2 border-t border-[#f4f4f0] space-y-2">
                        
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                          <button
                            onClick={() => setIsMenuExpanded(!isMenuExpanded)}
                            className="text-[10.5px] text-[#5a5a40] font-bold hover:underline cursor-pointer"
                          >
                            {isMenuExpanded ? "▲ 隱藏詳細菜單" : "👉 展開詳細菜單"}
                          </button>

                          <div className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 flex items-center gap-1">
                            <span>選擇防禦保護：</span>
                            <span>本餐已進行重選 <strong>{rerollCount}</strong> / 3 次</span>
                          </div>
                        </div>

                        {/* Combined lock trigger */}
                        {rerollCount >= 3 ? (
                          <div className="bg-rose-50 border border-rose-250 p-3 rounded-2xl flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="text-[10.5px] leading-relaxed text-rose-900">
                              <strong>🚫 宿命決策強制上鎖！</strong> 您已進行滿額 3 次選擇權限（治好您的選擇障礙學長條款）。請尊重這碗今日的「命定之選」，清除重選猶豫耽誤，快動身前往享用吧！
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={handleRerollEntireShop}
                              className="bg-white hover:bg-stone-50 text-stone-700 border border-[#e5e1da] text-xs font-bold py-2 px-3 rounded-xl shadow-sm cursor-pointer transition flex items-center justify-center gap-1.5"
                            >
                              <span>🔄 重新抽一家店</span>
                            </button>
                            
                            <button
                              onClick={handleRerollJustDish}
                              className="bg-[#5a5a40] hover:bg-[#484833] text-white text-xs font-bold py-2 px-3 rounded-xl shadow-sm cursor-pointer transition flex items-center justify-center gap-1.5 border border-[#484833]"
                            >
                              <span>🍛 換一道菜試試</span>
                            </button>
                          </div>
                        )}

                      </div>

                    </div>

                  </motion.div>
                )}
              </AnimatePresence>

            </div>

          </div>
        )}

        {/* TAB 2: EXPLORE (GOOD DEALS & ALL RESTAURANTS DIRECTORY) */}
        {activeTab === "explore" && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <ProfileExplore
              restaurants={restaurants}
              menuItems={menuItems}
              lovedRestIds={lovedRestIds}
              blacklistRestIds={blacklistRestIds}
              blacklistMeals={blacklistMeals}
              username={username}
              onUpdateUsername={handleUpdateUsername}
              onToggleLoveRest={handleToggleLoveRest}
              onToggleBlacklistRest={handleToggleBlacklistRest}
              onToggleBlacklistMeal={handleToggleBlacklistMeal}
              onFocusRestaurantOnMap={(id) => {
                handleFocusRestaurantOnMap(id);
                setActiveTab("home");
              }}
              deals={deals}
              userRole={userRole}
              onUpdateRole={handleUpdateRole}
              mode="explore-only"
            />
          </div>
        )}

        {/* TAB 3: MERCHANT SUBMISSION & ADMIN PORTAL */}
        {activeTab === "merchant" && (
          <MerchantPortal
            restaurants={restaurants}
            currentUserEmail={firebaseUser?.email || null}
            currentUserRole={userRole}
            onRefreshAllData={fetchAllData}
          />
        )}

      </main>

      {/* PERSONAL PROFILE SETTINGS MODAL */}
      <AnimatePresence>
        {isProfileModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm sm:backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-4xl w-full border border-[#e5e1da] shadow-2xl flex flex-col gap-4 relative font-sans text-stone-850 h-[85vh] overflow-y-auto"
            >
              {/* Close Button */}
              <button
                onClick={() => setIsProfileModalOpen(false)}
                className="absolute top-4 right-4 p-2 hover:bg-stone-50 rounded-full text-stone-450 hover:text-stone-700 transition cursor-pointer z-10"
                id="close-profile-modal-btn"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2.5 pb-2 border-[#e5e1da]/50 mt-1">
                <div className="w-8 h-8 rounded-full bg-[#5a5a40]/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-[#5a5a40]" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm sm:text-base font-bold font-serif text-[#3d3d3d]">
                    個人設定與美食百寶箱
                  </h3>
                  <p className="text-[10px] text-[#8a8a70]">
                    管理您的校園名冊、關注愛店標註、自訂黑名單避雷，即時發掘特惠好禮
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-1">
                <ProfileExplore
                  restaurants={restaurants}
                  menuItems={menuItems}
                  lovedRestIds={lovedRestIds}
                  blacklistRestIds={blacklistRestIds}
                  blacklistMeals={blacklistMeals}
                  username={username}
                  onUpdateUsername={handleUpdateUsername}
                  onToggleLoveRest={handleToggleLoveRest}
                  onToggleBlacklistRest={handleToggleBlacklistRest}
                  onToggleBlacklistMeal={handleToggleBlacklistMeal}
                  onFocusRestaurantOnMap={(id) => {
                    handleFocusRestaurantOnMap(id);
                    setIsProfileModalOpen(false); // Close modal when navigating map
                  }}
                  deals={deals}
                  userRole={userRole}
                  onUpdateRole={handleUpdateRole}
                  mode="profile-only"
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* BRAND NEW: RESILIENT ROLE-BASED AUTH MODAL */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm sm:backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full border border-[#e5e1da] shadow-2xl flex flex-col gap-5 relative font-sans text-stone-850"
            >
              {/* Close Button */}
              <button
                onClick={() => setIsLoginModalOpen(false)}
                className="absolute top-4 right-4 p-2 hover:bg-stone-50 rounded-full text-stone-400 hover:text-stone-700 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center flex flex-col gap-2 mt-2">
                <div className="mx-auto bg-[#5a5a40]/10 p-3.5 rounded-full w-fit">
                  <UtensilsCrossed className="w-7 h-7 text-[#5a5a40]" />
                </div>
                <h3 className="text-lg font-bold font-serif text-[#3d3d3d] mt-1">
                  中大美食抽抽樂・校園身分登入
                </h3>
                <p className="text-xs text-[#8a8a70]">
                  登入即可自動載入您的避雷黑名單、最愛加權、並參與群組隨機決策
                </p>
              </div>

              {/* Step 1: Identity Selection */}
              <div className="flex flex-col gap-2.5">
                <span className="text-xs font-bold text-[#5a5a40]">第一步：請點選您的主要身分 (Role)</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLoginRole("user");
                      setQuickName("");
                    }}
                    className={`p-3 rounded-2xl border text-left transition relative overflow-hidden flex flex-col gap-1 cursor-pointer ${
                      loginRole === "user"
                        ? "border-[#5a5a40] bg-[#5a5a40]/5 ring-1 ring-[#5a5a40]/30"
                        : "border-[#e5e1da] hover:bg-stone-50"
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="text-xs font-bold text-stone-800">🎓 學生 / 訪客</span>
                      {loginRole === "user" && (
                        <span className="text-[10px] bg-[#5a5a40] text-white px-1.5 py-0.5 rounded-md font-mono">ACTIVE</span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#8a8a70]">載入黑名單與客製偏好設定</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLoginRole("merchant");
                      setQuickName("");
                    }}
                    className={`p-3 rounded-2xl border text-left transition relative overflow-hidden flex flex-col gap-1 cursor-pointer ${
                      loginRole === "merchant"
                        ? "border-[#5a5a40] bg-[#5a5a40]/5 ring-1 ring-[#5a5a40]/30"
                        : "border-[#e5e1da] hover:bg-[#FAF8F5]"
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="text-xs font-bold text-stone-800">🏪 合作店家</span>
                      {loginRole === "merchant" && (
                        <span className="text-[10px] bg-[#5a5a40] text-white px-1.5 py-0.5 rounded-md font-mono">ACTIVE</span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#8a8a70]">自主上架提案與新品折扣登錄</span>
                  </button>
                </div>

                {/* Sub-role: Admin Toggle (Secret) */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setLoginRole(loginRole === "admin" ? "user" : "admin")}
                    className={`text-[10px] font-bold py-1 px-2.5 rounded-lg border transition cursor-pointer ${
                      loginRole === "admin"
                        ? "bg-rose-50 text-rose-800 border-rose-200"
                        : "text-[#8a8a70] hover:text-[#5a5a40] border-transparent hover:border-[#e5e1da] bg-stone-50"
                    }`}
                  >
                    🛡️ 安全稽核管理員身分 (第六組)
                  </button>
                </div>
              </div>

              {/* Step 2: Login Options */}
              <div className="flex flex-col gap-3 pt-1 border-t border-[#e5e1da]/50">
                
                {/* Form for quick login */}
                <form onSubmit={handleQuickSignIn} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-[#5a5a40]">第二步：選擇登入管道</span>
                      <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md font-bold">推薦：免阻擋快速通道</span>
                    </div>
                    <input
                      type="text"
                      placeholder={loginRole === "merchant" ? "請輸入特約商家店名 (選填)" : loginRole === "admin" ? "請輸入小組稱呼 (選填)" : "請輸入您的中大暱稱 / 綽號 (選填)"}
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      className="bg-[#faf8f5] border border-[#e5e1da] rounded-xl px-3 py-2 text-xs text-[#5a5a40] focus:outline-none focus:border-[#5a5a40]"
                    />
                    {loginRole === "merchant" && (
                      <input
                        type="email"
                        placeholder="請輸入商家聯絡 Email (選填)"
                        value={quickEmail}
                        onChange={(e) => setQuickEmail(e.target.value)}
                        className="bg-[#faf8f5] border border-[#e5e1da] rounded-xl px-3 py-2 text-xs text-[#5a5a40] focus:outline-none focus:border-[#5a5a40]"
                      />
                    )}
                  </div>
                  
                  <button
                    type="submit"
                    className="w-full bg-[#5a5a40] hover:bg-[#484833] text-white text-xs font-bold py-2.5 rounded-xl shadow-md transition active:scale-98 flex items-center justify-center gap-1.5 border border-[#484833] cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5 text-amber-300" />
                    <span>⚡ 快速免密登入（首選防阻擋）</span>
                  </button>
                </form>

                <div className="relative text-center my-1 select-none">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#e5e1da]/50"></div></div>
                  <span className="relative bg-white px-3 text-[10px] text-[#a0a090] font-bold">或使用官方安全對接</span>
                </div>

                {/* Google authenticator button */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="w-full bg-white hover:bg-[#FAF8F5] text-stone-700 text-xs font-bold py-2.5 rounded-xl shadow-sm border border-[#e5e1da] transition active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-rose-500" />
                  <span>使用 Google 帳號授權登入</span>
                </button>

                {authError && (
                  <div className="p-3 rounded-xl bg-orange-50 border border-orange-100 text-[11px] text-stone-700 flex flex-col gap-1 mt-1 leading-snug">
                    <span className="font-bold flex items-center gap-1 text-orange-850">⚠️ 登入阻擋提示：</span>
                    <span>iFrame 預覽受瀏覽器安全防護限制，容易封鎖 Google Pop-up 彈窗。<b>強烈建議改用上方「快速免密登入」，零阻擋且功能完全等同！</b></span>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="w-full bg-[#fdfdfb] border-t border-[#e5e1da]/50 py-5 text-center text-xs text-[#8a8a70] tracking-wide font-sans mt-12 bg-white">
        <p className="font-semibold text-[#5a5a40]">中大美食抽抽樂・NCU Smart Food Roulette © 2026</p>
        <p className="text-[10px] text-[#a0a090] mt-1">
          由第六組精心打造・安全保障與排雷雙引擎對接，守護您的每一頓好滋味
        </p>
      </footer>

    </div>
  );
}
