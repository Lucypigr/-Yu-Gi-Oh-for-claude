// 決鬥畫面
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AIController } from '../../engine/ai';
import type { Card } from '../../engine/card';
import { isMonster, isPendulum } from '../../engine/cardDb';
import { Duel, type DuelResult } from '../../engine/duel';
import { type MainAction, type PlayerId, PHASE_NAMES, type Phase } from '../../engine/types';
import type { DeckData } from '../../game/deckRules';
import type { Opponent } from '../../game/opponents';
import type { Settings } from '../../game/profile';
import { CardBack, CardDetail, CardView } from '../components/CardView';
import { HumanController, type HumanRequest } from './HumanController';

const ME: PlayerId = 0;
const OPP: PlayerId = 1;

interface Props {
  playerName: string;
  deck: DeckData;
  opponent: Opponent;
  settings: Settings;
  onFinish: (result: DuelResult) => void;
}

function actionLabel(a: MainAction, duel: Duel): string {
  switch (a.type) {
    case 'summon':
      return duel.tributesNeeded(a.card) > 0 ? `上級召喚（解放 ${duel.tributesNeeded(a.card)} 隻）` : '召喚';
    case 'set':
      return isMonster(a.card.data) ? '蓋放（裡側守備）' : '蓋放';
    case 'flipSummon':
      return '反轉召喚';
    case 'changePos':
      return a.card.position === 'atk' ? '變成守備表示' : '變成攻擊表示';
    case 'activate':
      return a.effect.label && a.effect.kind !== 'activate' ? `效果：${a.effect.label}` : '發動';
    case 'setST':
      return '蓋放';
    case 'spSummon':
      return '特殊召喚';
    case 'synchro':
      return '同步召喚';
    case 'xyz':
      return '超量召喚';
    case 'link':
      return '連結召喚';
    case 'pendulumScale':
      return `發動為靈擺刻度（${a.zone === 0 ? '左' : '右'}）`;
    case 'pendulumSummon':
      return '靈擺召喚';
    default:
      return '';
  }
}

function locLabel(c: Card): string {
  const side = (c.onField ? c.controller : c.owner) === ME ? '自己' : '對方';
  const where: Record<string, string> = {
    mzone: '場上',
    szone: '魔陷區',
    fzone: '場地區',
    hand: '手牌',
    grave: '墓地',
    deck: '牌組',
    extra: '額外牌組',
    banished: '除外',
  };
  return side + (where[c.location] ?? '');
}

