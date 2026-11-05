'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('apps-script/Code.js', 'utf8');
const requestId = randomUUID();
const reference = 'TEST-' + randomUUID();
const fixture = {
  action: 'create_order', request_id: requestId, name: 'Synthetic Phase Zero',
  email: 'phase-zero-offline@example.invalid', whatsapp: '0100000000',
  slot_id: 'TEST-SLOT', quoted_total_sen: 3400,
  lines: [{ sku_id: 'TEST-BAG', qty: 2 }, { sku_id: 'TEST-PIN', qty: 2 }]
};

function run(scenario, hooks, withReference, options = {}) {
  const tables = { Orders: [], OrderLines: [], TransitionLog: [] };
  const hashInputs = [], output = [];
  const context = vm.createContext({
    tables, fixture, reference, scenario,
    console: { log: line => output.push(line) },
    Utilities: { getUuid: () => reference.slice(5) },
    SpreadsheetApp: { flush() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => key === 'ENABLE_TEST_HOOKS' ? hooks :
        (options.expiry === undefined ? '2099-01-01T00:00:00.000Z' : options.expiry)
    }) },
    hash: value => {
      hashInputs.push(value);
      return createHash('sha256').update(value).digest('hex');
    }
  });
  vm.runInContext(source + `
    Date.now = () => 1700000000000;
    respond_ = work => {
      try { return work(); }
      catch (error) { if (error.code === 'REQUEST_CONFLICT') return {ok:false, code:error.code}; throw error; }
    };
    withLock_ = work => work();
    hash_ = hash;
    sheet_ = () => tables;
    rows_ = (book, table) => book[table];
    write_ = (book, table, row) => book[table].push(row);
    token_ = () => 'synthetic-test-token';
    testHook_ = () => null;
    fixtureCatalogue_ = () => [{sku_id:'TEST-BAG',price_sen:1200},{sku_id:'TEST-PIN',price_sen:500}];
    orderData_ = (_, row) => ({order_id:row.order_id,total_sen:row.total_sen});
    success_ = data => ({ok:true,data});
    fail_ = code => { throw Object.assign(new Error('Checkout rejected'),{code}); };
    if (scenario !== 'create') {
      tables.Orders.push({order_id:reference,request_id:fixture.request_id,total_sen:3400,is_test:true,
        fingerprint:scenario === 'conflict' ? 'different' : hash_(JSON.stringify(canonical_(fixture)))});
    }
    const canonical = canonical_;
    canonical_ = request => {
      if ('_p05e_reference' in request || '_p05e_token' in request) throw Error('Diagnostic field was not stripped');
      return canonical(request);
    };
  `, context);
  const body = withReference ? { ...fixture, _p05e_reference: options.reference || reference,
    _p05e_token: options.token === undefined ? 'synthetic-test-token' : options.token } : fixture;
  const result = context.doPost({ postData: { contents: JSON.stringify(body) } });
  const diagnostic = result.data?.p05e;
  if (diagnostic) {
    assert.deepEqual(JSON.parse(JSON.stringify(diagnostic)), {
      version: 'server-v2', reference_row_loaded: true, lookup_found_original: true,
      equal_raw: true, equal_normalized: true, outcome: 'ORIGINAL_ROW_REUSED'
    });
    assert.ok(!JSON.stringify(diagnostic).includes(requestId) && !JSON.stringify(diagnostic).includes(reference));
    delete result.data.p05e;
  }
  assert.equal(output.some(line => line.includes(requestId) || line.includes(reference)), false);
  return {
    state: JSON.stringify({ result, tables, hashInputs }),
    orders: tables.Orders.length,
    lines: tables.OrderLines.length,
    ok: result.ok,
    diagnostic
  };
}

for (const scenario of ['create', 'replay', 'conflict']) {
  const baseline = run(scenario, null, false);
  assert.equal(baseline.ok, scenario !== 'conflict');
  assert.equal(baseline.orders, 1);
  assert.equal(baseline.lines, scenario === 'create' ? 2 : 0);
  for (const [hooks, withReference] of [['true', true], ['true', false], [null, true]]) {
    assert.ok(run(scenario, hooks, withReference).state === baseline.state,
      'Checkout response, hashes or ledger changed under diagnostics');
  }
}
assert.ok(run('replay', 'true', true).diagnostic, 'Authorized replay diagnostics missing');
for (const options of [
  {token:'wrong'}, {token:null}, {reference:'invalid'}, {reference:'TEST-' + randomUUID()},
  {expiry:''}, {expiry:'invalid'}, {expiry:'2000-01-01T00:00:00.000Z'}
]) {
  assert.ok(!run('replay', 'true', true, options).diagnostic, 'Diagnostic gate did not fail closed');
}
assert.ok(!run('replay', null, true).diagnostic, 'Disabled hook exposed diagnostics');

const probe = vm.createContext({});
vm.runInContext(source + `token_ = () => 'synthetic-test-token';`, probe);
const original = {order_id:reference, request_id:requestId, is_test:true};
const access = {reference, token:'synthetic-test-token'};
const mismatch = probe.offlineResponseDiagnostic_(access, [original], null, randomUUID());
assert.equal(mismatch.equal_raw, false);
assert.equal(mismatch.equal_normalized, false);
assert.equal(mismatch.lookup_found_original, false);
const normalized = probe.offlineResponseDiagnostic_(access,
  [{...original, request_id:' ' + requestId.toUpperCase() + ' '}], null, requestId);
assert.equal(normalized.equal_raw, false);
assert.equal(normalized.equal_normalized, true);
assert.equal(probe.offlineResponseDiagnostic_(access,
  [{...original, get request_id() { throw Error(requestId + reference); }}], null, requestId), null);
assert.ok(![requestId,reference].some(id => JSON.stringify([mismatch,normalized]).includes(id)));
console.log('PASS Case E server differential for create, replay and conflict');
