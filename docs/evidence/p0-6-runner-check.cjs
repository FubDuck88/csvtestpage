'use strict';
// Real runner callbacks and initialize/configure across modeled page reloads.
// Synthetic services and operator observations; no live browser/gate claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(process.env.P06_RUNNER_SOURCE || 'poc-web/test-runner.js', 'utf8');
const entry = source.indexOf('  try { initialize(); }');
const api = 'https://script.google.com/macros/s/LOCAL/exec';
const authOrder = 'TEST-' + webcrypto.randomUUID();
const recoveredOrder = 'TEST-' + webcrypto.randomUUID();
const token = 'a'.repeat(43);
const key = 'csv-p0-evidence-v1';

function journey() {
  const state = { session: new Map(), local: new Map([['csv-p0-api-v1', api]]),
    href: 'https://example.invalid/#o=' + authOrder + '&t=' + token,
    nav: 'navigate', reloads: 0, sent: [], storageCalls: 0, snapshots: [], logs: [] };
  async function page() {
    const buttons = new Map(), elements = new Map();
    const el = id => {
      if (!elements.has(id)) elements.set(id, { value: '', textContent: '', replaceChildren() {}, append() {},
        addEventListener: (_, cb) => buttons.set(id, cb) });
      return elements.get(id);
    };
    const location = { get href() { return state.href; }, get hash() { return new URL(state.href).hash; },
      search: '', origin: 'https://example.invalid', reload() { state.reloads++; state.nav = 'reload'; } };
    const context = vm.createContext({ URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
      crypto: webcrypto, location, history: { replaceState(_, __, url) { state.href = url; } },
      performance: { getEntriesByType: () => [{ type: state.nav }] },
      document: { getElementById: el, querySelectorAll: () => [], querySelector: () => ({ content: 'no-referrer' }),
        createElement: () => ({ append() {}, addEventListener(_, cb) { buttons.set(this.textContent, cb); } }) },
      window: { sessionStorage: {
        getItem(k) { if (state.broken) throw Error('blocked'); return state.session.get(k) ?? null; },
        setItem(k, value) { if (state.broken) throw Error('blocked'); state.session.set(k, value); state.snapshots.push(value); }
      }, localStorage: Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(method => [method, (k, value) => {
        if (new URL(state.href).hash.includes('no_storage=1') || state.assertDisabled) { state.storageCalls++; throw Error('localStorage touched'); }
        if (method === 'getItem') return state.local.get(k) ?? null;
        if (method === 'setItem') state.local.set(k, value); else state.local.delete(k);
      }])) },
      fetch: async (_, options) => {
        if (options.method === 'GET') return { status: 200, headers: { get: () => 'no-referrer' } };
        const body = JSON.parse(options.body); state.sent.push(body);
        let envelope;
        if (body.action === 'read_order') envelope = body.token === token
          ? { ok: true, data: { order_id: body.order_id } }
          : { ok: false, error: { code: 'UNAUTHORIZED', message: 'test', detail: {} } };
        else {
          const attempts = state.sent.filter(b => b.action === 'create_order');
          if (attempts.length === 1) return { status: 200, text: async () => '<lost response>' };
          envelope = body.lines[0].qty === 2
            ? { ok: false, error: { code: 'REQUEST_CONFLICT', message: 'test', detail: {} } }
            : { ok: true, data: { order_id: recoveredOrder, token, total_sen: 2200,
              lines: [{ sku_id: 'TEST-BAG', qty: 1, price_sen: 1200 }, { sku_id: 'TEST-PIN', qty: 2, price_sen: 500 }] } };
        }
        return { status: 200, text: async () => JSON.stringify(envelope) };
      }, buttons, observed: state.observed || recoveredOrder, observedCounts: state.counts || [8,16,1,2]
    });
    const prefix = source.slice(0, entry);
    vm.runInContext((prefix + `
      paragraph = () => {};
      field = () => ({value: observed});
      confirmation = () => () => {};
      inspectOrder = () => () => observedCounts;
      globalThis.inspect = () => ({progress: typeof progress === 'undefined' ? null : progress, result: results['P0-6']});
      globalThis.drop = key => { progress.steps[key] = false; saveProgress(); };
      globalThis.fail = run(() => { throw new GateIssue('FAIL: synthetic relevant failure.'); }, 'P0-6');
      globalThis.start = run(fragmentTest, 'P0-6');
      initialize();
    })();`).replace('void run(fragmentTest, \'P0-6\')();', "globalThis.ready = run(fragmentTest, 'P0-6')();"), context);
    await context.ready;
    const result = { context, buttons, el,
      async click(label) { if (!buttons.has(label)) console.error(el('test-log').textContent); assert.ok(buttons.has(label), 'Missing control: ' + label); await buttons.get(label)(); },
      inspect: () => context.inspect() };
    state.logs.push(() => el('test-log').textContent);
    return result;
  }
  async function complete() {
    let p = await page();
    await p.click('Refresh and repeat authenticated fragment read');
    p = await page();
    state.assertDisabled = true;
    await p.click('Start checkout refresh recovery without localStorage');
    await p.click('Reload with localStorage disabled');
    p = await page();
    // Disabled localStorage intentionally cannot supply the endpoint.
    p.el('api-url').value = api;
    await p.click('api-url');
    await p.click('Execute Idempotent Retry');
    await p.click('Verify no duplicate header or lines; test conflict');
    await p.click('Confirm conflict made zero writes');
    await p.context.start();
    await p.click('Confirm sanitized outgoing-network evidence');
    return p;
  }
  return { state, page, complete };
}

