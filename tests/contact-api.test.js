/* =====================================================================
   ClinicOS 官網 — API 自動測試（Node 內建 node:test，零額外依賴）

   執行： npm test

   安全前提：
   - 測試用假 Token／Secret，且在 require('../server') 之前寫入 process.env，
     dotenv 不會覆蓋已存在的環境變數，因此絕不會用到 .env 的正式值。
   - LINE API 全部 mock；不會有任何請求送到 api.line.me。
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/* --- 假憑證，必須早於 require('../server') ---------------------------- */
const TEST_SECRET = 'test-channel-secret-do-not-use-in-production';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token';
process.env.LINE_CHANNEL_SECRET = TEST_SECRET;
process.env.LINE_CONTACT_TARGET_ID = 'Utest0000000000000000000000000000';
process.env.LINE_WEBHOOK_REVEAL_ID = '';

const app = require('../server');
const { describeWebhookSources } = app.__test;

/* --- LINE API mock ---------------------------------------------------
   保留真正的 fetch 給測試自己用；只攔截往 api.line.me 的請求。      */
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

function resetLineMock() {
  lineCalls = [];
  lineShouldFail = false;
}

/* --- 測試伺服器 ------------------------------------------------------- */
let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  globalThis.fetch = realFetch;
  if (server) server.close();
});

/* --- helpers ---------------------------------------------------------
   每個測項用不同的 X-Forwarded-For，讓 rate limit 各自獨立計數
   （app 設定 trust proxy = 1），避免測項之間互相干擾。            */
let ipSeed = 0;
function nextIp() {
  ipSeed += 1;
  return `10.10.${Math.floor(ipSeed / 250)}.${(ipSeed % 250) + 1}`;
}

function validPayload(overrides) {
  return Object.assign({
    clinic: 'ClinicOS 測試診所',
    specialty: '醫美',
    name: '王小明',
    scale: '單院所',
    phone: '02-12345678',
    email: 'test@example.com',
    when: '上午',
    note: '交接常常漏掉',
    website: '',
  }, overrides || {});
}

async function postContact(payload, ip) {
  const res = await realFetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip || nextIp(),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function postWebhook(rawBody, signature) {
  const headers = { 'Content-Type': 'application/json' };
  if (signature !== null && signature !== undefined) headers['X-Line-Signature'] = signature;
  const res = await realFetch(`${baseUrl}/api/line/webhook`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return res.status;
}

function sign(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(rawBody, 'utf8')).digest('base64');
}

test.beforeEach(() => resetLineMock());

/* =====================================================================
   1–5 · 驗證
   ===================================================================== */

test('01 · 缺必填欄位 → 400', async () => {
  const payload = validPayload();
  delete payload.clinic;

  const res = await postContact(payload);

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, message: '請確認表單內容。' });
  assert.equal(lineCalls.length, 0, '驗證失敗不應呼叫 LINE');
});

test('02 · specialty 空白 → 400', async () => {
  const res = await postContact(validPayload({ specialty: '   ' }));

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(lineCalls.length, 0);
});

test('03 · specialty 超過 100 字 → 400', async () => {
  const res = await postContact(validPayload({ specialty: '醫'.repeat(101) }));

  assert.equal(res.status, 400);
  assert.equal(lineCalls.length, 0);

  // 邊界：剛好 100 字必須通過
  const ok = await postContact(validPayload({ specialty: '醫'.repeat(100) }));
  assert.equal(ok.status, 200);
});

test('04 · Email 格式錯誤 → 400', async () => {
  for (const email of ['not-an-email', 'a@b', 'a b@example.com', '@example.com', 'a@@example.com']) {
    const res = await postContact(validPayload({ email }));
    assert.equal(res.status, 400, `應拒絕 email: ${email}`);
  }
  assert.equal(lineCalls.length, 0);
});

test('05 · 電話格式錯誤 → 400', async () => {
  for (const phone of ['abc', '12', '02-1234-5678-ext-請來電', '+886$912345678']) {
    const res = await postContact(validPayload({ phone }));
    assert.equal(res.status, 400, `應拒絕電話: ${phone}`);
  }
  assert.equal(lineCalls.length, 0);
});

