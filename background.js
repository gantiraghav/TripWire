// Tripwire service worker: schedules checks, fetches pages, diffs, notifies.
importScripts("lib/extract.js", "lib/diff.js");
const T = self.Tripwire;

const HISTORY_CAP = 25;
const TEXT_CAP = 200000;
const RENDER_TIMEOUT_MS = 30000;
const FAIL_NOTIFY_AFTER = 3;

// ---------------------------------------------------------------- storage
// All writes go through one queue so overlapping checks can't clobber each other.
let queue = Promise.resolve();
function withStore(fn) {
  const run = queue.then(async () => {
    const { watches = {} } = await chrome.storage.local.get("watches");
    const result = await fn(watches);
    await chrome.storage.local.set({ watches });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
async function getWatches() {
  const { watches = {} } = await chrome.storage.local.get("watches");
  return watches;
}
const patch = (id, fields) => withStore((ws) => { if (ws[id]) Object.assign(ws[id], fields); return ws[id]; });

const originOf = (url) => { try { return new URL(url).origin + "/*"; } catch (e) { return null; } };
const hasHostPermission = (url) => chrome.permissions.contains({ origins: [originOf(url)] });

// ---------------------------------------------------------------- alarms
const alarmName = (id) => "w:" + id;
async function syncAlarms() {
  const ws = await getWatches();
  const alarms = await chrome.alarms.getAll();
  const have = new Map(alarms.map((a) => [a.name, a]));
  for (const w of Object.values(ws)) {
    const name = alarmName(w.id), a = have.get(name);
    if (!w.enabled) { if (a) await chrome.alarms.clear(name); continue; }
    if (!a || a.periodInMinutes !== w.interval) {
      await chrome.alarms.create(name, { delayInMinutes: Math.min(1, w.interval), periodInMinutes: w.interval });
    }
    have.delete(name);
  }
  for (const name of have.keys()) if (name.startsWith("w:")) await chrome.alarms.clear(name);
}
chrome.runtime.onInstalled.addListener(() => { syncAlarms(); updateBadge(); });
chrome.runtime.onStartup.addListener(() => { syncAlarms(); updateBadge(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name.startsWith("w:")) checkWatch(a.name.slice(2)); });

// ---------------------------------------------------------------- extraction: fast mode
// Service workers have no DOMParser, so parsing happens in an offscreen document.
let offscreenReady = null;
function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      if (existing.length) return;
      await chrome.offscreen.createDocument({
        url: "offscreen.html", reasons: ["DOM_PARSER"],
        justification: "Parse fetched HTML to read the watched element's text.",
      });
    })().catch((e) => { offscreenReady = null; throw e; });
  }
  return offscreenReady;
}

async function fetchExtract(url, selector) {
  const res = await fetch(url, { credentials: "include", cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const type = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!/html|xml/i.test(type) && !/^\s*</.test(body)) {
    return { found: true, text: T.normalize(body).slice(0, TEXT_CAP) };
  }
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: "offscreen", type: "extract", html: body, selector });
  if (!r || r.error) throw new Error(r ? r.error : "Parser did not respond");
  return r;
}

// ---------------------------------------------------------------- extraction: full render mode
// For pages that build their content with JavaScript (Workday, Canvas, most SPAs)
// the element only exists after the page runs, so load it in a background tab.
async function renderExtract(url, selector) {
  const tab = await chrome.tabs.create({ url, active: false, pinned: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Page took too long to load")); }, RENDER_TIMEOUT_MS);
      const onUpd = (id, info) => { if (id === tab.id && info.status === "complete") { cleanup(); resolve(); } };
      const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpd); };
      chrome.tabs.onUpdated.addListener(onUpd);
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/extract.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [selector],
      func: async (sel) => {
        // wait for the element to appear and for its text to stop changing
        const pick = () => (sel ? document.querySelector(sel) : document.body);
        const deadline = Date.now() + 10000;
        let last = null, stableSince = 0;
        await new Promise((r) => setTimeout(r, 1200));
        while (Date.now() < deadline) {
          const el = pick();
          const txt = el ? self.Tripwire.extractText(el) : null;
          if (txt && txt === last) { if (Date.now() - stableSince > 1200) return { found: true, text: txt, title: document.title }; }
          else { last = txt; stableSince = Date.now(); }
          await new Promise((r) => setTimeout(r, 300));
        }
        return last ? { found: true, text: last, title: document.title } : { found: false, title: document.title };
      },
    });
    if (result && result.text) result.text = result.text.slice(0, TEXT_CAP);
    return result || { found: false };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const extract = (w) => (w.mode === "render" ? renderExtract(w.url, w.selector) : fetchExtract(w.url, w.selector));

