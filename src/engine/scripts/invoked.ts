// 第三十四彈：召喚獸・阿萊斯特
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isMonster, isNamed, isSpell } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, PlayerId } from '../types';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt } from './lib';

const ALEISTER = 86120751;
const INVOCATION = 74063034;
const AIWASS = 84288367;
const VIRAKAM = 10673071;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const isFusion = (d: CardData) => isMonster(d) && (d.type & 0x40) !== 0;
const isAleister = (d: CardData) => isMonster(d) && (d.nameEn.includes('Aleister') || d.name.includes('阿萊斯特'));
const isAleisterName = (d: CardData) => isNamed(d, ALEISTER);
const isInvoked = (d: CardData) => isMonster(d) && (d.nameEn.includes('Invoked') || d.nameEn.includes('Hyperinvoked'));
/** 「召喚魔術」或有那個卡名記述的魔法卡 */
const invocationOrMention = (d: CardData) => isSpell(d) && (d.id === INVOCATION || d.desc.includes('「召喚魔術」'));
const hasAttr = (attr: number) => (d: CardData) => isMonster(d) && (d.attribute & attr) !== 0;

/** 召喚獸的融合素材：「阿萊斯特」怪獸（或「召喚師 阿萊斯特」）＋指定屬性 */
const aleisterMat = (strict: boolean) => (d: CardData, c?: Card) => (strict ? (c ? isNamed(c.data, ALEISTER) : isAleisterName(d)) : isAleister(d));

/**
 * 融合召喚（召喚魔術系）：base 為一般的素材，invokedExtra 為融合召喚「召喚獸」時也能使用的素材（除外）
 */
async function invokeFusion(
  ctx: EffectContext,
  base: Card[],
  invokedExtra: Card[],
  opts: { onlyInvoked?: boolean; extraToGrave?: boolean; banishAll?: boolean } = {},
): Promise<Card | null> {
  const d = ctx.duel;
  const cands = invokeTargets(ctx, base, invokedExtra, opts);
  if (!cands.length) return null;
  const f = await d.selectOne({ player: ctx.player, title: '選擇要融合召喚的融合怪獸', cards: cands, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
  if (!f) return null;
  const pool = isInvoked(f.data) ? [...base, ...invokedExtra] : base;
  const conds = getScript(f.id).fusion!;
  const ok = (sel: Card[]) => d.matchMaterials(conds, sel);
  let mats = await d.select({
    player: ctx.player,
    title: `選擇「${f.name}」的融合素材`,
    cards: pool.filter((c) => conds.some((cond) => d.fusionFits(cond, c)) || !!conds.more?.(c.data, c)),
    min: conds.length,
    max: conds.more ? pool.length : conds.length,
    hint: 'cost',
    aiValue: (c) => (c.controller !== ctx.player && c.onField ? 4000 : c.owner !== ctx.player ? 3000 : c.location === 'grave' ? 2000 : 0) - cardValue(d, c, ctx.player),
    validate: ok,
  });
  if (!ok(mats)) mats = d.findMaterialSet(conds, pool) ?? [];
  if (!mats.length) return null;
  const toGrave = opts.banishAll ? [] : mats.filter((m) => base.includes(m) && (m.location === 'hand' || (m.location === 'mzone' && !invokedExtra.includes(m))));
  const toBanish = mats.filter((m) => !toGrave.includes(m));
  d.moveFusionMaterials(mats, () => {
    d.sendToGrave(toGrave, 'material', ctx.card);
    if (opts.extraToGrave) for (const m of toBanish) d.moveTo(m, 'grave', { reason: 'material', by: ctx.card });
    else d.banish(toBanish, 'material', ctx.card);
  });
  for (const m of mats) m.fusionMaterial = true;
  d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
  f.summonMaterials = mats;
  if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) return null;
  return f;
}
function invokeTargets(ctx: EffectContext, base: Card[], invokedExtra: Card[], opts: { onlyInvoked?: boolean } = {}): Card[] {
  const d = ctx.duel;
  if (d.p(ctx.player).turnFlags.noSpecialSummon || d.playerHas(ctx.player, 'cannotSpecialSummon')) return [];
  return d.p(ctx.player).extra.filter((f) => {
    const conds = getScript(f.id).fusion;
    if (!conds || !isFusion(f.data) || !d.summonAllowed(ctx.player, f, 'special')) return false;
    if (opts.onlyInvoked && !isInvoked(f.data)) return false;
    const pool = isInvoked(f.data) ? [...base, ...invokedExtra] : base;
    if (d.freeMZones(ctx.player) <= 0 && !pool.some((c) => c.location === 'mzone' && c.controller === ctx.player)) return false;
    return d.findMaterialSet(conds, pool) !== null;
  });
}
const handMons = (ctx: EffectContext) => ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data));
const graveMons = (d: Duel) => [...d.p(0).grave, ...d.p(1).grave].filter((c) => isMonster(c.data));

