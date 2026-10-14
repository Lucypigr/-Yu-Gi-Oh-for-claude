// 從抄牌網站匯入牌組：YDKE 網址、.ydk 內容、卡片清單文字、YGOPRODeck・Master Duel Meta 的牌組網址
import { allCards, getCard, hasCard, isExtraDeckCard, isToken } from '../engine/cardDb';
import { DECK_RULES } from './deckRules';

export interface ImportedDeck {
  /** 網站上的牌組名稱（有的話） */
  name?: string;
  /** 主牌組・額外牌組（遊戲中有的卡，同名卡最多 3 張） */
  main: number[];
  extra: number[];
  /** 遊戲中沒有的卡（卡名或卡號） */
  missing: string[];
  /** 超過 3 張而沒有放入的同名卡 */
  overLimit: string[];
  /** 牌組來源說明 */
  source: string;
}

/** 解析結果（尚未對照遊戲的卡片資料） */
interface RawDeck {
  name?: string;
  /** 卡號 */
  ids: number[];
  /** 卡名與張數（卡片清單、Master Duel Meta） */
  names: { name: string; count: number }[];
  source: string;
}

/** 讀取網頁用的中介服務（抄牌網站沒有開放跨網域讀取，透過它取得原始 HTML） */
export const READER = 'https://r.jina.ai/';
/** YGOPRODeck 的卡片 API（開放跨網域讀取），用來把異圖卡號換成原本的卡號 */
const CARD_API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// ---------------------------------------------------------------------
// 各種格式的解析
// ---------------------------------------------------------------------

