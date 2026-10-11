// 下載卡片圖片，縮小並轉為 webp：
//   public/art/<卡號>.webp    卡圖（只有圖片部分，「自繪卡面」用，來源 ygoprodeck）
//   public/cards/<卡號>.webp  整張中文卡面（「實卡卡面」用，來源 ygocdb / 萌卡 的 YGOPro 卡圖）
// 沒有下載圖片時，遊戲會改用自繪卡面或屬性顏色的預設圖，仍然可以正常遊玩。
//
// 用法：npm run fetch-art
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cards = JSON.parse(await fs.readFile(path.join(root, 'src', 'data', 'cards.json'), 'utf8'));

const KINDS = [
  {
    dir: 'art',
    urls: (id) => [`https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`],
    convert: (img) => img.resize(320, 320, { fit: 'cover' }).webp({ quality: 78 }),
  },
  {
    dir: 'cards',
    urls: (id) => [`https://cdn.233.momobako.com/ygoimg/ygopro/${id}.webp`, `https://cdn.233.momobako.com/ygopro/pics/${id}.jpg`],
    convert: (img) => img.resize(400, 580, { fit: 'cover' }).webp({ quality: 80 }),
  },
];

for (const kind of KINDS) {
  const outDir = path.join(root, 'public', kind.dir);
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
    let lastErr = null;
    for (const url of kind.urls(card.id)) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await kind.convert(sharp(buf)).toFile(out);
        ok++;
        lastErr = null;
        process.stdout.write('.');
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) failed.push(`${card.id} ${card.name}: ${lastErr.message}`);
    // 對圖片伺服器客氣一點
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(`\n[${kind.dir}] 下載 ${ok} 張，已存在 ${skipped} 張，失敗 ${failed.length} 張`);
  for (const f of failed) console.log('  ' + f);
}
