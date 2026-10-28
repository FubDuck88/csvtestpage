# CSV Phase 0 test repository

Disposable test source only. No production frontend, real customer data, bank data or credentials.

Cloudflare Pages: connect the default `main` branch, framework None, repository root, build command `exit 0`, output directory `poc-web`.

Apps Script: copy `apps-script/Code.js`, `TestHooks.js`, `PhotoPublisher.js` and `appsscript.json` into the disposable project, then authorize and deploy a new anonymous `/exec` version. Configure all credentials only in Script Properties; never put values in this repository, the Sheet, page or logs.

P0-2b uses a separately approved dummy JPEG in a PRIVATE staging folder. Run `publishPhase0DummyPhoto` only in the Apps Script editor. Its repository-scoped fine-grained PAT must allow Contents read/write on this repository only and expire within 30 days. Revoke it after the test and disable test hooks.

The browser action checks the published same-origin photo after the GitHub commit. A GitHub upload, local test or Pages build alone does not pass the signed-out real-phone gate. Independent review is required.

Initial source corresponds to local candidate commit `8f557381604ac1031d3b3e63ee3b44c2d01a3265`; the GitHub commit has its own SHA because this repository has separate history.
