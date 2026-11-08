// 第三十二彈：閃刀姬追加・絢嵐；第三十三彈：雷盟
import { Card } from '../card';
import { type CardData, getCard, isLink, isMonster, isSpell, isTrap, RACE, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, EffectDef, GameEvent, PlayerId } from '../types';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const RAYE = 26077387;
const ROZE = 37351133;
const MST = 5318639;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const other = (p: PlayerId) => (p === 0 ? 1 : 0) as PlayerId;
const isEffectMon = (d: CardData) => isMonster(d) && (d.type & 0x20) !== 0;

// =====================================================================
// 閃刀姬
// =====================================================================
const isSS = (d: CardData) => d.nameEn.includes('Sky Striker');
const isAce = (d: CardData) => isMonster(d) && d.nameEn.startsWith('Sky Striker Ace') || d.id === 25072579;
const isSSSpell = (d: CardData) => isSpell(d) && isSS(d);

// 試號閃刀姬-天津
def(25072579, {
  link: { min: 1, max: 1, filter: (c) => isAce(c.data) },
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'quick',
      label: '對方場上的攻擊力 2000 以上的怪獸把效果發動時：那個效果變成「對方場上 1 隻「閃刀姬」連結怪獸破壞」',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          !!top &&
          top.player === ctx.opp &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          top.card.location === 'mzone' &&
          d.getAtk(top.card) >= 2000
        );
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        const victimSide = ctx.player;
        link.ctx.data.replacedOperation = async (lctx: EffectContext) => {
          const d = lctx.duel;
          const pool = d.faceUpMonsters(victimSide).filter((c) => isLink(c.data) && isAce(c.data));
          if (!pool.length) return;
          const c = await d.selectOne({ player: lctx.player, title: '選擇要破壞的「閃刀姬」連結怪獸', cards: pool, hint: 'harm' });
          if (c) await d.destroy([c], 'effect', lctx.card);
        };
        ctx.duel.log(`「${link.card.name}」的效果變成「對方場上 1 隻「閃刀姬」連結怪獸破壞」`);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: '這張卡和對方怪獸戰鬥的攻擊宣言時：自己場上 1 隻「閃刀姬」怪獸和對方場上 1 張卡破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && !!b.target && (b.attacker === ctx.card || b.target === ctx.card) && ctx.duel.fieldCards(ctx.opp).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isAce(c.data)), { title: '選擇自己的「閃刀姬」怪獸', hint: 'cost', aiValue: (c) => (c === ctx.card ? 100 : -cardValue(d, c, ctx.player)) });
        const foe = await d.select({ player: ctx.player, title: '選擇對方場上 1 張卡', cards: d.fieldCards(ctx.opp), min: 1, max: 1, hint: 'harm', aiValue: (c) => cardValue(d, c, ctx.player) });
        d.setTargets(ctx, [...mine, ...foe]);
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.onField);
        if (ts.length) await ctx.duel.destroy(ts, 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 閃刀姬-卡米麗婭
def(63013339, {
  link: { min: 2, max: 2, filter: (c) => isEffectMon(c.data) },
  spSummonOnly: ['link'],
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'ignition',
      label: '自己墓地的魔法卡是 3 張以下：從牌組把 1 張「閃刀」卡送去墓地',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).grave.filter((c) => isSpell(c.data)).length <= 3 && deckFilter(ctx, isSS).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「閃刀」卡', cards: deckFilter(ctx, isSS), hint: 'benefit', aiValue: (x) => (isSpell(x.data) ? 50 : 30) });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被送去墓地：這張卡在對方場上特殊召喚，對方場上 1 隻怪獸送去墓地',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(ctx.opp), { title: '選擇要送去墓地的對方怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (ctx.card.location !== 'grave' || !d.extraZones(ctx.opp, ctx.card).length) return;
        if (!d.specialSummon(ctx.card, ctx.opp, { position: 'atk', by: ctx.card, ignoreConditions: true })) return;
        const card = ctx.card;
        const stint = card.stint;
        const owner = card.owner;
        d.delayed.push({ turn: d.turn, run: () => void (card.onField && card.stint === stint && d.takeControl(card, owner, false)) });
        if (t?.onField) d.sendToGrave([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 閃刀亞式-雙紐閃門
const lemnPairs = (ctx: EffectContext) => {
  const g = ctx.duel.p(ctx.player).grave;
  return { mons: g.filter((c) => isAce(c.data)), spells: g.filter((c) => c !== ctx.card && isSSSpell(c.data)) };
};
def(34433770, {
  effects: [
    activate({
      once: 'name',
      categories: ['toDeck', 'toHand'],
      condition: (ctx) => {
        const { mons, spells } = lemnPairs(ctx);
        return mons.length > 0 && spells.length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const { mons, spells } = lemnPairs(ctx);
        const n = Math.min(mons.length, spells.length);
        const m = await d.select({ player: ctx.player, title: `選擇「閃刀姬」怪獸（最多 ${n} 隻）`, cards: mons, min: 1, max: n, hint: 'cost' });
        const sp = await d.select({ player: ctx.player, title: `選擇 ${m.length} 張「閃刀」魔法卡`, cards: spells, min: m.length, max: m.length, hint: 'cost' });
        d.setTargets(ctx, [...m, ...sp]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        const back = d.returnToDeck(ts, false, 'effect', ctx.card).length;
        const k = Math.floor(back / 3);
        if (!k || !d.fieldCards(ctx.opp).length || !(await d.confirm({ player: ctx.player, title: `要讓場上最多 ${k} 張卡回到手牌嗎？`, ai: true }))) return;
        const sel = await d.select({ player: ctx.player, title: `選擇最多 ${k} 張卡`, cards: d.fieldCards(), min: 1, max: k, hint: 'harm', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
        d.returnToHand(sel, 'effect', ctx.card);
      },
      ai: (ctx) => (Math.min(lemnPairs(ctx).mons.length, lemnPairs(ctx).spells.length) >= 2 && ctx.duel.fieldCards(ctx.opp).length ? 70 : 0),
    }),
    {
      kind: 'trigger',
      event: 'summoned',
      label: '自己場上有「閃刀」怪獸特殊召喚：除外墓地的這張卡，進行 1 隻「閃刀姬」連結怪獸的連結召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ctx.card.location !== 'grave' || !ev || ['normal', 'tribute', 'flip'].includes(ev.summonType ?? '')) return false;
        return (ev.cards ?? []).some((c) => c.controller === ctx.player && isSS(c.data)) && ssLinks(ctx.duel, ctx.player).length > 0;
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const l = await d.selectOne({ player: ctx.player, title: '選擇「閃刀姬」連結怪獸', cards: ssLinks(d, ctx.player), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (l) await d.linkSummonByEffect(ctx.player, l);
      },
      ai: () => 75,
    },
  ],
});
const ssLinks = (d: Duel, p: PlayerId) => d.p(p).extra.filter((c) => isLink(c.data) && isAce(c.data) && d.summonAllowed(p, c, 'special') && d.linkMaterialSets(p, c).length > 0);

// 閃刀姬=零露
def(76072561, {
  link: { min: 2, max: 2, filter: (c) => isAce(c.data) },
  ssOncePerTurn: true,
  cannotBeLinkMaterial: true,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從牌組・墓地把 1 張「閃刀」魔法卡加入手牌',
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && zeroSpells(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「閃刀」魔法卡', cards: zeroSpells(ctx), hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '把這張卡解放：「閃刀姬-零衣」「閃刀姬-露世」各 1 隻從牌組・墓地特殊召喚，那之後可以把場上 1 張卡破壞',
      once: 'nameShared',
      categories: ['summon', 'destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && zeroPool(ctx, RAYE).length > 0 && zeroPool(ctx, ROZE).length > 0 && ctx.duel.freeMZones(ctx.player) >= 1,
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) < 2) return;
        const a = zeroPool(ctx, RAYE)[0];
        const b = zeroPool(ctx, ROZE)[0];
        if (!a || !b) return;
        for (const c of [a, b]) {
          const fromDeck = c.location === 'deck';
          d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
        if (d.fieldCards(ctx.opp).length && (await d.confirm({ player: ctx.player, title: '要把場上 1 張卡破壞嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的卡', cards: d.fieldCards(), hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -5000) });
          if (c) await d.destroy([c], 'effect', ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.fieldCards(ctx.opp).length ? 80 : 0),
    },
  ],
});
const zeroSpells = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isSSSpell(c.data));
const zeroPool = (ctx: EffectContext, id: number) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => c.id === id && canRevive(c));

// =====================================================================
// 絢嵐
// =====================================================================
const isRT = (d: CardData) => d.nameEn.includes('Radiant Typhoon') || d.name.includes('絢嵐');
const rtSpOk = (d: Duel, p: PlayerId) => d.p(p).grave.some((c) => c.id === MST) || d.spellTraps(other(p)).length === 0;
/** 被「旋風」的效果破壞的場合，這張卡在自己的魔法與陷阱區域蓋放 */
const resetByMST: EffectDef = {
  kind: 'trigger',
  event: 'destroyed',
  label: '被「旋風」的效果破壞：這張卡在自己的魔法與陷阱區域蓋放',
  categories: ['stat'],
  condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.reason === 'effect' && ctx.event.by?.id === MST && ctx.card.location === 'grave',
  operation: async (ctx) => {
    const d = ctx.duel;
    if (ctx.card.location !== 'grave' || d.freeSZones(ctx.player) <= 0) return;
    d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
    ctx.card.turnPlaced = d.turn;
  },
  ai: () => 85,
};
/** 「以下效果選擇 1 個發動（各 1 回合 1 次）」 */
function rtChoiceSpell(id: number, opts: { label: string; can: (ctx: EffectContext) => boolean; run: (ctx: EffectContext) => Promise<void> }[]) {
  def(id, {
    effects: [
      activate({
        categories: ['search', 'draw'],
        condition: (ctx) => opts.some((o, i) => !ctx.duel.p(ctx.player).turnFlags[`rt${id}_${i}`] && o.can(ctx)),
        cost: async (ctx) => {
          const d = ctx.duel;
          const f = d.p(ctx.player).turnFlags;
          const i = await d.chooseOption({ player: ctx.player, title: '選擇要發動的效果', options: opts.map((o, k) => ({ label: o.label, ai: !f[`rt${id}_${k}`] && o.can(ctx) ? 60 - k * 5 : -1 })) });
          const k = !f[`rt${id}_${i}`] && opts[i]?.can(ctx) ? i : opts.findIndex((o, j) => !f[`rt${id}_${j}`] && o.can(ctx));
          ctx.data.mode = k;
          f[`rt${id}_${k}`] = true;
        },
        operation: async (ctx) => {
          const o = opts[ctx.data.mode as number];
          if (o) await o.run(ctx);
        },
        ai: () => 75,
      }),
      resetByMST,
    ],
  });
}
const mstPool = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => c.id === MST);
const fetchMST = async (ctx: EffectContext) => {
  const d = ctx.duel;
  const c = mstPool(ctx)[0];
  if (!c) return;
  if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
  else d.returnToHand([c], 'effect', ctx.card);
};
// 絢嵐之見神
rtChoiceSpell(20508881, [
  {
    label: '自己抽 2 張，那之後把 1 張「絢嵐」卡或速攻魔法卡丟棄（沒有的場合手牌全部丟棄）',
    can: (ctx) => ctx.duel.p(ctx.player).deck.length >= 2,
    run: async (ctx) => {
      const d = ctx.duel;
      d.draw(ctx.player, 2);
      const hand = d.p(ctx.player).hand;
      const pool = hand.filter((c) => isRT(c.data) || (isSpell(c.data) && spellKind(c.data) === 'quickplay'));
      if (pool.length) {
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的卡', cards: pool, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'effect', ctx.card);
      } else d.discard([...hand], 'effect', ctx.card);
    },
  },
  { label: '從自己的牌組・墓地把 1 張「旋風」加入手牌', can: (ctx) => mstPool(ctx).length > 0, run: fetchMST },
]);
// 絢嵐之獻詠
rtChoiceSpell(67115133, [
  {
    label: '從牌組把 1 隻 4 星以下的「絢嵐」怪獸加入手牌',
    can: (ctx) => deckFilter(ctx, (x) => isMonster(x) && isRT(x) && x.level <= 4).length > 0,
    run: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({ player: ctx.player, title: '選擇「絢嵐」怪獸', cards: deckFilter(ctx, (x) => isMonster(x) && isRT(x) && x.level <= 4), hint: 'benefit' });
      if (c) d.addToHandFromDeck(c, ctx.card);
    },
  },
  { label: '從自己的牌組・墓地把 1 張「旋風」加入手牌', can: (ctx) => mstPool(ctx).length > 0, run: fetchMST },
]);
/** 絢嵐怪獸：①從手牌特殊召喚、②召喚・特殊召喚時檢索 */
function rtMonster(id: number, searchLabel: string, f: (d: CardData) => boolean) {
  def(id, {
    spSummon: {
      label: '自己墓地有「旋風」或對方場上沒有魔法・陷阱卡：從手牌特殊召喚',
      condition: (d, card) => rtSpOk(d, card.owner) && d.p(card.owner).usedNames[`rtSS${id}`] !== d.turn,
      cost: async (d, card) => {
        d.p(card.owner).usedNames[`rtSS${id}`] = d.turn;
      },
      ai: () => 80,
    },
    effects: [
      {
        kind: 'trigger',
        event: 'summoned',
        label: searchLabel,
        once: 'name',
        categories: ['search'],
        condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, f).length > 0,
        operation: async (ctx) => {
          const d = ctx.duel;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, f), hint: 'benefit' });
          if (c) d.addToHandFromDeck(c, ctx.card);
        },
        ai: () => 90,
      },
    ],
  });
}
rtMonster(54143349, '召喚・特殊召喚：從牌組把「絢嵐之達維」以外的「絢嵐」怪獸或「旋風」加入手牌', (x) => (isMonster(x) && isRT(x) && x.id !== 54143349) || x.id === MST);
rtMonster(80538047, '召喚・特殊召喚：從牌組把 1 張「絢嵐」魔法・陷阱卡或「旋風」加入手牌', (x) => ((isSpell(x) || isTrap(x)) && isRT(x)) || x.id === MST);

// 三戰之號
def(35269904, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => !!ctx.duel.p(ctx.opp).turnFlags.activatedMonsterEffect && thrustPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇通常魔法・通常陷阱卡', cards: thrustPool(ctx), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!c) return;
        const canHand = d.monsters(ctx.opp).length > 0;
        const i = canHand && d.freeSZones(ctx.player) > 0 ? await d.chooseOption({ player: ctx.player, title: `「${c.name}」要怎麼處理？`, options: [{ label: '在自己場上蓋放', ai: 40 }, { label: '加入手牌', ai: 60 }] }) : canHand ? 1 : 0;
        if (i === 1) d.addToHandFromDeck(c, ctx.card);
        else if (d.freeSZones(ctx.player) > 0) {
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
          d.shuffleDeck(ctx.player);
          c.turnPlaced = d.turn;
          d.setFlag(c, 'cannotActivate');
        }
      },
      ai: () => 80,
    }),
  ],
});
const thrustPool = (ctx: EffectContext) =>
  deckFilter(ctx, (x) => x.id !== 35269904 && ((isSpell(x) && spellKind(x) === 'normal') || (isTrap(x) && trapKind(x) === 'normal')));

