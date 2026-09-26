/* =====================================================================
   ClinicOS 診所營運健檢 — 送出 adapter（V1）
   UI 只呼叫 submitLead(payload)，不知道後端長什麼樣。
   目前接 POST /api/clinic-checkup/lead（server.js），後端把摘要與聯絡方式
   轉成一則 LINE 通知；問卷本身不落地、不進資料庫。
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ClinicCheckup = root.ClinicCheckup || {};
  root.ClinicCheckup.submit = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var ENDPOINT = '/api/clinic-checkup/lead';

  /**
   * 從完整 payload 挑出後端需要的部分。
   * 只送摘要，不送逐題答案 —— 後端也沒有地方存。
   */
  function buildLeadRequest(payload, lead, honeypot) {
    return {
      website: honeypot || '',
      /* 完整答案只給伺服器組 Email 報告用；LINE 摘要與 Clarity 都不會拿到它。
         伺服器會用白名單重新驗證，並自行重算分數。 */
      assessmentVersion: payload.assessmentVersion,
      answers: payload.answers || {},
      lead: {
        clinicName: lead.clinicName || '',
        contactName: lead.contactName || '',
        phone: lead.phone || '',
        email: lead.email || '',
        lineId: lead.lineId || '',
      },
      summary: {
        assessmentVersion: payload.assessmentVersion,
        completedAt: payload.completedAt,
        topPainPoints: (payload.topPainPoints || []).map(function (p) { return { key: p.key, score: p.score }; }),
        // 選「其他」且有寫字時，直接送使用者寫的內容（伺服器端限 100 字）
        primaryPriority: (payload.primaryPriority === 'OTHER' && payload.primaryPriorityNote)
          ? String(payload.primaryPriorityNote).slice(0, 100)
          : (payload.primaryPriority || ''),
        sales: {
          stage: (payload.sales && payload.sales.stage) || '',
          implementationTimeline: (payload.sales && payload.sales.implementationTimeline) || '',
        },
        systemicObservations: (payload.systemicObservations || []).map(function (o) { return { key: o.key, score: o.score }; }),
        recommendedDemo: payload.recommendedDemo || [],
        clinicProfile: payload.clinicProfile || {},
      },
    };
  }

  /** 回傳 Promise<{ok:boolean}>；任何失敗都只回 ok:false，不丟例外給 UI */
  function submitLead(payload, lead, honeypot) {
    var body = buildLeadRequest(payload, lead, honeypot);
    return root.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; })
          .then(function (data) { return { ok: !!(res.ok && data && data.ok === true) }; });
      })
      .catch(function () { return { ok: false }; });
  }

  return { ENDPOINT: ENDPOINT, buildLeadRequest: buildLeadRequest, submitLead: submitLead };
});
