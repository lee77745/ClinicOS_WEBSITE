/* =====================================================================
   ClinicOS 診所營運健檢 — Email 完整報告

   這支模組做三件事：
     1. validateAnswers()  嚴格白名單驗證前端送來的完整 answers
     2. buildReportData()  由「已驗證的答案」產生 canonical report data
     3. renderHtml() / renderText()  產生信件內容

   重要原則
   - 分數、TOP 3、evidence、Demo 建議一律由前端同一份模組重新計算
     （checkup-scoring.js / checkup-results.js），不在伺服器另寫一套文案，
     信件內容因此與結果頁語意完全一致。
   - 前端送來的任何字串都不會原樣進入 HTML：能查表的一律查表，
     使用者自由輸入（診所名稱等）一律 escapeHtml()。
   - 只描述使用者真的回答過的題目；被跳題略過的題目完全不列出。
   - 不記錄、不儲存；資料只活在這個 request 裡。
   ===================================================================== */
'use strict';

const config = require('../assets/js/clinic-checkup/checkup-config.js');
const scoring = require('../assets/js/clinic-checkup/checkup-scoring.js');
const results = require('../assets/js/clinic-checkup/checkup-results.js');

const FREE_TEXT_MAX = 100;
const PAIN_MIN = 1;
const PAIN_MAX = 5;
const SYSTEMIC_MIN = scoring.SYSTEMIC_THRESHOLD;   // 50
const SYSTEMIC_HIGH = 70;

const SYSTEMIC_SHORT_LABELS = Object.freeze({ DATA_FRAGMENTATION: '資料分散', MANUAL_WORK: '人工整理' });

/* ---------------------------------------------------------------------
   HTML escape — 使用者輸入一律經過這裡
   --------------------------------------------------------------------- */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------------------
   1. 嚴格驗證完整 answers
   --------------------------------------------------------------------- */

/** 某題允許的選項值；Q27 是動態題（主要分類 key 或 OTHER） */
function allowedValues(q) {
  if (q.dynamic === 'topCategories') return config.PRIMARY_CATEGORY_KEYS.concat(['OTHER']);
  return q.options.map((o) => o.value);
}

/**
 * 驗證前端送來的 answers。任何不合法一律整包拒絕（回 null），
 * 不做「靜默丟掉」——那會讓錯誤悄悄進到信件裡。
 */
function validateAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const clean = {};

  for (const key of Object.keys(raw)) {
    const value = raw[key];

    /* 痛苦指數：<qid>_pain，只有標了 pain 的題目才能有，且必須是 1～5 整數 */
    if (key.endsWith('_pain')) {
      const qid = key.slice(0, -'_pain'.length);
      const q = config.QUESTION_BY_ID[qid];
      if (!q || !q.pain) return null;
      if (!Number.isInteger(value) || value < PAIN_MIN || value > PAIN_MAX) return null;
      clean[key] = value;
      continue;
    }

    /* 自由文字：<qid>_other，只有 allowOther 的題目才能有 */
    if (key.endsWith('_other')) {
      const qid = key.slice(0, -'_other'.length);
      const q = config.QUESTION_BY_ID[qid];
      if (!q || !q.allowOther) return null;
      if (typeof value !== 'string') return null;
      if (value.length > FREE_TEXT_MAX) return null;
      clean[key] = value;
      continue;
    }

    /* 題目本身 */
    const q = config.QUESTION_BY_ID[key];
    if (!q) return null;                                   // 未知 question key
    const allowed = allowedValues(q);

    if (q.type === 'multi') {
      if (!Array.isArray(value)) return null;
      if (value.length > allowed.length) return null;
      const seen = new Set();
      for (const v of value) {
        if (typeof v !== 'string') return null;
        if (allowed.indexOf(v) === -1) return null;        // 未知 option
        if (seen.has(v)) return null;                      // 重複值
        seen.add(v);
      }
      clean[key] = value.slice();
      continue;
    }

    if (typeof value !== 'string') return null;
    if (allowed.indexOf(value) === -1) return null;        // 未知 option
    clean[key] = value;
  }

  /* 痛苦指數不能掛在沒有回答的題目上 */
  for (const key of Object.keys(clean)) {
    if (!key.endsWith('_pain') && !key.endsWith('_other')) continue;
    const qid = key.slice(0, key.lastIndexOf('_'));
    if (clean[qid] === undefined) return null;
  }

  return clean;
}

/* ---------------------------------------------------------------------
   2. Canonical report data
   --------------------------------------------------------------------- */

function levelOf(score) {
  return score >= SYSTEMIC_HIGH ? '高' : '中';
}

