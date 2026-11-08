'use strict';

const assert = require('node:assert/strict');
const { randomUUID, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.P05E_RUNNER_SOURCE || 'poc-web/test-runner.js', 'utf8');
const entry = source.indexOf('  try { initialize(); }');
assert.ok(entry >= 0, 'Runner entry point missing');

async function test(mode) {
  console.log('Checking ' + mode);
  const orderId = 'TEST-' + randomUUID();
  const otherOrderId = 'TEST-' + randomUUID();
  const changedRequestId = randomUUID();
  const token = 'a'.repeat(43);
  const sent = [], buttons = new Map(), elements = new Map(), consoleOutput = [];
  const element = key => {
    if (!elements.has(key)) elements.set(key, { textContent: '', replaceChildren() {} });
    return elements.get(key);
  };
  const context = vm.createContext({
    mode, orderId, changedRequestId, buttons, URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout, crypto: webcrypto, history: { replaceState() {} },
    console: {
      log: message => consoleOutput.push(String(message)),
      error: message => consoleOutput.push(String(message))
    },
    location: { href: 'https://example.invalid/', hash: '' },
    document: { getElementById: element, querySelectorAll: () => [] },
    fetch: async (_, options) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (sent.length === 2) throw new Error(body.request_id + ' ' + orderId);
      const returnedOrder = sent.length === 3 && body.request_id !== sent[0].request_id ? otherOrderId : orderId;
      const data = {
        order_id: returnedOrder, token, total_sen: 3400,
        lines: [{ sku_id: 'TEST-BAG', qty: 2, price_sen: 1200 }, { sku_id: 'TEST-PIN', qty: 2, price_sen: 500 }]
      };
      if (sent.length === 3) {
        data.p05e = {
          version: 'server-v2', reference_row_loaded: true,
          lookup_found_original: body.request_id === sent[0].request_id,
          equal_raw: body.request_id === sent[0].request_id,
          equal_normalized: body.request_id.toLowerCase() === sent[0].request_id.toLowerCase(),
          outcome: returnedOrder === orderId ? 'ORIGINAL_ROW_REUSED' : 'NEW_ROW_WRITTEN'
        };
        if (mode === 'malformed') data.p05e.outcome = orderId + token;
        if (mode === 'absent') delete data.p05e;
        if (mode.startsWith('false:')) data.p05e[mode.slice(6)] = false;
        if (mode.startsWith('outcome:')) data.p05e.outcome = mode.slice(8);
        if (mode === 'wrong-order') data.order_id = otherOrderId;
      }
      return { status: 200, text: async () => JSON.stringify({ ok: true, data }) };
    }
  });
  vm.runInContext(source.slice(0, entry) + `
    api = 'https://script.google.com/macros/s/LOCAL/exec';
    $('api-url').value = api;
    storageDisabled = true;
    field = () => ({value:orderId});
    paragraph = () => {};
    confirmation = () => () => {};
    inspectOrder = () => () => [6,12,1,2];
    button = (_, label, work) => buttons.set(label, run(work));
    const stringify = JSON.stringify;
    JSON.stringify = value => {
      if (['mismatch', 'case-only'].includes(mode) && value._p05e_reference) {
        const requestId = mode === 'mismatch' ? changedRequestId : value.request_id.toUpperCase();
        return stringify({...value, request_id:requestId});
      }
      return stringify(value);
    };
    globalThis.start = run(() => offlineCase({replaceChildren(){}}), 'P0-5');
  })();`, context);
  await context.start();
  await buttons.get('Attempt request while offline')();
  await buttons.get('Recover the same request after restoring connectivity')();
  const log = element('test-log').textContent;
  assert.equal(sent.length, ['mismatch', 'case-only'].includes(mode) ? 2 : 3);
  const [initial, offline, reconnect] = sent;
  assert.ok(JSON.stringify(initial) === JSON.stringify(offline), 'Offline fixture changed');
  assert.equal(initial.lines[0].qty, 2);
  assert.equal(initial.lines[1].qty, 2);
  assert.equal(initial.quoted_total_sen, 3400);
  assert.ok(initial.email.endsWith('@example.invalid'));
  assert.ok(!('_p05e_reference' in initial) && (!reconnect || reconnect._p05e_reference === orderId), 'Reference placement changed');
  assert.match(log, /OFFLINE_OUTBOUND equal_raw=true equal_normalized=true/);
  if (['malformed', 'absent'].includes(mode)) {
    assert.match(log, /server-v2 DIAGNOSTIC_UNAVAILABLE/);
    assert.match(log, /STOP: server diagnostic evidence unavailable/);
  } else if (process.env.P05E_BASELINE_PROBE) {
    await buttons.get('Confirm offline recovery has no duplicates')();
    assert.match(element('test-log').textContent, /P0-5 Case E: PASS/);
  } else if (mode.startsWith('false:') || mode.startsWith('outcome:')) {
    assert.match(log, /STOP: server diagnostic evidence unavailable or inconsistent/);
    assert.ok(!buttons.has('Confirm offline recovery has no duplicates'));
  } else if (mode === 'wrong-order') {
    assert.match(log, /FAIL: offline recovery returned a different order/);
  } else if (mode !== 'match') {
    assert.ok(!reconnect, 'Changed identity reached transport');
    assert.ok(log.includes('RECONNECT_OUTBOUND equal_raw=false equal_normalized=' + (mode === 'case-only')));
    assert.match(log, /STOP: outbound request identity changed/);
    assert.match(log, /STOP AND REPORT/);
  } else {
    assert.ok(reconnect.request_id === initial.request_id, 'Reconnect ID changed');
    assert.match(log, /RECONNECT_OUTBOUND equal_raw=true equal_normalized=true/);
    assert.match(log, /server-v2 ORIGINAL_ROW_REUSED/);
    await buttons.get('Confirm offline recovery has no duplicates')();
    assert.match(element('test-log').textContent, /P0-5 Case E: PASS/);
  }
  const captured = [...elements.values()].map(item => item.textContent).concat(consoleOutput).join('\n');
  assert.ok([initial.request_id, reconnect?.request_id, changedRequestId, orderId, otherOrderId, token]
    .filter(Boolean).every(id => !captured.includes(id)),
    'Fixture identifier leaked to simulated runner display or console');
}

(async () => {
  if (process.env.P05E_BASELINE_PROBE) {
    for (const field of ['reference_row_loaded', 'lookup_found_original', 'equal_raw', 'equal_normalized']) await test('false:' + field);
    for (const outcome of ['OTHER_ROW_REUSED', 'NEW_ROW_WRITTEN']) await test('outcome:' + outcome);
    console.log('REPRODUCED IR-03: baseline accepts all six contradictory diagnostics.');
    return;
  }
  await test('match');
  await test('mismatch');
  await test('case-only');
  await test('malformed');
  await test('absent');
  await test('wrong-order');
  for (const field of ['reference_row_loaded', 'lookup_found_original', 'equal_raw', 'equal_normalized']) await test('false:' + field);
  for (const outcome of ['OTHER_ROW_REUSED', 'NEW_ROW_WRITTEN']) await test('outcome:' + outcome);
  console.log('PASS Case E: 12 real-runner scenarios; diagnostic contradictions rejected; changed identity blocked before dispatch; fixture output scan');
})().catch(error => {
  console.error(error.stack.split('\n').filter(line => line.trim().startsWith('at ')).join('\n'));
  console.error('FAIL Case E simulated runner check');
  process.exitCode = 1;
});
