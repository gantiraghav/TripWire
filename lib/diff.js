// Word-level diff using Myers' O((N+M)D) algorithm.
// Returns a list of ops: { t: "=" | "-" | "+", s: string }.
(function (root) {
  const MAX_D = 1500;          // edit-distance budget before falling back to "replaced"

  function tokenize(text, byLine) {
    if (byLine) return text.split(/(\n)/).filter(Boolean);
    return text.split(/(\s+)/).filter(Boolean);
  }

  function myers(a, b) {
    const n = a.length, m = b.length, max = n + m, off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    for (let d = 0; d <= Math.min(max, MAX_D); d++) {
      trace.push(v.slice(off - d, off + d + 1));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) return backtrack(trace, a, b, d);
      }
    }
    return null; // too different
  }

  function backtrack(trace, a, b, D) {
    const ops = [];
    let x = a.length, y = b.length;
    for (let d = D; d > 0; d--) {
      const V = trace[d]; // v before step d, indexed k + d
      const at = (k) => V[k + d];
      const k = x - y;
      const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
      const prevX = at(prevK), prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push({ t: "=", s: a[x - 1] }); x--; y--; }
      if (x === prevX) ops.push({ t: "+", s: b[prevY] });
      else ops.push({ t: "-", s: a[prevX] });
      x = prevX; y = prevY;
    }
    while (x > 0 && y > 0) { ops.push({ t: "=", s: a[x - 1] }); x--; y--; }
    return ops.reverse();
  }

  function merge(ops) {
    const out = [];
    for (const o of ops) {
      if (!o.s) continue;
      const last = out[out.length - 1];
      if (last && last.t === o.t) last.s += o.s; else out.push({ t: o.t, s: o.s });
    }
    return out;
  }

  // Readability pass: tiny whitespace-only "=" islands between edits get folded
  // into the edit, and each changed region is emitted as "-" then "+".
  function tidy(ops) {
    const regions = [];
    let cur = null;
    ops.forEach((o, i) => {
      const islands = o.t === "=" && /^\s+$/.test(o.s) && cur && ops[i + 1] && ops[i + 1].t !== "=";
      if (o.t === "=" && !islands) { cur = null; regions.push({ t: "=", s: o.s }); return; }
      if (!cur) { cur = { t: "chg", del: "", ins: "" }; regions.push(cur); }
      if (o.t === "-" || islands) cur.del += o.s;
      if (o.t === "+" || islands) cur.ins += o.s;
    });
    const out = [];
    regions.forEach((r) => {
      if (r.t === "=") out.push(r);
      else { if (r.del) out.push({ t: "-", s: r.del }); if (r.ins) out.push({ t: "+", s: r.ins }); }
    });
    return merge(out);
  }

  function diff(oldText, newText) {
    oldText = oldText || ""; newText = newText || "";
    if (oldText === newText) return [{ t: "=", s: oldText }];
    const byLine = false; // prefix/suffix trimming keeps word mode cheap even on long pages
    let a = tokenize(oldText, byLine), b = tokenize(newText, byLine);
    // trim common prefix / suffix so Myers only sees the changed middle
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const pre = a.slice(0, p).join(""), suf = a.slice(a.length - s).join("");
    const am = a.slice(p, a.length - s), bm = b.slice(p, b.length - s);
    const mid = myers(am, bm) || [{ t: "-", s: am.join("") }, { t: "+", s: bm.join("") }];
    return tidy([{ t: "=", s: pre }, ...mid, { t: "=", s: suf }]);
  }

  const words = (s) => (s.match(/\S+/g) || []).length;
  const clip = (s, n) => { s = s.replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  function summarize(ops) {
    let added = 0, removed = 0;
    ops.forEach((o) => { if (o.t === "+") added += words(o.s); if (o.t === "-") removed += words(o.s); });
    let headline = "";
    const i = ops.findIndex((o) => o.t !== "=");
    if (i >= 0) {
      const o = ops[i], n = ops[i + 1];
      if (o.t === "-" && n && n.t === "+") headline = "“" + clip(o.s, 36) + "” → “" + clip(n.s, 36) + "”";
      else if (o.t === "+") headline = "Added “" + clip(o.s, 60) + "”";
      else headline = "Removed “" + clip(o.s, 60) + "”";
    }
    // count separate edit regions (a "-" directly followed by "+" is one region)
    let regions = 0;
    ops.forEach((o, k) => { if (o.t !== "=" && o.t !== "~" && !(o.t === "+" && ops[k - 1] && ops[k - 1].t === "-")) regions++; });
    if (regions > 1) headline += " and " + (regions - 1) + " more " + (regions === 2 ? "change" : "changes");
    return { added, removed, headline, regions };
  }

  // 0..1 share of characters left unchanged
  function similarity(ops) {
    let same = 0, del = 0, ins = 0;
    ops.forEach((o) => { if (o.t === "=") same += o.s.length; else if (o.t === "-") del += o.s.length; else ins += o.s.length; });
    const denom = 2 * same + del + ins;
    return denom ? (2 * same) / denom : 1;
  }

  root.Tripwire = root.Tripwire || {};
  Object.assign(root.Tripwire, { diff, summarize, similarity });
})(typeof globalThis !== "undefined" ? globalThis : self);
