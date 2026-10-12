// 中文卡面
import { memo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import { getProfile, subscribe } from '../../game/profile';
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

/** 整張卡面的圖片（實卡卡面） */
export function faceUrl(id: number) {
  return `${import.meta.env.BASE_URL}cards/${id}.webp`;
}
/** 沒有實卡圖片的卡（改用自繪卡面） */
const faceFailed = new Set<number>();
const getCardStyle = () => getProfile()?.settings.cardStyle ?? 'real';
function useCardStyle() {
  return useSyncExternalStore(subscribe, getCardStyle);
}

// ---- 長按（或滑鼠右鍵）顯示卡片資訊 ----
interface InfoRequest {
  data: CardData;
  atk?: number;
  def?: number;
}
let infoRequest: InfoRequest | null = null;
let infoOpenedAt = 0;
const infoListeners = new Set<() => void>();
export function showCardInfo(r: InfoRequest | null) {
  infoRequest = r;
  infoOpenedAt = Date.now();
  infoListeners.forEach((f) => f());
}
const subscribeInfo = (cb: () => void) => {
  infoListeners.add(cb);
  return () => {
    infoListeners.delete(cb);
  };
};

/** 放在畫面最上層：顯示長按的卡片資訊 */
export function CardInfoHost() {
  const r = useSyncExternalStore(subscribeInfo, () => infoRequest);
  if (!r) return null;
  // 長按放開時的點擊不要馬上把視窗關掉
  const close = () => Date.now() - infoOpenedAt > 350 && showCardInfo(null);
  return (
    <div className="modal-backdrop card-info-backdrop" onClick={close}>
      <div className="modal card-info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <span>{r.data.name}</span>
          <button className="close-btn" onClick={() => showCardInfo(null)}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <CardDetail data={r.data} atk={r.atk} def={r.def} layout="row" noInfo />
        </div>
      </div>
    </div>
  );
}

function useLongPress(request: () => InfoRequest, enabled: boolean) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  if (!enabled) return {};
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        showCardInfo(request());
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      showCardInfo(request());
    },
    // 長按之後的點擊不要觸發原本的動作
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
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
  /** 不要長按顯示資訊（資訊視窗裡的卡面） */
  noInfo?: boolean;
  /** 不顯示攻守（當作永續魔法的寶玉獸等） */
  hideStats?: boolean;
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
  noInfo,
  hideStats,
}: CardViewProps) {
  const style = useCardStyle();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const press = useLongPress(() => ({ data, atk, def }), !noInfo);
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

  // 實卡卡面：整張卡的圖片，場上再加上目前的攻守
  if (style === 'real' && !faceFailed.has(data.id)) {
    const showStats = monster && !hideStats && (size === 'xs' || atkCls !== '' || defCls !== '');
    return (
      <div
        className={`card card-${size} card-real ${showRarity ? foil : ''} ${dim ? 'dim' : ''} ${className}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        title={data.name}
        {...press}
      >
        <img
          className="real-img"
          src={faceUrl(data.id)}
          alt={data.name}
          loading="lazy"
          draggable={false}
          onError={() => {
            faceFailed.add(data.id);
            rerender();
          }}
        />
        {showRarity && foil && <div className={`real-shine shine-${rarity}`} />}
        {showStats && (
          <div className={`real-stats real-stats-${size}`}>
            <span className={atkCls}>{atkShown < 0 ? '?' : atkShown}</span>
            {!link && (
              <>
                <span className="sep">/</span>
                <span className={defCls}>{defShown < 0 ? '?' : defShown}</span>
              </>
            )}
          </div>
        )}
        {showRarity && rarity !== 'N' && <div className={`rarity-badge r-${rarity}`}>{rarity}</div>}
      </div>
    );
  }

  // 場上用的小卡：以卡圖為主
  if (size === 'xs') {
    return (
      <div
        className={`card card-xs frame-${frame} ${extraCls} ${showRarity ? foil : ''} ${dim ? 'dim' : ''} ${className}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        title={data.name}
        {...press}
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
      {...press}
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
  noInfo,
}: {
  data: CardData;
  atk?: number;
  def?: number;
  children?: ReactNode;
  layout?: 'column' | 'row';
  faceSize?: 'sm' | 'md';
  dim?: boolean;
  noInfo?: boolean;
}) {
  const monster = isMonster(data);
  const { attr, cls } = attrOf(data);
  const rarity = rarityOf(data.id);
  const kind = isSpell(data) ? spellKind(data) : isTrap(data) ? trapKind(data) : null;
  return (
    <div className={`card-detail ${layout}`}>
      <div className="detail-face">
        <CardView data={data} size={faceSize} atk={atk} def={def} showRarity dim={dim} noInfo={noInfo} />
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
