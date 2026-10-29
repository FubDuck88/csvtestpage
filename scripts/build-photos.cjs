// Phase 0 Route 2: repository originals are capped; only resized output is served.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');

async function resizePhoto(input) {
  if (input.length > 2500000) throw new Error('Original exceeds 2500000 bytes');
  const metadata = await sharp(input, { limitInputPixels: 60000000 }).metadata();
  if (metadata.format !== 'jpeg' || metadata.width < 1200) throw new Error('Expected JPEG at least 1200 pixels wide');
  const { data, info } = await sharp(input, { limitInputPixels: 60000000 })
    .rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 1200 || data.length > 2500000) throw new Error('Invalid resized output');
  return { data, width: info.width, height: info.height };
}

async function build() {
  if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Invalid output directory');
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(root, 'poc-web'), output, { recursive: true });
  const photos = path.join(output, 'photos');
  let entries;
  try { entries = await fs.readdir(photos, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') { console.log('No published photos yet'); return; } throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]{10,200}-1200\.jpg$/.test(entry.name)) throw new Error('Unexpected photo entry');
    const filename = path.join(photos, entry.name);
    const { data, width, height } = await resizePhoto(await fs.readFile(filename));
    await fs.writeFile(filename, data);
    console.log(JSON.stringify({ photo: entry.name, bytes: data.length, width, height }));
  }
}
module.exports = { resizePhoto };
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
