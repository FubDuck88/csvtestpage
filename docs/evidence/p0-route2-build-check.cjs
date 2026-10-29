'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const sharp = require('sharp');
const { resizePhoto } = require('../../scripts/build-photos.cjs');
(async () => {
  const original = await fs.readFile(__dirname + '/p0-dummy-source.jpg');
  const result = await resizePhoto(original);
  assert.equal(result.width,1200); assert.equal(result.height,675);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format,'jpeg'); assert.equal(metadata.width,1200); assert.equal(metadata.height,675);
  assert.ok(result.data.length<=2500000); assert.equal(metadata.exif,undefined);
  await assert.rejects(resizePhoto(Buffer.alloc(2500001)),/exceeds/);
  await assert.rejects(resizePhoto(Buffer.from('<html>not an image</html>')));
  console.log(JSON.stringify({status:'PASS',original_bytes:original.length,output_bytes:result.data.length,width:result.width,height:result.height,invalid_and_oversized_rejected:true}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
