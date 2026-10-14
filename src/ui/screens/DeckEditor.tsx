// 牌組編輯：完全自由組合（每張卡最多 3 張，受持有數量限制）
import { useMemo, useState } from 'react';
import { type CardData, allCards, getCard, isExtraDeckCard, isMonster, isSpell, isTrap } from '../../engine/cardDb';
import { DECK_RULES, type DeckData, validateDeck } from '../../game/deckRules';
import { type Profile, deleteDeck, saveDeck, setActiveDeck } from '../../game/profile';
import { toYdke } from '../../game/deckImport';
import { CardBrowser, sortCards } from '../components/CardBrowser';
import { ImportDeckModal } from '../components/ImportDeckModal';
import { CardDetail, CardView } from '../components/CardView';
import { Modal } from '../duel/DuelScreen';

function newId() {
  return `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

export function DeckEditor({ profile }: { profile: Profile }) {
  const [deckId, setDeckId] = useState(profile.activeDeckId);
  const deck = profile.decks.find((d) => d.id === deckId) ?? profile.decks[0];
  const [detail, setDetail] = useState<CardData | null>(null);
  const [msg, setMsg] = useState('');
  const [popup, setPopup] = useState<CardData | null>(null);
  const [importing, setImporting] = useState(false);

  const ownedCards = useMemo(
    () => allCards().filter((d) => (profile.collection[d.id] ?? 0) > 0),
    [profile.collection],
  );
  const inDeck = (id: number) => [...deck.main, ...deck.extra].filter((x) => x === id).length;
  const errors = validateDeck(deck, profile.collection);

  const update = (d: DeckData) => {
    saveDeck(d);
    setMsg('');
  };

  const add = (d: CardData) => {
    const used = inDeck(d.id);
    const owned = profile.collection[d.id] ?? 0;
    if (used >= owned) return setMsg(`「${d.name}」已經沒有多餘的卡了`);
    if (used >= DECK_RULES.maxCopies) return setMsg(`同名卡最多 ${DECK_RULES.maxCopies} 張`);
    if (isExtraDeckCard(d)) {
      if (deck.extra.length >= DECK_RULES.extraMax) return setMsg(`額外牌組最多 ${DECK_RULES.extraMax} 張`);
      update({ ...deck, extra: [...deck.extra, d.id] });
    } else {
      if (deck.main.length >= DECK_RULES.mainMax) return setMsg(`主牌組最多 ${DECK_RULES.mainMax} 張`);
      update({ ...deck, main: [...deck.main, d.id] });
    }
  };

  const remove = (id: number, extra: boolean) => {
    const list = extra ? deck.extra : deck.main;
    const i = list.lastIndexOf(id);
    if (i < 0) return;
    const next = [...list.slice(0, i), ...list.slice(i + 1)];
    update(extra ? { ...deck, extra: next } : { ...deck, main: next });
  };

  const createDeck = (copy: boolean) => {
    const d: DeckData = copy
      ? { ...deck, id: newId(), name: `${deck.name} 的複本`, main: [...deck.main], extra: [...deck.extra] }
      : { id: newId(), name: `新牌組 ${profile.decks.length + 1}`, main: [], extra: [] };
    saveDeck(d);
    setDeckId(d.id);
  };

  const exportYdke = async () => {
    const url = toYdke(deck.main, deck.extra);
    try {
      await navigator.clipboard.writeText(url);
      setMsg('已複製 YDKE 網址，可以貼到其他網站或模擬器');
    } catch {
      prompt('複製這個 YDKE 網址：', url);
    }
  };

  const mainCards = sortCards(deck.main.map(getCard));
  const extraCards = sortCards(deck.extra.map(getCard));
  const nMon = deck.main.filter((id) => isMonster(getCard(id))).length;
  const nSpell = deck.main.filter((id) => isSpell(getCard(id))).length;
  const nTrap = deck.main.filter((id) => isTrap(getCard(id))).length;

  return (
    <div className="screen deck-screen">
      <div className="deck-toolbar">
        <select value={deck.id} onChange={(e) => setDeckId(e.target.value)}>
          {profile.decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.id === profile.activeDeckId ? '（使用中）' : ''}
            </option>
          ))}
        </select>
        <input className="deck-name" value={deck.name} maxLength={20} onChange={(e) => update({ ...deck, name: e.target.value })} />
        <button className="btn small" onClick={() => createDeck(false)}>
          新牌組
        </button>
        <button className="btn small" onClick={() => createDeck(true)}>
          複製
        </button>
        <button className="btn small" disabled={deck.id === profile.activeDeckId} onClick={() => setActiveDeck(deck.id)}>
          設為使用中
        </button>
        <button
          className="btn small danger"
          disabled={profile.decks.length <= 1}
          onClick={() => {
            if (confirm(`確定要刪除「${deck.name}」嗎？`)) {
              deleteDeck(deck.id);
              setDeckId(profile.decks.find((d) => d.id !== deck.id)!.id);
            }
          }}
        >
          刪除
        </button>
        <button
          className="btn small"
          disabled={!deck.main.length && !deck.extra.length}
          onClick={() => {
            if (confirm('要清空這個牌組嗎？')) update({ ...deck, main: [], extra: [] });
          }}
        >
          清空
        </button>
        <button className="btn small" onClick={() => setImporting(true)}>
          匯入
        </button>
        <button className="btn small" disabled={!deck.main.length && !deck.extra.length} onClick={exportYdke}>
          匯出 YDKE
        </button>
      </div>

      <div className="deck-layout">
        <aside className="deck-detail">
          {detail ? (
            <CardDetail data={detail} faceSize="sm">
              <div className="detail-extra">
                持有 {profile.collection[detail.id] ?? 0} 張 · 牌組中 {inDeck(detail.id)} 張
              </div>
            </CardDetail>
          ) : (
            <div className="detail-hint">
              點右側收藏把卡片加入牌組，點牌組中的卡片移除。
              <br />
              主牌組 {DECK_RULES.mainMin}～{DECK_RULES.mainMax} 張，額外牌組最多 {DECK_RULES.extraMax} 張，同名卡最多 {DECK_RULES.maxCopies} 張。
            </div>
          )}
        </aside>

        <section className="deck-contents">
          <div className={`deck-status ${errors.length ? 'bad' : 'ok'}`}>
            {errors.length ? `⚠ ${errors[0]}` : '✔ 牌組可以使用'}
            {msg && <span className="msg">　{msg}</span>}
          </div>
          <h3>
            主牌組 {deck.main.length} 張 <small>（怪獸 {nMon} / 魔法 {nSpell} / 陷阱 {nTrap}）</small>
          </h3>
          <div className="deck-grid">
            {mainCards.map((d, i) => (
              <div key={i} className="deck-item" onClick={() => remove(d.id, false)} onMouseEnter={() => setDetail(d)}>
                <CardView data={d} size="xs" />
                <button
                  className="info-btn"
                  title="查看效果"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopup(d);
                  }}
                >
                  ⓘ
                </button>
              </div>
            ))}
          </div>
          <h3>額外牌組 {deck.extra.length} 張</h3>
          <div className="deck-grid extra">
            {extraCards.map((d, i) => (
              <div key={i} className="deck-item" onClick={() => remove(d.id, true)} onMouseEnter={() => setDetail(d)}>
                <CardView data={d} size="xs" />
                <button
                  className="info-btn"
                  title="查看效果"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopup(d);
                  }}
                >
                  ⓘ
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="deck-collection">
          <h3>我的收藏</h3>
          <CardBrowser
            cards={ownedCards}
            onClick={add}
            onHover={setDetail}
            onInfo={setPopup}
            dim={(d) => inDeck(d.id) >= Math.min(DECK_RULES.maxCopies, profile.collection[d.id] ?? 0)}
            badge={(d) => (
              <span>
                {inDeck(d.id)}/{Math.min(DECK_RULES.maxCopies, profile.collection[d.id] ?? 0)}
              </span>
            )}
          />
        </section>
      </div>
      {importing && (
        <ImportDeckModal
          collection={profile.collection}
          coins={profile.coins}
          onClose={() => setImporting(false)}
          onImport={(d) => {
            const nd: DeckData = { ...d, id: newId() };
            saveDeck(nd);
            setDeckId(nd.id);
            setImporting(false);
            setMsg(`已匯入「${nd.name}」`);
          }}
        />
      )}
      {popup && (
        <Modal title={popup.name} onClose={() => setPopup(null)}>
          <CardDetail data={popup} layout="row">
            <div className="detail-extra">
              持有 {profile.collection[popup.id] ?? 0} 張 · 牌組中 {inDeck(popup.id)} 張
            </div>
          </CardDetail>
        </Modal>
      )}
    </div>
  );
}
