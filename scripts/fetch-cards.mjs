// 從百鴿 ygocdb.com（與 ourocg.cn 同源的簡體中文卡片資料）下載卡片資料，
// 轉成繁體中文後寫入 src/data/cards.json。
//
// 用法：
//   npm run fetch-cards              # 轉成繁體中文（預設）
//   npm run fetch-cards -- --simplified   # 保留簡體中文
//
// 下載結果會快取在 .cache/cards/，重新執行不會重複下載。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listFile = path.join(root, 'scripts', 'card-list.txt');
const cacheDir = path.join(root, '.cache', 'cards');
const outFile = path.join(root, 'src', 'data', 'cards.json');
const simplified = process.argv.includes('--simplified');
const convert = simplified ? (s) => s : OpenCC.Converter({ from: 'cn', to: 'tw' });

// 遊戲王用語在自動轉換後的修正（左：轉換結果，右：想要的寫法）
const FIXUPS = [
  ['裏側', '裡側'],
  ['迴到', '回到'],
];
const tc = (s) => FIXUPS.reduce((acc, [a, b]) => acc.split(a).join(b), convert(s ?? ''));

// 衍生物等資料庫沒有的卡片，手動定義
const MANUAL = [
  {
    id: 73915052,
    name: '羊衍生物',
    nameEn: 'Sheep Token',
    desc: '「替罪羊」的效果特殊召喚的衍生物。',
    type: 0x4011,
    atk: 0,
    def: 0,
    level: 1,
    race: 0x4000,
    attribute: 0x1,
  },
];

async function fetchCard(id) {
  const cacheFile = path.join(cacheDir, `${id}.json`);
  try {
    return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch {
    /* 沒有快取 */
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://ygocdb.com/api/v0/card/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      await fs.writeFile(cacheFile, JSON.stringify(json));
      return json;
    } catch (err) {
      if (attempt === 4) throw new Error(`下載卡片 ${id} 失敗：${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function main() {
  await fs.mkdir(cacheDir, { recursive: true });
  const ids = (await fs.readFile(listFile, 'utf8'))
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map(Number);

  const cards = [];
  for (const id of ids) {
    const raw = await fetchCard(id);
    const d = raw.data;
    cards.push({
      id: raw.id,
      name: tc(raw.text.name),
      nameEn: raw.text.en_name ?? '',
      desc: tc(raw.text.desc).replace(/\r\n/g, '\n'),
      type: d.type,
      atk: d.atk,
      def: d.def,
      level: d.level & 0xff,
      race: d.race,
      attribute: d.attribute,
    });
    process.stdout.write('.');
  }
  for (const m of MANUAL) if (!cards.some((c) => c.id === m.id)) cards.push(m);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(cards, null, 1) + '\n');
  console.log(`\n已寫入 ${cards.length} 張卡片到 ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
