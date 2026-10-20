const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {createServer} = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const api = 'https://script.google.com/macros/s/DKL_VISITOR_TEST/exec';
let browser, server, base;

before(async () => {
  server = createServer(async (req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (file.includes('..')) { res.writeHead(400).end(); return; }
    try {
      const content = await readFile(path.join(root, file));
      const type = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
        '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml'}[path.extname(file)];
      res.writeHead(200, {'Content-Type': type || 'application/octet-stream'}).end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox']});
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openSite({endpoint = api, respond, storageBlocked = false} = {}) {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const calls = [];
  if (storageBlocked) await context.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) {
      // Footer behavior does not require decoding the large equipment/document scans.
      if (request.resourceType() === 'image') return route.abort();
      if (url.pathname === '/script.js') {
        const source = (await readFile(path.join(root,'script.js'),'utf8'))
          .replace(/visitorApiUrl:\s*'[^']*'/, `visitorApiUrl: ${JSON.stringify(endpoint)}`);
        return route.fulfill({contentType:'text/javascript',body:source});
      }
      return route.continue();
    }
    if (request.url() === api) {
      const fields = Object.fromEntries(new URLSearchParams(request.postData()));
      calls.push(fields);
      const response = respond && respond(fields);
      const html = response ? `<script>window.top.postMessage(${JSON.stringify(response)},${JSON.stringify(base)})</script>` : '';
      return route.fulfill({contentType:'text/html',body:html});
    }
    // Keep tests independent of external services; never send real inquiries.
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, {waitUntil:'domcontentloaded'});
  return {context, page, calls, errors};
}

test('unconnected footer stays honest and mobile navigation still works', async () => {
  const site = await openSite({endpoint:''});
  try {
    assert.equal(await site.page.locator('#visitorToday').textContent(), '—');
    assert.equal(await site.page.locator('#visitorTotal').textContent(), '—');
    assert.equal(site.calls.length, 0);
    assert.match(await site.page.locator('#visitorToday').getAttribute('aria-label'), /불가/);
    await site.page.locator('#menuToggle').click();
    await site.page.locator('.nav a[href="#services"]').click();
    await site.page.locator('#services').waitFor({state:'visible'});
    assert.equal(await site.page.locator('#menuToggle').getAttribute('aria-expanded'), 'false');
    const box = await site.page.locator('.visitor-stats').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
    assert.deepEqual(site.errors, []);
  } finally { await site.context.close(); }
});

test('reloads reuse one browser ID and another browser gets a different ID', async () => {
  const seen = new Set();
  const respond = fields => {
    seen.add(fields.visitorId);
    return {type:'dkl-visitors-response',token:fields.token,ok:true,today:seen.size,total:seen.size,date:'2026-10-20'};
  };
  const first = await openSite({respond});
  let second;
  try {
    await first.page.waitForFunction(() => document.getElementById('visitorTotal').textContent === '1');
    const id = first.calls[0].visitorId;
    await first.page.reload({waitUntil:'domcontentloaded'});
    await first.page.waitForFunction(() => document.getElementById('visitorTotal').textContent === '1');
    assert.equal(first.calls[1].visitorId, id);
    assert.notEqual(first.calls[1].token, first.calls[0].token);
    second = await openSite({respond});
    await second.page.waitForFunction(() => document.getElementById('visitorTotal').textContent === '2');
    assert.notEqual(second.calls[0].visitorId, id);
    assert.deepEqual(first.errors.concat(second.errors), []);
  } finally { await first.context.close(); if (second) await second.context.close(); }
});

test('untrusted messages and wrong tokens cannot change displayed numbers', async () => {
  const site = await openSite();
  try {
    await site.page.waitForLoadState('load');
    assert.equal(site.calls.length, 1);
    const data = {type:'dkl-visitors-response',token:site.calls[0].token,ok:true,today:2345,total:67890,date:'2026-10-20'};
    await site.page.evaluate(data => {
      window.dispatchEvent(new MessageEvent('message',{origin:'https://googleusercontent.com.evil.example',data}));
      window.dispatchEvent(new MessageEvent('message',{origin:'https://script.google.com',data:{...data,token:'wrong'}}));
    }, data);
    assert.equal(await site.page.locator('#visitorTotal').textContent(), '—');
    await site.page.evaluate(data => window.dispatchEvent(new MessageEvent('message',{
      origin:'https://test-script.googleusercontent.com',data
    })), data);
    assert.equal(await site.page.locator('#visitorToday').textContent(), '2,345');
    assert.equal(await site.page.locator('#visitorTotal').textContent(), '67,890');
    assert.equal(await site.page.locator('iframe[name^="dklVisitor_"]').count(), 0);
  } finally { await site.context.close(); }
});

test('invalid counts and storage restrictions do not create misleading totals', async () => {
  const broken = await openSite({respond:fields => ({
    type:'dkl-visitors-response',token:fields.token,ok:true,today:10,total:2,date:'2026-10-20'
  })});
  const blocked = await openSite({storageBlocked:true});
  try {
    await broken.page.waitForFunction(() => !document.querySelector('iframe[name^="dklVisitor_"]'));
    assert.equal(await broken.page.locator('#visitorToday').textContent(), '—');
    assert.match(await broken.page.locator('#visitorToday').getAttribute('aria-label'), /불가/);
    assert.equal(blocked.calls.length, 0);
    assert.equal(await blocked.page.locator('#visitorTotal').textContent(), '—');
    assert.deepEqual(broken.errors.concat(blocked.errors), []);
  } finally { await broken.context.close(); await blocked.context.close(); }
});

test('the inquiry endpoint cannot be used as the counter endpoint', async () => {
  const source = await readFile(path.join(root, 'script.js'),'utf8');
  const inquiry = source.match(/apiUrl: '([^']+)'/)[1];
  const site = await openSite({endpoint:inquiry});
  try {
    assert.equal(await site.page.locator('iframe[name^="dklVisitor_"]').count(), 0);
    assert.equal(await site.page.locator('#visitorTotal').textContent(), '—');
    assert.deepEqual(site.errors, []);
  } finally { await site.context.close(); }
});
