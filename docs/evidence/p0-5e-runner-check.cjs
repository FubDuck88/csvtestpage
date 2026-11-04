'use strict';

const assert = require('node:assert/strict');
const { randomUUID, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('poc-web/test-runner.js', 'utf8');
const entry = source.indexOf('  try { initialize(); }');
assert.ok(entry >= 0, 'Runner entry point missing');

async function test(mode) {
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
      if (mode !== 'match' && value._p05e_reference) {
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
  assert.equal(sent.length, 3);
  const [initial, offline, reconnect] = sent;
  assert.ok(JSON.stringify(initial) === JSON.stringify(offline), 'Offline fixture changed');
  assert.equal(initial.lines[0].qty, 2);
  assert.equal(initial.lines[1].qty, 2);
  assert.equal(initial.quoted_total_sen, 3400);
  assert.ok(initial.email.endsWith('@example.invalid'));
  assert.ok(!('_p05e_reference' in initial) && reconnect._p05e_reference === orderId, 'Reference placement changed');
  assert.match(log, /OFFLINE_OUTBOUND equal_raw=true equal_normalized=true/);
  if (mode !== 'match') {
    const expected = mode === 'mismatch' ? changedRequestId : initial.request_id.toUpperCase();
    assert.ok(reconnect.request_id === expected, 'Mutation did not reach transport');
    assert.ok(log.includes('RECONNECT_OUTBOUND equal_raw=false equal_normalized=' + (mode === 'case-only')));
    assert.match(log, /FAIL: offline recovery returned a different order\./);
    assert.match(log, /STOP AND REPORT/);
  } else {
    assert.ok(reconnect.request_id === initial.request_id, 'Reconnect ID changed');
    assert.match(log, /RECONNECT_OUTBOUND equal_raw=true equal_normalized=true/);
    await buttons.get('Confirm offline recovery has no duplicates')();
    assert.match(element('test-log').textContent, /P0-5 Case E: PASS/);
  }
  const captured = [...elements.values()].map(item => item.textContent).concat(consoleOutput).join('\n');
  assert.ok([initial.request_id, reconnect.request_id, changedRequestId, orderId, otherOrderId, token]
    .every(id => !captured.includes(id)),
    'Fixture identifier leaked to simulated runner display or console');
}

(async () => {
  await test('match');
  await test('mismatch');
  await test('case-only');
  console.log('PASS Case E simulated recovery, changed outbound ID, stop behavior and exact fixture-ID scan');
})().catch(() => {
  console.error('FAIL Case E simulated runner check');
  process.exitCode = 1;
});
