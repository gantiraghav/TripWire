// Turns a DOM subtree into normalized, comparable text.
// The same walker runs on the live page (picker, render mode) and on HTML
// parsed from a background fetch (offscreen document), so both paths produce
// identical text for identical markup. innerText is avoided on purpose: it
// depends on layout, which a parsed-but-unrendered document does not have.
(function (root) {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT"]);
  const BLOCK = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
    "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
    "SECTION", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "UL", "SUMMARY", "DETAILS", "OPTION",
  ]);
  const CELL = new Set(["TD", "TH"]);

  function extractText(node) {
    if (!node) return "";
    const out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue); return; }
      if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
      const tag = n.tagName ? n.tagName.toUpperCase() : "";
      if (SKIP.has(tag)) return;
      if (tag === "BR") { out.push("\n"); return; }
      if (tag === "INPUT" || tag === "TEXTAREA") {
        const v = n.getAttribute && (n.getAttribute("value") || n.getAttribute("placeholder"));
        if (v) out.push(" " + v + " ");
        return;
      }
      const block = BLOCK.has(tag);
      if (block) out.push("\n");
      if (CELL.has(tag)) out.push(" \t ");
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block) out.push("\n");
    })(node);
    return normalize(out.join(""));
  }

  function normalize(s) {
    return s
      .replace(/ /g, " ")
      .split("\n")
      .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
      .filter((l) => l.length > 0)
      .join("\n");
  }

  // Remove text the user said to ignore (timestamps, view counters...) before comparing.
  function applyIgnore(text, pattern) {
    if (!pattern) return text;
    try { return normalize(text.replace(new RegExp(pattern, "g"), "")); }
    catch (e) { return text; }
  }

  root.Tripwire = root.Tripwire || {};
  root.Tripwire.extractText = extractText;
  root.Tripwire.normalize = normalize;
  root.Tripwire.applyIgnore = applyIgnore;
})(typeof globalThis !== "undefined" ? globalThis : self);
