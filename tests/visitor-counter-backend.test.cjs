const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/visitor-counter.gs'), 'utf8');
const VISITOR = '22d146f9-19a6-43ca-a0ef-f5586a6d11f2';
const SECOND = 'ef888cbd-59dd-46a9-8d50-a43242397989';
const TOKEN = '75482b7a-4ec2-47fd-8f88-493f64a08fd4';
const ORIGIN = 'https://dkleng.co.kr';

function state() {
  return { rows: [], properties: new Map(), created: 0, busy: false,
    now: '2026-10-20T01:00:00.000Z', name: '', capacity: 1000 };
}

function runtime(data = state()) {
  const protection = { setDescription() { return this; }, setWarningOnly() { return this; } };
  const sheet = {
    setName(name) { data.name = name; },
    setFrozenRows() {},
    getLastRow() { return data.rows.length; },
    getMaxRows() { return data.capacity; },
    insertRowsAfter(row, count) {
      assert.equal(data.busy, true); assert.equal(row, data.capacity);
      data.capacity += count;
    },
    getRange(row, column, height, width) {
      let format;
      return {
        getValues() { return data.rows.slice(row - 1, row - 1 + height)
          .map(item => item.slice(column - 1, column - 1 + width)); },
        setValues(rows) {
          assert.equal(data.busy, true, 'ledger writes must be locked');
          if (row > 1) assert.equal(format, '@', 'format target cells as text before storing dates');
          data.rows.splice(row - 1, rows.length, ...rows.map(item => Array.from(item)));
        },
        setNumberFormat(value) { format = value; return this; },
        protect() { return protection; }
      };
    }
  };
  const book = {
    getSheets: () => [sheet],
    getSheetByName: name => name === data.name ? sheet : null,
    getId: () => 'test-ledger',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/test-ledger/edit',
    setSpreadsheetTimeZone: zone => assert.equal(zone, 'Asia/Seoul')
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [data.now])); }
  }
  const context = vm.createContext({
    Date: Clock,
    console: { error() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: name => data.properties.get(name) || null,
      setProperty: (name, value) => data.properties.set(name, value)
    }) },
    LockService: { getScriptLock: () => ({
      waitLock() { if (data.busy) throw new Error('busy'); data.busy = true; },
      releaseLock() { assert.equal(data.busy, true); data.busy = false; }
    }) },
    SpreadsheetApp: {
      create() { data.created += 1; return book; },
      openById(id) { assert.equal(id, 'test-ledger'); return book; },
      flush() {}
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algorithm, input) => Array.from(crypto.createHash(algorithm).update(input).digest()),
      formatDate(date, zone, pattern) {
        assert.equal(zone, 'Asia/Seoul'); assert.equal(pattern, 'yyyy-MM-dd');
        return new Intl.DateTimeFormat('en-CA', { timeZone: zone,
          year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'allow-all' },
      createHtmlOutput: html => ({ html, setXFrameOptionsMode() { return this; } })
    }
  });
  vm.runInContext(source, context);
  return { data, context };
}

function post(app, changes = {}) {
  const output = app.context.doPost({ parameter: {
    visitorId: VISITOR, token: TOKEN, origin: ORIGIN, ...changes
  } });
  const script = output.html.match(/<script>([\s\S]*)<\/script>/);
  if (!script) return null;
  let reply;
  vm.runInNewContext(script[1], { window: { top: {
    postMessage(value, target) { reply = JSON.parse(JSON.stringify({ value, target })); }
  } } });
  assert.equal(reply.target, changes.origin || ORIGIN);
  return reply.value;
}

test('explicit setup creates private ledger once and preserves data when repeated', () => {
  const app = runtime();
  assert.match(app.context.setupVisitorCounter(), /^https:\/\/docs\.google\.com/);
  assert.deepEqual(app.data.rows, [['date_kst', 'visitor_hash']]);
  assert.equal(post(app).total, 1);
  app.context.setupVisitorCounter();
  assert.equal(app.data.created, 1);
  assert.equal(post(app).total, 1);
});

