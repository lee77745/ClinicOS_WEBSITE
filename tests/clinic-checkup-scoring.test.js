/* =====================================================================
   ClinicOS 診所營運健檢 — 計分自動測試（node:test，零額外依賴）
   執行： npm test   或   node --test tests/clinic-checkup-scoring.test.js
   ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../assets/js/clinic-checkup/checkup-config.js');
const scoring = require('../assets/js/clinic-checkup/checkup-scoring.js');
const results = require('../assets/js/clinic-checkup/checkup-results.js');

/* 每一題都選「最卡」的答案，痛苦指數全 5 */
function worstAnswers() {
  const a = {};
  config.QUESTIONS.forEach((q) => {
    if (q.type === 'multi') {
      a[q.id] = q.options.filter((o) => o.value !== q.exclusive).map((o) => o.value);
    } else if (q.options.length) {
      const withLevel = q.options.filter((o) => o.level);
      a[q.id] = (withLevel.length ? withLevel[withLevel.length - 1] : q.options[q.options.length - 1]).value;
    }
    if (q.pain) a[`${q.id}_pain`] = 5;
  });
  a.Q26 = ['excel', 'gsheet', 'line', 'paper', 'handwriting', 'cross_check'];
  a.Q11 = 'scattered';
  a.Q17 = 'no';
  a.Q27 = 'BONUS';
  return a;
}

/* 每一題都選最順的答案，不填任何痛苦指數 */
function bestAnswers() {
  const a = {};
  config.QUESTIONS.forEach((q) => {
    if (q.type === 'multi') {
      a[q.id] = q.exclusive ? [q.exclusive] : [q.options[0].value];
    } else if (q.options.length) {
      a[q.id] = q.options[0].value;
    }
  });
  a.Q7 = ['system'];
  a.Q15 = ['system'];
  a.Q26 = ['almost_none'];
  return a;
}

test('01 · 空答案：不丟例外、全部 0、仍能排出 TOP 3', () => {
  const scores = scoring.computeScores({});
  config.CATEGORY_KEYS.forEach((k) => assert.equal(scores[k], 0));
  const top = scoring.topN(scores, 3);
  assert.equal(top.length, 3);
  assert.equal(top[0].band.key, 'fine');
  const payload = results.buildPayload({}, new Date('2026-09-26T00:00:00Z'));
  assert.equal(payload.topPainPoints.length, 3);
  assert.equal(payload.recommendedDemo.length > 0, true);
});

test('02 · 最糟答案：每個分類都不超過 100，且全部 >= 85', () => {
  const scores = scoring.computeScores(worstAnswers());
  config.CATEGORY_KEYS.forEach((k) => {
    assert.ok(scores[k] <= 100, `${k} = ${scores[k]}`);
    assert.ok(scores[k] >= 85, `${k} = ${scores[k]}`);
    assert.equal(Number.isInteger(scores[k]), true);
  });
});

test('03 · 最順答案且沒填痛苦指數：仍可產生結果，且全部落在「目前還好」', () => {
  const a = bestAnswers();
  const scores = scoring.computeScores(a);
  config.CATEGORY_KEYS.forEach((k) => assert.ok(scores[k] < 30, `${k} = ${scores[k]}`));
  const payload = results.buildPayload(a);
  assert.equal(payload.topPainPoints.length, 3);
  assert.equal(payload.otherPainPoints.length, 0);
});

