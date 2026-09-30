const { send, relTime, host, h, statusOf } = self.TW;
const $ = (id) => document.getElementById(id);
const samePage = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.origin + x.pathname + x.search === y.origin + y.pathname + y.search; } catch (e) { return false; } };

let tab = null;

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const web = tab && /^https?:/.test(tab.url || "");
  $("p-title").textContent = web ? (tab.title || tab.url) : "Not a web page";
  $("p-host").textContent = web ? host(tab.url) : "";
  if (!web) {
    $("p-btns").hidden = true;
    note("Tripwire can watch regular websites. Open one, then click the toolbar icon again.");
  }
  render();
}

function note(text, isErr) {
  const n = $("p-note"); n.hidden = false; n.textContent = text; n.className = isErr ? "err" : "note";
}

async function render() {
  const { watches = {} } = await chrome.storage.local.get("watches");
  const all = Object.values(watches);

  const here = all.filter((w) => tab && samePage(w.url, tab.url));
  const list = $("p-list"); list.textContent = "";
  here.forEach((w) => list.append(row(w, w.lastChanged ? "Changed " + relTime(w.lastChanged) : statusOf(w).label, relTime(w.lastChecked))));

  const recent = all.flatMap((w) => (w.history || []).filter((e) => e.alerted !== false).map((e) => ({ w, e })))
    .sort((a, b) => b.e.at - a.e.at).slice(0, 5);
  $("recent-sec").hidden = recent.length === 0;
  const rl = $("recent"); rl.textContent = "";
  recent.forEach(({ w, e }) => rl.append(row(w, e.summary.headline || "Text changed", relTime(e.at))));

  if (all.length === 0 && !$("p-btns").hidden) {
    note("Pick any part of a page, like a price, a waitlist count or a job board, and Tripwire checks it in the background.");
  }
}

function row(w, sub, when) {
  const st = statusOf(w);
  return h("li", {}, h("button", { type: "button", title: w.url, onclick: () => send({ type: "openDashboard", id: w.id }).then(() => window.close()) },
    h("span", { class: "dot " + st.cls, title: st.label }),
    h("span", { class: "name" }, w.label),
    h("span", { class: "when" }, when, w.unseen ? " " : "", w.unseen ? h("span", { class: "pill" }, String(w.unseen)) : null),
    h("span", { class: "sub" }, sub)));
}

async function startPicker(whole) {
  const origin = new URL(tab.url).origin + "/*";
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [origin] }); }
  catch (e) { note("Couldn't ask for access: " + e.message, true); return; }
  if (!granted) { note("Tripwire needs access to " + host(tab.url) + " to check it in the background.", true); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/extract.js", "lib/selector.js", "picker.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [whole], func: (w) => self.TripwirePicker.start({ whole: w }) });
    window.close();
  } catch (e) {
    note("This page doesn't allow extensions to run on it (" + e.message + ").", true);
  }
}

$("pick").addEventListener("click", () => startPicker(false));
$("whole").addEventListener("click", () => startPicker(true));
$("dash").addEventListener("click", () => send({ type: "openDashboard" }).then(() => window.close()));
$("checkall").addEventListener("click", async (e) => {
  const b = e.currentTarget; b.disabled = true; b.textContent = "Checking…";
  await send({ type: "checkAll" });
  b.textContent = "All checked"; setTimeout(() => { b.disabled = false; b.textContent = "Check all now"; }, 1500);
});
chrome.storage.onChanged.addListener((c) => { if (c.watches) render(); });
init();
