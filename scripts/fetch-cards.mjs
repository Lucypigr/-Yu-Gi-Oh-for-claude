// 從百鴿 ygocdb.com（與 ourocg.cn 同源的簡體中文卡片資料）下載卡片資料，
// 轉成繁體中文後寫入 src/data/cards.json。
//
// 用法：
//   npm run fetch-cards                    # 轉成繁體中文（預設）
//   npm run fetch-cards -- --simplified    # 保留簡體中文
//   npm run fetch-cards -- --refresh       # 重新下載資料庫（有新卡時）
//
// 完整資料庫（約 2.5 MB）會快取在 .cache/cards.zip。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import * as OpenCC from 'opencc-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listFile = path.join(root, 'scripts', 'card-list.txt');
const cacheFile = path.join(root, '.cache', 'cards.zip');
const outFile = path.join(root, 'src', 'data', 'cards.json');
const simplified = process.argv.includes('--simplified');
const refresh = process.argv.includes('--refresh');
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
  {
    id: 17418745,
    name: '光子衍生物',
    nameEn: 'Photon Token',
    desc: '「光子聖域」的效果特殊召喚的衍生物。不能攻擊，也不能作為同步素材。',
    type: 0x4011,
    atk: 2000,
    def: 0,
    level: 4,
    race: 0x1000,
    attribute: 0x10,
  },
];

async function loadDb() {
  let buf = null;
  if (!refresh) {
    try {
      buf = await fs.readFile(cacheFile);
    } catch {
      /* 沒有快取 */
    }
  }
  if (!buf) {
    console.log('下載卡片資料庫…');
    const res = await fetch('https://ygocdb.com/api/v0/cards.zip');
    if (!res.ok) throw new Error(`下載失敗：HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, buf);
  }
  const files = unzipSync(new Uint8Array(buf));
  const json = JSON.parse(strFromU8(files['cards.json']));
  const byId = new Map();
  const byName = new Map();
  for (const c of Object.values(json)) {
    if (!c.data) continue;
    byId.set(c.id, c);
    if (!byName.has(c.cn_name)) byName.set(c.cn_name, c);
  }
  return { byId, byName };
}

async function main() {
  const ids = (await fs.readFile(listFile, 'utf8'))
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map(Number);
  const { byId, byName } = await loadDb();
  const inPool = new Set(ids);
  const nameToId = (n) => {
    const c = byName.get(n);
    return c ? c.id : null;
  };

  const cards = [];
  const missing = [];
  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw) {
      missing.push(id);
      continue;
    }
    const d = raw.data;
    const desc = (raw.text.desc ?? '').replace(/\r\n/g, '\n');
    const card = {
      id: raw.id,
      name: tc(raw.cn_name),
      nameEn: raw.en_name ?? '',
      desc: tc(desc),
      type: d.type,
      atk: d.atk,
      def: d.def,
      level: d.level & 0xff,
      race: d.race,
      attribute: d.attribute,
    };
    // 靈擺：刻度與靈擺效果
    if (d.type & 0x1000000) {
      card.scale = (d.level >> 24) & 0xff;
      if (raw.text.pdesc) card.pdesc = tc(raw.text.pdesc).replace(/\r\n/g, '\n');
    }
    // 連結：守備力欄位是連結箭頭
    if (d.type & 0x4000000) {
      card.linkMarkers = d.def;
      card.def = 0;
    }
    const firstLine = desc.split('\n')[0];
    // 融合素材：「A」＋「B」
    if (d.type & 0x40) {
      const names = [...firstLine.matchAll(/「(.+?)」/g)].map((m) => m[1]);
      const rest = firstLine.replace(/「.+?」/g, '').replace(/[＋+]/g, '').trim();
      const mats = names.map(nameToId);
      if (names.length && !rest && mats.every((m) => m && inPool.has(m))) card.materials = mats;
    }
    // 超量素材數：N星怪獸×K
    if (d.type & 0x800000) {
      const m = firstLine.match(/×(\d+)/);
      if (m) card.xyzCount = Number(m[1]);
    }
    // 儀式魔法對應的儀式怪獸
    if (d.type & 0x2 && d.type & 0x80) {
      const m = desc.match(/「(.+?)」/);
      const target = m && nameToId(m[1]);
      if (target && inPool.has(target)) card.ritualFor = target;
    }
    cards.push(card);
  }
  for (const m of MANUAL) if (!cards.some((c) => c.id === m.id)) cards.push(m);
  if (missing.length) console.warn(`資料庫找不到：${missing.join(', ')}`);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(cards) + '\n');
  console.log(`已寫入 ${cards.length} 張卡片到 ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
