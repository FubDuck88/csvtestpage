/** Phase 0 Task 0.1; disposable fixtures, never production data/accounts.
 * Sections 4, 5.1, 5.2, 5.5, 5.6, 5.9, 5.11, 6, 9.
 * Deferred per ticket: stock/capacity, slot/consent/catalogue versions,
 * integrity recovery, checkout limits, email, cancellation, receipt replacement,
 * deduplication and orphan reconciliation (Sections 5.1/5.9; later phases).
 * No stored token. No credential-bearing GET routes. No logging.
 * Manifest: execute as test deployer, anonymous access; test /exec, not /dev.
 *
 * Script Properties: TEST_SHEET_ID, TEST_RECEIPT_FOLDER_ID, server_secret,
 * TEST_MAX_UPLOAD_BYTES (required positive integer; Section 5.9 Config cap).
 * Optional: ENABLE_TEST_HOOKS=true (disposable test only).
 * Receipt body: {action:'upload_receipt', order_id, token, mime_type,
 *               file_base64}; use only synthetic JPEG/PNG/PDF files.
 * Run initializePhase0TestSheet once from editor; never from public routing.
 */
var PHASE0_SCHEMA_ = {
  Orders: ['order_id', 'request_id', 'fingerprint', 'token_version', 'created_at',
    'name', 'whatsapp_norm', 'email_norm', 'status', 'expires_at', 'first_receipt_at',
    'paid_at', 'collected_at', 'closed_at', 'last_reviewed_at', 'slot_id',
    'slot_snapshot', 'slot_version_booked', 'dest_id', 'instructions_version',
    'total_sen', 'catalogue_version', 'consent_policy_version', 'consent_at',
    'flags', 'notes', 'is_test', 'op_id'],
  OrderLines: ['op_id', 'order_id', 'sku_id', 'qty', 'price_sen'],
  UploadLog: ['upload_id', 'order_id', 'file_id', 'sha256', 'created_at', 'status', 'superseded_by'],
  TransitionLog: ['op_id', 'from', 'to', 'actor', 'reason', 'time']
};

function doGet(e) {
  // GET is public catalogue only. Never accept credentials from query strings.
  return respond_(function () {
    var p = (e && e.parameter) || {};
    if (Object.keys(p).some(function (key) { return key !== 'action'; })) {
      fail_('INVALID_REQUEST', 'GET accepts only a catalogue action');
    }
    if (p.action && p.action !== 'get_catalogue') fail_('METHOD_NOT_ALLOWED', 'Use POST');
    return success_(fixtureCatalogueResponse_());
  });
}

function doPost(e) {
  return respond_(function () {
    var request;
    try { request = JSON.parse(e.postData.contents); }
    catch (_) { fail_('INVALID_REQUEST', 'Expected a JSON request body'); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      fail_('INVALID_REQUEST', 'Expected a JSON object');
    }
    if (e.parameter && Object.keys(e.parameter).length) {
      fail_('INVALID_REQUEST', 'POST parameters belong in the JSON body');
    }
    switch (request.action) {
      case 'get_catalogue': return testHook_(request, 'before_write') || success_(fixtureCatalogueResponse_());
      case 'create_order': return createOrder_(request);
      case 'read_order': return readOrder_(request);
      case 'upload_receipt': return uploadReceipt_(request);
      default: fail_('UNKNOWN_ACTION', 'Unsupported action');
    }
  });
}

function respond_(work) {
  try {
    var result = work();
    // Only the fresh-commit hook returns an already-built TextOutput.
    return result && typeof result.getContent === 'function' ? result : json_(result);
  } catch (error) {
    if (error.phase0Unhandled) throw error;
    return json_(errorEnvelope_(error.apiCode || 'INTERNAL_ERROR',
      error.apiCode ? error.message : 'Request failed; retry safely'));
  }
}
function json_(envelope) {
  return ContentService.createTextOutput(JSON.stringify(envelope)).setMimeType(ContentService.MimeType.JSON);
}
function success_(data) { return { ok: true, data: data }; }
function errorEnvelope_(code, message) { return { ok: false, error: { code: code, message: message, detail: {} } }; }
function fail_(code, message) { var error = new Error(message); error.apiCode = code; throw error; }
function property_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) fail_('CONFIG_ERROR', 'Missing Script Property: ' + key);
  return value;
}
function scriptLock_() {
  var lock = LockService.getScriptLock();
  // Section 5.11: wait 30 seconds, retry once, then BUSY.
  if (!lock.tryLock(30000) && !lock.tryLock(30000)) fail_('BUSY', 'Lock timeout');
  return lock;
}
function withLock_(work) {
  var lock = scriptLock_();
  try { return work(); }
  finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}
