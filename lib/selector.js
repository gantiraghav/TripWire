// Builds the shortest CSS selector that uniquely identifies an element,
// preferring attributes that tend to survive redesigns (ids, test ids, names)
// over brittle positional paths.
(function (root) {
  const STABLE_ATTRS = ["data-testid", "data-test", "data-qa", "data-automation-id", "data-cy", "name", "aria-label", "itemprop"];

  function looksGenerated(v) {
    // css-modules / framework hashes: "sc-a1b2c3", "css-1x9f3k", ":r7:", long digit runs
    return /\d{4,}|^[a-z]{1,3}-[a-z0-9]{5,}$|^:r|[A-Za-z0-9]{12,}/.test(v);
  }

  function isUnique(doc, sel) {
    try { return doc.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }

  function part(el) {
    const tag = el.tagName.toLowerCase();
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.length < 80 && !looksGenerated(v)) return tag + "[" + a + '="' + CSS.escape(v) + '"]';
    }
    const parent = el.parentElement;
    if (!parent) return tag;
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    return same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(el) + 1) + ")" : tag;
  }

  function cssPath(el) {
    const doc = el.ownerDocument;
    if (el.id && !looksGenerated(el.id) && isUnique(doc, "#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
      if (cur !== el && cur.id && !looksGenerated(cur.id) && isUnique(doc, "#" + CSS.escape(cur.id))) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
      }
      parts.unshift(part(cur));
      const sel = parts.join(" > ");
      if (isUnique(doc, sel) && doc.querySelector(sel) === el) return sel;
      cur = cur.parentElement;
    }
    const sel = parts.join(" > ");
    return sel || "body";
  }

  root.Tripwire = root.Tripwire || {};
  root.Tripwire.cssPath = cssPath;
})(typeof globalThis !== "undefined" ? globalThis : self);
