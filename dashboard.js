const { send, relTime, absTime, everyLabel, host, h, statusOf } = self.TW;
const $ = (id) => document.getElementById(id);

let watches = {};
let selected = location.hash.slice(1) || null;
let filter = "";
let deferred = false;
const busy = new Set();

async function load() {
  ({ watches = {} } = await chrome.storage.local.get("watches"));
  if (!selected || !watches[selected]) selected = sorted()[0]?.id || null;
  renderAll();
}

const sorted = () => Object.values(watches).sort((a, b) =>
  (b.unseen || 0) - (a.unseen || 0) || (b.lastChanged || b.created) - (a.lastChanged || a.created));

function renderAll() {
  renderStats();
  renderList();
  const editing = document.activeElement && $("detail").contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
  if (editing) { deferred = true; return; }
  renderDetail();
}

function renderStats() {
  const all = Object.values(watches), day = Date.now() - 864e5;
  const changes = all.reduce((a, w) => a + (w.history || []).filter((e) => e.at > day).length, 0);
  const unseen = all.reduce((a, w) => a + (w.unseen || 0), 0);
  $("stats").textContent = all.length
    ? all.length + (all.length === 1 ? " watch" : " watches") + " · " + changes + " change" + (changes === 1 ? "" : "s") + " in the last 24 h" + (unseen ? " · " + unseen + " unseen" : "")
    : "";
  $("checkall").hidden = all.length === 0;
  $("q").hidden = all.length < 4;
}

function renderList() {
  const list = $("list"); list.textContent = "";
  const items = sorted().filter((w) => !filter || (w.label + " " + w.url).toLowerCase().includes(filter));
  $("layout").style.gridTemplateColumns = Object.keys(watches).length ? "" : "1fr";
  list.hidden = Object.keys(watches).length === 0;
  items.forEach((w) => {
    const st = statusOf(w);
    const sub = w.history && w.history[0] ? w.history[0].summary.headline || "Text changed" : host(w.url);
    list.append(h("button", {
      class: "item", type: "button", "aria-current": String(w.id === selected),
      onclick: () => select(w.id),
    },
      h("span", { class: "dot " + st.cls, title: st.label }),
      h("span", { class: "name" }, w.label),
      h("span", { class: "when" }, w.lastChanged ? relTime(w.lastChanged) : "no changes", w.unseen ? h("span", { class: "pill" }, String(w.unseen)) : null),
      h("span", { class: "sub" }, sub)));
  });
  if (items.length === 0 && filter) list.append(h("p", { class: "muted", style: "padding:10px" }, "No watches match “" + filter + "”."));
}

function select(id) {
  selected = id; history.replaceState(null, "", "#" + id);
  renderList(); renderDetail();
  if (watches[id] && watches[id].unseen) send({ type: "markSeen", id });
}

