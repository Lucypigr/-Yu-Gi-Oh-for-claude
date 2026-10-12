// 列出某個系列代碼的所有卡片（新增系列時用）
// 用法：node scripts/list-setcode.mjs 0x33 [--full]
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(fs.readFileSync('.cache/cards.zip')))['cards.json']));
const pool = new Set(JSON.parse(fs.readFileSync('src/data/cards.json', 'utf8')).map((c) => c.id));
const want = Number(process.argv[2]);
const full = process.argv.includes('--full');
const codes = (s) => {
  const out = [];
  let v = BigInt(s || 0);
  while (v > 0n) {
    out.push(Number(v & 0xffffn));
    v >>= 16n;
  }
  return out;
};
for (const c of Object.values(json)) {
  if (!c.data || c.data.type & 0x4000) continue;
  const cs = codes(c.data.setcode);
  if (!cs.some((x) => x === want || (x & 0xfff) === want)) continue;
  const d = c.data;
  const line = `${pool.has(c.id) ? 'HAVE ' : ''}${c.id}  # ${c.en_name} | ${c.cn_name} | t=${d.type.toString(16)} L${d.level & 0xff} ${d.atk}/${d.def} codes=${cs.map((x) => x.toString(16)).join(',')}`;
  console.log(line);
  if (full) console.log('    ' + (c.text.desc || '').replace(/\r?\n/g, ' / '));
}
