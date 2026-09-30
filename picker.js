// In-page element picker and "new watch" panel. Injected on demand from the popup.
// Everything lives inside a shadow root so page CSS can't reach it (and vice versa).
(function () {
  if (self.TripwirePicker) return;

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root {
      --bg: #FFFFFF; --bg2: #F4F4F0; --ink: #16181D; --ink2: #5A5F6B; --line: #E1E1DA;
      --accent: #E8A200; --accent-ink: #16181D; --focus: #2F6FEB;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      color: var(--ink);
    }
    @media (prefers-color-scheme: dark) {
      .root { --bg: #1A1D23; --bg2: #22262E; --ink: #ECEDEF; --ink2: #9AA0AB; --line: #30343D; --accent: #F2B418; }
    }
    .box {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px solid var(--accent); background: rgba(232,162,0,.10);
      border-radius: 3px; transition: all .06s linear;
      box-shadow: 0 0 0 1px rgba(22,24,29,.35), 0 0 0 9999px rgba(22,24,29,.12);
    }
    .box.locked { box-shadow: 0 0 0 1px rgba(22,24,29,.35), 0 0 0 9999px rgba(22,24,29,.28); }
    .tag {
      position: fixed; pointer-events: none; z-index: 2147483647;
      background: var(--ink); color: var(--bg); font: 11px/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      padding: 4px 6px; border-radius: 3px; max-width: 420px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bar {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      display: flex; gap: 14px; align-items: center; padding: 8px 8px 8px 14px;
      background: var(--ink); color: var(--bg); border-radius: 999px; box-shadow: 0 8px 28px rgba(0,0,0,.28);
      font-size: 12.5px; white-space: nowrap; pointer-events: auto;
    }
    .bar b { color: var(--accent); font-weight: 600; }
    kbd { font: 600 10.5px ui-monospace, Menlo, monospace; padding: 1px 5px; border-radius: 3px; border: 1px solid rgba(255,255,255,.3); }
    .bar button { background: transparent; color: var(--bg); border: 1px solid rgba(255,255,255,.3); }
    .panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 348px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px); overflow: auto;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 18px 50px rgba(0,0,0,.28); pointer-events: auto;
    }
    .wire { height: 3px; background: var(--accent); border-radius: 10px 10px 0 0; }
    .inner { padding: 14px 16px 16px; display: grid; gap: 12px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .title { font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
    .brand { font-size: 11px; color: var(--ink2); display: flex; align-items: center; gap: 6px; }
    .brand i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); display: inline-block; }
    code.sel { display: block; font: 11px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: var(--ink2);
      background: var(--bg2); padding: 6px 8px; border-radius: 5px; overflow-wrap: anywhere; }
    .preview { background: var(--bg2); border-radius: 6px; padding: 8px 10px; max-height: 112px; overflow: auto;
      white-space: pre-wrap; font-size: 12px; color: var(--ink); }
    .meta { font-size: 11px; color: var(--ink2); }
    .warn { font-size: 12px; color: #B4530A; }
    label { display: grid; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--ink2); }
    input, select {
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--ink);
      background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; width: 100%;
    }
    input:focus, select:focus, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    details summary { cursor: pointer; font-size: 12px; color: var(--ink2); }
    details[open] summary { margin-bottom: 8px; }
    .hint { font-size: 11px; font-weight: 400; color: var(--ink2); }
    .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    button {
      font: 600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; cursor: pointer;
      border-radius: 6px; padding: 7px 12px; border: 1px solid var(--line); background: var(--bg); color: var(--ink);
    }
    button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    button:disabled { opacity: .6; cursor: default; }
    button.link { border: 0; background: none; padding: 0; color: var(--ink2); text-decoration: underline; font-weight: 500; }
    .done { display: grid; gap: 6px; }
    .done .big { font-size: 15px; font-weight: 650; }
    .chip { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--bg2); color: var(--ink2); }
  `;

  let host, shadow, rootEl, box, tag, bar, panel;
  let current = null, downStack = [], picking = false, lockedEl = null, rafId = 0;

  function mount() {
    host = document.createElement("tripwire-picker");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = CSS_TEXT;
    rootEl = document.createElement("div"); rootEl.className = "root";
    shadow.append(style, rootEl);
    document.documentElement.appendChild(host);
  }

  function el(tagName, cls, text) {
    const e = document.createElement(tagName);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function drawBox(target) {
    if (!target) { box.style.display = "none"; tag.style.display = "none"; return; }
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left - 2 + "px", top: r.top - 2 + "px", width: r.width + 4 + "px", height: r.height + 4 + "px" });
    if (!picking) { tag.style.display = "none"; return; }
    tag.style.display = "block";
    tag.textContent = describe(target) + "  ·  " + Math.round(r.width) + "×" + Math.round(r.height);
    const ty = r.top > 28 ? r.top - 26 : Math.min(r.bottom + 6, innerHeight - 24);
    Object.assign(tag.style, { left: Math.max(4, Math.min(r.left, innerWidth - 300)) + "px", top: ty + "px" });
  }

  function describe(e) {
    let s = e.tagName.toLowerCase();
    if (e.id) s += "#" + e.id;
    const cls = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    return s;
  }

  const isOurs = (t) => t === host || (t && host.contains(t));

  // ---------------------------------------------------------------- picking
  function onMove(e) {
    if (!picking) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || isOurs(t) || t === current) return;
    current = t; downStack = [];
    drawBox(current);
  }
  function swallow(e) {
    if (!picking || isOurs(e.target) || (e.composedPath && e.composedPath().includes(host))) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  }
  function onClick(e) {
    if (!picking || (e.composedPath && e.composedPath().includes(host))) return;
    swallow(e);
    if (current) choose(current);
  }
  function onKey(e) {
    const inPanel = e.composedPath && e.composedPath().includes(host);
    if (inPanel && e.key !== "Escape") { e.stopPropagation(); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); teardown(); return; }
    if (!picking || !current) return;
    if (e.key === "ArrowUp") {
      e.preventDefault(); e.stopPropagation();
      if (current.parentElement && current.parentElement !== document.documentElement) { downStack.push(current); current = current.parentElement; drawBox(current); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault(); e.stopPropagation();
      const next = downStack.pop() || current.firstElementChild;
      if (next) { current = next; drawBox(current); }
    } else if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation(); choose(current);
    }
  }
  function track() {
    drawBox(lockedEl || current);
    rafId = requestAnimationFrame(track);
  }

  function startPicking() {
    picking = true; lockedEl = null; current = null;
    box.classList.remove("locked");
    bar.hidden = false;
    if (panel) { panel.remove(); panel = null; }
  }

  function choose(target) {
    picking = false; lockedEl = target;
    box.classList.add("locked");
    bar.hidden = true;
    showPanel(target);
  }

  // ---------------------------------------------------------------- panel
  function field(labelText, control, hint) {
    const l = el("label"); l.append(labelText, control);
    if (hint) l.append(el("span", "hint", hint));
    return l;
  }
  function select(opts, value) {
    const s = el("select");
    opts.forEach(([v, t]) => { const o = el("option", null, t); o.value = v; if (String(v) === String(value)) o.selected = true; s.append(o); });
    return s;
  }

  function showPanel(target) {
    const whole = !target;
    const text = self.Tripwire.extractText(whole ? document.body : target);
    const selector = whole ? null : self.Tripwire.cssPath(target);
    const words = (text.match(/\S+/g) || []).length;

    panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "New Tripwire watch");
    const inner = el("div", "inner");
    panel.append(el("div", "wire"), inner);

    const head = el("div", "head");
    const t = el("div", "title", whole ? "Watch this whole page" : "Watch this part of the page");
    const brand = el("div", "brand"); brand.append(el("i"), "Tripwire");
    head.append(t, brand);
    inner.append(head);

    if (selector) inner.append(Object.assign(el("code", "sel"), { textContent: selector }));
    const pv = el("div", "preview", text.slice(0, 600) + (text.length > 600 ? "…" : ""));
    inner.append(pv, el("div", "meta", words.toLocaleString() + " words right now. You'll be told when any of this changes."));
    if (!text) inner.append(el("div", "warn", "This element has no text to watch. Press Back and pick a larger area, or press ↑ while hovering."));

    const firstLine = (text.split("\n")[0] || "").slice(0, 50);
    const name = el("input"); name.value = (document.title || firstLine || location.host).slice(0, 70); name.maxLength = 80;
    const every = select([[5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"]], 30);
    const when = select([["any", "Any change"], ["appears", "This text appears"], ["disappears", "This text disappears"]], "any");
    const whenVal = el("input"); whenVal.placeholder = "e.g. Open, In stock, Apply"; whenVal.hidden = true;
    when.addEventListener("change", () => { whenVal.hidden = when.value === "any"; if (!whenVal.hidden) whenVal.focus(); });
    const ignore = el("input"); ignore.placeholder = "e.g. \\d+ (minutes|hours) ago";
    const ignoreNums = el("button", "link", "Ignore all numbers"); ignoreNums.type = "button";
    ignoreNums.addEventListener("click", () => { ignore.value = "\\d[\\d,.:]*"; });

    inner.append(field("Name", name));
    const row = el("div", "row"); row.append(field("Check every", every), field("Notify me when", when));
    inner.append(row, whenVal);
    const adv = el("details"); adv.append(el("summary", null, "Ignore noisy text"));
    adv.append(field("Ignore text matching (regular expression)", ignore, "Matches are removed before comparing. Useful for timestamps, view counts and ads."));
    adv.append(ignoreNums);
    inner.append(adv);

    const actions = el("div", "actions");
    const back = el("button", null, "Back"); back.type = "button";
    const cancel = el("button", null, "Cancel"); cancel.type = "button";
    const save = el("button", "primary", "Start watching"); save.type = "button";
    if (whole) back.hidden = true;
    actions.append(cancel, back, save);
    inner.append(actions);
    rootEl.append(panel);
    name.focus(); name.select();

    back.addEventListener("click", startPicking);
    cancel.addEventListener("click", teardown);
    save.addEventListener("click", async () => {
      if (ignore.value) { try { new RegExp(ignore.value); } catch (e) { ignore.setCustomValidity("Not a valid pattern"); ignore.reportValidity(); return; } }
      if (when.value !== "any" && !whenVal.value.trim()) { whenVal.focus(); return; }
      save.disabled = true; back.disabled = true; save.textContent = "Setting up…";
      const payload = {
        url: location.href, title: document.title, label: name.value.trim(), selector, text,
        interval: Number(every.value), condition: { type: when.value, value: whenVal.value.trim() }, ignore: ignore.value,
      };
      const r = await chrome.runtime.sendMessage({ type: "addWatch", watch: payload });
      if (!r || !r.ok) { save.disabled = false; back.disabled = false; save.textContent = "Try again"; inner.append(el("div", "warn", (r && r.error) || "Couldn't save the watch.")); return; }
      showDone(inner, r.result);
    });
  }

  function showDone(inner, w) {
    inner.textContent = "";
    const d = el("div", "done");
    d.append(el("div", "big", "Watching “" + w.label + "”"));
    const every = w.interval < 60 ? w.interval + " min" : w.interval < 1440 ? w.interval / 60 + " h" : "day";
    d.append(el("div", "meta", "Checks every " + every + ". You'll get a desktop notification with exactly what changed."));
    const chip = el("span", "chip", w.mode === "fetch" ? "Fast check: reads the page quietly" : "Full render: this site builds its content with JavaScript, so it loads in a background tab");
    d.append(chip);
    const actions = el("div", "actions");
    const dash = el("button", null, "Open dashboard"); dash.type = "button";
    dash.addEventListener("click", () => { chrome.runtime.sendMessage({ type: "openDashboard", id: w.id }); teardown(); });
    const ok = el("button", "primary", "Done"); ok.type = "button";
    ok.addEventListener("click", teardown);
    actions.append(dash, ok);
    inner.append(d, actions);
    ok.focus();
    setTimeout(() => { if (host && host.isConnected && !panel.matches(":hover")) teardown(); }, 9000);
  }

  // ---------------------------------------------------------------- lifecycle
  function teardown() {
    picking = false;
    cancelAnimationFrame(rafId);
    ["mousemove"].forEach((t) => document.removeEventListener(t, onMove, true));
    ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu"].forEach((t) => document.removeEventListener(t, swallow, true));
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (host) host.remove();
    host = null; panel = null; self.TripwirePicker.active = false;
  }

  function start(opts) {
    if (self.TripwirePicker.active) return;
    self.TripwirePicker.active = true;
    mount();
    box = el("div", "box"); box.style.display = "none";
    tag = el("div", "tag"); tag.style.display = "none";
    bar = el("div", "bar");
    const msg = el("span"); msg.innerHTML = "<b>Tripwire</b>&nbsp; Click what to watch &nbsp;·&nbsp; <kbd>↑</kbd> bigger &nbsp;<kbd>↓</kbd> smaller &nbsp;·&nbsp; <kbd>Esc</kbd> cancel";
    const x = el("button", null, "Cancel"); x.type = "button"; x.addEventListener("click", teardown);
    bar.append(msg, x);
    rootEl.append(box, tag, bar);
    document.addEventListener("mousemove", onMove, true);
    ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu"].forEach((t) => document.addEventListener(t, swallow, true));
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    track();
    if (opts && opts.whole) { bar.hidden = true; picking = false; showPanel(null); }
    else startPicking();
  }

  self.TripwirePicker = { start, active: false };
})();
