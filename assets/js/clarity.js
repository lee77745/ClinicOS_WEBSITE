/* =====================================================================
   ClinicOS 官網 — Microsoft Clarity loader

   為什麼是一支獨立的小檔而不是每頁貼一段 inline script：
   正式網域白名單只需要維護一份，未來換網域或停用只改這裡。

   只有正式網域會載入 Clarity。localhost / 127.0.0.1 / 內網 IP 一律不載入，
   本機 UAT 不會污染正式分析數據。

   個資保護：
   - Clarity 預設遮罩所有 input 值；Contact 與健檢 Lead 表單另外標了
     data-clarity-mask="true"，整個容器連文字都不回傳。
   - 全站沒有任何 data-clarity-unmask。
   - Custom event 只送事件名稱，不送任何個資（見 site.js / checkup-app.js）。
   ===================================================================== */
(function () {
  'use strict';

  var PROJECT_ID = 'yohi4nm3vo';

  /* 正式網域白名單。採白名單而非黑名單：沒列到的一律不追蹤，
     localhost、127.0.0.1、192.168.*、10.*、172.16～31.* 自然都被排除。 */
  var ALLOWED_HOSTS = [
    'clinicos.com.tw',
    'www.clinicos.com.tw',
    'clinicos-website.onrender.com',
  ];

  var host = String(window.location.hostname || '').toLowerCase();
  if (ALLOWED_HOSTS.indexOf(host) === -1) return;

  /* Microsoft Clarity 官方 tracking code */
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', PROJECT_ID);
})();