/* =====================================================================
   6–7 · 防垃圾
   ===================================================================== */

test('06 · honeypot 有值 → 200 且不呼叫 LINE', async () => {
  const res = await postContact(validPayload({ website: 'http://spam.example' }));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, message: '已收到您的訊息。' }, '回應與正常成功完全相同');
  assert.equal(lineCalls.length, 0, 'honeypot 觸發時不得呼叫 LINE');
});

test('07 · rate limit 第 6 次 → 429', async () => {
  const ip = nextIp();

  for (let i = 1; i <= 5; i += 1) {
    const res = await postContact(validPayload(), ip);
    assert.equal(res.status, 200, `第 ${i} 次應成功`);
  }

  const sixth = await postContact(validPayload(), ip);
  assert.equal(sixth.status, 429);
  assert.deepEqual(sixth.body, { ok: false, message: '送出次數過多，請稍後再試。' });
  assert.equal(lineCalls.length, 5, '被限流的第 6 次不得呼叫 LINE');

  // 換一個 IP 仍可送出 → 確認限流是以 IP 為單位
  const other = await postContact(validPayload());
  assert.equal(other.status, 200);
});

/* =====================================================================
   8–10 · LINE payload
   ===================================================================== */

test('08 · LINE payload 包含 specialty', async () => {
  const res = await postContact(validPayload({ specialty: '皮膚科' }));

  assert.equal(res.status, 200);
  assert.equal(lineCalls.length, 1);

  const call = lineCalls[0];
  assert.equal(call.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer test-access-token');
  assert.equal(call.body.to, process.env.LINE_CONTACT_TARGET_ID);
  assert.equal(call.body.messages.length, 1);
  assert.equal(call.body.messages[0].type, 'text');

  const text = call.body.messages[0].text;
  assert.match(text, /^【ClinicOS 官網新諮詢】/);
  assert.match(text, /科別：\n皮膚科/, 'payload 必須含科別');

  // 8 欄全部到齊，且中文正常
  assert.match(text, /診所名稱：\nClinicOS 測試診所/);
  assert.match(text, /聯絡人：\n王小明/);
  assert.match(text, /院所數：\n單院所/);
  assert.match(text, /聯絡電話：\n02-12345678/);
  assert.match(text, /Email：\ntest@example\.com/);
  assert.match(text, /希望聯絡時段：\n上午/);
  assert.match(text, /最想改善的一件事：\n交接常常漏掉/);
  assert.match(text, /Request ID：\n[0-9a-f-]{36}/);
  assert.ok(text.length < 5000, 'LINE 文字訊息需低於 5000 字上限');

  // 非必填留白 → 顯示「未填寫」
  const blank = await postContact(validPayload({ scale: '', when: '', note: '' }));
  assert.equal(blank.status, 200);
  const blankText = lineCalls[1].body.messages[0].text;
  assert.match(blankText, /院所數：\n未填寫/);
  assert.match(blankText, /希望聯絡時段：\n未填寫/);
  assert.match(blankText, /最想改善的一件事：\n未填寫/);

  // Request ID 每次唯一
  assert.notEqual(
    text.split('Request ID：\n')[1],
    blankText.split('Request ID：\n')[1],
    'Request ID 每次必須不同'
  );
});

test('09 · LINE payload 包含台灣時間', async () => {
  const res = await postContact(validPayload());
  assert.equal(res.status, 200);

  const text = lineCalls[0].body.messages[0].text;
  const match = text.match(/送出時間：\n(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \(UTC\+8\)/);
  assert.ok(match, '送出時間必須是台灣時間格式');

  // 與獨立計算的 Asia/Taipei 當下時間比對（允許跨秒誤差）
  const expected = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date());
  const [expectedDate, expectedTime] = expected.split(', ');

  assert.equal(match[1], expectedDate, '日期需為台灣時區當日');
  assert.equal(match[2].slice(0, 2), expectedTime.slice(0, 2), '小時需為台灣時區時');

  // 直接驗證格式化函式對固定時間的輸出：UTC 2026-08-05 16:00Z → 台灣 2026-08-06 00:00
  const fixed = app.__test.formatTaipeiTime(new Date('2026-08-05T16:00:00Z'));
  assert.equal(fixed, '2026-08-06 00:00:00 (UTC+8)');
});

test('10 · LINE API 失敗 → 502', async () => {
  lineShouldFail = true;

  const res = await postContact(validPayload());

  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, message: '訊息暫時無法送出。' });
  assert.equal(lineCalls.length, 1, '有嘗試呼叫 LINE');

  // 不得回傳 Token／Secret／Stack Trace
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes('test-access-token'));
  assert.ok(!serialized.includes(TEST_SECRET));
  assert.ok(!/at\s+\w+\s+\(/.test(serialized), '不得包含 stack trace');
});

