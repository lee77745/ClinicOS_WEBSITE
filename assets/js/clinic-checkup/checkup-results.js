/* =====================================================================
   ClinicOS 診所營運健檢 — 結果文案對應與 payload 組裝（V1.1）
   - RESULT_COPY：每個分類固定四段 title / problemSummary / clinicOSHelp / recommendedDemo
   - RESULT_MODE_COPY：依 TOP 1 分數切換結果頁標題與 CTA 語氣
   - SYSTEMIC_COPY：「另外，我們也注意到」的兩張小卡
   - buildEvidenceSummary：依使用者實際回答 deterministic 組出「你的狀況」1～2 句，
     只描述使用者真的回答過的事，不做推論、不用 AI。
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

  var has = config.has;
  var count = config.count;

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
    /* 系統性分類：保留文案供內部／payload 使用，不進 TOP 3、不產生 Demo 路線 */
    DATA_FRAGMENTATION: {
      title: '資料分散',
      problemSummary: '客戶、成交、照片等資料分散在好幾個工具裡，同一件事要在不同地方各看一次。',
      clinicOSHelp: ['一套系統', '客戶為中心', '預約到收款串起來', '照片與療程對應', '不用來回切換'],
      recommendedDemo: [],
    },
    MANUAL_WORK: {
      title: '人工作業',
      problemSummary: '不少日常工作還是靠 Excel、LINE 或紙本在處理，也要人工把不同系統的資料對起來。',
      clinicOSHelp: ['流程串接', '減少重複輸入', '自動彙整', '減少人工核對', '資料好追蹤'],
      recommendedDemo: [],
    },
  };

  /* ---------- 結果頁模式文案（依 TOP 1 分數） ---------- */
  var RESULT_MODE_COPY = {
    priority: {
      title: '目前最值得先改善的是這 3 個地方',
      lead: '從你的回答來看，這幾個地方目前對日常營運的影響比較明顯。',
      ctaTitle: '想看看 ClinicOS 怎麼處理這幾個問題？',
      ctaBody: '不用從頭看完整系統，我們可以直接從你現在最在意的地方開始。',
    },
    optimize: {
      title: '整體運作還算順，這幾個地方可以再優化',
      lead: '目前沒有特別嚴重的問題，不過這幾個流程還有一些改善空間。',
      ctaTitle: '想看看 ClinicOS 還能幫你省掉哪些事情？',
      ctaBody: '我們可以直接從目前還需要人工處理的地方開始 Demo。',
    },
    healthy: {
      title: '目前整體流程相當順',
      lead: '從你的回答來看，目前沒有明顯的營運卡點。下面是未來可以持續優化的方向。',
      ctaTitle: '想看看 ClinicOS 怎麼把現有流程串得更完整？',
      ctaBody: '即使現在運作順暢，也可以看看客戶、療程、庫存、績效與經營數字怎麼放在同一套流程裡。',
    },
  };

  /* ---------- 系統性觀察小卡 ---------- */
  var SYSTEMIC_COPY = {
    DATA_FRAGMENTATION: {
      title: '資料有點分散',
      text: '你目前有不少資料分散在不同工具或系統，日常查找與月底整理可能會多花一些時間。',
    },
    MANUAL_WORK: {
      title: '人工整理偏多',
      text: '目前仍有一些流程仰賴人工整理、核對或轉抄，這通常也是最容易耗掉管理時間的地方。',
    },
  };
  var SYSTEMIC_LEVEL_LABELS = { high: '高', medium: '中' };

  var DEMO_MAX = 5;
  var EVIDENCE_MAX_CHARS = 100;

  /** 把 TOP 3 的 recommendedDemo 合併、去重，最多 5 項（只用主要分類） */
  function buildDemoList(topKeys) {
    var out = [];
    (topKeys || []).forEach(function (key) {
      var copy = RESULT_COPY[key];
      if (!copy || config.PRIMARY_CATEGORY_KEYS.indexOf(key) === -1) return;
      copy.recommendedDemo.forEach(function (item) {
        if (out.length < DEMO_MAX && out.indexOf(item) === -1) out.push(item);
      });
    });
    return out;
  }

  /* =====================================================================
     Evidence summary — 「你的狀況」
     每個分類是一個 (a) => [片段...] 的函式；片段只在對應題目有答時才出現。
     ===================================================================== */
  function label(qid, value) { return config.optionLabel(config.QUESTION_BY_ID[qid], value); }
  function labels(a, qid, exclude, max) {
    var vals = Array.isArray(a[qid]) ? a[qid] : [];
    var ex = exclude || [];
    return vals.filter(function (v) { return ex.indexOf(v) === -1; })
      .slice(0, max || 3)
      .map(function (v) { return label(qid, v); })
      .filter(Boolean);
  }
  function pick(a, qid, map) {
    var v = a[qid];
    return v !== undefined && map[v] ? map[v] : '';
  }
  function joinList(items) { return items.join('、'); }

  var EVIDENCE = {
    BONUS: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q19', {
        system_auto: '目前業績由系統自動計算',
        excel: '目前獎金主要透過 Excel 處理',
        manual: '目前獎金主要靠人工整理',
        system_plus_excel: '目前獎金是系統加 Excel 一起處理',
        per_department: '目前各部門各自計算業績',
        none: '目前還沒有正式的業績計算方式',
      }));
      parts.push(pick(a, 'Q20', {
        no_system_handles: '每個月算獎金系統都處理好了',
        ok: '每個月算起來還好',
        bit_troublesome: '每個月算起來有點麻煩',
        time_consuming: '每個月算起來很花時間',
        painful: '每個月算起來都很痛苦',
      }));
      if (a.Q20_1) {
        var dur = label('Q20_1', a.Q20_1);
        parts.push((/^\d/.test(dur) ? '每月大約需要 ' : '每月大約需要') + dur + '整理');   // 「2～3 天整理」「半天整理」
      }
      var issues = labels(a, 'Q20_2', ['none'], 3);
      if (issues.length) parts.push('而且曾遇到' + joinList(issues) + '的情況');
      return parts;
    },

    CUSTOMER_RETENTION: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q21', {
        anytime: '目前隨時可以查到久未回診的客戶',
        roughly: '目前大概知道有多少客戶久未回診',
        need_compile: '要另外整理才知道有多少客戶久未回診',
        unknown: '目前不清楚有多少客戶超過半年沒回來',
        never_counted: '目前還沒有固定統計久未回診客戶',
      }));
      parts.push(pick(a, 'Q22', {
        yes_tracked: '喚回有完整紀錄',
        yes_manual: '喚回主要靠人工進行',
        occasionally: '只是偶爾做喚回',
        rarely: '很少做喚回',
        no: '也沒有固定做喚回',
      }));
      if (has(a, 'Q23', 'none')) parts.push('喚回之後也沒有完整追蹤是否回診或成交');
      else if (Array.isArray(a.Q23) && a.Q23.length && (!has(a, 'Q23', 'returned') || !has(a, 'Q23', 'revenue'))) {
        parts.push('喚回後的回診與成交結果還沒有完整追蹤');
      }
      return parts;
    },

    INVENTORY: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q18', {
        auto: '療程完成後庫存會自動處理',
        partial: '療程完成後只有部分庫存會自動扣',
        manual: '療程完成後仍需要人工處理庫存',
        all_manual: '療程完成後庫存幾乎全部靠人工處理',
        none: '目前沒有特別管理庫存',
      }));
      var issues = labels(a, 'Q18_1', ['fine'], 3);
      if (issues.length) parts.push('而且你提到' + joinList(issues));
      return parts;
    },

    PHOTO_MANAGEMENT: function (a) {
      var parts = [];
      if (has(a, 'Q15', 'no_regular')) {
        parts.push('目前沒有固定拍攝或管理術前術後照片');
        return parts;
      }
      var places = labels(a, 'Q15', [], 3);
      if (places.length) parts.push('術前術後照片目前主要放在' + joinList(places));
      parts.push(pick(a, 'Q16', {
        easy: '要找過去影像很方便',
        ok: '要找過去影像還算方便',
        search: '要找過去影像時需要找一下',
        slow: '要找過去影像時比較花時間',
        lost: '要找過去影像時常常找不到',
      }));
      parts.push(pick(a, 'Q17', {
        no: '而且照片沒有和療程紀錄連在一起',
        partial: '照片只有部分和療程紀錄連在一起',
      }));
      return parts;
    },

    MANAGEMENT_REPORT: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q24', {
        realtime: '目前營運數字可以即時看到',
        same_day: '目前當天就能看到營運數字',
        days_later: '通常要幾天後才能看到整體營運狀況',
        month_end: '目前通常要到月底才能看到完整營運狀況',
        need_compile: '營運狀況要請人另外整理才看得到',
        no_numbers: '目前還沒有完整的營運數字',
      }));
      if (has(a, 'Q25', 'none_visible')) parts.push('而且主要數字仍需要另外整理');
      else if (Array.isArray(a.Q25) && a.Q25.length && a.Q25.length <= 3) {
        parts.push('目前能直接看到的主要是' + joinList(labels(a, 'Q25', [], 3)));
      }
      return parts;
    },

    CUSTOMER_DATA: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q6', {
        one_place: '目前一個地方就看得到一位客人的完整資料',
        mostly: '一位客人的完整資料大部分看得到',
        switch_pages: '要切幾個頁面或系統才看得到一位客人的完整資料',
        ask_colleague: '常常要問同事或另外找，才拼得出一位客人的完整資料',
        hard: '目前查一位客人的完整資料很不方便',
      }));
      var places = labels(a, 'Q7', [], 3);
      if (places.length >= 2) parts.push('客戶資料目前分散在' + joinList(places));
      else if (places.length === 1) parts.push('客戶資料主要放在' + places[0]);
      return parts;
    },

    APPOINTMENT: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q8', {
        smooth: '預約目前很順',
        occasional_manual: '預約偶爾要人工確認',
        often_confirm: '預約常常需要 LINE 或電話確認',
        sometimes_clash: '預約偶爾會撞時間或漏掉',
        chaotic: '預約常常很混亂',
      }));
      parts.push(pick(a, 'Q9', {
        front_desk: '現場狀態要靠櫃台通知',
        line_group: '現場狀態靠 LINE 或群組通知',
        unclear: '現場人員不太清楚客人目前的狀態',
      }));
      return parts;
    },

    SALES_WORKFLOW: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q10', {
        rarely: '諮詢到開單幾乎不用重複輸入',
        sometimes: '諮詢到開單偶爾要重複輸入資料',
        often: '諮詢到開單常常要重複輸入資料',
        mostly: '諮詢到開單有很多資料要重新輸入',
      }));
      parts.push(pick(a, 'Q11', {
        two_systems: '報價、成交與付款分成兩套系統',
        scattered: '報價、成交與付款分散在很多地方',
      }));
      return parts;
    },

    PAYMENT_BALANCE: function (a) {
      var parts = [];
      var kinds = labels(a, 'Q12', ['none'], 3);
      if (kinds.length) parts.push('你們有' + joinList(kinds));
      parts.push(pick(a, 'Q12_1', {
        easy: '查客人剩餘金額或療程很方便',
        ok: '查客人剩餘金額或療程還算方便',
        sometimes_manual: '要查客人剩餘金額或療程時偶爾要人工查',
        often_manual: '常常要人工核對客人剩餘金額或療程',
        confusing: '客人剩餘金額或療程很容易搞不清楚',
      }));
      return parts;
    },

    MEDICAL_RECORD: function (a) {
      var parts = [];
      parts.push(pick(a, 'Q14', {
        easy: '療程執行紀錄很方便查',
        ok: '療程執行紀錄還可以查',
        multiple_places: '療程執行紀錄要翻不同地方才找得到',
        paper: '療程執行紀錄常常靠紙本',
        hard: '療程執行紀錄目前很不方便查',
      }));
      parts.push(pick(a, 'Q13', {
        paper: '同意書目前主要是紙本',
        both: '同意書紙本與電子都有',
        varies: '同意書處理方式不一定',
      }));
      return parts;
    },
  };

  /**
   * 依實際回答組出 1～2 句「你的狀況」。沒有可用回答時回傳空字串。
   * 超過 100 字時從尾端丟片段（至少保留 1 段）。
   */
  function buildEvidenceSummary(category, answers) {
    var builder = EVIDENCE[category];
    if (!builder) return '';
    var a = config.sanitizeAnswers(answers);
    var parts = builder(a).filter(Boolean);
    if (!parts.length) return '';
    var text = parts.join('，') + '。';
    while (text.length > EVIDENCE_MAX_CHARS && parts.length > 1) {
      parts.pop();
      text = parts.join('，') + '。';
    }
    return text;
  }

  function rankedItem(r) {
    return { key: r.key, label: r.label, score: r.score, band: r.band.key, bandLabel: r.band.label };
  }

  /**
   * 組出一致的結果 payload（顯示與送出都用這個）。
   * value 一律是 canonical key；label 只是附帶方便顯示。
   * totalScore / painScores 含系統性分類，只留內部參考，UI 不顯示分數。
   */
  function buildPayload(answers, now) {
    var a = config.sanitizeAnswers(answers);
    var scores = scoring.computeScores(a);
    var primary = scoring.rankPrimary(scores);
    var top = primary.slice(0, 3).map(function (r) {
      var item = rankedItem(r);
      item.evidenceSummary = buildEvidenceSummary(r.key, a);
      return item;
    });
    var profile = {};
    config.QUESTIONS.forEach(function (q) { if (q.profile) profile[q.profile] = a[q.id] || ''; });

    var total = 0;
    config.CATEGORY_KEYS.forEach(function (k) { total += scores[k]; });

    var stage = a.Q30A || '';
    var timeline = a.Q30B || '';
    var stageLabel = stage ? label('Q30A', stage) : '';
    var timelineLabel = timeline ? label('Q30B', timeline) : '';

    var systemic = scoring.systemicObservations(scores).map(function (o) {
      return {
        key: o.key, label: config.CATEGORY_LABELS[o.key], score: o.score,
        band: o.band.key, bandLabel: o.band.label,
        level: o.level, levelLabel: SYSTEMIC_LEVEL_LABELS[o.level],
        title: SYSTEMIC_COPY[o.key].title, text: SYSTEMIC_COPY[o.key].text,
      };
    });

    return {
      assessmentVersion: config.VERSION,
      completedAt: (now || new Date()).toISOString(),
      clinicProfile: profile,
      answers: a,
      painScores: scores,
      totalScore: Math.round(total / config.CATEGORY_KEYS.length),
      resultMode: scoring.resultModeOf(top.length ? top[0].score : 0),
      topPainPoints: top,
      otherPainPoints: primary.slice(3).filter(function (r) { return r.score >= 30; }).map(rankedItem),
      systemicObservations: systemic,
      primaryPriority: a.Q27 || '',
      primaryPriorityNote: a.Q27 === 'OTHER' ? (a.Q27_other || '') : '',
      sales: { stage: stage, implementationTimeline: timeline },
      // 相容 V1 的 salesIntent：僅為顯示用的 derived 文字，canonical 以 sales.* 為準
      salesIntent: [stageLabel, timelineLabel].filter(Boolean).join(' · '),
      recommendedDemo: buildDemoList(top.map(function (t) { return t.key; })),
      lead: { clinicName: '', contactName: '', phone: '', email: '', lineId: '' },
    };
  }

  return {
    RESULT_COPY: RESULT_COPY,
    RESULT_MODE_COPY: RESULT_MODE_COPY,
    SYSTEMIC_COPY: SYSTEMIC_COPY,
    DEMO_MAX: DEMO_MAX,
    EVIDENCE_MAX_CHARS: EVIDENCE_MAX_CHARS,
    buildDemoList: buildDemoList,
    buildEvidenceSummary: buildEvidenceSummary,
    buildPayload: buildPayload,
  };
});