/** 一題的顯示用答案文字（多選以「、」相接） */
function answerText(q, value) {
  if (q.type === 'multi') {
    return (Array.isArray(value) ? value : [])
      .map((v) => config.optionLabel(q, v))
      .filter(Boolean)
      .join('、');
  }
  if (q.dynamic === 'topCategories') {
    if (value === 'OTHER') return '其他';
    return config.CATEGORY_LABELS[value] || '';
  }
  return config.optionLabel(q, value);
}

/**
 * 由已驗證的答案 + Lead 產生完整報告資料。
 * 分數與 evidence 一律重新計算，不採信前端送來的數字。
 */
function buildReportData(input) {
  const answers = input.answers || {};
  const lead = input.lead || {};
  const requestId = input.requestId || '';
  const now = input.now || new Date();

  const scores = scoring.computeScores(answers);
  const primary = scoring.rankPrimary(scores);
  const visible = config.visibleQuestions(answers);

  /* TOP 3 —— 只取主要分類，附上與結果頁同一套 evidence 與協助路徑 */
  const topPainPoints = primary.slice(0, 3).map((r) => {
    const copy = results.RESULT_COPY[r.key];
    return {
      key: r.key,
      label: copy.title,
      score: r.score,
      band: r.band.key,
      bandLabel: r.band.label,
      evidenceSummary: results.buildEvidenceSummary(r.key, answers),
      clinicOSHelp: copy.clinicOSHelp.slice(),
    };
  });

  /* 系統性觀察：>= 50 才列 */
  const systemicObservations = config.SYSTEMIC_CATEGORY_KEYS
    .filter((k) => scores[k] >= SYSTEMIC_MIN)
    .map((k) => ({
      key: k,
      label: SYSTEMIC_SHORT_LABELS[k],
      title: results.SYSTEMIC_COPY[k].title,
      text: results.SYSTEMIC_COPY[k].text,
      score: scores[k],
      level: levelOf(scores[k]),
    }));

  /* 10 個主要領域（系統性分類不放進這張表） */
  const categories = primary.map((r) => ({
    key: r.key,
    label: results.RESULT_COPY[r.key].title,
    score: r.score,
    level: r.band.label,
    evidenceSummary: results.buildEvidenceSummary(r.key, answers),
    clinicOSHelp: results.RESULT_COPY[r.key].clinicOSHelp.slice(),
  }));

  /* 診所概況 */
  const clinicProfile = {};
  const clinicProfileRows = [];
  config.QUESTIONS.filter((q) => q.profile).forEach((q) => {
    const value = answers[q.id] || '';
    clinicProfile[q.profile] = value;
    if (value) clinicProfileRows.push({ question: q.title, answer: answerText(q, value) });
  });

  /* 完整回答：依 Wizard 原順序分段；被跳題略過的題目完全不出現 */
  const sections = config.STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    items: visible
      .filter((q) => q.step === step.id && answers[q.id] !== undefined)
      .map((q) => {
        const item = { id: q.id, question: q.title, answer: answerText(q, answers[q.id]) };
        if (q.allowOther && answers[q.id] === 'OTHER' && answers[q.id + '_other']) {
          item.note = answers[q.id + '_other'];
        }
        const pain = answers[q.id + '_pain'];
        if (Number.isInteger(pain)) item.painScore = pain;
        return item;
      }),
  })).filter((s) => s.items.length > 0);

  const priorityKey = answers.Q27 || '';
  const primaryPriority = priorityKey === 'OTHER'
    ? (answers.Q27_other || '其他')
    : (config.CATEGORY_LABELS[priorityKey] || '');

  const stage = answers.Q30A || '';
  const timeline = answers.Q30B || '';

  return {
    requestId,
    submittedAt: now,
    assessmentVersion: config.VERSION,
    lead: {
      clinicName: lead.clinicName || '',
      contactName: lead.contactName || '',
      phone: lead.phone || '',
      email: lead.email || '',
      lineId: lead.lineId || '',
    },
    clinicProfile,
    clinicProfileRows,
    topPainPoints,
    systemicObservations,
    primaryPriority,
    primaryPriorityKey: priorityKey,
    sales: {
      stage,
      stageLabel: stage ? config.optionLabel(config.QUESTION_BY_ID.Q30A, stage) : '',
      implementationTimeline: timeline,
      implementationTimelineLabel: timeline ? config.optionLabel(config.QUESTION_BY_ID.Q30B, timeline) : '',
    },
    recommendedDemo: results.buildDemoList(topPainPoints.map((t) => t.key)),
    categories,
    sections,
    painScores: scores,
  };
}

