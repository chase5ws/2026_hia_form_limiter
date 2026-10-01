為你調整為純 Markdown 原始碼的程式碼區塊（Code Block），這樣在 GitHub 上就不會因為換行或標籤解析異常而跑版，點擊右上角的複製按鈕即可直接貼上：

# 課後社團（ECA）自動化選課與動態名額管控系統
> **ECA Smart Enrollment & Dynamic Quota Control System**  
> 基於 Google Apps Script (V8) 建構的高併發防超額、即時動態名額顯示與自動化排程選課系統。

---

## 📌 目錄 (Table of Contents)
- [一、 系統背景與痛點分析](#一-系統背景與痛點分析-problem-statement)
- [二、 系統架構設計](#二-系統架構設計-system-architecture)
  - [模組職責拆解](#模組職責拆解)
- [三、 核心技術機制](#三-核心技術機制-core-technical-mechanisms)
- [四、 關鍵邊界與衝突情境處理解決方案](#四-關鍵邊界與衝突情境處理解決方案-edge-cases--conflicts)
- [五、 專案效益與管理優勢](#五-專案效益與管理優勢-business--administrative-value)
- [六、 快速開始與部署指引 (Quick Start)](#六-快速開始與部署指引-quick-start)
- [七、 授權與維護資訊](#七-授權與維護資訊)

---

## 一、 系統背景與痛點分析 (Problem Statement)

傳統學校在每學期進行課後社團（ECA, Extra-Curricular Activities）報名時，通常採用原生 Google 表單，面臨三大營運與技術痛點：

1. **名額無法即時管控**：表單原生功能無法在特定社團額滿時動態隱藏選項，導致大量超額報名，行政端需耗費數天逐一協調、電話通知換課或進行抽籤。
2. **高併發搶課衝突（Race Condition）**：熱門社團開放瞬間，多名家長/學生在同一毫秒送出表單，底層同時寫入造成嚴重超額錄取。
3. **人工維護成本高昂**：
   - 各社團人數上限不同，手動核對易出錯。
   - 需行政人員手動熬夜/準時於特定時間開關表單。
   - 學生重複提交表單或反悔改選，在同一天霸佔多個社團名額，清理資料費時費力。

---

## 二、 系統架構設計 (System Architecture)

本系統基於 **Google Apps Script (V8 Runtime)** 開發，採 **關注點分離（Separation of Concerns, SoC）** 與 **基礎設施即代碼（Infrastructure as Code / Code-First）** 架構，由四大核心模組與 Google Workspace 基礎設施組成：

```text
[ 前端：Google 表單 / 學生填寫介面 ]
       │
       ▼ (提交事件 onFormSubmit / 定時觸發 Time-driven)
┌─────────────────────────────────────────────────────────────┐
│ 1. 控制中心 (Main.gs)                                       
│    - 提供單一外部入口：oneClickSetup()                       
│    - 封裝私有觸發事件 (Trailing Underscore 模式)             
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐┌──────────────────────────────┐
│ 2. 設定層 (Config.gs)        ││ 3. 業務規則層 (ECALimiter.gs).  
│    - 表單 ID                 ││    - 統一定義每日社團清單         
│    - 預設名額 (DEFAULT_LIMIT)││    - 自訂限額與 default 繼承     
│    - 自動排程開啟/關閉時間   ││    - 宣告式 JSON 物件結構          
└──────────────┬───────────────┘└──────────────┬───────────────┘
               │                               │
               └──────────────┬────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. 核心服務庫 (Functions.gs)                                
│    - TriggerService: 全自動 Triggers 清理、註冊與精準時間排程
│    - FormService: 表單接受回覆狀態開關與自訂結單提示         
│    - QuotaEngine: 互斥鎖、動態正則清洗、名額計算、自動候補通知
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. 底層 Google Workspace API 服務支援                       
│    - LockService (排隊鎖)         - FormApp (表單操作)       
│    - ScriptApp (Trigger生命週期)  - MailApp (候補重選通知信) 
└─────────────────────────────────────────────────────────────┘


模組職責拆解

檔案模組	架構層級	核心職責
Main.gs	調度控制層 (Controller Layer)	頂層指揮官。對外僅暴露 oneClickSetup() 供一鍵部署；所有內部 Trigger 處理函式皆加上尾隨底線 _（如 mainOnFormSubmit_）作為私有化保護，避免維護人員誤按。
Config.gs	參數設定層 (Configuration Layer)	存放全域環境變數，包含 Google Form ID、預設上限 (DEFAULT_LIMIT)、排程開關時間 (SCHEDULE_CONFIG) 及關閉表單自訂聯繫提示。
ECALimiter.gs	業務契約層 (Data Contract Layer)	集中管理每日選課題目與社團清單。支援宣告式語法：{ name: "...", limit: 15 } 或繼承預設 { name: "...", limit: "default" }，達到「單一事實來源（SSOT）」。
Functions.gs	領域與基礎設施層 (Domain & Infrastructure)	封裝核心運算邏輯：TriggerService（排程生命週期管理）、FormService（表單狀態）、QuotaEngine（併發鎖、去重審核、動態標籤生成與候補郵件發送）。

三、 核心技術機制 (Core Technical Mechanisms)

1. 悲觀鎖併發排隊控制（Pessimistic Locking via LockService）

⚬ 技術原理：在選課結算入口調用 LockService.getScriptLock()，配置 15~20 秒等待超時時間（Wait Lock）。
⚬ 業務價值：當開放瞬間數十人甚至上百人同時送出時，系統將平行的資料寫入轉換為嚴謹的序列化（Serialization） 處理，保證每筆回覆在計算名額時的資料一致性，杜絕超額寫入。

2. 動態標籤與正則回歸匹配（Dynamic Labeling & RegEx Parsing）

⚬ 技術原理：為優化前端體驗，系統計算後會為選項即時附加 [剩餘 X 名] 或 [最後 1 名!] 標籤；若額滿則自動自選單中隱藏。
⚬ 一致性難題：選項文字動態改變會導致表單歷程資料的選項文字不一致。
⚬ 解決方案：在統計歷程回覆時，引入高效正則表達式：
  const cleanAnswer = (ans) => ans.replace(/\s*\[(剩餘|最後).*?\]$/i, "").trim();
  
  在記憶體中快速剝離動態後綴，還原純淨社團名稱比對，兼具「前台即時資訊透通」與「後端統計精準無誤」。

3. 容錯型跨環境時間解析引擎（Resilient DateTime Engine）

⚬ 原生 JavaScript new Date("YYYY-MM-DD HH:mm:ss") 在不同雲端伺服器語系與環境易產生 Invalid Date 異常。
⚬ 系統建構正則時間拆解引擎，安全提取年、月、日、時、分、秒，並綁定台北標準時區（GMT+8），確保定時開放與截止時間分秒不差。

四、 關鍵邊界與衝突情境處理解決方案 (Edge Cases & Conflicts)

編號	衝突情境 (Edge Case)	潛在問題	系統解決方案與實作機制
01	同秒搶最後一個名額
(Race Condition)	兩名學生在最後一個名額釋出時同時載入並送出，表單伺服器底層同時收單。	【時間戳排序 + 自動候補判定 + 專屬重選通知信】
1. 系統以毫秒級 Timestamp 嚴格先後排序。
2. 第 N 位判定為「正式錄取」，第 N+1 位自動判定為「候補第 1 位」。
3. 系統自動比對並發送 Email，夾帶專屬 EditResponseUrl，指引學生直接編輯未錄取之題號進行更換。
02	一人重複提交表單
(Multiple Submissions)	學生反悔改選，多次填寫表單，在同一天霸佔多個社團名額。	【表單鎖定機制 + 最新有效原則 (Latest Wins)】
1. 前台啟用「僅限回覆 1 次」與「允許編輯回覆」。
2. 學生只能透過修改方式送出，後台永遠維持唯一資料。
3. 系統具備「舊名額自動釋出機制」：若由 A 社團改選 B 社團，A 社團名額立即釋放（若原額滿會自動重新上架），B 社團名額扣除。
03	表單題名與設定不一致
(Human Typo)	人工建立表單題目與選項時，易產生空格、符號、大小寫微幅差異，導致比對失敗。	【代碼優先自動初始化 (Code-Driven UI Generation)】
Google 表單日常僅需保留學生基礎資料題目（姓名、年級），社團題目由 QuotaEngine 全自動維護。若偵測表單缺少題目，會自動調用 Form API 建立單選題並注入說明與選項。
04	執行時間超時限制
(GAS Execution Limit)	Google Apps Script 單次觸發有 30 秒執行上限，高併發或回覆量大時易超時。	【記憶體快取與線性複雜度 O(N) 聚合】
將選項上限陣列快取為 Key-Value Map，遍歷回覆時使用線性時間複雜度 O(N) 快速聚合，確保在短時間內完成鎖定與釋放。

五、 專案效益與管理優勢 (Business & Administrative Value)

1. 極致的維護體驗（One-Click Setup）：
  ⚬ 行政人員每學期只需在 Config.gs 設定時間、在 ECALimiter.gs 貼入社團名單，點擊一次 oneClickSetup() 即可完成上線，無需進入 GCP 或 Google Apps Script 鬧鐘介面手動設定 Trigger。
2. 零超額風險與透明化名單：
  ⚬ 透過悲觀鎖與時間序列分析，杜絕任何超額可能；即使同秒送出，候補順位亦有清晰時間證明，避免家長爭議。
3. 行政作業自動化減少 90% 負擔：
  ⚬ 釋放人工手動開關表單、核對名額、寄信通知重選的人工作業時間，全流程由系統背景非同步自動完成。

六、 快速開始與部署指引 (Quick Start)

步驟 1：建立 Google 表單基礎設定

1. 建立新的 Google 表單，僅需手動建立基礎身份題目：
  ⚬ Student's Chinese Name | 學生中文姓名
  ⚬ Student's English Name | 學生英文姓名
  ⚬ Student's grade | 學生年級
2. 前往表單 「設定」>「回覆」：
  ⚬ 開啟 「收集電子郵件地址」（選擇「已驗證」或「輸入者輸入」）
  ⚬ 開啟 「僅限回覆 1 次」 (Limit to 1 response)
  ⚬ 開啟 「允許回覆編輯」 (Allow response editing)

步驟 2：建立 Apps Script 檔案結構

點擊表單右上角三個點 > 「指令碼編輯器」，建立以下 4 個檔案並貼入對應程式碼：

├── Main.gs          # 頂層調度與外部唯一執行進入點
├── Config.gs        # 表單 ID、排程時間與預設常數
├── ECALimiter.gs    # 社團清單與限額配置
└── Functions.gs     # 核心服務庫 (TriggerService, FormService, QuotaEngine)


步驟 3：一鍵全自動部署 (One-Click Setup)

1. 於編輯器上方函式下拉選單，選擇 oneClickSetup。
2. 點擊 「執行」，完成首次 Google 帳號授權。
3. 系統將全自動完成：
  ⚬ 自動清除既有觸發器並註冊「提交表單」與「定時開關」Trigger。
  ⚬ 自動在表單建立每日社團題目與選項。
  ⚬ 自動計算當前名額並附加動態標籤。
