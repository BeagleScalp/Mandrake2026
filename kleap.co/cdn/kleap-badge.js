/**
 * "Made with Kleap" badge — behaviour layer, served from kleap.co/cdn/kleap-badge.js
 * and loaded by every published Kleap site (injected by the Astro deployer, both in
 * prerendered HTML and in the Worker's SSR responses).
 *
 * The badge markup itself is rendered server-side (a real link, readable without
 * JS). This script only decides WHERE and WHEN it is shown, so the badge keeps
 * sending traffic without sitting on top of the site:
 *   - compact on small screens;
 *   - moves out of the way of the site's own fixed UI at the bottom of the screen
 *     (bottom nav bar, chat / WhatsApp button, cookie banner): other corner first,
 *     then lifted above it, hidden only if there is no room left;
 *   - hidden while a menu / modal / drawer covers the page, while the on-screen
 *     keyboard is open, and (mobile) while the visitor scrolls DOWN — it comes back
 *     on scroll up, near the top and at the end of the page;
 *   - its styles are forced inline with !important, so site CSS cannot hide it;
 *     a fake/empty [data-kleap-badge] element gets the real link put back;
 *   - clicks are counted (user_events badge_click) so its traffic is measured.
 *
 * Served from kleap.co on purpose: tuning this file changes every site at once,
 * with no redeploy. Must stay dependency-free (ES5 + optional catch binding) and
 * never throw into the page.
 */