/* ---------------------------------------------------------------------
   3. 主旨
   --------------------------------------------------------------------- */
function buildSubject(report) {
  const who = report.lead.clinicName || '新健檢 Lead';
  const tops = report.topPainPoints.map((t) => t.label).join(' / ');
  return `[ClinicOS 營運健檢] ${who}｜${tops}`;
}

/* ---------------------------------------------------------------------
   4. 時間格式（台灣時間）
   --------------------------------------------------------------------- */
function formatTaipei(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (UTC+8)`;
}

/* ---------------------------------------------------------------------
   5. HTML —— 全部 inline style，無外部 CSS、無 JS，Gmail / Outlook 可讀
   --------------------------------------------------------------------- */
const INK = '#14171A';
const SOFT = '#4B5257';
const MUTE = '#7E858A';
const PINE = '#235043';
const PINE_DEEP = '#1A3B32';
const WASH = '#E7EDE9';
const LINE_C = '#E4DFD8';
const PAPER = '#F7F5F2';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei','Noto Sans TC',Arial,sans-serif";

const EMPTY = '未填寫';

function h2(text) {
  return `<h2 style="margin:36px 0 14px;font-size:15px;font-weight:600;letter-spacing:0.08em;color:${PINE};border-bottom:1px solid ${LINE_C};padding-bottom:8px;">${escapeHtml(text)}</h2>`;
}

function kv(label, value) {
  return `<tr>`
    + `<td style="padding:5px 16px 5px 0;font-size:13px;color:${MUTE};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>`
    + `<td style="padding:5px 0;font-size:14px;color:${INK};vertical-align:top;">${escapeHtml(value || EMPTY)}</td>`
    + `</tr>`;
}

