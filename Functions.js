// ==========================================
// 檔案：Functions.gs
// 說明：排程調度、名額審核、試算表自動標記與超額通知信
// ==========================================

// ------------------------------------------
// 模組一：觸發器管理服務
// ------------------------------------------
const TriggerService = {
  setupAllTriggers(formId, scheduleConfig) {
    const triggers = ScriptApp.getProjectTriggers();
    
    triggers.forEach(trigger => {
      const handler = trigger.getHandlerFunction();
      if (["mainOnFormSubmit_", "mainOpenForm_", "mainCloseForm_"].includes(handler)) {
        ScriptApp.deleteTrigger(trigger);
      }
    });

    const form = FormApp.openById(formId);
    ScriptApp.newTrigger("mainOnFormSubmit_")
      .forForm(form)
      .onFormSubmit()
      .create();
    Logger.log("✅ 已自動綁定【提交表單時】審核觸發器！");

    const parseSafeDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (parts) {
        return new Date(parts[1], parts[2] - 1, parts[3], parts[4], parts[5], parts[6]);
      }
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    };

    const openDate = parseSafeDate(scheduleConfig.OPEN_TIME);
    const closeDate = parseSafeDate(scheduleConfig.CLOSE_TIME);
    const now = new Date();

    if (openDate) {
      if (now >= openDate && (!closeDate || now < closeDate)) {
        FormService.openForm(formId);
        Logger.log("⚡ 目前正處於開放時段內，已開啟表單！");
      } else if (openDate > now) {
        ScriptApp.newTrigger("mainOpenForm_")
          .timeBased()
          .at(openDate)
          .create();
        Logger.log("✅ 已排程【開啟表單】時間: " + Utilities.formatDate(openDate, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"));
      }
    }

    if (closeDate) {
      if (closeDate > now) {
        ScriptApp.newTrigger("mainCloseForm_")
          .timeBased()
          .at(closeDate)
          .create();
        Logger.log("✅ 已排程【關閉表單】時間: " + Utilities.formatDate(closeDate, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"));
      } else {
        FormService.closeForm(formId, CLOSED_FORM_MESSAGE);
        Logger.log("🔒 關閉時間已過，已關閉表單。");
      }
    }
  }
};

// ------------------------------------------
// 模組二：表單開關服務
// ------------------------------------------
const FormService = {
  openForm(formId) {
    const form = FormApp.openById(formId);
    form.setAcceptingResponses(true);
  },

  closeForm(formId, message) {
    const form = FormApp.openById(formId);
    if (message) form.setCustomClosedFormMessage(message);
    form.setAcceptingResponses(false);
  }
};

// ------------------------------------------
// 模組三：名額控制、候補判定與郵件引擎
// ------------------------------------------
class QuotaEngine {
  constructor(formId, defaultLimit, optionsConfig) {
    this.form = FormApp.openById(formId);
    this.defaultLimit = defaultLimit;
    this.optionsConfig = optionsConfig;
  }

  sync(triggerResponse = null) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);

      // 1. 審核所有回覆，計算順位並判定錄取/候補
      const auditResult = this.auditAllResponses(triggerResponse);

      // 2. 更新表單前端選項
      this.updateFormChoices(auditResult.validCounts);

    } catch (e) {
      console.error("處理選課邏輯發生錯誤: " + e.toString());
    } finally {
      lock.releaseLock();
    }
  }

  // 審核所有回覆並排隊
  // 審核所有回覆並排隊（含重複選課自動以最新回覆為準）
  auditAllResponses(latestTriggerResponse) {
    const rawResponses = this.form.getResponses();
    
    // 依提交時間由舊到新排序
    rawResponses.sort((a, b) => a.getTimestamp().getTime() - b.getTimestamp().getTime());

    // 建立限額快取
    const limitMap = {};
    Object.keys(this.optionsConfig).forEach(day => {
      this.optionsConfig[day].forEach(item => {
        const name = item.name.trim();
        const limit = (item.limit === "default" || item.limit === undefined || item.limit === null)
          ? this.defaultLimit
          : Number(item.limit);
        limitMap[name] = limit;
      });
    });

    const cleanAnswer = (ans) => {
      if (typeof ans !== "string") return ans;
      return ans.replace(/\s*\[(剩餘|最後).*?\]$/i, "").trim();
    };

    // -------------------------------------------------------------
    // 關鍵步驟 1：去重過濾（同一位學生以最新送出的回覆為準）
    // -------------------------------------------------------------
    const studentLatestResponses = new Map(); // key: userEmail 或 姓名, value: response

    rawResponses.forEach(response => {
      // 優先使用登入的 Email 作為唯一鍵值；若無 Email 則抓第一題中文姓名
      let studentKey = response.getRespondentEmail();
      if (!studentKey) {
        const firstItem = response.getItemResponses()[0];
        studentKey = firstItem ? String(firstItem.getResponse()).trim().toLowerCase() : response.getId();
      }

      // 因為時間已由舊到新排序，後面的會覆蓋前面的，確保只保留最新的一筆！
      studentLatestResponses.set(studentKey, response);
    });

    // 只取出每位學生最終的「有效回覆」進行名額累加
    const effectiveResponses = Array.from(studentLatestResponses.values());
    effectiveResponses.sort((a, b) => a.getTimestamp().getTime() - b.getTimestamp().getTime());

    // -------------------------------------------------------------
    // 關鍵步驟 2：統計有效名額並判定候補
    // -------------------------------------------------------------
    let courseStats = {}; // { courseName: count }
    let validCounts = {}; // { dayTitle: { courseName: validCount } }

    effectiveResponses.forEach(response => {
      const responseId = response.getId();
      const isLatest = latestTriggerResponse && latestTriggerResponse.getId() === responseId;
      const userEmail = response.getRespondentEmail();
      const editUrl = response.getEditResponseUrl();

      let failedCourses = []; // 沒選上的社團清單

      response.getItemResponses().forEach((itemResp, index) => {
        const title = itemResp.getItem().getTitle();
        if (!this.optionsConfig[title]) return;

        const rawAns = itemResp.getResponse();
        const courseName = cleanAnswer(rawAns);
        const limit = limitMap[courseName] !== undefined ? limitMap[courseName] : this.defaultLimit;

        if (!courseStats[courseName]) courseStats[courseName] = 0;
        courseStats[courseName]++;
        const order = courseStats[courseName];

        if (!validCounts[title]) validCounts[title] = {};

        if (order <= limit) {
          // 正式錄取
          validCounts[title][courseName] = (validCounts[title][courseName] || 0) + 1;
        } else {
          // 超額候補
          const waitlistNumber = order - limit;
          failedCourses.push({
            questionIndex: index + 1,
            dayTitle: title,
            courseName: courseName,
            waitlistNo: waitlistNumber
          });
        }
      });

      // 若這筆剛好是最新提交且有超額社團，自動寄信通知重填
      if (isLatest && failedCourses.length > 0 && userEmail) {
        this.sendWaitlistNotification(userEmail, failedCourses, editUrl);
      }
    });

    return { validCounts };
  }


  // 發送自動重填通知信
  sendWaitlistNotification(recipientEmail, failedList, editUrl) {
    const subject = "[Important Notice] ECA Over-Capacity Waitlist and Course Reselection";

    let detailsText = "";
    failedList.forEach(item => {
      detailsText += `#${item.questionIndex} (${item.dayTitle}): ${item.courseName}\n  Status: Unsuccessful (Course Full)\n\n`;
    });

    const body = `Dear HIA Student,

Thank you for your participation in the Extra-Curricular Activities (ECA) registration.

Due to a high volume of simultaneous submissions, the following course(s) you selected have reached maximum capacity:

${detailsText}
[Reselection Instructions]
Please click the unique link below to update your form and select available courses for the filled session(s):
🔗 Form Edit & Reselection Link:
${editUrl}

(Your previously submitted personal information will be preserved. Simply update your course selection(s) and resubmit the form.)

Best regards,
${EMAIL_SETTINGS.ADMIN_CONTACT}
${EMAIL_SETTINGS.SENDER_NAME}`;

    try {
      MailApp.sendEmail({
        to: recipientEmail,
        subject: subject,
        body: body,
        name: EMAIL_SETTINGS.SENDER_NAME
      });
      Logger.log(`📧 Reselection notice sent to: ${recipientEmail}`);
    } catch (e) {
      console.error("Failed to send notification email: " + e.toString());
    }
  }


  // 更新表單選項與剩餘名額
  updateFormChoices(validCounts) {
    const existingItems = this.form.getItems(FormApp.ItemType.MULTIPLE_CHOICE);
    const itemMap = {};
    existingItems.forEach(item => {
      itemMap[item.getTitle()] = item.asMultipleChoiceItem();
    });

    Object.keys(this.optionsConfig).forEach(title => {
      let mcItem = itemMap[title];

      if (!mcItem) {
        mcItem = this.form.addMultipleChoiceItem();
        mcItem.setTitle(title)
              .setHelpText("*If you can't find an option, it means the ECA is full.\n*若找不到選項，表示該社團名額已額滿。")
              .setRequired(true);
        Logger.log(`✨ 表單缺少題目，已自動建立: [${title}]`);
      }

      const rawChoices = this.optionsConfig[title] || [];
      let availableChoices = [];

      rawChoices.forEach(item => {
        if (!item || !item.name) return;

        const name = item.name.trim();
        const limit = (item.limit === "default" || item.limit === undefined || item.limit === null)
          ? this.defaultLimit
          : Number(item.limit);

        const currentCount = (validCounts[title] && validCounts[title][name]) ? validCounts[title][name] : 0;
        const remaining = limit - currentCount;

        if (remaining > 0) {
          let label = name;
          if (remaining === 1) {
            label += " [Last spot!]";
          } else {
            label += ` [${remaining} ${remaining === 1 ? 'spot' : 'spots'} left]`;
          }
          availableChoices.push(label);
        }
      });

      if (availableChoices.length > 0) {
        mcItem.setChoiceValues(availableChoices);
      } else {
        mcItem.setChoiceValues(["今日所有社團皆已額滿 (All ECAs are full today)"]);
      }
    });
  }
}
