/* =====================================================================
   ClinicOS 診所營運健檢 — 結果文案對應（V1）
   每個分類固定四段：title / problemSummary / clinicOSHelp / recommendedDemo
   語氣：口語、顧問式、不誇大。只說「協助、改善、減少人工、更容易追蹤」。
   ===================================================================== */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var config = isNode ? require('./checkup-config.js') : root.ClinicCheckup.config;
  var scoring = isNode ? require('./checkup-scoring.js') : root.ClinicCheckup.scoring;
  var api = factory(config, scoring);
  if (isNode) module.exports = api;
  root.ClinicCheckup = root.ClinicCheckup || {};
  root.ClinicCheckup.results = api;
})(typeof window !== 'undefined' ? window : globalThis, function (config, scoring) {
  'use strict';

  var RESULT_COPY = {
    CUSTOMER_DATA: {
      title: '客戶資料',
      problemSummary: '要看一位客人的完整狀況，目前得切好幾個地方，或問同事才拼得起來。',
      clinicOSHelp: ['客戶主檔', '預約與到診紀錄', '成交與付款', '療程紀錄', '同一頁看完'],
      recommendedDemo: ['客戶主檔', '客戶 360 檢視', '預約與到診'],
    },
    APPOINTMENT: {
      title: '預約管理',
      problemSummary: '預約還需要不少人工確認，偶爾會撞時間或漏掉，現場狀態也不容易一眼看到。',
      clinicOSHelp: ['預約排程', '到診報到', '現場狀態看板', '提醒與確認', '預約紀錄'],
      recommendedDemo: ['預約排程', '現場狀態看板', '到診報到'],
    },
    SALES_WORKFLOW: {
      title: '諮詢到成交',
      problemSummary: '從諮詢到開單，資料常常要重新輸入一次，報價、成交與付款也不一定在同一個地方。',
      clinicOSHelp: ['諮詢紀錄', '報價', '開單成交', '收款', '不重複輸入'],
      recommendedDemo: ['諮詢紀錄', '開單成交', '收款'],
    },
    PAYMENT_BALANCE: {
      title: '儲值與療程餘額',
      problemSummary: '客人還剩多少錢、多少堂療程，目前常要人工查或對，容易搞不清楚。',
      clinicOSHelp: ['儲值與訂金', '療程堂數', '餘額自動更新', '消耗紀錄', '客人餘額一鍵查'],
      recommendedDemo: ['儲值與訂金', '療程堂數消耗', '餘額查詢'],
    },
    MEDICAL_RECORD: {
      title: '療程紀錄',
      problemSummary: '療程做了什麼、什麼時候做的，目前要翻不同地方或紙本才找得到。',
      clinicOSHelp: ['療程執行紀錄', '電子同意書', '醫師與操作人員', '療程歷程', '快速查詢'],
      recommendedDemo: ['療程執行', '電子同意書', '療程歷程'],
    },
    PHOTO_MANAGEMENT: {
      title: '術前術後照片',
      problemSummary: '照片散在手機、雲端或電腦裡，要找某位客人過去所有照片很花時間，也沒和療程連在一起。',
      clinicOSHelp: ['照片歸到客戶', '對應療程與日期', '術前術後對照', '部位標記', '一次找齊'],
      recommendedDemo: ['臨床影像', '術前術後對照', '療程連結'],
    },
    INVENTORY: {
      title: '庫存管理',
      problemSummary: '療程執行與材料消耗沒有完全連動，數字常對不起來，盤點時需要額外核對。',
      clinicOSHelp: ['療程執行', '材料自動消耗', '庫存扣除', '成本', '盤點與效期'],
      recommendedDemo: ['療程執行', '材料消耗', '庫存與成本'],
    },
    BONUS: {
      title: '獎金與績效',
      problemSummary: '每個月仍需要花不少時間整理業績、核對條件或重新計算，也容易有疑問要回頭對。',
      clinicOSHelp: ['業績自動彙整', 'KPI', '獎金規則', '獎金計算', '計算明細'],
      recommendedDemo: ['成交', '療程執行', '人員業績', 'KPI', '獎金'],
    },
    CUSTOMER_RETENTION: {
      title: '客戶回流',
      problemSummary: '目前不容易快速知道哪些客人已經長時間沒有回診，喚回後的結果也不容易持續追蹤。',
      clinicOSHelp: ['客戶分群', '沉睡客名單', '喚回紀錄', '回流結果', '營收分析'],
      recommendedDemo: ['客戶分群與沉睡客', '喚回管理', '回流分析'],
    },
    MANAGEMENT_REPORT: {
      title: '經營數字',
      problemSummary: '想看這個月的營運狀況，目前要等月底或請人另外整理，很多數字沒辦法直接看到。',
      clinicOSHelp: ['營業額與客單價', '新客與回流', '療程別營收', '人員績效', '經營 Dashboard'],
      recommendedDemo: ['經營 Dashboard', '營收與客戶分析', '人員績效'],
    },
    DATA_FRAGMENTATION: {
      title: '資料分散',
      problemSummary: '客戶、成交、照片等資料分散在好幾個工具裡，同一件事要在不同地方各看一次。',
      clinicOSHelp: ['一套系統', '客戶為中心', '預約到收款串起來', '照片與療程對應', '不用來回切換'],
      recommendedDemo: ['客戶 360 檢視', '預約到收款流程', '臨床影像'],
    },
    MANUAL_WORK: {
      title: '人工作業',
      problemSummary: '不少日常工作還是靠 Excel、LINE 或紙本在處理，也要人工把不同系統的資料對起來。',
      clinicOSHelp: ['流程串接', '減少重複輸入', '自動彙整', '減少人工核對', '資料好追蹤'],
      recommendedDemo: ['預約到收款流程', '療程執行', '經營 Dashboard'],
    },
  };

  var DEMO_MAX = 5;

  /** 把 TOP 3 的 recommendedDemo 合併、去重，最多 5 項 */
  function buildDemoList(topKeys) {
    var out = [];
    (topKeys || []).forEach(function (key) {
      var copy = RESULT_COPY[key];
      if (!copy) return;
      copy.recommendedDemo.forEach(function (item) {
        if (out.length < DEMO_MAX && out.indexOf(item) === -1) out.push(item);
      });
    });
    return out;
  }

  /**
   * 組出一致的結果 payload（顯示與送出都用這個）。
   * value 一律是 canonical key；label 只是附帶方便顯示。
   * totalScore 只留在 payload 供內部參考，UI 不顯示。
   */
  function buildPayload(answers, now) {
    var a = answers || {};
    var scores = scoring.computeScores(a);
    var ranked = scoring.rank(scores);
    var top = ranked.slice(0, 3).map(function (r) {
      return { key: r.key, label: r.label, score: r.score, band: r.band.key, bandLabel: r.band.label };
    });
    var profile = {};
    config.QUESTIONS.forEach(function (q) { if (q.profile) profile[q.profile] = a[q.id] || ''; });

    var answersOnly = {};
    Object.keys(a).forEach(function (k) { answersOnly[k] = a[k]; });

    var total = 0;
    config.CATEGORY_KEYS.forEach(function (k) { total += scores[k]; });

    return {
      assessmentVersion: config.VERSION,
      completedAt: (now || new Date()).toISOString(),
      clinicProfile: profile,
      answers: answersOnly,
      painScores: scores,
      totalScore: Math.round(total / config.CATEGORY_KEYS.length),
      topPainPoints: top,
      otherPainPoints: ranked.slice(3).filter(function (r) { return r.score >= 30; }).map(function (r) {
        return { key: r.key, label: r.label, score: r.score, band: r.band.key, bandLabel: r.band.label };
      }),
      primaryPriority: a.Q27 || '',
      primaryPriorityNote: a.Q27 === 'OTHER' ? (a.Q27_other || '') : '',
      salesIntent: a.Q30 || '',
      recommendedDemo: buildDemoList(top.map(function (t) { return t.key; })),
      lead: { clinicName: '', contactName: '', phone: '', email: '', lineId: '' },
    };
  }

  return { RESULT_COPY: RESULT_COPY, DEMO_MAX: DEMO_MAX, buildDemoList: buildDemoList, buildPayload: buildPayload };
});