(function () {
  "use strict";
  if (window.__kleapBadgeSmart) return;
  window.__kleapBadgeSmart = true;

  var MOBILE_MAX = 640;
  var GAP = 8;
  var MAX_LIFT_RATIO = 0.35; // never float higher than 35% of the screen

  var script = document.currentScript;
  var scriptAppId = script && script.getAttribute("data-app");

  function appId() {
    var id = scriptAppId;
    try {
      if (!id && window._kleap && window._kleap.id)
        id = String(window._kleap.id);
    } catch {}
    return id && /^\d+$/.test(id) ? id : null;
  }

  function badgeUrl(id) {
    return (
      "https://kleap.co/made-with-kleap?utm_source=badge&utm_medium=built-with&utm_campaign=app-" +
      id +
      "&ref=" +
      id
    );
  }

  function imp(el, k, v) {
    el.style.setProperty(k, v, "important");
  }

  var hiddenForScroll = false;
  var lastY = window.pageYOffset || 0;
  var keyboardOpen = false;
  var scheduled = false;

  function isMobile() {
    return (
      (window.innerWidth || document.documentElement.clientWidth) <= MOBILE_MAX
    );
  }

  function getBadge() {
    return document.querySelector("[data-kleap-badge]");
  }

  /** Put the real link back and pin the box to <body>, whatever the site did. */
  function normalize(b) {
    if (b.parentNode !== document.body) document.body.appendChild(b);
    var a = b.querySelector('a[href*="kleap.co"]');
    var id = appId();
    if (!a || !/kleap/i.test(a.textContent || "")) {
      if (!id) return null;
      b.innerHTML =
        '<a href="' +
        badgeUrl(id) +
        '" target="_blank" rel="noopener" title="Made with Kleap" aria-label="Made with Kleap">Made with <strong>Kleap</strong></a>';
      a = b.querySelector("a");
    }
    return a;
  }

  function styleBadge(b, a) {
    var m = isMobile();
    imp(b, "position", "fixed");
    imp(b, "display", "block");
    imp(b, "visibility", "visible");
    imp(b, "z-index", "999999");
    imp(b, "top", "auto");
    imp(b, "margin", "0");
    imp(b, "padding", "0");
    imp(b, "width", "auto");
    imp(b, "height", "auto");
    imp(b, "max-width", "none");
    imp(b, "clip-path", "none");
    imp(b, "filter", "none");
    imp(
      b,
      "font-family",
      "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    );
    imp(b, "transition", "opacity .2s ease, transform .2s ease");

    imp(a, "display", "inline-flex");
    imp(a, "align-items", "center");
    imp(a, "gap", m ? "3px" : "4px");
    imp(a, "padding", m ? "4px 8px" : "8px 12px");
    imp(a, "background", "#fff");
    imp(a, "color", "#000");
    imp(a, "text-decoration", "none");
    imp(a, "font-size", m ? "11px" : "14px");
    imp(a, "line-height", m ? "16px" : "20px");
    imp(a, "font-weight", "500");
    imp(a, "border-radius", m ? "999px" : "6px");
    imp(a, "white-space", "nowrap");
    imp(a, "opacity", "1");
    imp(a, "visibility", "visible");
    imp(
      a,
      "box-shadow",
      "0 0 0 1px rgba(0,0,0,0.08),0 2px 8px rgba(0,0,0,0.12)",
    );
    var s = a.querySelector("strong");
    if (s) {
      imp(s, "color", "#ff0055");
      imp(s, "font-weight", "700");
    }
  }

  function vw() {
    return window.innerWidth || document.documentElement.clientWidth;
  }
  function vh() {
    return window.innerHeight || document.documentElement.clientHeight;
  }

  /**
   * Nearest fixed (or bottom-stuck sticky) ancestor, incl. self, that is not the
   * page itself. A sticky element only counts while it is pinned to the bottom
   * of the screen (sticky bottom bar): full-screen sticky sections used for
   * scroll storytelling are content, not UI.
   */
  function fixedLayer(el, stickyToo) {
    while (el && el !== document.body && el !== document.documentElement) {
      var cs = window.getComputedStyle(el);
      var fixed = cs.position === "fixed";
      var sticky = cs.position === "sticky";
      if (fixed || sticky) {
        if (cs.visibility === "hidden" || parseFloat(cs.opacity) === 0)
          return null;
        if (fixed) return el;
        if (stickyToo) {
          var r = el.getBoundingClientRect();
          if (r.bottom >= vh() - 2 && r.height < vh() * 0.3) return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function coverage(r) {
    var w = Math.max(0, Math.min(r.right, vw()) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.bottom, vh()) - Math.max(r.top, 0));
    return (w * h) / (vw() * vh());
  }

  /** Topmost element at (x,y) that is not the badge. */
  function topAt(b, x, y) {
    if (!document.elementsFromPoint) return null;
    var list = document.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) {
      if (!b.contains(list[i])) return list[i];
    }
    return null;
  }

  function isShown(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  var HEADERISH = 'header, nav, [role="banner"], [role="navigation"]';
  var EXPANDED_TOGGLES =
    'header [aria-expanded="true"], nav [aria-expanded="true"], [role="banner"] [aria-expanded="true"]';
  var stuckOpen = [];
  // Until the visitor acts, whatever covers the screen IS the page (full-screen
  // app shells, splash screens): only layers that appear after an action count
  // as an opened menu.
  var userActed = false;
  var baseLayers = [];

  /**
   * The point (x,y) belongs to the page's sticky/fixed header or nav (pinned to
   * the top of the screen) and that header is showing a menu: either it grew
   * over half the screen (menu opened in its flow), or the point lies below or
   * beside the header's own box (a dropdown panel hanging off it).
   */
  function headerMenuAt(el, x, y) {
    while (el && el !== document.body && el !== document.documentElement) {
      var pos = window.getComputedStyle(el).position;
      if (
        (pos === "sticky" || pos === "fixed") &&
        el.matches &&
        el.matches(HEADERISH)
      ) {
        var r = el.getBoundingClientRect();
        // Only the site's real header, pinned to the top of the screen — not a
        // sticky header drawn inside a mockup or a card further down the page.
        if (r.top <= 2) {
          if (coverage(r) >= 0.5) return true;
          if (y > r.bottom + 4 || x < r.left - 4 || x > r.right + 4)
            return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * A menu, drawer or modal is open over the page:
   *  - an open <dialog> / aria-modal;
   *  - a toggle in the header or nav reports aria-expanded="true" (burger
   *    buttons; FAQ accordions live in the content and are not counted);
   *  - the middle of the screen belongs to a position:fixed layer (nothing
   *    fixed lives there on a page at rest; an open mobile menu, a dropdown
   *    hanging off a fixed header, a lightbox, an expanded chat panel all do);
   *  - or to a sticky/fixed header or nav showing a menu (see headerMenuAt).
   */
  function overlayOpen(b) {
    var open = document.querySelector(
      'dialog[open], [aria-modal="true"]:not([aria-hidden="true"])',
    );
    if (open && isShown(open)) return true;
    var toggles = document.querySelectorAll(EXPANDED_TOGGLES);
    for (var t = 0; t < toggles.length; t++) {
      // Ignore toggles already "open" at load: some sites leave
      // aria-expanded="true" on for good, and that must not hide the badge forever.
      if (stuckOpen.indexOf(toggles[t]) === -1 && isShown(toggles[t]))
        return true;
    }
    var pts = [
      [0.5, 0.5],
      [0.5, 0.7],
    ];
    for (var i = 0; i < pts.length; i++) {
      var x = vw() * pts[i][0];
      var y = vh() * pts[i][1];
      var el = topAt(b, x, y);
      if (!el) continue;
      var layer = fixedLayer(el, false);
      if (layer && !userActed && baseLayers.indexOf(layer) === -1) {
        baseLayers.push(layer);
      }
      if (layer && baseLayers.indexOf(layer) === -1) return true;
      if (headerMenuAt(el, x, y)) return true;
    }
    return false;
  }

  /**
   * Fixed UI of the site under a candidate badge box (bottom nav, chat button,
   * cookie banner). Returns the highest top edge among them, or null when the
   * box is free. Screen-sized layers (backgrounds) are ignored.
   */
  function obstacleTop(b, left, bottom, w, h) {
    var top = vh() - bottom - h;
    var pts = [
      [left + 2, top + 2],
      [left + w - 2, top + 2],
      [left + 2, top + h - 2],
      [left + w - 2, top + h - 2],
      [left + w / 2, top + h / 2],
    ];
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var el = topAt(b, pts[i][0], pts[i][1]);
      var layer = el && fixedLayer(el, true);
      if (!layer) continue;
      var r = layer.getBoundingClientRect();
      if (coverage(r) >= 0.6) continue;
      if (best === null || r.top < best) best = r.top;
    }
    return best;
  }

  function setVisible(b, on) {
    imp(b, "opacity", on ? "1" : "0");
    imp(b, "pointer-events", on ? "auto" : "none");
    imp(b, "transform", on ? "none" : "translateY(140%)");
  }

  function evaluate() {
    scheduled = false;
    try {
      if (window._kleap && window._kleap.badge === false) return;
      var b = getBadge();
      if (!b) return;
      var a = normalize(b);
      if (!a) return;
      styleBadge(b, a);

      var m = isMobile();
      var edge = m ? 12 : 20;
      var r = a.getBoundingClientRect();
      var w = r.width || 120;
      var h = r.height || 28;

      if (keyboardOpen || (m && hiddenForScroll) || overlayOpen(b)) {
        setVisible(b, false);
        return;
      }

      // Bottom-right first, then bottom-left, then lifted above the obstacle.
      var side = "right";
      var bottom = edge;
      var hitRight = obstacleTop(b, vw() - edge - w, edge, w, h);
      if (hitRight !== null) {
        var hitLeft = obstacleTop(b, edge, edge, w, h);
        if (hitLeft === null) {
          side = "left";
        } else {
          bottom = vh() - hitRight + GAP;
          if (bottom + h > vh() * MAX_LIFT_RATIO) {
            setVisible(b, false);
            return;
          }
          // The lifted spot may itself be taken (stacked buttons): give up there.
          if (obstacleTop(b, vw() - edge - w, bottom, w, h) !== null) {
            setVisible(b, false);
            return;
          }
        }
      }
      imp(
        b,
        "bottom",
        "calc(" + bottom + "px + env(safe-area-inset-bottom, 0px))",
      );
      imp(b, side, edge + "px");
      imp(b, side === "right" ? "left" : "right", "auto");
      setVisible(b, true);
    } catch {
      /* never break the host page */
    }
  }

  function schedule(delay) {
    if (delay) {
      setTimeout(schedule, delay);
      return;
    }
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(evaluate);
  }

  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var dy = y - lastY;
    var nearTop = y < 80;
    var nearEnd =
      y + vh() >= (document.documentElement.scrollHeight || 0) - 120;
    var was = hiddenForScroll;
    if (nearTop || nearEnd) hiddenForScroll = false;
    else if (dy > 6) hiddenForScroll = true;
    else if (dy < -6) hiddenForScroll = false;
    if (Math.abs(dy) > 6 || nearTop || nearEnd) lastY = y;
    if (was !== hiddenForScroll) schedule();
  }

  function isTextField(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var t = (el.tagName || "").toLowerCase();
    if (t === "textarea" || t === "select") return true;
    if (t !== "input") return false;
    var type = (el.getAttribute("type") || "text").toLowerCase();
    return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/.test(
      type,
    );
  }

  /**
   * Count badge clicks (POST kleap.co/api/track-badge-click → user_events
   * badge_click). Astro sites never sent them: the only tracker lived in the
   * legacy Next.js badge, so the traffic the badge brings was unmeasured.
   * sendBeacon with a string body = text/plain, no CORS preflight; it survives
   * the navigation the click starts.
   */
  function trackClick(e) {
    try {
      var b = getBadge();
      var t = e && e.target;
      if (!b || !t || !b.contains(t)) return;
      var id = appId();
      if (!id) return;
      var payload = JSON.stringify({
        appId: id,
        timestamp: Date.now(),
        referrer: location.href,
      });
      var url = "https://kleap.co/api/track-badge-click";
      if (navigator.sendBeacon && navigator.sendBeacon(url, payload)) return;
      fetch(url, {
        method: "POST",
        body: payload,
        keepalive: true,
        mode: "no-cors",
        credentials: "omit",
      });
    } catch {}
  }

  function start() {
    document.addEventListener("click", trackClick, true);
    document.addEventListener("auxclick", trackClick, true);
    try {
      stuckOpen = Array.prototype.slice.call(
        document.querySelectorAll(EXPANDED_TOGGLES),
      );
    } catch {}
    evaluate();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
      schedule();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        schedule();
      });
    }
    var acted = function () {
      userActed = true;
    };
    document.addEventListener("pointerdown", acted, true);
    document.addEventListener("keydown", acted, true);
    document.addEventListener("touchstart", acted, {
      capture: true,
      passive: true,
    });
    document.addEventListener("focusin", function (e) {
      if (isMobile() && isTextField(e.target)) {
        keyboardOpen = true;
        schedule();
      }
    });
    document.addEventListener("focusout", function () {
      keyboardOpen = false;
      schedule(120);
    });
    // Menus open on click and usually animate in: look again right after and
    // once the animation is done.
    document.addEventListener(
      "click",
      function () {
        schedule(60);
        schedule(400);
      },
      true,
    );
    document.addEventListener("transitionend", function (e) {
      if (!getBadge() || !getBadge().contains(e.target)) schedule();
    });
    if (window.MutationObserver) {
      var pending = null;
      new MutationObserver(function (records) {
        var b = getBadge();
        for (var i = 0; i < records.length; i++) {
          if (!b || !b.contains(records[i].target)) {
            if (!pending)
              pending = setTimeout(function () {
                pending = null;
                schedule();
              }, 150);
            return;
          }
        }
      }).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "open", "hidden", "aria-expanded"],
      });
    }
    // Late widgets (chat bubbles, cookie banners) mount after load.
    schedule(1500);
    schedule(4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