// ---------------------------------------------------------------- the check
const inFlight = new Set();

// Keep long unchanged stretches out of storage: only context around edits is kept.
function compactOps(ops) {
  const CTX = 90;
  return ops.map((o, i) => {
    if (o.t !== "=" || o.s.length <= CTX * 2 + 20) return [o];
    const first = i === 0, last = i === ops.length - 1;
    if (first) return [{ t: "~", n: o.s.length - CTX }, { t: "=", s: o.s.slice(-CTX) }];
    if (last) return [{ t: "=", s: o.s.slice(0, CTX) }, { t: "~", n: o.s.length - CTX }];
    return [{ t: "=", s: o.s.slice(0, CTX) }, { t: "~", n: o.s.length - CTX * 2 }, { t: "=", s: o.s.slice(-CTX) }];
  }).flat();
}

function conditionMet(cond, oldText, newText) {
  if (!cond || cond.type === "any" || !cond.value) return true;
  const v = cond.value.toLowerCase();
  const had = oldText.toLowerCase().includes(v), has = newText.toLowerCase().includes(v);
  if (cond.type === "appears") return !had && has;
  if (cond.type === "disappears") return had && !has;
  return true;
}

async function checkWatch(id, opts = {}) {
  if (inFlight.has(id)) return { busy: true };
  const w = (await getWatches())[id];
  if (!w || (!w.enabled && !opts.manual)) return { skipped: true };
  inFlight.add(id);
  await patch(id, { status: "checking" });
  try {
    if (!(await hasHostPermission(w.url))) {
      await patch(id, { status: "permission", error: "Tripwire lost access to this site. Re-add the watch to grant it again.", lastChecked: Date.now() });
      return { error: "permission" };
    }
    const r = await extract(w);
    const now = Date.now();
    if (!r.found) {
      const wasMissing = w.status === "missing";
      await patch(id, { status: "missing", error: "The watched element is no longer on the page.", lastChecked: now, failures: 0 });
      if (!wasMissing) notify(w, "Element disappeared", "The part of the page you picked can't be found anymore. The layout may have changed.");
      return { missing: true };
    }
    const oldCmp = T.applyIgnore(w.lastText || "", w.ignore);
    const newCmp = T.applyIgnore(r.text, w.ignore);
    if (oldCmp === newCmp) {
      await patch(id, { status: "ok", error: null, lastChecked: now, failures: 0, lastText: r.text });
      return { changed: false };
    }
    const ops = T.diff(w.lastText || "", r.text);
    const summary = T.summarize(ops);
    const alert = conditionMet(w.condition, w.lastText || "", r.text);
    const entry = { at: now, ops: compactOps(ops), summary, alerted: alert };
    const updated = await withStore((ws) => {
      const x = ws[id]; if (!x) return null;
      x.history = [entry, ...(x.history || [])].slice(0, HISTORY_CAP);
      Object.assign(x, { lastText: r.text, lastChecked: now, lastChanged: now, status: "ok", error: null, failures: 0,
        changes: (x.changes || 0) + 1, unseen: (x.unseen || 0) + (alert ? 1 : 0) });
      return x;
    });
    if (alert && updated) {
      const counts = (summary.added ? "+" + summary.added : "") + (summary.removed ? " −" + summary.removed : "");
      notify(updated, updated.label + " changed", summary.headline || "The watched text changed.", counts.trim() + " words");
      updateBadge();
    }
    return { changed: true, summary };
  } catch (e) {
    const w2 = await withStore((ws) => {
      const x = ws[id]; if (!x) return null;
      x.failures = (x.failures || 0) + 1;
      Object.assign(x, { status: "error", error: String(e.message || e), lastChecked: Date.now() });
      return x;
    });
    if (w2 && w2.failures === FAIL_NOTIFY_AFTER) notify(w2, "Can't check " + w2.label, w2.error);
    return { error: String(e.message || e) };
  } finally {
    inFlight.delete(id);
  }
}

