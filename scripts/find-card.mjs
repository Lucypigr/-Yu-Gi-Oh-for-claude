// 用英文卡名查詢資料庫中的卡號與效果（新增卡片時用）
// 用法：node scripts/find-card.mjs "Number 39: Utopia" "Pot of Greed"
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(fs.readFileSync('.cache/cards.zip')))['cards.json']));
const all = Object.values(json).filter(c=>c.data);
const pool = new Set(fs.readFileSync('scripts/card-list.txt','utf8').split('\n').map(l=>Number(l.replace(/#.*/,'').trim())).filter(Boolean));
for (const n of process.argv.slice(2)) {
  const c = all.find(c => (c.en_name??'').toLowerCase() === n.toLowerCase()) ;
  if (!c) { console.log('MISSING', n); continue; }
  const d=c.data;
  console.log(`${pool.has(c.id)?'HAVE ':''}${c.id}  # ${c.en_name} | ${c.cn_name} | t=${d.type.toString(16)} L${d.level&0xff} ${d.atk}/${d.def}\n    ${(c.text.desc||'').replace(/\r?\n/g,' / ')}`);
}
