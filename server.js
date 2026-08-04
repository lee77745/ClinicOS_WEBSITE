/* =====================================================================
   ClinicOS 官網 — 最小 Node 服務
   同一個 Render Web Service 同時提供：
     1. 靜態網站（專案根目錄）
     2. POST /api/contact        — Contact 表單 → LINE Push Message
     3. POST /api/line/webhook   — LINE Webhook（簽章驗證 + 取得 target ID）

   原則：少依賴、無資料庫、不記錄表單內容、不外洩 Token／Secret。
   ===================================================================== */
'use strict';

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

/* ---------------------------------------------------------------------
   常數
   --------------------------------------------------------------------- */
const ROOT = __dirname;
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const LINE_PUSH_TIMEOUT_MS = 8000;
const LINE_TEXT_LIMIT = 4900;          // LINE 文字訊息上限 5000，保留邊界
const CONTACT_BODY_LIMIT = '32kb';
const WEBHOOK_BODY_LIMIT = '64kb';
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 分鐘
const RATE_MAX = 5;                    // 同 IP 最多 5 次

/* 對外訊息一律固定字串 —— 不回傳 Token／Secret／Stack Trace／LINE 原始錯誤 */
const RESPONSES = Object.freeze({
  success:     { ok: true,  message: '已收到您的訊息。' },
  invalid:     { ok: false, message: '請確認表單內容。' },
  rateLimited: { ok: false, message: '送出次數過多，請稍後再試。' },
  upstream:    { ok: false, message: '訊息暫時無法送出。' },
  server:      { ok: false, message: '伺服器暫時無法處理，請稍後再試。' },
});

/* 表單欄位定義 —— 與 contact.html 的 name 屬性一一對應（8 欄） */
const CONTACT_FIELDS = Object.freeze([
  { name: 'clinic',    label: '診所名稱',         required: true,  max: 100 },
  { name: 'specialty', label: '科別',             required: true,  max: 100 },
  { name: 'name',      label: '聯絡人',           required: true,  max: 50 },
  { name: 'scale',     label: '院所數',           required: false, max: 20 },
  { name: 'phone',     label: '聯絡電話',         required: true,  max: 30 },
  { name: 'email',     label: 'Email',            required: true,  max: 254 },
  { name: 'when',      label: '希望聯絡時段',     required: false, max: 20 },
  { name: 'note',      label: '最想改善的一件事', required: false, max: 2000, multiline: true },
]);

const HONEYPOT_FIELD = 'website';
const EMPTY_PLACEHOLDER = '未填寫';

/* 控制字元：單行欄位連換行一併移除；多行欄位保留 \n */
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F\u2028\u2029]/g;
const CONTROL_MULTI_LINE  = /[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]/g;

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,186}\.[^\s@.]{2,}$/;
const PHONE_PATTERN = /^[+()\-.\s\d#]{7,30}$/;

/* 不對外提供的專案檔案 */
const BLOCKED_PATH = /^\/(?:node_modules|tests|scripts)(?:\/|$)|^\/(?:package(?:-lock)?\.json|server\.js)$/i;

/* ---------------------------------------------------------------------
   工具
   --------------------------------------------------------------------- */
function sanitizeText(value, multiline) {
  const normalized = multiline ? String(value).replace(/\r\n?/g, '\n') : String(value);
  const pattern = multiline ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE;
  return normalized.replace(pattern, '').trim();
}

/**
 * 驗證並清理 Contact 表單內容。
 * 失敗時只回報 ok:false —— 對外訊息一律相同，不洩漏哪一欄有問題。
 */
function validateContact(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };

  const data = {};

  for (const field of CONTACT_FIELDS) {
    const raw = body[field.name];

    // 只接受字串；缺漏視為空字串，其他型別（數字／物件／陣列）一律拒絕
    if (raw === undefined || raw === null) {
      if (field.required) return { ok: false };
      data[field.name] = '';
      continue;
    }
    if (typeof raw !== 'string') return { ok: false };

    const value = sanitizeText(raw, field.multiline);

    if (!value) {
      if (field.required) return { ok: false };
      data[field.name] = '';
      continue;
    }
    if (value.length > field.max) return { ok: false };

    data[field.name] = value;
  }

  if (!EMAIL_PATTERN.test(data.email)) return { ok: false };
  if (!PHONE_PATTERN.test(data.phone)) return { ok: false };
  if ((data.phone.match(/\d/g) || []).length < 7) return { ok: false };

  return { ok: true, data };
}

