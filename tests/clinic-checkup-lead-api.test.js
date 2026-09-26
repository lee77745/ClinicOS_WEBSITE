/* =====================================================================
   ClinicOS 診所營運健檢 — Lead API 自動測試（node:test，零額外依賴）
   POST /api/clinic-checkup/lead → LINE Push（全 mock，不會打到 api.line.me）
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret-do-not-use-in-production';
process.env.LINE_CONTACT_TARGET_ID = 'Utest0000000000000000000000000000';
process.env.LINE_WEBHOOK_REVEAL_ID = '';

const app = require('../server');
const { validateCheckupLead, buildCheckupMessage } = app.__test;

const realFetch = globalThis.fetch.bind(globalThis);
let lineCalls = [];
let lineShouldFail = false;

globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : String(input && input.url);
  if (url.startsWith('https://api.line.me/')) {
    lineCalls.push({ url, init, body: JSON.parse(init.body) });
    if (lineShouldFail) return { ok: false, status: 500 };
    return { ok: true, status: 200 };
  }
  return realFetch(input, init);
};

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  globalThis.fetch = realFetch;
  if (server) server.close();
});
test.beforeEach(() => { lineCalls = []; lineShouldFail = false; });

let ipSeed = 0;
function nextIp() {
  ipSeed += 1;
  return `10.20.${Math.floor(ipSeed / 250)}.${(ipSeed % 250) + 1}`;
}

function validBody(overrides) {
  const body = {
    website: '',
    lead: { clinicName: 'ClinicOS 測試診所', contactName: '王小明', phone: '02-12345678', email: '', lineId: '' },
    summary: {
      assessmentVersion: '1.0',
      completedAt: '2026-09-26T00:00:00.000Z',
      topPainPoints: [
        { key: 'CUSTOMER_RETENTION', score: 92 },
        { key: 'BONUS', score: 88 },
        { key: 'INVENTORY', score: 76 },
      ],
      primaryPriority: 'BONUS',
      sales: { stage: 'COMPARING', implementationTimeline: 'WITHIN_3_MONTHS' },
      systemicObservations: [{ key: 'DATA_FRAGMENTATION', score: 85 }, { key: 'MANUAL_WORK', score: 60 }],
      recommendedDemo: ['客戶分群與沉睡客', '喚回管理', '成交', 'KPI', '獎金'],
      clinicProfile: { branchCount: '2_3', doctorCount: '2_3', staffCount: '6_10', dailyCustomerCount: '31_60', currentSystemState: 'system_plus_tools' },
    },
  };
  return Object.assign(body, overrides || {});
}

async function post(body, raw) {
  const res = await realFetch(`${baseUrl}/api/clinic-checkup/lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

test('01 · 合法 Lead → 200，LINE 訊息含標籤文字而非 key', async () => {
  const res = await post(validBody());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, message: '已收到您的訊息。' });
  assert.equal(lineCalls.length, 1);
  const text = lineCalls[0].body.messages[0].text;
  assert.match(text, /ClinicOS 官網營運健檢/);
  assert.match(text, /1\. 客戶回流（92）/);
  assert.match(text, /最想先解決：\n獎金與績效/);
  assert.match(text, /目前階段：\n正在比較不同系統/);
  assert.match(text, /希望時程：\n3 個月內/);
  assert.match(text, /系統性觀察：\n資料分散：高\n人工整理：中/);
  assert.match(text, /2～3 間/);
  assert.doesNotMatch(text, /CUSTOMER_RETENTION/);
  assert.equal(lineCalls[0].body.to, 'Utest0000000000000000000000000000');
});

test('01b · V1.1：TOP 3 不接受系統性分類；系統性觀察 < 50 不列；未知 stage → 400', async () => {
  const sys = validBody(); sys.summary.topPainPoints = [{ key: 'DATA_FRAGMENTATION', score: 90 }];
  assert.equal((await post(sys)).status, 400);
  const badStage = validBody(); badStage.summary.sales = { stage: 'NOPE', implementationTimeline: '' };
  assert.equal((await post(badStage)).status, 400);
  const low = validBody(); low.summary.systemicObservations = [{ key: 'MANUAL_WORK', score: 49 }];
  const res = await post(low);
  assert.equal(res.status, 200);
  assert.doesNotMatch(lineCalls[0].body.messages[0].text, /系統性觀察/);
});

test('01c · V1 舊前端只帶 salesIntent 仍可送出，目前階段顯示該文字', async () => {
  const legacy = validBody(); delete legacy.summary.sales; delete legacy.summary.systemicObservations; legacy.summary.salesIntent = '3 個月內希望改善';
  const res = await post(legacy);
  assert.equal(res.status, 200);
  assert.match(lineCalls[0].body.messages[0].text, /目前階段：\n3 個月內希望改善/);
  assert.match(lineCalls[0].body.messages[0].text, /希望時程：\n未填寫/);
});

test('02 · Email 選填：空白可過，格式錯 → 400', async () => {
  const ok = await post(validBody({ lead: { clinicName: 'A 診所', contactName: '李', phone: '0912345678', email: 'a@b.tw', lineId: 'abc' } }));
  assert.equal(ok.status, 200);
  const bad = await post(validBody({ lead: { clinicName: 'A 診所', contactName: '李', phone: '0912345678', email: 'not-an-email' } }));
  assert.equal(bad.status, 400);
  assert.equal(lineCalls.length, 1);
});

test('03 · 缺電話 / 電話無效 → 400', async () => {
  const missing = await post(validBody({ lead: { clinicName: 'A', contactName: 'B' } }));
  assert.equal(missing.status, 400);
  const invalid = await post(validBody({ lead: { clinicName: 'A', contactName: 'B', phone: 'abc' } }));
  assert.equal(invalid.status, 400);
  assert.equal(lineCalls.length, 0);
});

test('04 · 非白名單分類 key / 非整數分數 / 超過 3 項 → 400', async () => {
  const badKey = validBody(); badKey.summary.topPainPoints = [{ key: 'DROP TABLE', score: 10 }];
  const badScore = validBody(); badScore.summary.topPainPoints = [{ key: 'BONUS', score: 101 }];
  const tooMany = validBody(); tooMany.summary.topPainPoints = [1, 2, 3, 4].map(() => ({ key: 'BONUS', score: 1 }));
  for (const b of [badKey, badScore, tooMany]) {
    const res = await post(b);
    assert.equal(res.status, 400);
  }
  assert.equal(lineCalls.length, 0);
});

test('05 · 摘要欄位非字串 / 過長 → 400；「其他」自由文字 ≤ 100 可過', async () => {
  const notString = validBody(); notString.summary.primaryPriority = { x: 1 };
  assert.equal((await post(notString)).status, 400);
  const tooLong = validBody(); tooLong.summary.primaryPriority = 'x'.repeat(101);
  assert.equal((await post(tooLong)).status, 400);
  const other = validBody(); other.summary.primaryPriority = '希望先把報表弄好';
  const res = await post(other);
  assert.equal(res.status, 200);
  assert.match(lineCalls[0].body.messages[0].text, /最想先解決：\n希望先把報表弄好/);
});

test('06 · honeypot 有值 → 200 但不呼叫 LINE', async () => {
  const res = await post(validBody({ website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.equal(lineCalls.length, 0);
});

test('07 · LINE 失敗 → 502，對外訊息固定', async () => {
  lineShouldFail = true;
  const res = await post(validBody());
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, message: '訊息暫時無法送出。' });
});

test('08 · JSON 壞掉 → 400', async () => {
  const res = await post(null, '{not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('09 · 控制字元會被清掉；驗證函式不回報哪一欄出錯', () => {
  const r = validateCheckupLead(validBody({ lead: { clinicName: 'A\u0000診所', contactName: '李\n四', phone: '0912345678' } }));
  assert.equal(r.ok, true);
  assert.equal(r.data.lead.clinicName, 'A診所');
  assert.equal(r.data.lead.contactName, '李四');
  const bad = validateCheckupLead({ lead: {}, summary: {} });
  assert.deepEqual(bad, { ok: false });
});

test('10 · 訊息長度不超過 LINE 上限', () => {
  const r = validateCheckupLead(validBody({ lead: { clinicName: 'x'.repeat(100), contactName: 'y'.repeat(50), phone: '0912345678', email: '', lineId: 'z'.repeat(50) } }));
  assert.equal(r.ok, true);
  const text = buildCheckupMessage(r.data, 'req-id', new Date('2026-09-26T04:05:06Z'));
  assert.ok(text.length <= 4900);
  assert.match(text, /2026-09-26 12:05:06 \(UTC\+8\)/);
});
