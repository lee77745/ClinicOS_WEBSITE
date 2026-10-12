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
     Anonymous click events (WEB-GAME-001) — Microsoft Clarity only,
     event name only (no names, contact details, game choices or
     scores). Silently skipped when Clarity is not loaded (localhost,
     blocked script); tracking must never break the page.
     --------------------------------------------------------------- */
  function trackEvent(name) {
    try {
      if (typeof window.clarity === 'function') window.clarity('event', name);
    } catch (e) { /* never block the page */ }
  }

  /* ---------------------------------------------------------------
     Game invite (WEB-GAME-001) — 首頁第一次進站約 1.5 秒後，邀請試玩
     《院長，今天又出事了！》（同網域 /game/）。
     - 只在首頁；同一瀏覽工作階段最多自動顯示一次（sessionStorage
       clinicos_game_invite_v1，實際顯示的當下就記錄）。
     - 從遊戲返回（?from=game）不顯示，並記錄為已處理。
     - sessionStorage 不可用時不自動顯示；手機選單開著時這次不顯示
       （不強行關閉選單）。
     - X、點遮罩、Esc、「先逛逛官網」都能關閉；關閉後焦點回到原位。
     - 沒有圖片、沒有輸入欄位；只送匿名的 Clarity 事件名稱。
     Styles live in components.css (.game-invite).
     --------------------------------------------------------------- */
  (function gameInvite() {
    var KEY = 'clinicos_game_invite_v1';
    var path = window.location.pathname.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '');
    if (path !== '' && path !== '/index') return;            // 首頁才自動邀請

    var store = null;
    try {
      store = window.sessionStorage;
      store.setItem('__clinicos_probe__', '1');
      store.removeItem('__clinicos_probe__');
    } catch (e) { store = null; }
    if (!store) return;                                       // 無法記錄就不自動顯示，避免每次都彈出

    try {
      if (/(?:^|[?&])from=game(?:&|$)/.test(window.location.search)) {
        store.setItem(KEY, 'from-game');                      // 從遊戲返回：不再邀請
        return;
      }
      if (store.getItem(KEY)) return;
    } catch (e) { return; }

    window.setTimeout(function () {
      if (document.body.classList.contains('is-locked')) return; // 選單開著：這次不顯示
      if (document.querySelector('[data-game-invite]')) return;
      try { store.setItem(KEY, 'shown'); } catch (e) { return; }
      open();
    }, 1500);

    function open() {
      var previousFocus = document.activeElement;
      var root = document.createElement('div');
      root.className = 'game-invite';
      root.setAttribute('data-game-invite', '');
      root.innerHTML =
        '<div class="game-invite__backdrop" data-invite-close></div>' +
        '<div class="game-invite__dialog" role="dialog" aria-modal="true" aria-labelledby="game-invite-title" aria-describedby="game-invite-desc" tabindex="-1">' +
          '<button type="button" class="game-invite__close" aria-label="關閉遊戲邀請" data-invite-close>' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>' +
          '</button>' +
          '<h2 class="game-invite__title" id="game-invite-title">院長，今天又出事了！</h2>' +
          '<p class="game-invite__desc" id="game-invite-desc">選擇院長或店長，在 3D 診所面對一天的九個挑戰。</p>' +
          '<div class="game-invite__actions">' +
            '<a class="game-invite__start" href="/game/" data-invite-start>開始挑戰</a>' +
            '<button type="button" class="game-invite__later" data-invite-close>先逛逛官網</button>' +
          '</div>' +
        '</div>';

      var dialog = root.querySelector('.game-invite__dialog');
      var inerted = [];
      Array.prototype.forEach.call(document.body.children, function (el) {
        if (el.tagName === 'SCRIPT' || el.hasAttribute('inert')) return;
        el.setAttribute('inert', '');                          // 背景不接受鍵盤與點擊
        inerted.push(el);
      });
      document.body.appendChild(root);
      document.body.classList.add('has-game-invite');          // 背景不捲動、浮動入口暫時隱藏
      dialog.focus();

      var focusables = function () {
        return Array.prototype.slice.call(dialog.querySelectorAll('a[href], button'));
      };
      var onKey = function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(true);
          return;
        }
        if (e.key !== 'Tab') return;
        var items = focusables();
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      function close(dismissed) {
        document.removeEventListener('keydown', onKey, true);
        inerted.forEach(function (el) { el.removeAttribute('inert'); });
        document.body.classList.remove('has-game-invite');
        if (root.parentNode) root.parentNode.removeChild(root);
        if (dismissed) trackEvent('gameInviteDismiss');
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
          previousFocus.focus({ preventScroll: true });
        }
      }
      document.addEventListener('keydown', onKey, true);
      Array.prototype.forEach.call(root.querySelectorAll('[data-invite-close]'), function (el) {
        el.addEventListener('click', function () { close(true); });
      });
      root.querySelector('[data-invite-start]').addEventListener('click', function () {
        trackEvent('gameInviteStartClick');                    // 同一分頁前往 /game/（一般連結）
      });
    }
  })();

  /* ---------------------------------------------------------------
     Floating entries — right-bottom stack on every public page:
       上：「挑戰當一天院長」→ /game/（WEB-GAME-001）
       下：「診所營運健檢」（原有入口；網址、文字、aria、出現時機與事件都不變）
     Never rendered on the checkup page itself (any query/hash).
     Appears after the reader scrolls 20% or stays 3 seconds (one shared timer).
     Styles live in components.css (.float-stack / .float-entry).
     --------------------------------------------------------------- */
  (function floatingEntry() {
    var CHECKUP_PATH = '/clinic-checkup';
    var path = window.location.pathname.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '');
    if (path === CHECKUP_PATH) return;                       // the questionnaire page: no entry
    if (!document.querySelector('main')) return;             // not a content page (verification file etc.)
    if (document.querySelector('.float-entry')) return;

    var stack = document.createElement('div');
    stack.className = 'float-stack';

    var game = document.createElement('a');
    game.className = 'float-entry float-entry--game';
    game.href = '/game/';
    game.setAttribute('aria-label', '挑戰當一天院長：3D 診所經營小遊戲');
    game.innerHTML =
      '<span class="float-entry__icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="11" rx="5.5"></rect><path d="M8 11v3M6.5 12.5h3"></path><circle cx="15.5" cy="11.5" r="0.9" fill="currentColor" stroke="none"></circle><circle cx="17.5" cy="13.5" r="0.9" fill="currentColor" stroke="none"></circle></svg></span>' +
      '<span class="float-entry__text"><span class="float-entry__title">挑戰當一天院長</span><span class="float-entry__sub">3D 診所經營小遊戲</span></span>' +
      '<span class="float-entry__arrow" aria-hidden="true">›</span>';
    game.addEventListener('click', function () { trackEvent('gameFloatingClick'); });

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
    stack.appendChild(game);
    stack.appendChild(link);
    document.body.appendChild(stack);

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
      game.classList.add('is-visible');
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
