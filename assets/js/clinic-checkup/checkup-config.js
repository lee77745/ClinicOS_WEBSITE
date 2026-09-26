/* =====================================================================
   ClinicOS 診所營運健檢 — 題目設定（V1）
   純資料：步驟、題目、選項、分類、跳題條件。沒有任何 DOM 或計分邏輯。
   計分請看 checkup-scoring.js；結果文案請看 checkup-results.js。

   欄位說明
   - value  ：canonical 值（存進 payload 的值，不是顯示文字）
   - label  ：顯示文字
   - level  ：1～5，選項代表的「流程阻力」程度（1 最順、5 最卡）
              只有會進入分類計分的單選題需要
   - showIf ：(answers) => boolean，回傳 false 時整題略過
   - pain   ：附掛在本題下方的痛苦指數（1～5），回答本題後才出現，
              答案存在 answers[<id>_pain]
   - exclusive：多選題裡「都沒有／其實還好」這類互斥選項的 value
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ClinicCheckup = root.ClinicCheckup || {};
  root.ClinicCheckup.config = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var VERSION = '1.0';

  /* ---------- 分類 ---------- */
  var CATEGORY_KEYS = [
    'CUSTOMER_DATA', 'APPOINTMENT', 'SALES_WORKFLOW', 'PAYMENT_BALANCE',
    'MEDICAL_RECORD', 'PHOTO_MANAGEMENT', 'INVENTORY', 'BONUS',
    'CUSTOMER_RETENTION', 'MANAGEMENT_REPORT', 'DATA_FRAGMENTATION', 'MANUAL_WORK',
  ];

  var CATEGORY_LABELS = {
    CUSTOMER_DATA: '客戶資料',
    APPOINTMENT: '預約管理',
    SALES_WORKFLOW: '諮詢到成交',
    PAYMENT_BALANCE: '儲值與療程餘額',
    MEDICAL_RECORD: '療程紀錄',
    PHOTO_MANAGEMENT: '術前術後照片',
    INVENTORY: '庫存管理',
    BONUS: '獎金與績效',
    CUSTOMER_RETENTION: '客戶回流',
    MANAGEMENT_REPORT: '經營數字',
    DATA_FRAGMENTATION: '資料分散',
    MANUAL_WORK: '人工作業',
  };

  var PAIN_LABELS = {
    1: '沒什麼影響',
    2: '偶爾會卡一下',
    3: '有點煩，但還撐得住',
    4: '常常要花時間處理',
    5: '真的很想解決',
  };

  /* ---------- 步驟 ---------- */
  var STEPS = [
    { id: 'S1', title: '診所基本狀況' },
    { id: 'S2', title: '客戶與預約' },
    { id: 'S3', title: '諮詢、成交與收款' },
    { id: 'S4', title: '療程、醫療紀錄與影像' },
    { id: 'S5', title: '庫存、人員與獎金' },
    { id: 'S6', title: '客戶回流與經營分析' },
    { id: 'S7', title: '最後幾個問題' },
  ];

  /* ---------- 小工具 ---------- */
  function opts(list) {
    return list.map(function (row) {
      var o = { value: row[0], label: row[1] };
      if (row.length > 2) o.level = row[2];
      return o;
    });
  }

  function has(answers, id, value) {
    var a = answers[id];
    if (Array.isArray(a)) return a.indexOf(value) !== -1;
    return a === value;
  }

  function count(answers, id, excludeValues) {
    var a = answers[id];
    if (!Array.isArray(a)) return 0;
    var ex = excludeValues || [];
    return a.filter(function (v) { return ex.indexOf(v) === -1; }).length;
  }

  function bonusFollowupNeeded(a) {
    return (a.Q20_pain || 0) >= 3 || has(a, 'Q20', 'time_consuming') || has(a, 'Q20', 'painful');
  }

  /* ---------- 題目 ---------- */
  var QUESTIONS = [
    /* ===== STEP 1 診所基本狀況 ===== */
    {
      id: 'Q1', step: 'S1', type: 'single', profile: 'branchCount',
      title: '你們目前是？',
      options: opts([['single', '單一診所'], ['2_3', '2～3 間'], ['4_10', '4～10 間'], ['10_plus', '10 間以上']]),
    },
    {
      id: 'Q2', step: 'S1', type: 'single', profile: 'doctorCount',
      title: '目前大約有幾位醫師？',
      options: opts([['1', '1 位'], ['2_3', '2～3 位'], ['4_6', '4～6 位'], ['7_plus', '7 位以上']]),
    },
    {
      id: 'Q3', step: 'S1', type: 'single', profile: 'staffCount',
      title: '除了醫師以外，大約有多少工作人員？',
      options: opts([['1_5', '1～5 人'], ['6_10', '6～10 人'], ['11_20', '11～20 人'], ['21_50', '21～50 人'], ['50_plus', '50 人以上']]),
    },
    {
      id: 'Q4', step: 'S1', type: 'single', profile: 'dailyCustomerCount',
      title: '目前一天大約服務多少位客人？',
      options: opts([['lte10', '10 位以下'], ['11_30', '11～30 位'], ['31_60', '31～60 位'], ['61_100', '61～100 位'], ['100_plus', '100 位以上'], ['unknown', '不確定']]),
    },
    {
      id: 'Q5', step: 'S1', type: 'single', profile: 'currentSystemState',
      title: '現在有在使用診所管理系統嗎？',
      options: opts([
        ['one_system', '有，而且大部分功能都在同一套'],
        ['system_plus_tools', '有，但還是很多事情靠其他工具'],
        ['multiple_systems', '有好幾套不同系統'],
        ['no_system', '沒有，主要靠 Excel / LINE / 紙本'],
        ['looking', '正在找新系統'],
      ]),
    },

    /* ===== STEP 2 客戶與預約 ===== */
    {
      id: 'Q6', step: 'S2', type: 'single', category: 'CUSTOMER_DATA', pain: true,
      title: '現在要查一位客人的完整資料，方便嗎？',
      options: opts([
        ['one_place', '很方便，一個地方就看得到', 1],
        ['mostly', '大部分看得到', 2],
        ['switch_pages', '要切幾個頁面或系統', 3],
        ['ask_colleague', '常常要問同事或另外找資料', 4],
        ['hard', '很不方便', 5],
      ]),
    },
    {
      id: 'Q7', step: 'S2', type: 'multi',
      title: '客戶資料現在主要放在哪裡？',
      hint: '可以複選。',
      options: opts([
        ['system', '診所管理系統'], ['excel', 'Excel'], ['gsheet', 'Google Sheet'], ['line', 'LINE'],
        ['paper', '紙本'], ['phone', '手機'], ['multi_system', '多個系統'], ['other', '其他'],
      ]),
    },
    {
      id: 'Q8', step: 'S2', type: 'single', category: 'APPOINTMENT', pain: true,
      title: '預約現在好不好管？',
      options: opts([
        ['smooth', '很順', 1],
        ['occasional_manual', '偶爾要人工確認', 2],
        ['often_confirm', '常常需要 LINE / 電話確認', 3],
        ['sometimes_clash', '偶爾會撞時間或漏掉', 4],
        ['chaotic', '常常很混亂', 5],
      ]),
    },
    {
      id: 'Q9', step: 'S2', type: 'single',
      title: '客人從「預約 → 到診 → 諮詢」的狀態，現場人員看得到嗎？',
      options: opts([
        ['clear', '很清楚'], ['mostly', '大致看得到'], ['front_desk', '要靠櫃台通知'],
        ['line_group', 'LINE / 群組通知'], ['unclear', '不太清楚'],
      ]),
    },

    /* ===== STEP 3 諮詢、成交與收款 ===== */
    {
      id: 'Q10', step: 'S3', type: 'single', category: 'SALES_WORKFLOW', pain: true,
      title: '客人諮詢完之後，到開單成交，中間資料會需要重複輸入嗎？',
      options: opts([
        ['rarely', '幾乎不用', 1],
        ['sometimes', '偶爾', 2],
        ['often', '常常', 4],
        ['mostly', '很多資料都要重新輸入', 5],
      ]),
    },
    {
      id: 'Q11', step: 'S3', type: 'single',
      title: '療程報價、成交內容、付款紀錄，目前是不是在同一套系統？',
      options: opts([
        ['yes', '是'], ['mostly', '大部分是'], ['two_systems', '分成兩套'],
        ['scattered', '分散很多地方'], ['unknown', '不確定'],
      ]),
    },
    {
      id: 'Q12', step: 'S3', type: 'multi', exclusive: 'none',
      title: '你們有這些情況嗎？',
      hint: '可以複選。',
      options: opts([
        ['stored_value', '儲值'], ['deposit', '訂金'], ['gift_with_purchase', '買贈'], ['package', '套餐'],
        ['multi_session', '分次療程'], ['multi_payment', '多種付款方式'], ['none', '都沒有'],
      ]),
    },
    {
      id: 'Q12_1', step: 'S3', type: 'single', category: 'PAYMENT_BALANCE', pain: true,
      showIf: function (a) { return count(a, 'Q12', ['none']) > 0; },
      title: '平常要查「客人還剩多少錢／多少療程」方便嗎？',
      options: opts([
        ['easy', '很方便', 1],
        ['ok', '還算方便', 2],
        ['sometimes_manual', '偶爾要人工查', 3],
        ['often_manual', '常常要人工對', 4],
        ['confusing', '很容易搞不清楚', 5],
      ]),
    },

    /* ===== STEP 4 療程、醫療紀錄與影像 ===== */
    {
      id: 'Q13', step: 'S4', type: 'single',
      title: '目前同意書主要怎麼處理？',
      options: opts([
        ['e_sign', '電子簽署'], ['paper', '紙本'], ['both', '紙本＋電子都有'], ['varies', '不一定'], ['other', '其他'],
      ]),
    },
    {
      id: 'Q14', step: 'S4', type: 'single', category: 'MEDICAL_RECORD', pain: true,
      title: '療程執行紀錄現在方便查嗎？',
      options: opts([
        ['easy', '很方便', 1],
        ['ok', '還可以', 2],
        ['multiple_places', '要翻不同地方', 3],
        ['paper', '常常靠紙本', 4],
        ['hard', '很不方便', 5],
      ]),
    },
    {
      id: 'Q15', step: 'S4', type: 'multi',
      title: '術前術後照片現在主要放在哪裡？',
      hint: '可以複選。',
      options: opts([
        ['system', '診所系統'], ['phone', '手機'], ['tablet', '平板'], ['gdrive', 'Google Drive'],
        ['nas', 'NAS / Server'], ['line', 'LINE'], ['pc_folder', '電腦資料夾'], ['other', '其他'],
      ]),
    },
    {
      id: 'Q16', step: 'S4', type: 'single', category: 'PHOTO_MANAGEMENT', pain: true,
      title: '要找某位客人過去所有照片，方便嗎？',
      options: opts([
        ['easy', '很方便', 1],
        ['ok', '還算方便', 2],
        ['search', '要找一下', 3],
        ['slow', '很花時間', 4],
        ['lost', '常常找不到', 5],
      ]),
    },
    {
      id: 'Q17', step: 'S4', type: 'single',
      title: '照片、療程日期、療程項目，目前有連在一起嗎？',
      options: opts([['yes', '有'], ['partial', '部分有'], ['no', '沒有'], ['unknown', '不確定']]),
    },

    /* ===== STEP 5 庫存、人員與獎金 ===== */
    {
      id: 'Q18', step: 'S5', type: 'single', category: 'INVENTORY',
      title: '客人做完療程之後，材料或療程庫存會自動扣嗎？',
      options: opts([
        ['auto', '會自動處理', 1],
        ['partial', '部分會', 2],
        ['manual', '要人工處理', 3],
        ['all_manual', '幾乎全部人工', 4],
        ['none', '沒有管理', 5],
      ]),
    },
    {
      id: 'Q18_1', step: 'S5', type: 'multi', exclusive: 'fine', category: 'INVENTORY', pain: true,
      showIf: function (a) { return !!a.Q18 && a.Q18 !== 'auto'; },
      title: '庫存目前最常遇到什麼？',
      hint: '可以複選。',
      options: opts([
        ['mismatch', '數字常常對不起來'], ['unknown_qty', '不知道實際剩多少'], ['forgot_deduct', '做完療程忘了扣'],
        ['slow_count', '盤點很花時間'], ['cost_unclear', '不容易知道成本'], ['expiry', '過期品不好追'], ['fine', '其實目前還好'],
      ]),
    },
    {
      id: 'Q19', step: 'S5', type: 'single',
      title: '醫師／諮詢師／員工的業績，目前怎麼算？',
      options: opts([
        ['system_auto', '系統自動算'], ['excel', 'Excel'], ['manual', '人工整理'],
        ['system_plus_excel', '系統＋Excel'], ['per_department', '每個部門自己算'], ['none', '沒有正式計算'],
      ]),
    },
    {
      id: 'Q20', step: 'S5', type: 'single', category: 'BONUS', pain: true,
      title: '每個月算獎金，會不會算到很累？',
      options: opts([
        ['no_system_handles', '不會，系統都處理好了', 1],
        ['ok', '還好', 2],
        ['bit_troublesome', '有點麻煩', 3],
        ['time_consuming', '很花時間', 4],
        ['painful', '每個月都很痛苦', 5],
      ]),
    },
    {
      id: 'Q20_1', step: 'S5', type: 'single',
      showIf: bonusFollowupNeeded,
      title: '通常每個月大概要花多久整理？',
      options: opts([
        ['lt1h', '1 小時內'], ['1_3h', '1～3 小時'], ['half_day', '半天'], ['1d', '1 天'], ['2_3d', '2～3 天'], ['gt3d', '超過 3 天'],
      ]),
    },
    {
      id: 'Q20_2', step: 'S5', type: 'multi', exclusive: 'none',
      showIf: bonusFollowupNeeded,
      title: '有沒有遇過這些問題？',
      hint: '可以複選。',
      options: opts([
        ['miscalc', '算錯'], ['staff_question', '員工有疑問'], ['recheck', '要重新核對'],
        ['inconsistent', '不同人算出來不一樣'], ['complex_rules', '規則太複雜'], ['incomplete_data', '資料不完整'], ['none', '沒什麼問題'],
      ]),
    },

    /* ===== STEP 6 客戶回流與經營分析 ===== */
    {
      id: 'Q21', step: 'S6', type: 'single', category: 'CUSTOMER_RETENTION', pain: true,
      title: '你現在知道有多少客人超過半年沒回來嗎？',
      options: opts([
        ['anytime', '隨時可以查', 1],
        ['roughly', '大概知道', 2],
        ['need_compile', '要另外整理', 3],
        ['unknown', '不知道', 4],
        ['never_counted', '從來沒有統計過', 5],
      ]),
    },
    {
      id: 'Q22', step: 'S6', type: 'single',
      title: '你們現在有固定做客戶喚回嗎？',
      options: opts([
        ['yes_tracked', '有，而且有完整紀錄'], ['yes_manual', '有，但比較靠人工'], ['occasionally', '偶爾做'],
        ['rarely', '很少做'], ['no', '沒有'],
      ]),
    },
    {
      id: 'Q23', step: 'S6', type: 'multi', exclusive: 'none',
      title: '喚回之後，你知道：',
      hint: '可以複選。',
      options: opts([
        ['contacted', '聯絡了多少人'], ['returned', '回來多少人'], ['revenue', '成交多少錢'],
        ['who_succeeded', '哪個員工喚回成功'], ['why_not', '客人沒回來的原因'], ['none', '以上都不知道'],
      ]),
    },
    {
      id: 'Q24', step: 'S6', type: 'single', category: 'MANAGEMENT_REPORT', pain: true,
      title: '老闆現在想看「這個月營運狀況」，多久可以看到？',
      options: opts([
        ['realtime', '即時', 1],
        ['same_day', '當天', 2],
        ['days_later', '幾天後', 3],
        ['month_end', '月底', 4],
        ['need_compile', '要請人另外整理', 4],
        ['no_numbers', '沒有完整數字', 5],
      ]),
    },
    {
      id: 'Q25', step: 'S6', type: 'multi', exclusive: 'none_visible',
      title: '下面這些數字，目前哪些可以直接看到？',
      hint: '可以複選。',
      options: opts([
        ['revenue', '營業額'], ['new_customers', '新客數'], ['returning', '舊客回流'], ['avg_ticket', '客單價'],
        ['revenue_by_treatment', '療程別營收'], ['customer_source', '客戶來源'], ['doctor_perf', '醫師績效'],
        ['consultant_perf', '諮詢師績效'], ['kpi', 'KPI'], ['bonus', '獎金'], ['inventory_cost', '庫存成本'],
        ['pnl', '損益'], ['none_visible', '都需要另外整理'],
      ]),
    },

    /* ===== STEP 7 最後幾個問題 ===== */
    {
      id: 'Q26', step: 'S7', type: 'multi', exclusive: 'almost_none',
      title: '現在診所還有哪些東西主要靠下面這些方式處理？',
      hint: '可以複選。',
      options: opts([
        ['excel', 'Excel'], ['gsheet', 'Google Sheet'], ['line', 'LINE'], ['paper', '紙本'], ['whatsapp', 'WhatsApp'],
        ['handwriting', '人工抄寫'], ['cross_check', '不同系統互相對'], ['almost_none', '已經幾乎沒有'],
      ]),
    },
    {
      id: 'Q27', step: 'S7', type: 'single', dynamic: 'topCategories', allowOther: true,
      title: '如果現在只能先解決一件事，你最想先解決哪一個？',
      hint: '這幾個是從你前面的回答整理出來的。',
      options: [], // 由 app 依目前分數動態產生，最後固定加上「其他」
    },
    {
      id: 'Q28', step: 'S7', type: 'multi',
      title: '這件事情現在通常是誰在處理？',
      hint: '可以複選。',
      options: opts([
        ['owner', '老闆'], ['director', '院長'], ['manager', '店長 / 經理'], ['front_desk', '櫃台'],
        ['consultant', '諮詢師'], ['nurse', '護理師'], ['finance', '財務'], ['admin', '行政'],
        ['everyone', '大家一起'], ['other', '其他'],
      ]),
    },
    {
      id: 'Q29', step: 'S7', type: 'multi', max: 3,
      title: '如果這件事不用再靠人工處理，你覺得最有感的是什麼？',
      hint: '最多選 3 個。',
      options: opts([
        ['save_time', '省時間'], ['fewer_errors', '少出錯'], ['less_overtime', '少加班'], ['smoother_service', '客人服務更順'],
        ['fewer_complaints', '員工比較不會抱怨'], ['faster_numbers', '老闆可以更快看到數字'], ['revenue_control', '營收比較好管理'],
        ['less_churn', '客戶比較不容易流失'], ['clear_inventory_cost', '庫存成本更清楚'], ['bonus_no_dispute', '獎金比較沒有爭議'], ['other', '其他'],
      ]),
    },
    {
      id: 'Q30', step: 'S7', type: 'single', intent: true,
      title: '你目前是在：',
      options: opts([
        ['exploring', '純粹先了解'], ['comparing', '正在比較系統'], ['current_unhappy', '現有系統不好用'],
        ['switching', '準備換系統'], ['new_clinic', '新診所準備導入'], ['within_3_months', '3 個月內希望改善'], ['asap', '越快越好'],
      ]),
    },
  ];

  var QUESTION_BY_ID = {};
  QUESTIONS.forEach(function (q) { QUESTION_BY_ID[q.id] = q; });

  /** 依目前答案，回傳應該出現的題目（維持原順序） */
  function visibleQuestions(answers) {
    var a = answers || {};
    return QUESTIONS.filter(function (q) { return !q.showIf || q.showIf(a); });
  }

  function stepIndexOf(stepId) {
    for (var i = 0; i < STEPS.length; i += 1) if (STEPS[i].id === stepId) return i;
    return -1;
  }

  function optionLabel(q, value) {
    if (!q) return '';
    for (var i = 0; i < q.options.length; i += 1) if (q.options[i].value === value) return q.options[i].label;
    return '';
  }

  return {
    VERSION: VERSION,
    CATEGORY_KEYS: CATEGORY_KEYS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    PAIN_LABELS: PAIN_LABELS,
    STEPS: STEPS,
    QUESTIONS: QUESTIONS,
    QUESTION_BY_ID: QUESTION_BY_ID,
    visibleQuestions: visibleQuestions,
    stepIndexOf: stepIndexOf,
    optionLabel: optionLabel,
    has: has,
    count: count,
  };
});
