// Offline regression: execute the real runner; never contact deployed services.
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false });
  return elements.get(id);
};
let deadline = 0;
const context = vm.createContext({ URL, URLSearchParams, Date, AbortController,
  setTimeout(fn, ms) { deadline = ms; return 1; }, clearTimeout() {},
  fetch: async (_, options) => {
    // Model a readable acknowledgement at 23 seconds. A 15s deadline fails.
    if (deadline < 23000) { const e = new Error('Simulated deadline'); e.name='AbortError'; throw e; }
    return {status:200,url:'https://script.googleusercontent.com/synthetic',text:async()=>JSON.stringify({ok:true,data:{status:'received'}})};
  },
  location: { hash: '', search: '', href: 'https://example.invalid/', origin: 'https://example.invalid' },
  document: { getElementById: element, querySelectorAll: () => [] } });
let source = fs.readFileSync('poc-web/test-runner.js', 'utf8');
source = source.slice(0, source.indexOf('  try { initialize(); }')) + `
globalThis.probe = { run, GateIssue, success, post, state: () => ({halted, busy}),
  setup() { api = 'https://script.google.com/macros/s/LOCAL/exec'; $('api-url').value = api; } }; })();`;
vm.runInContext(source, context);
(async () => {
  const p = context.probe; p.setup();
  assert.equal((await p.post({action:'upload_receipt'})).kind,'envelope', 'A 23s upload acknowledgement must fit its bounded deadline');
  assert.equal(deadline,60000);
  assert.equal((await p.post({action:'get_catalogue'})).kind,'unknown');
  assert.equal(deadline,15000, 'Ordinary request deadline remains bounded at 15s');
  await p.run(async () => { throw new p.GateIssue('FAIL: ordinary condition assertion.'); }, 'P0-4')();
  assert.equal(p.state().halted, false, 'An ordinary condition failure must leave unrelated tests available');
  let laterRan = false;
  await p.run(async () => { laterRan = true; }, 'P0-6')();
  assert.equal(laterRan, true, 'A later condition must actually execute');
  await p.run(async () => p.success({ kind: 'unknown', reason: 'non-json' }), 'P0-1')();
  assert.equal(p.state().halted, true, 'Unexpected unreadable envelope must still halt');
  console.log('PASS upload deadline covers observed 23s commit; ordinary failure permits later work; unreadable envelope stops.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
