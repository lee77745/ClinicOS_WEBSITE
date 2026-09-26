/* =====================================================================
   ClinicOS 診所營運健檢 — Email 寄送

   全部設定來自環境變數，程式碼裡沒有任何帳號、密碼或收件人：
     SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
     CHECKUP_EMAIL_FROM / CHECKUP_EMAIL_TO

   本機沒有設定 SMTP 時視為 disabled：回 { ok:false, reason:'disabled' }，
   不丟例外、不影響 LINE 通知與 API 回應。

   測試用 __setTransport() 注入 mock，絕不會真的連到 Gmail。
   Log 只記 requestId 與錯誤類別，不記收件人、內容或密碼。
   ===================================================================== */
'use strict';

const nodemailer = require('nodemailer');
const report = require('./CheckupEmailReport.js');

const SEND_TIMEOUT_MS = 15000;
const FROM_NAME = 'ClinicOS';

let injectedTransport = null;   // 只給自動測試用

/** 測試注入；傳 null 還原成真實 transport */
function __setTransport(t) { injectedTransport = t; }

function readConfig(env) {
  const e = env || process.env;
  return {
    host: e.SMTP_HOST || '',
    port: Number(e.SMTP_PORT) || 0,
    secure: String(e.SMTP_SECURE || '').toLowerCase() === 'true',
    user: e.SMTP_USER || '',
    pass: e.SMTP_PASS || '',
    from: e.CHECKUP_EMAIL_FROM || '',
    to: e.CHECKUP_EMAIL_TO || '',
  };
}

/** 設定是否齊全到可以寄信 */
function isConfigured(env) {
  const c = readConfig(env);
  return !!(c.host && c.port && c.user && c.pass && c.from && c.to);
}

function createTransport(env) {
  const c = readConfig(env);
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,                 // 587 + secure:false → STARTTLS
    requireTLS: !c.secure,            // 明確要求升級成 TLS，不接受明文
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
}

/**
 * 寄出完整健檢報告。
 * 回傳 { ok, reason? }；任何失敗都不丟例外給呼叫端。
 */
async function sendCheckupReport(reportData, requestId, env) {
  const c = readConfig(env);
  const transport = injectedTransport || (isConfigured(env) ? createTransport(env) : null);

  if (!transport) {
    console.warn(`[checkup-mail] ${requestId} SMTP 尚未設定完成，略過寄信`);
    return { ok: false, reason: 'disabled' };
  }

  const message = {
    from: `${FROM_NAME} <${c.from}>`,
    to: c.to,
    subject: report.buildSubject(reportData),
    text: report.renderText(reportData),
    html: report.renderHtml(reportData),
  };

  /* 填表者留了有效 Email 才設 replyTo，方便業務直接回信 */
  if (reportData.lead && reportData.lead.email) message.replyTo = reportData.lead.email;

  try {
    await transport.sendMail(message);
    console.log(`[checkup-mail] ${requestId} 健檢報告已寄出`);   // 不記收件人與內容
    return { ok: true };
  } catch (err) {
    // 只記錯誤類別與 SMTP code，不記帳密、收件人或信件內容
    const code = err && (err.code || err.responseCode);
    console.error(`[checkup-mail] ${requestId} 寄信失敗（${err && err.name ? err.name : 'Error'}${code ? ' / ' + code : ''}）`);
    return { ok: false, reason: 'send_failed' };
  }
}

module.exports = {
  FROM_NAME,
  readConfig,
  isConfigured,
  createTransport,
  sendCheckupReport,
  __setTransport,
};
