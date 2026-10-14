/* =====================================================================
   ClinicOS 官網 — 資訊安全與資料保護頁測試（CLINICOS-WEBSITE-SECURITY-001）

   執行： npm test

   - /security.html 由既有 express.static 提供，不改 server.js。
   - 守住頁面上的安全宣稱界線：認證歸屬 Render、全系統備份標示「規劃中」、
     不得出現零遺失／完整還原保證等字樣。
   - 不讀取 .env 內容，也不呼叫 LINE。
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret-do-not-use-in-production';
process.env.LINE_CONTACT_TARGET_ID = 'Utest0000000000000000000000000000';
process.env.LINE_WEBHOOK_REVEAL_ID = '';

const app = require('../server');

const ROOT = path.join(__dirname, '..');
const PAGE_LINK = '<li><a href="security.html">資訊安全與資料保護</a></li>';
const LIVE_PAGES = [
  'index.html', 'day.html', 'day-to-day.html', 'trust.html', 'management.html',
  'future.html', 'contact.html', 'together.html', 'clinic-checkup.html',
];
/* 已淘汰（301）或無入口的頁面 —— 本次不得修改 */
const UNTOUCHED_PAGES = ['faq.html', 'platform.html', 'method.html', 'why-clinicos.html', 'products.html', 'solutions.html'];
const ATTRIBUTION = '上述認證與稽核適用於 Render 平台，並非 ClinicOS 本身取得。';

let server;
let baseUrl;
let html;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  html = fs.readFileSync(path.join(ROOT, 'security.html'), 'utf8');
});

test.after(() => {
  server.close();
});

