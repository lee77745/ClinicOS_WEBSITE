/* =====================================================================
   ClinicOS 官網 — 診所管理系統 SEO 定位測試（CLINICOS-WEBSITE-SEO-001）

   執行： npm test

   - 只讀取靜態 HTML 與 sitemap.xml，不啟動伺服器、不呼叫任何 API。
   - 守住 Owner 定位：主要定位是「診所管理系統」，不得寫成醫美專用，
     也不得出現未經證實的「第一／最佳／唯一」等宣稱。
   - 守住 SECURITY-001：sitemap 的 /security.html 與頁尾入口不得被移除。
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://clinicos.com.tw';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* 本次調整 SEO 主題的四個頁面，與各自應清楚呈現的主題詞 */
const TARGETS = {
  'index.html': { canonical: `${SITE}/`, topics: ['診所管理系統'] },
  'day-to-day.html': { canonical: `${SITE}/day-to-day.html`, topics: ['日常作業', '庫存管理'] },
  'management.html': { canonical: `${SITE}/management.html`, topics: ['營收分析', '經營報表'] },
  'trust.html': { canonical: `${SITE}/trust.html`, topics: ['客戶管理', 'CRM'] },
};
const INDEXABLE_PAGES = [
  'index.html', 'day.html', 'day-to-day.html', 'trust.html', 'management.html',
  'future.html', 'contact.html', 'together.html', 'security.html',
];
const SECURITY_LINK = '<li><a href="security.html">資訊安全與資料保護</a></li>';
const SECURITY_LINK_PAGES = [
  'index.html', 'day.html', 'day-to-day.html', 'trust.html', 'management.html',
  'future.html', 'contact.html', 'together.html', 'clinic-checkup.html',
];

const one = (source, re) => {
  const m = source.match(re);
  return m ? m[1].trim() : null;
};
const title = (s) => one(s, /<title>([^<]*)<\/title>/);
const meta = (s, attr, name) => one(s, new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`));
const canonical = (s) => one(s, /<link rel="canonical" href="([^"]+)">/);
const h1Count = (s) => (s.match(/<h1[\s>]/g) || []).length;
const jsonLd = (s) => {
  const raw = one(s, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(raw, '找不到 JSON-LD');
  return JSON.parse(raw);
};
const webPage = (s) => {
  const ld = jsonLd(s);
  return (ld['@graph'] || [ld]).find((node) => node['@type'] === 'WebPage');
};

test('首頁 Title 以「診所管理系統」為主要定位', () => {
  const html = read('index.html');
  assert.equal(title(html), '診所管理系統｜ClinicOS 珂立雲・診所營運管理');
});

test('首頁 Description 說明產品定位與涵蓋範圍', () => {
  const desc = meta(read('index.html'), 'name', 'description');
  assert.ok(desc.startsWith('ClinicOS 珂立雲診所管理系統'), desc);
  for (const word of ['客戶管理', '療程管理', '營收分析', '庫存採購', '臨床影像管理']) {
    assert.ok(desc.includes(word), `首頁 Description 缺少「${word}」`);
  }
});

test('首頁內文有自然的產品定位說明，原有 H1 不變', () => {
  const html = read('index.html');
  assert.ok(html.includes('ClinicOS 是協助診所整合日常作業與經營管理的診所管理系統，涵蓋客戶關係、療程管理、營收分析、庫存採購及臨床影像管理。'));
  assert.match(html, /<h1 class="home-hero__title"[^>]*>讓診所營運，<br>更專注在<span class="home-hero__accent">重要的事<\/span>。<\/h1>/);
});

for (const [file, spec] of Object.entries(TARGETS)) {
  test(`${file}：SEO 主題清楚、metadata 一致`, () => {
    const html = read(file);
    const t = title(html);
    const desc = meta(html, 'name', 'description');

    for (const topic of spec.topics) {
      assert.ok(t.includes(topic) || desc.includes(topic), `${file} 的 Title/Description 缺少「${topic}」`);
    }
    assert.ok(desc.includes('診所管理系統'), `${file} 的 Description 未說明產品類別`);
    assert.ok(t.endsWith('ClinicOS 珂立雲') || t.includes('ClinicOS 珂立雲'), `${file} 的 Title 缺少品牌`);

    assert.equal(canonical(html), spec.canonical);
    assert.equal(meta(html, 'property', 'og:url'), spec.canonical);
    assert.equal(meta(html, 'property', 'og:title'), t);
    assert.equal(meta(html, 'name', 'twitter:title'), t);

    const page = webPage(html);
    assert.equal(page.name, t, `${file} JSON-LD WebPage name 與 Title 不一致`);
    assert.equal(page.description, desc, `${file} JSON-LD WebPage description 與 Description 不一致`);

    assert.equal(h1Count(html), 1, `${file} 應只有一個 H1`);
    assert.doesNotMatch(html, /noindex/i);
  });
}

test('定位不寫成醫美專用，也不使用未經證實的最高級宣稱', () => {
  for (const file of Object.keys(TARGETS)) {
    const html = read(file);
    const head = [title(html), meta(html, 'name', 'description')].join(' ');
    assert.doesNotMatch(head, /醫美/, `${file} metadata 不應把產品限定為醫美`);
    assert.doesNotMatch(head, /(市場|業界|台灣|全台)第一|第一名|第一品牌|最佳|最好|唯一|No\.?\s?1/i, `${file} metadata 出現未經證實的宣稱`);
  }
});

test('可收錄頁面的 Title 與 Description 皆不重複', () => {
  const titles = INDEXABLE_PAGES.map((f) => title(read(f)));
  const descs = INDEXABLE_PAGES.map((f) => meta(read(f), 'name', 'description'));
  assert.equal(new Set(titles).size, titles.length, `Title 重複：${titles.join(' / ')}`);
  assert.equal(new Set(descs).size, descs.length, 'Description 重複');
});

test('sitemap 保留 SECURITY-001 的 /security.html，且四個目標頁面都在其中', () => {
  const xml = read('sitemap.xml');
  assert.ok(xml.includes(`<loc>${SITE}/security.html</loc>`));
  for (const spec of Object.values(TARGETS)) {
    assert.ok(xml.includes(`<loc>${spec.canonical}</loc>`), `sitemap 缺少 ${spec.canonical}`);
  }
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

test('SECURITY-001 頁尾入口仍在所有既有頁面', () => {
  for (const file of SECURITY_LINK_PAGES) {
    assert.ok(read(file).includes(SECURITY_LINK), `${file} 的資訊安全頁尾入口不見了`);
  }
});
