/* =====================================================================
   ClinicOS 診所營運健檢 — 問卷狀態暫存（V1）
   只存「非敏感」的問卷答案與目前位置到 sessionStorage，
   讓使用者 Refresh 後不會從頭開始。Lead 聯絡資料絕不進入這裡。
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  root.ClinicCheckup = root.ClinicCheckup || {};
  root.ClinicCheckup.state = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var KEY = 'clinicos_checkup_v1_1';   // V1.1：題目 schema 變動，換 key，舊 V1 state 不再載入

  function storage() {
    try { return root.sessionStorage || null; } catch (e) { return null; }
  }

  function load() {
    var s = storage();
    if (!s) return null;
    try {
      var raw = s.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || typeof data.answers !== 'object') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function save(state) {
    var s = storage();
    if (!s) return;
    try {
      s.setItem(KEY, JSON.stringify({
        answers: state.answers || {},
        cursor: state.cursor || 0,
        phase: state.phase || 'welcome',
        startedAt: state.startedAt || null,
      }));
    } catch (e) { /* 存不進去就算了，不影響作答 */ }
  }

  function clear() {
    var s = storage();
    if (!s) return;
    try { s.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY: KEY, load: load, save: save, clear: clear };
});
