/* =====================================================================
   ClinicOS 診所營運健檢 — 頁面行為（V1）
   Welcome → 一題一頁的 Wizard → 結果頁 → 可選 Lead。
   題目在 checkup-config.js、計分在 checkup-scoring.js、
   文案在 checkup-results.js、暫存在 checkup-state.js、送出在 checkup-submit.js。
   這裡只負責 DOM。所有文字都用 textContent，不用 innerHTML。
   ===================================================================== */
(function () {
  'use strict';

  var CK = window.ClinicCheckup;
  if (!CK || !CK.config || !CK.scoring || !CK.results || !CK.state || !CK.submit) return;

  var config = CK.config;
  var scoring = CK.scoring;
  var results = CK.results;
  var store = CK.state;
  var submit = CK.submit;

  var root = document.querySelector('[data-ck]');
  if (!root) return;

  /* ---------- DOM 參照 ---------- */
  var $ = function (sel, ctx) { return (ctx || root).querySelector(sel); };
  var phases = {
    welcome: $('[data-ck-phase="welcome"]'),
    quiz: $('[data-ck-phase="quiz"]'),
    result: $('[data-ck-phase="result"]'),
  };
  var el = {
    start: $('[data-ck-start]'),
    resume: $('[data-ck-resume]'),
    resumeBtn: $('[data-ck-resume-btn]'),
    stepNum: $('[data-ck-step-num]'),
    stepTitle: $('[data-ck-step-title]'),
    progress: $('[data-ck-progress]'),
    progressFill: $('[data-ck-progress-fill]'),
    question: $('[data-ck-question]'),
    prev: $('[data-ck-prev]'),
    next: $('[data-ck-next]'),
    hint: $('[data-ck-hint]'),
    top: $('[data-ck-top]'),
    modeTitle: $('[data-ck-mode-title]'),
    modeLead: $('[data-ck-mode-lead]'),
    systemic: $('[data-ck-systemic]'),
    systemicList: $('[data-ck-systemic-list]'),
    rest: $('[data-ck-rest]'),
    demo: $('[data-ck-demo]'),
    ctaTitle: $('[data-ck-cta-title]'),
    ctaBody: $('[data-ck-cta-body]'),
    demoCta: $('[data-ck-demo-cta]'),
    leadForm: $('[data-ck-lead-form]'),
    leadStatus: $('[data-ck-lead-status]'),
    restart: $('[data-ck-restart]'),
  };

  var LINE_URL = 'https://lin.ee/sp5MbgH';
  var PHONE_PATTERN = /^[+()\-.\s\d#]{7,30}$/;
  var EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,186}\.[^\s@.]{2,}$/;
  var OTHER = 'OTHER';

  /* ---------- 狀態 ---------- */
  var state = { phase: 'welcome', answers: {}, cursor: 0, startedAt: null };
  var payload = null;
  var completeSent = false;   // 同一份 assessment 只送一次 complete；重新測一次才會重置

  /* ---------- Analytics：只在既有 dataLayer / gtag 存在時推送，不自帶 SDK ---------- */
  function track(name, params) {
    try {
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push(Object.assign({ event: name }, params || {}));
      } else if (typeof window.gtag === 'function') {
        window.gtag('event', name, params || {});
      }
    } catch (e) { /* analytics 永遠不能影響作答 */ }
  }

  /* Microsoft Clarity custom event：只送事件名稱，不送任何個資或答案。
     Clarity 未載入（本機、被 AdBlock 擋掉、連不到 Microsoft）時直接略過。 */
  function clarityEvent(name) {
    try {
      if (typeof window.clarity === 'function') window.clarity('event', name);
    } catch (e) { /* analytics 永遠不能影響作答 */ }
  }

  /* ---------- 小工具 ---------- */
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function persist() { store.save(state); }

  function visible() { return config.visibleQuestions(state.answers); }

  function scrollToTop(target) {
    var headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10) || 72;
    var y = target.getBoundingClientRect().top + window.scrollY - headerH - 24;
    window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
  }

  function setPhase(name) {
    state.phase = name;
    Object.keys(phases).forEach(function (k) { if (phases[k]) phases[k].hidden = k !== name; });
    persist();
  }

  /* ---------- 題目選項（Q27 動態） ---------- */
  function optionsFor(q) {
    if (q.dynamic === 'topCategories') {
      return scoring.priorityOptions(state.answers).concat([{ value: OTHER, label: '其他' }]);
    }
    return q.options;
  }

  function isAnswered(q) {
    var v = state.answers[q.id];
    if (q.type === 'multi') return Array.isArray(v) && v.length > 0;
    return v !== undefined && v !== null && v !== '';
  }

  /* ---------- 作答 ---------- */
  function setSingle(q, value) {
    if (state.answers[q.id] !== value) {
      state.answers[q.id] = value;
      if (value !== OTHER) delete state.answers[q.id + '_other'];
    }
    persist();
    renderQuestion();
  }

  function toggleMulti(q, value) {
    var current = Array.isArray(state.answers[q.id]) ? state.answers[q.id].slice() : [];
    var idx = current.indexOf(value);
    if (idx !== -1) {
      current.splice(idx, 1);
    } else if (q.exclusive && value === q.exclusive) {
      current = [value];
    } else {
      if (q.exclusive) current = current.filter(function (v) { return v !== q.exclusive; });
      if (q.max && current.length >= q.max) { showHint('最多選 ' + q.max + ' 個，先取消一個再選。'); return; }
      current.push(value);
    }
    state.answers[q.id] = current;
    persist();
    renderQuestion();
  }

  function setPain(q, value) {
    state.answers[q.id + '_pain'] = value;
    persist();
  }

  function showHint(text) { if (el.hint) el.hint.textContent = text || ''; }

  /* ---------- 渲染：進度 ---------- */
  function renderProgress(q, list) {
    var stepIdx = config.stepIndexOf(q.step);
    var pct = Math.round((state.cursor / list.length) * 100);
    if (el.stepNum) el.stepNum.textContent = (stepIdx + 1) + ' / ' + config.STEPS.length;
    if (el.stepTitle) el.stepTitle.textContent = config.STEPS[stepIdx].title;
    if (el.progress) el.progress.setAttribute('aria-valuenow', String(pct));
    if (el.progressFill) el.progressFill.style.width = pct + '%';
  }

  /* ---------- 渲染：選項卡 ---------- */
  function buildOptions(q, options) {
    var isMulti = q.type === 'multi';
    var group = make('div', 'ck-options');
    group.setAttribute('role', isMulti ? 'group' : 'radiogroup');
    group.setAttribute('aria-labelledby', 'ck-q-title');

    var longest = options.reduce(function (m, o) { return Math.max(m, o.label.length); }, 0);
    if (options.length >= 8 && longest <= 8) group.classList.add('ck-options--dense');
    else if (longest <= 14) group.classList.add('ck-options--cols');

    var current = state.answers[q.id];
    var selectedCount = Array.isArray(current) ? current.length : 0;

    options.forEach(function (opt) {
      var btn = make('button', 'ck-option');
      btn.type = 'button';
      btn.setAttribute('role', isMulti ? 'checkbox' : 'radio');
      var checked = isMulti ? (Array.isArray(current) && current.indexOf(opt.value) !== -1) : current === opt.value;
      btn.setAttribute('aria-checked', String(checked));
      if (isMulti && q.max && !checked && selectedCount >= q.max) btn.setAttribute('aria-disabled', 'true');
      btn.dataset.value = opt.value;
      btn.appendChild(make('span', 'ck-option__mark'));
      btn.appendChild(make('span', 'ck-option__label', opt.label));
      btn.addEventListener('click', function () {
        showHint('');
        if (isMulti) toggleMulti(q, opt.value); else setSingle(q, opt.value);
      });
      group.appendChild(btn);
    });

    if (!isMulti) {
      group.addEventListener('keydown', function (e) {
        var keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
        if (keys.indexOf(e.key) === -1) return;
        var items = Array.prototype.slice.call(group.querySelectorAll('.ck-option'));
        var i = items.indexOf(document.activeElement);
        if (i === -1) return;
        e.preventDefault();
        var dir = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
        var next = items[(i + dir + items.length) % items.length];
        next.focus();
        next.click();
      });
    }
    return group;
  }

  function buildOther(q) {
    var wrap = make('div', 'ck-other field');
    var label = make('label', 'field__label', '想先解決的是？');
    label.setAttribute('for', 'ck-other-input');
    var input = make('input', 'field__input');
    input.id = 'ck-other-input';
    input.type = 'text';
    input.maxLength = 100;
    input.placeholder = '簡單寫一下就好';
    input.value = state.answers[q.id + '_other'] || '';
    input.addEventListener('input', function () {
      state.answers[q.id + '_other'] = input.value.slice(0, 100);
      persist();
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  /* ---------- 渲染：痛苦指數 ---------- */
  function buildPain(q) {
    var key = q.id + '_pain';
    var current = Number(state.answers[key]) || 0;
    var wrap = make('div', 'ck-pain' + (current ? '' : ' is-unset'));

    var title = make('label', 'ck-pain__title', '這件事現在有多困擾你？');
    title.setAttribute('for', 'ck-pain-range');
    wrap.appendChild(title);
    wrap.appendChild(make('p', 'ck-pain__hint', '拖一下或點一下就好，沒有標準答案。'));

    var range = make('input', 'ck-pain__range');
    range.type = 'range';
    range.id = 'ck-pain-range';
    range.min = '1';
    range.max = '5';
    range.step = '1';
    range.value = String(current || 3);
    range.setAttribute('aria-valuetext', current ? current + '，' + config.PAIN_LABELS[current] : '尚未選擇');
    wrap.appendChild(range);

    var scale = make('div', 'ck-pain__scale');
    scale.setAttribute('aria-hidden', 'true');
    [1, 2, 3, 4, 5].forEach(function (n) { scale.appendChild(make('span', null, n)); });
    wrap.appendChild(scale);

    var ends = make('div', 'ck-pain__ends');
    ends.setAttribute('aria-hidden', 'true');
    ends.appendChild(make('span', null, '1 沒什麼影響'));
    ends.appendChild(make('span', null, '5 真的很想解決'));
    wrap.appendChild(ends);

    var value = make('p', 'ck-pain__value', current ? current + '　' + config.PAIN_LABELS[current] : '還沒選，可以先跳過');
    value.setAttribute('role', 'status');
    wrap.appendChild(value);

    var commit = function () {
      var n = Number(range.value);
      setPain(q, n);
      wrap.classList.remove('is-unset');
      range.setAttribute('aria-valuetext', n + '，' + config.PAIN_LABELS[n]);
      value.textContent = n + '　' + config.PAIN_LABELS[n];
    };
    range.addEventListener('input', commit);
    range.addEventListener('change', commit);
    range.addEventListener('pointerup', commit);   // 點在原位（預設 3）也算選了
    range.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') commit(); });
    return wrap;
  }

  /* ---------- 渲染：整題 ---------- */
  function renderQuestion() {
    var list = visible();
    if (state.cursor >= list.length) state.cursor = list.length - 1;
    if (state.cursor < 0) state.cursor = 0;
    var q = list[state.cursor];
    if (!q) return;

    renderProgress(q, list);
    clear(el.question);

    var block = make('div', 'ck-q');
    block.appendChild(make('p', 'eyebrow', 'Q' + pad2(state.cursor + 1)));
    var title = make('h2', 'ck-q__title', q.title);
    title.id = 'ck-q-title';
    title.tabIndex = -1;
    block.appendChild(title);
    if (q.hint) block.appendChild(make('p', 'ck-q__hint', q.hint));

    var options = optionsFor(q);
    block.appendChild(buildOptions(q, options));
    if (q.allowOther && state.answers[q.id] === OTHER) block.appendChild(buildOther(q));
    if (q.pain && isAnswered(q)) block.appendChild(buildPain(q));

    el.question.appendChild(block);

    el.prev.textContent = state.cursor === 0 ? '回到說明' : '上一題';
    el.next.textContent = state.cursor === list.length - 1 ? '看結果' : '下一題';
  }

  function focusQuestion() {
    var title = $('#ck-q-title');
    if (title) title.focus({ preventScroll: true });
  }

  function goTo(index) {
    showHint('');
    state.cursor = index;
    persist();
    renderQuestion();
    scrollToTop(phases.quiz);
    focusQuestion();
  }

  function onNext() {
    var list = visible();
    var q = list[state.cursor];
    if (!q) return;
    if (!isAnswered(q)) {
      showHint(q.type === 'multi' ? '先勾一個最接近的，再往下一題。' : '先選一個最接近的，再往下一題。');
      return;
    }
    var prevStep = q.step;
    var nextList = visible();                      // 條件題可能因這題的答案而出現
    if (state.cursor >= nextList.length - 1) { finish(); return; }
    var nextQ = nextList[state.cursor + 1];
    if (nextQ.step !== prevStep) track('clinic_checkup_step_complete', { step: prevStep });
    goTo(state.cursor + 1);
  }

  function onPrev() {
    if (state.cursor === 0) {
      setPhase('welcome');
      scrollToTop(phases.welcome);
      return;
    }
    goTo(state.cursor - 1);
  }

  function start(resume) {
    if (!resume) {
      state.answers = {};
      state.cursor = 0;
      state.startedAt = new Date().toISOString();
      completeSent = false;
      track('clinic_checkup_start', {});
      clarityEvent('clinicCheckupStart');   // 真的按下「開始健檢」才算開始
    }
    setPhase('quiz');
    renderQuestion();
    scrollToTop(phases.quiz);
    focusQuestion();
  }

  /* ---------- 結果 ---------- */
  function bandTag(item) {
    var tag = make('span', 'ck-band ck-band--' + item.band, item.bandLabel);
    return tag;
  }

  function renderResult() {
    payload = results.buildPayload(state.answers);

    var mode = results.RESULT_MODE_COPY[payload.resultMode] || results.RESULT_MODE_COPY.priority;
    if (el.modeTitle) el.modeTitle.textContent = mode.title;
    if (el.modeLead) el.modeLead.textContent = mode.lead;
    if (el.ctaTitle) el.ctaTitle.textContent = mode.ctaTitle;
    if (el.ctaBody) el.ctaBody.textContent = mode.ctaBody;

    clear(el.top);
    payload.topPainPoints.forEach(function (item, i) {
      var copy = results.RESULT_COPY[item.key];
      var card = make('li', 'ck-card');
      card.appendChild(make('span', 'ck-card__index', pad2(i + 1)));
      var head = make('div', 'ck-card__head');
      head.appendChild(make('h3', 'ck-card__title', copy.title));
      head.appendChild(bandTag(item));
      card.appendChild(head);
      if (item.evidenceSummary) {
        var ev = make('div', 'ck-card__evidence');
        ev.appendChild(make('span', 'ck-card__help-label', '你的狀況'));
        ev.appendChild(make('p', 'ck-card__evidence-text', item.evidenceSummary));
        card.appendChild(ev);
      }
      card.appendChild(make('p', 'ck-card__summary', copy.problemSummary));
      var help = make('div', 'ck-card__help');
      help.appendChild(make('span', 'ck-card__help-label', 'ClinicOS 可以怎麼協助'));
      var chain = make('ol', 'ck-chain');
      copy.clinicOSHelp.forEach(function (step) { chain.appendChild(make('li', null, step)); });
      help.appendChild(chain);
      card.appendChild(help);
      el.top.appendChild(card);
    });

    /* 系統性觀察：只有 >= 50 才出現，層級低於 TOP 3 */
    if (el.systemic && el.systemicList) {
      clear(el.systemicList);
      payload.systemicObservations.forEach(function (o) {
        var li = make('li', 'ck-note');
        var head = make('div', 'ck-note__head');
        head.appendChild(make('h3', 'ck-note__title', o.title));
        head.appendChild(make('span', 'ck-note__level', '程度：' + o.levelLabel));
        li.appendChild(head);
        li.appendChild(make('p', 'ck-note__text', o.text));
        el.systemicList.appendChild(li);
      });
      el.systemic.hidden = payload.systemicObservations.length === 0;
    }

    clear(el.rest);
    if (payload.otherPainPoints.length) {
      var list = make('ul', 'ck-rest__list');
      payload.otherPainPoints.forEach(function (item) {
        var row = make('li', 'ck-rest__item');
        row.appendChild(make('span', null, item.label));
        row.appendChild(bandTag(item));
        list.appendChild(row);
      });
      el.rest.appendChild(list);
    } else {
      el.rest.appendChild(make('p', 'ck-rest__empty', '其他部分從你的回答看起來，目前都還算順，可以之後再慢慢優化。'));
    }

    clear(el.demo);
    payload.recommendedDemo.forEach(function (item) { el.demo.appendChild(make('li', null, item)); });

    if (el.leadForm) {
      el.leadForm.hidden = false;
      el.leadForm.reset();
      Array.prototype.forEach.call(el.leadForm.elements, function (c) { c.disabled = false; });
    }
    if (el.leadStatus) { el.leadStatus.hidden = true; el.leadStatus.textContent = ''; }
  }

  function finish() {
    setPhase('result');
    renderResult();
    track('clinic_checkup_complete', {
      top1: payload.topPainPoints[0] ? payload.topPainPoints[0].key : '',
      result_mode: payload.resultMode,
      sales_stage: payload.sales.stage,
      sales_timeline: payload.sales.implementationTimeline,
    });
    /* 只有「答完最後一題進到結果頁」會走到這裡；重新整理結果頁是走還原流程，不會重送。 */
    if (!completeSent) {
      completeSent = true;
      clarityEvent('clinicCheckupComplete');
    }
    scrollToTop(phases.result);
    var title = $('[data-ck-result-title]');
    if (title) title.focus({ preventScroll: true });
  }

  function restart() {
    store.clear();
    state = { phase: 'welcome', answers: {}, cursor: 0, startedAt: null };
    payload = null;
    completeSent = false;   // 重新測一次是新的 assessment，之後可以再送一次 complete
    setPhase('welcome');
    if (el.resume) el.resume.hidden = true;
    scrollToTop(phases.welcome);
  }

  /* ---------- Lead ---------- */
  function showLeadStatus(lines, isError, withLine) {
    var status = el.leadStatus;
    if (!status) return;
    clear(status);
    lines.forEach(function (line, i) {
      if (i) status.appendChild(document.createElement('br'));
      status.appendChild(document.createTextNode(line));
    });
    if (withLine) {
      status.appendChild(document.createElement('br'));
      var link = make('a', null, '加入官方 LINE');
      link.href = LINE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      status.appendChild(link);
    }
    status.classList.toggle('is-error', !!isError);
    status.hidden = false;
    status.focus();
  }

  function leadValues() {
    var f = el.leadForm;
    var get = function (name) { var c = f.elements[name]; return c ? String(c.value || '').trim() : ''; };
    return {
      clinicName: get('clinicName'),
      contactName: get('contactName'),
      phone: get('phone'),
      email: get('email'),
      lineId: get('lineId'),
      website: get('website'),
    };
  }

  function firstLeadProblem(v) {
    if (!v.clinicName) return { field: 'clinicName', text: '請填診所名稱。' };
    if (!v.contactName) return { field: 'contactName', text: '請填聯絡人。' };
    if (!v.phone || !PHONE_PATTERN.test(v.phone) || (v.phone.match(/\d/g) || []).length < 7) {
      return { field: 'phone', text: '電話請填可以聯繫的號碼。' };
    }
    if (v.email && !EMAIL_PATTERN.test(v.email)) return { field: 'email', text: 'Email 格式看起來不太對。' };
    return null;
  }

  if (el.leadForm) {
    var busy = false;
    var submitBtn = el.leadForm.querySelector('[type="submit"]');
    var submitLabel = submitBtn ? submitBtn.textContent : '送出';
    var setBusy = function (on) {
      busy = on;
      if (!submitBtn) return;
      submitBtn.disabled = on;
      submitBtn.setAttribute('aria-busy', String(on));
      submitBtn.textContent = on ? '正在送出…' : submitLabel;
    };

    el.leadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy || !payload) return;
      var v = leadValues();
      var problem = firstLeadProblem(v);
      if (problem) {
        showLeadStatus([problem.text], true, false);
        var c = el.leadForm.elements[problem.field];
        if (c) c.focus();
        return;
      }
      setBusy(true);
      showLeadStatus(['正在送出…'], false, false);
      submit.submitLead(payload, v, v.website).then(function (r) {
        setBusy(false);
        if (r.ok) {
          track('clinic_checkup_lead_submit', { sales_stage: payload.sales.stage, sales_timeline: payload.sales.implementationTimeline });
          clarityEvent('clinicCheckupLeadSubmit');   // 只在後端回 200 成功後；不送任何聯絡資料
          Array.prototype.forEach.call(el.leadForm.elements, function (c) { c.disabled = true; });
          showLeadStatus(['已收到，謝謝。', '我們會依照你的健檢結果先準備，再透過你留下的聯絡方式與你約時間。'], false, false);
        } else {
          showLeadStatus(['訊息暫時無法送出。', '請稍後再試，或直接透過官方 LINE 與我們聯繫。'], true, true);
        }
      });
    });
  }

  /* ---------- 事件 ---------- */
  if (el.start) el.start.addEventListener('click', function () { start(false); });
  if (el.resumeBtn) el.resumeBtn.addEventListener('click', function () { start(true); });
  if (el.prev) el.prev.addEventListener('click', onPrev);
  if (el.next) el.next.addEventListener('click', onNext);
  if (el.restart) el.restart.addEventListener('click', restart);
  if (el.demoCta) {
    el.demoCta.addEventListener('click', function () {
      track('clinic_checkup_demo_click', {});
      var first = el.leadForm ? el.leadForm.elements.clinicName : null;
      if (first) window.setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
    });
  }

  /* ---------- 還原 ---------- */
  var saved = store.load();
  if (saved && saved.answers && Object.keys(saved.answers).length) {
    state.answers = config.sanitizeAnswers(saved.answers);   // 舊選項／舊題目一律視為未回答
    state.cursor = Number(saved.cursor) || 0;
    state.startedAt = saved.startedAt || null;
    if (saved.phase === 'result') {
      setPhase('result');
      renderResult();
    } else if (saved.phase === 'quiz') {
      setPhase('quiz');
      renderQuestion();
    } else if (el.resume) {
      el.resume.hidden = false;
    }
  } else {
    setPhase('welcome');
  }
})();