/** 台灣時間（UTC+8），格式 YYYY-MM-DD HH:mm:ss (UTC+8) */
function formatTaipeiTime(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (UTC+8)`;
}

/** 依 contact.html 實際 8 欄組出 LINE 通知文字 */
function buildContactMessage(data, requestId, now) {
  const lines = ['【ClinicOS 官網新諮詢】'];

  for (const field of CONTACT_FIELDS) {
    lines.push('', `${field.label}：`, data[field.name] || EMPTY_PLACEHOLDER);
  }

  lines.push('', '送出時間：', formatTaipeiTime(now));
  lines.push('', 'Request ID：', requestId);

  const text = lines.join('\n');
  return text.length > LINE_TEXT_LIMIT ? text.slice(0, LINE_TEXT_LIMIT - 1) + '…' : text;
}

/**
 * 送出 LINE Push Message。
 * 回傳 true/false —— 呼叫端只知道成敗，LINE 的原始錯誤不會往外傳。
 */
async function pushToLine(text, requestId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const target = process.env.LINE_CONTACT_TARGET_ID;

  if (!token || !target) {
    console.error(`[contact] ${requestId} LINE 尚未設定完成（缺少 access token 或 target id）`);
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_PUSH_TIMEOUT_MS);

  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: target, messages: [{ type: 'text', text }] }),
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      // 只記錄狀態碼，不記錄 LINE 回應內容與 token
      console.error(`[contact] ${requestId} LINE push 失敗，status=${response ? response.status : 'n/a'}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[contact] ${requestId} LINE push 例外：${err && err.name ? err.name : 'Error'}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 遮蔽 LINE ID，僅保留頭尾以便辨識 */
function maskId(id) {
  if (typeof id !== 'string' || id.length < 10) return '(已遮蔽)';
  return `${id.slice(0, 5)}…${id.slice(-4)}`;
}

/**
 * 解析 webhook events 的 source，回傳可安全記錄的描述。
 * 不回傳給瀏覽器，只用於本機／伺服器 log。
 */
function describeWebhookSources(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return null;
  }

  const events = payload && Array.isArray(payload.events) ? payload.events : [];

  return events.map((event) => {
    const source = (event && event.source) || {};
    const sourceType = typeof source.type === 'string' ? source.type : 'unknown';

    let idKind = 'unknown';
    let id = '';
    if (typeof source.groupId === 'string' && source.groupId) { idKind = 'groupId'; id = source.groupId; }
    else if (typeof source.roomId === 'string' && source.roomId) { idKind = 'roomId'; id = source.roomId; }
    else if (typeof source.userId === 'string' && source.userId) { idKind = 'userId'; id = source.userId; }

    return { sourceType, idKind, id, maskedId: maskId(id) };
  });
}

function logWebhookSources(rawBody) {
  const sources = describeWebhookSources(rawBody);

  if (sources === null) {
    console.warn('[webhook] 簽章正確，但 body 不是 JSON');
    return;
  }
  if (!sources.length) {
    console.log('[webhook] 簽章正確，events 數量 0');
    return;
  }

  const reveal = process.env.LINE_WEBHOOK_REVEAL_ID === '1';

  for (const source of sources) {
    console.log(`[webhook] source.type=${source.sourceType} ${source.idKind}=${source.maskedId}`);
    if (reveal && source.id) {
      console.log(`[webhook] LINE_WEBHOOK_REVEAL_ID=1 → ${source.idKind}=${source.id}`);
    }
  }
  console.log('[webhook] 請將完整 ID 填入 .env 的 LINE_CONTACT_TARGET_ID 與 Render Environment Variables；切勿寫入程式碼或 commit。');
  if (!reveal) {
    console.log('[webhook] 需要看到完整 ID 時，於本機設定 LINE_WEBHOOK_REVEAL_ID=1 後重啟，取得後請立即移除。');
  }
}