(async () => {
  if (process.env.P06_BASELINE_PROBE) {
    const j = journey(), p = await j.page();
    await p.click('Record complete P0-6 evidence');
    assert.equal(p.inspect().result, 'PASS');
    console.log('REPRODUCED IR-01: baseline awards PASS after initial read and final attestation only.');
    return;
  }
  {
    const j = journey(), p = await j.page();
    await p.click('Record complete P0-6 evidence');
    assert.notEqual(p.inspect().result, 'PASS');
    await p.click('Confirm sanitized outgoing-network evidence');
    assert.equal(p.inspect().progress.steps.network, false);
  }
  for (const step of ['initial', 'refresh', 'rejected', 'policy', 'uncertain', 'preReload', 'reloaded', 'retry', 'conflict', 'network']) {
    const j = journey(), p = await j.complete();
    p.context.drop(step);
    await p.click('Record complete P0-6 evidence');
    assert.notEqual(p.inspect().result, 'PASS', 'Omitted step passed: ' + step);
  }
  {
    const j = journey(), p = await j.complete();
    await p.click('Record complete P0-6 evidence');
    assert.equal(p.inspect().result, 'PASS');
    assert.equal(j.state.reloads, 2);
    assert.equal(j.state.storageCalls, 0);
    const mutations = j.state.sent.filter(b => b.action === 'create_order');
    assert.equal(mutations.length, 3);
    assert.equal(mutations[0].request_id, mutations[1].request_id);
    assert.equal(mutations[0].request_id, mutations[2].request_id);
    const metadata = j.state.snapshots.join('\n'), logs = j.state.logs.map(read => read()).join('\n');
    for (const secret of [token, mutations[0].request_id, 'phase-zero@example.invalid', '0123456789']) {
      assert.ok(!metadata.includes(secret) && !logs.includes(secret), 'Secret entered progress or logs');
    }
  }
  {
    const j = journey(), p = await j.complete();
    const stale = p.buttons.get('Record complete P0-6 evidence');
    await p.click('Start a new P0-6 evidence run');
    await stale();
    assert.notEqual(p.inspect().result, 'PASS');
    assert.match(p.el('test-log').textContent, /invalidated run/);
  }
  {
    const j = journey(); let p = await j.page();
    await p.click('Refresh and repeat authenticated fragment read'); p = await j.page();
    j.state.assertDisabled = true;
    await p.click('Start checkout refresh recovery without localStorage');
    await p.click('Reload with localStorage disabled');
    j.state.session.delete(key);
    p = await j.page(); p.el('api-url').value = api; await p.click('api-url');
    await p.click('Execute Idempotent Retry');
    await p.click('Verify no duplicate header or lines; test conflict');
    await p.click('Confirm conflict made zero writes');
    await p.context.start(); await p.click('Record complete P0-6 evidence');
    assert.notEqual(p.inspect().result, 'PASS');
    assert.equal(j.state.sent.filter(b => b.action === 'create_order').length, 3, 'Missing evidence created a replacement checkout');
    assert.equal(j.state.storageCalls, 0);
  }
  for (const mode of ['counts', 'order', 'no-reload']) {
    const j = journey(); let p = await j.page();
    await p.click('Refresh and repeat authenticated fragment read'); p = await j.page();
    j.state.assertDisabled = true;
    await p.click('Start checkout refresh recovery without localStorage');
    await p.click('Reload with localStorage disabled');
    if (mode === 'counts') j.state.counts = [9,18,1,2];
    if (mode === 'order') j.state.observed = authOrder;
    if (mode === 'no-reload') j.state.nav = 'navigate';
    p = await j.page(); p.el('api-url').value = api; await p.click('api-url');
    await p.click('Execute Idempotent Retry');
    assert.ok(!p.inspect().progress?.steps.retry, mode + ' granted retry completion');
    assert.notEqual(p.inspect().result, 'PASS');
  }
  for (const mode of ['absent', 'corrupt', 'blocked', 'revision', 'fixture', 'endpoint', 'marker-only', 'navigate']) {
    const j = journey(); let p = await j.page();
    await p.click('Refresh and repeat authenticated fragment read');
    if (mode === 'absent') j.state.session.delete(key);
    if (mode === 'corrupt') j.state.session.set(key, '{bad');
    if (mode === 'blocked') j.state.broken = true;
    if (['revision', 'fixture', 'endpoint'].includes(mode)) {
      const data = JSON.parse(j.state.session.get(key));
      data[mode === 'endpoint' ? 'api' : mode] = 'changed'; j.state.session.set(key, JSON.stringify(data));
    }
    if (mode === 'marker-only') { const data = JSON.parse(j.state.session.get(key)); data.pending = null; j.state.session.set(key, JSON.stringify(data)); }
    if (mode === 'navigate') j.state.nav = 'navigate';
    p = await j.page();
    await p.click('Record complete P0-6 evidence');
    assert.notEqual(p.inspect().result, 'PASS', mode);
    assert.ok(!p.inspect().progress?.steps.refresh, mode + ' granted refresh');
  }
  {
    const j = journey(), p = await j.complete();
    await p.context.fail();
    await p.click('Record complete P0-6 evidence');
    assert.notEqual(p.inspect().result, 'PASS');
    assert.equal(p.inspect().progress, null);
  }
  console.log('PASS P0-6: skipped steps, complete callbacks across two reloads, stale/invalid/unavailable progress, failure invalidation, disabled localStorage, identical request recovery and credential exclusion.');
})().catch(error => {
  console.error(error.stack.split('\n').filter(line => line.trim().startsWith('at ')).join('\n'));
  console.error('FAIL P0-6 runner regression'); process.exitCode = 1;
});
