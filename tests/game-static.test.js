/* =====================================================================
   ClinicOS 官網 — /game/ 靜態遊戲路由測試（WEB-GAME-001）

   執行： npm test

   - /game/ 由既有 express.static 提供（遊戲的正式建置放在 game/，
     由 ClinicOS_GAME 的 scripts/release-to-website.mjs 產生）。
   - 只驗證路由與既有防護沒有被影響；不讀取 .env 內容，也不呼叫 LINE。
   - 假憑證必須早於 require('../server')（dotenv 不覆蓋既有環境變數）。
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

/* 絕不讓測試真的打到 LINE。 */
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : String(input && input.url);
  if (url.startsWith('https://api.line.me/')) return { ok: true, status: 200 };
  return realFetch(input, init);
};

const GAME_DIR = path.join(__dirname, '..', 'game');
const BUILD_INFO = JSON.parse(fs.readFileSync(path.join(GAME_DIR, 'BUILD_INFO.json'), 'utf8'));

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

const get = (p, opts = {}) => realFetch(baseUrl + p, { redirect: 'manual', ...opts });

test('/game/ 回傳遊戲 HTML，且保留 noindex', async () => {
  const res = await get('/game/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<title>院長，今天又出事了！｜ClinicOS<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(html, /(src|href)="\//, '遊戲 HTML 只能用相對路徑');
});

test('/game 以 301 轉到 /game/（相對資源路徑才會正確）', async () => {
  const res = await get('/game');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/game/');
});

test('BUILD_INFO 由發布腳本管理、為正式建置、不含本機路徑', () => {
  assert.equal(BUILD_INFO.managedBy, 'ClinicOS_GAME scripts/release-to-website.mjs');
  assert.equal(BUILD_INFO.build.mode, 'production');
  assert.equal(BUILD_INFO.build.debugDisabled, true);
  assert.equal(BUILD_INFO.build.noindex, true);
  assert.doesNotMatch(JSON.stringify(BUILD_INFO), /[A-Za-z]:\\\\|\/Users\/|\/home\//);
  assert.ok(BUILD_INFO.files.length >= 15);
});

test('game/ 只有 BUILD_INFO 列出的檔案，且雜湊一致', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const onDisk = walk(GAME_DIR)
    .map((p) => path.relative(GAME_DIR, p).split(path.sep).join('/'))
    .filter((p) => p !== 'BUILD_INFO.json')
    .sort();
  assert.deepEqual(onDisk, BUILD_INFO.files.map((f) => f.path).sort());
  const crypto = require('node:crypto');
  for (const f of BUILD_INFO.files) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(GAME_DIR, f.path))).digest('hex');
    assert.equal(hash, f.sha256, `${f.path} 雜湊不符`);
  }
  assert.ok(!onDisk.some((p) => p.endsWith('.map')), '不得包含 source map');
});

test('遊戲的 JS、CSS、Logo 與頭像都能取得', async () => {
  const checks = [
    [BUILD_INFO.files.find((f) => /^assets\/index-.*\.js$/.test(f.path)).path, /javascript/],
    [BUILD_INFO.files.find((f) => /^assets\/Game-.*\.js$/.test(f.path)).path, /javascript/],
    [BUILD_INFO.files.find((f) => /\.css$/.test(f.path)).path, /text\/css/],
    ['brand/clinicos-logo.png', /image\/png/],
    ['avatars/director_normal.png', /image\/png/],
    ['avatars/manager_exploded.png', /image\/png/],
  ];
  for (const [p, type] of checks) {
    const res = await get('/game/' + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type') || '', type, p);
    await res.arrayBuffer();
  }
});

test('不存在的遊戲資源回 404', async () => {
  for (const p of ['/game/assets/index-doesnotexist.js', '/game/avatars/nobody.png', '/game/index.js.map']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    await res.arrayBuffer();
  }
});

test('既有阻擋規則不受影響（lib、scripts、tests、node_modules、設定檔、dotfiles）', async () => {
  const blocked = [
    '/lib/', '/scripts/', '/tests/', '/node_modules/', '/server.js', '/package.json', '/package-lock.json',
    '/tests/game-static.test.js', '/.env', '/.gitignore', '/game/../server.js',
  ];
  for (const p of blocked) {
    const res = await get(p);
    assert.equal(res.status, 404, p); // 只比對狀態碼，不輸出內容
    await res.arrayBuffer();
  }
});

test('首頁、健檢頁與其他頁面照常', async () => {
  for (const p of ['/', '/clinic-checkup', '/day.html', '/contact']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    await res.arrayBuffer();
  }
  const retired = await get('/faq');
  assert.equal(retired.status, 301);
});

test('表單與 LINE API 路由照常（無效輸入仍回 400／401，未知 API 回 404）', async () => {
  const contact = await get('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(contact.status, 400);
  await contact.arrayBuffer();
  const lead = await get('/api/clinic-checkup/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(lead.status, 400);
  await lead.arrayBuffer();
  const hook = await get('/api/line/webhook', { method: 'POST', body: '{}' });
  assert.equal(hook.status, 401);
  await hook.arrayBuffer();
  const unknown = await get('/api/game');
  assert.equal(unknown.status, 404);
  await unknown.arrayBuffer();
});

test('官網沒有把 /game/ 放進 sitemap', () => {
  const sitemap = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(sitemap, /\/game/);
});
