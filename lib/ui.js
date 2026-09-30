// Small helpers shared by the popup and the dashboard.
(function (root) {
  const send = (msg) => new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message }));
  });

  function relTime(ts) {
    if (!ts) return "never";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    const d = Math.round(h / 24);
    if (d < 7) return d + " d ago";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function absTime(ts) {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function everyLabel(min) {
    if (min < 60) return "every " + min + " min";
    if (min < 1440) return "every " + (min / 60) + " h";
    return "daily";
  }

  const host = (url) => { try { return new URL(url).host.replace(/^www\./, ""); } catch (e) { return url; } };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c)); });
    return el;
  }

  const STATUS = {
    ok: { label: "Watching", cls: "ok" },
    checking: { label: "Checking…", cls: "busy" },
    missing: { label: "Element missing", cls: "warn" },
    error: { label: "Can't reach page", cls: "bad" },
    permission: { label: "Needs access", cls: "bad" },
    paused: { label: "Paused", cls: "idle" },
  };
  const statusOf = (w) => (!w.enabled ? STATUS.paused : STATUS[w.status] || STATUS.ok);

  root.TW = { send, relTime, absTime, everyLabel, host, h, statusOf };
})(self);