// ---------------------------------------------------------------- notifications + badge
function notify(w, title, message, context) {
  const host = (() => { try { return new URL(w.url).host; } catch (e) { return ""; } })();
  chrome.notifications.create("n:" + w.id + ":" + Date.now(), {
    type: "basic", iconUrl: "icons/128.png", title, message: message || "",
    contextMessage: [host, context].filter(Boolean).join(" · "), priority: 1,
  });
}

async function updateBadge() {
  const ws = await getWatches();
  const n = Object.values(ws).reduce((a, w) => a + (w.unseen || 0), 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#E8A200" });
  await chrome.action.setBadgeTextColor?.({ color: "#16181D" });
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : "" });
}

chrome.notifications.onClicked.addListener(async (nid) => {
  chrome.notifications.clear(nid);
  const id = nid.split(":")[1];
  const w = (await getWatches())[id];
  if (!w) return;
  await openAndHighlight(w);
});

async function openAndHighlight(w) {
  const tab = await chrome.tabs.create({ url: w.url, active: true });
  await markSeen(w.id);
  const onUpd = async (tid, info) => {
    if (tid !== tab.id || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpd);
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/render-diff.js", "highlight.js"] });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, args: [w.selector, w.label, (w.history || [])[0] || null],
        func: (sel, label, entry) => self.TripwireHighlight && self.TripwireHighlight(sel, label, entry),
      });
    } catch (e) { /* page may block scripting (e.g. chrome web store) */ }
  };
  chrome.tabs.onUpdated.addListener(onUpd);
}

async function markSeen(id) {
  await withStore((ws) => { if (id) { if (ws[id]) ws[id].unseen = 0; } else Object.values(ws).forEach((w) => (w.unseen = 0)); });
  updateBadge();
}

// ---------------------------------------------------------------- creating a watch
async function addWatch(p) {
  const id = crypto.randomUUID().slice(0, 8);
  const live = T.normalize(p.text || "");
  // Pick the cheapest mode that sees the same thing the user sees.
  let mode = "render", baseline = live, probe = null;
  try {
    probe = await fetchExtract(p.url, p.selector);
    if (probe.found) {
      const a = T.applyIgnore(live, p.ignore), b = T.applyIgnore(probe.text, p.ignore);
      const sim = a === b ? 1 : T.similarity(T.diff(a, b));
      if (sim >= 0.9 && b.length > 0) { mode = "fetch"; baseline = probe.text; }
    }
  } catch (e) { /* fetch blocked or failed: use render mode */ }
  const w = {
    id, url: p.url, title: p.title || "", label: (p.label || p.title || new URL(p.url).host).slice(0, 80),
    selector: p.selector || null, mode, interval: Math.max(1, Number(p.interval) || 30),
    condition: p.condition || { type: "any", value: "" }, ignore: p.ignore || "",
    enabled: true, created: Date.now(), lastChecked: Date.now(), lastChanged: null,
    lastText: baseline.slice(0, TEXT_CAP), status: "ok", error: null, unseen: 0, changes: 0, failures: 0, history: [],
  };
  await withStore((ws) => { ws[id] = w; });
  await syncAlarms();
  return w;
}

// ---------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target === "offscreen") return false;
  const handlers = {
    addWatch: () => addWatch(msg.watch),
    checkNow: () => checkWatch(msg.id, { manual: true }),
    checkAll: async () => { const ws = await getWatches(); return Promise.all(Object.keys(ws).map((id) => checkWatch(id, { manual: true }))); },
    updateWatch: async () => {
      const allowed = ["label", "interval", "condition", "ignore", "enabled", "mode"];
      const f = {}; allowed.forEach((k) => { if (k in msg.fields) f[k] = msg.fields[k]; });
      if ("interval" in f) f.interval = Math.max(1, Number(f.interval) || 30);
      const w = await patch(msg.id, f); await syncAlarms(); return w;
    },
    deleteWatch: async () => { await withStore((ws) => { delete ws[msg.id]; }); await syncAlarms(); updateBadge(); return true; },
    markSeen: () => markSeen(msg.id),
    openDashboard: () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + (msg.id ? "#" + msg.id : "") }),
    open: async () => { const w = (await getWatches())[msg.id]; if (w) await openAndHighlight(w); return true; },
  };
  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve().then(h).then((r) => reply({ ok: true, result: r }), (e) => reply({ ok: false, error: String(e.message || e) }));
  return true;
});
