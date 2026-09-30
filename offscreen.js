// Runs in an offscreen document so the service worker can use DOMParser.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== "offscreen" || msg.type !== "extract") return false;
  try {
    const doc = new DOMParser().parseFromString(msg.html, "text/html");
    const el = msg.selector ? doc.querySelector(msg.selector) : doc.body;
    reply(el ? { found: true, text: self.Tripwire.extractText(el), title: doc.title } : { found: false, title: doc.title });
  } catch (e) {
    reply({ error: String(e.message || e) });
  }
  return false;
});