function renderHtml(report) {
  const r = report;
  const parts = [];

  parts.push(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(buildSubject(r))}</title></head>`
    + `<body style="margin:0;padding:0;background:${PAPER};">`
    + `<div style="max-width:680px;margin:0 auto;padding:28px 20px 48px;font-family:${FONT};line-height:1.75;color:${INK};">`);

  /* Header */
  parts.push(`<div style="padding-bottom:18px;border-bottom:2px solid ${PINE};">`
    + `<div style="font-size:12px;letter-spacing:0.22em;color:${MUTE};text-transform:uppercase;">ClinicOS</div>`
    + `<div style="margin-top:6px;font-size:22px;font-weight:600;color:${INK};">診所營運健檢報告</div>`
    + `</div>`);

  /* Lead */
  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:18px;border-collapse:collapse;">`
    + kv('診所名稱', r.lead.clinicName)
    + kv('聯絡人', r.lead.contactName)
    + kv('電話', r.lead.phone)
    + kv('Email', r.lead.email)
    + kv('LINE ID', r.lead.lineId)
    + `</table>`);

  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:14px;padding-top:12px;border-top:1px solid ${LINE_C};border-collapse:collapse;">`
    + kv('填寫時間', formatTaipei(r.submittedAt))
    + kv('Request ID', r.requestId)
    + kv('Assessment Version', r.assessmentVersion)
    + `</table>`);

  /* 一、健檢摘要 */
  parts.push(h2('一、健檢摘要'));
  parts.push(`<div style="font-size:13px;color:${SOFT};margin-bottom:12px;">最值得先改善：</div>`);
  r.topPainPoints.forEach((t, i) => {
    const idx = String(i + 1).padStart(2, '0');
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:12px;border-collapse:separate;">`
      + `<tr><td style="padding:16px 18px;background:#FFFFFF;border:1px solid ${LINE_C};border-radius:6px;">`
      + `<div style="font-size:12px;color:${MUTE};font-family:monospace;">${idx}</div>`
      + `<div style="margin-top:4px;font-size:17px;font-weight:600;color:${INK};">${escapeHtml(t.label)}`
      + `<span style="display:inline-block;margin-left:10px;padding:2px 10px;font-size:12px;font-weight:400;color:${PINE_DEEP};background:${WASH};border-radius:999px;">${escapeHtml(t.bandLabel)}</span>`
      + `</div>`
      + `<div style="margin-top:8px;font-size:13px;color:${MUTE};">分數：${t.score} / 100　程度：${escapeHtml(t.bandLabel)}</div>`
      + (t.evidenceSummary
        ? `<div style="margin-top:12px;font-size:12px;letter-spacing:0.08em;color:${MUTE};">你的狀況</div>`
          + `<div style="margin-top:3px;font-size:14px;color:${INK};">${escapeHtml(t.evidenceSummary)}</div>`
        : '')
      + `<div style="margin-top:12px;font-size:12px;letter-spacing:0.08em;color:${MUTE};">ClinicOS 可以怎麼協助</div>`
      + `<div style="margin-top:3px;font-size:14px;color:${PINE_DEEP};">${t.clinicOSHelp.map(escapeHtml).join(' &rarr; ')}</div>`
      + `</td></tr></table>`);
  });

  /* 二、系統性觀察 */
  parts.push(h2('二、系統性觀察'));
  if (r.systemicObservations.length) {
    r.systemicObservations.forEach((o) => {
      parts.push(`<div style="margin-bottom:10px;padding:12px 16px;border:1px solid ${LINE_C};border-radius:6px;">`
        + `<div style="font-size:15px;font-weight:600;color:${INK};">${escapeHtml(o.title)}</div>`
        + `<div style="margin-top:4px;font-size:13px;color:${MUTE};">Score：${o.score}　程度：${escapeHtml(o.level)}</div>`
        + `<div style="margin-top:6px;font-size:14px;color:${SOFT};">${escapeHtml(o.text)}</div>`
        + `</div>`);
    });
  } else {
    parts.push(`<div style="font-size:14px;color:${SOFT};">無（資料分散與人工整理皆低於 50）。</div>`);
  }

  /* 三、目前最想先解決 */
  parts.push(h2('三、目前最想先解決'));
  parts.push(`<div style="font-size:16px;color:${INK};">${escapeHtml(r.primaryPriority || EMPTY)}</div>`);

  /* 四、目前評估階段 */
  parts.push(h2('四、目前評估階段'));
  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">`
    + kv('目前階段', r.sales.stageLabel)
    + kv('希望改善時間', r.sales.implementationTimelineLabel)
    + `</table>`);

  /* 五、建議 Demo 路線 */
  parts.push(h2('五、建議 Demo 路線'));
  parts.push(r.recommendedDemo.length
    ? `<div style="font-size:15px;color:${PINE_DEEP};">${r.recommendedDemo.map(escapeHtml).join(' &rarr; ')}</div>`
    : `<div style="font-size:14px;color:${SOFT};">${EMPTY}</div>`);

  /* 六、診所概況 */
  parts.push(h2('六、診所概況'));
  if (r.clinicProfileRows.length) {
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">`
      + r.clinicProfileRows.map((row) => `<tr>`
        + `<td style="padding:6px 16px 6px 0;font-size:13px;color:${MUTE};vertical-align:top;">${escapeHtml(row.question)}</td>`
        + `<td style="padding:6px 0;font-size:14px;color:${INK};vertical-align:top;">${escapeHtml(row.answer)}</td>`
        + `</tr>`).join('')
      + `</table>`);
  } else {
    parts.push(`<div style="font-size:14px;color:${SOFT};">${EMPTY}</div>`);
  }

  /* 七、各營運領域結果 */
  parts.push(h2('七、各營運領域結果'));
  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">`
    + `<tr>`
    + `<th align="left" style="padding:6px 12px 6px 0;font-size:12px;font-weight:500;color:${MUTE};border-bottom:1px solid ${LINE_C};">領域</th>`
    + `<th align="right" style="padding:6px 12px;font-size:12px;font-weight:500;color:${MUTE};border-bottom:1px solid ${LINE_C};">Score</th>`
    + `<th align="left" style="padding:6px 0 6px 12px;font-size:12px;font-weight:500;color:${MUTE};border-bottom:1px solid ${LINE_C};">程度</th>`
    + `</tr>`
    + r.categories.map((c) => `<tr>`
      + `<td style="padding:8px 12px 8px 0;font-size:14px;color:${INK};border-bottom:1px solid #F0EDE8;">${escapeHtml(c.label)}</td>`
      + `<td align="right" style="padding:8px 12px;font-size:14px;color:${INK};border-bottom:1px solid #F0EDE8;">${c.score}</td>`
      + `<td style="padding:8px 0 8px 12px;font-size:13px;color:${SOFT};border-bottom:1px solid #F0EDE8;">${escapeHtml(c.level)}</td>`
      + `</tr>`).join('')
    + `</table>`);

  /* 八、完整健檢回答 */
  parts.push(h2('八、完整健檢回答'));
  r.sections.forEach((s) => {
    parts.push(`<div style="margin-top:18px;padding:6px 12px;background:${WASH};font-size:14px;font-weight:600;color:${PINE_DEEP};border-radius:4px;">【${escapeHtml(s.title)}】</div>`);
    s.items.forEach((item) => {
      parts.push(`<div style="margin-top:12px;">`
        + `<div style="font-size:13px;color:${MUTE};">${escapeHtml(item.question)}</div>`
        + `<div style="margin-top:2px;font-size:14px;color:${INK};">&rarr; ${escapeHtml(item.answer || EMPTY)}</div>`
        + (item.note ? `<div style="margin-top:2px;font-size:14px;color:${INK};">（${escapeHtml(item.note)}）</div>` : '')
        + (item.painScore ? `<div style="margin-top:4px;font-size:13px;color:${PINE};">困擾程度：${item.painScore} / 5</div>` : '')
        + `</div>`);
    });
  });

  parts.push(`<div style="margin-top:40px;padding-top:14px;border-top:1px solid ${LINE_C};font-size:12px;color:${MUTE};">`
    + `此報告由 ClinicOS 官網診所營運健檢自動產生，僅供內部業務與流程改善參考。`
    + `</div>`);

  parts.push(`</div></body></html>`);
  return parts.join('');
}