// 次元障壁
const KINDS: [string, number][] = [
  ['儀式', 0x80],
  ['融合', 0x40],
  ['同步', 0x2000],
  ['超量', 0x800000],
  ['靈擺', 0x1000000],
];
def(83326048, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const count = (bit: number) => [...d.monsters(ctx.opp), ...d.p(ctx.opp).extra].filter((c) => c.data.type & bit).length;
        const i = await d.chooseOption({ player: ctx.player, title: '宣言 1 個怪獸的種類', options: KINDS.map(([n, b]) => ({ label: n, ai: count(b) * 10 })) });
        const [name, bit] = KINDS[i] ?? KINDS[0];
        d.log(`宣言「${name}」：這個回合雙方不能特殊召喚${name}怪獸，場上的${name}怪獸效果無效`);
        d.lingering.push({ turn: d.turn, negate: (c) => c.location === 'mzone' && (c.data.type & bit) !== 0 });
        for (const p of [0, 1] as PlayerId[]) d.addSummonLock(p, { kinds: ['special'], allow: (c) => (c.data.type & bit) === 0 });
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp ? 70 : ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) ? 40 : 0;
      },
    }),
  ],
});

// =====================================================================
// 雷盟
// =====================================================================
const isBlitz = (d: CardData) => d.nameEn.includes('Blitzclique') || d.name.includes('雷盟') || d.id === 37654623;
const isThunder = (c: Card) => isMonster(c.data) && (c.data.race & RACE.THUNDER) !== 0;
const COULOMB = 37654623;
const TOKEN = 37654624;
/** 這個回合，自己不是從手牌中不能把效果怪獸特殊召喚 */
const lockHandOnly = (d: Duel, p: PlayerId) => d.addSummonLock(p, { kinds: ['special'], allow: (c) => !isEffectMon(c.data) || c.location === 'hand' });
/** 自己的「雷盟」卡的效果把卡破壞的場合 */
const blitzDestroyed = (ctx: EffectContext, ev = ctx.event) =>
  !!ev && ev.type === 'destroyed' && ev.reason === 'effect' && !!ev.by && isBlitz(ev.by.data) && controllerOf(ev.by) === ctx.player;
