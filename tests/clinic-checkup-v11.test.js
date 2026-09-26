/* =====================================================================
   ClinicOS 診所營運健檢 — V1.1 精準化修正 回歸測試（node:test，零額外依賴）
   涵蓋：TOP 3 只含主要分類、結果模式、Q20 跳題、Q30A/B、舊 state、
         evidence summary、影像跳題、tie / determinism。
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../assets/js/clinic-checkup/checkup-config.js');
const scoring = require('../assets/js/clinic-checkup/checkup-scoring.js');
const results = require('../assets/js/clinic-checkup/checkup-results.js');

const ids = (a) => config.visibleQuestions(a).map((q) => q.id);

/* 全部最順、不填痛苦指數 */
function bestAnswers() {
  const a = {};
  config.QUESTIONS.forEach((q) => {
    if (q.type === 'multi') a[q.id] = q.exclusive ? [q.exclusive] : [q.options[0].value];
    else if (q.options.length) a[q.id] = q.options[0].value;
  });
  a.Q7 = ['system']; a.Q15 = ['system']; a.Q26 = ['almost_none']; a.Q27 = 'CUSTOMER_DATA';
  return a;
}

test('T01 · DATA_FRAGMENTATION / MANUAL_WORK = 100 也不進 TOP 3', () => {
  const a = Object.assign(bestAnswers(), {
    Q5: 'multiple_systems', Q7: ['excel', 'gsheet', 'line', 'paper', 'phone'], Q11: 'scattered',
    Q15: ['phone', 'line', 'pc_folder'], Q17: 'no',
    Q26: ['excel', 'gsheet', 'line', 'paper', 'whatsapp', 'handwriting'], Q19: 'manual', Q18: 'all_manual',
  });
  const scores = scoring.computeScores(a);
  assert.equal(scores.DATA_FRAGMENTATION, 100);
  assert.equal(scores.MANUAL_WORK, 100);
  const p = results.buildPayload(a);
  const topKeys = p.topPainPoints.map((t) => t.key);
  assert.equal(topKeys.includes('DATA_FRAGMENTATION'), false);
  assert.equal(topKeys.includes('MANUAL_WORK'), false);
  topKeys.forEach((k) => assert.ok(config.PRIMARY_CATEGORY_KEYS.includes(k), k));
  assert.equal(p.otherPainPoints.some((o) => config.SYSTEMIC_CATEGORY_KEYS.includes(o.key)), false);
  assert.equal(p.painScores.DATA_FRAGMENTATION, 100, 'raw score 仍保留在 payload');
  assert.deepEqual(p.systemicObservations.map((o) => [o.key, o.title, o.levelLabel]), [
    ['DATA_FRAGMENTATION', '資料有點分散', '高'], ['MANUAL_WORK', '人工整理偏多', '高'],
  ]);
  assert.equal(scoring.priorityOptions(a).some((o) => config.SYSTEMIC_CATEGORY_KEYS.includes(o.value)), false, 'Q27 也不列系統性分類');
  assert.equal(p.recommendedDemo.length > 0 && p.recommendedDemo.length <= 5, true);
});

test('T02 · 所有主要分類低分 → healthy 模式，不寫「最值得先改善」', () => {
  const p = results.buildPayload(bestAnswers());
  assert.ok(p.topPainPoints[0].score < 30, String(p.topPainPoints[0].score));
  assert.equal(p.resultMode, 'healthy');
  const copy = results.RESULT_MODE_COPY[p.resultMode];
  assert.equal(copy.title, '目前整體流程相當順');
  assert.doesNotMatch(copy.title, /最值得先改善/);
  assert.match(copy.ctaTitle, /串得更完整/);
  assert.equal(p.systemicObservations.length, 0, '系統性都 < 50 → 整塊不顯示');
});

test('T03 · TOP1 = 40 → optimize 模式（中間版文案）', () => {
  const a = Object.assign(bestAnswers(), { Q6: 'switch_pages', Q6_pain: 2, Q27: 'APPOINTMENT' }); // level 3 × pain 2 → 40（Q27 不選同一類，避免 +10）
  const p = results.buildPayload(a);
  assert.equal(p.topPainPoints[0].score, 40);
  assert.equal(p.resultMode, 'optimize');
  assert.equal(results.RESULT_MODE_COPY.optimize.title, '整體運作還算順，這幾個地方可以再優化');
  assert.match(results.RESULT_MODE_COPY.optimize.ctaTitle, /省掉哪些事情/);
});