/* ---------------------------------------------------------------------
   6. Plain text fallback
   --------------------------------------------------------------------- */
function renderText(report) {
  const r = report;
  const L = [];
  const rule = '--------------------------------------------------';

  L.push('ClinicOS 診所營運健檢報告', '');
  L.push(`診所名稱：${r.lead.clinicName || EMPTY}`);
  L.push(`聯絡人：${r.lead.contactName || EMPTY}`);
  L.push(`電話：${r.lead.phone || EMPTY}`);
  L.push(`Email：${r.lead.email || EMPTY}`);
  L.push(`LINE ID：${r.lead.lineId || EMPTY}`);
  L.push('');
  L.push(`填寫時間：${formatTaipei(r.submittedAt)}`);
  L.push(`Request ID：${r.requestId}`);
  L.push(`Assessment Version：${r.assessmentVersion}`);

  L.push('', rule, '一、健檢摘要', '');
  L.push('最值得先改善：');
  r.topPainPoints.forEach((t, i) => {
    L.push('');
    L.push(`${String(i + 1).padStart(2, '0')} ${t.label}`);
    L.push(`分數：${t.score}`);
    L.push(`程度：${t.bandLabel}`);
    if (t.evidenceSummary) { L.push('你的狀況：', t.evidenceSummary); }
    L.push('ClinicOS 可以怎麼協助：', t.clinicOSHelp.join(' → '));
  });

  L.push('', rule, '二、系統性觀察', '');
  if (r.systemicObservations.length) {
    r.systemicObservations.forEach((o) => {
      L.push(o.title);
      L.push(`Score：${o.score}`);
      L.push(`程度：${o.level}`);
      L.push(o.text, '');
    });
  } else {
    L.push('無（資料分散與人工整理皆低於 50）。', '');
  }

  L.push(rule, '三、目前最想先解決', '', r.primaryPriority || EMPTY);

  L.push('', rule, '四、目前評估階段', '');
  L.push(`目前階段：${r.sales.stageLabel || EMPTY}`);
  L.push(`希望改善時間：${r.sales.implementationTimelineLabel || EMPTY}`);

  L.push('', rule, '五、建議 Demo 路線', '');
  L.push(r.recommendedDemo.length ? r.recommendedDemo.join(' → ') : EMPTY);

  L.push('', rule, '六、診所概況', '');
  if (r.clinicProfileRows.length) {
    r.clinicProfileRows.forEach((row) => { L.push(row.question, `→ ${row.answer}`, ''); });
  } else {
    L.push(EMPTY, '');
  }

  L.push(rule, '七、各營運領域結果', '');
  r.categories.forEach((c) => { L.push(`${c.label}　${c.score}　${c.level}`); });

  L.push('', rule, '八、完整健檢回答');
  r.sections.forEach((s) => {
    L.push('', `【${s.title}】`, '');
    s.items.forEach((item) => {
      L.push(item.question);
      L.push(`→ ${item.answer || EMPTY}`);
      if (item.note) L.push(`（${item.note}）`);
      if (item.painScore) L.push(`困擾程度：${item.painScore} / 5`);
      L.push('');
    });
  });

  L.push(rule);
  L.push('此報告由 ClinicOS 官網診所營運健檢自動產生，僅供內部業務與流程改善參考。');

  return L.join('\n');
}

module.exports = {
  FREE_TEXT_MAX,
  SYSTEMIC_MIN,
  escapeHtml,
  validateAnswers,
  buildReportData,
  buildSubject,
  renderHtml,
  renderText,
  formatTaipei,
};