const thunderHand = (ctx: EffectContext, except?: Card) => ctx.duel.p(ctx.player).hand.filter((c) => c !== except && isThunder(c) && canRevive(c));

/** 「把手牌的這張卡給對方觀看…那張卡破壞，從手牌把 1 隻雷族怪獸特殊召喚」 */
async function destroyThenSS(ctx: EffectContext) {
  const d = ctx.duel;
  const t = tgt(ctx);
  lockHandOnly(d, ctx.player);
  if (!t?.onField || !(await d.destroy([t], 'effect', ctx.card)).length) return;
  const pool = thunderHand(ctx).filter((c) => c.location === 'hand');
  if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
  const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的雷族怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
  if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
}
/** 「這張卡以外的卡被效果破壞的場合」 */
function onOtherDestroyed(label: string, f: (d: CardData) => boolean, toGrave = false): EffectDef {
  return {
    kind: 'trigger',
    event: 'destroyed',
    label,
    once: 'name',
    categories: ['search'],
    condition: (ctx) => ctx.card.isFaceUpMonster && ctx.event?.card !== ctx.card && ctx.event?.reason === 'effect' && deckFilter(ctx, f).length > 0,
    operation: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({ player: ctx.player, title: toGrave ? '選擇要送去墓地的卡' : '選擇要加入手牌的卡', cards: deckFilter(ctx, f), hint: 'benefit' });
      if (!c) return;
      if (toGrave) {
        d.sendToGrave([c], 'effect', ctx.card);
        d.shuffleDeck(ctx.player);
      } else d.addToHandFromDeck(c, ctx.card);
    },
    ai: () => 85,
  };
}

