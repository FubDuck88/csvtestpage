/** Disposable Phase 0 only. Anonymous tests use the deployed /exec URL.
 * Hooks require the exact Script Property ENABLE_TEST_HOOKS=true.
 * No payload, request_id, credential, or exception is logged.
 */
function testHook_(request, phase) {
  if (PropertiesService.getScriptProperties().getProperty('ENABLE_TEST_HOOKS') !== 'true') {
    return null;
  }
  var hook = request._test_hook;
  if (phase === 'before_write') {
    if (hook === 'throw_unhandled') {
      var fault = new Error('Deliberate Phase 0 platform exception');
      fault.phase0Unhandled = true;
      throw fault;
    }
    if (hook === 'simulate_busy') {
      return errorEnvelope_('BUSY', 'Lock timeout simulated');
    }
    if (hook === 'business_error') {
      return errorEnvelope_('PRICE_CHANGED', 'Price updated');
    }
  }
  // Called ONLY after a fresh header commit, flush, and lock release.
  if (phase === 'after_commit' && hook === 'crash_after_commit') {
    return ContentService.createTextOutput('PHASE_0_DELIBERATE_NON_JSON');
  }
  return null;
}

function fixtureCatalogue_() {
  var image = '/test-image.png';
  return [
    { sku_id: 'TEST-BAG', name_zh: '测试帆布袋', name_en: 'Test canvas bag',
      price_sen: 1200, image_url: image, available: 20 },
    { sku_id: 'TEST-PIN', name_zh: '测试别针', name_en: 'Test pin',
      price_sen: 500, image_url: image, available: 20 }
  ];
}

// Phase 0 transport fixture only; no bank QR or production payload contract.
function fixtureCatalogueResponse_() {
  return { items: fixtureCatalogue_(), test_png_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbElEQVR4nO3PQQ0AIRAEQWQgASVnDU1owsRpmE1I9lHJvDtTY3472j0r2uv+AAAAAAAAAAAAAAAoA7odSvsAAAAAAAAAAAAAAHVAt0NpHwAAAAAAAAAAAACgDuh2KO0DAAAAAAAAAAAAAJT7P0HOiTzU4V+oAAAAAElFTkSuQmCC' };
}
