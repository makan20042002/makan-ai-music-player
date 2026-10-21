const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function createIcoFromPngs(pngBuffersWithSizes) {
  // pngBuffersWithSizes: [{ size: 256, buffer: Buffer }, { size: 48, buffer: Buffer }, ...]
  const count = pngBuffersWithSizes.length;
  const headerSize = 6 + count * 16;
  let currentOffset = headerSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(count, 4); // Number of images

  const entries = [];
  const imageBuffers = [];

  for (const item of pngBuffersWithSizes) {
    const entry = Buffer.alloc(16);
    const w = item.size >= 256 ? 0 : item.size;
    const h = item.size >= 256 ? 0 : item.size;
    entry.writeUInt8(w, 0); // Width
    entry.writeUInt8(h, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(item.buffer.length, 8); // Size of image data
    entry.writeUInt32LE(currentOffset, 12); // Offset of image data

    entries.push(entry);
    imageBuffers.push(item.buffer);
    currentOffset += item.buffer.length;
  }

  return Buffer.concat([header, ...entries, ...imageBuffers]);
}

async function generate() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const svgContent = fs.readFileSync(path.join(__dirname, '..', 'media', 'assets', 'icon.svg'), 'utf8');
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent;overflow:hidden;">${svgContent}</body></html>`;

  await page.setContent(html);

  const sizes = [512, 256, 192, 128, 64, 48, 32, 16];
  const pngs = [];

  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    const buf = await page.screenshot({ omitBackground: true, type: 'png' });
    pngs.push({ size, buffer: buf });

    if (size === 512) {
      fs.writeFileSync(path.join(__dirname, '..', 'media', 'icon-512.png'), buf);
      fs.writeFileSync(path.join(__dirname, '..', 'media', 'assets', 'icon-512.png'), buf);
    }
    if (size === 192) {
      fs.writeFileSync(path.join(__dirname, '..', 'media', 'icon-192.png'), buf);
      fs.writeFileSync(path.join(__dirname, '..', 'media', 'assets', 'icon-192.png'), buf);
    }
    if (size === 256) {
      fs.writeFileSync(path.join(__dirname, '..', 'media', 'assets', 'icon-256.png'), buf);
    }
  }

  // Create multi-resolution Windows .ico (256, 128, 64, 48, 32, 16)
  const icoPngs = pngs.filter(p => p.size <= 256);
  const icoBuf = createIcoFromPngs(icoPngs);
  const icoPath = path.join(__dirname, '..', 'media', 'assets', 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);
  console.log('Created multi-resolution icon:', icoPath, 'Size:', icoBuf.length, 'bytes');

  await browser.close();
  console.log('Successfully generated all icon assets!');
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