test('same browser and retries count once per day; a second browser counts separately', () => {
  const app = runtime(); app.context.setupVisitorCounter();
  app.data.capacity = 2;
  assert.deepEqual(post(app), {
    type: 'dkl-visitors-response', token: TOKEN, ok: true,
    today: 1, total: 1, date: '2026-10-20'
  });
  assert.equal(post(app).total, 1);
  const second = post(app, { visitorId: SECOND });
  assert.equal(second.today, 2); assert.equal(second.total, 2);
  assert.equal(post(app).total, 2);
  assert.equal(app.data.rows.length, 3);
  assert.equal(app.data.capacity, 1002, 'ledger extends capacity before writing beyond its grid');
  assert.equal(app.data.rows[1][1], crypto.createHash('sha256').update(VISITOR).digest('hex'));
  assert.ok(!JSON.stringify(app.data.rows).includes(VISITOR), 'raw visitor ID must not be stored');
});

test('Korean midnight resets daily count and preserves cumulative total', () => {
  const app = runtime(); app.context.setupVisitorCounter();
  app.data.now = '2026-10-20T14:59:59.999Z';
  assert.equal(post(app).date, '2026-10-20');
  post(app, { visitorId: SECOND });
  app.data.now = '2026-10-20T15:00:00.000Z';
  const nextDay = post(app);
  assert.equal(nextDay.date, '2026-10-21');
  assert.equal(nextDay.today, 1); assert.equal(nextDay.total, 3);
  assert.equal(post(app).total, 3);
});

test('new runtime uses durable script property and spreadsheet without resetting totals', () => {
  const app = runtime(); app.context.setupVisitorCounter(); post(app);
  const restarted = runtime(app.data);
  assert.equal(post(restarted).total, 1);
  assert.equal(post(restarted, { visitorId: SECOND }).total, 2);
  assert.equal(app.data.created, 1);
});

test('invalid origins and IDs cannot append data or initialize storage', () => {
  const app = runtime(); app.context.setupVisitorCounter();
  assert.equal(post(app, { origin: 'https://dkleng.co.kr.evil.example' }), null);
  assert.equal(post(app, { visitorId: 'not-a-uuid' }).ok, false);
  assert.equal(post(app, { token: '</script><script>alert(1)</script>' }).ok, false);
  assert.equal(post(app, { visitorId: '22d146f9-19a6-13ca-a0ef-f5586a6d11f2' }).ok, false);
  assert.equal(app.data.rows.length, 1);
  assert.equal(app.data.created, 1);
  const fresh = runtime();
  assert.equal(post(fresh).ok, false);
  assert.equal(fresh.data.created, 0, 'requests cannot create a ledger implicitly');
});

test('lock contention and damaged headers fail without modifying the ledger', () => {
  const app = runtime(); app.context.setupVisitorCounter();
  app.data.busy = true;
  assert.equal(post(app).ok, false);
  assert.equal(app.data.rows.length, 1);
  app.data.busy = false;
  app.data.rows[0][0] = 'unexpected';
  assert.equal(post(app).ok, false);
  assert.equal(app.data.rows.length, 1);
  assert.equal(app.data.busy, false);
});

test('HTML reply safely encodes script delimiters and Unicode line separators', () => {
  const app = runtime();
  const malicious = '</script><evil>&\u2028\u2029';
  const output = app.context.visitorReply_({ type: malicious }, ORIGIN);
  assert.ok(!output.html.includes('<evil>'));
  assert.ok(!output.html.includes('\u2028'));
  assert.ok(!output.html.includes('\u2029'));
  assert.equal((output.html.match(/<\/script>/g) || []).length, 1);
  let received;
  const script = output.html.match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(script, { window: { top: { postMessage: value => { received = value; } } } });
  assert.equal(received.type, malicious);
});
