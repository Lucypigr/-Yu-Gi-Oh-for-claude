// 卡片列表＋篩選（牌組編輯與圖鑑共用）
import { useMemo, useState } from 'react';
import { type CardData, ATTR, attrName, isExtraDeckCard, isMonster, isSpell, isTrap, isToken, raceName, typeLine } from '../../engine/cardDb';
import { rarityOf } from '../../game/rarity';
import { CardView } from './CardView';

type Kind = 'all' | 'monster' | 'spell' | 'trap' | 'extra';
type Sort = 'type' | 'atk' | 'level' | 'name' | 'rarity';

const KIND_LABELS: Record<Kind, string> = { all: '全部', monster: '怪獸', spell: '魔法', trap: '陷阱', extra: '額外' };
const RARITY_RANK = { UR: 0, SR: 1, R: 2, N: 3 };

function typeRank(d: CardData) {
  if (isExtraDeckCard(d)) return 3;
  if (isMonster(d)) return 0;
  if (isSpell(d)) return 1;
  return 2;
}

export function sortCards(list: CardData[], sort: Sort = 'type') {
  return [...list].sort((a, b) => {
    switch (sort) {
      case 'atk':
        return b.atk - a.atk || a.id - b.id;
      case 'level':
        return b.level - a.level || b.atk - a.atk;
      case 'name':
        return a.name.localeCompare(b.name, 'zh-Hant');
      case 'rarity':
        return RARITY_RANK[rarityOf(a.id)] - RARITY_RANK[rarityOf(b.id)] || a.id - b.id;
      default:
        return typeRank(a) - typeRank(b) || (isMonster(a) ? b.level - a.level || b.atk - a.atk : a.type - b.type) || a.id - b.id;
    }
  });
}

export function CardBrowser({
  cards,
  badge,
  dim,
  onClick,
  onHover,
  onInfo,
}: {
  cards: CardData[];
  badge?: (d: CardData) => React.ReactNode;
  dim?: (d: CardData) => boolean;
  onClick?: (d: CardData) => void;
  onHover?: (d: CardData) => void;
  /** 顯示「查看效果」按鈕 */
  onInfo?: (d: CardData) => void;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [attr, setAttr] = useState(0);
  const [sort, setSort] = useState<Sort>('type');

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const list = cards.filter((d) => {
      if (isToken(d)) return false;
      if (kind === 'monster' && !(isMonster(d) && !isExtraDeckCard(d))) return false;
      if (kind === 'spell' && !isSpell(d)) return false;
      if (kind === 'trap' && !isTrap(d)) return false;
      if (kind === 'extra' && !isExtraDeckCard(d)) return false;
      if (attr && !(isMonster(d) && d.attribute & attr)) return false;
      if (text) {
        const hay = `${d.name} ${d.nameEn} ${d.desc} ${typeLine(d)} ${isMonster(d) ? raceName(d.race) : ''}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    return sortCards(list, sort);
  }, [cards, q, kind, attr, sort]);

  return (
    <div className="card-browser">
      <div className="browser-filters">
        <input className="search" placeholder="搜尋卡名、效果…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chip-row">
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="chip-row">
          <select value={attr} onChange={(e) => setAttr(Number(e.target.value))}>
            <option value={0}>所有屬性</option>
            {Object.values(ATTR).map((a) => (
              <option key={a} value={a}>
                {attrName(a)}屬性
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="type">依種類</option>
            <option value="atk">依攻擊力</option>
            <option value="level">依等級</option>
            <option value="rarity">依稀有度</option>
            <option value="name">依名稱</option>
          </select>
          <span className="count">{filtered.length} 種</span>
        </div>
      </div>
      <div className="browser-grid">
        {filtered.map((d) => (
          <div key={d.id} className="browser-item" onClick={() => onClick?.(d)} onMouseEnter={() => onHover?.(d)}>
            <CardView data={d} size="sm" dim={dim?.(d)} showRarity />
            {badge && <div className="browser-badge">{badge(d)}</div>}
            {onInfo && (
              <button
                className="info-btn"
                title="查看效果"
                onClick={(e) => {
                  e.stopPropagation();
                  onInfo(d);
                }}
              >
                ⓘ
              </button>
            )}
          </div>
        ))}
        {!filtered.length && <div className="empty">沒有符合條件的卡片</div>}
      </div>
    </div>
  );
}
