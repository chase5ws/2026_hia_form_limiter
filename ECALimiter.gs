// ==========================================
// 檔案：ECALimiter.gs
// 說明：社團清單與個別名額限制設定
// 規則：limit 填數字，或者填 "default"
// ==========================================

const ECA_OPTIONS = {
  "Monday 週一": [
    { name: "Table Tennis", limit: "default" },
    { name: "VEX IQ Robotics (G7-G10 Students Only, Additional fee: NT$1,5000)", limit: 15 },
    { name: "Pottery (Additional fee: NT$2,000)", limit: 15 },
    { name: "Basketball", limit: 20 },
    { name: "Orchestra Strings and Winds", limit: "default" },
    { name: "Pop Dance", limit: "default" },
    { name: "Board Games", limit: "default" },
    { name: "Movies", limit: "default" },
    { name: "Re-select to use", limit: "999" }
  ],
  "Tuesday 週二": [
    { name: "Table Tennis", limit: "default" },
    { name: "Cooking Club (Additional fee: NT$1,500)", limit: 12 },
    { name: "iGEM (Application and Screening Required *4:00 PM- 6:00 PM *Additional fee: NT$5,000 )", limit: 10 },
    { name: "TERA (Audition required)", limit: "default" },
    { name: "Visual Storytelling", limit: "default" },
    { name: "Chess", limit: "default" },
    { name: "Travel and Career Exploration", limit: "default" },
    { name: "Photography", limit: "default" },
    { name: "Walk, Explore, Live Well", limit: "default" },
    { name: "Pickleball", limit: "default" },
    { name: "Book Club", limit: "default" },
    { name: "Video Game Design", limit: "default" },
    { name: "HS EAL Support (HS EAL Students Only)", limit: "default" },
    { name: "Re-select to use", limit: "999" }
  ]
};
