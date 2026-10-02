// ==========================================
// 檔案：Main.gs
// 說明：日常控制台與唯一的對外執行入口
// 更改日期：2026/10/02
// ==========================================

function oneClickSetup() {
  Logger.log("開始執行");

  // 1. 自動部署所有需要的 Triggers
  TriggerService.setupAllTriggers(FORM_ID, SCHEDULE_CONFIG);

  // 2. 立即同步表單題目與剩餘名額選項
  const engine = new QuotaEngine(FORM_ID, DEFAULT_LIMIT, ECA_OPTIONS);
  engine.sync();

  Logger.log("設定完成");
}

// ==========================================
// 私有觸發器進入點
// ==========================================

function mainOnFormSubmit_(e) {
  const engine = new QuotaEngine(FORM_ID, DEFAULT_LIMIT, ECA_OPTIONS);
  // 將當次提交的 response 傳入，用於偵測超額並發信
  const latestResponse = e ? e.response : null;
  engine.sync(latestResponse);
}

function mainOpenForm_() {
  FormService.openForm(FORM_ID);
}

function mainCloseForm_() {
  FormService.closeForm(FORM_ID, CLOSED_FORM_MESSAGE);
}
