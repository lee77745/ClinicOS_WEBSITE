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
     Mobile chapter strip — the eight stops fit inside 360px, so this
     normally does nothing. When a narrower viewport (or a larger text
     size) makes the track scroll, the current chapter is brought to
     the middle of it. Horizontal only: the page itself never moves.
     --------------------------------------------------------------- */
  var chapterTrack = document.querySelector('[data-chapter-track]');
  if (chapterTrack) {
    var centreCurrent = function () {
      var current = chapterTrack.querySelector('[aria-current="page"]');
      if (!current) return;
      if (chapterTrack.scrollWidth <= chapterTrack.clientWidth) return;
      var trackBox = chapterTrack.getBoundingClientRect();
      var itemBox = current.getBoundingClientRect();
      /* the browser clamps the result to the scrollable range */
      chapterTrack.scrollLeft += (itemBox.left - trackBox.left)
        - (trackBox.width - itemBox.width) / 2;
    };
    centreCurrent();
    window.addEventListener('load', centreCurrent);
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
})();