function sheet_() { return SpreadsheetApp.openById(property_('TEST_SHEET_ID')); }
function table_(book, name) {
  var tab = book.getSheetByName(name);
  var fields = PHASE0_SCHEMA_[name];
  if (!tab || JSON.stringify(tab.getRange(1, 1, 1, fields.length).getValues()[0]) !== JSON.stringify(fields)) {
    fail_('CONFIG_ERROR', 'Missing or incompatible test tab: ' + name);
  }
  return tab;
}
function rows_(book, name) {
  var tab = table_(book, name), fields = PHASE0_SCHEMA_[name];
  if (tab.getLastRow() < 2) return [];
  return tab.getRange(2, 1, tab.getLastRow() - 1, fields.length).getValues().map(function (row, i) {
    var record = { _row: i + 2 };
    fields.forEach(function (key, j) { record[key] = row[j]; });
    return record;
  });
}
function write_(book, name, record, row) {
  var tab = table_(book, name);
  tab.getRange(row || tab.getLastRow() + 1, 1, 1, PHASE0_SCHEMA_[name].length)
    .setValues([PHASE0_SCHEMA_[name].map(function (key) {
      var value = record[key] === undefined ? '' : record[key];
      // Section 5.6: literal strings even if untrusted text starts a formula.
      return typeof value === 'string' && /^[=+\-@'\t\r\n]/.test(value) ? "'" + value : value;
    })]);
}
function initializePhase0TestSheet() {
  withLock_(function () {
    var book = sheet_();
    Object.keys(PHASE0_SCHEMA_).forEach(function (name) {
      var tab = book.getSheetByName(name) || book.insertSheet(name);
      if (tab.getLastRow() === 0) tab.getRange(1, 1, 1, PHASE0_SCHEMA_[name].length).setValues([PHASE0_SCHEMA_[name]]);
      table_(book, name); // Refuse incompatible existing data; never overwrite.
    });
  });
}
function text_(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail_('INVALID_REQUEST', 'Missing ' + label);
  return value.trim();
}
function canonical_(r) {
  var name = text_(r.name, 'name'), email = text_(r.email, 'email').toLowerCase();
  var phone = text_(r.whatsapp, 'whatsapp').replace(/[\s()-]/g, '');
  if (phone.indexOf('01') === 0) phone = '+6' + phone;
  else if (phone.indexOf('601') === 0) phone = '+' + phone;
  if (!/^\+601(?:1\d{8}|[02-9]\d{7})$/.test(phone)) {
    fail_('INVALID_REQUEST', 'Use a valid Malaysian mobile number');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('INVALID_REQUEST', 'Invalid email');
  if (!Array.isArray(r.lines) || !r.lines.length) fail_('INVALID_REQUEST', 'Cart is empty');
  var quantities = Object.create(null);
  r.lines.forEach(function (line) {
    if (!line || typeof line.sku_id !== 'string' || !line.sku_id || !Number.isSafeInteger(line.qty) || line.qty < 1) {
      fail_('INVALID_REQUEST', 'Invalid cart line');
    }
    quantities[line.sku_id] = (quantities[line.sku_id] || 0) + line.qty;
    if (!Number.isSafeInteger(quantities[line.sku_id])) fail_('INVALID_REQUEST', 'Invalid quantity');
  });
  return { lines: Object.keys(quantities).sort().map(function (sku) { return { sku_id: sku, qty: quantities[sku] }; }),
    contact: { name: name, whatsapp: phone, email: email }, slot_id: text_(r.slot_id, 'slot_id') };
}
function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value).map(function (b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}
function token_(order) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    order.order_id + String(order.token_version), property_('server_secret'), Utilities.Charset.UTF_8)).replace(/=+$/, '');
}
function constantTimeEqual_(a, b) {
  var different = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return different === 0;
}
function findOrder_(book, id) {
  return rows_(book, 'Orders').filter(function (o) { return o.order_id === id; })[0];
}
function authorizedOrder_(book, r, now) {
  var order = typeof r.order_id === 'string' ? findOrder_(book, r.order_id) : null;
  var expected = token_(order || { order_id: 'NONEXISTENT', token_version: 1 });
  var valid = constantTimeEqual_(expected, typeof r.token === 'string' ? r.token : '');
  if (!order || !valid || (order.closed_at && now >= Date.parse(order.closed_at) + 30 * 86400000)) {
    fail_('UNAUTHORIZED', 'Invalid credentials');
  }
  if (order.is_test !== true) fail_('CONFIG_ERROR', 'Only test orders are supported');
  return order;
}
function effective_status(order, now) {
  return order.status === 'pending_payment' && now >= Date.parse(order.expires_at) ? 'expired' : order.status;
}
function orderData_(book, order) {
  return { order_id: order.order_id, total_sen: order.total_sen,
    created_at: order.created_at, expires_at: order.expires_at,
    status: effective_status(order, Date.now()), slot_id: order.slot_id,
    lines: rows_(book, 'OrderLines').filter(function (line) { return line.order_id === order.order_id && line.op_id === order.op_id; })
      .map(function (line) { return { sku_id: line.sku_id, qty: line.qty, price_sen: line.price_sen }; }),
    instructions: { version: order.instructions_version, message: 'TEST ONLY: do not transfer money.' } };
}
function createOrder_(r) {
  var fresh = false;
  var result = withLock_(function () {
    if (typeof r.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.request_id)) {
      fail_('INVALID_REQUEST', 'request_id must be a UUID');
    }
    var c = canonical_(r), fingerprint = hash_(JSON.stringify(c));
    var book = sheet_();
    var existing = rows_(book, 'Orders').filter(function (o) { return o.request_id === r.request_id; })[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail_('REQUEST_CONFLICT', 'Request ID already used with different cart/inputs');
      var recovered = orderData_(book, existing);
      recovered.token = token_(existing);
      return success_(recovered); // Every hook is bypassed on replay.
    }
    var hook = testHook_(r, 'before_write');
    if (hook) return hook;
    var catalogue = fixtureCatalogue_(), total = 0;
    var lines = c.lines.map(function (line) {
      var item = catalogue.filter(function (p) { return p.sku_id === line.sku_id; })[0];
      if (!item) fail_('INVALID_REQUEST', 'Unknown test SKU');
      total += item.price_sen * line.qty;
      if (!Number.isSafeInteger(total)) fail_('INVALID_REQUEST', 'Invalid total');
      return { sku_id: line.sku_id, qty: line.qty, price_sen: item.price_sen };
    });
    if (!Number.isSafeInteger(r.quoted_total_sen) || total !== r.quoted_total_sen) fail_('PRICE_CHANGED', 'Price updated');
    var now = Date.now(), id = 'TEST-' + Utilities.getUuid();
    var order = { order_id: id, request_id: r.request_id, fingerprint: fingerprint,
      token_version: 1, created_at: new Date(now).toISOString(), name: c.contact.name,
      whatsapp_norm: c.contact.whatsapp, email_norm: c.contact.email, status: 'pending_payment',
      expires_at: new Date(now + 48 * 3600000).toISOString(), slot_id: c.slot_id,
      instructions_version: 1, total_sen: total, flags: '', is_test: true, op_id: Utilities.getUuid() };
    var credential = token_(order); // Validate secret before any writes.
    lines.forEach(function (line) {
      line.order_id = id; line.op_id = order.op_id;
      write_(book, 'OrderLines', line);
    });
    write_(book, 'TransitionLog', { op_id: order.op_id, from: '', to: 'pending_payment',
      actor: 'buyer', reason: 'create_order', time: order.created_at });
    write_(book, 'Orders', order); // Sections 5.1/5.5: commit point LAST.
    SpreadsheetApp.flush();
    fresh = true;
    var data = orderData_(book, order); data.token = credential;
    return success_(data);
  }); // flush and release before deliberate non-JSON response.
  return (fresh && testHook_(r, 'after_commit')) || result;
}
function readOrder_(r) {
  return withLock_(function () {
    var book = sheet_();
    return success_(orderData_(book, authorizedOrder_(book, r, Date.now())));
  });
}
function validateUploadState_(order, now) {
  var state = effective_status(order, now);
  if (order.closed_at) fail_('INVALID_STATE', 'Order is closed');
  if (state === 'pending_payment' || state === 'payment_submitted') return state;
  if (state === 'expired' || state === 'cancelled') {
    var start = state === 'expired' ? Date.parse(order.expires_at) : Date.parse(order.closed_at);
    if (state === 'cancelled') {
      // Cancellation is not implemented in Phase 0; do not invent a timestamp.
      fail_('INVALID_STATE', 'Cancelled-order fixtures require lifecycle support');
    }
    if (now < start + 14 * 86400000) return state;
  }
  fail_('INVALID_STATE', 'Receipt upload is not allowed');
}
function uploadBytes_(r) {
  var cap = Number(property_('TEST_MAX_UPLOAD_BYTES'));
  if (!Number.isSafeInteger(cap) || cap < 1) fail_('CONFIG_ERROR', 'Invalid TEST_MAX_UPLOAD_BYTES');
  if (['image/jpeg', 'image/png', 'application/pdf'].indexOf(r.mime_type) < 0) {
    fail_('INVALID_FILE', 'Use JPEG, PNG or PDF; HEIC is not supported');
  }
  if (typeof r.file_base64 !== 'string' || r.file_base64.length > 4 * Math.ceil(cap / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.file_base64)) {
    fail_('INVALID_FILE', 'Invalid base64 or file exceeds configured size cap');
  }
  var bytes = Utilities.base64Decode(r.file_base64);
  if (!bytes.length || bytes.length > cap) fail_('INVALID_FILE', 'File is empty or exceeds configured size cap');
  return bytes;
}
function uploadReceipt_(r) {
  var prepared = withLock_(function () {
    var book = sheet_(), now = Date.now();
    var order = authorizedOrder_(book, r, now);
    validateUploadState_(order, now);
    var bytes = uploadBytes_(r);
    var folderId = property_('TEST_RECEIPT_FOLDER_ID');
    var entry = { upload_id: Utilities.getUuid(), order_id: order.order_id, file_id: '',
      sha256: hash_(bytes), created_at: new Date(now).toISOString(), status: 'prepared', superseded_by: '' };
    write_(book, 'UploadLog', entry);
    return { entry: entry, bytes: bytes, folderId: folderId };
  });
  // Section 5.9: private Drive work outside lock, identifiable after a crash.
  var folder = DriveApp.getFolderById(prepared.folderId);
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) fail_('CONFIG_ERROR', 'Receipt folder must be private');
  var file = folder.createFile(Utilities.newBlob(prepared.bytes, r.mime_type, prepared.entry.upload_id));
  return withLock_(function () {
    var book = sheet_(), now = Date.now(); // ALWAYS fresh after Drive IO.
    var order = authorizedOrder_(book, r, now);
    var state = validateUploadState_(order, now);
    var entry = rows_(book, 'UploadLog').filter(function (u) { return u.upload_id === prepared.entry.upload_id; })[0];
    if (!entry || entry.status !== 'prepared') fail_('INVALID_STATE', 'Upload preparation missing');
    var from = state;
    if (state === 'pending_payment') order.status = 'payment_submitted';
    else if (state === 'expired') {
      order.status = 'expired';
      var flags = order.flags ? String(order.flags).split(',') : [];
      if (flags.indexOf('late_receipt') < 0) flags.push('late_receipt');
      order.flags = flags.join(',');
    }
    if (!order.first_receipt_at) order.first_receipt_at = new Date(now).toISOString();
    write_(book, 'TransitionLog', { op_id: entry.upload_id, from: from, to: order.status,
      actor: 'buyer', reason: 'receipt_received', time: new Date(now).toISOString() });
    write_(book, 'Orders', order, order._row); // Never change expires_at.
    entry.file_id = file.getId(); entry.status = 'completed';
    write_(book, 'UploadLog', entry, entry._row);
    return success_({ upload_id: entry.upload_id, status: 'received' });
  });
}