test('T04 · TOP1 >= 50 → priority 模式', () => {
  const a = Object.assign(bestAnswers(), { Q21: 'never_counted', Q21_pain: 3 });
  const p = results.buildPayload(a);
  assert.ok(p.topPainPoints[0].score >= 50);
  assert.equal(p.resultMode, 'priority');
  assert.equal(results.RESULT_MODE_COPY.priority.title, '目前最值得先改善的是這 3 個地方');
  assert.equal(scoring.resultModeOf(50), 'priority');
  assert.equal(scoring.resultModeOf(49), 'optimize');
  assert.equal(scoring.resultModeOf(30), 'optimize');
  assert.equal(scoring.resultModeOf(29), 'healthy');
});

test('T05 · Q20 = 有點麻煩、未動 slider → 仍問 Q20-1 / Q20-2', () => {
  const v = ids({ Q20: 'bit_troublesome' });
  assert.ok(v.includes('Q20_1') && v.includes('Q20_2'));
  assert.ok(ids({ Q20: 'time_consuming' }).includes('Q20_1'));
  assert.ok(ids({ Q20: 'painful' }).includes('Q20_2'));
});

test('T06 · Q20 = 還好、pain 4 → 問追問', () => {
  const v = ids({ Q20: 'ok', Q20_pain: 4 });
  assert.ok(v.includes('Q20_1') && v.includes('Q20_2'));
  assert.ok(ids({ Q20: 'no_system_handles', Q20_pain: 3 }).includes('Q20_1'), '系統處理好了但 pain 3 也問');
});

test('T07 · Q20 = 還好、pain < 3 → 不問；系統處理好了且 pain 未達 3 → 不問', () => {
  let v = ids({ Q20: 'ok', Q20_pain: 2 });
  assert.equal(v.includes('Q20_1') || v.includes('Q20_2'), false);
  v = ids({ Q20: 'ok' });
  assert.equal(v.includes('Q20_1'), false);
  v = ids({ Q20: 'no_system_handles', Q20_pain: 2 });
  assert.equal(v.includes('Q20_1'), false);
});

test('T08 · Q30A / Q30B → payload.sales.stage / implementationTimeline（canonical key）', () => {
  assert.equal(config.QUESTION_BY_ID.Q30, undefined, '舊 Q30 已移除');
  assert.deepEqual(config.QUESTION_BY_ID.Q30A.options.map((o) => o.value), ['JUST_LOOKING', 'COMPARING', 'CURRENT_SYSTEM_ISSUES', 'READY_TO_SWITCH', 'NEW_CLINIC', 'OTHER']);
  assert.deepEqual(config.QUESTION_BY_ID.Q30B.options.map((o) => o.value), ['NO_TIMELINE', 'WITHIN_6_MONTHS', 'WITHIN_3_MONTHS', 'WITHIN_1_MONTH', 'ASAP']);
  const p = results.buildPayload(Object.assign(bestAnswers(), { Q30A: 'COMPARING', Q30B: 'WITHIN_3_MONTHS' }));
  assert.deepEqual(p.sales, { stage: 'COMPARING', implementationTimeline: 'WITHIN_3_MONTHS' });
  assert.equal(p.salesIntent, '正在比較不同系統 · 3 個月內', 'derived 顯示文字，僅相容用');
  assert.equal(p.assessmentVersion, '1.1');
  const empty = results.buildPayload(bestAnswers());
  assert.equal(typeof empty.sales.stage, 'string');
});

test('T09 · V1 舊 state：Q5 = 已移除的值 / 舊 Q30 → 不 crash、視為未回答', () => {
  const old = Object.assign(bestAnswers(), { Q5: 'looking', Q30: 'asap', Q15: ['phone', 'REMOVED_VALUE'], Q27: 'DATA_FRAGMENTATION' });
  const clean = config.sanitizeAnswers(old);
  assert.equal(clean.Q5, undefined, 'Q5 視為未回答');
  assert.equal(clean.Q30, undefined);
  assert.deepEqual(clean.Q15, ['phone']);
  assert.equal(clean.Q27, undefined, 'Q27 不再接受系統性分類');
  assert.doesNotThrow(() => results.buildPayload(old));
  assert.doesNotThrow(() => scoring.computeScores({ Q5: 'FINDING_NEW_SYSTEM', Q30: 'FINDING_NEW_SYSTEM', Q6: 'garbage', Q7: 'not-an-array', Q6_pain: 'x' }));
  const p = results.buildPayload({ Q5: 'FINDING_NEW_SYSTEM' });
  assert.equal(p.clinicProfile.currentSystemState, '');
  assert.equal(config.QUESTION_BY_ID.Q5.options.some((o) => o.value === 'looking'), false, 'Q5 已無「正在找新系統」');
  assert.equal(config.QUESTION_BY_ID.Q5.options.length, 4);
});

