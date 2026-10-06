/* ═══════════════════════════════════════════════════════════════
   FrostByte site effects — snow, mesh, reveal, typewriter,
   counters, scroll-spy, copy buttons, region badge.
   MIT License
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1. snowfall canvas ─────────────────────────────────────── */

  function initSnow() {
    var cv = document.getElementById('snow');
    if (!cv || reduceMotion) return;
    var ctx = cv.getContext('2d');
    var W, H, flakes = [], DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    function resize() {
      W = cv.width = innerWidth * DPR;
      H = cv.height = innerHeight * DPR;
      cv.style.width = innerWidth + 'px';
      cv.style.height = innerHeight + 'px';
    }
    resize();
    addEventListener('resize', resize);

    var N = Math.min(110, Math.floor(innerWidth / 12));
    for (var i = 0; i < N; i++) {
      flakes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: (Math.random() * 1.8 + 0.6) * DPR,
        vy: (Math.random() * 0.55 + 0.22) * DPR,
        sway: Math.random() * Math.PI * 2,
        swaySpd: Math.random() * 0.02 + 0.006,
        o: Math.random() * 0.5 + 0.25
      });
    }

    (function frame() {
      if (!document.hidden) {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < flakes.length; i++) {
          var f = flakes[i];
          f.y += f.vy;
          f.sway += f.swaySpd;
          f.x += Math.sin(f.sway) * 0.35 * DPR;
          if (f.y > H + 4) { f.y = -6; f.x = Math.random() * W; }
          if (f.x > W + 4) f.x = -4; else if (f.x < -4) f.x = W + 4;
          ctx.globalAlpha = f.o;
          ctx.fillStyle = '#bfe9ff';
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    })();
  }

  /* ── 2. hero p2p mesh canvas ────────────────────────────────── */

  function initMesh() {
    var cv = document.getElementById('mesh');
    if (!cv || reduceMotion) return;
    var ctx = cv.getContext('2d');
    var W, H, nodes = [], DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    function resize() {
      var rect = cv.parentElement.getBoundingClientRect();
      W = cv.width = rect.width * DPR;
      H = cv.height = rect.height * DPR;
    }
    resize();
    addEventListener('resize', resize);

    var N = 42;
    for (var i = 0; i < N; i++) {
      nodes.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0009,
        vy: (Math.random() - 0.5) * 0.0009
      });
    }

    (function frame() {
      if (!document.hidden) {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < N; i++) {
          var n = nodes[i];
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > 1) n.vx *= -1;
          if (n.y < 0 || n.y > 1) n.vy *= -1;
        }
        /* links */
        for (var a = 0; a < N; a++) {
          for (var b = a + 1; b < N; b++) {
            var dx = (nodes[a].x - nodes[b].x) * W;
            var dy = (nodes[a].y - nodes[b].y) * H;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < 130 * DPR) {
              ctx.strokeStyle = 'rgba(34,211,238,' + (0.16 * (1 - d / (130 * DPR))).toFixed(3) + ')';
              ctx.lineWidth = DPR;
              ctx.beginPath();
              ctx.moveTo(nodes[a].x * W, nodes[a].y * H);
              ctx.lineTo(nodes[b].x * W, nodes[b].y * H);
              ctx.stroke();
            }
          }
        }
        /* nodes */
        for (var k = 0; k < N; k++) {
          ctx.fillStyle = 'rgba(125,211,252,.5)';
          ctx.beginPath();
          ctx.arc(nodes[k].x * W, nodes[k].y * H, 1.6 * DPR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    })();
  }

  /* ── 3. scroll reveal ───────────────────────────────────────── */

  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ── 4. hero typewriter ─────────────────────────────────────── */

  function initTypewriter() {
    var el = document.getElementById('termCode');
    if (!el || reduceMotion) return;
    var finalHTML = el.innerHTML;
    var text = el.textContent.trim();
    var i = 0;
    el.textContent = '';
    el.classList.add('typing');

    (function type() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i += Math.random() < 0.28 ? 2 : 1;      // human-ish jitter
        setTimeout(type, 14 + Math.random() * 30);
      } else {
        el.innerHTML = finalHTML;
        el.classList.remove('typing');
      }
    })();
  }

  /* ── 5. animated counters ───────────────────────────────────── */

  function initCounters() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var el = en.target;
        var target = parseFloat(el.getAttribute('data-count'));
        var dur = 1400, t0 = null;
        function tick(t) {
          if (!t0) t0 = t;
          var p = Math.min((t - t0) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (target * eased).toFixed(target % 1 ? 1 : 0);
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ── 6. docs scroll-spy ─────────────────────────────────────── */

  function initScrollSpy() {
    var links = document.querySelectorAll('.docs-nav a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      map[id] = a;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && map[en.target.id]) {
          links.forEach(function (a) { a.classList.remove('active'); });
          map[en.target.id].classList.add('active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Object.keys(map).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) io.observe(sec);
    });
  }

  /* ── 7. copy buttons (delegated) ────────────────────────────── */

  function initCopy() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('.copy');
      if (!btn) return;
      var block = btn.closest('.codeblock') || btn.closest('.hero-term');
      if (!block) return;
      var code = block.querySelector('pre code') || block.querySelector('pre');
      var txt = code ? code.innerText : '';
      function done() {
        btn.classList.add('done');
        var old = btn.textContent;
        btn.textContent = 'copied ✓';
        setTimeout(function () { btn.classList.remove('done'); btn.textContent = old; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(function () { fallback(); });
      } else fallback();

      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  }

  /* ── 8. card spotlight follows cursor ───────────────────────── */

  function initSpotlight() {
    if (reduceMotion) return;
    document.addEventListener('mousemove', function (ev) {
      var card = ev.target.closest && ev.target.closest('.card');
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100) + '%');
      card.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100) + '%');
    });
  }

  /* ── 9. live region badge (home page) ───────────────────────── */

  function initRegionBadge() {
    var el = document.getElementById('regionBadge');
    if (!el || typeof Play === 'undefined') return;
    var flags = { US: '🇺🇸' };
    Play.region().then(function (reg) {
      if (reg.country && reg.country !== 'XX') {
        var flag = '';
        try {
          flag = String.fromCodePoint.apply(null,
            reg.country.split('').map(function (c) { return 127397 + c.charCodeAt(0); }));
        } catch (e) {}
        el.innerHTML = '<span class="dot"></span> live from <b>' + flag + ' ' +
          reg.country + '</b> · network node <b>#' + (reg.network || '???') +
          '</b> — matchmaking is ready for you';
      } else {
        el.innerHTML = '<span class="dot"></span> region hidden — you will match <b>worldwide</b>';
      }
    }).catch(function () {
      el.innerHTML = '<span class="dot"></span> region hidden — you will match <b>worldwide</b>';
    });
  }

  /* ── boot ───────────────────────────────────────────────────── */
  function boot() {
    initSnow();
    initMesh();
    initReveal();
    initTypewriter();
    initCounters();
    initScrollSpy();
    initCopy();
    initSpotlight();
    initRegionBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
