/** Disposable P0-2b only (Sections 5.9 and 9). Editor-only; NO web-app route.
 * Only the explicitly approved synthetic JPEG in the separate private staging
 * folder may be published. No Photos schema or production approval workflow.
 * The PAT stays in GITHUB_TOKEN Script Properties. Never log fetch exceptions,
 * headers, response bodies, signed thumbnail URLs or property values.
 * Route 2 is enabled only after a measured Route 1 failure and build preparation;
 * this first candidate implements Route 1. See p0-v41-deployment.md.
 */
function publishPhase0DummyPhoto() {
  var result = publishPhotoToRepo(PropertiesService.getScriptProperties().getProperty('TEST_DUMMY_JPEG_FILE_ID'));
  // This is a constructed allowlist of non-secret evidence, never a raw response.
  console.log(JSON.stringify(result));
  return result;
}

function publishPhotoToRepo(fileId) {
  var p = PropertiesService.getScriptProperties();
  var stage = 'configuration';
  try {
    publisherRequire_(p.getProperty('ENABLE_TEST_HOOKS') === 'true', 'TEST_HOOKS_DISABLED');
    publisherRequire_(/^[A-Za-z0-9_-]{10,200}$/.test(fileId || '') &&
      fileId === p.getProperty('TEST_DUMMY_JPEG_FILE_ID') &&
      p.getProperty('TEST_DUMMY_JPEG_APPROVED') === 'true', 'DUMMY_NOT_APPROVED');
    var folderId = p.getProperty('TEST_PHOTO_STAGING_FOLDER_ID');
    publisherRequire_(folderId && folderId !== p.getProperty('TEST_RECEIPT_FOLDER_ID'), 'STAGING_NOT_SEPARATE');
    var repo = p.getProperty('GITHUB_REPO') || '', token = p.getProperty('GITHUB_TOKEN');
    publisherRequire_(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) && token, 'GITHUB_NOT_CONFIGURED');
    stage = 'private-staging';
    var folder = DriveApp.getFolderById(folderId), file = DriveApp.getFileById(fileId);
    publisherRequire_(folder.getSharingAccess() === DriveApp.Access.PRIVATE &&
      file.getSharingAccess() === DriveApp.Access.PRIVATE && !file.isTrashed(), 'STAGING_OR_FILE_NOT_PRIVATE');
    var parents = file.getParents(), count = 0, inFolder = false;
    while (parents.hasNext()) { count++; inFolder = parents.next().getId() === folderId || inFolder; }
    publisherRequire_(inFolder && count === 1 && file.getMimeType() === 'image/jpeg', 'NOT_STAGED_JPEG');
    // Use a >=1200px synthetic source so w1200 has an unambiguous expectation.
    publisherRequire_(file.getSize() <= 2500000, 'ORIGINAL_EXCEEDS_2500000_BYTES');
    var original = file.getBlob().getBytes(), originalSize = publisherJpegSize_(original);
    publisherRequire_(originalSize.width >= 1200, 'DUMMY_WIDTH_BELOW_1200');
    stage = 'thumbnail';
    var resized = publisherThumbnail_(fileId), dimensions = publisherJpegSize_(resized);
    publisherRequire_(dimensions.width === 1200 &&
      Math.abs(dimensions.height - originalSize.height * 1200 / originalSize.width) <= 2,
    'THUMBNAIL_DIMENSIONS_MISMATCH');
    publisherRequire_(resized.length <= 2500000, 'THUMBNAIL_EXCEEDS_2500000_BYTES');
    stage = 'github-commit';
    var path = 'poc-web/photos/' + fileId + '-1200.jpg';
    var response = publisherFetch_('https://api.github.com/repos/' + repo + '/contents/' + path, {
      method: 'put', contentType: 'application/json', followRedirects: false,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10' },
      payload: JSON.stringify({ message: 'P0-2b publish approved synthetic JPEG', content: Utilities.base64Encode(resized) })
    });
    // Create-only: a repeated PUT never overwrites a previously published asset.
    var status = response.getResponseCode();
    publisherRequire_(status === 201, 'GITHUB_HTTP_' + status);
    var body;
    try { body = JSON.parse(response.getContentText()); }
    catch (_) { throw publisherError_('GITHUB_COMMIT_OUTCOME_UNKNOWN'); }
    publisherRequire_(body.commit && /^[0-9a-f]{40}$/.test(body.commit.sha || ''), 'GITHUB_COMMIT_OUTCOME_UNKNOWN');
    return { ok: true, route: 'authenticated-drive-thumbnail', file_id: fileId,
      path: '/photos/' + fileId + '-1200.jpg', bytes: resized.length,
      width: dimensions.width, height: dimensions.height, commit_sha: body.commit.sha,
      acknowledged_at: new Date().toISOString(), live: 'NOT_CHECKED', phone: 'NOT_RUN' };
  } catch (error) {
    return { ok: false, stage: stage,
      code: error.publisherCode || 'SERVICE_EXCEPTION_REDACTED',
      next: stage === 'thumbnail' ? 'RECORD_ROUTE_1_FAILURE_THEN_PREPARE_ROUTE_2_BUILD'
        : stage === 'github-commit' ? 'STOP_INSPECT_REPO_BEFORE_ANY_RETRY' : 'STOP_AND_REPORT' };
  }
}

