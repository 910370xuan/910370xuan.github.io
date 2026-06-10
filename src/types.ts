/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Users table schema
export interface User {
  user_id: string; // Changed to string for easy UUIDs/Session IDs
  username: string;
  role?: string; // Add role for administrators
  preference_tags: string[]; // e.g., ["重口味", "熱食", "高CP值", "宵夜類"]
  blacklist_rest_ids: number[]; // Blocked restaurants
  blacklist_ingredients: string[]; // e.g., ["香菜", "牛肉", "海鮮", "辣椒"]
  blacklist_categories: string[]; // e.g., ["日式", "韓式"]
  blacklist_meals: string[]; // Blocked specific meal/dish names
}

// Restaurants table schema
export interface Restaurant {
  restaurant_id: number;
  name: string;
  category: string; // e.g., "日式", "台式", "韓式", "港式", "美式", "素食"
  walking_distance: number; // in minutes
  rating: number; // e.g., 4.5
  popularity: number; // 0-100 score
  avg_price: number; // average price NTD
  is_open: boolean;
  is_group_friendly: boolean;
  has_ac: boolean; // 冷氣
  has_seats: boolean; // 有座位
  is_vegetarian: boolean; // 素食
  has_takeout: boolean; // 外帶
  is_midnight_snack: boolean; // 宵夜
  img_url: string;
  location_desc: string; // e.g., "校內百花川", "後門宵夜街"
  signature_dishes: string[];
  latitude?: number;
  longitude?: number;

  // Google Maps / Places API 補充資料
  place_id?: string;
  business_hours?: string[];
  phone_number?: string;
  google_maps_uri?: string;
  website_uri?: string;
  last_synced?: string;
}

// Menu Items table schema
export interface MenuItem {
  menu_id: number;
  restaurant_id: number;
  item_name: string;
  price: number;
  spicy_level: "無辣" | "微辣" | "中辣" | "大辣";
  popularity_score: number; // 0-10 score
  tags: string[]; // e.g., ["今日限定", "隱藏菜單", "店內熱門"]
  ingredients: string[]; // main ingredients for exclusions (e.g., ["牛肉", "海鮮", "辣椒", "香菜"])
  img_url?: string;
  rating?: number;
  size_desc?: string; // e.g., "大份 / 一人份"
}

// History schemas
export interface UserHistory {
  history_id: string;
  user_id: string;
  restaurant_id: number;
  accepted: boolean;
  timestamp: string;
  recommend_reason?: string;
}

export interface UserFoodHistory {
  history_id: string;
  user_id: string;
  menu_id: number;
  accepted: boolean;
  timestamp: string;
}

// Group Room schema
export interface GroupRoom {
  room_id: string;
  owner_id: string;
  owner_name: string;
  members: {
    user_id: string;
    username: string;
    preference_tags: string[];
    blacklist_ingredients: string[];
    blacklist_categories: string[];
    max_price: number;
    max_distance: number;
  }[];
}

// System user report schema
export interface UserReport {
  report_id: string;
  restaurant_id: number;
  restaurant_name: string;
  report_type: "closed" | "menu_update" | "price_update" | "other";
  details: string;
  timestamp: string;
  status: "pending" | "resolved";
}
