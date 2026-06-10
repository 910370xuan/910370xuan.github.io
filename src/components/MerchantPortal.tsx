/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Restaurant, MenuItem } from "../types";
import { collection, getDocs, doc, setDoc, query, where, deleteDoc } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { Plus, Trash, Check, X, Shield, RefreshCw, Upload, Camera, ListPlus, Sliders, MapPin, Edit3, Save, UserCheck, UserX, Image, AlertTriangle, BookOpen, Database } from "lucide-react";

interface MerchantPortalProps {
  restaurants: Restaurant[];
  currentUserEmail: string | null;
  currentUserRole?: string | null;
  onRefreshAllData: () => void;
}

export default function MerchantPortal({
  restaurants,
  currentUserEmail,
  currentUserRole,
  onRefreshAllData
}: MerchantPortalProps) {
  const [roleMode, setRoleMode] = useState<"merchant" | "admin">("merchant");
  
  // Proposals sync lists
  const [proposals, setProposals] = useState<any[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ADMIN CONTROL STRUCTURE STATES
  const [adminSubTab, setAdminSubTab] = useState<"audit" | "direct" | "admins">("audit");
  
  // Direct edit states
  const [selectedRestIdForEdit, setSelectedRestIdForEdit] = useState<number | null>(null);
  const [directRestName, setDirectRestName] = useState("");
  const [directRestCat, setDirectRestCat] = useState("台式");
  const [directRestPrice, setDirectRestPrice] = useState(100);
  const [directRestWalk, setDirectRestWalk] = useState(3);
  const [directRestLocation, setDirectRestLocation] = useState("");
  const [directRestLat, setDirectRestLat] = useState("24.9700");
  const [directRestLng, setDirectRestLng] = useState("121.1915");
  const [directHasAc, setDirectHasAc] = useState(true);
  const [directIsVeg, setDirectIsVeg] = useState(false);
  const [directIsMidnight, setDirectIsMidnight] = useState(false);
  const [directIsOpen, setDirectIsOpen] = useState(true);

  // Directly loaded menu items for the selected restaurant
  const [directMenuItems, setDirectMenuItems] = useState<MenuItem[]>([]);
  const [loadingDirectMenu, setLoadingDirectMenu] = useState(false);

  // For adding a new menu item
  const [newMealName, setNewMealName] = useState("");
  const [newMealPrice, setNewMealPrice] = useState(85);
  const [newMealSpicy, setNewMealSpicy] = useState<"無辣" | "微辣" | "中辣" | "大辣">("無辣");
  const [newMealIngredients, setNewMealIngredients] = useState("");

  // OCR result states
  const [ocrResults, setOcrResults] = useState<any[]>([]);
  const [isDirectScanning, setIsDirectScanning] = useState(false);

  // Admin roster config states
  const [adminEmailsList, setAdminEmailsList] = useState<any[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");

  // Merchant creation states
  const [propType, setPropType] = useState<"new_restaurant" | "new_deal" | "new_dish" | "correction_report">("new_restaurant");
  
  // 3. New Dish form fields
  const [newDishName, setNewDishName] = useState("");
  const [newDishPrice, setNewDishPrice] = useState(85);
  const [newDishSpicy, setNewDishSpicy] = useState<"無辣" | "微辣" | "中辣" | "大辣">("無辣");
  const [newDishIngredients, setNewDishIngredients] = useState("");

  // 4. Correction Report form fields
  const [correctionCategory, setCorrectionCategory] = useState("價格標示有誤");
  const [correctionDetails, setCorrectionDetails] = useState("");
  
  // 1. Restaurant form fields
  const [restName, setRestName] = useState("");
  const [restCat, setRestCat] = useState("台式");
  const [restWalk, setRestWalk] = useState(3);
  const [restPrice, setRestPrice] = useState(100);
  const [restLocation, setRestLocation] = useState("");
  const [restLat, setRestLat] = useState("24.9700");
  const [restLng, setRestLng] = useState("121.1915");
  const [hasAc, setHasAc] = useState(true);
  const [isVegetarian, setIsVegetarian] = useState(false);
  const [isMidnight, setIsMidnight] = useState(false);
  const [googlePlaceId, setGooglePlaceId] = useState("");
  const [googleMapsUri, setGoogleMapsUri] = useState("");
  const [googleBusinessHours, setGoogleBusinessHours] = useState<string[]>([]);
  const [googlePhoneNumber, setGooglePhoneNumber] = useState("");
  const [googleMenuUrl, setGoogleMenuUrl] = useState("");
  const [googleImageUrl, setGoogleImageUrl] = useState("");
  const [googleWebsiteUri, setGoogleWebsiteUri] = useState("");
  const [googleRating, setGoogleRating] = useState<number | null>(null);

  // 1.1 Dishes nested construction
  const [builtDishes, setBuiltDishes] = useState<any[]>([
    { item_name: "招牌主打餐點", price: 80, spicy_level: "無辣", ingredients: "招牌配料" }
  ]);

  // OCR Loading
  const [isScanningOCR, setIsScanningOCR] = useState(false);

  // 2. Deal form fields
  const [targetRestId, setTargetRestId] = useState<string>("");
  const [dealOffer, setDealOffer] = useState("");
  const [dealCode, setDealCode] = useState("");

  const isAdmin = currentUserEmail === "910370ctgs@gmail.com" || currentUserRole === "admin";
  const [isSeedingLocally, setIsSeedingLocally] = useState(false);
  const [isSyncingGooglePlaces, setIsSyncingGooglePlaces] = useState(false);

  const [isLookingUpPlace, setIsLookingUpPlace] = useState(false);

  const handleLocalSeeding = async () => {
    if (!window.confirm("⚠️ 確定要一鍵重建/同步中大官方餐廳與菜單資料庫至 Firestore 嗎？此操作將會安全比對寫入 92 間校區主力店家及完整推薦指標！")) return;
    setIsSeedingLocally(true);
    try {
      const res = await fetch("/api/admin/seed-restaurants-from-local", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(`🎉 核心資料載入成功！共導入 ${data.restaurantsSeeded} 間特色餐廳及 ${data.menuItemsSeeded} 道嚴選招牌菜單，已全自動同步寫入 Firestore 與全站緩存！`);
        onRefreshAllData();
      } else {
        alert(`❌ 資料庫同步失敗: ${data.error || "未知錯誤"}`);
      }
    } catch (err: any) {
      console.error(err);
      alert("❌ 執行本機 seeding 時發生連線異常，請檢查伺服器狀態與權限！");
    } finally {
      setIsSeedingLocally(false);
    }
  };
  const handleGooglePlacesSync = async () => {
    if (!isAdmin) {
      alert("⚠️ 僅管理員可以同步 Google Maps 餐廳資料。");
      return;
    }

    if (
      !window.confirm(
        "確定要從 Google Maps / Places API 自動同步中央大學周邊餐廳資料嗎？\n\n系統會將 Google Maps 上查到的餐廳資料寫入 Firestore。"
      )
    ) {
      return;
    }

    setIsSyncingGooglePlaces(true);

    try {
      const res = await fetch("/api/restaurants/sync-places", {
        method: "POST",
      });

      const data = await res.json();

      if (data.success) {
        await fetch("/api/restaurants-update-cache");
        onRefreshAllData();

        const logPreview = Array.isArray(data.logs)
          ? data.logs.slice(-8).join("\n")
          : "";

        alert(
          `✅ Google Maps 餐廳資料同步完成！\n\n${logPreview}`
        );
      } else {
        alert(`❌ Google Maps 同步失敗：${data.error || "未知錯誤"}`);
      }
    } catch (err) {
      console.error(err);
      alert("❌ 呼叫 Google Places 同步服務時發生錯誤，請確認 server.ts 與 API Key 設定。");
    } finally {
      setIsSyncingGooglePlaces(false);
    }
  };
  const handleLookupRestaurantFromGoogle = async () => {
    const queryText = restName.trim();

    if (!queryText) {
      alert("請先輸入餐廳名稱，例如：摩斯漢堡 中央大學。");
      return;
    }

    setIsLookingUpPlace(true);

    try {
      const requestBody = {
        queryText,

        // 相容用：避免 server.ts 寫成其他名稱時造成 400
        restaurantName: queryText,
        name: queryText,
        restName: queryText,
        textQuery: queryText,
      };

      const res = await fetch("/api/places/lookup-restaurant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success || !data.restaurant) {
        console.error("[Google Maps lookup failed]", {
          status: res.status,
          requestBody,
          response: data,
        });

        alert(`⚠️ 查無 Google Maps 餐廳資料：${data.error || `HTTP ${res.status}`}`);
        return;
      }

      const r = data.restaurant;

      setRestName(r.name || queryText);
      setRestCat(r.category || "午餐");
      setRestPrice(Number(r.avg_price) || 100);
      setRestLocation(r.location_desc || "");
      setRestLat(String(r.latitude || 24.9681));
      setRestLng(String(r.longitude || 121.1925));
      setHasAc(r.has_ac !== false);
      setIsVegetarian(r.is_vegetarian === true);
      setIsMidnight(r.is_midnight_snack === true);

      setGooglePlaceId(r.place_id || "");
      setGoogleMapsUri(r.google_maps_uri || "");
      setGoogleBusinessHours(Array.isArray(r.business_hours) ? r.business_hours : []);
      setGooglePhoneNumber(r.phone_number || "");
      setGoogleMenuUrl(r.menu_url || "");
      setGoogleImageUrl(r.img_url || "");
      setGoogleWebsiteUri(r.website_uri || "");
      setGoogleRating(typeof r.rating === "number" ? r.rating : null);

      alert("✅ 已從 Google Maps 自動帶入餐廳資料，請再確認後送出審核。");
    } catch (err) {
      console.error("[Google Maps lookup exception]", err);
      alert("❌ Google Maps 餐廳資料查詢失敗，請確認後端 API 是否正常啟動。");
    } finally {
      setIsLookingUpPlace(false);
    }
  };
  // Fetch proposals
  const fetchProposals = async () => {
    setLoadingProposals(true);
    try {
      const snap = await getDocs(collection(db, "proposals"));
      const list: any[] = [];
      snap.forEach(doc => {
        list.push(doc.data());
      });
      list.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
      setProposals(list);
    } catch (err) {
      console.error("Failed to query proposals list:", err);
    } finally {
      setLoadingProposals(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, []);

  // Sync selected direct edit target
  useEffect(() => {
    if (selectedRestIdForEdit) {
      const target = restaurants.find(r => r.restaurant_id === selectedRestIdForEdit);
      if (target) {
        setDirectRestName(target.name);
        setDirectRestCat(target.category);
        setDirectRestPrice(target.avg_price);
        setDirectRestWalk(target.walking_distance);
        setDirectRestLocation(target.location_desc);
        setDirectRestLat(target.latitude?.toString() || "24.9700");
        setDirectRestLng(target.longitude?.toString() || "121.1915");
        setDirectHasAc(target.has_ac);
        setDirectIsVeg(target.is_vegetarian);
        setDirectIsMidnight(target.is_midnight_snack);
        setDirectIsOpen(target.is_open);
        
        // Fetch menu items directly from Firestore
        const fetchDirectMenu = async () => {
          setLoadingDirectMenu(true);
          try {
            const snap = await getDocs(collection(db, "restaurants", selectedRestIdForEdit.toString(), "menu_items"));
            const fetchedList: MenuItem[] = [];
            snap.forEach(d => {
              fetchedList.push(d.data() as MenuItem);
            });
            setDirectMenuItems(fetchedList.sort((a,b) => (a.item_name || "").localeCompare(b.item_name || "")));
          } catch (err) {
            console.error("Failed to query direct menu items:", err);
          } finally {
            setLoadingDirectMenu(false);
          }
        };
        fetchDirectMenu();
      }
    } else {
      setDirectRestName("");
      setDirectMenuItems([]);
    }
  }, [selectedRestIdForEdit, restaurants]);

  // Fetch administrator registered logins list
  const fetchAdmins = async () => {
    setLoadingAdmins(true);
    try {
      const q = query(collection(db, "users"), where("role", "==", "admin"));
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach(d => {
        list.push(d.data());
      });
      setAdminEmailsList(list);
    } catch (err) {
      console.error("Failed to query admins:", err);
    } finally {
      setLoadingAdmins(false);
    }
  };

  useEffect(() => {
    if (roleMode === "admin" && adminSubTab === "admins" && isAdmin) {
      fetchAdmins();
    }
  }, [roleMode, adminSubTab]);

  const handleSaveDirectRestaurant = async () => {
    if (!selectedRestIdForEdit) return;
    try {
      const ref = doc(db, "restaurants", selectedRestIdForEdit.toString());
      const updatedData = {
        restaurant_id: selectedRestIdForEdit,
        name: directRestName,
        category: directRestCat,
        avg_price: Number(directRestPrice),
        walking_distance: Number(directRestWalk),
        location_desc: directRestLocation,
        latitude: Number(directRestLat),
        longitude: Number(directRestLng),
        has_ac: directHasAc,
        is_vegetarian: directIsVeg,
        is_midnight_snack: directIsMidnight,
        is_open: directIsOpen
      };
      await setDoc(ref, updatedData, { merge: true });
      // Sync cache in memory
      await fetch("/api/restaurants-update-cache");
      onRefreshAllData();
      alert("🎉 店家基本屬性已成功更新並即時寫入 Firestore 與即時全站推薦引擎！");
    } catch (err) {
      console.error(err);
      alert("❌ 儲存店家屬性失敗，請確認 Firebase 安全規則設定！");
    }
  };

  const handleSaveDirectMenuItem = async (item: MenuItem, changes: Partial<MenuItem>) => {
    try {
      const ref = doc(db, "restaurants", item.restaurant_id.toString(), "menu_items", item.menu_id.toString());
      const updated = { ...item, ...changes };
      await setDoc(ref, updated, { merge: true });
      
      // Update local state
      setDirectMenuItems(prev => prev.map(m => m.menu_id === item.menu_id ? updated : m));
      await fetch("/api/restaurants-update-cache");
      onRefreshAllData();
      alert(`✔️ 餐點「${item.item_name}」資訊已成功修改並即時生效！`);
    } catch (err) {
      console.error(err);
      alert("❌ 修改餐點資訊失敗，請確認權限安全規則！");
    }
  };

  const handleDeleteDirectMenuItem = async (item: MenuItem) => {
    if (!window.confirm(`確定要下架刪除「${item.item_name}」嗎？此操作將在 Firestore 執行物理刪除。`)) return;
    try {
      const ref = doc(db, "restaurants", item.restaurant_id.toString(), "menu_items", item.menu_id.toString());
      await deleteDoc(ref);
      
      // Update local state
      setDirectMenuItems(prev => prev.filter(m => m.menu_id !== item.menu_id));
      await fetch("/api/restaurants-update-cache");
      onRefreshAllData();
      alert(`✔️ 餐點「${item.item_name}」已被安全下架刪除。`);
    } catch (err) {
      console.error(err);
      alert("❌ 刪除餐點失敗，請檢查權限設定！");
    }
  };

  const handleAddDirectMenuItem = async () => {
    if (!selectedRestIdForEdit || !newMealName.trim()) {
      alert("請輸入要新增的新品餐點名稱！");
      return;
    }
    try {
      const mId = "m_direct_" + Math.random().toString(36).substring(2, 6) + "_" + Date.now();
      const newItem: MenuItem = {
        menu_id: mId as any,
        restaurant_id: selectedRestIdForEdit,
        item_name: newMealName,
        price: Number(newMealPrice),
        spicy_level: newMealSpicy,
        popularity_score: 8,
        tags: ["店家特推"],
        ingredients: newMealIngredients ? newMealIngredients.split(",").map(i => i.trim()) : []
      };
      const ref = doc(db, "restaurants", selectedRestIdForEdit.toString(), "menu_items", mId);
      await setDoc(ref, newItem);
      
      setDirectMenuItems(prev => [newItem, ...prev]);
      setNewMealName("");
      setNewMealPrice(85);
      setNewMealIngredients("");
      await fetch("/api/restaurants-update-cache");
      onRefreshAllData();
      alert(`✔️ 成功將新品「${newMealName}」直覺寫入該店菜單！`);
    } catch (err) {
      console.error(err);
      alert("❌ 新增新品失敗，請確認權限設定！");
    }
  };

  const handleDirectMenuOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedRestIdForEdit) return;

    setIsDirectScanning(true);
    setOcrResults([]);

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64String = (reader.result as string).split(',')[1];
        const res = await fetch("/api/menu/ocr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ base64: base64String }),
        });
        const data = await res.json();
        if (data.success && data.items && data.items.length > 0) {
          setOcrResults(data.items);
          alert(`📷 辨識成功！解析出 ${data.items.length} 個品項，您可以檢閱後進行一鍵「批次儲存到本店」！`);
        } else {
          alert("⚠️ 辨識失敗或沒解析出菜色，請確認原圖清晰度！");
        }
      } catch (err) {
        console.error(err);
        alert("⚠️ OCR 解析發生錯誤，請稍後重試！");
      } finally {
        setIsDirectScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOCRToRestaurant = async () => {
    if (!selectedRestIdForEdit || ocrResults.length === 0) return;
    try {
      setIsDirectScanning(true);
      for (const item of ocrResults) {
        const mId = "m_ocr_" + Math.random().toString(36).substring(2, 6) + "_" + Date.now();
        const newItem: MenuItem = {
          menu_id: mId as any,
          restaurant_id: selectedRestIdForEdit,
          item_name: item.item_name || item.name || "解析新品",
          price: Number(item.price) || 85,
          spicy_level: item.spicy_level || "無辣",
          popularity_score: 8,
          tags: item.tags || ["AI掃描成果"],
          ingredients: item.ingredients || []
        };
        const ref = doc(db, "restaurants", selectedRestIdForEdit.toString(), "menu_items", mId);
        await setDoc(ref, newItem);
      }
      
      // Reload direct menu list
      const snap = await getDocs(collection(db, "restaurants", selectedRestIdForEdit.toString(), "menu_items"));
      const list: MenuItem[] = [];
      snap.forEach(d => list.push(d.data() as MenuItem));
      setDirectMenuItems(list.sort((a,b) => (a.item_name || "").localeCompare(b.item_name || "")));
      
      setOcrResults([]);
      await fetch("/api/restaurants-update-cache");
      onRefreshAllData();
      alert(`🎉 成功一鍵批次將 OCR 品項全部導入該餐廳菜單資料庫！`);
    } catch (err) {
      console.error(err);
      alert("❌ 批次導入發生錯誤");
    } finally {
      setIsDirectScanning(false);
    }
  };

  const handleAddNewAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) {
      alert("請輸入有意義的 Email 地址！");
      return;
    }

    try {
      setLoadingAdmins(true);
      // 1. Search if the user already has a document with this email
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        // Upgrade existing user
        let upgradedCount = 0;
        for (const docSnap of snap.docs) {
          const userRef = doc(db, "users", docSnap.id);
          await setDoc(userRef, { role: "admin" }, { merge: true });
          upgradedCount++;
        }
        alert(`🎉 成功！已在系統中找到對應註冊帳號，並將 ${email} 成功升級為【🛡️ 系統稽核管理員】！`);
      } else {
        // Create a pre-authorized placeholder doc in /users/
        const pendingId = "pending_admin_" + email.replace(/[@.]/g, "_") + "_" + Date.now();
        await setDoc(doc(db, "users", pendingId), {
          user_id: "",
          username: "預先授權管理員 (系統待對接)",
          email: email,
          role: "admin",
          preference_tags: ["CP值高"],
          blacklist_rest_ids: [],
          blacklist_ingredients: [],
          blacklist_categories: [],
          blacklist_meals: []
        });
        alert(`💡 已建立預先授權登記！當管理員 ${email} 於中大美食抽抽樂首次註冊/登入（不論是 Google 還是快速登入）時，系統將全自動認證並啟用其【🛡️ 系統稽核管理員】權限！`);
      }
      
      setNewAdminEmail("");
      fetchAdmins();
    } catch (err) {
      console.error("Failed to add admin role:", err);
      alert("❌ 升級權限設定失敗，請確認資料庫狀態與規則權限！");
    } finally {
      setLoadingAdmins(false);
    }
  };

  const handleRevokeAdmin = async (user: any) => {
    if (user.email === "910370ctgs@gmail.com") {
      alert("🚫 權限警報：此帳號為系統默認之始祖 Superadmin，無法撤銷。");
      return;
    }
    if (currentUserEmail === user.email) {
      alert("🚫 權限安全警報：您無法撤銷您本人的管理權限！");
      return;
    }
    if (!window.confirm(`確定要收回管理員 ${user.email} (暱稱:${user.username}) 的管理與審核權限嗎？`)) return;

    try {
      setLoadingAdmins(true);
      // Determine if it was a pending placeholder or actual user doc
      let docIdToUpdate = user.user_id;
      if (!docIdToUpdate) {
        // Find by email or matching docs
        const q = query(collection(db, "users"), where("email", "==", user.email));
        const snap = await getDocs(q);
        snap.forEach(d => {
          docIdToUpdate = d.id;
        });
      }
      
      if (docIdToUpdate) {
        const userRef = doc(db, "users", docIdToUpdate);
        await setDoc(userRef, { role: "user" }, { merge: true });
        alert(`✔️ 成功收回 ${user.email} 的管理權限，其身份已重設為【學生觀光客】。`);
      } else {
        alert("❌ 找不到對應的用戶文件進行更動！");
      }
      fetchAdmins();
    } catch (err) {
      console.error(err);
      alert("❌ 撤銷管理權限失敗");
    } finally {
      setLoadingAdmins(false);
    }
  };

  const handleAuditAction = async (proposalId: string, action: "approved" | "rejected") => {
    setIsRefreshing(true);
    try {
      // 1. Locate proposal
      const proposal = proposals.find(p => p.proposal_id === proposalId);
      if (!proposal) return;

      // 2. Update status in proposals index
      const proposalRef = doc(db, "proposals", proposalId);
      const updatedProp = { ...proposal, status: action };
      await setDoc(proposalRef, updatedProp);

      // 3. Write actual database content on APPROVE
      if (action === "approved") {
        if (proposal.type === "new_restaurant") {
          const rawId = Date.now();
          const pData = proposal.data;
          
          // Post Restaurant doc
          await setDoc(doc(db, "restaurants", rawId.toString()), {
            restaurant_id: rawId,
            place_id: pData.place_id || "",
            name: pData.name,
            category: pData.category,
            walking_distance: Number(pData.walking_distance) || 3,
            rating: Number(pData.rating) || 4.2,
            popularity: 80,
            avg_price: Number(pData.avg_price) || 100,
            is_open: true,
            is_group_friendly: true,
            has_ac: pData.has_ac === true,
            has_seats: true,
            is_vegetarian: pData.is_vegetarian === true,
            has_takeout: true,
            is_midnight_snack: pData.is_midnight_snack === true,
            img_url: pData.img_url || "",
            location_desc: pData.location_desc || "校外周邊",
            signature_dishes: pData.menu_items
              ? pData.menu_items.slice(0, 3).map((item: any) => item.item_name)
              : [],
            latitude: Number(pData.latitude) || 24.9681,
            longitude: Number(pData.longitude) || 121.1925,
            google_maps_uri: pData.google_maps_uri || "",
            business_hours: pData.business_hours || [],
            phone_number: pData.phone_number || "",
            menu_url: pData.menu_url || "",
            last_synced: new Date().toISOString()
          });

          // Post subcollection nested menu items
          if (pData.menu_items && pData.menu_items.length > 0) {
            for (const item of pData.menu_items) {
              const mId = "m_" + Math.random().toString(36).substring(2, 6) + "_" + Date.now();
              await setDoc(doc(db, "restaurants", rawId.toString(), "menu_items", mId), {
                menu_id: mId,
                restaurant_id: rawId,
                item_name: item.item_name,
                price: Number(item.price) || 85,
                spicy_level: item.spicy_level || "無辣",
                popularity_score: 8,
                tags: ["店家推薦"],
                ingredients: item.ingredients ? item.ingredients.split(",") : []
              });
            }
          }
        } else if (proposal.type === "new_deal") {
          const dData = proposal.data;
          const dealId = "deal_" + Math.random().toString(36).substring(2, 6) + "_" + Date.now();
          await setDoc(doc(db, "deals", dealId), {
            deal_id: dealId,
            restaurant_id: Number(dData.restaurant_id) || 1,
            restaurant_name: dData.restaurant_name || "特別商圈店",
            offer: dData.offer,
            code: dData.code || "NCU",
            timestamp: new Date().toISOString()
          });
        } else if (proposal.type === "new_dish") {
          const dData = proposal.data;
          const mId = "m_prop_" + Math.random().toString(36).substring(2, 6) + "_" + Date.now();
          await setDoc(doc(db, "restaurants", dData.restaurant_id.toString(), "menu_items", mId), {
            menu_id: mId,
            restaurant_id: Number(dData.restaurant_id),
            item_name: dData.item_name,
            price: Number(dData.price) || 85,
            spicy_level: dData.spicy_level || "無辣",
            popularity_score: 8,
            tags: ["學生/訪客補登推荐"],
            ingredients: dData.ingredients ? dData.ingredients.split(",").map((i: string) => i.trim()) : []
          });
        } else if (proposal.type === "correction_report") {
          const rData = proposal.data;
          if (rData.error_category === "店家已歇業" || rData.error_category?.includes("歇業")) {
            const restRef = doc(db, "restaurants", rData.restaurant_id.toString());
            await setDoc(restRef, { is_open: false }, { merge: true });
          }
        }
      }

      // 4. Force backend in-memory cache synchronizations
      await fetch("/api/restaurants-update-cache");
      
      // 5. Refetch and reload client
      await fetchProposals();
      onRefreshAllData();
      alert(`🎉 提案審核成功！已標記為 [${action === 'approved' ? '已核准放行' : '扣留駁回'}] 並即時寫入 DB`);
    } catch (err) {
      console.error("Action approval failure:", err);
      alert("❌ 審核操作失敗，請檢查網路狀態！");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddDishRow = () => {
    setBuiltDishes([...builtDishes, { item_name: "", price: 80, spicy_level: "無辣", ingredients: "" }]);
  };

  const handleRemoveDishRow = (idx: number) => {
    setBuiltDishes(builtDishes.filter((_, i) => i !== idx));
  };

  const handleDishChange = (idx: number, field: string, val: any) => {
    const list = [...builtDishes];
    list[idx][field] = val;
    setBuiltDishes(list);
  };

  const normalizeIngredients = (value: any) => {
    if (Array.isArray(value)) return value.join(",");
    if (typeof value === "string") return value;
    return "";
  };

  const normalizeSpicyLevel = (value: any): "無辣" | "微辣" | "中辣" | "大辣" => {
    if (["無辣", "微辣", "中辣", "大辣"].includes(value)) {
      return value;
    }
    return "無辣";
  };

  const handleMenuOCRUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setIsScanningOCR(true);

    const reader = new FileReader();

    reader.onloadend = async () => {
      try {
        const result = reader.result as string;
        const base64String = result.includes(",") ? result.split(",")[1] : result;
        const mimeType = file.type || "image/jpeg";

        const res = await fetch("/api/menu/ocr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            base64: base64String,
            mimeType,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
          console.error("[OCR failed]", {
            status: res.status,
            response: data,
          });
          alert(`⚠️ OCR 辨識失敗：${data.error || `HTTP ${res.status}`}`);
          return;
        }

        if (Array.isArray(data.items) && data.items.length > 0) {
          const parsedRows = data.items.map((it: any) => ({
            item_name: it.item_name || it.name || "解析新品",
            price: Number(it.price) || 80,
            spicy_level: normalizeSpicyLevel(it.spicy_level),
            ingredients: normalizeIngredients(it.ingredients),
          }));

          setBuiltDishes(prev => [...prev, ...parsedRows]);

          alert(`📷 成功辨識 ${data.items.length} 道紙本餐點，已自動帶入下表格！`);
        } else {
          alert("⚠️ AI 沒有從圖片中辨識出菜單品項，請確認照片清楚且包含菜名與價格。");
        }
      } catch (err) {
        console.error("OCR parse exception:", err);
        alert("⚠️ 呼叫 AI OCR 服務器錯誤！請重試。");
      } finally {
        setIsScanningOCR(false);
        input.value = "";
      }
    };

    reader.readAsDataURL(file);
  };

  const handleSubmitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      alert("⚠️ 請先在頁面右上角登入 Google 帳號再進行提案！");
      return;
    }

    try {
      const propId = "prop_" + Math.random().toString(36).substring(2, 7) + "_" + Date.now();
      let pData: any = {};

      if (propType === "new_restaurant") {
        if (!restName.trim()) {
          alert("填入店家名稱！");
          return;
        }
        pData = {
          name: restName,
          category: restCat,
          walking_distance: Number(restWalk),
          avg_price: Number(restPrice),
          location_desc: restLocation,
          latitude: Number(restLat),
          longitude: Number(restLng),
          has_ac: hasAc,
          is_vegetarian: isVegetarian,
          is_midnight_snack: isMidnight,

          // Google Maps / Places API 欄位
          place_id: googlePlaceId,
          google_maps_uri: googleMapsUri,
          business_hours: googleBusinessHours,
          phone_number: googlePhoneNumber,
          menu_url: googleMenuUrl,
          img_url: googleImageUrl,
          website_uri: googleWebsiteUri,
          rating: googleRating,

          // OCR 或手動新增的菜單
          menu_items: builtDishes.filter(d => d.item_name.trim())
        };
      } else if (propType === "new_deal") {
        if (!dealOffer.trim()) {
          alert("請填入優惠促銷說明！");
          return;
        }
        const selectedShop = restaurants.find(r => r.restaurant_id.toString() === targetRestId);
        pData = {
          restaurant_id: Number(targetRestId),
          restaurant_name: selectedShop ? selectedShop.name : "中央特約餐館",
          offer: dealOffer,
          code: dealCode
        };
      } else if (propType === "new_dish") {
        if (!targetRestId) {
          alert("⚠️ 請選擇欲新增菜單的店家！");
          return;
        }
        if (!newDishName.trim()) {
          alert("⚠️ 請輸入餐點名稱！");
          return;
        }
        const selectedShop = restaurants.find(r => r.restaurant_id.toString() === targetRestId);
        pData = {
          restaurant_id: Number(targetRestId),
          restaurant_name: selectedShop ? selectedShop.name : "現存店家",
          item_name: newDishName,
          price: Number(newDishPrice),
          spicy_level: newDishSpicy,
          ingredients: newDishIngredients
        };
      } else if (propType === "correction_report") {
        if (!targetRestId) {
          alert("⚠️ 請選擇欲回報錯誤的店家！");
          return;
        }
        if (!correctionDetails.trim()) {
          alert("⚠️ 請詳細描述錯誤資訊與修正建議！");
          return;
        }
        const selectedShop = restaurants.find(r => r.restaurant_id.toString() === targetRestId);
        pData = {
          restaurant_id: Number(targetRestId),
          restaurant_name: selectedShop ? selectedShop.name : "現存店家",
          error_category: correctionCategory,
          details: correctionDetails
        };
      }

      const proposalDoc = {
        proposal_id: propId,
        type: propType,
        submitter_uid: auth.currentUser.uid,
        submitter_email: auth.currentUser.email || "",
        timestamp: new Date().toISOString(),
        status: "pending",
        data: pData
      };

      await setDoc(doc(db, "proposals", propId), proposalDoc);
      alert("📝 提案已提交至【第六組安全審核區】！管理員核實放行後，立即上架曝光。");
      
      // Reset
      setRestName("");
      setRestLocation("");
      setDealOffer("");
      setDealCode("");
      setBuiltDishes([{ item_name: "招牌主打餐點", price: 80, spicy_level: "無辣", ingredients: "招牌配料" }]);
      setNewDishName("");
      setNewDishPrice(85);
      setNewDishIngredients("");
      setCorrectionDetails("");

      setGooglePlaceId("");
      setGoogleMapsUri("");
      setGoogleBusinessHours([]);
      setGooglePhoneNumber("");
      setGoogleMenuUrl("");
      setGoogleImageUrl("");
      setGoogleWebsiteUri("");
      setGoogleRating(null);

      fetchProposals();
    } catch (err) {
      console.error("Failed to post proposal:", err);
      alert("❌ 提交失敗，欄位格式有誤！");
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 border border-[#e5e1da] shadow-sm flex flex-col gap-6 font-sans">
      {/* Dynamic role triggers */}
      <div className="flex justify-between items-center bg-[#fdfdfb] p-3 rounded-2xl border border-[#e5e1da]/50">
        <div className="flex items-center gap-1.5">
          <Shield className="w-5 h-5 text-[#5a5a40]" />
          <div className="text-left">
            <h4 className="text-sm font-bold text-[#3d3d3d] font-serif">NCU 商圈應援合作社</h4>
            <p className="text-[10px] text-[#8a8a70]">提供小農、大專特約與周邊商家自主曝光的綠色快速通道</p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-1.5">
            <button
              onClick={() => setRoleMode("merchant")}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl cursor-pointer ${
                roleMode === "merchant"
                  ? "bg-[#5a5a40] text-amber-300"
                  : "bg-stone-50 border border-[#e5e1da] text-stone-500"
              }`}
            >
              店家自主上架
            </button>
            <button
              onClick={() => setRoleMode("admin")}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl cursor-pointer ${
                roleMode === "admin"
                  ? "bg-rose-600 text-white shadow"
                  : "bg-stone-50 border border-[#e5e1da] text-stone-500"
              }`}
            >
              🛡️ 第六組安全審核端
            </button>
          </div>
        )}
      </div>

      {/* ADMIN AUDIT MODE */}
      {roleMode === "admin" && isAdmin ? (
        <div className="flex flex-col gap-4 text-left">
          {/* Admin Navigation Sub-Tabs */}
          <div className="flex border-b border-[#e5e1da] mb-1 gap-2 pb-1 bg-stone-50/50 p-2 rounded-xl">
            <button
              type="button"
              onClick={() => setAdminSubTab("audit")}
              className={`pb-1.5 pt-1 px-3.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                adminSubTab === "audit"
                  ? "bg-rose-650 bg-rose-600 text-white shadow-sm"
                  : "text-stone-500 hover:bg-[#e5e1da]/30"
              }`}
            >
              📋 待審提案 ({proposals.filter(p => p.status === 'pending').length})
            </button>
            <button
              type="button"
              onClick={() => setAdminSubTab("direct")}
              className={`pb-1.5 pt-1 px-3.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                adminSubTab === "direct"
                  ? "bg-rose-650 bg-rose-600 text-white shadow-sm"
                  : "text-stone-500 hover:bg-[#e5e1da]/30"
              }`}
            >
              🏪 即時更動 & 菜單掃描
            </button>
            <button
              type="button"
              onClick={() => setAdminSubTab("admins")}
              className={`pb-1.5 pt-1 px-3.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                adminSubTab === "admins"
                  ? "bg-rose-650 bg-rose-600 text-white shadow-sm"
                  : "text-stone-500 hover:bg-[#e5e1da]/30"
              }`}
            >
              🛡️ 管理群組 / 新增管理員
            </button>
          </div>

          {/* Sub-Tab 1: Audits Block */}
          {adminSubTab === "audit" && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-[#e5e1da]/50 pb-2.5">
                <span className="text-xs font-bold text-rose-850 tracking-wide flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-rose-600" />
                  <span>🔒 第六組美食審核防守組 (隔離待審名冊)</span>
                </span>
                <button
                  type="button"
                  onClick={fetchProposals}
                  disabled={loadingProposals}
                  className="p-1.5 bg-stone-50 border border-[#e5e1da] hover:bg-[#e5e1da]/30 rounded-lg cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#5a5a40] ${loadingProposals ? "animate-spin" : ""}`} />
                </button>
              </div>

              {loadingProposals ? (
                <div className="text-center py-12 text-[#8a8a70] text-xs">
                  正在自安全資料庫中調閱提案清單中...
                </div>
              ) : proposals.length === 0 ? (
                <div className="text-center py-12 bg-stone-50 rounded-2xl border border-dashed text-[#8a8a70] text-xs">
                  目前暫無待審核的提案紀錄。
                </div>
              ) : (
                <div className="flex flex-col gap-4 max-h-[600px] overflow-y-auto pr-1">
                  {proposals.map((prop) => (
                    <div key={prop.proposal_id} className="border border-[#e5e1da] rounded-2xl p-4 bg-[#FAF9F6] flex flex-col justify-between gap-3">
                      <div className="flex justify-between items-start border-b border-[#e5e1da]/50 pb-2">
                        <div>
                          <span className="text-[10px] bg-stone-250 bg-stone-200 text-[#5a5a40] px-2 py-0.5 rounded-full font-bold">
                            {prop.type === "new_restaurant" 
                              ? "新增商家 & 完整菜單" 
                              : prop.type === "new_deal" 
                              ? "上線折價優惠 Coupons" 
                              : prop.type === "new_dish"
                              ? "🍛 補登店內菜單品項"
                              : "⚠️ 店家錯誤回報糾錯"}
                          </span>
                          <h4 className="text-xs font-bold text-[#3d3d3d] mt-1.5">
                            {prop.type === "new_restaurant" 
                              ? prop.data.name 
                              : prop.type === "new_deal"
                              ? `特惠: ${prop.data.restaurant_name}`
                              : prop.type === "new_dish"
                              ? `補登: ${prop.data.restaurant_name} ➔ ${prop.data.item_name}`
                              : `糾錯回報: ${prop.data.restaurant_name}`}
                          </h4>
                        </div>
                        
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          prop.status === "approved"
                            ? "bg-green-100 text-green-800"
                            : prop.status === "rejected"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800 animate-pulse"
                        }`}>
                          {prop.status === "approved" ? "已放行放上地圖" : prop.status === "rejected" ? "已駁回隔離" : "⏳ 隔離待審查"}
                        </span>
                      </div>

                      <div className="text-xs text-[#5a5a40] space-y-1 bg-white p-3 rounded-xl border border-[#e5e1da]/50">
                        <div><strong>發起信箱:</strong> {prop.submitter_email}</div>
                        <div><strong>時間印記:</strong> {new Date(prop.timestamp).toLocaleString()}</div>
                        
                        {prop.type === "new_restaurant" && (
                          <div className="pt-2 border-t border-[#f4f4f0] text-[11px] space-y-1">
                            <div><strong>大分類:</strong> {prop.data.category} | <strong>平均價:</strong> ${prop.data.avg_price}</div>
                            <div><strong>步行距離:</strong> {prop.data.walking_distance} mins | <strong>座落地區:</strong> {prop.data.location_desc}</div>
                            <div><strong>經緯GPS:</strong> lat: {prop.data.latitude} , lng: {prop.data.longitude}</div>
                            {prop.data.menu_items && prop.data.menu_items.length > 0 && (
                              <div className="mt-1 bg-gray-50 p-2 rounded border">
                                <strong>帶入新品菜單 ({prop.data.menu_items.length}道):</strong>
                                <div className="max-h-24 overflow-y-auto text-[10px]">
                                  {prop.data.menu_items.map((item: any, i: number) => (
                                    <div key={i}>• {item.item_name} (NT${item.price})</div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {prop.type === "new_deal" && (
                          <div className="pt-2 border-t border-[#f4f4f0] text-[11px]">
                            <div><strong>今日優惠促銷案:</strong></div>
                            <div className="text-rose-700 font-bold mt-1 bg-rose-50/50 p-2 rounded border border-rose-100">{prop.data.offer}</div>
                            <strong>券碼:</strong> {prop.data.code || "無"}
                          </div>
                        )}

                        {prop.type === "new_dish" && (
                          <div className="pt-2 border-t border-[#f4f4f0] text-[11px] space-y-1">
                            <div><strong>補登所屬店家:</strong> <span className="text-stone-900 font-bold">{prop.data.restaurant_name}</span></div>
                            <div className="mt-1 bg-amber-50/30 p-2 rounded border border-amber-100">
                              <div><strong>補登餐點項目:</strong> <span className="font-bold text-rose-700">{prop.data.item_name}</span></div>
                              <div><strong>建議價格:</strong> NT$ {prop.data.price} | <strong>辣度:</strong> {prop.data.spicy_level}</div>
                              {prop.data.ingredients && <div><strong>主要配料成分說明:</strong> {prop.data.ingredients}</div>}
                            </div>
                          </div>
                        )}

                        {prop.type === "correction_report" && (
                          <div className="pt-2 border-t border-[#f4f4f0] text-[11px] space-y-1">
                            <div><strong>報錯對象店家:</strong> <span className="text-stone-900 font-bold">{prop.data.restaurant_name}</span></div>
                            <div className="mt-1 bg-rose-50/30 p-2 rounded border border-rose-100">
                              <div><strong>報錯分類:</strong> <span className="text-rose-800 font-bold">⚠️ {prop.data.error_category}</span></div>
                              <div className="mt-1.5 whitespace-pre-wrap text-stone-700 font-medium"><strong>回報詳細說明與修正建請:</strong><br />{prop.data.details}</div>
                            </div>
                          </div>
                        )}
                      </div>

                      {prop.status === "pending" && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleAuditAction(prop.proposal_id, "rejected")}
                            disabled={isRefreshing}
                            className="bg-rose-50 text-rose-850 hover:bg-rose-100 border border-rose-250 text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer"
                          >
                            ❌ 駁回申請
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAuditAction(prop.proposal_id, "approved")}
                            disabled={isRefreshing}
                            className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>✔️ 同意放行 / 即時上實體地圖</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sub-Tab 2: Direct Editor with AI Camera scanning OCR */}
          {adminSubTab === "direct" && (
            <div className="flex flex-col gap-5 bg-[#FAF9F6] border border-[#e5e1da] p-5 rounded-2xl">
              <h3 className="text-xs font-bold text-rose-800 flex items-center gap-1">
                <Edit3 className="w-3.5 h-3.5" />
                <span>🏪 已上架實體店家與菜單即時直覺管理</span>
              </h3>
              
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold text-stone-600 text-left">步驟 1: 請點選您欲維護/更動的學校店家</label>
                <select
                  value={selectedRestIdForEdit || ""}
                  onChange={(e) => setSelectedRestIdForEdit(e.target.value ? Number(e.target.value) : null)}
                  className="bg-white border border-[#e5e1da] p-2.5 rounded-xl text-xs text-stone-700 focus:outline-none w-full"
                >
                  <option value="">-- 請選擇一個現存店家進行即時修改 --</option>
                  {restaurants.map(r => (
                    <option key={r.restaurant_id} value={r.restaurant_id}>
                      {r.name} ({r.category} | {r.location_desc})
                    </option>
                  ))}
                </select>
              </div>

              {selectedRestIdForEdit && (
                <div className="flex flex-col gap-5 border-t border-[#e5e1da]/50 pt-4 text-left">
                  {/* EDIT RESTAURANT PROPERTIES */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-[#e5e1da]/40">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label className="text-[10px] font-bold text-stone-500">店家名稱</label>
                      <input
                        type="text"
                        value={directRestName}
                        onChange={(e) => setDirectRestName(e.target.value)}
                        className="bg-stone-50/50 border border-[#e5e1da] px-3 py-2 rounded-lg text-xs"
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <div className="flex flex-col gap-1.5 flex-1 col-span-1">
                        <label className="text-[10px] font-bold text-stone-500">類別</label>
                        <select
                          value={directRestCat}
                          onChange={(e) => setDirectRestCat(e.target.value)}
                          className="bg-stone-50/50 border border-[#e5e1da] p-1.5 rounded-lg text-xs"
                        >
                          <option>台式</option>
                          <option>日式</option>
                          <option>港式</option>
                          <option>美式</option>
                          <option>飲料</option>
                          <option>點心</option>
                          <option>蔬食.素食</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 col-span-1">
                        <label className="text-[10px] font-bold text-stone-500">均消 NT$</label>
                        <input
                          type="number"
                          value={directRestPrice}
                          onChange={(e) => setDirectRestPrice(Number(e.target.value))}
                          className="bg-stone-50/50 border border-[#e5e1da] p-1.5 rounded-lg text-xs text-center"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-stone-500">座落地點說明</label>
                      <input
                        type="text"
                        value={directRestLocation}
                        onChange={(e) => setDirectRestLocation(e.target.value)}
                        className="bg-stone-50/50 border border-[#e5e1da] px-3 py-1.5 rounded-lg text-xs"
                      />
                    </div>

                    <div className="flex gap-2">
                      <div className="flex flex-col gap-1.5 flex-1 col-span-1">
                        <label className="text-[10px] font-bold text-stone-500">步行(分)</label>
                        <input
                          type="number"
                          value={directRestWalk}
                          onChange={(e) => setDirectRestWalk(Number(e.target.value))}
                          className="bg-stone-50/50 border border-[#e5e1da] p-1.5 rounded-lg text-xs text-center"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 col-span-1">
                        <label className="text-[10px] font-bold text-stone-500">營業狀態</label>
                        <select
                          value={directIsOpen ? "open" : "closed"}
                          onChange={(e) => setDirectIsOpen(e.target.value === "open")}
                          className="bg-stone-50/50 border border-[#e5e1da] p-1.5 rounded-lg text-xs text-center font-bold text-green-700"
                        >
                          <option value="open">🟢 營業中</option>
                          <option value="closed">🔴 已歇業/休息</option>
                        </select>
                      </div>
                    </div>

                    <div className="sm:col-span-2 flex gap-2 bg-stone-50 p-2.5 rounded-xl border border-[#e5e1da]/50">
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={directHasAc}
                          onChange={(e) => setDirectHasAc(e.target.checked)}
                          className="rounded border-stone-300"
                        />
                        <span>🌀 提供冷氣</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={directIsVeg}
                          onChange={(e) => setDirectIsVeg(e.target.checked)}
                          className="rounded border-stone-300"
                        />
                        <span>🥗 蔬食素食</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={directIsMidnight}
                          onChange={(e) => setDirectIsMidnight(e.target.checked)}
                          className="rounded border-stone-300"
                        />
                        <span>🌙 營業至宵夜</span>
                      </label>
                    </div>

                    <div className="sm:col-span-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveDirectRestaurant}
                        className="bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs py-2 px-5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>儲存店家屬性修改</span>
                      </button>
                    </div>
                  </div>

                  {/* CAMERA PHOTO MENU SCANNING OCR SECTION */}
                  <div className="bg-[#fff9f0] border border-amber-250 p-4 rounded-xl flex flex-col gap-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1">
                        <Camera className="w-4 h-4 text-amber-700" />
                        <span>📷 菜單影印自動解析 (OCR AI 掃描匯入該店)</span>
                      </h4>
                      <label className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{isDirectScanning ? "解析中..." : "選擇上傳菜單照片"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleDirectMenuOCR}
                          disabled={isDirectScanning}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <p className="text-[10px] text-stone-500 leading-relaxed">
                      管理群專享：拍照上傳學校菜單傳單，Gemini Vision 將自動提取菜色、辣椒級別、定價與配料。抓取成果檢視無誤後即可批量直寫至數據主庫。
                    </p>

                    {/* OCR Results table */}
                    {ocrResults.length > 0 && (
                      <div className="bg-white border border-[#e5e1da] rounded-xl p-3 flex flex-col gap-3 mt-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-green-700 animate-pulse">
                            ✨ AI 辨識成功：共抓取 {ocrResults.length} 個餐點項目
                          </span>
                          <button
                            type="button"
                            onClick={handleSaveOCRToRestaurant}
                            className="text-[11px] bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-1 rounded-lg cursor-pointer"
                          >
                            ✔️ 匯入並即時儲存至本店
                          </button>
                        </div>

                        <div className="overflow-x-auto max-h-48 border border-slate-100 rounded-lg">
                          <table className="w-full text-left text-[11px] border-collapse">
                            <thead>
                              <tr className="border-b border-[#e5e1da]/50 text-stone-400 bg-stone-50">
                                <th className="p-2">餐點名稱</th>
                                <th className="p-2 text-center">價格</th>
                                <th className="p-2 text-center">辣度</th>
                                <th className="p-2">主要成分</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f4f4f0] text-stone-700">
                              {ocrResults.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50">
                                  <td className="p-2 font-medium">{item.item_name}</td>
                                  <td className="p-2 text-center font-bold text-stone-900">${item.price}</td>
                                  <td className="p-2 text-center">{item.spicy_level || "無辣"}</td>
                                  <td className="p-2 max-w-[124px] truncate">{(item.ingredients || []).join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* DIRECT MENU ITEMS LIST */}
                  <div className="flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1">
                      <ListPlus className="w-3.5 h-3.5" />
                      <span>現存上架菜色清單 ({directMenuItems.length})</span>
                    </h4>

                    {/* NEW ITEM INSERTER */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-stone-50 border border-[#e5e1da]/50 p-3 rounded-xl">
                      <input
                        type="text"
                        placeholder="手動新增菜色名稱"
                        value={newMealName}
                        onChange={(e) => setNewMealName(e.target.value)}
                        className="bg-white border border-[#e5e1da] px-2.5 py-1.5 text-xs rounded-lg sm:col-span-2"
                      />
                      <input
                        type="number"
                        placeholder="價格"
                        value={newMealPrice}
                        onChange={(e) => setNewMealPrice(Number(e.target.value))}
                        className="bg-white border border-[#e5e1da] px-2.5 py-1.5 text-xs rounded-lg text-center"
                      />
                      <button
                        type="button"
                        onClick={handleAddDirectMenuItem}
                        className="bg-[#5a5a40] hover:bg-[#4a4a35] text-white text-[11px] font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>新增品項</span>
                      </button>
                    </div>

                    {loadingDirectMenu ? (
                      <div className="text-center py-6 text-stone-400 text-xs">載入現場品項中...</div>
                    ) : directMenuItems.length === 0 ? (
                      <div className="text-center py-6 border border-dashed rounded-xl text-stone-400 text-xs bg-white">
                        暫無上架菜品，請於上方由 AI 掃描或手動新增。
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto bg-white border border-[#e5e1da]/45 rounded-xl p-2.5 divide-y divide-slate-100">
                        {directMenuItems.map((item) => (
                          <div key={item.menu_id} className="pt-2 pb-1.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                            <span className="font-bold text-stone-700 min-w-[124px]">{item.item_name}</span>
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-stone-500">價格 NT$:</span>
                                <input
                                  type="number"
                                  value={item.price}
                                  onChange={(e) => handleSaveDirectMenuItem(item, { price: Number(e.target.value) })}
                                  className="w-16 border rounded text-center font-bold text-rose-700 py-0.5 bg-stone-50 focus:outline-none"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-stone-500">辣度:</span>
                                <select
                                  value={item.spicy_level}
                                  onChange={(e) => handleSaveDirectMenuItem(item, { spicy_level: e.target.value as any })}
                                  className="border rounded text-[11px] p-0.5 bg-stone-50 focus:outline-none"
                                >
                                  <option>無辣</option>
                                  <option>微辣</option>
                                  <option>中辣</option>
                                  <option>大辣</option>
                                </select>
                              </div>
                              
                              <button
                                type="button"
                                onClick={() => handleDeleteDirectMenuItem(item)}
                                className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-rose-600 transition cursor-pointer"
                              >
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-Tab 3: Admin permissions roster delegations block */}
          {adminSubTab === "admins" && (
            <div className="flex flex-col gap-5 bg-[#FAF9F6] border border-[#e5e1da] p-5 rounded-2xl text-left">
              <h3 className="text-xs font-bold text-rose-800 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" />
                <span>🛡️ 中央大學安全美食稽核 - 管理員權限委任主控台</span>
              </h3>

              {/* ADD NEW ADMIN FORM */}
              <form onSubmit={handleAddNewAdmin} className="bg-white p-4 rounded-xl border border-[#e5e1da]/45 flex flex-col gap-3">
                <span className="text-[11px] font-bold text-stone-600">步驟 1: 新增或授權新管理員的 Email：</span>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="請輸入欲提拔新管理員的 Email 通訊信箱"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    className="bg-stone-50/50 border border-[#e5e1da] px-3.5 py-2 rounded-xl text-xs text-[#3d3d3d] focus:outline-none flex-1"
                  />
                  <button
                    type="submit"
                    disabled={loadingAdmins}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1 cursor-pointer transition"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>{loadingAdmins ? "寫入中..." : "新增管理權限"}</span>
                  </button>
                </div>
                <p className="text-[10px] text-stone-400 leading-relaxed">
                  輸入該管理員的通訊信箱。若該使用者尚未在本站登入建檔過，系統將自動落款其登錄在『預先核驗特許名單』。待其首次登入系統時立即認證並啟用其安全稽核與全站店家/菜單直接更動能力！
                </p>
              </form>

              {/* CURRENT ADMINS LIST */}
              <div className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-[#e5e1da]/45">
                <span className="text-[11px] font-bold text-stone-600">全站特許管理員名冊 ({adminEmailsList.length})</span>
                {loadingAdmins ? (
                  <div className="text-center py-6 text-stone-400 text-xs">讀取管理名單中...</div>
                ) : (
                  <div className="flex flex-col gap-2 divide-y divide-stone-100 max-h-60 overflow-y-auto">
                    {adminEmailsList.map((admin, idx) => (
                      <div key={idx} className="pt-2 pb-1.5 flex justify-between items-center text-xs">
                        <div className="flex flex-col text-left">
                          <span className="font-bold text-stone-700">{admin.email}</span>
                          <span className="text-[10px] text-stone-400">登入暱稱: {admin.username || "待登入"} | 權限身分: {admin.email === "910370ctgs@gmail.com" ? "始祖 Superadmin" : "管理稽核員"}</span>
                        </div>
                        
                        {admin.email !== "910370ctgs@gmail.com" && (
                          <button
                            type="button"
                            onClick={() => handleRevokeAdmin(admin)}
                            className="px-2 py-1 text-[10px] bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg cursor-pointer transition flex items-center gap-0.5"
                          >
                            <UserX className="w-3 h-3" />
                            <span>撤銷管理權限</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* DATABASE SEEDING PANEL */}
              <div className="flex flex-col gap-3 bg-rose-50/55 p-4 rounded-xl border border-rose-100/60 mt-1">
                <span className="text-[11px] font-bold text-rose-800 flex items-center gap-1">
                  <Database className="w-3.5 h-3.5" />
                  <span>🚨 核心大數據集同步／資料庫一鍵備份 (修復與高層維護)</span>
                </span>
                <p className="text-[10px] text-stone-500 leading-relaxed">
                  若本站 Firestore 出現「權限不足」或資料庫目前為空白狀態（新部署環境），請點擊下方一鍵同步。系統將讀取經中大師生驗證的核心 92 間校外宵夜街與校內餐廳名冊，完美寫入雲端防守中台，即刻重建完美推薦指標！
                </p>
                <button
                  type="button"
                  onClick={handleLocalSeeding}
                  disabled={isSeedingLocally}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    isSeedingLocally 
                      ? "bg-stone-400 cursor-not-allowed" 
                      : "bg-rose-700 hover:bg-rose-800 focus:ring-2 focus:ring-rose-500"
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSeedingLocally ? "animate-spin" : ""}`} />
                  <span>{isSeedingLocally ? "正在秒速備份同步極大名冊中..." : "一鍵同步 92 家中大官方最頂餐廳與菜品"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleGooglePlacesSync}
                  disabled={isSyncingGooglePlaces}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    isSyncingGooglePlaces
                      ? "bg-stone-400 cursor-not-allowed"
                      : "bg-blue-700 hover:bg-blue-800 focus:ring-2 focus:ring-blue-500"
                  }`}
                >
                  <MapPin className={`w-3.5 h-3.5 ${isSyncingGooglePlaces ? "animate-pulse" : ""}`} />
                  <span>
                    {isSyncingGooglePlaces
                      ? "正在從 Google Maps 同步餐廳資料..."
                      : "從 Google Maps 自動同步周邊餐廳"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* MERCHANT SUBMISSION MODE */
        <form onSubmit={handleSubmitProposal} className="flex flex-col gap-5 text-left">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-[#FAF9F5] p-1.5 rounded-2xl border border-[#e5e1da]/50">
            <button
              type="button"
              onClick={() => setPropType("new_restaurant")}
              className={`py-2 px-1 text-center text-[11px] font-bold rounded-xl transition cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[56px] border ${
                propType === "new_restaurant"
                  ? "bg-[#5a5a40] text-amber-300 border-[#5a5a40] shadow"
                  : "bg-white border-transparent text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <Plus className="w-4 h-4 text-center mx-auto" />
              <span>🆕 合作店家上架</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPropType("new_deal");
                if (restaurants.length > 0 && !targetRestId) {
                  setTargetRestId(restaurants[0].restaurant_id.toString());
                }
              }}
              className={`py-2 px-1 text-center text-[11px] font-bold rounded-xl transition cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[56px] border ${
                propType === "new_deal"
                  ? "bg-[#5a5a40] text-amber-300 border-[#5a5a40] shadow"
                  : "bg-white border-transparent text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <Image className="w-4 h-4 text-center mx-auto" />
              <span>🏷️ 促銷特惠放行</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPropType("new_dish");
                if (restaurants.length > 0 && !targetRestId) {
                  setTargetRestId(restaurants[0].restaurant_id.toString());
                }
              }}
              className={`py-2 px-1 text-center text-[11px] font-bold rounded-xl transition cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[56px] border ${
                propType === "new_dish"
                  ? "bg-[#5a5a40] text-amber-300 border-[#5a5a40] shadow"
                  : "bg-white border-transparent text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <BookOpen className="w-4 h-4 text-center mx-auto" />
              <span>🍛 我要補登菜單</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPropType("correction_report");
                if (restaurants.length > 0 && !targetRestId) {
                  setTargetRestId(restaurants[0].restaurant_id.toString());
                }
              }}
              className={`py-2 px-1 text-center text-[11px] font-bold rounded-xl transition cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[56px] border ${
                propType === "correction_report"
                  ? "bg-[#5a5a40] text-amber-300 border-[#5a5a40] shadow"
                  : "bg-white border-transparent text-[#5a5a40] hover:bg-stone-50"
              }`}
            >
              <AlertTriangle className="w-4 h-4 text-center mx-auto text-rose-600" />
              <span>⚠️ 報錯與糾錯</span>
            </button>
          </div>

          {/* New Store upper features block */}
          {propType === "new_restaurant" && (
            <>           
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center gap-2">
                  <label className="text-xs font-bold text-[#5a5a40]">店家名稱 :</label>
                  <button
                    type="button"
                    onClick={handleLookupRestaurantFromGoogle}
                    disabled={isLookingUpPlace || !restName.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] px-2 py-0.5 rounded-lg disabled:opacity-50 cursor-pointer"
                  >
                    {isLookingUpPlace ? "Google Maps 查詢中..." : "🔍 從 Google Maps 自動帶入"}
                  </button>
                </div>

                <input
                  type="text"
                  required
                  placeholder="請輸入店名 (例如: 豪享吃雞肉飯)"
                  value={restName}
                  onChange={(e) => setRestName(e.target.value)}
                  className="bg-stone-50/50 border border-[#e5e1da] px-3.5 py-2 rounded-xl text-xs text-[#3d3d3d] focus:outline-none focus:border-[#5a5a40]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-[#5a5a40]">主大類別 :</label>
                  <select
                    value={restCat}
                    onChange={(e) => setRestCat(e.target.value)}
                    className="bg-stone-50/50 border border-[#e5e1da] p-2 rounded-xl text-xs text-[#3d3d3d] focus:outline-none"
                  >
                    <option>台式</option>
                    <option>日式</option>
                    <option>港式</option>
                    <option>美式</option>
                    <option>飲料</option>
                    <option>點心</option>
                    <option>蔬食.素食</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-[#5a5a40]">均消(NT$) :</label>
                  <input
                    type="number"
                    value={restPrice}
                    onChange={(e) => setRestPrice(Number(e.target.value))}
                    className="bg-stone-50/50 border border-[#e5e1da] p-1.5 rounded-xl text-xs font-bold text-rose-700 text-center"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-[#5a5a40]">座落與詳細位置說明 :</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 宵夜街大門前段、松苑1樓..."
                  value={restLocation}
                  onChange={(e) => setRestLocation(e.target.value)}
                  className="bg-stone-50/50 border border-[#e5e1da] px-3.5 py-2 rounded-xl text-xs text-[#3d3d3d]"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-bold text-[#5a5a40]">步行分鐘 :</label>
                  <input
                    type="number"
                    value={restWalk}
                    onChange={(e) => setRestWalk(Number(e.target.value))}
                    className="bg-stone-50/50 border border-[#e5e1da] p-2 rounded-xl text-xs text-center text-[#3d3d3d]"
                  />
                </div>

                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-bold text-amber-700 flex items-center gap-0.5">
                    <MapPin className="w-3.5 h-3.5" />
                    位置預填 :
                  </label>
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "宵夜街") {
                        setRestLat("24.9702");
                        setRestLng("121.1912");
                      } else if (val === "百花川") {
                        setRestLat("24.9680");
                        setRestLng("121.1932");
                      } else if (val === "松苑") {
                        setRestLat("24.9678");
                        setRestLng("121.1911");
                      } else if (val === "女14舍") {
                        setRestLat("24.9669");
                        setRestLng("121.1944");
                      }
                    }}
                    className="bg-amber-50/50 border border-amber-200 p-2 rounded-xl text-xs text-[#5a5a40] font-bold focus:outline-none"
                  >
                    <option value="">自行輸入</option>
                    <option value="宵夜街">後門宵夜街</option>
                    <option value="百花川">百花川宿舍</option>
                    <option value="松苑">松苑餐飲部</option>
                    <option value="女14舍">其餘女十四舍</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-[#FAF9F5] p-3.5 rounded-2xl border border-[#e5e1da]">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-[#5a5a40]">
                  緯度 (Latitude 擷取自 Google Map GPS) :
                </span>
                <input
                  type="text"
                  required
                  value={restLat}
                  onChange={(e) => setRestLat(e.target.value)}
                  className="bg-white border border-[#e5e1da] rounded-lg p-1 text-[11px] font-mono text-[#3d3d3d] text-center"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-[#5a5a40]">
                  經度 (Longitude 擷取自 Google Map GPS) :
                </span>
                <input
                  type="text"
                  required
                  value={restLng}
                  onChange={(e) => setRestLng(e.target.value)}
                  className="bg-white border border-[#e5e1da] rounded-lg p-1 text-[11px] font-mono text-[#3d3d3d] text-center"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 items-center bg-[#FAF9F5]/40 p-3 rounded-2xl border border-[#e5e1da]/50">
              <span className="text-xs font-bold text-[#5a5a40]">提供服務設備 :</span>

              <label className="flex items-center gap-1.5 text-xs text-[#3d3d3d] cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasAc}
                  onChange={(e) => setHasAc(e.target.checked)}
                />
                <span>提供冷氣 AC</span>
              </label>

              <label className="flex items-center gap-1.5 text-xs text-[#3d3d3d] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isVegetarian}
                  onChange={(e) => setIsVegetarian(e.target.checked)}
                />
                <span>提供蔬食素食</span>
              </label>

              <label className="flex items-center gap-1.5 text-xs text-[#3d3d3d] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMidnight}
                  onChange={(e) => setIsMidnight(e.target.checked)}
                />
                <span>營業至宵夜 (00:00後)</span>
              </label>
            </div>

            <div className="border border-[#e5e1da] rounded-2xl p-4 bg-white mt-2 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#FAF9F5] pb-2">
                <div>
                  <h5 className="text-xs font-bold text-[#3d3d3d] flex items-center gap-1.5 font-serif">
                    <ListPlus className="w-4 h-4 text-[#5a5a40]" />
                    <span>上架菜色餐點目錄 ({builtDishes.length})</span>
                  </h5>
                  <p className="text-[10px] text-[#8a8a70]">
                    至少建議填寫一道特色餐點代入，供智慧推薦配對。
                  </p>
                </div>

                <label className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200 text-[10px] font-bold px-3 py-1.5 rounded-xl cursor-pointer flex items-center gap-1 shadow-sm transition">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{isScanningOCR ? "AI 掃描菜單解析中..." : "📷 透過 AI 拍照 OCR 解讀代入紙本菜單"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleMenuOCRUpload}
                    disabled={isScanningOCR}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {builtDishes.map((dish, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row gap-2 items-center bg-stone-50/65 p-2 rounded-xl border border-[#e5e1da]/40"
                  >
                    <input
                      type="text"
                      placeholder="主打菜名 (例如: 沙茶大腸臭臭鍋)"
                      value={dish.item_name}
                      onChange={(e) => handleDishChange(idx, "item_name", e.target.value)}
                      className="bg-white border border-[#e5e1da] px-2.5 py-1 text-xs text-[#3d3d3d] rounded-lg flex-1 font-bold"
                      required
                    />

                    <div className="flex gap-2 w-full sm:w-auto shrink-0">
                      <div className="flex items-center gap-1 shrink-0 bg-white border border-[#e5e1da] px-2 py-0.5 rounded-lg">
                        <span className="text-[10px] text-[#8a8a70]">單價:</span>
                        <input
                          type="number"
                          value={dish.price}
                          onChange={(e) => handleDishChange(idx, "price", Number(e.target.value))}
                          className="w-12 text-center text-xs text-[#5a5a40] font-mono font-bold focus:outline-none"
                          required
                        />
                      </div>

                      <select
                        value={dish.spicy_level}
                        onChange={(e) => handleDishChange(idx, "spicy_level", e.target.value)}
                        className="bg-white border border-[#e5e1da] px-1.5 py-0.5 rounded-lg text-[10px] text-[#3d3d3d] shrink-0 outline-none"
                      >
                        <option>無辣</option>
                        <option>微辣</option>
                        <option>中辣</option>
                        <option>大辣</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRemoveDishRow(idx)}
                        className="p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/40 rounded-lg cursor-pointer"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleAddDishRow}
                className="w-full text-center py-2 border border-dashed border-[#e5e1da] hover:bg-stone-50 rounded-xl text-xs text-[#5a5a40] font-bold cursor-pointer transition"
              >
                ＋ 新增一行新品
              </button>
            </div>
          </div>
          </>
        )}
          {/* New deal promotions form */}
          {propType === "new_deal" && (
            <div className="flex flex-col gap-4 bg-[#FAF9F5]/40 p-4 rounded-3xl border border-[#e5e1da]">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-[#5a5a40]">選擇要曝光促銷的店家 :</label>
                <select
                  value={targetRestId}
                  onChange={(e) => setTargetRestId(e.target.value)}
                  className="bg-white border border-[#e5e1da] p-2.5 rounded-xl text-xs font-semibold text-[#3d3d3d] outline-none"
                  required
                >
                  {restaurants.map(r => (
                    <option key={r.restaurant_id} value={r.restaurant_id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-[#5a5a40]">今天店家的限量折扣/贈品活動內容 (一行醒目文案) :</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 憑大一學生證可享免費加飯，限時至週五特推！"
                  value={dealOffer}
                  onChange={(e) => setDealOffer(e.target.value)}
                  className="bg-white border border-[#e5e1da] px-3.5 py-2 rounded-xl text-xs text-[#3d3d3d]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-[#5a5a40]">店內出示今日特惠代金券碼 (折扣驗證) :</label>
                <input
                  type="text"
                  placeholder="例如: FREECHARGE / NCU95 (可選預留)"
                  value={dealCode}
                  onChange={(e) => setDealCode(e.target.value)}
                  className="bg-white border border-[#e5e1da] px-3.5 py-2 rounded-xl text-xs text-[#5a5a40] font-bold font-mono uppercase"
                />
              </div>
            </div>
          )}

          {/* New menu dish form */}
          {propType === "new_dish" && (
            <div className="flex flex-col gap-4 bg-[#FAF9F5]/40 p-5 rounded-3xl border border-[#e5e1da]">
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-bold text-[#5a5a40] flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-[#5a5a40]" />
                  <span>選擇要新增/補登菜單的現存店家 :</span>
                </label>
                <select
                  value={targetRestId}
                  onChange={(e) => setTargetRestId(e.target.value)}
                  className="bg-white border border-[#e5e1da] p-2.5 rounded-xl text-xs font-semibold text-[#3d3d3d] outline-none"
                  required
                >
                  <option value="">-- 請選擇現存店家 --</option>
                  {restaurants.map(r => (
                    <option key={r.restaurant_id} value={r.restaurant_id}>{r.name} ({r.location_desc})</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-bold text-[#5a5a40]">餐點/大菜名稱 :</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 銷魂排骨飯、鮮豬肉小籠湯包"
                  value={newDishName}
                  onChange={(e) => setNewDishName(e.target.value)}
                  className="bg-white border border-[#e5e1da] px-3.5 py-2.5 rounded-xl text-xs text-[#3d3d3d] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5 text-left">
                  <label className="text-xs font-bold text-[#5a5a40]">餐點單價 (NT$ 元) :</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={newDishPrice}
                    onChange={(e) => setNewDishPrice(Number(e.target.value))}
                    className="bg-white border border-[#e5e1da] px-3.5 py-2.5 rounded-xl text-xs text-[#3d3d3d] focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5 text-left">
                  <label className="text-xs font-bold text-[#5a5a40]">餐點辣度標示 :</label>
                  <select
                    value={newDishSpicy}
                    onChange={(e) => setNewDishSpicy(e.target.value as any)}
                    className="bg-white border border-[#e5e1da] p-2.5 rounded-xl text-xs font-medium text-[#3d3d3d] outline-none"
                  >
                    <option value="無辣">無辣 🟢</option>
                    <option value="微辣">微辣 🟡</option>
                    <option value="中辣">中辣 🟠</option>
                    <option value="大辣">大辣 🔴</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-bold text-[#5a5a40]">主要食材/配料 (避雷專用，選填，以英文逗號隔開) :</label>
                <input
                  type="text"
                  placeholder="例如: 牛肉, 香菜, 辣椒, 海鮮 (系統可幫學弟妹自訂避雷選單排拒)"
                  value={newDishIngredients}
                  onChange={(e) => setNewDishIngredients(e.target.value)}
                  className="bg-white border border-[#e5e1da] px-3.5 py-2.5 rounded-xl text-xs text-[#3d3d3d] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Correction Problem report form */}
          {propType === "correction_report" && (
            <div className="flex flex-col gap-4 bg-[#FAF9F5]/40 p-5 rounded-3xl border border-[#e5e1da]">
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-bold text-[#5a5a40] flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>選擇在資料庫中出錯/需要修正的店家 :</span>
                </label>
                <select
                  value={targetRestId}
                  onChange={(e) => setTargetRestId(e.target.value)}
                  className="bg-white border border-[#e5e1da] p-2.5 rounded-xl text-xs font-semibold text-[#3d3d3d] outline-none"
                  required
                >
                  <option value="">-- 請選擇欲糾錯店家 --</option>
                  {restaurants.map(r => (
                    <option key={r.restaurant_id} value={r.restaurant_id}>{r.name} ({r.location_desc})</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-bold text-[#5a5a40]">出錯問題分類 :</label>
                <select
                  value={correctionCategory}
                  onChange={(e) => setCorrectionCategory(e.target.value)}
                  className="bg-white border border-[#e5e1da] p-2.5 rounded-xl text-xs font-medium text-[#3d3d3d] outline-none"
                >
                  <option value="價格標示有誤">💰 價格標示有誤 / 已調漲、降價</option>
                  <option value="位置及GPS有誤">📍 位置及經緯度 GPS 顯示有誤（如地圖圖標偏離）</option>
                  <option value="硬體、空調或素食設備不符">💨 設備有誤（如：無冷氣、素食或非素食標籤與實際不符）</option>
                  <option value="店家已歇業 / 本季不再對外開放">🚫 店家已歇業 / 本學期對外封閉、歇業中</option>
                  <option value="其餘營業時間回報與修改促請">📝 其餘店家細項/營業時間回報與修改促請</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-bold text-[#5a5a40]">具體問題描述與最新正確資料 (越詳細越容易通過審查哦！)：</label>
                <textarea
                  required
                  rows={4}
                  placeholder="請填寫最新、最確實的商家或餐點資訊。
例如：‘這家店現在已經沒有提供素食選項了哦，請修正，以免素食學子跑錯。’ 或者 ‘大火排骨飯已經調漲為NT$ 110、套餐調漲NT$ 10元。’"
                  value={correctionDetails}
                  onChange={(e) => setCorrectionDetails(e.target.value)}
                  className="bg-white border border-[#e5e1da] p-3 rounded-xl text-xs text-[#3d3d3d] focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-[#5a5a40] hover:bg-[#484833] text-white font-bold py-3.5 px-4 rounded-xl shadow-md text-xs sm:text-sm text-center transition cursor-pointer border border-[#484833]"
          >
            🚀 送出審核（送往第六組安全監管隔離區）
          </button>
        </form>
      )}
    </div>
  );
}
