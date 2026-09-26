/* =====================================================================
   ClinicOS 診所營運健檢 — Email 完整報告 測試（node:test，零額外依賴）

   一律使用 mock transport，絕不會連到 Gmail，也不需要任何真實憑證。
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/* 假憑證必須早於 require('../server') */
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret-do-not-use-in-production';
process.env.LINE_CONTACT_TARGET_ID = 'Utest0000000000000000000000000000';
process.env.LINE_WEBHOOK_REVEAL_ID = '';
/* 假 SMTP 設定：transport 會被 mock 取代，不會真的連線 */
process.env.SMTP_HOST = 'smtp.example.invalid';
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = 'test@example.invalid';
process.env.SMTP_PASS = 'test-app-password-not-real';
process.env.CHECKUP_EMAIL_FROM = 'from@example.invalid';
process.env.CHECKUP_EMAIL_TO = 'to@example.invalid';

const app = require('../server');
const report = require('../lib/CheckupEmailReport.js');
const mailer = require('../lib/CheckupMailer.js');
const config = require('../assets/js/clinic-checkup/checkup-config.js');

/* --- LINE mock ------------------------------------------------------- */
const realFetch = globalThis.fetch.bind(globalThis);
let lineCalls = [];
let lineShouldFail = false;
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : String(input && input.url);
  if (url.startsWith('https://api.line.me/')) {
    lineCalls.push({ body: JSON.parse(init.body) });
    if (lineShouldFail) return { ok: false, status: 500 };
    return { ok: true, status: 200 };
  }
  return realFetch(input, init);
};

/* --- SMTP mock ------------------------------------------------------- */
let sentMail = [];
let mailShouldFail = false;
mailer.__setTransport({
  sendMail: async (message) => {
    if (mailShouldFail) throw Object.assign(new Error('mock smtp down'), { code: 'EENVELOPE', responseCode: 550 });
    sentMail.push(message);
    return { messageId: 'mock' };
  },
});

let server;
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  globalThis.fetch = realFetch;
  mailer.__setTransport(null);
  if (server) server.close();
});
test.beforeEach(() => { lineCalls = []; sentMail = []; lineShouldFail = false; mailShouldFail = false; });

let ipSeed = 0;
function nextIp() { ipSeed += 1; return `10.30.${Math.floor(ipSeed / 250)}.${(ipSeed % 250) + 1}`; }

/* 一組完整、通過跳題邏輯的高痛苦答案 */
function fullAnswers(overrides) {
  return Object.assign({
    Q1: '2_3', Q2: '2_3', Q3: '6_10', Q4: '31_60', Q5: 'multiple_systems',
    Q6: 'ask_colleague', Q6_pain: 4, Q7: ['excel', 'line', 'paper'], Q8: 'sometimes_clash', Q8_pain: 3, Q9: 'front_desk',
    Q10: 'sometimes', Q11: 'scattered', Q12: ['none'],
    Q13: 'paper', Q14: 'ok', Q15: ['phone', 'line', 'pc_folder'], Q16: 'slow', Q16_pain: 3, Q17: 'no',
    Q18: 'all_manual', Q18_1: ['unknown_qty', 'slow_count'], Q18_1_pain: 4,
    Q19: 'excel', Q20: 'bit_troublesome', Q20_1: '2_3d', Q20_2: ['recheck'],
    Q21: 'never_counted', Q21_pain: 5, Q22: 'no', Q23: ['none'], Q24: 'month_end', Q25: ['none_visible'],
    Q26: ['excel', 'gsheet', 'line', 'paper', 'handwriting'], Q27: 'CUSTOMER_RETENTION',
    Q28: ['owner'], Q29: ['less_churn'], Q30A: 'COMPARING', Q30B: 'WITHIN_3_MONTHS',
  }, overrides || {});
}