// ---------------------------------------------------------------- detail
function renderDetail() {
  deferred = false;
  const main = $("detail"); main.textContent = "";
  const w = watches[selected];
  if (!w) { main.append(emptyState()); return; }
  const st = statusOf(w);

  // header
  const title = h("input", { class: "title", id: "w-title", "aria-label": "Watch name", value: w.label, maxlength: "80" });
  title.addEventListener("change", () => title.value.trim() && update({ label: title.value.trim() }));
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") title.blur(); });
  main.append(h("div", { class: "d-head" },
    title,
    h("a", { class: "url", href: w.url, target: "_blank", rel: "noopener" }, w.url),
    h("div", { class: "chips" },
      h("span", { class: "chip" }, h("span", { class: "dot " + st.cls }), st.label),
      h("span", { class: "chip", title: w.mode === "fetch" ? "Downloads the page quietly and reads it" : "Loads the page in a background tab so JavaScript can run" },
        w.mode === "fetch" ? "Fast check" : "Full render"),
      h("span", { class: "chip" }, everyLabel(w.interval)),
      h("span", { class: "chip" }, "Checked " + relTime(w.lastChecked)),
      h("span", { class: "chip" }, (w.changes || 0) + " change" + (w.changes === 1 ? "" : "s") + " since " + new Date(w.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })))));

  if (["missing", "error", "permission"].includes(w.status) && w.enabled) {
    main.append(h("div", { class: "alert" + (w.status === "missing" ? "" : " bad") }, w.error || st.label));
  }

  // actions
  const checkBtn = h("button", { class: "primary", type: "button", id: "w-check", disabled: busy.has(w.id) }, busy.has(w.id) ? "Checking…" : "Check now");
  checkBtn.addEventListener("click", async () => {
    busy.add(w.id); checkBtn.disabled = true; checkBtn.textContent = "Checking…";
    const r = await send({ type: "checkNow", id: w.id });
    busy.delete(w.id);
    const res = r.result || {};
    const b = $("w-check"); if (!b || selected !== w.id) return;
    b.disabled = false;
    b.textContent = res.changed ? "Changed" : res.error ? "Check failed" : res.missing ? "Element missing" : "No change";
    setTimeout(() => { if (b.isConnected) b.textContent = "Check now"; }, 1800);
  });
  const del = h("button", { class: "ghost danger", type: "button" }, "Delete");
  const actions = h("div", { class: "actions" },
    checkBtn,
    h("button", { type: "button", onclick: () => send({ type: "open", id: w.id }) }, "Open page"),
    h("button", { type: "button", onclick: () => update({ enabled: !w.enabled }) }, w.enabled ? "Pause" : "Resume"),
    del);
  del.addEventListener("click", () => {
    const box = h("span", { class: "confirm" }, "Delete this watch and its history?",
      h("button", { class: "danger", type: "button", onclick: async () => { await send({ type: "deleteWatch", id: w.id }); selected = null; } }, "Delete"),
      h("button", { class: "ghost", type: "button", onclick: () => renderDetail() }, "Keep"));
    del.replaceWith(box);
  });
  main.append(actions);

  main.append(settings(w));

  // timeline
  const hist = w.history || [];
  main.append(h("h2", {}, "Changes"));
  if (!hist.length) {
    main.append(h("p", { class: "muted", style: "margin:0" }, "No changes yet. Tripwire checks " + everyLabel(w.interval) + " and will list every change here."));
  } else {
    const tl = h("div", { class: "timeline" });
    hist.forEach((e) => {
      const d = h("div", { class: "diff" }); d.append(self.Tripwire.renderDiff(e.ops));
      tl.append(h("article", { class: "entry" + (e.alerted === false ? " quiet" : "") },
        h("div", { class: "entry-head" },
          h("span", { class: "headline" }, e.summary.headline || "Text changed"),
          e.alerted === false ? h("span", { class: "tag", title: "Recorded, but your notify rule wasn't met" }, "no alert") : null,
          h("span", { class: "counts" }, h("span", { class: "a" }, "+" + e.summary.added), " ", h("span", { class: "r" }, "−" + e.summary.removed)),
          h("time", { datetime: new Date(e.at).toISOString(), title: absTime(e.at) }, absTime(e.at))),
        d));
    });
    main.append(tl);
  }

  // snapshot
  const snap = h("details", { class: "snap" }, h("summary", {}, "Current snapshot · " + ((w.lastText || "").match(/\S+/g) || []).length.toLocaleString() + " words"));
  snap.append(h("pre", {}, (w.selector ? "Selector: " + w.selector + "\n\n" : "Whole page\n\n") + (w.lastText || "")));
  main.append(snap);
}

