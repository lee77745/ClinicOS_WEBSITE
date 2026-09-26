/* =====================================================================
   ClinicOS — Site behaviour
   Small, dependency-free, progressive. Nothing here is required to read
   the page; JS only adds refinement.
   ===================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------
     Header — becomes solid once the page leaves the top
     --------------------------------------------------------------- */
  var header = document.querySelector('[data-header]');
  if (header) {
    var stuck = false;
    var onScroll = function () {
      var next = window.scrollY > 24;
      if (next !== stuck) {
        stuck = next;
        header.classList.toggle('is-stuck', stuck);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------------------------------------------------------------
     Mobile menu
     --------------------------------------------------------------- */
  var toggle = document.querySelector('[data-menu-toggle]');
  var menu = document.querySelector('[data-menu]');

  function setMenu(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('is-locked', open);
  }

  if (toggle && menu) {
    setMenu(false);
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenu(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 900) setMenu(false);
    });
  }

  /* ---------------------------------------------------------------
     Contact form — POST /api/contact, which relays to the official
     LINE account. Same origin, so no CORS and no absolute URL.
     --------------------------------------------------------------- */
  var contactForm = document.querySelector('[data-form]');
  if (contactForm) {
    var LINE_URL = 'https://lin.ee/sp5MbgH';
    var status = contactForm.querySelector('[data-form-status]');
    var submitBtn = contactForm.querySelector('[type="submit"]');
    var submitLabel = submitBtn ? submitBtn.textContent : '送出';
    var busy = false;

    /* Render status as plain text lines, plus an optional LINE link.
       Nothing here is user-supplied, but building it with DOM nodes
       keeps innerHTML out of the submit path entirely. */
    var showStatus = function (lines, isError, withLine) {
      if (!status) return;
      while (status.firstChild) status.removeChild(status.firstChild);
      lines.forEach(function (line, i) {
        if (i) status.appendChild(document.createElement('br'));
        status.appendChild(document.createTextNode(line));
      });
      if (withLine) {
        status.appendChild(document.createElement('br'));
        var link = document.createElement('a');
        link.href = LINE_URL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '加入官方 LINE';
        status.appendChild(link);
      }
      status.classList.toggle('is-error', !!isError);
      status.hidden = false;
    };

    var setBusy = function (on) {
      busy = on;
      if (!submitBtn) return;
      submitBtn.disabled = on;
      submitBtn.setAttribute('aria-busy', String(on));
      submitBtn.textContent = on ? '正在送出…' : submitLabel;
    };

    var firstInvalid = function () {
      var controls = contactForm.querySelectorAll('input[name], select[name], textarea[name]');
      for (var i = 0; i < controls.length; i += 1) {
        var el = controls[i];
        if (el.name === 'website') continue;            // honeypot never blocks a human
        if (el.willValidate && !el.checkValidity()) return el;
      }
      return null;
    };

    var collect = function () {
      var payload = {};
      Array.prototype.forEach.call(contactForm.elements, function (el) {
        if (!el.name || el.disabled) return;
        if (el.type === 'submit' || el.type === 'button') return;
        payload[el.name] = el.value;
      });
      return payload;
    };

    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;

      var invalid = firstInvalid();
      if (invalid) {
        showStatus(['請確認表單內容。', '標示 * 的欄位為必填，Email 與電話請填寫可聯繫的格式。'], true, false);
        invalid.focus();
        return;                                          // 前端驗證失敗：不送 API
      }

      setBusy(true);
      showStatus(['正在送出…'], false, false);

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect())
      })
        .then(function (res) {
          return res.json().catch(function () { return null; })
            .then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw new Error('request failed');
          contactForm.reset();
          showStatus(['已收到您的訊息。', '我們會透過您留下的聯絡方式與您聯繫。'], false, false);
        })
        .catch(function () {
          showStatus(['訊息暫時無法送出。', '請稍後再試，或直接透過官方 LINE 與我們聯繫。'], true, true);
        })
        .then(function () {
          setBusy(false);
          if (status) status.focus();
        });
    });
  }

  /* ---------------------------------------------------------------
     Scroll reveal — one observer, staggered by data-reveal-group
     --------------------------------------------------------------- */
  var revealables = document.querySelectorAll('[data-reveal], [data-reveal-line]');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(revealables, function (el) { el.classList.add('is-in'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    Array.prototype.forEach.call(revealables, function (el) {
      var step = parseInt(el.getAttribute('data-reveal-step') || '0', 10);
      if (step) el.style.setProperty('--reveal-delay', step * 90 + 'ms');
      observer.observe(el);
    });
  }

  /* ---------------------------------------------------------------
     Hero band — a very slight parallax. Restraint is the point.
     --------------------------------------------------------------- */
  var parallax = document.querySelector('[data-parallax]');
  if (parallax && !reduceMotion) {
    var ticking = false;
    var apply = function () {
      var rect = parallax.getBoundingClientRect();
      var progress = 1 - (rect.top / window.innerHeight);
      var shift = Math.max(-24, Math.min(24, progress * 28 - 14));
      parallax.style.transform = 'translate3d(0,' + shift.toFixed(2) + 'px, 0) scale(1.06)';
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    }, { passive: true });
    apply();
  }

  /* ---------------------------------------------------------------
     Year stamp
     --------------------------------------------------------------- */
  var year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------------------------------------------------------------
     Floating entry — 「診所營運健檢」right-bottom pill on every public
     page. Never rendered on the checkup page itself (any query/hash).
     Appears after the reader scrolls 20% or stays 3 seconds.
     Styles live in components.css (.float-entry).
     --------------------------------------------------------------- */
  (function floatingEntry() {
    var CHECKUP_PATH = '/clinic-checkup';
    var path = window.location.pathname.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '');
    if (path === CHECKUP_PATH) return;                       // the questionnaire page: no entry
    if (!document.querySelector('main')) return;             // not a content page (verification file etc.)
    if (document.querySelector('.float-entry')) return;

    var link = document.createElement('a');
    link.className = 'float-entry';
    link.href = CHECKUP_PATH + '?from=floating-entry';
    link.setAttribute('aria-label', '診所營運健檢，3 到 5 分鐘看看診所哪裡最卡');

    var icon = document.createElement('span');
    icon.className = 'float-entry__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path></svg>';

    var text = document.createElement('span');
    text.className = 'float-entry__text';
    var title = document.createElement('span');
    title.className = 'float-entry__title';
    title.textContent = '診所營運健檢';
    var sub = document.createElement('span');
    sub.className = 'float-entry__sub';
    sub.textContent = '3–5 分鐘看看哪裡最卡';
    text.appendChild(title);
    text.appendChild(sub);

    var arrow = document.createElement('span');
    arrow.className = 'float-entry__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';

    link.appendChild(icon);
    link.appendChild(text);
    link.appendChild(arrow);
    document.body.appendChild(link);

    link.addEventListener('click', function () {
      try {
        if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: 'clinic_checkup_floating_click' });
        else if (typeof window.gtag === 'function') window.gtag('event', 'clinic_checkup_floating_click');
        // Microsoft Clarity：只送事件名稱，不送任何個資。Clarity 沒載入時直接略過。
        if (typeof window.clarity === 'function') window.clarity('event', 'clinicCheckupFloatingClick');
      } catch (e) { /* tracking must never block navigation */ }
    });

    var shown = false;
    var show = function () {
      if (shown) return;
      shown = true;
      link.classList.add('is-visible');
      window.removeEventListener('scroll', onScrollCheck);
    };
    var onScrollCheck = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      if (max <= 0 || window.scrollY / max >= 0.2) show();
    };
    window.addEventListener('scroll', onScrollCheck, { passive: true });
    window.setTimeout(show, 3000);
  })();
})();