function validBody(overrides) {
  const body = {
    website: '',
    assessmentVersion: '1.1',
    answers: fullAnswers(),
    lead: { clinicName: 'ClinicOS EMAIL TEST', contactName: 'UAT TEST', phone: '0900000000', email: 'test@example.com', lineId: '' },
    summary: {
      assessmentVersion: '1.1',
      completedAt: '2026-09-27T00:00:00.000Z',
      topPainPoints: [
        { key: 'CUSTOMER_RETENTION', score: 100 },
        { key: 'CUSTOMER_DATA', score: 98 },
        { key: 'INVENTORY', score: 98 },
      ],
      primaryPriority: 'CUSTOMER_RETENTION',
      sales: { stage: 'COMPARING', implementationTimeline: 'WITHIN_3_MONTHS' },
      systemicObservations: [{ key: 'DATA_FRAGMENTATION', score: 100 }, { key: 'MANUAL_WORK', score: 100 }],
      recommendedDemo: ['客戶分群與沉睡客', '喚回管理', '回流分析'],
      clinicProfile: { branchCount: '2_3', doctorCount: '2_3', staffCount: '6_10', dailyCustomerCount: '31_60', currentSystemState: 'multiple_systems' },
    },
  };
  return Object.assign(body, overrides || {});
}