test('T10 · BONUS evidence：Excel + 2～3 天 + 要重新核對 都要出現', () => {
  const a = { Q19: 'excel', Q20: 'painful', Q20_pain: 5, Q20_1: '2_3d', Q20_2: ['recheck'] };
  const text = results.buildEvidenceSummary('BONUS', a);
  assert.match(text, /Excel/);
  assert.match(text, /2～3 天/);
  assert.match(text, /重新核對/);
  assert.ok(text.length <= results.EVIDENCE_MAX_CHARS, String(text.length));
  const p = results.buildPayload(Object.assign(bestAnswers(), a));
  assert.equal(p.topPainPoints[0].key, 'BONUS');
  assert.equal(p.topPainPoints[0].evidenceSummary, text);
});

test('T11 · 沒回答「算錯」，evidence 不得出現「算錯」；沒回答的題目不出現在文字裡', () => {
  const a = { Q19: 'excel', Q20: 'bit_troublesome', Q20_1: '2_3d', Q20_2: ['recheck'] };
  const text = results.buildEvidenceSummary('BONUS', a);
  assert.doesNotMatch(text, /算錯/);
  const noFollowup = results.buildEvidenceSummary('BONUS', { Q19: 'excel', Q20: 'ok' });
  assert.doesNotMatch(noFollowup, /天|核對|算錯/);
  assert.equal(results.buildEvidenceSummary('BONUS', {}), '', '完全沒答 → 空字串');
  // 其他分類的示例
  assert.equal(results.buildEvidenceSummary('CUSTOMER_RETENTION', { Q21: 'never_counted', Q22: 'no', Q23: ['none'] }),
    '目前還沒有固定統計久未回診客戶，也沒有固定做喚回，喚回之後也沒有完整追蹤是否回診或成交。');
  assert.match(results.buildEvidenceSummary('INVENTORY', { Q18: 'manual', Q18_1: ['unknown_qty', 'slow_count'] }), /人工處理庫存.*不知道實際剩多少、盤點很花時間/);
  assert.match(results.buildEvidenceSummary('PHOTO_MANAGEMENT', { Q15: ['phone', 'line'], Q16: 'slow', Q17: 'no' }), /手機、LINE.*比較花時間.*沒有和療程紀錄連在一起/);
  assert.match(results.buildEvidenceSummary('MANAGEMENT_REPORT', { Q24: 'month_end', Q25: ['none_visible'] }), /月底.*另外整理/);
  config.PRIMARY_CATEGORY_KEYS.forEach((k) => {
    assert.equal(typeof results.buildEvidenceSummary(k, {}), 'string', `${k} 有 evidence builder`);
  });
});

test('T12 · Q15 = 沒有固定影像管理 → Q16/Q17 跳過，PHOTO 得適度分數而非 100', () => {
  const v = ids({ Q15: ['no_regular'] });
  assert.equal(v.includes('Q16'), false);
  assert.equal(v.includes('Q17'), false);
  assert.ok(ids({ Q15: ['phone'] }).includes('Q16'));
  const s = scoring.computeScores({ Q15: ['no_regular'], Q16: 'lost', Q16_pain: 5, Q17: 'no' }); // 舊答案不計
  assert.equal(s.PHOTO_MANAGEMENT, scoring.NO_PHOTO_MANAGEMENT_SCORE);
  assert.ok(s.PHOTO_MANAGEMENT >= 30 && s.PHOTO_MANAGEMENT < 50);
  assert.equal(config.QUESTION_BY_ID.Q15.exclusive, 'no_regular');
  assert.equal(results.buildEvidenceSummary('PHOTO_MANAGEMENT', { Q15: ['no_regular'] }), '目前沒有固定拍攝或管理術前術後照片。');
});

test('T13 · TOP 3 同分 → 依主要分類固定順序，deterministic', () => {
  const a = { Q6: 'switch_pages', Q6_pain: 3, Q8: 'often_confirm', Q8_pain: 3, Q10: 'sometimes', Q10_pain: 3, Q14: 'multiple_places', Q14_pain: 3 };
  const s = scoring.computeScores(a);
  assert.equal(s.CUSTOMER_DATA, 60); assert.equal(s.APPOINTMENT, 60); assert.equal(s.MEDICAL_RECORD, 60);
  const top = scoring.topN(s, 3).map((r) => r.key);
  assert.deepEqual(top, ['CUSTOMER_DATA', 'APPOINTMENT', 'MEDICAL_RECORD']);
});

test('T14 · 同一組答案跑兩次 → payload（除時間外）完全一致', () => {
  const a = Object.assign(bestAnswers(), { Q19: 'excel', Q20: 'bit_troublesome', Q20_1: '2_3d', Q20_2: ['recheck'], Q26: ['excel', 'line', 'paper'], Q30A: 'COMPARING', Q30B: 'WITHIN_3_MONTHS' });
  const now = new Date('2026-09-27T00:00:00Z');
  const p1 = results.buildPayload(a, now);
  const p2 = results.buildPayload(JSON.parse(JSON.stringify(a)), now);
  assert.deepEqual(p1, p2);
});
