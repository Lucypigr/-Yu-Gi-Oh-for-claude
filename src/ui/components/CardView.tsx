// 中文卡面
import { memo, useState, type ReactNode } from 'react';
import {
  type CardData,
  attrName,
  frameKind,
  isExtraDeckCard,
  isLink,
  isMonster,
  isPendulum,
  isSpell,
  isTrap,
  isXyz,
  raceName,
  spellKind,
  trapKind,
  typeLine,
} from '../../engine/cardDb';
import { RARITY_NAMES, rarityOf } from '../../game/rarity';

const ATTR_CLASS: Record<string, string> = { 光: 'light', 暗: 'dark', 炎: 'fire', 水: 'water', 地: 'earth', 風: 'wind', 神: 'divine' };

const SPELL_ICON: Record<string, string> = {
  normal: '',
  quickplay: '⚡',
  continuous: '∞',
  equip: '✚',
  field: '⛰',
  ritual: '✦',
  counter: '↺',
};

export function artUrl(id: number) {
  return `${import.meta.env.BASE_URL}art/${id}.webp`;
}

function attrOf(data: CardData) {
  const attr = isMonster(data) ? attrName(data.attribute) : isSpell(data) ? '魔' : '罠';
  const cls = isMonster(data) ? ATTR_CLASS[attr] ?? 'earth' : isSpell(data) ? 'spell' : 'trap';
  return { attr, cls };
}