/** ydke://主牌組!額外牌組!副牌組!（每段是卡號以 32 位元小端序排列後的 Base64） */
export function parseYdke(url: string): number[][] | null {
  const m = /ydke:\/\/([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!?/.exec(url.trim());
  if (!m) return null;
  const decode = (b64: string): number[] => {
    if (!b64) return [];
    const bin = atob(b64);
    const out: number[] = [];
    for (let i = 0; i + 3 < bin.length; i += 4)
      out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
    return out;
  };
  return [decode(m[1]), decode(m[2]), decode(m[3])];
}

/** 產生 ydke:// 網址（匯出用） */
export function toYdke(main: number[], extra: number[], side: number[] = []): string {
  const encode = (ids: number[]) => {
    let bin = '';
    for (const id of ids) bin += String.fromCharCode(id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, (id >>> 24) & 0xff);
    return btoa(bin);
  };
  return `ydke://${encode(main)}!${encode(extra)}!${encode(side)}!`;
}

/** .ydk 檔案：#main / #extra / !side 之後每行一個卡號 */
export function parseYdk(text: string): number[][] | null {
  if (!/^\s*[#!](main|extra|side)/m.test(text)) return null;
  const out: number[][] = [[], [], []];
  let sec = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#main/i.test(line)) sec = 0;
    else if (/^#extra/i.test(line)) sec = 1;
    else if (/^!side/i.test(line)) sec = 2;
    else if (/^\d+$/.test(line)) out[sec].push(Number(line));
  }
  return out;
}

/** 卡名比對用的正規化：去掉空白・標點，英文轉小寫 */
export function normName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s「」『』"'’`.,:;!?・·\-－–—_/\\()（）[\]【】<>＜＞《》&＆@＠#＃]/g, '');
}

/** 卡片清單文字：「3 灰流麗」「3x Ash Blossom」「Ash Blossom x3」「灰流麗 ×3」，沒寫張數視為 1 張 */
export function parseTextList(text: string): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^[-*•・]\s*/, '');
    // 「Main Deck:」「Extra Deck (15):」這類標題
    if (!line || /^(main|extra|side)\s*deck|^(主|額外|副|主要)?(牌組|卡組|卡组|デッキ)/i.test(line) || /^[#!]/.test(line)) continue;
    if (/^(monsters?|spells?|traps?|怪獸|怪兽|魔法|陷阱)\s*[(:：（]?\s*\d*\s*[)）]?\s*:?$/i.test(line)) continue;
    let count = 1;
    let m = /^(\d+)\s*[x×*]?\s+(.+)$/i.exec(line) ?? /^(\d+)\s*[x×*]\s*(.+)$/i.exec(line);
    if (m) {
      count = Number(m[1]);
      line = m[2];
    } else if ((m = /^(.+?)\s*[x×*]\s*(\d+)$/i.exec(line))) {
      line = m[1];
      count = Number(m[2]);
    } else if ((m = /^(.+?)\s+(\d)$/.exec(line))) {
      line = m[1];
      count = Number(m[2]);
    }
    if (count > 0 && line) out.push({ name: line.trim(), count });
  }
  return out;
}

/** YGOPRODeck 牌組頁面的 HTML：maindeckjs = '["卡號",...]' */
export function parseYgoprodeckHtml(html: string): { name?: string; ids: number[][] } | null {
  const pick = (key: string): number[] => {
    const m = new RegExp(`${key}\\s*=\\s*'(\\[[^']*\\])'`).exec(html);
    if (!m) return [];
    try {
      return (JSON.parse(m[1]) as (string | number)[]).map(Number).filter((n) => n > 0);
    } catch {
      return [];
    }
  };
  const main = pick('maindeckjs');
  const extra = pick('extradeckjs');
  if (!main.length && !extra.length) {
    const y = /ydke:\/\/[A-Za-z0-9+/=]*![A-Za-z0-9+/=]*![A-Za-z0-9+/=]*!?/.exec(html);
    return y ? { ids: parseYdke(y[0]) ?? [] } : null;
  }
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  return { name: title?.replace(/\s*[-|–]\s*YGOPRODeck.*$/i, '').trim() || undefined, ids: [main, extra, pick('sidedeckjs')] };
}

/** Master Duel Meta 的牌組頁面：卡圖的 alt 是卡名，前面的「N copies」是張數 */
export function parseMasterDuelMetaHtml(html: string): { name?: string; names: { name: string; count: number }[] } | null {
  const names: { name: string; count: number }[] = [];
  let pending = 1;
  const re = /<img[^>]*?(?:class="([^"]*)"[^>]*?)?alt="([^"]*)"/g;
  for (let m; (m = re.exec(html)); ) {
    const alt = m[2].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
    const copies = /^(\d+) copies$/.exec(alt);
    if (copies) {
      pending = Number(copies[1]);
      continue;
    }
    if (!(m[1] ?? '').includes('card-img')) continue;
    names.push({ name: alt, count: pending });
    pending = 1;
  }
  if (!names.length) return null;
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  return { name: title?.replace(/\s*[-|–]\s*(Yu-Gi-Oh!?\s*)?(Master Duel|Duel Links) Meta.*$/i, '').trim() || undefined, names };
}

// ---------------------------------------------------------------------
// 對照遊戲的卡片資料
// ---------------------------------------------------------------------

let nameIndex: Map<string, number> | null = null;
/** 卡名（中文・英文）→ 卡號 */
export function findCardByName(name: string): number | null {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const d of allCards()) {
      if (isToken(d)) continue;
      for (const n of [d.name, d.nameEn]) if (n && !nameIndex.has(normName(n))) nameIndex.set(normName(n), d.id);
    }
  }
  return nameIndex.get(normName(name)) ?? null;
}

/** 異圖卡號換成遊戲中的卡號（用 YGOPRODeck 的卡片 API） */
async function resolveAltArts(ids: number[], fetcher: Fetcher): Promise<Map<number, { id?: number; name?: string }>> {
  const out = new Map<number, { id?: number; name?: string }>();
  if (!ids.length) return out;
  try {
    const res = await fetcher(`${CARD_API}?id=${ids.join(',')}`);
    if (!res.ok) return out;
    const data = JSON.parse(await res.text()).data as { id: number; name: string; card_images?: { id: number }[] }[];
    for (const c of data ?? []) {
      const alts = [c.id, ...(c.card_images ?? []).map((i) => i.id)];
      for (const q of ids) if (alts.includes(q)) out.set(q, { id: hasCard(c.id) ? c.id : findCardByName(c.name) ?? undefined, name: c.name });
    }
  } catch {
    // 查不到就當作遊戲中沒有的卡
  }
  return out;
}

/** 把解析出來的卡號・卡名整理成遊戲的牌組 */
async function toDeck(raw: RawDeck, fetcher: Fetcher): Promise<ImportedDeck> {
  const missing: string[] = [];
  const picked: number[] = [];
  const unknownIds = [...new Set(raw.ids.filter((id) => !hasCard(id)))];
  const alt = await resolveAltArts(unknownIds, fetcher);
  for (const id of raw.ids) {
    if (hasCard(id)) picked.push(id);
    else {
      const r = alt.get(id);
      if (r?.id) picked.push(r.id);
      else missing.push(r?.name ?? String(id));
    }
  }
  for (const { name, count } of raw.names) {
    const id = findCardByName(name);
    if (id === null) missing.push(count > 1 ? `${name} ×${count}` : name);
    else for (let i = 0; i < count; i++) picked.push(id);
  }
  const main: number[] = [];
  const extra: number[] = [];
  const overLimit = new Set<string>();
  const counts = new Map<number, number>();
  for (const id of picked) {
    const d = getCard(id);
    if (isToken(d)) continue;
    const n = counts.get(id) ?? 0;
    if (n >= DECK_RULES.maxCopies) {
      overLimit.add(d.name);
      continue;
    }
    counts.set(id, n + 1);
    if (isExtraDeckCard(d)) {
      if (extra.length < DECK_RULES.extraMax) extra.push(id);
    } else if (main.length < DECK_RULES.mainMax) main.push(id);
  }
  // 同一張卡的卡名可能重複出現（遊戲中沒有的卡），合併顯示
  const merged = new Map<string, number>();
  for (const m of missing) merged.set(m, (merged.get(m) ?? 0) + 1);
  return {
    name: raw.name,
    main,
    extra,
    missing: [...merged].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)),
    overLimit: [...overLimit],
    source: raw.source,
  };
}