// 浪湧雷盟兵
def(22912101, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的這張卡給對方觀看：場上 1 隻怪獸破壞，從手牌把 1 隻雷族怪獸特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        d.log(`給對方觀看「${ctx.card.name}」`);
        await chooseTargets(ctx, d.monsters(), { title: '選擇要破壞的怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : c.data.id === TOKEN ? 50 : -5000) });
      },
      operation: destroyThenSS,
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 85 : 0),
    },
    onOtherDestroyed('這張卡以外的卡被效果破壞：從牌組把「浪湧雷盟兵」以外的「雷盟」怪獸加入手牌', (x) => isMonster(x) && isBlitz(x) && x.id !== 22912101),
  ],
});
// 晶粒雷盟兵
def(84401954, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的這張卡給對方觀看：場上 1 張魔法・陷阱卡破壞，從手牌把 1 隻雷族怪獸特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.duel.spellTraps().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        d.log(`給對方觀看「${ctx.card.name}」`);
        await chooseTargets(ctx, d.spellTraps(), { title: '選擇要破壞的魔法・陷阱卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : isBlitz(c.data) ? 100 : -5000) });
      },
      operation: destroyThenSS,
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length || ctx.duel.spellTraps(ctx.player).some((c) => isBlitz(c.data)) ? 85 : 0),
    },
    onOtherDestroyed('這張卡以外的卡被效果破壞：從牌組把「雷盟」魔法卡或「天空城塞 庫侖城寨」加入手牌', (x) => (isSpell(x) && isBlitz(x)) || x.id === COULOMB),
  ],
});
// 電磁干擾雷盟兵
def(11895663, {
  effects: [
    {
      kind: 'trigger',
      event: 'toHand',
      label: '用抽卡以外的方法加入手牌：把這張卡給對方觀看，場上 1 張卡破壞，從手牌把 1 隻雷族怪獸特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.reason !== 'draw' && ctx.card.location === 'hand' && ctx.duel.fieldCards().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(), { title: '選擇要破壞的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : isBlitz(c.data) ? 100 : -5000) });
      },
      operation: destroyThenSS,
      ai: () => 85,
    },
    onOtherDestroyed('這張卡以外的卡被效果破壞：從牌組把 1 張「雷盟」陷阱卡加入手牌', (x) => isTrap(x) && isBlitz(x)),
  ],
});
// 裂紋雷盟兵
def(58916810, {
  effects: [
    {
      kind: 'quick',
      label: '對方回合，對方把場上的怪獸的效果發動時，把手牌的這張卡給對方觀看：那隻怪獸破壞，從手牌把 1 隻雷族怪獸特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.duel.turnPlayer === ctx.opp && !!top && top.player === ctx.opp && isMonster(top.card.data) && !top.isCardActivation && top.card.location === 'mzone';
      },
      target: async (ctx) => {
        const top = ctx.duel.chainTop!;
        ctx.duel.log(`給對方觀看「${ctx.card.name}」`);
        ctx.duel.setTargets(ctx, [top.card]);
      },
      operation: destroyThenSS,
      ai: () => 85,
    },
    onOtherDestroyed('這張卡以外的卡被效果破壞：從牌組把 1 張「雷盟」魔法・陷阱卡送去墓地', (x) => (isSpell(x) || isTrap(x)) && isBlitz(x), true),
  ],
});
// 晶鬚雷盟兵
def(85523502, {
  effects: [
    {
      kind: 'quick',
      label: '自己的「雷盟」卡的效果把卡破壞的回合，把手牌的這張卡給對方觀看：從手牌把最多 3 隻雷族怪獸特殊召喚，可以把相同數量的場上的卡破壞',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'destroy'],
      condition: (ctx) => ctx.duel.effectDestroyers.some((x) => x.turn === ctx.duel.turn && x.player === ctx.player && isBlitz(x.data)) && ctx.duel.freeMZones(ctx.player) > 0 && thunderHand(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        lockHandOnly(d, ctx.player);
        const pool = thunderHand(ctx);
        const max = Math.min(3, pool.length, d.freeMZones(ctx.player));
        const sel = await d.select({ player: ctx.player, title: `選擇最多 ${max} 隻雷族怪獸`, cards: pool, min: 1, max, hint: 'benefit', aiValue: (x) => x.data.atk });
        let n = 0;
        for (const c of sel) if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) n++;
        if (!n || !d.fieldCards(ctx.opp).length || !(await d.confirm({ player: ctx.player, title: `要把最多 ${n} 張場上的卡破壞嗎？`, ai: true }))) return;
        const ds = await d.select({ player: ctx.player, title: `選擇最多 ${n} 張卡`, cards: d.fieldCards(), min: 1, max: n, hint: 'harm', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
        await d.destroy(ds, 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '手牌以外有怪獸的效果發動時，讓自己場上 1 隻其他的雷族怪獸回到手牌：那個發動無效並破壞',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          !!top &&
          !top.negated &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          top.activatedFrom !== 'hand' &&
          d.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isThunder(c))
        );
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的雷族怪獸', cards: d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && isThunder(c)), hint: 'cost' });
        if (c) d.returnToHand([c], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateLink(link);
        if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    },
  ],
});

/** 「這張卡在墓地存在的狀態，自己的「雷盟」卡的效果把卡破壞的場合，這張卡加入手牌」 */
const blitzRecover: EffectDef = {
  kind: 'trigger',
  event: 'destroyed',
  label: '自己的「雷盟」卡的效果把卡破壞：墓地的這張卡加入手牌',
  range: ['grave'],
  once: 'name',
  categories: ['toHand'],
  condition: (ctx) => ctx.card.location === 'grave' && ctx.event?.card !== ctx.card && blitzDestroyed(ctx),
  operation: async (ctx) => {
    if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
  },
  ai: () => 85,
};

// 天空城塞 庫侖城寨
def(COULOMB, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 90) }),
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      statMod: (_d, self, t) => (t.controller === self.controller && t.summonedFrom === 'hand' && t.summonType ? { atk: 500, def: 500 } : null),
    },
    {
      kind: 'ignition',
      label: '在對方場上把 1 隻「機獸衍生物」特殊召喚，從牌組把 1 隻「雷盟」怪獸加入手牌',
      range: ['fzone'],
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.freeMZones(ctx.opp) > 0 && deckFilter(ctx, (x) => isMonster(x) && isBlitz(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.opp) <= 0) return;
        const tok = new Card(getCard(TOKEN), ctx.opp);
        tok.location = 'void';
        d.specialSummon(tok, ctx.opp, { position: 'atk', by: ctx.card });
        const c = await d.selectOne({ player: ctx.player, title: '選擇「雷盟」怪獸', cards: deckFilter(ctx, (x) => isMonster(x) && isBlitz(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
    blitzRecover,
  ],
});

// 雷盟-可斷開式
def(64049762, {
  effects: [
    activate({
      once: 'name',
      categories: ['destroy', 'search'],
      condition: (ctx) => breakPlace(ctx) || breakDestroy(ctx),
      target: async (ctx) => {
        const d = ctx.duel;
        const i = breakPlace(ctx) && breakDestroy(ctx)
          ? await d.chooseOption({ player: ctx.player, title: '選擇要發動的效果', options: [{ label: '從牌組把「雷盟」永續陷阱卡在自己場上表側表示放置', ai: 50 }, { label: '讓自己場上 1 隻雷族怪獸回到手牌，場上 1 張卡破壞', ai: 60 }] })
          : breakPlace(ctx)
            ? 0
            : 1;
        ctx.data.mode = i;
        if (i === 1) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的雷族怪獸', cards: d.faceUpMonsters(ctx.player).filter(isThunder), hint: 'cost' });
          if (c) d.returnToHand([c], 'cost', ctx.card);
          await chooseTargets(ctx, d.fieldCards().filter((c) => c !== ctx.card), { title: '選擇要破壞的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 1) {
          const t = tgt(ctx);
          if (t?.onField) await d.destroy([t], 'effect', ctx.card);
          return;
        }
        const c = await d.selectOne({ player: ctx.player, title: '選擇「雷盟」永續陷阱卡', cards: deckFilter(ctx, (x) => isTrap(x) && trapKind(x) === 'continuous' && isBlitz(x)), hint: 'benefit' });
        if (c && d.freeSZones(ctx.player) > 0) {
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    }),
    blitzRecover,
  ],
});
const breakPlace = (ctx: EffectContext) => ctx.duel.freeSZones(ctx.player) > 0 && deckFilter(ctx, (x) => isTrap(x) && trapKind(x) === 'continuous' && isBlitz(x)).length > 0;
const breakDestroy = (ctx: EffectContext) => ctx.duel.faceUpMonsters(ctx.player).some(isThunder) && ctx.duel.fieldCards().some((c) => c !== ctx.card);

// 雷盟-交流發電機
def(59921227, {
  effects: [
    activate({ ai: () => 60 }),
    {
      kind: 'continuous',
      statMod: (d, self, t) => {
        if (t.controller === self.controller || t.location !== 'mzone') return null;
        const n = d.faceUpMonsters(self.controller).filter(isThunder).length;
        return n ? { atk: -300 * n, def: -300 * n } : null;
      },
    },
    {
      kind: 'ignition',
      label: '讓這張卡以外的 1 張「雷盟」卡回到牌組：從牌組把卡名不同的 1 隻雷族怪獸加入手牌',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && altCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到牌組的「雷盟」卡', cards: altCost(ctx), hint: 'cost' });
        if (!c) return;
        ctx.data.name = c.data.name;
        d.returnToDeck([c], false, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, (x) => isMonster(x) && (x.race & RACE.THUNDER) !== 0 && x.name !== ctx.data.name);
        const c = await d.selectOne({ player: ctx.player, title: '選擇雷族怪獸', cards: pool, hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 70,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從牌組把「雷盟」魔法卡或「天空城塞 庫侖城寨」加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => (isSpell(x) && isBlitz(x)) || x.id === COULOMB).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, (x) => (isSpell(x) && isBlitz(x)) || x.id === COULOMB), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 75,
    },
  ],
});
const altCost = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp)].filter(
    (c) => c !== ctx.card && isBlitz(c.data) && ctx.duel.p(ctx.player).deck.some((x) => isThunder(x) && x.data.name !== c.data.name),
  );

// 雷盟-梯級先導
def(433377, {
  effects: [
    activate({ ai: () => 70 }),
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '自己的「雷盟」卡的效果把卡破壞：墓地 1 隻雷族怪獸加入手牌',
      range: ['szone'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.faceUp && blitzDestroyed(ctx) && ctx.duel.p(ctx.player).grave.some(isThunder),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(isThunder), { title: '選擇雷族怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '從手牌把 1 隻雷族怪獸特殊召喚，那之後這張卡破壞',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.freeMZones(ctx.player) > 0 && thunderHand(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇雷族怪獸', cards: thunderHand(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (ctx.card.onField) await d.destroy([ctx.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    blitzRecover,
  ],
});

// 雷盟-回擊
def(23526128, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) => q === 'oppEffectIndestructible' && !!t && t.controller === self.controller && t.location === 'mzone' && isBlitz(t.data),
    },
    {
      kind: 'quick',
      label: '對方把魔法卡的效果發動時，讓自己場上 1 隻「雷盟」怪獸回到手牌：那個效果無效並破壞',
      range: ['szone'],
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.faceUp && !!top && top.player === ctx.opp && isSpell(top.card.data) && !top.ctx.data.effectNegated && ctx.duel.faceUpMonsters(ctx.player).some((c) => isBlitz(c.data));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的「雷盟」怪獸', cards: d.faceUpMonsters(ctx.player).filter((c) => isBlitz(c.data)), hint: 'cost' });
        if (c) d.returnToHand([c], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateEffect(link);
        if (link.ctx.data.effectNegated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：自己的場上・墓地 1 隻「雷盟」怪獸回到手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some((c) => isMonster(c.data) && isBlitz(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isMonster(c.data) && isBlitz(c.data)), { title: '選擇「雷盟」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && (t.onField || t.location === 'grave')) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 60,
    },
  ],
});

// 雷盟-過電壓
def(30945251, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.fieldCards().some((c) => c.faceUp && c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp && c !== ctx.card), { title: '選擇要破壞的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        lockHandOnly(ctx.duel, ctx.player);
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp) ? 80 : 0),
    }),
    blitzRecover,
  ],
});

// 雷王
def(71564252, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, _t, player) => q === 'noDeckToHand' && self.isFaceUpMonster && player !== null },
    {
      kind: 'quick',
      label: '對方要把怪獸特殊召喚之際，把這張卡解放：那次特殊召喚無效並破壞',
      event: 'summonAttempt',
      categories: ['negate'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.event?.player === ctx.opp && !['normal', 'tribute', 'flip'].includes(ctx.event?.summonType ?? ''),
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.event) ctx.event.negated = true;
      },
      ai: () => 80,
    },
  ],
});

// 強欲而金滿之壺
def(49238328, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.phase === 'main1' && !ctx.duel.p(ctx.player).turnFlags.mainActed && ctx.duel.p(ctx.player).extra.filter((c) => !c.faceUp).length >= 3,
      cost: async (ctx) => {
        const d = ctx.duel;
        const fd = d.p(ctx.player).extra.filter((c) => !c.faceUp);
        const n = fd.length >= 6 && fd.length >= 12 ? 6 : 3;
        const pick: Card[] = [];
        const pool = [...fd];
        for (let i = 0; i < n; i++) pick.push(...pool.splice(Math.floor(d.rng() * pool.length), 1));
        ctx.data.n = d.banish(pick, 'cost', ctx.card, true).length;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const k = Math.floor(((ctx.data.n as number) ?? 0) / 3);
        if (k) d.draw(ctx.player, k);
        d.p(ctx.player).turnFlags.noEffectDraw = true;
      },
      ai: () => 90,
    }),
  ],
});

void ({} as GameEvent);
void inMainPhase;
