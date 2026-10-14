// 匯入牌組：貼上抄牌網站的網址、YDKE 網址、.ydk 內容或卡片清單
import { useState } from 'react';
import { getCard } from '../../engine/cardDb';
import { type ImportedDeck, importDeck } from '../../game/deckImport';
import { type DeckData, countIds } from '../../game/deckRules';
import { Modal } from '../duel/DuelScreen';

const SITES = [
  { name: 'YGOPRODeck', url: 'https://ygoprodeck.com/category/format/tournament%20meta%20decks', how: '直接貼上牌組頁面的網址' },
  { name: 'Master Duel Meta', url: 'https://www.masterduelmeta.com/top-decks', how: '直接貼上牌組頁面的網址' },
  { name: 'EDOPro・Dueling Nexus 等', url: '', how: '用「匯出 YDKE」複製 ydke:// 網址貼上，或上傳 .ydk 檔' },
];

export function ImportDeckModal({
  collection,
  onImport,
  onClose,
}: {
  collection: Record<number, number>;
  onImport: (deck: Omit<DeckData, 'id'>) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportedDeck | null>(null);
  const [name, setName] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);

  const run = async (text: string) => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await importDeck(text);
      if (!r.main.length && !r.extra.length) throw new Error('沒有找到遊戲中有的卡');
      setResult(r);
      setName((r.name ?? '匯入的牌組').slice(0, 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setInput(text);
    await run(text);
  };

  // 持有數量不足的卡
  const shortage: { name: string; need: number; owned: number }[] = [];
  if (result) {
    for (const [id, n] of countIds([...result.main, ...result.extra])) {
      const owned = collection[id] ?? 0;
      if (owned < n) shortage.push({ name: getCard(id).name, need: n, owned });
    }
  }

  /** 只放入持有的卡：每張卡最多放持有的數量 */
  const limit = (ids: number[]) => {
    if (!ownedOnly) return ids;
    const used = new Map<number, number>();
    return ids.filter((id) => {
      const n = used.get(id) ?? 0;
      if (n >= (collection[id] ?? 0)) return false;
      used.set(id, n + 1);
      return true;
    });
  };

  return (
    <Modal title="匯入牌組" onClose={onClose}>
      <div className="import-deck">
        {!result ? (
          <>
            <p className="modal-note">貼上抄牌網站的牌組網址、YDKE 網址（ydke://…）、.ydk 檔的內容，或「3 灰流麗」這樣的卡片清單。</p>
            <textarea
              className="import-input"
              rows={6}
              value={input}
              placeholder={'https://ygoprodeck.com/deck/…\nydke://…\n3 Ash Blossom & Joyous Spring'}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn primary" disabled={busy || !input.trim()} onClick={() => run(input)}>
                {busy ? '讀取中…' : '讀取牌組'}
              </button>
              <label className="btn">
                上傳 .ydk 檔
                <input type="file" accept=".ydk,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
            {error && <p className="import-error">⚠ {error}</p>}
            <div className="import-sites">
              <h4>可以使用的抄牌網站</h4>
              <ul>
                {SITES.map((s) => (
                  <li key={s.name}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                    ：{s.how}
                  </li>
                ))}
              </ul>
              <p className="modal-note">網址匯入會透過 r.jina.ai 讀取網頁內容；讀取失敗時，請改用網站的「匯出 YDKE」或「匯出 .ydk」。副牌組不會匯入。</p>
            </div>
          </>
        ) : (
          <>
            <p>
              來源：{result.source}　主牌組 {limit(result.main).length} 張・額外牌組 {limit(result.extra).length} 張
            </p>
            <label className="import-row">
              牌組名稱
              <input className="deck-name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            </label>
            {result.missing.length > 0 && (
              <div className="import-list bad">
                <b>遊戲中還沒有的卡（不會放入）：</b>
                {result.missing.join('、')}
              </div>
            )}
            {result.overLimit.length > 0 && (
              <div className="import-list bad">
                <b>超過 3 張的部分不會放入：</b>
                {result.overLimit.join('、')}
              </div>
            )}
            {shortage.length > 0 && (
              <div className="import-list">
                <b>持有數量不足（可以在商店的卡包取得）：</b>
                {shortage.map((s) => `${s.name}（${s.owned}/${s.need}）`).join('、')}
                <label className="import-row">
                  <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
                  只放入持有的卡
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setResult(null)}>
                返回
              </button>
              <button
                className="btn primary"
                onClick={() => onImport({ name: name.trim() || '匯入的牌組', main: limit(result.main), extra: limit(result.extra) })}
              >
                建立牌組
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