// ---------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------

/** 透過中介服務取得網頁原始 HTML */
async function fetchPage(url: string, fetcher: Fetcher): Promise<string> {
  const res = await fetcher(READER + url, { headers: { 'X-Return-Format': 'html' } });
  if (!res.ok) throw new Error(`讀取網頁失敗（HTTP ${res.status}）`);
  return res.text();
}

/**
 * 從輸入的內容匯入牌組。
 * 支援：ydke:// 網址、.ydk 內容、卡片清單、YGOPRODeck・Master Duel Meta 的牌組網址。
 * 副牌組（side deck）不匯入。
 */
export async function importDeck(input: string, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<ImportedDeck> {
  const text = input.trim();
  if (!text) throw new Error('請貼上牌組網址或牌組內容');

  const ydke = /ydke:\/\/\S+/.exec(text);
  if (ydke) {
    const ids = parseYdke(ydke[0]);
    if (!ids) throw new Error('YDKE 網址的格式不正確');
    return toDeck({ ids: [...ids[0], ...ids[1]], names: [], source: 'YDKE 網址' }, fetcher);
  }

  const ydk = parseYdk(text);
  if (ydk) return toDeck({ ids: [...ydk[0], ...ydk[1]], names: [], source: '.ydk 牌組檔' }, fetcher);

  const url = /^https?:\/\/\S+$/i.exec(text)?.[0];
  if (url) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const html = await fetchPage(url, fetcher);
    if (host.endsWith('ygoprodeck.com')) {
      const r = parseYgoprodeckHtml(html);
      if (!r) throw new Error('這個 YGOPRODeck 網頁中找不到牌組');
      return toDeck({ name: r.name, ids: [...(r.ids[0] ?? []), ...(r.ids[1] ?? [])], names: [], source: 'YGOPRODeck' }, fetcher);
    }
    if (host.endsWith('masterduelmeta.com') || host.endsWith('duellinksmeta.com')) {
      const r = parseMasterDuelMetaHtml(html);
      if (!r) throw new Error('這個網頁中找不到牌組');
      return toDeck({ name: r.name, ids: [], names: r.names, source: host.startsWith('master') ? 'Master Duel Meta' : 'Duel Links Meta' }, fetcher);
    }
    // 其他網站：網頁中有 YDKE 網址或 YGOPRODeck 格式的話也能讀
    const r = parseYgoprodeckHtml(html);
    if (r) return toDeck({ name: r.name, ids: [...(r.ids[0] ?? []), ...(r.ids[1] ?? [])], names: [], source: host }, fetcher);
    throw new Error(`不支援這個網站（${host}）。請改用網站的「匯出 YDKE」或「匯出 .ydk」功能`);
  }

  const names = parseTextList(text);
  if (!names.length) throw new Error('看不懂這個內容，請貼上牌組網址、YDKE 網址、.ydk 內容或卡片清單');
  return toDeck({ ids: [], names, source: '卡片清單' }, fetcher);
}