export function CardArt({ data }: { data: CardData }) {
  const [failed, setFailed] = useState(false);
  const { cls } = attrOf(data);
  if (failed) {
    return (
      <div className={`art-fallback attr-bg-${cls}`}>
        <span>{data.name.slice(0, 1)}</span>
      </div>
    );
  }
  return <img className="art-img" src={artUrl(data.id)} alt={data.name} loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export interface CardViewProps {
  data: CardData;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** 顯示目前攻守（場上的數值） */
  atk?: number;
  def?: number;
  showRarity?: boolean;
  className?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  dim?: boolean;
}

function Stars({ data }: { data: CardData }) {
  const n = Math.min(12, data.level);
  const xyz = isXyz(data);
  return (
    <div className={`card-stars ${xyz ? 'rank' : ''}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="star">
          ★
        </span>
      ))}
    </div>
  );
}

/** 連結箭頭（8 個方向，有箭頭的會亮起） */
const ARROW_BITS: [number, string][] = [
  [0x40, 'tl'],
  [0x80, 't'],
  [0x100, 'tr'],
  [0x8, 'l'],
  [0x20, 'r'],
  [0x1, 'bl'],
  [0x2, 'b'],
  [0x4, 'br'],
];

function LinkArrows({ markers }: { markers: number }) {
  return (
    <>
      {ARROW_BITS.map(([bit, pos]) => (
        <span key={pos} className={`link-arrow la-${pos} ${markers & bit ? 'on' : ''}`} />
      ))}
    </>
  );
}

/** 正面卡片 */
export const CardView = memo(function CardView({
  data,
  size = 'md',
  atk,
  def,
  showRarity,
  className = '',
  onClick,
  onMouseEnter,
  dim,
}: CardViewProps) {
  const frame = frameKind(data);
  const monster = isMonster(data);
  const { attr, cls: attrCls } = attrOf(data);
  const rarity = rarityOf(data.id);
  const kind = isSpell(data) ? spellKind(data) : isTrap(data) ? trapKind(data) : null;
  const atkShown = atk ?? data.atk;
  const defShown = def ?? data.def;
  const atkCls = atk !== undefined && atk !== data.atk ? (atk > data.atk ? 'up' : 'down') : '';
  const defCls = def !== undefined && def !== data.def ? (def > data.def ? 'up' : 'down') : '';
  const foil = rarity === 'SR' || rarity === 'UR' ? `foil-${rarity}` : '';
  const pend = isPendulum(data);
  const link = isLink(data);
  const extraCls = `${pend ? 'pendulum' : ''} ${link ? 'is-link' : ''}`;

  // 場上用的小卡：以卡圖為主
  if (size === 'xs') {
    return (
      <div
        className={`card card-xs frame-${frame} ${extraCls} ${showRarity ? foil : ''} ${dim ? 'dim' : ''} ${className}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        title={data.name}
      >
        <div className="xs-art">
          <CardArt data={data} />
        </div>
        <div className="xs-name">{data.name}</div>
        {monster ? (
          <>
            <span className={`xs-level ${isXyz(data) ? 'rank' : ''} ${link ? 'link' : ''}`}>
              {link ? `L${data.level}` : `${isXyz(data) ? '☆' : '★'}${data.level}`}
            </span>
            <span className={`xs-attr attr-${attrCls}`}>{attr}</span>
            {pend && <span className="xs-scale">◀{data.scale}▶</span>}
            <div className="xs-stats">
              <span className={atkCls}>{atkShown}</span>
              {!link && (
                <>
                  <span className="sep">/</span>
                  <span className={defCls}>{defShown}</span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="xs-kind">
            {isSpell(data) ? '魔法' : '陷阱'}
            {kind && SPELL_ICON[kind] ? SPELL_ICON[kind] : ''}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`card card-${size} frame-${frame} ${extraCls} ${showRarity ? foil : ''} ${dim ? 'dim' : ''} ${className}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={size === 'sm' ? data.name : undefined}
    >
      <div className="card-inner">
        <div className="card-head">
          <span className="card-name">{data.name}</span>
          <span className={`card-attr attr-${attrCls}`}>{attr}</span>
        </div>
        {link ? (
          <div className="card-stars" />
        ) : monster ? (
          <Stars data={data} />
        ) : (
          <div className="card-stars spelltype">
            【{isSpell(data) ? '魔法卡' : '陷阱卡'}
            {kind && SPELL_ICON[kind] ? <span className="kind-icon">{SPELL_ICON[kind]}</span> : null}】
          </div>
        )}
        <div className="card-art">
          <CardArt data={data} />
          {link && <LinkArrows markers={data.linkMarkers ?? 0} />}
        </div>
        {pend && (
          <div className="pend-box">
            <span className="pend-scale">◀{data.scale}</span>
            {(size === 'md' || size === 'lg') && <div className="pend-desc">{data.pdesc}</div>}
            <span className="pend-scale">{data.scale}▶</span>
          </div>
        )}
        <div className="card-body">
          <div className="card-type">【{typeLine(data)}】</div>
          {(size === 'md' || size === 'lg') && <div className="card-desc">{data.desc}</div>}
          {monster && (
            <div className="card-stats">
              <span className={atkCls}>ATK/{atkShown < 0 ? '?' : atkShown}</span>
              {link ? <span>LINK-{data.level}</span> : <span className={defCls}>DEF/{defShown < 0 ? '?' : defShown}</span>}
            </div>
          )}
        </div>
        {showRarity && rarity !== 'N' && <div className={`rarity-badge r-${rarity}`}>{rarity}</div>}
      </div>
    </div>
  );
});

/** 卡背 */
export function CardBack({ size = 'md', className = '', onClick }: { size?: CardViewProps['size']; className?: string; onClick?: () => void }) {
  return (
    <div className={`card card-${size} card-back ${className}`} onClick={onClick}>
      <div className="card-back-inner">
        <div className="card-back-oval">
          <span>決鬥</span>
        </div>
      </div>
    </div>
  );
}

/** 卡片詳細：卡面＋清楚的效果文字 */
export function CardDetail({
  data,
  atk,
  def,
  children,
  layout = 'column',
  faceSize = 'md',
  dim,
}: {
  data: CardData;
  atk?: number;
  def?: number;
  children?: ReactNode;
  layout?: 'column' | 'row';
  faceSize?: 'sm' | 'md';
  dim?: boolean;
}) {
  const monster = isMonster(data);
  const { attr, cls } = attrOf(data);
  const rarity = rarityOf(data.id);
  const kind = isSpell(data) ? spellKind(data) : isTrap(data) ? trapKind(data) : null;
  return (
    <div className={`card-detail ${layout}`}>
      <div className="detail-face">
        <CardView data={data} size={faceSize} atk={atk} def={def} showRarity dim={dim} />
      </div>
      <div className="detail-info">
        <div className="detail-name">{data.name}</div>
        {data.nameEn && <div className="detail-en">{data.nameEn}</div>}
        <div className="detail-tags">
          <span className={`tag attr-${cls}`}>{attr}</span>
          {monster && <span className="tag">{raceName(data.race)}族</span>}
          {monster && (
            <span className="tag star-tag">{isLink(data) ? `LINK-${data.level}` : isXyz(data) ? `階級 ${data.level}` : `等級 ${data.level}`}</span>
          )}
          {isPendulum(data) && <span className="tag pend-tag">刻度 {data.scale}</span>}
          {!monster && kind && <span className="tag">{typeLine(data)}</span>}
          <span className={`tag r-${rarity}`}>{RARITY_NAMES[rarity]}</span>
        </div>
        <div className="detail-type">【{typeLine(data)}】{isExtraDeckCard(data) ? ' 額外牌組' : ''}</div>
        {monster && (
          <div className="detail-stats">
            <span>
              攻擊力 <b className={atk !== undefined && atk !== data.atk ? (atk > data.atk ? 'up' : 'down') : ''}>{atk ?? data.atk}</b>
            </span>
            {isLink(data) ? (
              <span className="mini-arrows" title="連結箭頭">
                {[0x40, 0x80, 0x100, 0x8, 0, 0x20, 0x1, 0x2, 0x4].map((bit, i) => (
                  <i key={i} className={bit === 0 ? 'center' : (data.linkMarkers ?? 0) & bit ? 'on' : ''} />
                ))}
              </span>
            ) : (
              <span>
                守備力 <b className={def !== undefined && def !== data.def ? (def > data.def ? 'up' : 'down') : ''}>{def ?? data.def}</b>
              </span>
            )}
          </div>
        )}
        {data.pdesc && (
          <>
            <div className="detail-label pend">靈擺效果（刻度 {data.scale}）</div>
            <div className="detail-desc pend">{data.pdesc}</div>
            <div className="detail-label">怪獸效果</div>
          </>
        )}
        <div className="detail-desc">{data.desc}</div>
        {children}
      </div>
    </div>
  );
}
