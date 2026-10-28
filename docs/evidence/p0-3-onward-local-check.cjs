/* Offline Phase 0 evidence only. No Google/Cloudflare calls or credentials.
 * Run: node docs/evidence/p0-3-onward-local-check.cjs
 * Actual backend and selected client functions run against disposable mocks.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('PASS ' + label); }
async function checkAsync(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
function backend() {
  const tabs = {}, files = [], events = [];
  let locked = false;
  const properties = { TEST_SHEET_ID: 'DISPOSABLE_LOCAL_MOCK', TEST_RECEIPT_FOLDER_ID: 'PRIVATE_LOCAL_MOCK',
    TEST_MAX_UPLOAD_BYTES: '1048576', server_secret: 'synthetic-local-secret-never-deployed', ENABLE_TEST_HOOKS: 'true' };
  const book = { getSheetByName: name => tabs[name], insertSheet(name) {
    const data = [];
    const tab = { data, getLastRow: () => data.length, getRange(row, col, rows, cols) {
      return { getValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => data[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues(values) { assert.equal(locked, true, 'Sheet writes must hold the lock');
          values.forEach((value, i) => { data[row - 1 + i] ||= []; value.forEach((v, j) => {
            // Sheets leading apostrophe marks literal input and is not returned by getValues.
            data[row - 1 + i][col - 1 + j] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
          }); }); events.push('write:' + name); }
      };
    } }; tabs[name] = tab; return tab;
  } };
  const context = vm.createContext({ console, Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock() { assert.equal(locked, false); locked = true; events.push('lock'); return true; }, releaseLock() { locked = false; events.push('unlock'); } }) },
    SpreadsheetApp: { openById: () => book, flush() { events.push('flush'); } },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput(content) { return {
      content, mime: 'text/plain', getContent() { return content; }, setMimeType(mime) { this.mime = mime; return this; }
    }; } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: crypto.randomUUID,
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value)).digest()],
      computeHmacSha256Signature: (value, secret) => [...crypto.createHmac('sha256', secret).update(value).digest()],
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'), base64Decode: value => [...Buffer.from(value, 'base64')],
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFolderById: () => ({ getSharingAccess: () => 'PRIVATE', createFile(blob) {
      assert.equal(locked, false, 'Drive write must occur outside the lock'); events.push('drive');
      const id = 'LOCAL_FILE_' + files.length; files.push({ id, ...blob }); return { getId: () => id };
    } }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'apps-script/TestHooks.js'), 'utf8'), context);
  context.initializePhase0TestSheet(); events.length = 0;
  const raw = request => context.doPost({ postData: { contents: JSON.stringify(request) }, parameter: {} });
  return { context, properties, files, events, tabs, raw, post: request => JSON.parse(raw(request).getContent()),
    rows: name => context.rows_(book, name), counts: () => Object.fromEntries(Object.entries(tabs).map(([name, t]) => [name, t.data.length - 1])) };
}
function fixture(hook) { return { action: 'create_order', request_id: crypto.randomUUID(),
  lines: [{ sku_id: 'TEST-BAG', qty: 1 }, { sku_id: 'TEST-PIN', qty: 2 }], quoted_total_sen: 2200,
  name: 'Synthetic Phase Zero', whatsapp: '0123456789', email: 'phase-zero@example.invalid', slot_id: 'TEST-SLOT',
  ...(hook ? { _test_hook: hook } : {}) }; }
function client(hash = '') {
  const elements = new Map(), store = new Map(), location = { href: 'https://local-test.invalid/' + hash, hash, search: '' };
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '' }); return elements.get(id); };
  let calls = [], next = async () => { throw new Error('No mock response'); }, storageCalls = 0;
  const context = vm.createContext({ URL, URLSearchParams, AbortController, setTimeout, clearTimeout, crypto, location,
    document: { getElementById: element }, history: { replaceState(_, __, href) { location.href = href; location.hash = new URL(href).hash; } },
    window: { localStorage: { getItem(key) { storageCalls++; return store.get(key); }, setItem(key, value) { storageCalls++; store.set(key, value); } } },
    fetch: async (url, options) => { calls.push({ url, options }); return next(url, options); } });
  let source = fs.readFileSync(path.join(root, 'poc-web/test-runner.js'), 'utf8');
  // Export selected real functions in memory only; do not edit the deployed harness.
  const marker = '  try { initialize(); }';
  assert.ok(source.includes(marker), 'Client bootstrap marker missing');
  source = source.slice(0, source.indexOf(marker)) + `globalThis.test = { post, fixture, beginCheckout, fragment, storage,
    setApi(value) { api = value; $('api-url').value = value; },
    state() { return { checkout, storageDisabled }; }, initialFragment }; })();`;
  vm.runInContext(source, context);
  context.test.setApi('https://script.google.com/macros/s/LOCAL_TEST_ONLY/exec');
  return { test: context.test, context, calls, location, store, setResponse(fn) { next = fn; }, storageCalls: () => storageCalls };
}
function response(body, status = 200, url = 'https://script.googleusercontent.com/local-only') {
  return { status, url, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}
async function main() {
  const b = backend(), request = fixture('crash_after_commit');
  let committed;
  check('P0-3 local: deliberate non-JSON occurs after header/lines, flush, unlock', () => {
    assert.equal(b.raw(request).getContent(), 'PHASE_0_DELIBERATE_NON_JSON');
    assert.equal(b.rows('Orders').length, 1); assert.equal(b.rows('OrderLines').length, 2);
    committed = b.rows('Orders')[0];
    assert.ok(b.rows('OrderLines').every(line => line.order_id === committed.order_id && line.op_id === committed.op_id));
    assert.equal(b.events.filter(e => e.startsWith('write:')).at(-1), 'write:Orders');
    assert.deepEqual(b.events.slice(-2), ['flush', 'unlock']);
  });
  let recovered;
  check('P0-3 local: identical retry recovers same order/token with zero writes', () => {
    const counts = b.counts(), writes = b.events.filter(e => e.startsWith('write:')).length;
    recovered = b.post(request).data; assert.equal(recovered.order_id, committed.order_id);
    assert.equal(recovered.total_sen, 2200); assert.equal(recovered.lines.length, 2);
    assert.equal(recovered.token.length, 43); assert.deepEqual(b.counts(), counts);
    assert.equal(b.events.filter(e => e.startsWith('write:')).length, writes);
    assert.equal(b.post(request).data.token, recovered.token);
  });
  check('P0-3 local: conflicting replay rejects with zero writes', () => {
    const before = b.events.filter(e => e.startsWith('write:')).length;
    const altered = { ...request, lines: [{ sku_id: 'TEST-BAG', qty: 2 }] };
    assert.equal(b.post(altered).error.code, 'REQUEST_CONFLICT');
    assert.equal(b.events.filter(e => e.startsWith('write:')).length, before);
  });
  const credentials = { order_id: recovered.order_id, token: recovered.token };
  const receipt = { action: 'upload_receipt', ...credentials, mime_type: 'image/png',
    file_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8S8AAAAASUVORK5CYII=' };
  check('P0-4 local: invalid/missing upload credentials create no rows or files', () => {
    const before = b.counts();
    assert.equal(b.post({ ...receipt, token: 'INVALID' }).error.code, 'UNAUTHORIZED');
    const missing = { ...receipt }; delete missing.token;
    assert.equal(b.post(missing).error.code, 'UNAUTHORIZED');
    assert.deepEqual(b.counts(), before); assert.equal(b.files.length, 0);
  });
  check('P0-4 local: prepared log, unlocked Drive write, completed association and exact bytes', () => {
    b.events.length = 0;
    assert.equal(b.post(receipt).data.status, 'received');
    const entry = b.rows('UploadLog')[0], drive = b.events.indexOf('drive');
    assert.equal(entry.status, 'completed'); assert.equal(entry.file_id, b.files[0].id);
    assert.equal(Buffer.from(b.files[0].bytes).toString('base64'), receipt.file_base64);
    assert.ok(b.events.indexOf('write:UploadLog') < drive);
    assert.ok(b.events.lastIndexOf('write:UploadLog') > drive);
    assert.equal(b.rows('Orders')[0].status, 'payment_submitted');
    assert.equal(b.rows('Orders')[0].expires_at, committed.expires_at);
  });
  check('P0-5 local: business/BUSY hooks return error envelopes and zero writes', () => {
    const before = b.counts();
    for (const [hook, code] of [['business_error', 'PRICE_CHANGED'], ['simulate_busy', 'BUSY']]) {
      const result = b.raw(fixture(hook)); assert.equal(result.mime, 'application/json');
      const envelope = JSON.parse(result.getContent()); assert.equal(envelope.ok, false); assert.equal(envelope.error.code, code);
      assert.deepEqual(envelope.error.detail, {});
    }
    assert.deepEqual(b.counts(), before);
  });
  check('P0-5 local: deliberate platform hook bypasses ordinary envelope', () => {
    assert.throws(() => b.raw({ action: 'get_catalogue', _test_hook: 'throw_unhandled' }), { message: 'Deliberate Phase 0 platform exception' });
  });
  check('P0-5 local: hooks cannot enable themselves when server flag is disabled', () => {
    b.properties.ENABLE_TEST_HOOKS = 'false';
    assert.equal(b.post({ action: 'get_catalogue', _test_hook: 'throw_unhandled' }).ok, true);
    b.properties.ENABLE_TEST_HOOKS = 'true';
  });
  check('P0-6 local: authenticated read; missing/tampered token disclose no order', () => {
    assert.equal(b.post({ action: 'read_order', ...credentials }).data.order_id, recovered.order_id);
    for (const token of ['', 'INVALID']) {
      const result = b.post({ action: 'read_order', ...credentials, token });
      assert.equal(result.error.code, 'UNAUTHORIZED'); assert.equal(result.data, undefined);
    }
    const result = JSON.parse(b.context.doGet({ parameter: { action: 'read_order', token: 'INVALID' } }).getContent());
    assert.equal(result.error.code, 'INVALID_REQUEST');
  });
  const c = client(), id = c.test.beginCheckout('local-check'), payload = c.test.fixture(id);
  await checkAsync('P0-5/P0-6 local client: HTTP-200 success and body-only credentials', async () => {
    c.setResponse(async () => response({ ok: true, data: {} }));
    assert.equal((await c.test.post({ action: 'read_order', ...credentials })).kind, 'envelope');
    const call = c.calls.at(-1); assert.equal(new URL(call.url).search, ''); assert.equal(new URL(call.url).hash, '');
    assert.equal(JSON.parse(call.options.body).token, credentials.token);
    assert.equal(call.options.method, 'POST'); assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'follow'); assert.equal(call.options.mode, 'cors');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.deepEqual(Object.keys(call.options.headers), ['Content-Type']);
    assert.equal(call.options.headers['Content-Type'], 'text/plain;charset=UTF-8');
  });
  await checkAsync('P0-5 local client: business/BUSY envelopes remain distinguishable', async () => {
    for (const code of ['PRICE_CHANGED', 'BUSY']) {
      c.setResponse(async () => response({ ok: false, error: { code, message: 'Synthetic case', detail: {} } }));
      const result = await c.test.post(payload); assert.equal(result.kind, 'envelope'); assert.equal(result.envelope.error.code, code);
    }
  });
  for (const [label, fn, expected] of [
    ['non-JSON', async () => response('PHASE_0_DELIBERATE_NON_JSON'), 'non-json'],
    ['platform HTML', async () => response('<html>synthetic platform error</html>'), 'non-json'],
    ['HTTP 503', async () => response('unavailable', 503), 'http'],
    ['network rejection', async () => { throw new TypeError('Synthetic network failure'); }, 'network'],
    ['timeout rejection', async () => { const e = new Error('Synthetic abort'); e.name = 'AbortError'; throw e; }, 'timeout'],
    ['authentication redirect', async () => response('', 200, 'https://accounts.google.com/'), 'redirect'],
    ['malformed envelope', async () => response({ ok: true, data: [] }), 'envelope']
  ]) await checkAsync('P0-5 local client: ' + label + ' retains recovery state', async () => {
    c.setResponse(fn); const before = JSON.stringify(c.test.state());
    const result = await c.test.post(payload); assert.equal(result.kind, 'unknown'); assert.equal(result.reason, expected);
    assert.equal(JSON.stringify(c.test.state()), before); assert.equal(new URLSearchParams(c.location.hash.slice(1)).get('r'), id);
  });
  check('P0-6 local client: fragment reconstructs identical fixture with storage disabled', () => {
    const refreshed = client('#r=' + id + '&no_storage=1');
    const recoveredId = refreshed.test.initialFragment.get('r');
    assert.equal(JSON.stringify(refreshed.test.fixture(recoveredId)), JSON.stringify(payload));
    assert.equal(refreshed.test.storage('getItem', 'ignored'), null);
    assert.equal(refreshed.storageCalls(), 0); assert.equal(refreshed.test.state().storageDisabled, true);
  });
  console.log('RESULT ' + passed + ' local checks passed. No live, browser, phone, Google sharing, or phase gate pass claimed.');
}
main().catch(() => { console.error('FAIL local check failed; inspect assertions locally. No credentials printed.'); process.exitCode = 1; });