// =====================================================================
// 召喚魔術
// =====================================================================
const invocationArgs = (ctx: EffectContext): [Card[], Card[]] => [
  handMons(ctx),
  [...ctx.duel.monsters(ctx.player).filter((c) => c.faceUp), ...graveMons(ctx.duel)],
];
def(INVOCATION, {
  effects: [
    activate({
      categories: ['fusion', 'summon'],
      condition: (ctx) => invokeTargets(ctx, ...invocationArgs(ctx)).length > 0,
      operation: async (ctx) => {
        await invokeFusion(ctx, ...invocationArgs(ctx));
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '以除外狀態的「召喚師 阿萊斯特」為對象：這張卡回到牌組，那隻怪獸加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).banished.some((c) => c.faceUp && c.id === ALEISTER),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp && c.id === ALEISTER), { title: '選擇「召喚師 阿萊斯特」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (ctx.card.location !== 'grave' || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        if (t?.location === 'banished') d.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 召喚魔術-「劍」
const swordArgs = (ctx: EffectContext): [Card[], Card[]] => [
  ctx.duel.monsters(ctx.player).filter((c) => c.faceUp),
  [...ctx.duel.p(0).banished, ...ctx.duel.p(1).banished].filter((c) => c.faceUp && isMonster(c.data)),
];
def(37432075, {
  effects: [
    activate({
      once: 'name',
      categories: ['fusion', 'summon'],
      condition: (ctx) => invokeTargets(ctx, ...swordArgs(ctx)).length > 0,
      operation: async (ctx) => {
        await invokeFusion(ctx, ...swordArgs(ctx), { extraToGrave: true });
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '以墓地 1 隻「阿萊斯特」怪獸或 1 張「召喚魔術」為對象：這張卡回到牌組，對象加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && (isAleister(c.data) || c.id === INVOCATION)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && (isAleister(c.data) || c.id === INVOCATION)), { title: '選擇要加入手牌的卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (ctx.card.location !== 'grave' || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        if (t?.location === 'grave') d.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 75,
    },
  ],
});

// 暴走魔法陣
def(47679935, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, (x) => x.id === ALEISTER);
        if (pool.length && (await d.confirm({ player: ctx.player, title: '要從牌組把「召喚師 阿萊斯特」加入手牌嗎？', ai: true }))) d.addToHandFromDeck(pool[0], ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 90),
    }),
    { kind: 'continuous', activeIn: ['fzone'], query: (_d, self, q, _t, player) => q === 'fusionUnnegatable' && player === self.controller },
  ],
});

// 神靈劍 艾華斯
def(63926180, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'banish'],
      condition: (ctx) => swordOpts(ctx).some((x) => x),
      operation: async (ctx) => {
        const d = ctx.duel;
        const [a, b, c] = swordOpts(ctx);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '從自己的牌組・墓地把 1 隻「法之神靈 艾華斯」特殊召喚', ai: a ? 70 : -1 },
            { label: '從牌組選 1 隻「阿萊斯特」怪獸送去墓地或除外', ai: b ? 50 : -1 },
            { label: '把對方的額外牌組的裡側的卡隨機 3 張確認，選 1 張除外', ai: c ? 40 : -1 },
          ],
        });
        const p = ctx.player;
        d.p(p).turnFlags.onlyFusionAttack = true;
        if (i === 0 && a) {
          const t = [...d.p(p).deck, ...d.p(p).grave].find((x) => x.id === AIWASS && canRevive(x));
          if (t) {
            const fromDeck = t.location === 'deck';
            d.specialSummon(t, p, { position: 'atk', by: ctx.card });
            if (fromDeck) d.shuffleDeck(p);
          }
        } else if (i === 1 && b) {
          const t = await d.selectOne({ player: p, title: '選擇「阿萊斯特」怪獸', cards: deckFilter(ctx, isAleister), hint: 'benefit' });
          if (!t) return;
          const j = await d.chooseOption({ player: p, title: `「${t.name}」要怎麼處理？`, options: [{ label: '送去墓地', ai: 50 }, { label: '除外', ai: 40 }] });
          if (j === 0) d.sendToGrave([t], 'effect', ctx.card);
          else d.banish([t], 'effect', ctx.card);
          d.shuffleDeck(p);
        } else if (c) {
          const fd = d.p(ctx.opp).extra.filter((x) => !x.faceUp);
          const pick: Card[] = [];
          const pool = [...fd];
          for (let k = 0; k < 3 && pool.length; k++) pick.push(...pool.splice(Math.floor(d.rng() * pool.length), 1));
          d.log(`確認 ${pick.map((x) => `「${x.name}」`).join('、')}`);
          const t = await d.selectOne({ player: p, title: '選擇要除外的卡', cards: pick, hint: 'harm', aiValue: (x) => x.data.atk });
          if (t) d.banish([t], 'effect', ctx.card);
        }
      },
      ai: () => 75,
    }),
  ],
});
const swordOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [
    d.freeMZones(ctx.player) > 0 && [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].some((x) => x.id === AIWASS && canRevive(x)),
    deckFilter(ctx, isAleister).length > 0,
    d.p(ctx.opp).extra.some((x) => !x.faceUp),
  ];
};

