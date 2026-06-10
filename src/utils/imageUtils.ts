/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const getRestaurantImageUrl = (restaurantId: number, category: string, name: string): string => {
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
    return "https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&w=500&h=350&q=80";
  }
  if (name.includes("湯包")) {
    return "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=500&h=350&q=80";
  }

  return categoryMap[category] || `https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=500&h=350&q=80`;
};

export const getMealImageUrl = (itemName: string, price: number): string => {
  const nameLower = itemName.toLowerCase();

  if (nameLower.includes("鬆餅")) {
    return "https://images.unsplash.com/photo-1565299543923-37dd37887442?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("乾麵") || nameLower.includes("意麵") || nameLower.includes("麵")) {
    return "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("肉") || nameLower.includes("三寶") || nameLower.includes("叉燒") || nameLower.includes("排骨") || nameLower.includes("便當") || nameLower.includes("雞")) {
    return "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("湯包") || nameLower.includes("餃") || nameLower.includes("小籠")) {
    return "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("拉麵")) {
    return "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("飲料") || nameLower.includes("紅茶") || nameLower.includes("綠茶") || nameLower.includes("奶茶") || nameLower.includes("拿鐵")) {
    return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("漢堡") || nameLower.includes("薯條")) {
    return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("火鍋") || nameLower.includes("麻辣") || nameLower.includes("大腸")) {
    return "https://images.unsplash.com/photo-1552611052-33e04de081de?auto=format&fit=crop&w=400&h=300&q=80";
  }
  if (nameLower.includes("沙拉") || nameLower.includes("素") || nameLower.includes("蔬")) {
    return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=400&h=300&q=80";
  }

  return `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&h=300&q=80`;
};
