/* Phase 0 Task 0.2 only. Sections 4, 5.5, 5.6, 5.9 and 9.
 * No production frontend, real contacts, secrets in logs, or third-party code.
 * Sheet/Drive/network evidence is operator-observed: the public API cannot
 * prove row counts, private file creation, or outgoing browser Referer headers.
 * localStorage stores only the endpoint and checkout recovery metadata, never
 * the HMAC token. The fixed fixture below must remain stable across refreshes.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const CONFIG_KEY = 'csv-p0-api-v1';
  const CHECKOUT_KEY = 'csv-p0-checkout-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ORDER_ID = /^TEST-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const initialFragment = new URLSearchParams(location.hash.slice(1));
  // Read before ANY storage access. This switch survives a real page reload.
  let storageDisabled = initialFragment.get('no_storage') === '1';
  let api = '', checkout = null, order = null, busy = false, halted = false, flow = false;
  let flowRoot = null;
  let fieldNumber = 0;
  let activeCondition = '', runNumber = 0;
  const results = {};
  const envelopeCases = new Set();
  const secrets = new Set();

  class InputIssue extends Error {}
  class GateIssue extends Error {}
  class ImageIssue extends GateIssue {}
  class StopIssue extends GateIssue {}
  const requireInput = (condition, message) => { if (!condition) throw new InputIssue(message); };
  const check = (condition, message) => { if (!condition) throw new GateIssue(message); };
  const critical = (condition, message) => { if (!condition) throw new StopIssue(message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function log(message) {
    // Callers supply fixed local messages only; never error.message from an API,
    // raw payloads, response text, URLs, fragments or identifiers.
    let safe = message;
    secrets.forEach(secret => { if (secret) safe = safe.split(secret).join('[redacted]'); });
    $('test-log').textContent += '\n' + new Date().toISOString() + ' ' + safe;
  }
  function storage(method, key, value) {
    if (storageDisabled) return null;
    try { return window.localStorage[method](key, value); }
    catch (_) { log('Storage unavailable; fragment recovery remains available.'); return null; }
  }
  function endpoint(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname === 'script.google.com' &&
          !url.port && !url.username && !url.password && !url.search && !url.hash &&
          /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) return url.href;
    } catch (_) { /* Never include the rejected value in output. */ }
    return '';
  }
  function fragment(values) {
    const url = new URL(location.href);
    requireInput(!url.search, 'Remove query parameters before running tests.');
    url.hash = new URLSearchParams(values).toString();
    try { history.replaceState(null, '', url.href); }
    catch (_) { throw new InputIssue('Fragment could not be saved; checkout was not sent.'); }
  }
  function rememberCheckout() {
    storage('setItem', CHECKOUT_KEY, JSON.stringify(checkout));
  }
  function fixture(id, hook) {
    const request = {
      action: 'create_order', request_id: id,
      lines: [{ sku_id: 'TEST-BAG', qty: 1 }, { sku_id: 'TEST-PIN', qty: 2 }],
      quoted_total_sen: 2200, name: 'Synthetic Phase Zero',
      whatsapp: '0123456789', email: 'phase-zero@example.invalid', slot_id: 'TEST-SLOT'
    };
    if (hook) request._test_hook = hook;
    return request;
  }
  function beginCheckout(kind) {
    requireInput(!checkout || checkout.stage === 'complete',
      'Recover the pending checkout before starting another order test.');
    requireInput(typeof crypto.randomUUID === 'function', 'A secure browser with UUID support is required.');
    const id = crypto.randomUUID();
    secrets.add(id);
    // Save the refresh fallback before making any mutation request.
    fragment({ r: id, ...(storageDisabled ? { no_storage: '1' } : {}) });
    checkout = { id, api, kind, stage: 'pending' };
    rememberCheckout();
    return id;
  }
  function completeCheckout() { checkout.stage = 'complete'; rememberCheckout(); }
  function acceptOrder(data) {
    if (typeof data.token === 'string') secrets.add(data.token);
    critical(ORDER_ID.test(data.order_id) && /^[A-Za-z0-9_-]{43}$/.test(data.token || ''),
      'FAIL: committed test-order credential shape is invalid.');
    critical(data.total_sen === 2200 && Array.isArray(data.lines) && data.lines.length === 2,
      'FAIL: returned test order differs from the fixed fixture.');
    const lines = [...data.lines].sort((a, b) => String(a.sku_id).localeCompare(String(b.sku_id)));
    critical(lines[0].sku_id === 'TEST-BAG' && lines[0].qty === 1 && lines[0].price_sen === 1200 &&
      lines[1].sku_id === 'TEST-PIN' && lines[1].qty === 2 && lines[1].price_sen === 500,
    'FAIL: returned order lines differ from the fixed fixture.');
    order = { order_id: data.order_id, token: data.token };
    return data;
  }

  async function timedFetch(url, options, consume, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return await consume(response); // Timeout covers response-body consumption too.
    } finally { clearTimeout(timer); }
  }
  async function post(body) {
    requireInput(Boolean(api) && endpoint($('api-url').value.trim()) === api,
      'Enter and save a valid test /exec URL first.');
    if (body.request_id) secrets.add(body.request_id);
    if (body.token) secrets.add(body.token);
    try {
      const result = await timedFetch(api, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body), mode: 'cors', credentials: 'omit',
        redirect: 'follow', referrerPolicy: 'no-referrer'
      }, async response => {
        if (response.url) {
          const final = new URL(response.url);
          if (final.protocol !== 'https:' ||
              !['script.google.com', 'script.googleusercontent.com'].includes(final.hostname)) {
            return { kind: 'unknown', reason: 'redirect' };
          }
        }
        if (response.status !== 200) return { kind: 'unknown', reason: 'http' };
        const text = await response.text();
        let envelope;
        try { envelope = JSON.parse(text); }
        catch (_) { return { kind: 'unknown', reason: 'non-json' }; }
        if (!object(envelope) || typeof envelope.ok !== 'boolean' ||
            (envelope.ok ? !object(envelope.data) :
              !object(envelope.error) || typeof envelope.error.code !== 'string' ||
              !/^[A-Z][A-Z0-9_]*$/.test(envelope.error.code) ||
              typeof envelope.error.message !== 'string' || !object(envelope.error.detail))) {
          return { kind: 'unknown', reason: 'envelope' };
        }
        return { kind: 'envelope', envelope };
      }, body.action === 'upload_receipt' ? 60000 : 15000);
      $('connection-status').textContent = result.kind === 'envelope' ? 'Readable HTTP-200 JSON response' : 'Unknown outcome';
      return result;
    } catch (error) {
      $('connection-status').textContent = 'Unknown outcome';
      return { kind: 'unknown', reason: error.name === 'AbortError' ? 'timeout' : 'network' };
    }
  }
  function success(result) {
    critical(result.kind === 'envelope' && result.envelope.ok,
      'FAIL: expected a readable success envelope. Stop and inspect the deployment.');
    return result.envelope.data;
  }
  function expectError(result, code) {
    critical(result.kind === 'envelope' && result.envelope.ok === false && result.envelope.error.code === code,
      'FAIL: expected error envelope was not returned.');
  }
  function syncControls() {
    $('test-controls').disabled = busy || halted || !api || endpoint($('api-url').value.trim()) !== api;
    $('api-url').disabled = busy || (flow && Boolean(api));
    document.querySelectorAll('#test-controls button').forEach(b => {
      b.disabled = flow && !flowRoot.contains(b);
    });
  }
  function manualFlow(parent) { flow = true; flowRoot = parent; syncControls(); }
  function finishFlow() { flow = false; syncControls(); }
  function record(condition, status) {
    if (!condition) return;
    results[condition] = status;
    const output = $('result-' + condition);
    if (output) output.textContent = status;
    log(condition + ': ' + status);
  }
  function beginCondition(condition) {
    activeCondition = condition;
    log('RUN ' + (++runNumber) + ': ' + condition + ' (retain earlier log entries).');
    record(condition, 'PENDING EVIDENCE');
  }
  function run(work, condition) {
    return async () => {
      if (busy || halted) return;
      if (condition) beginCondition(condition);
      busy = true; syncControls();
      try { await work(); }
      catch (error) {
        if (error instanceof InputIssue) log(error.message);
        else {
          record(activeCondition, 'FAIL');
          halted = error instanceof StopIssue || ['P0-3', 'P0-5', 'P0-2b'].includes(activeCondition);
          // Failed manual inspections must not leave unrelated controls locked.
          if (flowRoot) flowRoot.replaceChildren();
          flow = false; flowRoot = null;
          log(error instanceof GateIssue ? error.message : 'FAIL: local test execution failed.');
          log(halted ? 'STOP AND REPORT: envelope, recovery, publisher or credential protection failed. Preserve evidence.'
            : 'Condition failed. Other conditions remain available. Preserve this failed run.');
          $('runner-status').textContent = halted ? 'Stopped: preserve evidence and report.' : 'Other conditions remain available; gate not passed.';
        }
      } finally { busy = false; syncControls(); }
    };
  }
  function paragraph(parent, text) {
    const p = document.createElement('p'); p.textContent = text; parent.append(p); return p;
  }
  function button(parent, text, work) {
    const p = document.createElement('p'), b = document.createElement('button');
    const condition = activeCondition;
    b.type = 'button'; b.textContent = text;
    b.addEventListener('click', run(async () => { activeCondition = condition; await work(); }));
    p.append(b); parent.append(p); return b;
  }
  function field(parent, text, type = 'text') {
    const p = document.createElement('p'), label = document.createElement('label'), input = document.createElement('input');
    input.id = 'inspection-' + (++fieldNumber); input.type = type; input.autocomplete = 'off';
    if (type === 'number') { input.min = '0'; input.step = '1'; input.inputMode = 'numeric'; }
    else input.size = 24;
    label.htmlFor = input.id; label.textContent = text;
    p.append(label, document.createElement('br'), input); parent.append(p); return input;
  }
  function confirmation(parent, text) {
    const p = document.createElement('p'), label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; label.append(input, document.createTextNode(' ' + text)); p.append(label); parent.append(p);
    return () => requireInput(input.checked, 'Complete the operator inspection before continuing.');
  }
  function panel(id) { const p = $(id); p.hidden = false; p.replaceChildren(); return p; }
  function counts(parent, text, names) {
    paragraph(parent, text);
    const inputs = names.map(name => field(parent, name, 'number'));
    return () => inputs.map(input => {
      const value = Number(input.value);
      requireInput(input.value !== '' && Number.isSafeInteger(value) && value >= 0,
        'Enter all observed nonnegative integer row/file counts.');
      return value;
    });
  }
  function sameCounts(before, after) {
    critical(before.length === after.length && before.every((n, i) => n === after[i]),
      'FAIL: operator-observed counts changed when zero writes were required.');
  }
  function inspectOrder(parent, title) {
    const read = counts(parent, title,
      ['Total Orders data rows', 'Total OrderLines data rows', 'Headers for this order', 'Lines for this order']);
    const confirm = confirmation(parent,
      'I inspected the same disposable deployment: TEST-BAG qty 1 and TEST-PIN qty 2, exactly one header and two lines.');
    return () => {
      const c = read(); confirm();
      critical(c[0] >= 1 && c[1] >= 2 && c[2] === 1 && c[3] === 2,
        'FAIL: test Sheet does not contain exactly one expected committed order and line set.');
      return c;
    };
  }

  async function catalogueTest() {
    const data = success(await post({ action: 'get_catalogue' }));
    const keys = ['sku_id', 'name_zh', 'name_en', 'price_sen', 'image_url', 'available'].sort();
    const parent = panel('catalogue-results');
    try {
      check(Array.isArray(data.items) && data.items.length > 0, 'FAIL: catalogue items are missing.');
      data.items.forEach(item => {
      check(object(item) && JSON.stringify(Object.keys(item).sort()) === JSON.stringify(keys) &&
        ['sku_id', 'name_zh', 'name_en', 'image_url'].every(key => typeof item[key] === 'string') &&
        Number.isSafeInteger(item.price_sen) && item.price_sen > 0 && Number.isSafeInteger(item.available) && item.available >= 0,
      'FAIL: catalogue allowlist or integer-sen assertion failed.');
      paragraph(parent, item.name_zh + ' / ' + item.name_en + ' — RM ' + (item.price_sen / 100).toFixed(2));
      });
      record('P0-1', 'PASS');
    } catch (error) {
      if (!(error instanceof GateIssue) || error instanceof StopIssue) throw error;
      record('P0-1', 'FAIL'); log(error.message);
    }
    beginCondition('P0-2');
    const checks = await Promise.allSettled([
      loadImage(parent, '/test-image.png', 'Same-origin blue and gold test pattern'),
      (async () => {
        check(typeof data.test_png_data_url === 'string' &&
          /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.test_png_data_url) && data.test_png_data_url.length < 20000,
        'FAIL: API test PNG data URL is missing or invalid.');
        return loadImage(parent, data.test_png_data_url, 'API inline blue and gold test pattern');
      })()
    ]);
    const unsafe = checks.find(result => result.status === 'rejected' && result.reason instanceof StopIssue);
    if (unsafe) throw unsafe.reason;
    checks.forEach((result, i) => log('P0-2 ' + (i ? 'inline PNG' : 'same-origin PNG') + ': ' +
      (result.status === 'fulfilled' ? 'LOAD' : 'FAIL (image error, timeout or invalid data URL)')));
    check(checks.every(result => result.status === 'fulfilled'), 'FAIL: one or both replacement images failed.');
    manualFlow(parent);
    const visible = confirmation(parent, 'Both labelled patterns visibly rendered on this signed-out real phone; I recorded the device, sign-out method and recording reference.');
    button(parent, 'Confirm both images visibly rendered', async () => {
      visible(); record('P0-2', 'PASS'); finishFlow();
    });
  }
  function loadImage(parent, src, label) {
    secrets.forEach(secret => critical(!src.includes(secret), 'FAIL: an image source contains a checkout credential.'));
    paragraph(parent, label);
    return new Promise((resolve, reject) => {
      const image = document.createElement('img'); image.width = 160;
      image.alt = label; image.referrerPolicy = 'no-referrer'; // Plain img; no crossorigin.
      const timer = setTimeout(() => finish(false), 15000);
      function finish(ok) {
        clearTimeout(timer); image.onload = null; image.onerror = null;
        if (ok && image.naturalWidth > 0 && image.naturalHeight > 0) resolve({ width: image.naturalWidth, height: image.naturalHeight });
        else { image.removeAttribute('src'); reject(new ImageIssue('FAIL: image error or timeout.')); }
      }
      image.onload = () => finish(true); image.onerror = () => finish(false);
      parent.append(image); image.src = src;
    });
  }
  function publisherTest() {
    const parent = panel('publisher-results');
    paragraph(parent, 'Run publishPhase0DummyPhoto in the Apps Script editor first. Never enter a GitHub token here. Use only its returned /photos/ path after the commit.');
    const path = field(parent, 'Published path: /photos/<file_id>-1200.jpg');
    const commit = field(parent, 'Publisher commit SHA (40 hex characters)');
    const committedAt = field(parent, 'Publisher commit acknowledged_at (ISO date/time)');
    manualFlow(parent);
    button(parent, 'Poll same-origin HEAD for up to five minutes', async () => {
      const route = path.value.trim(), sha = commit.value.trim(), committed = Date.parse(committedAt.value.trim());
      requireInput(/^\/photos\/[A-Za-z0-9_-]+-1200\.jpg$/.test(route) && /^[0-9a-f]{40}$/.test(sha), 'Enter the exact publisher path and commit SHA.');
      requireInput(Number.isFinite(committed) && committed <= Date.now(), 'Enter a valid publisher acknowledgement time.');
      const deadline = Date.now() + 300000;
      let live = false, status = 0;
      while (Date.now() < deadline) {
        try {
          const remaining = deadline - Date.now();
          status = await timedFetch(route, { method: 'HEAD', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' },
            async response => response.status, Math.min(15000, remaining));
        } catch (_) { status = 0; }
        if (status === 200) { live = true; break; }
        log('P0-2b HEAD: ' + (status || 'network/redirect/timeout') + '; waiting for deployment.');
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, deadline - Date.now()))));
      }
      critical(live, 'FAIL: publisher image did not return HEAD 200 within five minutes.');
      log('P0-2b HEAD 200; commit acknowledgement to observed live: ' + (Date.now() - committed) + ' ms; commit ' + sha + '.');
      let size;
      try { size = await loadImage(parent, route, 'Published private-staging dummy photo'); }
      catch (_) { throw new StopIssue('FAIL: published photo did not load.'); }
      critical(size.width === 1200, 'FAIL: published JPEG is not 1200 pixels wide.');
      log('P0-2b published dimensions: ' + size.width + ' x ' + size.height + '.');
      const visible = confirmation(parent, 'This published image is visible on the signed-out real phone; deployment ID, publisher route/bytes/dimensions, commit and recording are recorded.');
      button(parent, 'Confirm published phone image and evidence', async () => {
        visible(); record('P0-2b', 'PASS'); finishFlow();
      });
    });
  }

  function recoveryUI() {
    const parent = panel('recovery-controls');
    manualFlow(parent);
    paragraph(parent, 'Unknown outcome; awaiting commit verification');
    paragraph(parent, 'Before retry: inspect the test Sheet. Record the committed order, row counts and expected lines under a test-case label. Never record the request credential.');
    const observed = field(parent, 'Committed order ID observed in Sheet (not the request ID)');
    const before = inspectOrder(parent, 'Pre-retry Sheet observations (data rows exclude headings)');
    const resumed = checkout;
    button(parent, 'Reload with localStorage disabled', async () => {
      before(); requireInput(ORDER_ID.test(observed.value.trim()), 'Enter the committed TEST order ID from the Sheet.');
      fragment({ r: resumed.id, no_storage: '1' });
      // No storage access on the next page load; no checkout payload in fragment.
      location.reload();
    });
    button(parent, 'Execute Idempotent Retry', async () => {
      requireInput(checkout === resumed && checkout.stage !== 'complete', 'This retry control is no longer active.');
      const baseline = before(), expected = observed.value.trim();
      requireInput(ORDER_ID.test(expected), 'Enter the committed TEST order ID from the Sheet.');
      const data = acceptOrder(success(await post(fixture(resumed.id, 'crash_after_commit'))));
      critical(data.order_id === expected, 'FAIL: retry did not recover the order observed before retry.');
      log('PASS: retry returned the independently observed original order and fixed lines. Duplicate evidence pending.');
      parent.replaceChildren();
      const after = inspectOrder(parent, 'Post-retry Sheet inspection');
      button(parent, 'Verify no duplicate header or lines; test conflict', async () => {
        sameCounts(baseline, after());
        const altered = fixture(resumed.id, 'crash_after_commit'); altered.lines[0].qty = 2;
        expectError(await post(altered), 'REQUEST_CONFLICT');
        log('PASS: REQUEST_CONFLICT envelope. Zero-write evidence pending.');
        parent.replaceChildren();
        const final = inspectOrder(parent, 'Inspect again after the conflicting retry');
        button(parent, 'Confirm conflict made zero writes', async () => {
          sameCounts(baseline, final()); completeCheckout(); parent.replaceChildren();
          finishFlow();
          if (activeCondition === 'P0-3') record('P0-3', 'PASS');
          if (activeCondition === 'P0-5') envelopeCasePassed('Case C');
          log('PASS: operator verified no duplicate header/lines and zero writes on conflict.');
          if (storageDisabled) log('PASS: fragment-only fixture reconstruction with localStorage access disabled.');
          paragraph(parent, 'Recovery verified. Use Button 5 for the authenticated fragment link.');
        });
      });
    });
  }
  async function lostResponse(kind) {
    if (checkout && checkout.stage !== 'complete') { recoveryUI(); return; }
    const id = beginCheckout(kind);
    const result = await post(fixture(id, 'crash_after_commit'));
    critical(result.kind === 'unknown' && result.reason === 'non-json',
      'FAIL: deterministic fresh-commit hook did not produce the required non-JSON response. Preserve checkout and inspect the Sheet.');
    log('Unknown outcome; awaiting commit verification');
    recoveryUI();
  }
  async function authorizedFixture() {
    if (order) return order;
    const f = new URLSearchParams(location.hash.slice(1));
    if (f.has('o') && f.has('t')) {
      const credential = { order_id: f.get('o'), token: f.get('t') };
      secrets.add(credential.token);
      const data = success(await post({ action: 'read_order', ...credential }));
      check(data.order_id === credential.order_id, 'FAIL: authenticated order identity mismatch.');
      order = credential; return order;
    }
    const id = beginCheckout('receipt');
    acceptOrder(success(await post(fixture(id)))); completeCheckout();
    return order;
  }
  async function dummyReceipt() {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const context = canvas.getContext('2d');
    check(Boolean(context), 'FAIL: dummy receipt canvas is unavailable.');
    context.fillStyle = 'white'; context.fillRect(0, 0, 100, 100);
    context.fillStyle = 'black'; context.fillText('TEST ONLY', 10, 50);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    check(blob && blob.type === 'image/png', 'FAIL: dummy PNG encoding failed.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }
  async function receiptTest() {
    const credential = { ...await authorizedFixture() };
    const base64 = await dummyReceipt(), parent = panel('upload-results');
    manualFlow(parent);
    const names = ['UploadLog data rows', 'Files in private test receipt folder'];
    const baseline = counts(parent, 'Inspect before the invalid/missing-token attempts', names);
    const confirmBefore = confirmation(parent, 'I recorded the current private folder and UploadLog counts.');
    button(parent, 'Test invalid and missing upload tokens', async () => {
      const before = baseline(); confirmBefore();
      const payload = { action: 'upload_receipt', ...credential, mime_type: 'image/png', file_base64: base64 };
      expectError(await post({ ...payload, token: 'INVALID_TEST_TOKEN' }), 'UNAUTHORIZED');
      log('PASS: invalid upload token rejected. No-file evidence pending.');
      const missing = { ...payload }; delete missing.token;
      expectError(await post(missing), 'UNAUTHORIZED');
      log('PASS: missing upload token rejected. No-file evidence pending.');
      parent.replaceChildren();
      const after = counts(parent, 'Inspect after both unauthorized attempts', names);
      const confirmed = confirmation(parent, 'Neither unauthorized attempt created a file or UploadLog row.');
      button(parent, 'Verify zero writes and upload authorized dummy PNG', async () => {
        sameCounts(before, after()); confirmed();
        const result = await post(payload);
        // Upload retries are NOT claimed idempotent by this Phase 0 fixture.
        if (result.kind === 'unknown') {
          throw new StopIssue('FAIL: upload outcome is unknown. Inspect UploadLog and Drive; do not blindly repeat the upload.');
        }
        const data = success(result);
        check(data.status === 'received' && UUID.test(data.upload_id), 'FAIL: receipt acknowledgement shape is invalid.');
        log('PASS: authorized dummy receipt acknowledgement. Private file association evidence pending.');
        parent.replaceChildren();
        const final = counts(parent, 'Inspect the completed upload and private folder', names);
        const uploadId = field(parent, 'upload_id from the completed UploadLog row');
        const association = confirmation(parent, 'The row is completed, its file_id matches the private file, and the dummy PNG is intact and not link-shared.');
        button(parent, 'Confirm private receipt association', async () => {
          const observed = final(); association();
          check(observed[0] === before[0] + 1 && observed[1] === before[1] + 1 && uploadId.value.trim() === data.upload_id,
            'FAIL: authorized upload did not create exactly the expected associated record and private file.');
          parent.replaceChildren(); log('PASS: operator verified unauthorized zero writes and authorized private file association.');
          record('P0-4', 'PASS');
          finishFlow();
        });
      });
    });
  }

  function zeroWriteCase(parent, hook, expected, label) {
    manualFlow(parent);
    parent.replaceChildren();
    const names = ['Total Orders data rows', 'Total OrderLines data rows'];
    const baseline = counts(parent, 'Before this case: inspect both test tabs', names);
    const observed = confirmation(parent, 'I recorded baseline counts in the isolated test Sheet.');
    button(parent, 'Execute case', async () => {
      const before = baseline(); observed();
      const id = beginCheckout(label);
      expectError(await post(fixture(id, hook)), expected); completeCheckout();
      log(label + ': PASS HTTP-200 expected error envelope. No-write inspection pending.');
      parent.replaceChildren();
      if (expected === 'BUSY') {
        paragraph(parent, 'This simulates envelope handling only; it does not prove lock contention.');
        button(parent, 'Retry simulated BUSY with the same request', async () => {
          expectError(await post(fixture(id, hook)), expected);
          log('Case B: PASS simulated BUSY retry handling. Inspect zero writes before continuing.');
        });
      }
      const after = counts(parent, 'Inspect after the case and any simulated BUSY retries', names);
      const confirm = confirmation(parent, 'No order header or lines were written.');
      button(parent, 'Confirm zero order writes', async () => {
        sameCounts(before, after()); confirm(); parent.replaceChildren();
        log(label + ': PASS operator-observed zero order writes.');
        envelopeCasePassed(label);
        finishFlow();
      });
    });
  }
  async function offlineCase(parent) {
    const id = beginCheckout('offline');
    const data = acceptOrder(success(await post(fixture(id))));
    manualFlow(parent);
    // Establish a known committed baseline before physically disconnecting.
    parent.replaceChildren();
    paragraph(parent, 'Inspect the committed fixture first. Then enable Airplane Mode and turn off Wi-Fi on the real phone. navigator.onLine is only a hint.');
    const observedId = field(parent, 'Committed TEST order ID from the Sheet');
    const baseline = inspectOrder(parent, 'Before the offline request');
    const offline = confirmation(parent, 'I physically disabled network connectivity on the signed-out phone.');
    button(parent, 'Attempt request while offline', async () => {
      const before = baseline(); offline();
      check(observedId.value.trim() === data.order_id, 'FAIL: offline baseline order does not match the committed fixture.');
      const result = await post(fixture(id));
      critical(result.kind === 'unknown' && ['network', 'timeout'].includes(result.reason),
        'FAIL: real offline attempt did not produce a network failure or timeout.');
      log('Case E: unknown offline outcome handled; the same checkout credential is preserved.');
      parent.replaceChildren();
      const restored = confirmation(parent, 'I restored mobile/Wi-Fi connectivity.');
      button(parent, 'Recover the same request after restoring connectivity', async () => {
        restored();
        const recovered = acceptOrder(success(await post(fixture(id))));
        critical(recovered.order_id === data.order_id, 'FAIL: offline recovery returned a different order.');
        parent.replaceChildren();
        const after = inspectOrder(parent, 'After reconnecting and recovering the order');
        button(parent, 'Confirm offline recovery has no duplicates', async () => {
          sameCounts(before, after()); completeCheckout(); parent.replaceChildren();
          log('Case E: PASS real-offline handling and operator-verified idempotent recovery.');
          envelopeCasePassed('Case E');
          finishFlow();
        });
      });
    });
  }
  function envelopeSuite() {
    envelopeCases.clear();
    const parent = panel('network-controls');
    paragraph(parent, 'Run and record all five cases separately. Enable test hooks on the disposable backend. Evidence remains pending until each inspection is complete.');
    const detail = document.createElement('div');
    button(parent, 'Case A: Business error', async () => zeroWriteCase(detail, 'business_error', 'PRICE_CHANGED', 'Case A'));
    button(parent, 'Case B: Simulated BUSY', async () => zeroWriteCase(detail, 'simulate_busy', 'BUSY', 'Case B'));
    button(parent, 'Case C: Malformed response and recovery', async () => lostResponse('malformed'));
    button(parent, 'Case D: Unhandled platform exception', async () => {
      const result = await post({ action: 'get_catalogue', _test_hook: 'throw_unhandled' });
      critical(result.kind === 'unknown' && ['non-json', 'http', 'network', 'timeout'].includes(result.reason),
        'FAIL: deliberate platform exception did not yield an unknown platform/network outcome.');
      log('Case D: PASS platform failure handled without an unhandled client exception. No HTTP status is assumed.');
      paragraph(detail, 'Confirm the exception in the test deployment using sanitized evidence; a network failure alone cannot prove which server path executed.');
      const correlated = confirmation(detail, 'I correlated this request time with the deliberate server exception and recorded sanitized evidence.');
      button(detail, 'Confirm Case D server correlation', async () => { correlated(); envelopeCasePassed('Case D'); });
    });
    button(parent, 'Case E: Real offline failure', async () => offlineCase(detail));
    parent.append(detail);
  }
  function envelopeCasePassed(label) {
    envelopeCases.add(label); log('P0-5 ' + label + ': PASS with required observations.');
    if (envelopeCases.size === 5) record('P0-5', 'PASS');
  }

  async function checkReferrerHeader() {
    const url = new URL(location.href); url.hash = ''; url.search = '';
    let policy = '';
    try {
      policy = await timedFetch(url.href, {
        method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'
      }, async response => response.status === 200 ? response.headers.get('Referrer-Policy') : '');
    } catch (_) { /* Failure is reported without the URL or browser exception. */ }
    check(policy && policy.trim().toLowerCase() === 'no-referrer',
      'FAIL: deployed document Referrer-Policy header is missing or unreadable. Test on the Pages origin.');
    check(document.querySelector('meta[name="referrer"]')?.content === 'no-referrer',
      'FAIL: document referrer policy metadata is missing.');
    log('PASS: deployed document returned Referrer-Policy: no-referrer.');
  }
  async function fragmentTest() {
    const parent = panel('fragment-results');
    let f = new URLSearchParams(location.hash.slice(1));
    if (!f.has('o') || !f.has('t')) {
      requireInput(Boolean(order), 'First recover or create an authorized test order using Button 2 or Button 3.');
      fragment({ o: order.order_id, t: order.token });
      f = new URLSearchParams(location.hash.slice(1));
    }
    const credential = { order_id: f.get('o'), token: f.get('t') };
    requireInput(ORDER_ID.test(credential.order_id) && /^[A-Za-z0-9_-]{43}$/.test(credential.token || ''),
      'The order fragment is missing a valid test-order credential.');
    secrets.add(credential.token);
    const data = success(await post({ action: 'read_order', ...credential }));
    check(data.order_id === credential.order_id, 'FAIL: fragment read returned the wrong order.');
    order = credential;
    log('PASS: fragment credential sent in POST body and authenticated successfully.');
    const nav = performance.getEntriesByType('navigation')[0];
    if (f.get('read_again') === '1' && nav?.type === 'reload') log('PASS: authenticated fragment read repeated after a real browser refresh.');
    const tampered = { ...credential, token: (credential.token[0] === 'A' ? 'B' : 'A') + credential.token.slice(1) };
    expectError(await post({ action: 'read_order', ...tampered }), 'UNAUTHORIZED');
    expectError(await post({ action: 'read_order', order_id: credential.order_id }), 'UNAUTHORIZED');
    log('PASS: tampered and missing read credentials rejected.');
    await checkReferrerHeader();
    paragraph(parent, 'Use remote network inspection on the real phone. Check POST bodies, API and image URLs, redirects, and outgoing Referer headers. Do not export raw captures or record the address bar.');
    const inspected = confirmation(parent, 'I verified no checkout or order credential appears in any query string or outgoing Referer header, including image and redirect requests.');
    button(parent, 'Confirm sanitized outgoing-network evidence', async () => {
      inspected(); log('PASS: operator verified credential-free URLs and outgoing Referer headers. Record sanitized evidence separately.');
    });
    button(parent, 'Report observed credential leakage and stop', async () => {
      throw new StopIssue('FAIL: operator observed credential leakage. Do not paste the credential into evidence.');
    });
    button(parent, 'Refresh and repeat authenticated fragment read', async () => {
      fragment({ o: credential.order_id, t: credential.token, read_again: '1' }); location.reload();
    });
    button(parent, 'Start checkout refresh recovery without localStorage', async () => {
      await lostResponse('fragment-refresh');
      paragraph(parent, 'In the recovery controls, inspect the committed Sheet record, then choose Reload with localStorage disabled. Re-enter the observations after refresh and retry.');
    });
    const complete = confirmation(parent, 'The sanitized recording/log proves the authenticated link after a real refresh, rejected missing/tampered reads, inspected credential-free requests, and a completed storage-disabled checkout refresh/retry with unchanged Sheet counts.');
    button(parent, 'Record complete P0-6 evidence', async () => {
      complete(); record('P0-6', 'PASS');
    });
  }

  function configure() {
    const candidate = endpoint($('api-url').value.trim());
    if (!candidate) {
      syncControls(); $('connection-status').textContent = 'Enter an HTTPS script.google.com /exec URL without query or fragment'; return;
    }
    if (checkout && checkout.api && checkout.api !== candidate && checkout.stage !== 'complete') {
      api = checkout.api; $('api-url').value = api; syncControls();
      log('Finish recovery on the original test deployment before changing its URL.'); return;
    }
    const previousApi = api || checkout?.api;
    if (previousApi && previousApi !== candidate) {
      order = null; checkout = null; storage('removeItem', CHECKOUT_KEY);
      fragment({});
    }
    api = candidate; $('api-url').value = api; storage('setItem', CONFIG_KEY, api);
    if (checkout && !checkout.api) checkout.api = api;
    $('connection-status').textContent = 'Configured; connection not yet checked'; syncControls();
  }
  function initialize() {
    $('test-log').textContent = 'Phase 0 diagnostics: credentials and raw payloads are excluded.';
    $('test-origin').textContent = location.origin;
    if (location.search) {
      halted = true; record('P0-6', 'FAIL'); log('STOP: remove query parameters. Recovery credentials belong only in the fragment.'); syncControls(); return;
    }
    const f = initialFragment;
    if (f.get('t')) secrets.add(f.get('t'));
    let saved = null;
    try { saved = JSON.parse(storage('getItem', CHECKOUT_KEY) || 'null'); } catch (_) { /* Ignore invalid local metadata. */ }
    if (saved && UUID.test(saved.id) && endpoint(saved.api) && ['pending', 'complete'].includes(saved.stage)) {
      checkout = { id: saved.id, api: endpoint(saved.api), kind: 'recovered', stage: saved.stage };
    }
    if (f.has('r')) {
      if (!UUID.test(f.get('r'))) {
        halted = true; log('STOP: invalid checkout recovery fragment.'); syncControls(); return;
      }
      if (!checkout || checkout.id !== f.get('r')) checkout = { id: f.get('r'), api: '', kind: 'recovered', stage: 'pending' };
      secrets.add(checkout.id);
    } else if (checkout && checkout.stage === 'pending' && !f.has('o')) {
      fragment({ r: checkout.id }); secrets.add(checkout.id);
    }
    $('api-url').value = storage('getItem', CONFIG_KEY) || checkout?.api || '';
    $('api-url').addEventListener('change', run(configure));
    configure();
    $('runner-status').textContent = storageDisabled
      ? 'Runner ready. localStorage access disabled for this refresh-recovery test; enter the same test deployment URL.'
      : 'Runner ready. Test deployment only. Phase 0 gate requires recorded phone and operator evidence.';
    $('test-catalogue').addEventListener('click', run(catalogueTest, 'P0-1'));
    $('test-publisher').addEventListener('click', run(publisherTest, 'P0-2b'));
    $('test-recovery').addEventListener('click', run(() => lostResponse('lost-response'), 'P0-3'));
    $('test-upload').addEventListener('click', run(receiptTest, 'P0-4'));
    $('test-envelope').addEventListener('click', run(envelopeSuite, 'P0-5'));
    $('test-fragment').addEventListener('click', run(fragmentTest, 'P0-6'));
    syncControls();
    if (checkout && checkout.stage === 'pending') {
      beginCondition('P0-6');
      log('Checkout recovered locally. Inspect the Sheet before any retry.'); recoveryUI();
    }
    if (f.has('o') && f.has('t') && api) void run(fragmentTest, 'P0-6')();
  }
  try { initialize(); }
  catch (_) {
    halted = true; $('test-controls').disabled = true;
    log('STOP: runner initialization failed. No test gate is passed.');
  }
})();