function settings(w) {
  const saved = h("span", { class: "saved", "aria-live": "polite" });
  let t = 0;
  const flash = () => { saved.textContent = "Saved"; clearTimeout(t); t = setTimeout(() => (saved.textContent = ""), 1400); };
  const save = async (fields) => { await update(fields); flash(); };

  const every = h("select", { id: "s-every" });
  [[1, "1 minute"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"]]
    .forEach(([v, l]) => every.append(h("option", { value: v, selected: v === w.interval }, l)));
  every.addEventListener("change", () => save({ interval: Number(every.value) }));

  const cond = w.condition || { type: "any", value: "" };
  const when = h("select", { id: "s-when" });
  [["any", "Any change"], ["appears", "This text appears"], ["disappears", "This text disappears"]]
    .forEach(([v, l]) => when.append(h("option", { value: v, selected: v === cond.type }, l)));
  const val = h("input", { id: "s-val", value: cond.value || "", placeholder: "Text to look for" });
  val.hidden = cond.type === "any";
  when.addEventListener("change", () => { val.hidden = when.value === "any"; if (when.value === "any" || val.value.trim()) save({ condition: { type: when.value, value: val.value.trim() } }); else val.focus(); });
  val.addEventListener("change", () => save({ condition: { type: when.value, value: val.value.trim() } }));

  const ign = h("input", { id: "s-ign", class: "mono", value: w.ignore || "", placeholder: "\\d+ min ago" });
  ign.addEventListener("change", () => {
    try { if (ign.value) new RegExp(ign.value); ign.setCustomValidity(""); save({ ignore: ign.value }); }
    catch (e) { ign.setCustomValidity("Not a valid regular expression"); ign.reportValidity(); }
  });

  const mode = h("select", { id: "s-mode" });
  [["fetch", "Fast check"], ["render", "Full render"]].forEach(([v, l]) => mode.append(h("option", { value: v, selected: v === w.mode }, l)));
  mode.addEventListener("change", () => save({ mode: mode.value }));

  [every, when, val, ign, mode].forEach((x) => x.addEventListener("blur", () => { if (deferred) setTimeout(renderAll, 0); }));

  return h("div", { class: "settings" },
    h("label", {}, "Check every", every),
    h("label", {}, "Notify me when", when, val),
    h("label", {}, "Ignore text matching", ign, h("span", { class: "hint" }, "Regular expression, removed before comparing")),
    h("label", {}, "Check method", mode, h("span", { class: "hint" }, "Use Full render if the page builds content with JavaScript")),
    saved);
}

const update = (fields) => send({ type: "updateWatch", id: selected, fields });

function emptyState() {
  return h("div", { class: "empty" },
    h("h2", {}, "Nothing is being watched yet"),
    h("p", { class: "muted", style: "margin:0" }, "Tripwire keeps an eye on any part of any web page and tells you exactly what changed."),
    h("ol", {},
      h("li", {}, h("b", {}, "Open a page"), " you keep refreshing: a course waitlist, a job board, a price, a grades portal."),
      h("li", {}, h("b", {}, "Click the Tripwire icon"), " (or press Alt+Shift+W) and choose ", h("b", {}, "Watch part of this page"), "."),
      h("li", {}, h("b", {}, "Click the element"), " to watch. Tripwire checks it in the background and notifies you with a word-by-word diff.")),
    h("div", { class: "uses" }, ...["Waitlist seats", "New job postings", "Price drops", "Grade posted", "Docs changelog", "Ticket drops"].map((u) => h("span", { class: "chip" }, u))));
}

// ---------------------------------------------------------------- wiring
$("q").addEventListener("input", (e) => { filter = e.target.value.trim().toLowerCase(); renderList(); });
$("checkall").addEventListener("click", async (e) => {
  const b = e.currentTarget; b.disabled = true; b.textContent = "Checking…";
  await send({ type: "checkAll" });
  b.disabled = false; b.textContent = "Check all now";
});
chrome.storage.onChanged.addListener((c) => {
  if (!c.watches) return;
  watches = c.watches.newValue || {};
  if (!watches[selected]) selected = sorted()[0]?.id || null;
  renderAll();
});
window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (watches[id]) select(id); });
setInterval(() => { renderStats(); renderList(); }, 60000);
load().then(() => { if (selected && watches[selected]?.unseen) send({ type: "markSeen", id: selected }); });
