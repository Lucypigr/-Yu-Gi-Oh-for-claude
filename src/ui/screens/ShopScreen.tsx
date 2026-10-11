// 商店：購買並開啟卡包
import { useState } from 'react';
import { getCard } from '../../engine/cardDb';
import { PACKS, type PackDef } from '../../game/packs';
import { type Profile, buyPack } from '../../game/profile';
import { RARITY_NAMES, type Rarity, rarityOf } from '../../game/rarity';
import { CardBack, CardDetail, CardView } from '../components/CardView';
import { Modal } from '../duel/DuelScreen';

interface Opened {
  id: number;
  isNew: boolean;
  revealed: boolean;
}

const RARITY_ORDER: Rarity[] = ['UR', 'SR', 'R', 'N'];

export function ShopScreen({ profile }: { profile: Profile }) {
  const [pack, setPack] = useState<PackDef>(PACKS[0]);
  const [opened, setOpened] = useState<Opened[] | null>(null);
  const [showList, setShowList] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);

  const buy = (times: number) => {
    const seen = new Set(Object.keys(profile.collection).map(Number));
    const out: Opened[] = [];
    for (let i = 0; i < times; i++) {
      const cards = buyPack(pack.id);
      if (!cards) break;
      for (const id of cards) {
        out.push({ id, isNew: !seen.has(id), revealed: false });
        seen.add(id);
      }
    }
    if (out.length) setOpened(out);
  };

  const unique = [...new Set(pack.cards)];
  const ownedKinds = unique.filter((id) => (profile.collection[id] ?? 0) > 0).length;

  return (
    <div className="screen shop-screen">
      <h2>卡包商店</h2>
      <div className="shop-layout">
        <div className="pack-list">
          {PACKS.map((p) => (
            <div
              key={p.id}
              className={`pack ${pack.id === p.id ? 'chosen' : ''}`}
              style={{ '--pack-color': p.color } as React.CSSProperties}
              onClick={() => setPack(p)}
            >
              <div className="pack-cover">
                <CardView data={getCard(p.cover)} size="xs" />
              </div>
              <div className="pack-info">
                <div className="pack-name">{p.name}</div>
                <div className="pack-price">🪙 {p.price}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="pack-detail panel" style={{ '--pack-color': pack.color } as React.CSSProperties}>
          <div className="pack-big">
            <div className="pack-art">
              <CardView data={getCard(pack.cover)} size="md" />
            </div>
            <div className="pack-text">
              <h3>{pack.name}</h3>
              <p>{pack.desc}</p>
              <p>
                每包 {pack.size} 張，最後一張保證「稀有」以上。
                <br />
                收錄 {unique.length} 種卡片，已收集 {ownedKinds} 種。
              </p>
              <div className="buy-buttons">
                <button className="btn primary big" disabled={profile.coins < pack.price} onClick={() => buy(1)}>
                  購買 1 包（🪙 {pack.price}）
                </button>
                <button className="btn big" disabled={profile.coins < pack.price * 5} onClick={() => buy(5)}>
                  購買 5 包（🪙 {pack.price * 5}）
                </button>
                <button className="btn" onClick={() => setShowList(true)}>
                  查看卡表
                </button>
              </div>
              {profile.coins < pack.price && <p className="error">金幣不足，去決鬥贏取金幣吧！</p>}
            </div>
          </div>
        </div>
      </div>

      {showList && (
        <Modal title={`「${pack.name}」收錄卡片`} onClose={() => setShowList(false)}>
          {RARITY_ORDER.map((r) => {
            const list = unique.filter((id) => rarityOf(id) === r);
            if (!list.length) return null;
            return (
              <div key={r}>
                <h4 className={`rarity-title r-${r}`}>
                  {r}・{RARITY_NAMES[r]}（{list.length}）
                </h4>
                <div className="pile-grid">
                  {list.map((id) => (
                    <div key={id} className="pile-item" onClick={() => setDetail(id)}>
                      <CardView data={getCard(id)} size="sm" dim={!profile.collection[id]} showRarity />
                      <span className="loc-label">持有 {profile.collection[id] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Modal>
      )}

      {opened && (
        <div className="pack-opening">
          <h2>開包結果</h2>
          <div className="opened-grid">
            {opened.map((o, i) => (
              <div
                key={i}
                className={`opened-card ${o.revealed ? 'revealed' : ''} r-${rarityOf(o.id)}`}
                onClick={() => {
                  if (!o.revealed) setOpened(opened.map((x, j) => (j === i ? { ...x, revealed: true } : x)));
                  else setDetail(o.id);
                }}
              >
                {o.revealed ? <CardView data={getCard(o.id)} size="sm" showRarity /> : <CardBack size="sm" />}
                {o.revealed && o.isNew && <span className="new-badge">NEW</span>}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            {opened.some((o) => !o.revealed) ? (
              <button className="btn primary big" onClick={() => setOpened(opened.map((o) => ({ ...o, revealed: true })))}>
                全部翻開
              </button>
            ) : (
              <button className="btn primary big" onClick={() => setOpened(null)}>
                完成
              </button>
            )}
          </div>
        </div>
      )}

      {detail !== null && (
        <Modal title={getCard(detail).name} onClose={() => setDetail(null)}>
          <CardDetail data={getCard(detail)} layout="row" />
        </Modal>
      )}
    </div>
  );
}
