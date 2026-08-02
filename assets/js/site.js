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