export function DuelScreen({ playerName, deck, opponent, settings, onFinish }: Props) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const duelRef = useRef<Duel | null>(null);
  const humanRef = useRef<HumanController | null>(null);
  const [result, setResult] = useState<DuelResult | null>(null);
  const [detail, setDetail] = useState<Card | null>(null);
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const [attacker, setAttacker] = useState<Card | null>(null);
  const [pile, setPile] = useState<{ title: string; cards: Card[] } | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  /** 窄螢幕沒有側邊詳細欄，用對話框顯示 */
  const [popupDetail, setPopupDetail] = useState<Card | null>(null);
  const narrow = () => typeof window !== 'undefined' && window.innerWidth <= 1100;
  /** 暫時收起對話框查看場地（記錄是哪一次請求，換下一個請求時自動恢復） */
  const [peekSeq, setPeekSeq] = useState(-1);
  /** 選擇卡片的對話框：已選的卡（也可以直接點場上的卡） */
  const [selState, setSelState] = useState<{ seq: number; cards: Card[] }>({ seq: -1, cards: [] });
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const human = new HumanController();
    human.autoPass = settings.autoPass;
    let raf = 0;
    let alive = true;
    const schedule = () => {
      if (!raf && alive) raf = requestAnimationFrame(() => {
        raf = 0;
        force();
      });
    };
    const speed = Math.max(0.25, settings.speed || 1);
    const ai = new AIController({
      randomness: opponent.randomness,
      ...opponent.ai,
      sleep: (ms) => (alive ? new Promise((r) => setTimeout(r, ms / speed)) : Promise.resolve()),
    });
    const duel = new Duel(
      [
        { name: playerName, deck: { main: deck.main, extra: deck.extra }, controller: human },
        { name: opponent.name, deck: opponent.deck, controller: ai },
      ],
      {
        sleep: (ms) => new Promise((r) => setTimeout(r, ms / speed)),
        onUpdate: schedule,
      },
    );
    duelRef.current = duel;
    humanRef.current = human;
    const unsub = human.subscribe(() => {
      setAttacker(null);
      setMenuCard(null);
      schedule();
    });
    duel.run().then((res) => {
      if (alive) setResult(res);
    });
    return () => {
      alive = false;
      unsub();
      cancelAnimationFrame(raf);
      duel.surrender(ME);
      human.request = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const duel = duelRef.current;
  const human = humanRef.current;
  const req: HumanRequest | null = human?.request ?? null;

  // 主要階段：每張卡可以做的行動
  const actionsByCard = useMemo(() => {
    const m = new Map<Card, MainAction[]>();
    if (req?.kind === 'main') {
      for (const a of req.actions) {
        if ('card' in a) {
          const list = m.get(a.card) ?? [];
          list.push(a);
          m.set(a.card, list);
        }
      }
    }
    return m;
  }, [req]);

  const seq = human?.seq ?? 0;
  const peeking = !!req && req.kind !== 'main' && req.kind !== 'battle' && peekSeq === seq;
  const peek = { on: peeking, toggle: () => setPeekSeq(peeking ? -1 : seq) };
  const selectReq = req?.kind === 'select' ? req : null;
  const sel = selectReq && selState.seq === seq ? selState.cards : [];
  const toggleSel = (c: Card) => {
    if (!selectReq || !selectReq.prompt.cards.includes(c)) return;
    const { max } = selectReq.prompt;
    let next: Card[];
    if (sel.includes(c)) next = sel.filter((x) => x !== c);
    else if (max === 1) next = [c];
    else if (sel.length < max) next = [...sel, c];
    else return;
    setSelState({ seq, cards: next });
  };

  const attackOptions = req?.kind === 'battle' ? req.options : [];
  const attackerOpt = attacker ? attackOptions.find((o) => o.attacker === attacker) : undefined;

  if (!duel) return <div className="duel-loading">決鬥準備中…</div>;

  const me = duel.p(ME);
  const opp = duel.p(OPP);
  // 連鎖上的卡與它們的對象
  const chainNo = new Map<Card, number>();
  duel.chain.forEach((l, i) => chainNo.set(l.card, i + 1));
  const targeted = new Set<Card>(duel.chain.flatMap((l) => duel.targetsOf(l.ctx)));
  const activating = duel.activating;

  const doMain = (a: MainAction) => {
    if (req?.kind === 'main') {
      setMenuCard(null);
      req.resolve(a);
    }
  };

  const clickCard = (c: Card) => {
    const visible = c.faceUp || (c.controller === ME && c.location !== 'deck');
    if (visible) setDetail(c);
    let handled = false;
    if (selectReq && selectReq.prompt.cards.includes(c)) {
      toggleSel(c);
      handled = true;
    } else if (req?.kind === 'main') {
      if (actionsByCard.has(c)) {
        setMenuCard(menuCard === c ? null : c);
        handled = true;
      } else setMenuCard(null);
    } else if (req?.kind === 'battle') {
      if (attackOptions.some((o) => o.attacker === c)) {
        setAttacker(attacker === c ? null : c);
        handled = true;
      } else if (attackerOpt && attackerOpt.targets.includes(c)) {
        req.resolve({ type: 'attack', attacker: attackerOpt.attacker, target: c });
        handled = true;
      }
    }
    if (!handled && visible && narrow()) setPopupDetail(c);
  };

  const viewButton = (c: Card) =>
    narrow() ? (
      <button
        onClick={() => {
          setMenuCard(null);
          setPopupDetail(c);
        }}
      >
        查看卡片
      </button>
    ) : null;

  const renderFieldCard = (c: Card | null, key: string, zoneClass: string) => {
    if (!c) return <div key={key} className={`zone ${zoneClass}`} />;
    const mine = c.controller === ME;
    const actionable = req?.kind === 'main' && actionsByCard.has(c);
    const canAttack = req?.kind === 'battle' && attackOptions.some((o) => o.attacker === c);
    const isTarget = !!attackerOpt && attackerOpt.targets.includes(c);
    const inChain = duel.chain.some((l) => l.card === c);
    const resolving = duel.resolvingLink?.card === c;
    const battling = duel.battle && (duel.battle.attacker === c || duel.battle.target === c);
    const pickable = !!selectReq && selectReq.prompt.cards.includes(c);
    const cls = [
      'zone',
      zoneClass,
      c.location === 'mzone' && c.position === 'def' ? 'def' : '',
      actionable ? 'actionable' : '',
      canAttack ? 'can-attack' : '',
      attacker === c ? 'selected' : '',
      isTarget ? 'attack-target' : '',
      inChain ? 'in-chain' : '',
      resolving ? 'resolving' : '',
      battling ? 'battling' : '',
      activating?.card === c ? 'activating' : '',
      targeted.has(c) ? 'chain-target' : '',
      pickable ? 'pickable' : '',
      sel.includes(c) ? 'picked' : '',
    ].join(' ');
    const showFace = c.faceUp || mine;
    return (
      <div key={key} className={cls} onClick={() => clickCard(c)} onMouseEnter={() => showFace && setDetail(c)}>
        {showFace ? (
          <CardView
            data={c.data}
            size="xs"
            atk={c.location === 'mzone' ? duel.getAtk(c) : undefined}
            def={c.location === 'mzone' ? duel.getDef(c) : undefined}
            className={!c.faceUp ? 'own-facedown' : ''}
            hideStats={c.location !== 'mzone'}
          />
        ) : (
          <CardBack size="xs" />
        )}
        {c.overlays.length > 0 && <span className="badge overlay-badge">素材 {c.overlays.length}</span>}
        {c.location === 'szone' && (c.zone === 0 || c.zone === 4) && c.faceUp && isPendulum(c.data) && (
          <span className="badge scale-badge">刻度 {duel.getScale(c)}</span>
        )}
        {c.counters > 0 && c.location === 'mzone' && <span className="badge counter-badge">● {c.counters}</span>}
        {c.equipTarget && <span className="badge equip-badge">裝備</span>}
        {inChain && <span className="badge chain-badge">連鎖 {chainNo.get(c)}</span>}
        {targeted.has(c) && <span className="badge target-badge">🎯 對象</span>}
        {sel.includes(c) && <span className="chosen-mark">{sel.indexOf(c) + 1}</span>}
        {menuCard === c && actionable && (
          <div className="action-menu" onClick={(e) => e.stopPropagation()}>
            {actionsByCard.get(c)!.map((a, i) => (
              <button key={i} onClick={() => doMain(a)}>
                {actionLabel(a, duel)}
              </button>
            ))}
            {viewButton(c)}
          </div>
        )}
      </div>
    );
  };

  const renderSide = (p: PlayerId) => {
    const ps = duel.p(p);
    const isOpp = p === OPP;
    // 對方的場地從我方看是左右顛倒的
    const order = isOpp ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
    const mRow = <div className="zone-row monsters">{order.map((i) => renderFieldCard(ps.mzone[i], `m${i}`, 'mzone'))}</div>;
    const sRow = (
      <div className="zone-row spells">
        {order.map((i) => renderFieldCard(ps.szone[i], `s${i}`, `szone ${i === 0 || i === 4 ? 'pzone' : ''}`))}
      </div>
    );
    const extraActions = p === ME && req?.kind === 'main' ? req.actions.filter((a) => a.type === 'synchro' || a.type === 'xyz' || a.type === 'link' || (a.type === 'spSummon' && a.card.location === 'extra')) : [];
    const faceUpExtra = ps.extra.filter((c) => c.faceUp).length;
    const left = (
      <div className="side-col">
        {renderFieldCard(ps.fzone, 'f', 'fzone')}
        <div
          className={`pile ${extraActions.length ? 'actionable' : ''}`}
          onClick={() =>
            p === ME ? setShowExtra(true) : setPile({ title: `${ps.name} 額外牌組的表側靈擺怪獸`, cards: ps.extra.filter((c) => c.faceUp) })
          }
          title="額外牌組"
        >
          {ps.extra.length ? <CardBack size="xs" /> : <div className="zone" />}
          <span className="pile-label">
            額外 {ps.extra.length}
            {faceUpExtra ? `（表 ${faceUpExtra}）` : ''}
          </span>
        </div>
      </div>
    );
    const right = (
      <div className="side-col">
        <div
          className="pile"
          onClick={() => setPile({ title: `${ps.name} 的墓地`, cards: [...ps.grave].reverse() })}
          title="墓地"
        >
          {ps.grave.length ? <CardView data={ps.grave[ps.grave.length - 1].data} size="xs" /> : <div className="zone" />}
          <span className="pile-label">墓地 {ps.grave.length}</span>
        </div>
        <div className="pile" title="牌組">
          {ps.deck.length ? <CardBack size="xs" /> : <div className="zone" />}
          <span className="pile-label">牌組 {ps.deck.length}</span>
        </div>
        {ps.banished.length > 0 && (
          <button className="mini-btn" onClick={() => setPile({ title: `${ps.name} 的除外區`, cards: [...ps.banished] })}>
            除外 {ps.banished.length}
          </button>
        )}
      </div>
    );
    return (
      <div className={`field-side ${isOpp ? 'opp' : 'me'}`}>
        {isOpp ? right : left}
        <div className="zone-grid">
          {isOpp ? (
            <>
              {sRow}
              {mRow}
            </>
          ) : (
            <>
              {mRow}
              {sRow}
            </>
          )}
        </div>
        {isOpp ? left : right}
      </div>
    );
  };

  const phases: Phase[] = ['draw', 'standby', 'main1', 'battle', 'main2', 'end'];
  const myTurn = duel.turnPlayer === ME;

  return (
    <div className="duel-screen">
      {/* 左側：卡片詳細 */}
      <aside className="duel-detail">
        {detail ? (
          <CardDetail
            data={detail.data}
            faceSize="sm"
            atk={detail.location === 'mzone' && detail.faceUp ? duel.getAtk(detail) : undefined}
            def={detail.location === 'mzone' && detail.faceUp ? duel.getDef(detail) : undefined}
          >
            <div className="detail-extra">
              <div>位置：{locLabel(detail)}</div>
              {detail.overlays.length > 0 && <div>超量素材：{detail.overlays.map((o) => o.name).join('、')}</div>}
              {duel.equipsOf(detail).length > 0 && <div>裝備：{duel.equipsOf(detail).map((e) => e.name).join('、')}</div>}
              {detail.equipTarget && <div>裝備對象：{detail.equipTarget.name}</div>}
              {detail.negated && <div className="warn">效果無效中</div>}
              {duel.isNegated(detail) && !detail.negated && <div className="warn">效果直到回合結束時無效</div>}
            </div>
          </CardDetail>
        ) : (
          <div className="detail-hint">把滑鼠移到卡片上（或點擊）可以查看卡片內容</div>
        )}
      </aside>

      {/* 中央：場地 */}
      <main className="duel-board">
        <div className="player-bar opp-bar">
          <span className="avatar">{opponent.avatar}</span>
          <span className="pname">{opp.name}</span>
          {opponent.badge && <span className="rank-badge small">{opponent.badge}</span>}
          <span className={`lp ${opp.lp <= 2000 ? 'low' : ''}`}>LP {opp.lp}</span>
          <div className="opp-hand">
            {opp.hand.map((c) => (
              <CardBack key={c.uid} size="xs" />
            ))}
          </div>
        </div>

        {renderSide(OPP)}

        {/* 額外怪獸區（雙方共用） */}
        <div className="emz-row">
          <div className="emz-spacer" />
          <div className="zone-row">
            {[null, 5, null, 6, null].map((idx, i) =>
              idx === null ? (
                <div key={i} className="emz-gap" />
              ) : (
                renderFieldCard(duel.p(0).mzone[idx] ?? duel.p(1).mzone[idx], `emz${idx}`, `mzone emz ${duel.p(1).mzone[idx] ? 'opp-emz' : ''}`)
              ),
            )}
          </div>
          <div className="emz-spacer" />
        </div>

        <div className="mid-bar">
          <div className="phase-list">
            <span className={`turn-tag ${myTurn ? 'mine' : 'theirs'}`}>
              第 {duel.turn} 回合 · {myTurn ? '你的回合' : '對方回合'}
            </span>
            {phases.map((ph) => (
              <span key={ph} className={`phase ${duel.phase === ph ? 'current' : ''}`}>
                {PHASE_NAMES[ph].replace('階段', '')}
              </span>
            ))}
          </div>
          <div className="mid-actions">
            {req?.kind === 'main' && (
              <>
                {req.actions.some((a) => a.type === 'pendulumSummon') && (
                  <button className="btn pend-btn" onClick={() => doMain({ type: 'pendulumSummon' })}>
                    靈擺召喚
                  </button>
                )}
                {req.actions.some((a) => a.type === 'toBattle') && (
                  <button className="btn primary" onClick={() => doMain({ type: 'toBattle' })}>
                    進入戰鬥階段
                  </button>
                )}
                <button className="btn" onClick={() => doMain({ type: 'endTurn' })}>
                  結束回合
                </button>
              </>
            )}
            {req?.kind === 'battle' && (
              <>
                {attackerOpt?.canDirect && (
                  <button className="btn danger" onClick={() => req.resolve({ type: 'attack', attacker: attackerOpt.attacker, target: null })}>
                    直接攻擊！
                  </button>
                )}
                <span className="hint">
                  {attacker ? '選擇攻擊對象' : attackOptions.length ? '點選要攻擊的怪獸' : ''}
                </span>
                <button className="btn" onClick={() => req.resolve({ type: 'endBattle' })}>
                  結束戰鬥
                </button>
              </>
            )}
            {!req && !result && <span className="hint thinking">{myTurn ? '處理中…' : `${opp.name} 思考中…`}</span>}
          </div>
        </div>

        {renderSide(ME)}

        <div className="player-bar me-bar">
          <span className="avatar">🙂</span>
          <span className="pname">{me.name}</span>
          <span className={`lp ${me.lp <= 2000 ? 'low' : ''}`}>LP {me.lp}</span>
          <button className="mini-btn" onClick={() => setConfirmSurrender(true)}>
            投降
          </button>
        </div>

        <div className="my-hand">
          {me.hand.map((c) => {
            const actionable = req?.kind === 'main' && actionsByCard.has(c);
            const pickable = !!selectReq && selectReq.prompt.cards.includes(c);
            return (
              <div
                key={c.uid}
                className={`hand-card ${actionable ? 'actionable' : ''} ${menuCard === c ? 'selected' : ''} ${pickable ? 'pickable' : ''} ${sel.includes(c) ? 'picked' : ''} ${activating?.card === c ? 'activating' : ''}`}
                onClick={() => clickCard(c)}
                onMouseEnter={() => setDetail(c)}
              >
                <CardView data={c.data} size="sm" />
                {sel.includes(c) && <span className="chosen-mark">{sel.indexOf(c) + 1}</span>}
                {menuCard === c && actionable && (
                  <div className="action-menu up" onClick={(e) => e.stopPropagation()}>
                    {actionsByCard.get(c)!.map((a, i) => (
                      <button key={i} onClick={() => doMain(a)}>
                        {actionLabel(a, duel)}
                      </button>
                    ))}
                    {viewButton(c)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 連鎖顯示 */}
        {duel.chain.length > 0 && (
          <div className="chain-display">
            {duel.chain.map((l, i) => (
              <div key={i} className={`chain-link ${l.negated ? 'negated' : ''} ${duel.resolvingLink === l ? 'resolving' : ''}`}>
                <span className="chain-no">連鎖 {i + 1}</span>
                <span>{l.card.name}</span>
                <span className="chain-owner">{l.player === ME ? '你' : '對方'}</span>
                {duel.targetsOf(l.ctx).length > 0 && (
                  <span className="chain-targets">
                    → {duel.targetsOf(l.ctx).map((t) => (t.faceUp || t.location !== 'mzone' ? t.name : '裡側怪獸')).join('、')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 發動演出：讓玩家清楚看到誰發動了哪張卡 */}
        {activating && (
          <div key={`${activating.card.uid}-${duel.logs.length}`} className={`activate-banner ${activating.player === ME ? 'me' : 'opp'}`}>
            <CardView data={activating.card.data} size="md" />
            <div className="activate-text">
              <div className="activate-who">{activating.player === ME ? '你' : opp.name}</div>
              <div className="activate-what">發動{activating.isCardActivation ? '' : '效果'}！</div>
              <div className="activate-name">「{activating.card.name}」</div>
              {!activating.isCardActivation && activating.label && <div className="activate-label">{activating.label}</div>}
              {duel.chain.length > 0 && <div className="activate-chain">連鎖 {duel.chain.length + 1}</div>}
            </div>
          </div>
        )}
      </main>

      {/* 右側：記錄 */}
      <aside className="duel-log" ref={logRef}>
        {duel.logs.slice(-120).map((l, i) => (
          <div key={i} className={`log-line ${l.player === ME ? 'me' : l.player === OPP ? 'opp' : ''} ${l.text.includes(' 發動「') ? 'activate' : ''}`}>
            {l.text}
          </div>
        ))}
      </aside>

      {/* ---- 對話框 ---- */}
      {req?.kind === 'response' && (
        <Modal title={responseTitle(duel, req)} peek={peek}>
          <ResponseContext duel={duel} onHover={setDetail} />
          <div className="option-cards">
            {req.options.map((o, i) => (
              <div key={i} className="option-card" onMouseEnter={() => setDetail(o.card)}>
                <CardView data={o.card.data} size="sm" onClick={() => narrow() && setPopupDetail(o.card)} />
                <button className="btn primary" onClick={() => req.resolve(o)}>
                  {o.effect.kind === 'activate' ? '發動' : o.effect.label ?? '發動效果'}
                </button>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => req.resolve(null)}>
              不發動
            </button>
          </div>
        </Modal>
      )}

      {req?.kind === 'select' && <SelectModal req={req} sel={sel} toggle={toggleSel} onHover={setDetail} peek={peek} />}

      {req?.kind === 'option' && (
        <Modal title={req.prompt.title} peek={peek}>
          {req.prompt.card && (
            <div className="modal-card">
              <CardView data={req.prompt.card.data} size="sm" />
            </div>
          )}
          <div className="modal-actions column">
            {req.prompt.options.map((o, i) => (
              <button key={i} className="btn" onClick={() => req.resolve(i)}>
                {o.label}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {req?.kind === 'confirm' && (
        <Modal title={req.prompt.title} peek={peek}>
          {req.prompt.card && (
            <div className="modal-card">
              <CardView data={req.prompt.card.data} size="md" />
            </div>
          )}
          <div className="modal-actions">
            <button className="btn primary" onClick={() => req.resolve(true)}>
              是
            </button>
            <button className="btn" onClick={() => req.resolve(false)}>
              否
            </button>
          </div>
        </Modal>
      )}

      {showExtra && (
        <Modal title="額外牌組" onClose={() => setShowExtra(false)}>
          <div className="pile-grid">
            {me.extra.map((c) => {
              const acts =
                req?.kind === 'main' ? req.actions.filter((a) => (a.type === 'synchro' || a.type === 'xyz' || a.type === 'link' || a.type === 'spSummon') && a.card === c) : [];
              return (
                <div key={c.uid} className="pile-item" onMouseEnter={() => setDetail(c)}>
                  <CardView data={c.data} size="sm" dim={!acts.length && !c.faceUp} />
                  {c.faceUp && <span className="loc-label">表側（可靈擺召喚）</span>}
                  {acts.map((a, i) => (
                    <button
                      key={i}
                      className="btn primary small"
                      onClick={() => {
                        setShowExtra(false);
                        doMain(a);
                      }}
                    >
                      {actionLabel(a, duel)}
                    </button>
                  ))}
                </div>
              );
            })}
            {!me.extra.length && <div className="empty">額外牌組沒有卡片</div>}
          </div>
          <p className="modal-note">融合怪獸需要使用「融合」魔法卡召喚。表側的靈擺怪獸可以用靈擺召喚回到場上。</p>
        </Modal>
      )}

      {pile && (
        <Modal title={pile.title} onClose={() => setPile(null)}>
          <div className="pile-grid">
            {pile.cards.map((c) => (
              <div
                key={c.uid}
                className="pile-item"
                onMouseEnter={() => setDetail(c)}
                onClick={() => (narrow() ? setPopupDetail(c) : setDetail(c))}
              >
                <CardView data={c.data} size="sm" />
              </div>
            ))}
            {!pile.cards.length && <div className="empty">沒有卡片</div>}
          </div>
        </Modal>
      )}

      {confirmSurrender && !result && (
        <Modal title="確定要投降嗎？" onClose={() => setConfirmSurrender(false)}>
          <div className="modal-actions">
            <button
              className="btn danger"
              onClick={() => {
                setConfirmSurrender(false);
                duel.surrender(ME);
                // 讓引擎離開等待中的請求
                const r = human?.request;
                if (r) {
                  if (r.kind === 'main') r.resolve({ type: 'endTurn' });
                  else if (r.kind === 'battle') r.resolve({ type: 'endBattle' });
                  else if (r.kind === 'response') r.resolve(null);
                  else if (r.kind === 'select') r.resolve([]);
                  else if (r.kind === 'option') r.resolve(0);
                  else r.resolve(false);
                }
              }}
            >
              投降
            </button>
            <button className="btn" onClick={() => setConfirmSurrender(false)}>
              繼續決鬥
            </button>
          </div>
        </Modal>
      )}

      {popupDetail && (
        <Modal title={popupDetail.name} onClose={() => setPopupDetail(null)}>
          <CardDetail
            data={popupDetail.data}
            layout="row"
            atk={popupDetail.location === 'mzone' && popupDetail.faceUp ? duel.getAtk(popupDetail) : undefined}
            def={popupDetail.location === 'mzone' && popupDetail.faceUp ? duel.getDef(popupDetail) : undefined}
          />
        </Modal>
      )}

      {result && (
        <div className="result-overlay">
          <div className={`result-box ${result.winner === ME ? 'win' : result.winner === null ? 'draw' : 'lose'}`}>
            <h1>{result.winner === ME ? '勝利！' : result.winner === null ? '平手' : '敗北…'}</h1>
            <p>{result.reason}</p>
            <button className="btn primary big" onClick={() => onFinish(result)}>
              繼續
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function responseTitle(duel: Duel, req: Extract<HumanRequest, { kind: 'response' }>): string {
  const top = duel.chainTop;
  const ev = req.window.event;
  if (top) return `對${top.player === ME ? '自己' : '對方'}發動的「${top.card.name}」連鎖發動？`;
  switch (req.window.kind) {
    case 'summon':
      return ev?.card ? `「${ev.card.name}」召喚成功，要發動卡片嗎？` : '要發動卡片嗎？';
    case 'summonAttempt':
      return ev?.card ? `「${ev.card.name}」召喚之際，要發動反擊陷阱嗎？` : '要發動反擊陷阱嗎？';
    case 'attack':
      return ev?.attacker ? `「${ev.attacker.name}」宣言攻擊，要發動卡片嗎？` : '要發動卡片嗎？';
    case 'damageCalc':
      return '傷害計算前，要發動卡片嗎？';
    case 'phase':
      return `${PHASE_NAMES[duel.phase]}，要發動卡片嗎？`;
    default:
      return '要發動卡片嗎？';
  }
}

interface Peek {
  on: boolean;
  toggle: () => void;
}

export function Modal({
  title,
  children,
  onClose,
  peek,
  peekExtra,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  /** 可以暫時收起對話框查看場地 */
  peek?: Peek;
  /** 收起時顯示在浮動列上的內容 */
  peekExtra?: React.ReactNode;
}) {
  if (peek?.on)
    return (
      <div className="peek-bar">
        <span className="peek-title">{title}</span>
        {peekExtra}
        <button className="btn primary small" onClick={peek.toggle}>
          返回選擇
        </button>
      </div>
    );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <span>{title}</span>
          {peek && (
            <button className="peek-btn" onClick={peek.toggle} title="收起視窗，查看場上狀況">
              👁 查看場地
            </button>
          )}
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function SelectModal({
  req,
  sel,
  toggle,
  onHover,
  peek,
}: {
  req: Extract<HumanRequest, { kind: 'select' }>;
  sel: Card[];
  toggle: (c: Card) => void;
  onHover: (c: Card) => void;
  peek: Peek;
}) {
  const { prompt } = req;
  const valid = sel.length >= prompt.min && sel.length <= prompt.max && (!prompt.validate || prompt.validate(sel));
  const range = prompt.min === prompt.max ? `${prompt.min}` : `${prompt.min}～${prompt.max}`;
  const confirm = (
    <button className="btn primary" disabled={!valid} onClick={() => req.resolve(sel)}>
      確定
    </button>
  );
  const onField = prompt.cards.some((c) => c.onField || c.location === 'hand');
  return (
    <Modal
      title={`${prompt.title}（選 ${range} 張）`}
      peek={peek}
      peekExtra={
        <>
          <span className="hint">
            {onField ? '可以直接點場上發光的卡來選擇' : ''} 已選 {sel.length} 張
          </span>
          {confirm}
        </>
      }
    >
      <div className="pile-grid select-grid">
        {prompt.cards.map((c) => {
          const hidden = c.onField && !c.faceUp && c.controller !== ME;
          const deckHidden = c.location === 'deck' && c.owner !== ME;
          return (
            <div
              key={c.uid}
              className={`pile-item selectable ${sel.includes(c) ? 'chosen' : ''}`}
              onClick={() => toggle(c)}
              onMouseEnter={() => !hidden && !deckHidden && onHover(c)}
            >
              {hidden || deckHidden ? <CardBack size="sm" /> : <CardView data={c.data} size="sm" />}
              <span className="loc-label">{locLabel(c)}</span>
              {sel.includes(c) && <span className="chosen-mark">{sel.indexOf(c) + 1}</span>}
            </div>
          );
        })}
      </div>
      <div className="modal-actions">
        <span className="hint">已選 {sel.length} 張</span>
        {confirm}
      </div>
    </Modal>
  );
}

/** 連鎖回應時顯示目前的連鎖與對象，方便判斷要不要連鎖 */
function ResponseContext({ duel, onHover }: { duel: Duel; onHover: (c: Card) => void }) {
  if (!duel.chain.length) return null;
  return (
    <div className="response-context">
      {[...duel.chain].reverse().map((l, i) => {
        const targets = duel.targetsOf(l.ctx);
        return (
          <div key={i} className={`response-link ${l.player === ME ? 'me' : 'opp'}`} onMouseEnter={() => onHover(l.card)}>
            <CardView data={l.card.data} size="xs" />
            <div>
              <div>
                <b>連鎖 {duel.chain.length - i}</b>：{l.player === ME ? '你' : '對方'}發動「{l.card.name}」
              </div>
              {targets.length > 0 && (
                <div className="hint">
                  對象：
                  {targets
                    .map(
                      (t) =>
                        `${(t.onField ? t.controller : t.owner) === ME ? '你的' : '對方的'}「${t.faceUp || t.location !== 'mzone' ? t.name : '裡側怪獸'}」`,
                    )
                    .join('、')}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
