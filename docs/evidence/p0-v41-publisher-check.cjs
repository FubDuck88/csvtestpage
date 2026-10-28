// Local boundary tests for actual editor-only publisher; all services are mocks.
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const fileId = 'SYNTHETIC_FILE_ID_123', folderId = 'SYNTHETIC_STAGING_ID';
const sha = 'a'.repeat(40);
function jpeg(w, h) { return [255,216,255,192,0,11,8,h>>8,h&255,w>>8,w&255,1,1,17,0,255,217]; }
function response(status, headers = {}, bytes = [], body = '') {
  return { getResponseCode: () => status, getAllHeaders: () => headers,
    getBlob: () => ({ getBytes: () => bytes }), getContentText: () => body };
}
function setup(options = {}) {
  const calls = [], properties = { ENABLE_TEST_HOOKS: 'true', TEST_DUMMY_JPEG_FILE_ID: fileId,
    TEST_DUMMY_JPEG_APPROVED: 'true', TEST_PHOTO_STAGING_FOLDER_ID: folderId,
    TEST_RECEIPT_FOLDER_ID: 'OTHER_PRIVATE_FOLDER', GITHUB_REPO: 'synthetic/disposable',
    GITHUB_TOKEN: 'LOCAL_FAKE_PAT_NOT_A_CREDENTIAL', ...options.properties };
  const responses = options.responses || [
    response(302, { Location: 'https://lh3.googleusercontent.com/synthetic-redirect' }),
    response(200, { 'Content-Type': 'image/jpeg' }, jpeg(1200,675)),
    response(201, {}, [], JSON.stringify({ commit: { sha } }))
  ];
  const context = vm.createContext({ Date, console, PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties[k] }) },
    ScriptApp: { getOAuthToken: () => 'LOCAL_FAKE_OAUTH' },
    Utilities: { base64Encode: b => Buffer.from(b).toString('base64') },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFolderById: () => ({ getSharingAccess: () => options.folderAccess || 'PRIVATE' }),
      getFileById: () => ({ getSharingAccess: () => 'PRIVATE', isTrashed: () => false,
        getParents() { let done = false; return { hasNext: () => !done, next() { done = true; return { getId: () => folderId }; } }; },
        getMimeType: () => 'image/jpeg', getSize: () => options.sourceBytes || 1000,
        getBlob: () => ({ getBytes: () => jpeg(1600,900) }) }) },
    UrlFetchApp: { fetch(url, opts) { calls.push({url, opts}); const r = responses.shift(); if (r instanceof Error) throw r;
      assert.ok(r, 'Unexpected outbound call'); return r; } }
  });
  vm.runInContext(fs.readFileSync('apps-script/PhotoPublisher.js','utf8'), context);
  return { result: () => context.publishPhotoToRepo(fileId), calls, context };
}
let tests = 0;
function test(label, fn) { fn(); tests++; console.log('PASS ' + label); }
test('private approved JPEG publishes only resized bytes at the file-ID path', () => {
  const env = setup(), r = env.result(); assert.equal(r.ok,true); assert.equal(r.width,1200); assert.equal(r.height,675);
  assert.equal(r.commit_sha,sha); assert.equal(r.live,'NOT_CHECKED');
  const [drive,redirect,put] = env.calls;
  assert.equal(drive.opts.headers.Authorization, 'Bearer LOCAL_FAKE_OAUTH');
  assert.deepEqual(Object.keys(redirect.opts.headers), []);
  assert.equal(put.opts.method,'put'); assert.equal(put.url, 'https://api.github.com/repos/synthetic/disposable/contents/poc-web/photos/'+fileId+'-1200.jpg');
  assert.equal(JSON.parse(put.opts.payload).content, Buffer.from(jpeg(1200,675)).toString('base64'));
  assert.equal('sha' in JSON.parse(put.opts.payload),false, 'No overwrite on a blind repeat');
  assert.ok(env.calls.every(c => c.opts.followRedirects === false));
  assert.ok(!JSON.stringify(r).includes('LOCAL_FAKE'));
});
test('public staging, unapproved file, disabled hooks and oversized original make no network calls', () => {
  for (const options of [{folderAccess:'ANYONE_WITH_LINK'}, {properties:{TEST_DUMMY_JPEG_APPROVED:'false'}},
    {properties:{ENABLE_TEST_HOOKS:'false'}}, {sourceBytes:2500001}]) {
    const e=setup(options); assert.equal(e.result().ok,false); assert.equal(e.calls.length,0);
  }
});
test('untrusted thumbnail redirect cannot receive OAuth or trigger GitHub publication', () => {
  const e=setup({responses:[response(302,{Location:'https://attacker.invalid/steal'})]});
  assert.equal(e.result().code,'THUMBNAIL_REDIRECT_REJECTED'); assert.equal(e.calls.length,1);
});
test('HTML, wrong dimensions and thumbnail HTTP failure report route-1 failure without a commit', () => {
  for(const r of [response(200,{'Content-Type':'text/html'}), response(200,{'Content-Type':'image/jpeg'},jpeg(100,50)),response(403)]) {
    const e=setup({responses:[r]}), result=e.result(); assert.equal(result.ok,false);
    assert.equal(result.stage,'thumbnail'); assert.equal(result.next,'RECORD_ROUTE_1_FAILURE_THEN_PREPARE_ROUTE_2_BUILD');
    assert.equal(e.calls.length,1);
  }
});
test('GitHub rejection and lost acknowledgement stop without retries or secret output', () => {
  for (const last of [response(401), response(422), new Error('LOCAL_FAKE_PAT_NOT_A_CREDENTIAL')]) {
    const e=setup({responses:[response(200,{'Content-Type':'image/jpeg'},jpeg(1200,675)),last]}), result=e.result();
    assert.equal(result.ok,false); assert.equal(result.next,'STOP_INSPECT_REPO_BEFORE_ANY_RETRY');
    assert.equal(e.calls.length,2); assert.ok(!JSON.stringify(result).includes('LOCAL_FAKE'));
  }
});
test('static PNG and API inline PNG match; deployed source no longer includes the Drive probe', () => {
  const context=vm.createContext({}); vm.runInContext(fs.readFileSync('apps-script/TestHooks.js','utf8'),context);
  const data=context.fixtureCatalogueResponse_(), png=Buffer.from(data.test_png_data_url.split(',')[1],'base64');
  assert.deepEqual(png,fs.readFileSync('poc-web/test-image.png')); assert.equal(png.readUInt32BE(16),64); assert.equal(png.readUInt32BE(20),64);
  assert.ok(data.items.every(item => item.image_url === '/test-image.png'));
  assert.match(fs.readFileSync('poc-web/_headers','utf8'), /img-src 'self' data:;/);
  assert.ok(!fs.existsSync('poc-web/image-probe.js')); assert.ok(!fs.existsSync('poc-web/image-probe.html'));
  assert.ok(!fs.readFileSync('apps-script/Code.js','utf8').includes("case 'publish"));
});
console.log('RESULT '+tests+' local publisher/image checks passed; no live publication or phone result claimed.');