/* ---------------------------------------------------------------------
   App
   --------------------------------------------------------------------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 位於反向代理之後，取得真實來源 IP

/* --- LINE Webhook ---------------------------------------------------
   必須先於任何 JSON parser 掛載，並保留 raw body 供簽章驗證。       */
app.post(
  '/api/line/webhook',
  express.raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }),
  (req, res) => {
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!secret) {
      console.error('[webhook] 尚未設定 LINE_CHANNEL_SECRET');
      return res.sendStatus(401);
    }

    const signature = req.get('X-Line-Signature');
    if (!signature) return res.sendStatus(401);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const provided = Buffer.from(signature, 'base64');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();

    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      console.warn('[webhook] 簽章驗證失敗');
      return res.sendStatus(401);
    }

    logWebhookSources(rawBody);
    return res.sendStatus(200); // 不回傳任何 ID 給呼叫端
  }
);

/* --- Contact -------------------------------------------------------- */
const contactLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  limit: RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(RESPONSES.rateLimited),
});

app.post(
  '/api/contact',
  contactLimiter,
  express.json({ limit: CONTACT_BODY_LIMIT }),
  async (req, res) => {
    const requestId = crypto.randomUUID();
    const body = req.body;

    // Honeypot：真人看不到也 focus 不到；有值就當作機器人，靜默成功
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const trap = body[HONEYPOT_FIELD];
      const trapped = typeof trap === 'string' ? trap.trim() !== '' : trap !== undefined && trap !== null;
      if (trapped) {
        console.warn(`[contact] ${requestId} honeypot 觸發，未呼叫 LINE`);
        return res.status(200).json(RESPONSES.success);
      }
    }

    const result = validateContact(body);
    if (!result.ok) {
      console.warn(`[contact] ${requestId} 表單驗證未通過`); // 不記錄表單內容
      return res.status(400).json(RESPONSES.invalid);
    }

    const message = buildContactMessage(result.data, requestId, new Date());
    const sent = await pushToLine(message, requestId);

    if (!sent) return res.status(502).json(RESPONSES.upstream);

    console.log(`[contact] ${requestId} 已送出 LINE 通知`);
    return res.status(200).json(RESPONSES.success);
  }
);

/* --- 靜態網站 -------------------------------------------------------- */
app.use((req, res, next) => {
  if (BLOCKED_PATH.test(req.path)) return res.status(404).type('text/plain; charset=utf-8').send('Not Found');
  next();
});

app.use(express.static(ROOT, {
  dotfiles: 'ignore',   // 避免 .env 等檔案被靜態伺服器讀出
  index: 'index.html',  // 首頁回傳 index.html
  extensions: ['html'],
}));

app.use('/api', (req, res) => res.status(404).json({ ok: false, message: '找不到此 API。' }));

/* --- 錯誤處理 -------------------------------------------------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // JSON 解析失敗 / body 超過上限 → 對 Contact 一律回 400，不外洩細節
  if (req.path === '/api/contact') {
    console.warn(`[contact] 請求本體無法解析或過大（${err && err.type ? err.type : 'unknown'}）`);
    return res.status(400).json(RESPONSES.invalid);
  }
  if (req.path === '/api/line/webhook') {
    console.warn('[webhook] 請求本體無法讀取');
    return res.sendStatus(401);
  }
  console.error(`[server] 未預期錯誤（${err && err.type ? err.type : 'unknown'}）`);
  return res.status(500).json(RESPONSES.server);
});

/* ---------------------------------------------------------------------
   啟動（被 require 時不自動 listen，方便自動測試）
   --------------------------------------------------------------------- */
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`ClinicOS 官網服務啟動：http://localhost:${port}`);
  });
}

module.exports = app;
module.exports.__test = {
  CONTACT_FIELDS,
  buildContactMessage,
  describeWebhookSources,
  formatTaipeiTime,
  validateContact,
};
