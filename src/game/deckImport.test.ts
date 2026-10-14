import { describe, expect, it } from 'vitest';
import { importDeck, parseMasterDuelMetaHtml, parseTextList, parseYdk, parseYdke, parseYgoprodeckHtml, toYdke } from './deckImport';

/** 不連網的 fetch：依網址回傳內容 */
const fakeFetch = (pages: Record<string, string>) => async (url: string) => {
  const key = Object.keys(pages).find((k) => url.includes(k));
  return { ok: !!key, status: key ? 200 : 404, text: async () => (key ? pages[key] : '') };
};

describe('牌組匯入', () => {
  it('YDKE 網址可以編碼後再解碼', () => {
    const url = toYdke([46986414, 89631139, 89631139], [44508094], [5318639]);
    expect(url.startsWith('ydke://')).toBe(true);
    expect(parseYdke(url)).toEqual([[46986414, 89631139, 89631139], [44508094], [5318639]]);
  });

  it('.ydk 檔案', () => {
    const ydk = '#created by test\n#main\n46986414\n46986414\n#extra\n44508094\n!side\n5318639\n';
    expect(parseYdk(ydk)).toEqual([[46986414, 46986414], [44508094], [5318639]]);
    expect(parseYdk('3 Dark Magician')).toBeNull();
  });

  it('卡片清單的各種寫法', () => {
    expect(parseTextList('3 Dark Magician\n2x 青眼白龍\nPot of Greed x1\n死者蘇生\nMain Deck:\n')).toEqual([
      { name: 'Dark Magician', count: 3 },
      { name: '青眼白龍', count: 2 },
      { name: 'Pot of Greed', count: 1 },
      { name: '死者蘇生', count: 1 },
    ]);
  });

  it('卡片清單：中英文卡名都能對照，融合・同步・超量怪獸放到額外牌組，遊戲中沒有的卡列出來', async () => {
    const r = await importDeck('3 Dark Magician\n2 青眼白龍\n1 Stardust Dragon\n1 Not A Real Card', fakeFetch({}));
    expect(r.main).toEqual([46986414, 46986414, 46986414, 89631139, 89631139]);
    expect(r.extra).toEqual([44508094]);
    expect(r.missing).toEqual(['Not A Real Card']);
  });

  it('同名卡超過 3 張的部分不放入', async () => {
    const r = await importDeck(toYdke([55144522, 55144522, 55144522, 55144522], []), fakeFetch({}));
    expect(r.main.length).toBe(3);
    expect(r.overLimit.length).toBe(1);
  });

  it('異圖卡號用卡片 API 換成原本的卡號', async () => {
    const api = JSON.stringify({ data: [{ id: 83764718, name: 'Monster Reborn', card_images: [{ id: 83764718 }, { id: 83764719 }] }] });
    const r = await importDeck(toYdke([83764719], []), fakeFetch({ 'cardinfo.php': api }));
    expect(r.main).toEqual([83764718]);
    expect(r.missing).toEqual([]);
  });

  it('YGOPRODeck 的牌組網頁', async () => {
    const html = `<title>Dark Magician Deck - YGOPRODeck</title><script>var maindeckjs = '["46986414","46986414","5318639"]'; var extradeckjs = '["44508094"]'; var sidedeckjs = '[]';</script>`;
    expect(parseYgoprodeckHtml(html)?.ids).toEqual([[46986414, 46986414, 5318639], [44508094], []]);
    const r = await importDeck('https://ygoprodeck.com/deck/dark-magician-123', fakeFetch({ 'ygoprodeck.com/deck': html }));
    expect(r.name).toBe('Dark Magician Deck');
    expect(r.main).toEqual([46986414, 46986414, 5318639]);
    expect(r.extra).toEqual([44508094]);
  });

  it('Master Duel Meta 的牌組網頁', async () => {
    const html =
      '<title>Blue-Eyes - Yu-Gi-Oh! Master Duel Meta</title>' +
      '<img alt="3 copies"><a><img class="card-img full-width" alt="Blue-Eyes White Dragon"></a>' +
      '<img class="card-img" alt="Pot of Greed">' +
      '<img alt="UR Rarity"><img alt="2 copies"><img class="card-img" alt="Stardust Dragon">';
    expect(parseMasterDuelMetaHtml(html)?.names).toEqual([
      { name: 'Blue-Eyes White Dragon', count: 3 },
      { name: 'Pot of Greed', count: 1 },
      { name: 'Stardust Dragon', count: 2 },
    ]);
    const r = await importDeck('https://www.masterduelmeta.com/top-decks/x/y/', fakeFetch({ masterduelmeta: html }));
    expect(r.main).toEqual([89631139, 89631139, 89631139, 55144522]);
    expect(r.extra).toEqual([44508094, 44508094]);
  });

  it('不支援的網站給出說明', async () => {
    await expect(importDeck('https://example.com/deck/1', fakeFetch({ 'example.com': '<html></html>' }))).rejects.toThrow('不支援這個網站');
  });
});
