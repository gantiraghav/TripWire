// End-to-end: load the unpacked extension in Chromium, create watches through the
// real picker UI, change the pages, and confirm Tripwire detects and diffs the changes.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const SITE = path.join(__dirname, 'site');
const OUT = process.env.OUT || '/tmp/tw-shots';
fs.mkdirSync(OUT, { recursive: true });

// test build: same extension, but host access pre-granted (optional permissions can't be clicked through headlessly)
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
fs.cpSync(path.join(__dirname, '..'), build, { recursive: true, filter: (s) => !s.includes('/test') && !s.includes('node_modules') });
const mf = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json')));
mf.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(path.join(build, 'manifest.json'), JSON.stringify(mf));

const server = http.createServer((req, res) => {
  const f = path.join(SITE, req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } console.log('  ✓ ' + m); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const orig = { w: fs.readFileSync(SITE + '/waitlist.html', 'utf8'), j: fs.readFileSync(SITE + '/jobs.json', 'utf8') };
  const ctx = await chromium.launchPersistentContext('', {
    headless: true, channel: 'chromium', viewport: { width: 1280, height: 820 },
    args: ['--disable-extensions-except=' + build, '--load-extension=' + build],
  });
  try {
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    console.log('extension', extId);

    // ---- 1. pick an element on a static page
    const page = await ctx.newPage();
    await page.goto(base + '/waitlist.html');
    await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url: url });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/extract.js', 'lib/selector.js', 'picker.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => self.TripwirePicker.start({}) });
    }, base + '/waitlist.html');
    const seats = page.locator('[data-testid=waitlist]');
    const bb = await seats.boundingBox();
    await page.mouse.move(bb.x + 20, bb.y + bb.height / 2);
    await page.waitForTimeout(150);
    await page.screenshot({ path: OUT + '/1-picking.png' });
    await page.mouse.click(bb.x + 20, bb.y + bb.height / 2);
    const panel = page.locator('tripwire-picker .panel');
    await panel.waitFor();
    assert((await panel.locator('code.sel').textContent()).includes('data-testid'), 'picker built a stable selector: ' + await panel.locator('code.sel').textContent());
    await panel.locator('input').first().fill('EECS 281 waitlist');
    await page.screenshot({ path: OUT + '/2-panel.png' });
    await panel.getByText('Start watching').click();
    await panel.getByText('Watching “EECS 281 waitlist”').waitFor();
    await page.screenshot({ path: OUT + '/3-done.png' });

    // ---- 2. whole-page-ish watch on a JS-rendered page -> should pick full render mode
    const spa = await ctx.newPage();
    await spa.goto(base + '/spa.html'); await spa.locator('#jobs').waitFor();
    await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/extract.js', 'lib/selector.js', 'picker.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => self.TripwirePicker.start({}) });
    }, base + '/spa.html');
    const jb = await spa.locator('#jobs li').first().boundingBox();
    await spa.mouse.move(jb.x + 30, jb.y + jb.height / 2); await spa.waitForTimeout(100);
    // hover lands on an <li>; press ↑ to grow to the list
    await spa.keyboard.press('ArrowUp');
    await spa.keyboard.press('Enter');
    const p2 = spa.locator('tripwire-picker .panel'); await p2.waitFor();
    const sel2 = (await p2.locator('code.sel').textContent()).trim();
    assert(sel2 === '#jobs', 'arrow-up grew the selection from <li> to ' + sel2);
    await p2.locator('input').first().fill('Careers page');
    await p2.getByText('Start watching').click();
    await p2.getByText('Watching').first().waitFor();

    const ws = await sw.evaluate(async () => (await chrome.storage.local.get('watches')).watches);
    const list = Object.values(ws);
    const wl = list.find((w) => w.label === 'EECS 281 waitlist'), cr = list.find((w) => w.label === 'Careers page');
    assert(wl.mode === 'fetch', 'static page uses fast fetch mode');
    assert(cr.mode === 'render', 'JavaScript-rendered page falls back to full render mode');
    const alarms = await sw.evaluate(() => chrome.alarms.getAll());
    assert(alarms.length === 2, 'an alarm is scheduled for each watch');

    // ---- 3. no-change check
    const dash = await ctx.newPage();
    await dash.goto(`chrome-extension://${extId}/dashboard.html#${wl.id}`);
    let r = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), wl.id);
    assert(r.ok && r.result.changed === false, 'unchanged page reports no change');

    // ---- 4. change both pages
    fs.writeFileSync(SITE + '/waitlist.html', orig.w.replace('12 students · Status: Closed', '11 students · Status: Open').replace('3 min', '1 min'));
    fs.writeFileSync(SITE + '/jobs.json', JSON.stringify(['Software Engineer Intern, Summer 2027', 'Data Engineer Intern', 'Machine Learning Intern']));
    r = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), wl.id);
    assert(r.ok && r.result.changed, 'waitlist change detected: ' + r.result.summary.headline);
    r = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), cr.id);
    assert(r.ok && r.result.changed && /Machine Learning Intern/.test(r.result.summary.headline), 'render mode saw the new job: ' + r.result.summary.headline);

    // ---- 5. conditions + ignore patterns
    await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'updateWatch', id, fields: { condition: { type: 'appears', value: 'Full' } } }), wl.id);
    fs.writeFileSync(SITE + '/waitlist.html', orig.w.replace('12 students · Status: Closed', '10 students · Status: Open'));
    r = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), wl.id);
    let w2 = (await sw.evaluate(async () => (await chrome.storage.local.get('watches')).watches))[wl.id];
    assert(r.result.changed && w2.history[0].alerted === false, 'change recorded without alert when "appears: Full" rule not met');
    await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'updateWatch', id, fields: { ignore: '\\d+', condition: { type: 'any', value: '' } } }), wl.id);
    fs.writeFileSync(SITE + '/waitlist.html', orig.w.replace('12 students · Status: Closed', '9 students · Status: Open'));
    r = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), wl.id);
    assert(r.result.changed === false, 'ignore pattern \\d+ suppresses number-only changes');

    // ---- 6. element disappears
    fs.writeFileSync(SITE + '/waitlist.html', '<html><body><h1>Maintenance</h1></body></html>');
    r = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), wl.id);
    assert(r.result.missing, 'missing element is reported');
    fs.writeFileSync(SITE + '/waitlist.html', orig.w.replace('12 students · Status: Closed', '8 students · Status: Open'));
    await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'checkNow', id }), wl.id);

    const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
    assert(badge !== '', 'toolbar badge shows unseen count: ' + badge);

    // ---- screenshots of UI
    await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'updateWatch', id, fields: { ignore: '' } }), wl.id);
    await dash.goto(`chrome-extension://${extId}/dashboard.html#${cr.id}`); await dash.waitForTimeout(400);
    await dash.screenshot({ path: OUT + '/4-dashboard.png' });
    await dash.goto(`chrome-extension://${extId}/dashboard.html#${wl.id}`); await dash.waitForTimeout(400);
    await dash.screenshot({ path: OUT + '/5-dashboard-waitlist.png', fullPage: true });
    await dash.emulateMedia({ colorScheme: 'dark' }); await dash.waitForTimeout(200);
    await dash.screenshot({ path: OUT + '/6-dashboard-dark.png' });
    await dash.emulateMedia({ colorScheme: 'light' });

    const pop = await ctx.newPage(); await pop.setViewportSize({ width: 360, height: 520 });
    await page.bringToFront();
    await pop.goto(`chrome-extension://${extId}/popup.html`); await pop.waitForTimeout(400);
    await pop.screenshot({ path: OUT + '/7-popup.png' });

    // ---- highlight view (what a notification click opens)
    await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'open', id }), wl.id);
    await dash.waitForTimeout(1500);
    const opened = ctx.pages().find((p) => p.url().endsWith('/waitlist.html') && p !== page);
    await opened.locator('tripwire-highlight .card').waitFor();
    await opened.screenshot({ path: OUT + '/8-highlight.png' });
    assert(true, 'notification-click view shows the diff on the live page');

    // ---- empty state
    for (const w of [wl, cr]) await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'deleteWatch', id }), w.id);
    assert((await sw.evaluate(() => chrome.alarms.getAll())).length === 0, 'deleting watches clears their alarms');
    await dash.goto(`chrome-extension://${extId}/dashboard.html`); await dash.waitForTimeout(300);
    await dash.screenshot({ path: OUT + '/9-empty.png' });
    console.log('\nALL E2E CHECKS PASSED');
  } finally {
    fs.writeFileSync(SITE + '/waitlist.html', orig.w); fs.writeFileSync(SITE + '/jobs.json', orig.j);
    await ctx.close(); server.close(); fs.rmSync(build, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
