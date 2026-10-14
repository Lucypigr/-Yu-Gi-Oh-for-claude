// 卡片圖鑑：查看所有卡片、分解多餘卡片
import { useState } from 'react';
import { type CardData, allCards } from '../../engine/cardDb';
import { type Profile, buyCards, buyPrice, sellCards, usedInDecks } from '../../game/profile';
import { SELL_PRICE, rarityOf } from '../../game/rarity';
import { CardBrowser } from '../components/CardBrowser';
import { CardDetail } from '../components/CardView';
import { Modal } from '../duel/DuelScreen';

/** 保留張數：至少 3 張或牌組使用的張數 */
const keepCount = (p: Profile, id: number) => Math.max(3, usedInDecks(p, id));

export function CollectionScreen({ profile }: { profile: Profile }) {
  const [detail, setDetail] = useState<CardData | null>(null);
  const [msg, setMsg] = useState('');
  const [popup, setPopup] = useState<CardData | null>(null);
  const cards = allCards();
  const ownedKinds = cards.filter((d) => profile.collection[d.id]).length;
  const surplus = cards.filter((d) => (profile.collection[d.id] ?? 0) > keepCount(profile, d.id));
  /** 用金幣換取 1 張 */
  const buy = (d: CardData) => {
    const price = buyPrice(d.id);
    if (price === null) return;
    if (profile.coins < price) return setMsg(`金幣不足（需要 🪙 ${price}）`);
    if (buyCards([d.id])) setMsg(`用 🪙 ${price} 換取了「${d.name}」`);
  };
  const buyButton = (d: CardData) => {
    const price = buyPrice(d.id);
    if (price === null) return null;
    return (
      <button className="btn small primary" disabled={profile.coins < price} onClick={() => buy(d)}>
        換取 1 張（🪙 {price}）
      </button>
    );
  };
  const surplusValue = surplus.reduce(
    (s, d) => s + ((profile.collection[d.id] ?? 0) - keepCount(profile, d.id)) * SELL_PRICE[rarityOf(d.id)],
    0,
  );

  return (
    <div className="screen collection-screen">
      <div className="deck-toolbar">
        <h2>卡片圖鑑</h2>
        <span>
          收集率 {ownedKinds} / {cards.filter((c) => !(c.type & 0x4000)).length}
        </span>
        <button
          className="btn small"
          disabled={!surplus.length}
          onClick={() => {
            let gain = 0;
            for (const d of surplus) gain += sellCards(d.id, (profile.collection[d.id] ?? 0) - keepCount(profile, d.id));
            setMsg(`分解完成，得到 🪙 ${gain}`);
          }}
        >
          一鍵分解超過 3 張的卡（🪙 {surplusValue}）
        </button>
        {msg && <span className="msg">{msg}</span>}
      </div>
      <div className="deck-layout collection-layout">
        <aside className="deck-detail">
          {detail ? (
            <CardDetail data={detail} faceSize="sm" dim={!profile.collection[detail.id]}>
              <div className="detail-extra">
                <div>持有 {profile.collection[detail.id] ?? 0} 張（牌組使用 {usedInDecks(profile, detail.id)} 張）</div>
                <div>
                  分解價格：🪙 {SELL_PRICE[rarityOf(detail.id)]} / 張
                </div>
                {buyButton(detail)}
                <button
                  className="btn small"
                  disabled={(profile.collection[detail.id] ?? 0) <= usedInDecks(profile, detail.id)}
                  onClick={() => {
                    const g = sellCards(detail.id, 1);
                    setMsg(g ? `分解「${detail.name}」，得到 🪙 ${g}` : '');
                  }}
                >
                  分解 1 張
                </button>
              </div>
            </CardDetail>
          ) : (
            <div className="detail-hint">點選卡片查看詳細資料</div>
          )}
        </aside>
        <section className="deck-collection wide">
          <CardBrowser
            cards={cards}
            onClick={(d) => {
              setDetail(d);
              if (window.innerWidth <= 1100) setPopup(d);
            }}
            onHover={setDetail}
            dim={(d) => !profile.collection[d.id]}
            badge={(d) => <span>×{profile.collection[d.id] ?? 0}</span>}
          />
        </section>
      </div>
      {popup && (
        <Modal title={popup.name} onClose={() => setPopup(null)}>
          <CardDetail data={popup} layout="row" dim={!profile.collection[popup.id]}>
            <div className="detail-extra">
              <div>持有 {profile.collection[popup.id] ?? 0} 張</div>
              {buyButton(popup)}
              {msg && <div className="msg">{msg}</div>}
            </div>
          </CardDetail>
        </Modal>
      )}
    </div>
  );
}
