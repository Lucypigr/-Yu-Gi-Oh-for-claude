// 下載卡圖（只有圖片部分，卡框與中文文字由遊戲自行繪製），
// 縮小並轉為 webp 後存到 public/art/<卡號>.webp。
// 沒有下載卡圖時，遊戲會用屬性顏色的預設圖代替，仍然可以正常遊玩。
//
// 用法：npm run fetch-art
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cards = JSON.parse(await fs.readFile(path.join(root, 'src', 'data', 'cards.json'), 'utf8'));
const outDir = path.join(root, 'public', 'art');
await fs.mkdir(outDir, { recursive: true });

let ok = 0;
let skipped = 0;
const failed = [];
for (const card of cards) {
  const out = path.join(outDir, `${card.id}.webp`);
  try {
    await fs.access(out);
    skipped++;
    continue;
  } catch {
    /* 尚未下載 */
  }
  try {
    const res = await fetch(`https://images.ygoprodeck.com/images/cards_cropped/${card.id}.jpg`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await sharp(buf).resize(320, 320, { fit: 'cover' }).webp({ quality: 78 }).toFile(out);
    ok++;
    process.stdout.write('.');
    // 對圖片伺服器客氣一點
    await new Promise((r) => setTimeout(r, 80));
  } catch (err) {
    failed.push(`${card.id} ${card.name}: ${err.message}`);
  }
}
console.log(`\n下載 ${ok} 張，已存在 ${skipped} 張，失敗 ${failed.length} 張`);
for (const f of failed) console.log('  ' + f);
