const { cp, rm, access } = require('node:fs/promises');
const { join } = require('node:path');

// electron-builder's asarUnpack matcher requires every input to be under appDir.
// Keep the runtime path app.asar/web, but stage the sibling Vite build first.
async function stageWeb() {
  const source = join(__dirname, '..', 'web', 'dist');
  const destination = join(__dirname, 'web');
  await access(join(source, 'index.html'));
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  await cp(join(__dirname,'../../packages/core/pkg-node'),join(__dirname,'performance-core'),{recursive:true});
}

// Multi-architecture packaging can invoke beforePack concurrently.
let staging;
module.exports = () => (staging ??= stageWeb());
