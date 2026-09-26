/* =====================================================================
   ClinicOS 診所營運健檢 — 計分（V1）
   所有計分規則集中在這裡。deterministic：同一組答案永遠得到同一組分數。

   每個分類 0～100：
     base   = 痛苦指數 × 20（沒填痛苦指數時，改用選項的 level × 20）
     score  = base × 阻力權重(level) + 加成（每項 +10）
     cap    = 100

   阻力權重（依主要單選題的 level）：
     level 1 → 0.6   level 2 → 0.8   level 3 → 1.0   level 4 → 1.1   level 5 → 1.2

   加成（各分類註明）：
     大量人工 +10 · 資料跨 3 個以上工具 +10 · 每月花 1 天以上 +10
     不知道目前狀況 +10 · 已有錯誤／爭議 +10 · 使用者自選最想先解決 +10

   DATA_FRAGMENTATION 與 MANUAL_WORK 沒有痛苦指數題，
   直接由「分散程度／人工程度」換算。
   ===================================================================== */
(function (root, factory) {
  var config = (typeof module === 'object' && module.exports)
    ? require('./checkup-config.js')
    : root.ClinicCheckup.config;
  var api = factory(config);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ClinicCheckup = root.ClinicCheckup || {};
  root.ClinicCheckup.scoring = api;
})(typeof window !== 'undefined' ? window : globalThis, function (config) {
  'use strict';

  var has = config.has;
  var count = config.count;

  var PAIN_UNIT = 20;
  var BONUS = 10;
  var MAX = 100;
  var FRICTION_WEIGHT = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.1, 5: 1.2 };
  var NO_PHOTO_MANAGEMENT_SCORE = 40;   // Q15「目前沒有固定拍攝／管理」→ 可以再優化，不當成痛點

  /* 結果頁模式：依 TOP 1（主要分類）分數決定標題與 CTA 語氣 */
  var RESULT_MODES = [
    { min: 50, key: 'priority' },
    { min: 30, key: 'optimize' },
    { min: 0, key: 'healthy' },
  ];

  var BANDS = [
    { min: 85, key: 'critical', label: '最值得先處理' },
    { min: 70, key: 'high', label: '很困擾' },
    { min: 50, key: 'medium', label: '有點卡' },
    { min: 30, key: 'low', label: '可以再優化' },
    { min: 0, key: 'fine', label: '目前還好' },
  ];

  function cap(n) { return Math.max(0, Math.min(MAX, Math.round(n))); }

  function levelOf(answers, qid) {
    var q = config.QUESTION_BY_ID[qid];
    var v = answers[qid];
    if (!q || v === undefined || v === null) return 0;
    for (var i = 0; i < q.options.length; i += 1) {
      if (q.options[i].value === v) return q.options[i].level || 0;
    }
    return 0;
  }

  function painOf(answers, qid) {
    var p = Number(answers[qid + '_pain']);
    return p >= 1 && p <= 5 ? p : 0;
  }

  /**
   * 「主題＋痛苦指數」型分類的基本分。
   * 未回答主題 → 0（該分類完全沒被問到時不會被亂加分）。
   */
  function painBase(answers, qid) {
    var level = levelOf(answers, qid);
    if (!level) return 0;
    var pain = painOf(answers, qid);
    var base = (pain || level) * PAIN_UNIT;
    return base * FRICTION_WEIGHT[level];
  }

  function bonusIf(cond) { return cond ? BONUS : 0; }

  /* ---------- 各分類 ---------- */
  var RULES = {
    CUSTOMER_DATA: function (a) {
      if (!a.Q6) return 0;
      return painBase(a, 'Q6')
        + bonusIf(count(a, 'Q7') >= 3);                       // 資料跨 3 個以上工具
    },

    APPOINTMENT: function (a) {
      if (!a.Q8) return 0;
      return painBase(a, 'Q8')
        + bonusIf(has(a, 'Q9', 'front_desk') || has(a, 'Q9', 'line_group') || has(a, 'Q9', 'unclear')); // 靠人工通知
    },

    SALES_WORKFLOW: function (a) {
      if (!a.Q10) return 0;
      return painBase(a, 'Q10')
        + bonusIf(has(a, 'Q11', 'two_systems') || has(a, 'Q11', 'scattered')); // 報價／成交／付款分開
    },

    PAYMENT_BALANCE: function (a) {
      if (!a.Q12_1) return 0;                                 // 沒有儲值／訂金等 → 不計
      return painBase(a, 'Q12_1')
        + bonusIf(count(a, 'Q12', ['none']) >= 3);            // 多種餘額型態同時存在
    },

    MEDICAL_RECORD: function (a) {
      if (!a.Q14) return 0;
      return painBase(a, 'Q14')
        + bonusIf(has(a, 'Q13', 'paper') || has(a, 'Q13', 'varies')); // 同意書仍靠紙本
    },

    PHOTO_MANAGEMENT: function (a) {
      // 沒有固定拍攝／管理：不一定痛，給適度分數（level 2 的基本分，不乘權重、不加成）
      if (has(a, 'Q15', 'no_regular')) return NO_PHOTO_MANAGEMENT_SCORE;
      if (!a.Q16) return 0;
      return painBase(a, 'Q16')
        + bonusIf(count(a, 'Q15') >= 3)                       // 照片散在 3 個以上地方
        + bonusIf(has(a, 'Q17', 'no'));                       // 照片與療程沒連在一起
    },

    INVENTORY: function (a) {
      if (!a.Q18) return 0;
      var level = levelOf(a, 'Q18');
      if (level <= 1) return 0;                               // 會自動處理
      var pain = painOf(a, 'Q18_1');
      var base = (pain || level) * PAIN_UNIT * FRICTION_WEIGHT[level];
      return base
        + bonusIf(has(a, 'Q18_1', 'mismatch'))                // 已有錯誤
        + bonusIf(has(a, 'Q18_1', 'unknown_qty'))             // 不知道目前狀況
        + bonusIf(count(a, 'Q18_1', ['fine']) >= 3);          // 多重人工問題
    },

    BONUS: function (a) {
      if (!a.Q20) return 0;
      return painBase(a, 'Q20')
        + bonusIf(has(a, 'Q19', 'excel') || has(a, 'Q19', 'manual') || has(a, 'Q19', 'system_plus_excel') || has(a, 'Q19', 'per_department')) // 大量人工
        + bonusIf(has(a, 'Q20_1', '1d') || has(a, 'Q20_1', '2_3d') || has(a, 'Q20_1', 'gt3d'))   // 每月花 1 天以上
        + bonusIf(count(a, 'Q20_2', ['none']) >= 1);          // 已有錯誤／爭議
    },

    CUSTOMER_RETENTION: function (a) {
      if (!a.Q21) return 0;
      return painBase(a, 'Q21')
        + bonusIf(has(a, 'Q22', 'rarely') || has(a, 'Q22', 'no'))   // 沒有固定喚回
        + bonusIf(has(a, 'Q23', 'none') || (Array.isArray(a.Q23) && a.Q23.length === 0)); // 不知道喚回結果
    },

    MANAGEMENT_REPORT: function (a) {
      if (!a.Q24) return 0;
      var visible = count(a, 'Q25', ['none_visible']);
      return painBase(a, 'Q24')
        + bonusIf(has(a, 'Q25', 'none_visible'))              // 全部要另外整理
        + bonusIf(!has(a, 'Q25', 'none_visible') && Array.isArray(a.Q25) && visible <= 3); // 看得到的數字很少
    },

    /* 沒有痛苦指數題：由分散程度直接換算 */
    DATA_FRAGMENTATION: function (a) {
      var sources = count(a, 'Q7');
      var score = sources >= 4 ? 80 : sources === 3 ? 60 : sources === 2 ? 35 : sources === 1 ? 10 : 0;
      if (has(a, 'Q5', 'multiple_systems') || has(a, 'Q5', 'system_plus_tools')) score += 15;
      if (has(a, 'Q5', 'no_system')) score += 10;
      if (has(a, 'Q11', 'two_systems')) score += 10;
      if (has(a, 'Q11', 'scattered')) score += 20;
      if (count(a, 'Q15') >= 3) score += 10;
      if (has(a, 'Q17', 'no')) score += 5;
      return score;
    },

    /* 沒有痛苦指數題：由人工程度直接換算 */
    MANUAL_WORK: function (a) {
      if (has(a, 'Q26', 'almost_none')) return 0;
      var n = count(a, 'Q26', ['almost_none']);
      var score = Math.min(5, n) * 20;
      if (n === 0) return 0;
      if (has(a, 'Q19', 'manual') || has(a, 'Q19', 'excel')) score += BONUS;
      if (has(a, 'Q18', 'all_manual') || has(a, 'Q18', 'manual')) score += BONUS;
      return score;
    },
  };

  /**
   * 計算 12 個分類分數（0～100）。
   * options.priority：使用者在 Q27 選的分類，會 +10（有選才加）。
   */
  /**
   * 只保留「目前會出現的題目」的答案。
   * 使用者回頭改答案後，被跳過的條件題可能還留著舊答案，不能拿來計分。
   */
  function effectiveAnswers(answers) {
    var a = config.sanitizeAnswers(answers);   // 舊版 state 的無效選項先清掉，不會 crash
    var keep = {};
    config.visibleQuestions(a).forEach(function (q) {
      if (a[q.id] !== undefined) keep[q.id] = a[q.id];
      if (a[q.id + '_pain'] !== undefined) keep[q.id + '_pain'] = a[q.id + '_pain'];
      if (a[q.id + '_other'] !== undefined) keep[q.id + '_other'] = a[q.id + '_other'];
    });
    return keep;
  }

  function computeScores(answers, options) {
    var a = effectiveAnswers(answers);
    var priority = options && options.priority !== undefined ? options.priority : a.Q27;
    var scores = {};
    config.CATEGORY_KEYS.forEach(function (key) {
      var raw = RULES[key](a);
      if (priority === key && raw > 0) raw += BONUS;
      scores[key] = cap(raw);
    });
    return scores;
  }

  function bandOf(score) {
    for (var i = 0; i < BANDS.length; i += 1) if (score >= BANDS[i].min) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  /** 依分數排序（同分時依 keys 原順序，保證 deterministic） */
  function rankKeys(scores, keys) {
    return keys.slice().sort(function (x, y) {
      return scores[y] - scores[x] || keys.indexOf(x) - keys.indexOf(y);
    }).map(function (key) {
      return { key: key, label: config.CATEGORY_LABELS[key], score: scores[key], band: bandOf(scores[key]) };
    });
  }

  /** 全部 12 類的排序（內部分析用） */
  function rank(scores) { return rankKeys(scores, config.CATEGORY_KEYS); }

  /** 只有主要分類的排序 —— TOP 3、其他可優化、Q27、Demo 建議都用這個 */
  function rankPrimary(scores) { return rankKeys(scores, config.PRIMARY_CATEGORY_KEYS); }

  function topN(scores, n) { return rankPrimary(scores).slice(0, n); }

  /** 系統性觀察：DATA_FRAGMENTATION / MANUAL_WORK >= 50 才列 */
  var SYSTEMIC_THRESHOLD = 50;
  function systemicObservations(scores) {
    return config.SYSTEMIC_CATEGORY_KEYS
      .filter(function (k) { return scores[k] >= SYSTEMIC_THRESHOLD; })
      .map(function (k) { return { key: k, score: scores[k], band: bandOf(scores[k]), level: scores[k] >= 70 ? 'high' : 'medium' }; });
  }

  function resultModeOf(top1Score) {
    for (var i = 0; i < RESULT_MODES.length; i += 1) if (top1Score >= RESULT_MODES[i].min) return RESULT_MODES[i].key;
    return 'healthy';
  }

  /** Q27 的動態選項：目前分數最高的 5 個主要分類 */
  function priorityOptions(answers) {
    var scores = computeScores(answers, { priority: null });
    return rankPrimary(scores).slice(0, 5).map(function (r) { return { value: r.key, label: r.label }; });
  }

  return {
    PAIN_UNIT: PAIN_UNIT,
    BONUS: BONUS,
    MAX: MAX,
    FRICTION_WEIGHT: FRICTION_WEIGHT,
    BANDS: BANDS,
    NO_PHOTO_MANAGEMENT_SCORE: NO_PHOTO_MANAGEMENT_SCORE,
    SYSTEMIC_THRESHOLD: SYSTEMIC_THRESHOLD,
    computeScores: computeScores,
    bandOf: bandOf,
    rank: rank,
    rankPrimary: rankPrimary,
    topN: topN,
    systemicObservations: systemicObservations,
    resultModeOf: resultModeOf,
    priorityOptions: priorityOptions,
  };
});
