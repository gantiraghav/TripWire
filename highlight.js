// Opened from a notification: scroll to the watched element, outline it,
// and show what changed in a small card.
(function () {
  if (self.TripwireHighlight) return;

  const CSS_TEXT = `
    :host { all: initial; }
    .root {
      --bg: #FFFFFF; --bg2: #F4F4F0; --ink: #16181D; --ink2: #5A5F6B; --line: #E1E1DA; --accent: #E8A200;
      --ins-bg: #DDF3E4; --ins: #0F6B34; --del-bg: #FBE1DE; --del: #A3261B;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; color: var(--ink);
    }
    @media (prefers-color-scheme: dark) {
      .root { --bg: #1A1D23; --bg2: #22262E; --ink: #ECEDEF; --ink2: #9AA0AB; --line: #30343D; --accent: #F2B418;
        --ins-bg: rgba(46,160,90,.22); --ins: #7EE2A4; --del-bg: rgba(220,70,60,.22); --del: #FF9A8F; }
    }
    .ring { position: fixed; pointer-events: none; border: 3px solid var(--accent); border-radius: 4px;
      animation: pulse 1.1s ease-out 3; box-shadow: 0 0 0 1px rgba(22,24,29,.4); }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(232,162,0,.55); } 100% { box-shadow: 0 0 0 18px rgba(232,162,0,0); } }
    @media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
    .card { position: fixed; top: 16px; right: 16px; width: 360px; max-width: calc(100vw - 32px); max-height: 60vh; overflow: auto;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.28); pointer-events: auto; }
    .wire { height: 3px; background: var(--accent); }
    .inner { padding: 12px 14px 14px; display: grid; gap: 8px; }
    .head { display: flex; justify-content: space-between; align-items: start; gap: 10px; }
    .k { font-size: 11px; color: var(--ink2); }
    .t { font-size: 14px; font-weight: 650; }
    .diff { background: var(--bg2); border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; font-size: 12.5px; overflow-wrap: anywhere; }
    ins { background: var(--ins-bg); color: var(--ins); text-decoration: none; border-radius: 2px; padding: 0 1px; }
    del { background: var(--del-bg); color: var(--del); border-radius: 2px; padding: 0 1px; }
    del + ins { margin-left: 3px; }
    .tw-gap { display: block; color: var(--ink2); font-size: 11px; margin: 4px 0; }
    button { font: 600 12px -apple-system, system-ui, sans-serif; background: none; border: 1px solid var(--line); color: var(--ink);
      border-radius: 6px; padding: 4px 9px; cursor: pointer; }
    .missing { font-size: 12px; color: #B4530A; }
  `;

  function waitFor(sel, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        const el = sel ? document.querySelector(sel) : document.body;
        if (el || Date.now() - t0 > ms) return resolve(el);
        setTimeout(poll, 250);
      })();
    });
  }

  self.TripwireHighlight = async function (selector, label, entry) {
    const target = await waitFor(selector, 8000);
    const host = document.createElement("tripwire-highlight");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = CSS_TEXT;
    const root = document.createElement("div"); root.className = "root";
    shadow.append(style, root);
    document.documentElement.appendChild(host);

    let raf = 0;
    if (target && selector) {
      target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      const ring = document.createElement("div"); ring.className = "ring"; root.append(ring);
      const follow = () => {
        const r = target.getBoundingClientRect();
        Object.assign(ring.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
        raf = requestAnimationFrame(follow);
      };
      follow();
    }

    const card = document.createElement("div"); card.className = "card";
    card.innerHTML = '<div class="wire"></div><div class="inner"><div class="head"><div><div class="k">Tripwire</div><div class="t"></div></div><button type="button">Close</button></div></div>';
    card.querySelector(".t").textContent = label + (entry ? " changed" : "");
    const inner = card.querySelector(".inner");
    if (entry) {
      const when = document.createElement("div"); when.className = "k";
      when.textContent = new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const d = document.createElement("div"); d.className = "diff";
      d.append(self.Tripwire.renderDiff(entry.ops, document));
      inner.append(when, d);
    }
    if (!target && selector) {
      const m = document.createElement("div"); m.className = "missing";
      m.textContent = "The watched element isn't on the page right now.";
      inner.append(m);
    }
    root.append(card);
    const close = () => { cancelAnimationFrame(raf); host.remove(); };
    card.querySelector("button").addEventListener("click", close);
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc, true); } }, true);
  };
})();