function publisherThumbnail_(fileId) {
  var url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200';
  for (var hop = 0; hop < 5; hop++) {
    var response = publisherFetch_(url, {
      method: 'get', followRedirects: false,
      // OAuth is sent only to the original Drive endpoint. Never forward it
      // to a signed-content redirect or an unvalidated destination.
      headers: hop === 0 ? { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } : {}
    });
    var status = response.getResponseCode();
    if (status === 200) {
      publisherRequire_(/^image\/jpeg(?:;|$)/i.test(publisherHeader_(response, 'content-type')), 'THUMBNAIL_NOT_JPEG');
      return response.getBlob().getBytes();
    }
    if ([301, 302, 303, 307, 308].indexOf(status) < 0) throw publisherError_('THUMBNAIL_HTTP_' + status);
    url = publisherHeader_(response, 'location');
    publisherRequire_(/^https:\/\/(?:drive\.google\.com|drive\.usercontent\.google\.com|[a-z0-9-]+\.googleusercontent\.com)\/[\x21-\x7e]+$/i.test(url) &&
      url.indexOf('#') < 0 && url.indexOf('\\') < 0, 'THUMBNAIL_REDIRECT_REJECTED');
  }
  throw publisherError_('THUMBNAIL_REDIRECT_LIMIT');
}
function publisherHeader_(response, key) {
  var headers = response.getAllHeaders();
  var name = Object.keys(headers).filter(function (name) { return name.toLowerCase() === key; })[0];
  return name ? String(headers[name]) : '';
}
function publisherFetch_(url, options) {
  try { return UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true, timeoutSeconds: 30 }, options)); }
  catch (_) { throw publisherError_('FETCH_EXCEPTION_OUTCOME_UNKNOWN'); }
}
function publisherRequire_(condition, code) { if (!condition) throw publisherError_(code); }
function publisherError_(code) { var error = new Error(code); error.publisherCode = code; return error; }
function publisherJpegSize_(bytes) {
  function at(i) { return bytes[i] & 255; }
  publisherRequire_(bytes.length >= 4 && at(0) === 255 && at(1) === 216, 'INVALID_JPEG');
  var offset = 2;
  while (offset + 4 <= bytes.length) {
    publisherRequire_(at(offset++) === 255, 'INVALID_JPEG_MARKER');
    while (at(offset) === 255 && offset < bytes.length) offset++;
    var marker = at(offset++);
    if (marker === 217 || marker === 218) break;
    var length = (at(offset) << 8) + at(offset + 1);
    publisherRequire_(length >= 2 && offset + length <= bytes.length, 'TRUNCATED_JPEG');
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].indexOf(marker) >= 0) {
      publisherRequire_(length >= 8, 'INVALID_JPEG_FRAME');
      var height = (at(offset + 3) << 8) + at(offset + 4), width = (at(offset + 5) << 8) + at(offset + 6);
      publisherRequire_(width > 0 && height > 0 && width * height <= 60000000, 'INVALID_JPEG_DIMENSIONS');
      return { width: width, height: height };
    }
    offset += length;
  }
  throw publisherError_('JPEG_DIMENSIONS_MISSING');
}
