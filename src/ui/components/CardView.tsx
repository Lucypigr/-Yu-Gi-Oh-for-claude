// 中文卡面
import { memo, useState } from 'react';
import {
  type CardData,
  attrName,
  frameKind,
  isMonster,
  isSpell,
  isTrap,
  isXyz,
  spellKind,
  trapKind,
  typeLine,
} from '../../engine/cardDb';
import { rarityOf } from '../../game/rarity';

const ATTR_CLASS: Record<string, string> = { 光: 'light', 暗: 'dark', 炎: 'fire', 水: 'water', 地: 'earth', 風: 'wind', 神: 'divine' };

const SPELL_ICON: Record<string, string> = {
  normal: '',
  quickplay: '⚡',
  continuous: '∞',
  equip: '✚',
  field: '⛰',
  ritual: '🔥',
  counter: '↺',
};

export function artUrl(id: number) {
  return `${import.meta.env.BASE_URL}art/${id}.webp`;
}

export function CardArt({ data }: { data: CardData }) {
  const [failed, setFailed] = useState(false);
  const attr = isMonster(data) ? attrName(data.attribute) : isSpell(data) ? '魔' : '罠';
  if (failed) {
    return (
      <div className={`art-fallback attr-bg-${ATTR_CLASS[attr] ?? (isSpell(data) ? 'spell' : 'trap')}`}>
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
  const attr = monster ? attrName(data.attribute) : isSpell(data) ? '魔' : '罠';
  const attrCls = monster ? ATTR_CLASS[attr] ?? 'earth' : isSpell(data) ? 'spell' : 'trap';
  const rarity = rarityOf(data.id);
  const kind = isSpell(data) ? spellKind(data) : isTrap(data) ? trapKind(data) : null;
  const atkShown = atk ?? data.atk;
  const defShown = def ?? data.def;
  const atkCls = atk !== undefined && atk !== data.atk ? (atk > data.atk ? 'up' : 'down') : '';
  const defCls = def !== undefined && def !== data.def ? (def > data.def ? 'up' : 'down') : '';
  return (
    <div
      className={`card card-${size} frame-${frame} ${showRarity ? `rarity-${rarity}` : ''} ${dim ? 'dim' : ''} ${className}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={size === 'xs' || size === 'sm' ? data.name : undefined}
    >
      <div className="card-inner">
        <div className="card-head">
          <span className="card-name">{data.name}</span>
          <span className={`card-attr attr-${attrCls}`}>{attr}</span>
        </div>
        {monster ? (
          <div className={`card-stars ${isXyz(data) ? 'rank' : ''}`}>{(isXyz(data) ? '☆' : '★').repeat(Math.min(12, data.level))}</div>
        ) : (
          <div className="card-stars spelltype">
            【{isSpell(data) ? '魔法卡' : '陷阱卡'}
            {kind && SPELL_ICON[kind] ? ` ${SPELL_ICON[kind]}` : ''}】
          </div>
        )}
        <div className="card-art">
          <CardArt data={data} />
        </div>
        {size !== 'xs' && (
          <div className="card-body">
            <div className="card-type">【{typeLine(data)}】</div>
            {(size === 'md' || size === 'lg') && <div className="card-desc">{data.desc}</div>}
            {monster && (
              <div className="card-stats">
                <span className={atkCls}>ATK/{atkShown < 0 ? '?' : atkShown}</span>
                <span className={defCls}> DEF/{defShown < 0 ? '?' : defShown}</span>
              </div>
            )}
          </div>
        )}
        {size === 'xs' && monster && (
          <div className="card-mini-stats">
            <span className={atkCls}>{atkShown}</span>/<span className={defCls}>{defShown}</span>
          </div>
        )}
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