const get = (p) => fetch(baseUrl + p, { redirect: 'manual' });
const visibleText = (source) => source
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const section = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `找不到 ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end === -1 ? undefined : end);
};

test('/security.html 存在，且 metadata 符合既有慣例', async () => {
  const res = await get('/security.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const body = await res.text();
  assert.match(body, /<title>資訊安全與資料保護｜ClinicOS 珂立雲<\/title>/);
  assert.match(body, /<meta name="description" content="了解 ClinicOS 的雲端部署、Render 平台安全認證、資料傳輸與儲存、診所資料管理及備份復原機制。">/);
  assert.match(body, /<link rel="canonical" href="https:\/\/clinicos\.com\.tw\/security\.html">/);
  assert.match(body, /<meta property="og:url" content="https:\/\/clinicos\.com\.tw\/security\.html">/);
  assert.doesNotMatch(body, /noindex/);
  assert.match(body, /<h1[^>]*>安心管理每一份重要資料<\/h1>/);
});

test('/security 也能直接存取（express.static extensions）', async () => {
  const res = await get('/security');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>資訊安全與資料保護｜ClinicOS 珂立雲<\/title>/);
});

test('九個有效頁面的頁尾「支援」區都有入口', async () => {
  for (const page of LIVE_PAGES) {
    const res = await get('/' + page);
    assert.equal(res.status, 200, page);
    const body = await res.text();
    const support = section(body, '<p class="footer__col-title">支援</p>', '</ul>');
    assert.ok(support.includes(PAGE_LINK), `${page} 頁尾缺少入口`);
    assert.equal(body.split('href="security.html"').length - 1, 1, `${page} 入口應只有一個`);
  }
});

test('已淘汰或無入口的頁面沒有被修改', () => {
  for (const page of UNTOUCHED_PAGES) {
    const body = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.ok(!body.includes('security.html'), `${page} 不應加入口`);
  }
});

test('sitemap 包含安全頁', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/clinicos\.com\.tw\/security\.html<\/loc>/);
});

test('五個區塊都存在', () => {
  for (const key of ['cloud', 'certification', 'data', 'backup', 'faq']) {
    assert.match(html, new RegExp(`data-sec="${key}"`), key);
  }
});

test('Render 認證歸屬說明正確，並附官方連結', () => {
  const cert = visibleText(section(html, 'data-sec="certification"', '<!-- ===== 03'));
  assert.ok(cert.includes('ISO/IEC 27001'));
  assert.ok(cert.includes('SOC 2 Type II 第三方稽核'));
  assert.ok(cert.includes('ClinicOS 使用的 Render 平台已取得'));
  assert.ok(cert.includes(ATTRIBUTION), '缺少認證歸屬說明');
  assert.match(html, /href="https:\/\/render\.com\/security" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="https:\/\/render\.com\/docs\/certifications-compliance" target="_blank" rel="noopener noreferrer"/);
});

test('備份三項狀態標示正確；全系統備份明確為「規劃中」', () => {
  const statusOf = (key) => {
    const block = section(html, `data-backup="${key}"`, '</h3>');
    const m = block.match(/class="sec-status[^"]*">([^<]+)</);
    return m && m[1];
  };
  assert.equal(statusOf('snapshot'), '已啟用');
  assert.equal(statusOf('drive-photos'), '可設定');
  assert.equal(statusOf('drive-full'), '規劃中');

  const full = visibleText(section(html, 'data-backup="drive-full"', '<!-- ===== 05'));
  assert.ok(full.includes('規劃中'));
  assert.ok(full.includes('尚未正式上線'));
  assert.doesNotMatch(full, /已啟用|已完成|已上線/);

  const faq = visibleText(section(html, 'data-sec="faq"', '</section>'));
  assert.match(faq, /全系統自動異地備份目前仍在規劃中/);
});

test('不存在誇大或不實的安全宣稱', () => {
  const text = visibleText(html) + ' ' + html;
  const banned = [
    [/ClinicOS\s*(已經?|正式)?\s*(取得|通過|獲得)/, '把 Render 認證說成 ClinicOS 取得'],
    [/SOC\s*2\s*Type\s*II\s*(認證|certif)/i, '把 SOC 2 Type II 稱為認證'],
    [/恩傳/, '新增公司法定名稱'],
    [/零遺失|零資料遺失|資料零遺失|不會遺失|不會流失|可完整還原|完整復原|保證.{0,8}(還原|復原)/, '零遺失／完整復原保證'],
    [/完全隔離|零漏洞|端對端|end-to-end/i, '過度的資安宣稱'],
    [/(完全)?符合.{0,8}(個資法|個人資料保護法|HIPAA|GDPR)/, '法規符合宣稱'],
    [/所有診所(均|都)?已啟用/, '宣稱所有診所已啟用'],
  ];
  for (const [pattern, label] of banned) {
    assert.doesNotMatch(text, pattern, label);
  }
});

test('FAQ 至少六題，結構化資料與頁面文字一致', () => {
  const questions = [...html.matchAll(/<h3 class="h3 qa__q">([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.ok(questions.length >= 6);
  for (const q of ['ClinicOS 主機位於哪裡？', '病患資料是否儲存在國外？', '不同診所的資料是否獨立？',
    '資料傳輸是否加密？', 'ClinicOS 是否具備備份機制？', '主機故障時如何復原？']) {
    assert.ok(questions.includes(q), q);
  }

  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faqNode = ld['@graph'].find((n) => Array.isArray(n['@type']) && n['@type'].includes('FAQPage'));
  const visible = visibleText(html);
  assert.equal(faqNode.mainEntity.length, questions.length);
  for (const item of faqNode.mainEntity) {
    assert.ok(questions.includes(item.name), `結構化資料多出題目：${item.name}`);
    assert.ok(visible.includes(item.acceptedAnswer.text), `結構化答案與頁面不一致：${item.name}`);
  }
});

test('只用既有腳本與頁面專屬 CSS，不新增外部依賴', () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts.sort(), ['assets/js/clarity.js', 'assets/js/site.js']);
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/security\.css">/);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'css', 'security.css')));
});