/* =====================================================================
   11–14 · Webhook
   ===================================================================== */

const WEBHOOK_BODY = JSON.stringify({
  destination: 'Udestination',
  events: [{
    type: 'message',
    source: { type: 'user', userId: 'U4af4980629304a1b8c2e5d6f7a8b9c0d' },
  }],
});

test('11 · webhook 無簽章 → 401', async () => {
  assert.equal(await postWebhook(WEBHOOK_BODY, null), 401);
});

test('12 · webhook 錯誤簽章 → 401', async () => {
  // 用錯誤的 secret 簽
  assert.equal(await postWebhook(WEBHOOK_BODY, sign(WEBHOOK_BODY, 'wrong-secret')), 401);
  // 長度不符的垃圾字串
  assert.equal(await postWebhook(WEBHOOK_BODY, 'not-base64-at-all'), 401);
  // 對別的 body 簽出來的正確格式簽章
  assert.equal(await postWebhook(WEBHOOK_BODY, sign('{"events":[]}', TEST_SECRET)), 401);
});

test('13 · webhook 正確簽章 → 200', async () => {
  assert.equal(await postWebhook(WEBHOOK_BODY, sign(WEBHOOK_BODY, TEST_SECRET)), 200);
});

test('14 · webhook 可辨識 userId／groupId', async () => {
  const body = JSON.stringify({
    events: [
      { type: 'message', source: { type: 'user', userId: 'U4af4980629304a1b8c2e5d6f7a8b9c0d' } },
      { type: 'message', source: { type: 'group', groupId: 'Cabcdef0123456789abcdef0123456789', userId: 'U1111111122222222333333334444aaaa' } },
      { type: 'join', source: { type: 'room', roomId: 'R9876543210fedcba9876543210fedcba' } },
    ],
  });

  // 端到端：正確簽章仍回 200
  assert.equal(await postWebhook(body, sign(body, TEST_SECRET)), 200);

  // 解析結果：type 正確、ID 種類正確、且對外只使用遮蔽後的值
  const sources = describeWebhookSources(Buffer.from(body, 'utf8'));

  assert.equal(sources.length, 3);

  assert.equal(sources[0].sourceType, 'user');
  assert.equal(sources[0].idKind, 'userId');
  assert.equal(sources[0].id, 'U4af4980629304a1b8c2e5d6f7a8b9c0d');
  assert.equal(sources[0].maskedId, 'U4af4…9c0d');

  assert.equal(sources[1].sourceType, 'group');
  assert.equal(sources[1].idKind, 'groupId', 'group 事件應優先辨識 groupId');
  assert.equal(sources[1].id, 'Cabcdef0123456789abcdef0123456789');

  assert.equal(sources[2].sourceType, 'room');
  assert.equal(sources[2].idKind, 'roomId');

  // 遮蔽後不得含完整 ID
  for (const source of sources) {
    assert.ok(source.maskedId.length < source.id.length, '遮蔽後長度必須短於原始 ID');
    assert.ok(!source.maskedId.includes(source.id));
  }

  // 非 JSON body → null（不丟例外）
  assert.equal(describeWebhookSources(Buffer.from('not json', 'utf8')), null);
});
