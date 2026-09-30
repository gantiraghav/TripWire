// Renders diff ops into DOM nodes: <del>, <ins>, plain text, and "…" gaps
// for unchanged stretches that were trimmed before storage.
(function (root) {
  function renderDiff(ops, doc) {
    doc = doc || document;
    const frag = doc.createDocumentFragment();
    (ops || []).forEach((o) => {
      if (o.t === "~") {
        const g = doc.createElement("span");
        g.className = "tw-gap";
        g.textContent = "⋯ " + o.n.toLocaleString() + " unchanged characters ⋯";
        frag.appendChild(g);
        return;
      }
      if (o.t === "=") { frag.appendChild(doc.createTextNode(o.s)); return; }
      const el = doc.createElement(o.t === "+" ? "ins" : "del");
      el.textContent = o.s;
      frag.appendChild(el);
    });
    return frag;
  }
  root.Tripwire = root.Tripwire || {};
  root.Tripwire.renderDiff = renderDiff;
})(typeof globalThis !== "undefined" ? globalThis : self);
