import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../public/world/', import.meta.url);
await mkdir(root, { recursive: true });
const records = [];
async function download(name, url, source, license) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(name, root), bytes);
  records.push({ file: name, source, license, download: url, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(name, bytes.length);
}
// The Soldier is the only rigged asset (humans and survivors); every machine
// is procedural (src/three/UnitModels.ts), so no Xbot is downloaded any more.
for (const name of ['Soldier']) {
  await download(`${name.toLowerCase()}.glb`,
    `https://raw.githubusercontent.com/mrdoob/three.js/r185/examples/models/gltf/${name}.glb`,
    'Adobe Mixamo, distributed in the Three.js examples',
    'Mixamo royalty-free use incorporated in games; https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html');
}
for (const name of ['rubble', 'concrete', 'rocky_terrain_02']) {
  const response = await fetch(`https://api.polyhaven.com/files/${name}`);
  if (!response.ok) throw new Error(`Missing Poly Haven asset: ${name}`);
  const files = await response.json();
  for (const channel of ['diff', 'nor_gl', 'rough']) {
    const key = { diff: 'Diffuse', nor_gl: 'nor_gl', rough: 'Rough' }[channel];
    const item = files[key]?.['1k']?.jpg ?? files[key]?.['1k']?.png;
    if (!item) throw new Error(`Missing ${name} ${channel}`);
    await download(`${name}_${channel}.${item.url.split('.').at(-1)}`, item.url,
      `https://polyhaven.com/a/${name}`, 'CC0-1.0');
  }
}
await writeFile(new URL('sources.json', root), JSON.stringify(records, null, 2) + '\n');
