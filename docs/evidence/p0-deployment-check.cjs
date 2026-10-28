// Read-only verification of the disposable Pages deployment against local harness bytes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.pages.dev') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Supply only the test pages.dev origin.');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  const results = [];
  for (const name of ['index.html', 'test-runner.js', 'test-image.png']) {
    const response = await fetch(new URL(name, origin), { signal: AbortSignal.timeout(15000), redirect: 'follow' });
    const body = Buffer.from(await response.arrayBuffer());
    const local = fs.readFileSync(path.resolve(__dirname, '../../poc-web', name));
    results.push({ name, url: response.url, status: response.status, sha256: sha(body),
      matchesLocal: body.equals(local), headers: Object.fromEntries(['content-type', 'content-security-policy',
        'referrer-policy', 'cache-control', 'x-content-type-options'].map(key => [key, response.headers.get(key)])) });
  }
  const evidence = { time: new Date().toISOString(), origin: origin.origin, results };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(__dirname, 'p0-v41-deployment-' + stamp + '.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  const policy = results[0].headers['content-security-policy'] || '';
  if (results.some(item => item.status !== 200 || !item.matchesLocal) ||
      !/(?:^|;)\s*img-src 'self' data:\s*(?:;|$)/.test(policy) ||
      results[0].headers['referrer-policy'] !== 'no-referrer') process.exitCode = 1;
})().catch(error => { console.error(error.name + ': deployment verification did not complete'); process.exitCode = 1; });