// =====================================================================
// 阿萊斯特
// =====================================================================

// 召喚師 阿萊斯特
def(ALEISTER, {
  effects: [
    {
      kind: 'quick',
      label: '把這張卡從手牌送去墓地：自己場上 1 隻融合怪獸的攻擊力・守備力上升 1000',
      range: ['hand'],
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isFusion(c.data)),
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isFusion(c.data)), { title: '選擇融合怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: 1000, def: 1000, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.battle && (ctx.duel.battle.attacker.controller === ctx.player || ctx.duel.battle.target?.controller === ctx.player) ? 70 : 0),
    },
    {
      kind: 'trigger',
      event: ['summoned', 'flipped'],
      label: '召喚・反轉：從牌組把 1 張「召喚魔術」加入手牌',
      categories: ['search'],
      condition: (ctx) => (ctx.event?.type === 'flipped' ? ctx.event.card === ctx.card : summonedSelf(ctx, ['normal', 'tribute'])) && deckFilter(ctx, (x) => x.id === INVOCATION).length > 0,
      operation: async (ctx) => {
        const c = deckFilter(ctx, (x) => x.id === INVOCATION)[0];
        if (c) ctx.duel.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 追憶的阿萊斯特
def(57294268, {
  effects: [
    {
      kind: 'ignition',
      label: '以場上 1 隻魔法師族或融合怪獸為對象：這張卡從手牌特殊召喚，那隻怪獸的攻擊力上升 1000',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'stat'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.faceUpMonsters().some((c) => (c.data.race & RACE.SPELLCASTER) !== 0 || isFusion(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => (c.data.race & RACE.SPELLCASTER) !== 0 || isFusion(c.data)), { title: '選擇怪獸', hint: 'benefit', aiValue: (c) => (c.controller === ctx.player ? 100 : -100) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { atk: 1000, until: 'endTurn' }, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: ['summoned', 'flipped'],
      label: '召喚・特殊召喚・反轉，從額外牌組把 1 隻「召喚獸」怪獸除外：從牌組把「召喚魔術」或有那卡名記述的魔法卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        (ctx.event?.type === 'flipped' ? ctx.event.card === ctx.card : summonedSelf(ctx)) &&
        ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp && isInvoked(c.data)) &&
        deckFilter(ctx, invocationOrMention).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的「召喚獸」怪獸', cards: d.p(ctx.player).extra.filter((c) => !c.faceUp && isInvoked(c.data)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇魔法卡', cards: deckFilter(ctx, invocationOrMention), hint: 'benefit', aiValue: (x) => (x.id === INVOCATION ? 100 : 50) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 暴走召喚師 阿萊斯特
def(97973962, {
  link: { min: 2, max: 2, validate: (set) => set.length === 2 && set[0].data.race !== set[1].data.race && set[0].data.attribute !== set[1].data.attribute },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '融合怪獸融合召喚：丟棄 1 張手牌，從牌組把「召喚魔術」或「法之聖典」加入手牌',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.event?.summonType === 'fusion' && ctx.duel.p(ctx.player).hand.length > 0 && deckFilter(ctx, (x) => x.id === INVOCATION || x.name.includes('法之聖典')).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const h = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (!h) return;
        d.discard([h], 'effect', ctx.card);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, (x) => x.id === INVOCATION || x.name.includes('法之聖典')), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 75,
    },
  ],
});

// 法之神靈 艾華斯
def(AIWASS, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌・場上的這張卡除外：從牌組把 1 隻「阿萊斯特」怪獸加入手牌（場上發動的場合可以再召喚 1 隻魔法師族怪獸）',
      range: ['hand', 'mzone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => (ctx.card.location === 'hand' || ctx.card.isFaceUpMonster) && deckFilter(ctx, isAleister).length > 0,
      cost: async (ctx) => {
        ctx.data.fromField = ctx.card.onField;
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「阿萊斯特」怪獸', cards: deckFilter(ctx, isAleister), hint: 'benefit', aiValue: (x) => (x.id === ALEISTER ? 100 : 60) });
        if (c) d.addToHandFromDeck(c, ctx.card);
        if (!ctx.data.fromField) return;
        const pool = d.p(ctx.player).hand.filter((x) => isMonster(x.data) && (x.data.race & RACE.SPELLCASTER) !== 0 && d.summonAllowed(ctx.player, x, 'normal'));
        if (pool.length && (await d.confirm({ player: ctx.player, title: '要再召喚 1 隻魔法師族怪獸嗎？', ai: true }))) {
          const m = await d.selectOne({ player: ctx.player, title: '選擇魔法師族怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === ALEISTER ? 100 : 0) });
          if (m) await d.normalSummonByEffect(ctx.player, m);
        }
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '自己場上的表側表示的融合怪獸被戰鬥以外送去墓地：這張卡特殊召喚，那之後可以融合召喚「召喚獸」怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => {
        const ev = ctx.event;
        return ctx.card.location === 'grave' && !!ev?.card && ev.card !== ctx.card && ev.from === 'mzone' && ev.wasFaceUp !== false && ev.reason !== 'battle' && isFusion(ev.card.data) && (ev.prevController ?? ev.card.owner) === ctx.player && ctx.duel.freeMZones(ctx.player) > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const base = [...d.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...d.faceUpMonsters(ctx.player)];
        const opts = { onlyInvoked: true, extraToGrave: true };
        if (invokeTargets(ctx, base, [], opts).length && (await d.confirm({ player: ctx.player, title: '要融合召喚「召喚獸」怪獸嗎？', ai: true }))) await invokeFusion(ctx, base, [], opts);
      },
      ai: () => 85,
    },
  ],
});

// 人工神靈 維拉卡姆
def(VIRAKAM, {
  effects: [
    {
      kind: 'ignition',
      label: '自己的場上或墓地有「阿萊斯特」怪獸：這張卡從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some((c) => isAleister(c.data)),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從牌組把「召喚魔術」或有那卡名記述的魔法卡在自己場上蓋放',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && ctx.card.summonType !== 'normal' && ctx.duel.freeSZones(ctx.player) > 0 && deckFilter(ctx, invocationOrMention).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要蓋放的魔法卡', cards: deckFilter(ctx, invocationOrMention), hint: 'benefit', aiValue: (x) => (x.id === INVOCATION ? 100 : 50) });
        if (!c || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        c.turnPlaced = d.turn;
        d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '對方連鎖自己的融合怪獸的效果的發動把卡的效果發動時：場上的這張卡除外，那個對方的效果無效並除外',
      once: 'name',
      categories: ['negate', 'banish'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || d.chain.length < 2) return false;
        const top = d.chain[d.chain.length - 1];
        const prev = d.chain[d.chain.length - 2];
        return top.player === ctx.opp && prev.player === ctx.player && isFusion(prev.card.data) && !prev.isCardActivation && !top.ctx.data.effectNegated;
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateEffect(link);
        if (link.ctx.data.effectNegated && (link.card.onField || link.card.location === 'grave' || link.card.location === 'hand')) d.banish([link.card], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// =====================================================================
// 召喚獸
// =====================================================================

// 召喚獸 索拉特
def(43989315, {
  fusion: [aleisterMat(false), hasAttr(ATTR.FIRE | ATTR.WIND)],
  effects: [
    {
      kind: 'quick',
      label: '以雙方墓地 1 隻 6 星以下的怪獸為對象：那隻怪獸在自己場上守備表示特殊召喚（效果無效）',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.duel.freeMZones(ctx.player) > 0 && sorathTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, sorathTargets(ctx), { title: '選擇 6 星以下的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk + (isAleister(c.data) ? 2000 : 0) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location === 'grave' && d.freeMZones(ctx.player) > 0) d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card, negateEffects: true });
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '把包含墓地的這張卡的自己的場上・墓地的怪獸作為融合素材除外，把「召喚獸」融合怪獸融合召喚',
      range: ['grave'],
      once: 'name',
      categories: ['fusion', 'summon'],
      condition: (ctx) => sorathFusionTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const base: Card[] = [];
        const extra = [ctx.card, ...d.faceUpMonsters(ctx.player), ...d.p(ctx.player).grave.filter((c) => c !== ctx.card && isMonster(c.data))];
        const cands = sorathFusionTargets(ctx);
        if (!cands.length) return;
        await invokeFusion(ctx, base, extra, { onlyInvoked: true });
      },
      ai: () => 75,
    },
  ],
});
const sorathTargets = (ctx: EffectContext) => graveMons(ctx.duel).filter((c) => c.data.level <= 6 && c.data.level > 0 && canRevive(c));
const sorathFusionTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const extra = [ctx.card, ...d.faceUpMonsters(ctx.player), ...d.p(ctx.player).grave.filter((c) => c !== ctx.card && isMonster(c.data))];
  return invokeTargets(ctx, [], extra, { onlyInvoked: true }).filter((f) => {
    const conds = getScript(f.id).fusion!;
    const set = d.findMaterialSet(conds, extra);
    return !!set && (set.includes(ctx.card) || conds.some((cond) => cond(ctx.card.data, ctx.card, d)));
  });
};

// 召喚獸 巴巴倫
def(70383419, {
  fusion: [aleisterMat(false), hasAttr(ATTR.LIGHT | ATTR.EARTH)],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從牌組把「人工神靈 維拉卡姆」加入手牌，那之後可以從雙方墓地把 1 隻怪獸除外',
      once: 'name',
      categories: ['search', 'banish'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => x.id === VIRAKAM || x.name.includes('新世界之始')).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, (x) => x.id === VIRAKAM || x.name.includes('新世界之始')), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
        const g = graveMons(d);
        if (g.length && (await d.confirm({ player: ctx.player, title: '要從墓地把 1 隻怪獸除外嗎？', ai: d.p(ctx.opp).grave.some((x) => isMonster(x.data)) }))) {
          const x = await d.selectOne({ player: ctx.player, title: '選擇要除外的怪獸', cards: g, hint: 'harm', aiValue: (y) => (y.owner === ctx.opp ? cardValue(d, y, ctx.player) : -1000) });
          if (x) d.banish([x], 'effect', ctx.card);
        }
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡，以自己場上 1 隻融合怪獸為對象：對方場上的全部怪獸的攻擊力下降那隻怪獸的攻擊力數值',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isFusion(c.data)) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isFusion(c.data)), { title: '選擇融合怪獸', hint: 'benefit', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const v = d.getAtk(t);
        for (const c of d.faceUpMonsters(ctx.opp)) d.addMod(c, { atk: -v, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 60 : 0),
    },
  ],
});

// 召喚獸 俄刻阿諾斯
def(6772168, {
  fusion: [aleisterMat(false), hasAttr(ATTR.DARK | ATTR.WATER)],
  effects: [
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'cannotBeAttackTarget' && self.location === 'mzone' && self.zone < 5 && !!t && t !== self && t.controller === self.controller && t.location === 'mzone',
    },
    { kind: 'continuous', query: (_d, self, q, _t, player) => q === 'monsterGraveBanish' && self.location === 'mzone' && self.zone >= 5 && player !== null && player !== self.controller },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡，以自己場上 1 隻融合怪獸為對象：這個回合那隻怪獸可以直接攻擊',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isFusion(c.data)) && ctx.duel.phase === 'main1',
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isFusion(c.data)), { title: '選擇融合怪獸', hint: 'benefit', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.setFlag(t, 'directAttack');
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 60 : 0),
    },
  ],
});

// 召喚獸 雷電
def(49513164, {
  fusion: [aleisterMat(true), hasAttr(ATTR.WIND)],
  effects: [
    {
      kind: 'quick',
      label: '以場上 1 隻表側表示怪獸為對象：那隻怪獸變成裡側守備表示',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.faceUpMonsters(ctx.opp).some((c) => (c.data.type & 0x4000000) === 0),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => (c.data.type & 0x4000000) === 0), { title: '選擇怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        t.faceUp = false;
        t.position = 'def';
        d.log(`「${t.name}」變成裡側守備表示`);
        d.update();
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.chain.length ? 80 : 40),
    },
  ],
});

// 召喚獸 埃律西昂
def(11270236, {
  fusion: [(d) => isInvoked(d), (d, c) => !!c && c.summonedFrom === 'extra' && c.location === 'mzone'],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'continuous',
      onEvent: (d, self, ev) => {
        if (ev.type === 'summoned' && ev.card === self && self.isFaceUpMonster && !self.baseData)
          d.overrideData(self, { attribute: self.data.attribute | ATTR.DARK | ATTR.EARTH | ATTR.WATER | ATTR.FIRE | ATTR.WIND });
      },
    },
    {
      kind: 'quick',
      label: '以自己的場上・墓地 1 隻「召喚獸」怪獸為對象：那隻怪獸以及持有相同屬性的對方場上的怪獸全部除外',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some((c) => isInvoked(c.data)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, [...d.faceUpMonsters(ctx.player), ...d.p(ctx.player).grave].filter((c) => isInvoked(c.data)), {
          title: '選擇「召喚獸」怪獸',
          hint: 'cost',
          aiValue: (c) => d.faceUpMonsters(ctx.opp).filter((o) => (o.data.attribute & c.data.attribute) !== 0).length * 1000 - (c.onField ? cardValue(d, c, ctx.player) : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || (!t.onField && t.location !== 'grave')) return;
        const attr = t.data.attribute;
        const foes = d.faceUpMonsters(ctx.opp).filter((c) => (c.data.attribute & attr) !== 0);
        d.banish([t, ...foes], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).length ? 80 : 0),
    },
  ],
});

// 召喚獸 光體
def(97300502, {
  fusion: [aleisterMat(true), (d) => isFusion(d)],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '這張卡特殊召喚成功或對方場上有怪獸特殊召喚：對方場上 1 隻怪獸破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ctx.card.isFaceUpMonster || !ev || ['normal', 'tribute', 'flip'].includes(ev.summonType ?? '')) return false;
        const self = (ev.cards ?? []).includes(ctx.card);
        const opp = (ev.cards ?? []).some((c) => c.controller === ctx.opp);
        return (self || opp) && ctx.duel.monsters(ctx.opp).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(ctx.opp), { title: '選擇要破壞的怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'ignition',
      label: '從自己墓地把 1 隻融合怪獸除外：這張卡的攻擊力直到對方回合結束時上升除外的怪獸的攻擊力',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).grave.some((c) => isFusion(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的融合怪獸', cards: d.p(ctx.player).grave.filter((c) => isFusion(c.data)), hint: 'cost', aiValue: (x) => x.data.atk });
        if (!c) return;
        ctx.data.atk = Math.max(0, c.data.atk);
        d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: (ctx.data.atk as number) ?? 0, until: 'endOppTurn', turn: ctx.duel.turn }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.opp).length ? 60 : 0),
    },
  ],
});

// 召喚獸 梅爾卡巴
const kindOf = (d: CardData) => (isMonster(d) ? 'm' : isSpell(d) ? 's' : 't');
def(75286621, {
  fusion: [aleisterMat(true), hasAttr(ATTR.LIGHT)],
  effects: [
    {
      kind: 'quick',
      label: '怪獸的效果・魔法・陷阱卡發動時，把相同種類的 1 張卡從手牌送去墓地：那個發動無效並除外',
      once: 'turn',
      categories: ['negate', 'banish'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        if (!ctx.card.isFaceUpMonster || !top || top.negated || top.card === ctx.card) return false;
        if (isMonster(top.card.data) === top.isCardActivation) return false;
        return ctx.duel.p(ctx.player).hand.some((c) => kindOf(c.data) === kindOf(top.card.data));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop!;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的卡', cards: d.p(ctx.player).hand.filter((c) => kindOf(c.data) === kindOf(top.card.data)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
        ctx.data.link = top;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateLink(link);
        if (link.negated && (link.card.onField || link.card.location === 'grave' || link.card.location === 'hand')) d.banish([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 90 : 0),
    },
  ],
});

// 召喚獸 卡利古拉
def(13529466, {
  fusion: [aleisterMat(true), hasAttr(ATTR.DARK)],
  effects: [
    { kind: 'continuous', query: (_d, self, q, _t, player) => (q === 'oneMonsterEffectPerTurn' || q === 'oneAttackerPerBattle') && self.isFaceUpMonster && player !== null },
  ],
});

// 超越召喚獸 紀元
def(33166263, {
  fusion: Object.assign([(d: CardData) => isFusion(d), (d: CardData) => isFusion(d)], {
    more: (d: CardData) => isFusion(d),
    validate: (mats: Card[]) => new Set(mats.map((m) => m.data.attribute)).size === mats.length,
  }),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '融合召喚：把最多有素材數量的雙方的場上・墓地的卡除外（3 隻以上為素材的場合，再把對方的額外牌組最多 3 張除外）',
      once: 'nameShared',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']),
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = (ctx.card.summonMaterials ?? []).length || 2;
        const pool = [...d.fieldCards().filter((c) => c !== ctx.card), ...d.p(0).grave, ...d.p(1).grave];
        if (pool.length) {
          const sel = await d.select({ player: ctx.player, title: `選擇最多 ${n} 張要除外的卡`, cards: pool, min: 1, max: n, hint: 'harm', aiValue: (c) => (controllerOf(c) === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
          d.banish(sel, 'effect', ctx.card);
        }
        if (n >= 3 && d.p(ctx.opp).extra.length) {
          d.log(`確認對方的額外牌組：${d.p(ctx.opp).extra.map((c) => `「${c.name}」`).join('、')}`);
          const sel = await d.select({ player: ctx.player, title: '選擇最多 3 張要除外的卡', cards: d.p(ctx.opp).extra, min: 1, max: Math.min(3, d.p(ctx.opp).extra.length), hint: 'harm', aiValue: (c) => c.data.atk });
          d.banish(sel, 'effect', ctx.card);
        }
      },
      ai: () => 95,
    },
    {
      kind: 'quick',
      label: '宣言 1 個屬性：這張卡以外的場上的全部怪獸直到回合結束時變成宣言的屬性',
      once: 'nameShared',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.faceUpMonsters().some((c) => c !== ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        const list: [number, string][] = [
          [ATTR.LIGHT, '光'],
          [ATTR.DARK, '暗'],
          [ATTR.EARTH, '地'],
          [ATTR.WATER, '水'],
          [ATTR.FIRE, '炎'],
          [ATTR.WIND, '風'],
        ];
        const i = await d.chooseOption({ player: ctx.player, title: '宣言 1 個屬性', options: list.map(([, n]) => ({ label: n, ai: 10 })) });
        const [a] = list[i] ?? list[0];
        for (const c of d.faceUpMonsters().filter((c) => c !== ctx.card)) d.overrideData(c, { attribute: a }, d.turn);
      },
      ai: () => 0,
    },
  ],
});

void controllerOf;
void (null as unknown as PlayerId);

// =====================================================================
// 沼地的魔道王・權柄交絡者 米克修希亞
// =====================================================================
const ATTRS6: [number, string][] = [
  [ATTR.LIGHT, '光'],
  [ATTR.DARK, '暗'],
  [ATTR.EARTH, '地'],
  [ATTR.WATER, '水'],
  [ATTR.FIRE, '炎'],
  [ATTR.WIND, '風'],
];
async function declareAttr(d: Duel, p: PlayerId): Promise<number> {
  const i = await d.chooseOption({ player: p, title: '宣言 1 個屬性', options: ATTRS6.map(([, n]) => ({ label: n, ai: 10 })) });
  return (ATTRS6[i] ?? ATTRS6[0])[0];
}
/** 額外牌組的融合怪獸有卡名記述的融合素材怪獸（牌組） */
const swampPairs = (ctx: EffectContext): [Card, Card][] => {
  const d = ctx.duel;
  const out: [Card, Card][] = [];
  for (const f of d.p(ctx.player).extra.filter((c) => isFusion(c.data))) {
    const first = f.data.desc.split('\n')[0];
    for (const m of d.p(ctx.player).deck.filter((c) => isMonster(c.data) && first.includes(`「${c.data.name}」`))) out.push([f, m]);
  }
  return out;
};
def(45223540, {
  effects: [
    {
      kind: 'ignition',
      label: '把額外牌組 1 隻融合怪獸給對方觀看，從牌組把有卡名記述的 1 隻融合素材怪獸除外，這張卡特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && swampPairs(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pairs = swampPairs(ctx);
        const f = await d.selectOne({ player: ctx.player, title: '選擇要給對方觀看的融合怪獸', cards: [...new Set(pairs.map(([x]) => x))], hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!f) return;
        d.log(`給對方觀看「${f.name}」`);
        const m = await d.selectOne({ player: ctx.player, title: '選擇要除外的融合素材怪獸', cards: pairs.filter(([x]) => x === f).map(([, y]) => y), hint: 'cost' });
        if (!m || !d.banish([m], 'effect', ctx.card).length) return;
        d.shuffleDeck(ctx.player);
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        ctx.card.flags.fusionAsId = m.id;
        ctx.card.flags.fusionAsTurn = d.turn;
      },
      ai: () => 85,
    },
  ],
});
def(80843006, {
  fusion: [(d) => isMonster(d) && (d.race & RACE.SPELLCASTER) !== 0, (d) => isMonster(d) && (d.race & RACE.SPELLCASTER) === 0],
  effects: [
    {
      kind: 'ignition',
      label: '以場上 1 隻表側表示怪獸為對象，宣言 1 個屬性：那隻怪獸變成那個屬性',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), { title: '選擇怪獸', hint: 'benefit' });
        ctx.data.attr = await declareAttr(ctx.duel, ctx.player);
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.overrideData(t, { attribute: ctx.data.attr as number });
      },
      ai: () => 0,
    },
    {
      kind: 'quick',
      label: '對方主要階段：把包含這張卡的自己場上・墓地的怪獸除外作為融合素材，把 1 隻融合怪獸融合召喚',
      once: 'name',
      categories: ['fusion', 'summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) && mixFusions(ctx).length > 0,
      operation: async (ctx) => {
        await invokeFusion(ctx, mixPool(ctx), [], { banishAll: true });
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '宣言 1 個屬性：墓地的這張卡直到回合結束時變成那個屬性',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      operation: async (ctx) => {
        const a = await declareAttr(ctx.duel, ctx.player);
        if (ctx.card.location === 'grave') ctx.duel.overrideData(ctx.card, { attribute: a }, ctx.duel.turn);
      },
      ai: () => 0,
    },
  ],
});
const mixPool = (ctx: EffectContext) => [ctx.card, ...ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card), ...ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data))];
const mixFusions = (ctx: EffectContext) =>
  invokeTargets(ctx, mixPool(ctx), []).filter((f) => {
    const set = ctx.duel.findMaterialSet(getScript(f.id).fusion!, mixPool(ctx));
    return !!set && set.includes(ctx.card);
  });