async function post(body) {
  const res = await realFetch(`${baseUrl}/api/clinic-checkup/lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function buildReport(answersOverrides, leadOverrides) {
  const answers = report.validateAnswers(fullAnswers(answersOverrides));
  assert.notEqual(answers, null, 'fixture answers must validate');
  return report.buildReportData({
    answers,
    lead: Object.assign({ clinicName: 'ClinicOS EMAIL TEST', contactName: 'UAT TEST', phone: '0900000000', email: 'test@example.com', lineId: '' }, leadOverrides || {}),
    requestId: 'req-test',
    now: new Date('2026-09-27T02:03:04Z'),
  });
}

/* =====================================================================
   1–5 · Validation
   ===================================================================== */

test('E01 · 完整合法 assessment 通過 validation 並成功寄出', async () => {
  const res = await post(validBody());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(sentMail.length, 1, '應寄出一封信');
  assert.equal(lineCalls.length, 1, 'LINE 摘要照常送');
  assert.notEqual(report.validateAnswers(fullAnswers()), null);
});

test('E02 · 未知 question key → 400，且不寄信不推 LINE', async () => {
  assert.equal(report.validateAnswers({ Q999: 'x' }), null);
  assert.equal(report.validateAnswers({ __proto__x: 'x' }), null);
  const res = await post(validBody({ answers: fullAnswers({ Q999: 'anything' }) }));
  assert.equal(res.status, 400);
  assert.equal(sentMail.length, 0);
  assert.equal(lineCalls.length, 0);
});

test('E03 · 未知 option → 400（單選與多選都擋）', async () => {
  assert.equal(report.validateAnswers({ Q1: 'not_an_option' }), null);
  assert.equal(report.validateAnswers({ Q7: ['excel', 'not_an_option'] }), null);
  assert.equal(report.validateAnswers({ Q7: 'excel' }), null, '多選題不接受字串');
  assert.equal(report.validateAnswers({ Q1: ['single'] }), null, '單選題不接受陣列');
  assert.equal(report.validateAnswers({ Q7: ['excel', 'excel'] }), null, '多選不接受重複值');
  const res = await post(validBody({ answers: fullAnswers({ Q1: 'not_an_option' }) }));
  assert.equal(res.status, 400);
  assert.equal(sentMail.length, 0);
});

test('E04 · pain = 6 → 400', async () => {
  assert.equal(report.validateAnswers({ Q6: 'hard', Q6_pain: 6 }), null);
  const res = await post(validBody({ answers: fullAnswers({ Q6_pain: 6 }) }));
  assert.equal(res.status, 400);
  assert.equal(sentMail.length, 0);
});

test('E05 · pain = 0 → 400；非整數與掛錯題目也擋', async () => {
  assert.equal(report.validateAnswers({ Q6: 'hard', Q6_pain: 0 }), null);
  assert.equal(report.validateAnswers({ Q6: 'hard', Q6_pain: 3.5 }), null);
  assert.equal(report.validateAnswers({ Q6: 'hard', Q6_pain: '4' }), null);
  assert.equal(report.validateAnswers({ Q1: 'single', Q1_pain: 3 }), null, 'Q1 沒有痛苦指數');
  assert.equal(report.validateAnswers({ Q6_pain: 3 }), null, '沒回答題目卻有 pain');
  const res = await post(validBody({ answers: fullAnswers({ Q6_pain: 0 }) }));
  assert.equal(res.status, 400);
});

test('E05b · 自由文字長度與 assessmentVersion', async () => {
  assert.notEqual(report.validateAnswers({ Q27: 'OTHER', Q27_other: 'x'.repeat(report.FREE_TEXT_MAX) }), null);
  assert.equal(report.validateAnswers({ Q27: 'OTHER', Q27_other: 'x'.repeat(report.FREE_TEXT_MAX + 1) }), null);
  assert.equal(report.validateAnswers({ Q1: 'single', Q1_other: 'x' }), null, 'Q1 不允許自由文字');
  const res = await post(validBody({ assessmentVersion: '1.0' }));
  assert.equal(res.status, 400, '版本不符應拒絕');
});

/* =====================================================================
   6 · HTML escape
   ===================================================================== */

test('E06 · HTML injection 被 escape，不會形成可執行 script', () => {
  const r = buildReport({ Q27: 'OTHER', Q27_other: '<img src=x onerror=alert(2)>' }, {
    clinicName: '<script>alert(1)</script>',
    contactName: '"><b>bold</b>',
    lineId: "it's & <fine>",
  });
  const html = report.renderHtml(r);
  assert.ok(!html.includes('<script>alert(1)</script>'), '原始 script tag 不得出現');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '應以 escape 後的文字出現');
  /* onerror 這串字仍會出現在「已 escape 的文字」裡，這是安全的；
     真正要成立的性質是：使用者的角括號一律被 escape，無法形成任何 tag。 */
  assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'));
  assert.ok(!/<img/i.test(html), '不得形成真正的 img tag');
  assert.equal(report.escapeHtml('<img src=x onerror=alert(2)>').includes('<'), false);
  assert.ok(html.includes('&quot;&gt;&lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(html.includes('&#39;') && html.includes('&amp;'));
  /* 除了我們自己輸出的 </head></body></html>，不得有使用者塞進來的 tag */
  const bodyOnly = html.slice(html.indexOf('<body'));
  assert.ok(!/<script/i.test(bodyOnly), 'body 內不得有任何 script tag');
  assert.equal(report.escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  /* 主旨用純文字，不做 HTML escape，但也不應被當成 HTML 使用 */
  assert.ok(report.buildSubject(r).includes('<script>alert(1)</script>'));
});

/* =====================================================================
   7–8 · Conditional skip 與 BONUS 完整性
   ===================================================================== */

test('E07 · 跳題略過的題目完全不出現在 Email，也不寫「未回答」', () => {
  /* Q12 都沒有 → 無 Q12-1；Q18 自動 → 無 Q18-1；Q20 還好 → 無 Q20-1/2；Q15 無固定影像 → 無 Q16/Q17 */
  /* JSON 無法攜帶 undefined，真實請求只會「沒有這個 key」，所以用 delete 模擬 */
  const skipped = fullAnswers({ Q12: ['none'], Q18: 'auto', Q20: 'ok', Q15: ['no_regular'] });
  for (const k of ['Q18_1', 'Q18_1_pain', 'Q20_1', 'Q20_2', 'Q16', 'Q16_pain', 'Q17']) delete skipped[k];
  const answers = report.validateAnswers(skipped);
  assert.notEqual(answers, null, 'fixture answers must validate');
  const r = report.buildReportData({
    answers,
    lead: { clinicName: 'ClinicOS EMAIL TEST', contactName: 'UAT TEST', phone: '0900000000', email: 'test@example.com', lineId: '' },
    requestId: 'req-test', now: new Date('2026-09-27T02:03:04Z'),
  });
  const html = report.renderHtml(r);
  const text = report.renderText(r);
  const q = (id) => config.QUESTION_BY_ID[id].title;
  for (const id of ['Q12_1', 'Q18_1', 'Q20_1', 'Q20_2', 'Q16', 'Q17']) {
    assert.ok(!html.includes(report.escapeHtml(q(id))), `${id} 不應出現在 HTML`);
    assert.ok(!text.includes(q(id)), `${id} 不應出現在 text`);
  }
  assert.ok(!html.includes('未回答') && !text.includes('未回答'));
  /* 有出現的題目仍在 */
  assert.ok(html.includes(report.escapeHtml(q('Q12'))) && html.includes(report.escapeHtml(q('Q15'))));
});

test('E08 · BONUS：Excel / 有點麻煩 / 2～3 天 / 重新核對 完整呈現，且無「算錯」', () => {
  const r = buildReport();
  const html = report.renderHtml(r);
  const text = report.renderText(r);
  for (const s of ['Excel', '有點麻煩', '2～3 天', '要重新核對']) {
    assert.ok(text.includes(s), `plain text 應含「${s}」`);
    assert.ok(html.includes(report.escapeHtml(s)), `HTML 應含「${s}」`);
  }
  const bonus = r.categories.find((c) => c.key === 'BONUS');
  assert.equal(bonus.evidenceSummary, '目前獎金主要透過 Excel 處理，每個月算起來有點麻煩，每月大約需要 2～3 天整理，而且曾遇到要重新核對的情況。');
  assert.ok(!text.includes('算錯') && !html.includes('算錯'), '沒回答「算錯」就不得出現');
  /* evidence 與前端 V1.1 同一支函式，語意必然一致 */
  const frontend = require('../assets/js/clinic-checkup/checkup-results.js');
  assert.equal(bonus.evidenceSummary, frontend.buildEvidenceSummary('BONUS', fullAnswers()));
});

/* =====================================================================
   9–13 · LINE / Email 內容切分
   ===================================================================== */

test('E09 · LINE 訊息只有摘要，不含完整 answers 與逐題文字', async () => {
  await post(validBody());
  const text = lineCalls[0].body.messages[0].text;
  assert.match(text, /最值得先改善：/);
  assert.match(text, /系統性觀察：/);
  assert.ok(!text.includes(config.QUESTION_BY_ID.Q6.title), 'LINE 不得有逐題題目');
  assert.ok(!text.includes(config.QUESTION_BY_ID.Q21.title));
  assert.ok(!text.includes('困擾程度'), 'LINE 不得有逐題痛苦指數');
  assert.ok(!text.includes('各營運領域'), 'LINE 不得有 10 領域明細');
  assert.ok(!/Q\d/.test(text), 'LINE 不得出現題號');
  assert.ok(text.length < 1200, `LINE 摘要應維持精簡，實際 ${text.length}`);
});

test('E10 · Email 報告包含完整 answers（七段、所有已回答題目）', async () => {
  await post(validBody());
  const mail = sentMail[0];
  const answers = report.validateAnswers(fullAnswers());
  const shown = config.visibleQuestions(answers).filter((q) => answers[q.id] !== undefined);
  assert.ok(shown.length >= 25, `應有足夠題目，實際 ${shown.length}`);
  for (const q of shown) {
    assert.ok(mail.text.includes(q.title), `plain text 缺少「${q.title}」`);
    assert.ok(mail.html.includes(report.escapeHtml(q.title)), `HTML 缺少「${q.title}」`);
  }
  for (const step of config.STEPS) {
    assert.ok(mail.text.includes(`【${step.title}】`), `缺少段落「${step.title}」`);
  }
  assert.match(mail.text, /困擾程度：4 \/ 5/);
  assert.match(mail.html, /困擾程度：5 \/ 5/);
});

test('E11 · 主旨為 診所名稱 + TOP3；無診所名稱時用預設字樣', async () => {
  await post(validBody());
  assert.equal(sentMail[0].subject, '[ClinicOS 營運健檢] ClinicOS EMAIL TEST｜客戶回流 / 客戶資料 / 庫存管理');
  const noName = report.buildSubject(buildReport(undefined, { clinicName: '' }));
  assert.equal(noName, '[ClinicOS 營運健檢] 新健檢 Lead｜客戶回流 / 客戶資料 / 庫存管理');
});

test('E12 · 有 Email → replyTo 設為填表者 Email', async () => {
  await post(validBody());
  assert.equal(sentMail[0].replyTo, 'test@example.com');
  assert.equal(sentMail[0].to, 'to@example.invalid');
  assert.equal(sentMail[0].from, 'ClinicOS <from@example.invalid>');
});

test('E13 · 無 Email → 不設 replyTo', async () => {
  const body = validBody();
  body.lead.email = '';
  await post(body);
  assert.equal(sentMail.length, 1);
  assert.equal('replyTo' in sentMail[0], false, '沒有 Email 就不應有 replyTo');
});

/* =====================================================================
   14–17 · Delivery strategy
   ===================================================================== */

test('E14 · LINE 成功 + Email 成功 → 200', async () => {
  const res = await post(validBody());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(lineCalls.length, 1);
  assert.equal(sentMail.length, 1);
});

test('E15 · LINE 失敗 + Email 成功 → 200', async () => {
  lineShouldFail = true;
  const res = await post(validBody());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(sentMail.length, 1);
});

test('E16 · LINE 成功 + Email 失敗 → 200', async () => {
  mailShouldFail = true;
  const res = await post(validBody());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(lineCalls.length, 1);
  assert.equal(sentMail.length, 0);
});

test('E17 · LINE 失敗 + Email 失敗 → 502', async () => {
  lineShouldFail = true;
  mailShouldFail = true;
  const res = await post(validBody());
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, message: '訊息暫時無法送出。' });
});

/* =====================================================================
   18 · 本機 / 設定缺失
   ===================================================================== */

test('E18 · SMTP env 缺失不 crash，視為 disabled', async () => {
  assert.equal(mailer.isConfigured({}), false);
  assert.equal(mailer.isConfigured({ SMTP_HOST: 'h', SMTP_PORT: '587' }), false);
  assert.equal(mailer.isConfigured({
    SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p',
    CHECKUP_EMAIL_FROM: 'f@x.tw', CHECKUP_EMAIL_TO: 't@x.tw',
  }), true);

  mailer.__setTransport(null);                 // 取消 mock，改走真實路徑
  const r = buildReport();
  const out = await mailer.sendCheckupReport(r, 'req-disabled', {});   // 空 env
  assert.deepEqual(out, { ok: false, reason: 'disabled' }, '設定不全應視為 disabled 而非丟例外');

  /* 沒有 answers 的舊版前端請求：不寄信，但 LINE 成功仍回 200 */
  mailer.__setTransport({ sendMail: async (m) => { sentMail.push(m); return {}; } });
  const body = validBody();
  delete body.answers;
  delete body.assessmentVersion;
  const res = await post(body);
  assert.equal(res.status, 200);
  assert.equal(sentMail.length, 0, '沒有完整答案就不寄信');
  assert.equal(lineCalls.length, 1, 'LINE 摘要仍照送');
});

/* =====================================================================
   19–21 · 報告內容
   ===================================================================== */

test('E19 · Email HTML 含 10 個 PRIMARY 領域與分數', async () => {
  await post(validBody());
  const mail = sentMail[0];
  const frontend = require('../assets/js/clinic-checkup/checkup-results.js');
  assert.equal(config.PRIMARY_CATEGORY_KEYS.length, 10);
  for (const key of config.PRIMARY_CATEGORY_KEYS) {
    const label = frontend.RESULT_COPY[key].title;
    assert.ok(mail.html.includes(report.escapeHtml(label)), `HTML 缺少領域「${label}」`);
    assert.ok(mail.text.includes(label), `text 缺少領域「${label}」`);
  }
  const r = buildReport();
  assert.equal(r.categories.length, 10);
  assert.ok(r.categories.every((c) => Number.isInteger(c.score) && c.score >= 0 && c.score <= 100));
  assert.ok(r.categories.every((c) => typeof c.level === 'string' && c.level.length > 0));
  /* 系統性分類不得混進這張表 */
  assert.ok(!r.categories.some((c) => config.SYSTEMIC_CATEGORY_KEYS.includes(c.key)));
  /* 依分數遞減 */
  for (let i = 1; i < r.categories.length; i += 1) assert.ok(r.categories[i - 1].score >= r.categories[i].score);
});

test('E20 · 系統性觀察低於 50 不顯示', () => {
  /* 一組幾乎全順的答案：資料分散與人工整理都低 */
  const calm = {
    Q1: 'single', Q2: '1', Q3: '1_5', Q4: '11_30', Q5: 'one_system',
    Q6: 'one_place', Q7: ['system'], Q8: 'smooth', Q9: 'clear',
    Q10: 'rarely', Q11: 'yes', Q12: ['none'],
    Q13: 'e_sign', Q14: 'easy', Q15: ['system'], Q16: 'easy', Q17: 'yes',
    Q18: 'auto', Q19: 'system_auto', Q20: 'no_system_handles',
    Q21: 'anytime', Q22: 'yes_tracked', Q23: ['contacted'], Q24: 'realtime', Q25: ['revenue'],
    Q26: ['almost_none'], Q27: 'CUSTOMER_DATA', Q28: ['owner'], Q29: ['save_time'], Q30A: 'JUST_LOOKING', Q30B: 'NO_TIMELINE',
  };
  const answers = report.validateAnswers(calm);
  assert.notEqual(answers, null);
  const r = report.buildReportData({ answers, lead: { clinicName: 'CALM', contactName: 'X', phone: '0900000000', email: '' }, requestId: 'req-calm', now: new Date() });
  assert.ok(r.painScores.DATA_FRAGMENTATION < report.SYSTEMIC_MIN, String(r.painScores.DATA_FRAGMENTATION));
  assert.ok(r.painScores.MANUAL_WORK < report.SYSTEMIC_MIN, String(r.painScores.MANUAL_WORK));
  assert.equal(r.systemicObservations.length, 0);
  const html = report.renderHtml(r);
  assert.ok(!html.includes('資料有點分散') && !html.includes('人工整理偏多'));
  assert.ok(html.includes('無（資料分散與人工整理皆低於 50）'));
});

test('E21 · 系統性觀察高於 50 正確顯示 Score 與程度', async () => {
  await post(validBody());
  const r = buildReport();
  assert.deepEqual(r.systemicObservations.map((o) => [o.label, o.score, o.level]),
    [['資料分散', 100, '高'], ['人工整理', 100, '高']]);
  const html = report.renderHtml(r);
  assert.ok(html.includes('資料有點分散') && html.includes('人工整理偏多'));
  assert.match(html, /Score：100　程度：高/);
  assert.match(report.renderText(r), /Score：100\n程度：高/);

  /* 中等分數 → 顯示「中」 */
  const mid = Object.assign({}, r, { systemicObservations: [{ key: 'MANUAL_WORK', label: '人工整理', title: '人工整理偏多', text: 't', score: 60, level: '中' }] });
  assert.match(report.renderHtml(mid), /Score：60　程度：中/);
});

/* =====================================================================
   額外 · 報告結構與隱私
   ===================================================================== */

test('E22 · report data 結構完整，且 Email 內容全部由 server 查表產生', () => {
  const r = buildReport();
  assert.equal(r.assessmentVersion, '1.1');
  assert.equal(r.requestId, 'req-test');
  assert.deepEqual(Object.keys(r.lead).sort(), ['clinicName', 'contactName', 'email', 'lineId', 'phone']);
  assert.deepEqual(Object.keys(r.clinicProfile).sort(), ['branchCount', 'currentSystemState', 'dailyCustomerCount', 'doctorCount', 'staffCount']);
  assert.equal(r.topPainPoints.length, 3);
  assert.ok(r.topPainPoints.every((t) => t.clinicOSHelp.length >= 3));
  assert.equal(r.sales.stageLabel, '正在比較不同系統');
  assert.equal(r.sales.implementationTimelineLabel, '3 個月內');
  assert.equal(r.primaryPriority, '客戶回流');
  assert.ok(r.recommendedDemo.length > 0 && r.recommendedDemo.length <= 5);
  assert.equal(r.sections.length, 7);

  /* canonical key 不得外洩到信件內容（顯示一律用中文 label） */
  const html = report.renderHtml(r);
  const text = report.renderText(r);
  for (const key of config.PRIMARY_CATEGORY_KEYS.concat(config.SYSTEMIC_CATEGORY_KEYS)) {
    assert.ok(!html.includes(key), `HTML 不應出現 canonical key ${key}`);
    assert.ok(!text.includes(key), `text 不應出現 canonical key ${key}`);
  }
  assert.ok(!html.includes('COMPARING') && !html.includes('WITHIN_3_MONTHS'));
  /* 兩種格式都要有內容 */
  assert.ok(html.length > 4000 && text.length > 1500);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!/<script/i.test(html.slice(html.indexOf('<body'))));
});