test('04 · deterministic：同一組答案永遠得到同一組分數與 TOP 3', () => {
  const a = worstAnswers();
  const s1 = scoring.computeScores(a);
  const s2 = scoring.computeScores(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(s1, s2);
  assert.deepEqual(scoring.topN(s1, 3), scoring.topN(s2, 3));
});

test('05 · 不同答案 → 不同 TOP 3（獎金痛 vs 回流痛）', () => {
  const bonusHeavy = Object.assign(bestAnswers(), {
    Q19: 'excel', Q20: 'painful', Q20_pain: 5, Q20_1: '2_3d', Q20_2: ['miscalc', 'recheck'],
  });
  const retentionHeavy = Object.assign(bestAnswers(), {
    Q21: 'never_counted', Q21_pain: 5, Q22: 'no', Q23: ['none'],
  });
  const t1 = scoring.topN(scoring.computeScores(bonusHeavy), 3).map((r) => r.key);
  const t2 = scoring.topN(scoring.computeScores(retentionHeavy), 3).map((r) => r.key);
  assert.equal(t1[0], 'BONUS');
  assert.equal(t2[0], 'CUSTOMER_RETENTION');
  assert.notDeepEqual(t1, t2);
});

test('06 · 沒有儲值／訂金 → 不問餘額題，PAYMENT_BALANCE = 0', () => {
  const a = Object.assign(bestAnswers(), { Q12: ['none'] });
  const ids = config.visibleQuestions(a).map((q) => q.id);
  assert.equal(ids.includes('Q12_1'), false);
  assert.equal(scoring.computeScores(a).PAYMENT_BALANCE, 0);

  const b = Object.assign(bestAnswers(), { Q12: ['stored_value'], Q12_1: 'confusing', Q12_1_pain: 4 });
  assert.equal(config.visibleQuestions(b).map((q) => q.id).includes('Q12_1'), true);
  assert.ok(scoring.computeScores(b).PAYMENT_BALANCE >= 70);
});

test('07 · 條件題：庫存自動 → 不問 Q18-1；獎金痛苦 < 3 → 不問 Q20-1/Q20-2', () => {
  const auto = config.visibleQuestions({ Q18: 'auto', Q20: 'ok', Q20_pain: 2 }).map((q) => q.id);
  assert.equal(auto.includes('Q18_1'), false);
  assert.equal(auto.includes('Q20_1'), false);
  assert.equal(auto.includes('Q20_2'), false);

  const manual = config.visibleQuestions({ Q18: 'manual', Q20: 'ok', Q20_pain: 3 }).map((q) => q.id);
  assert.equal(manual.includes('Q18_1'), true);
  assert.equal(manual.includes('Q20_1'), true);
  assert.equal(manual.includes('Q20_2'), true);
});

test('08 · 痛苦指數 1～5 對應 20～100，且受阻力權重影響', () => {
  for (let p = 1; p <= 5; p += 1) {
    const s = scoring.computeScores({ Q6: 'switch_pages', Q6_pain: p }); // level 3 → 權重 1.0
    assert.equal(s.CUSTOMER_DATA, p * 20);
  }
  const easy = scoring.computeScores({ Q6: 'one_place', Q6_pain: 5 }).CUSTOMER_DATA; // 0.6
  const hard = scoring.computeScores({ Q6: 'hard', Q6_pain: 5 }).CUSTOMER_DATA;      // 1.2 → cap 100
  assert.equal(easy, 60);
  assert.equal(hard, 100);
});

test('09 · 困擾程度分級文字', () => {
  assert.equal(scoring.bandOf(0).label, '目前還好');
  assert.equal(scoring.bandOf(29).label, '目前還好');
  assert.equal(scoring.bandOf(30).label, '可以再優化');
  assert.equal(scoring.bandOf(50).label, '有點卡');
  assert.equal(scoring.bandOf(70).label, '很困擾');
  assert.equal(scoring.bandOf(85).label, '最值得先處理');
  assert.equal(scoring.bandOf(100).label, '最值得先處理');
});

test('10 · Q27 動態選項：5 個分類 + 前端補「其他」；選到的分類 +10', () => {
  const a = Object.assign(bestAnswers(), { Q21: 'unknown', Q21_pain: 3 });
  const opts = scoring.priorityOptions(a);
  assert.equal(opts.length, 5);
  assert.equal(opts[0].value, 'CUSTOMER_RETENTION');
  const without = scoring.computeScores(Object.assign({}, a, { Q27: undefined })).CUSTOMER_RETENTION;
  const withPriority = scoring.computeScores(Object.assign({}, a, { Q27: 'CUSTOMER_RETENTION' })).CUSTOMER_RETENTION;
  assert.equal(withPriority, Math.min(100, without + 10));
});

test('11 · payload 結構：canonical value、不含 label 當值、總分只留內部', () => {
  const a = Object.assign(worstAnswers(), { Q27: 'OTHER', Q27_other: '報表' });
  const p = results.buildPayload(a, new Date('2026-09-26T01:02:03Z'));
  assert.equal(p.assessmentVersion, '1.0');
  assert.equal(p.completedAt, '2026-09-26T01:02:03.000Z');
  assert.deepEqual(Object.keys(p.clinicProfile), ['branchCount', 'doctorCount', 'staffCount', 'dailyCustomerCount', 'currentSystemState']);
  assert.deepEqual(Object.keys(p.painScores).sort(), config.CATEGORY_KEYS.slice().sort());
  assert.equal(p.primaryPriority, 'OTHER');
  assert.equal(p.primaryPriorityNote, '報表');
  assert.equal(p.salesIntent, 'asap');
  assert.ok(p.recommendedDemo.length <= results.DEMO_MAX);
  assert.equal(typeof p.totalScore, 'number');
  p.topPainPoints.forEach((t) => {
    assert.ok(config.CATEGORY_KEYS.includes(t.key));
    assert.equal(typeof t.bandLabel, 'string');
  });
  assert.deepEqual(p.lead, { clinicName: '', contactName: '', phone: '', email: '', lineId: '' });
});

test('12 · 每個分類都有完整結果文案', () => {
  config.CATEGORY_KEYS.forEach((k) => {
    const c = results.RESULT_COPY[k];
    assert.ok(c, k);
    assert.equal(typeof c.title, 'string');
    assert.equal(typeof c.problemSummary, 'string');
    assert.ok(Array.isArray(c.clinicOSHelp) && c.clinicOSHelp.length >= 3);
    assert.ok(Array.isArray(c.recommendedDemo) && c.recommendedDemo.length >= 2);
  });
});
