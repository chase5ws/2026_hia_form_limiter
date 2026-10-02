# 課後社團（ECA）自動化選課與動態名額管控系統
> **ECA Smart Enrollment & Dynamic Quota Control System**  
> 基於 Google Apps Script (V8) 建構的高併發防超額、即時動態名額顯示、自動化排程選課與 GitHub CI/CD 自動化同步系統。

---

## 📌 目錄 (Table of Contents)
- [一、 系統背景與痛點分析](#一-系統背景與痛點分析-problem-statement)
- [二、 系統架構設計](#二-系統架構設計-system-architecture)
- [三、 專案檔案結構與 GS 模組職責說明](#三-專案檔案結構與-gs-模組職責說明)
- [四、 核心技術機制](#四-核心技術機制-core-technical-mechanisms)
- [五、 關鍵邊界與衝突情境處理解決方案](#五-關鍵邊界與衝突情境處理解決方案-edge-cases--conflicts)
- [六、 現代化同步與版本控制架構 (CI/CD)](#六-現代化同步與版本控制架構-cicd)
- [七、 快速開始與專案啟動指引 (Quick Start)](#七-快速開始與專案啟動指引-quick-start)
- [八、 專案效益與管理優勢](#八-專案效益與管理優勢-business--administrative-value)
- [九、 授權與維護資訊](#九-授權與維護資訊)

---

## 一、 系統背景與痛點分析 (Problem Statement)

傳統學校在每學期進行課後社團（ECA, Extra-Curricular Activities）報名時，通常採用原生 Google 表單，面臨三大營運與技術痛點：

1. **名額無法即時管控**：表單原生功能無法在特定社團額滿時動態隱藏選項，導致大量超額報名，行政端需耗費數天逐一協調、電話通知換課或進行抽籤。
2. **高併發搶課衝突（Race Condition）**：熱門社團開放瞬間，多名家長/學生在同一毫秒送出表單，底層同時寫入造成嚴重超額錄取。
3. **人工維護成本高昂**：
   - 各社團人數上限不同，手動核對易出錯。
   - 需行政人員熬夜或準時於特定時間手動開關表單。
   - 學生重複提交表單或反悔改選，在同一天霸佔多個社團名額，清理資料費時費力。

---

## 二、 系統架構設計 (System Architecture)

本系統基於 **Google Apps Script (V8 Runtime)** 開發，採 **關注點分離（Separation of Concerns, SoC）** 與 **基礎設施即代碼（Infrastructure as Code / Code-First）** 架構，由四大核心模組與 Google Workspace 基礎設施組成：

```text
[ 本地 VS Code 開發環境 ] ──( git push )──> [ GitHub 儲存庫 (Main Branch) ]
                                                    │
                                            (GitHub Actions CI/CD)
                                                    ▼
                                    [ Google Apps Script 雲端環境 ]
                                                    │
                                    (自動同步熱更新 .gs 原始碼)
                                                    ▼
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
│ 2. 設定層 (Config.gs)        ││ 3. 業務規則層 (ECALimiter.gs) │
│    - 表單 ID                 ││    - 統一定義每日社團清單    │
│    - 預設名額 (DEFAULT_LIMIT)││    - 自訂限額與 default 繼承│
│    - 自動排程開啟/關閉時間   ││    - 宣告式 JSON 物件結構     │
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
```

---

## 三、 專案檔案結構與 GS 模組職責說明

本專案將業務規則、系統調度與運算邏輯徹底解耦，各檔案分工清晰，便於維護與版本追蹤：

```text
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions 自動部署工作流定義檔
├── .clasp.json              # clasp 雲端專案對應設定檔（綁定 Script ID）
├── .claspignore             # clasp 推送過濾設定（排除非 GAS 檔案）
├── appsscript.json          # Google Apps Script 執行環境清單檔 (Manifest)
├── Main.gs                  # 頂層調度層 (Controller Layer)
├── Config.gs                # 參數設定層 (Configuration Layer)
├── ECALimiter.gs            # 業務契約層 (Data Contract Layer)
├── Functions.gs             # 領域與基礎設施核心服務庫 (Domain Services)
├── README.md                # 專案說明與操作手冊
└── LICENSE                  # 專案開源授權協議
```

### GS 模組詳細說明

| 檔案模組 | 架構層級 | 核心職責 |
| :--- | :--- | :--- |
| **`Main.gs`** | **調度控制層**<br>*(Controller)* | **系統調度指揮官**。<br>1. 對外僅暴露唯一手動入口 `oneClickSetup()` 供一鍵部署使用。<br>2. 內部監聽函式採用**尾隨底線保護模式**（如 `mainOnFormSubmit_`、`mainScheduledOpen_`、`mainScheduledClose_`），避免在 Apps Script 介面中被管理員誤觸。 |
| **`Config.gs`** | **環境設定層**<br>*(Configuration)* | **全域環境變數與營運參數中心**。<br>包含目標表單 ID (`FORM_ID`)、預設名額上限 (`DEFAULT_LIMIT`)、排程開放與截止時間 (`SCHEDULE_CONFIG`)，以及表單關閉後的自訂聯繫公告內容。 |
| **`ECALimiter.gs`** | **業務契約層**<br>*(Data Contract)* | **社團規則與名額字典**。<br>統一定義各活動日（如「Monday 週一」、「Tuesday 週二」）之社團項目。支援宣告式設定：自訂人數 `{ name: "Cooking Club", limit: 12 }` 或繼承預設值 `{ name: "Pop Dance", limit: "default" }`，亦包含重選專用佔位項目。 |
| **`Functions.gs`** | **領域核心服務庫**<br>*(Domain & Infra)* | **系統運算引擎集合體**，包含三大服務類別：<br>1. **`TriggerService`**：觸發器生命週期自動化管理。<br>2. **`FormService`**：表單接收回覆開關控制與結單畫面文字維護。<br>3. **`QuotaEngine`**：高併發悲觀鎖、歷程答案正則清洗、剩餘名額動態標記、未錄取候補判定與重選連結自動 Email 派發。 |

> **開發小知識（VS Code 語法提示）**：  
> `.gs` 檔案底層採用 Google V8 JavaScript 引擎執行，語法與現代 JavaScript 完全一致。在本地 VS Code 開發時，可藉由 `.vscode/settings.json` 綁定檔案關聯，搭配 `@types/google-apps-script` 即可享有如同原生 JavaScript 的高亮與自動補全。

---

## 四、 核心技術機制 (Core Technical Mechanisms)

### 1. 悲觀鎖併發排隊控制（Pessimistic Locking via LockService）
- **技術原理**：在處理回覆與計算名額入口調用 `LockService.getScriptLock()`，配置 15~20 秒等待超時時間（Wait Lock）。
- **業務價值**：當開放瞬間數十人甚至上百人同時送出時，系統將平行的資料寫入轉換為嚴謹的序列化（Serialization）處理，保證每筆回覆在計算名額時的資料一致性，杜絕超額寫入。

### 2. 動態標籤與正則回歸匹配（Dynamic Labeling & RegEx Parsing）
- **技術原理**：為優化前端體驗，系統計算後會為選項即時附加 `[剩餘 X 名]` 或 `[最後 1 名!]` 標籤；若額滿則自動自選單中隱藏。
- **一致性難題**：選項文字動態改變會導致表單歷程資料的選項文字不一致。
- **解決方案**：在統計歷程回覆時，引入高效正則表達式：
  ```javascript
  const cleanAnswer = (ans) => ans.replace(/\s*\[(剩餘|最後).*?\]$/i, "").trim();
  ```
  在記憶體中快速剝離動態後綴，還原純淨社團名稱比對，兼具「前台即時資訊透通」與「後端統計精準無誤」。

### 3. 容錯型跨環境時間解析引擎（Resilient DateTime Engine）
- 原生 JavaScript `new Date("YYYY-MM-DD HH:mm:ss")` 在不同雲端伺服器語系與環境易產生 `Invalid Date` 異常。
- 系統建構正則時間拆解引擎，安全提取年、月、日、時、分、秒，並綁定台北標準時區（GMT+8），確保定時開放與截止時間分秒不差。

---

## 五、 關鍵邊界與衝突情境處理解決方案 (Edge Cases & Conflicts)

| 編號 | 衝突情境 (Edge Case) | 潛在問題 | 系統解決方案與實作機制 |
| :---: | :--- | :--- | :--- |
| **01** | **同秒搶最後一個名額<br>*(Race Condition)*** | 兩名學生在最後一個名額釋出時同時載入並送出，表單伺服器底層同時收單。 | **【時間戳排序 + 自動候補判定 + 專屬重選通知信】**<br>1. 系統以毫秒級 Timestamp 嚴格先後排序。<br>2. 第 N 位判定為「正式錄取」，第 N+1 位自動判定為「候補第 1 位」。<br>3. 系統自動比對並發送 Email，夾帶專屬 `EditResponseUrl`，指引學生直接編輯未錄取之題號進行更換。 |
| **02** | **一人重複提交表單<br>*(Multiple Submissions)*** | 學生反悔改選，多次填寫表單，在同一天霸佔多個社團名額。 | **【表單鎖定機制 + 最新有效原則 (Latest Wins)】**<br>1. 前台啟用「僅限回覆 1 次」與「允許編輯回覆」。<br>2. 學生只能透過修改方式送出，後台永遠維持唯一資料。<br>3. 系統具備「舊名額自動釋出機制」：若由 A 社團改選 B 社團，A 社團名額立即釋放（若原額滿會自動重新上架），B 社團名額扣除。 |
| **03** | **表單題名與設定不一致<br>*(Human Typo)*** | 人工建立表單題目與選項時，易產生空格、符號、大小寫微幅差異，導致比對失敗。 | **【代碼優先自動初始化 (Code-Driven UI Generation)】**<br>Google 表單日常僅需保留學生基礎資料題目（姓名、年級），社團題目由 `QuotaEngine` 全自動維護。若偵測表單缺少題目，會自動調用 Form API 建立單選題並注入說明與選項。 |
| **04** | **執行時間超時限制<br>*(GAS Execution Limit)*** | Google Apps Script 單次觸發有 30 秒執行上限，高併發或回覆量大時易超時。 | **【記憶體快取與線性複雜度 O(N) 聚合】**<br>將選項上限陣列快取為 Key-Value Map，遍歷回覆時使用線性時間複雜度 O(N) 快速聚合，確保在短時間內完成鎖定與釋放。 |

---

## 六、 現代化同步與版本控制架構 (CI/CD)

本專案擺脫了傳統在瀏覽器 Apps Script 編輯器中複製貼上代碼的低落體驗，採用 **「VS Code 本地開發 ➔ Git 版本控制 ➔ GitHub Actions ➔ Google Apps Script 雲端」** 的現代化自動化交付鏈。

```text
[ 本地 VS Code ] 
      │ 
   git push 
      ▼
[ GitHub Repository ] 
      │ 
 GitHub Actions Runner (Node.js 22 + @google/clasp)
      │ 
      ├─ 1. 從 GitHub Secrets 載入 Base64 憑證並解碼
      ├─ 2. 自動生成 .clasp.json 與 ~/.clasprc.json
      ├─ 3. 執行 clasp push --force
      ▼
[ Google 表單後台 Apps Script ] (即時同步更新完成)
```

### 1. 為什麼採用這套架構？
- **完整的版本歷程**：所有社團名額調整、業務邏輯變更皆有明確的 commit 記錄，支援版本回溯與多人協作。
- **本地極致開發體驗**：利用 VS Code 強大的搜尋、重構、GitLens 擴充套件與本機快捷鍵編寫代碼。
- **推送到雲端零摩擦**：每次 `git push origin main`，GitHub Actions 自動在雲端 Runner 完成身分授權並部署至目標表單後台。

### 2. 安全認證與 Base64 憑證管理機制
為防止 Google Workspace 學校網域的 **RAPT（異地敏感操作強制重新登入）** 阻擋與 JSON 換行字元解析異常：
- 授權憑證採用 **個人 Gmail 帳號授權**。
- 憑證以 **Base64 編碼** 形式安全加密儲存於 GitHub Secrets (`CLASPRC_JSON`)，避免 Ubuntu 容器解讀字串時發生引號轉義或換行斷裂。
- 配合 `.claspignore`，嚴格過濾非腳本檔案（如 Markdown、圖片等），避免觸發 Google Apps Script API 的 `invalid argument` 限制。

---

## 七、 快速開始與專案啟動指引 (Quick Start)

### 階段 A：Google 表單端前置準備

1. **建立 Google 表單**：
   僅需建立基本資料題目（社團題目將由系統代碼自動建立）：
   - `Student's Chinese Name | 學生中文姓名`
   - `Student's English Name | 學生英文姓名`
   - `Student's grade | 學生年級`
2. **表單設定**：
   - 開啟 **「收集電子郵件地址」**（選擇「已驗證」或「輸入者輸入」）。
   - 開啟 **「僅限回覆 1 次」** (Limit to 1 response)。
   - 開啟 **「允許回覆編輯」** (Allow response editing)。
3. **取得表單識別碼**：
   - 複製表單編輯頁面網址中 `/d/` 與 `/edit` 之間的那串英數字 ID，稍後填入 `Config.gs`。
4. **開啟 Apps Script API**：
   - 使用你的部署帳號前往 [Google Apps Script 使用者偏好設定](https://script.google.com/home/usersettings)，將 **Google Apps Script API** 切換為 **開啟 (ON)**。

---

### 階段 B：本地端快速啟動與開發環境設定

#### 1. Clone 專案至本機
```bash
git clone [https://github.com/chase5ws/2026_hia_form_limiter.git](https://github.com/chase5ws/2026_hia_form_limiter.git)
cd 2026_hia_form_limiter
```

#### 2. 安裝開發依賴（語法提示支援）
```bash
# 全域安裝 Google 官方 clasp 管理工具
sudo npm install -g @google/clasp

# 本地安裝 Google Apps Script 語法型別提示套件
npm install -D @types/google-apps-script
```

#### 3. 設定 VS Code 的 `.gs` 語法色彩
建立 `.vscode/settings.json`：
```json
{
  "files.associations": {
    "*.gs": "javascript"
  }
}
```

#### 4. 本地登入與綁定專案
```bash
# 登入具有該表單編輯權限的 Google 帳號
clasp login

# 建立本機 .clasp.json 專案綁定檔（請替換為你的 Script ID）
cat <<EOF> .clasp.json
{
  "scriptId": "YOUR_APPS_SCRIPT_ID_HERE",
  "rootDir": "."
}
EOF
```

---

### 階段 C：設定 GitHub Actions 自動部署 (CI/CD)

1. **導出 Base64 授權憑證**：
   ```bash
   base64 < ~/.clasprc.json | pbcopy
   # 憑證已自動複製到剪貼簿
   ```
2. **在 GitHub 儲存庫設定 Secrets**：
   前往 GitHub 專案 ➔ **Settings** ➔ **Secrets and variables** ➔ **Actions**，新增兩組 Secret：
   - `CLASPRC_JSON`：貼上剛才複製的 Base64 憑證字串。
   - `SCRIPT_ID`：填入你的 Apps Script ID。
3. **推送代碼，觸發自動部署**：
   ```bash
   git add .
   git commit -m "feat: complete initial setup and trigger cicd"
   git push origin main
   ```
   至 GitHub 的 **Actions** 分頁，確認綠燈亮起即代表代碼已自動推入 Google 雲端！

---

### 階段 D：一鍵全自動啟動系統 (One-Click Setup)

1. 回到 Google 表單，點擊右上角三點 ➔ 進入 **「Apps Script」**。
2. 確認由 GitHub 推送過來的四個檔案（`Main.gs`、`Config.gs`、`ECALimiter.gs`、`Functions.gs`）皆已同步。
3. 在上方函式下拉選單中，選擇 **`oneClickSetup`**。
4. 點擊 **「執行」**，完成初次權限審查授權。
5. **系統啟動完成！**
   - 系統自動清除歷史 Triggers 並註冊提交事件與精準定時排程。
   - 系統自動在表單生成社團題目、名額警記說明與即時動態名額標籤。

---

## 八、 專案效益與管理優勢 (Business & Administrative Value)

1. **極致的維護體驗（One-Click Setup）**：
   行政人員每學期只需在 `Config.gs` 設定時間、在 `ECALimiter.gs` 貼入社團名單，點擊一次 `oneClickSetup()` 即可完成上線，無需進入 GCP 或 Google Apps Script 介面手動設定 Trigger。
2. **零超額風險與透明化名單**：
   透過悲觀鎖與時間序列分析，杜絕任何超額可能；即使同秒送出，候補順位亦有清晰時間證明，避免爭議。
3. **行政作業自動化減少 90% 負擔**：
   釋放人工手動開關表單、核對名額、寄信通知重選的人工作業時間，全流程由系統背景非同步自動完成。
4. **企業級工程規範**：
   代碼納入 Git 與 CI/CD 流程管理，具備完整的異動審計軌跡，交接與後續擴充透明可靠。

---

## 九、 授權與維護資訊

- **維護者**：曾博暘 (Chase Tseng)
- **授權協議**：本專案採用 [MIT License](LICENSE) 進行授權。
