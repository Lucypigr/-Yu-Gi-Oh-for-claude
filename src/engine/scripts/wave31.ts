// 第三十一彈：環境常用的泛用卡
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isLink, isMonster, isPendulum, isRitual, isSpell, isToken, isTrap, isTuner, isXyz } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, PlayerId } from '../types';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const isEffectMon = (d: CardData) => isMonster(d) && (d.type & 0x20) !== 0;
const isFusion = (d: CardData) => isMonster(d) && (d.type & 0x40) !== 0;
const ATTR_LIST: [number, string][] = [
  [ATTR.LIGHT, '光'],
  [ATTR.DARK, '暗'],
  [ATTR.EARTH, '地'],
  [ATTR.WATER, '水'],
  [ATTR.FIRE, '炎'],
  [ATTR.WIND, '風'],
];
/** 把卡作為超量素材 */
function attach(d: Duel, xyz: Card, cards: Card[]) {
  for (const c of cards) {
    if (d.moveTo(c, 'overlay', { reason: 'effect', by: xyz })) xyz.overlays.push(c);
  }
}
/** 選場上 1 張卡破壞（對方的卡優先） */
async function destroyOne(ctx: EffectContext, title = '選擇要破壞的卡') {
  const d = ctx.duel;
  const pool = d.fieldCards().filter((c) => c !== ctx.card);
  if (!pool.length) return;
  const c = await d.selectOne({ player: ctx.player, title, cards: pool, hint: 'harm', aiValue: (x) => (x.controller !== ctx.player ? cardValue(d, x, ctx.player) : -5000) });
  if (c) await d.destroy([c], 'effect', ctx.card);
}

// 超雷龍-雷龍
const colossusCost = (d: Duel, p: PlayerId) => d.faceUpMonsters(p).filter((c) => (c.data.race & RACE.THUNDER) !== 0 && isEffectMon(c.data) && !isFusion(c.data));
def(15291624, {
  fusion: [(d) => d.id === 31786629, (d) => isMonster(d) && (d.race & RACE.THUNDER) !== 0],
  spSummonOnly: ['fusion', 'special'],
  spSummon: {
    label: '雷族怪獸的效果在手牌發動的回合，把自己場上 1 隻雷族效果怪獸解放，從額外牌組特殊召喚',
    condition: (d, card) => !!d.p(card.owner).turnFlags.thunderHandEffect && colossusCost(d, card.owner).some((c) => d.extraZones(card.owner, card, [c]).length > 0),
    cost: async (d, card) => {
      const c = await d.selectOne({ player: card.owner, title: '選擇要解放的雷族效果怪獸', cards: colossusCost(d, card.owner), hint: 'cost' });
      if (c) d.sendToGrave([c], 'tribute', card);
    },
    ai: () => 85,
  },
  destroySubstitute: undefined,
  selfSubstitute: (d, self, reason) => {
    if (reason !== 'battle' && reason !== 'effect') return null;
    const pool = d.p(self.controller).grave.filter((c) => isMonster(c.data) && (c.data.race & RACE.THUNDER) !== 0);
    if (!pool.length) return null;
    return [{ label: '把墓地 1 隻雷族怪獸除外代替破壞', apply: () => void d.banish([pool[0]], 'effect', self) }];
  },
  effects: [{ kind: 'continuous', query: (_d, self, q, _t, player) => q === 'noDeckToHand' && player !== null && player !== self.controller }],
});

// 篝火
def(85106525, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isMonster(x) && x.level <= 4 && (x.race & RACE.PYRO) !== 0).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇 4 星以下的炎族怪獸', cards: deckFilter(ctx, (x) => isMonster(x) && x.level <= 4 && (x.race & RACE.PYRO) !== 0), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    }),
  ],
});

// 封印之黃金櫃
def(75500286, {
  effects: [
    activate({
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的卡', cards: d.p(ctx.player).deck, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) + (/除外的場合/.test(x.data.desc) ? 1000 : 0) });
        if (!c || !d.banish([c], 'effect', ctx.card).length) return;
        d.shuffleDeck(ctx.player);
        const p = ctx.player;
        const stint = c.stint;
        let count = 0;
        d.listeners.push((ev) => {
          if (ev.type !== 'standby' || ev.player !== p) return false;
          count++;
          if (count < 2) return false;
          if (c.location === 'banished' && c.stint === stint) d.returnToHand([c], 'effect');
          return true;
        });
      },
      ai: () => 70,
    }),
  ],
});

// 沼地的泥龍王
def(54757758, {
  fusion: Object.assign([(d: CardData) => isMonster(d), (d: CardData) => isMonster(d)], {
    validate: (mats: Card[]) => mats.length === 2 && mats[0].data.attribute === mats[1].data.attribute && mats[0].data.race !== mats[1].data.race,
  }),
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'untargetableByOpp' && !!t && t.location === 'mzone' && t.faceUp && (t === self || (t.data.attribute & self.data.attribute) !== 0),
    },
    {
      kind: 'quick',
      label: '宣言 1 個屬性：這張卡直到回合結束時變成宣言的屬性',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        const d = ctx.duel;
        const i = await d.chooseOption({ player: ctx.player, title: '宣言 1 個屬性', options: ATTR_LIST.map(([a, n]) => ({ label: n, ai: d.faceUpMonsters(ctx.player).filter((c) => (c.data.attribute & a) !== 0).length * 10 })) });
        const [a] = ATTR_LIST[i] ?? ATTR_LIST[0];
        if (ctx.card.isFaceUpMonster) d.overrideData(ctx.card, { attribute: a }, d.turn);
      },
      ai: () => 0,
    },
  ],
});

// 共命之翼 迦樓羅
def(11765832, {
  fusion: Object.assign([(d: CardData) => isMonster(d), (d: CardData) => isMonster(d)], {
    validate: (mats: Card[]) =>
      mats.length === 2 && mats[0].data.attribute === mats[1].data.attribute && mats[0].data.race === mats[1].data.race && mats[0].data.name !== mats[1].data.name,
  }),
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'doubleBattleDamage' && t === self },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被送去墓地：自己抽 1 張',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.event?.card === ctx.card,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 90,
    },
  ],
});

// 強襲黑羽-叢雲之草薙劍鳥
const isBlackwing = (d: CardData) => d.nameEn.includes('Blackwing');
def(31114334, {
  attackEach: () => true,
  effects: [
    {
      kind: 'continuous',
      onEvent: (d, self, ev) => {
        if (ev.type !== 'summoned' || ev.card !== self || self.summonType !== 'synchro') return;
        const mats = self.summonMaterials ?? [];
        if (mats.some((m) => isBlackwing(m.data))) d.overrideData(self, { type: self.data.type | 0x1000 });
        const sum = mats.filter((m) => (m.data.type & 0x2000) !== 0).reduce((s, m) => s + Math.max(0, (m.baseData ?? m.data).atk), 0);
        if (sum) d.addMod(self, { atk: sum, until: 'endTurn' }, self);
      },
    },
    { kind: 'continuous', query: (_d, self, q, t) => t === self && q === 'piercing' },
  ],
});

// 勵輝士 入魔蠅王
const fieldHand = (d: Duel, p: PlayerId) => d.fieldCards(p).length + d.p(p).hand.length;
def(46772449, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'quick',
      label: '對方的手牌・場上的卡比自己多：取除 1 個超量素材，場上的其他卡全部破壞',
      categories: ['destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const ok = (d.turnPlayer === ctx.player && inMainPhase(d) && !d.chain.length) || (d.turnPlayer === ctx.opp && d.phase === 'battle');
        return ok && ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && fieldHand(d, ctx.opp) > fieldHand(d, ctx.player) && !d.chain.some((l) => l.card.id === 46772449);
      },
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(d.fieldCards().filter((c) => c !== ctx.card), 'effect', ctx.card);
        d.p(ctx.opp).turnFlags.noDamage = true;
      },
      ai: (ctx) => (fieldHand(ctx.duel, ctx.opp) - fieldHand(ctx.duel, ctx.player) >= 3 ? 85 : 0),
    },
  ],
});

// 御影志士
def(32530043, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'ignition',
      label: '取除 1 個超量素材：從牌組把岩石族怪獸加入手牌，或從手牌把岩石族怪獸裡側守備表示特殊召喚',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && (rockDeck(ctx).length > 0 || rockHand(ctx).length > 0),
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const canSS = rockHand(ctx).length > 0 && d.freeMZones(ctx.player) > 0;
        const i = rockDeck(ctx).length && canSS ? await d.chooseOption({ player: ctx.player, title: '選擇要發動的效果', options: [{ label: '從牌組把岩石族怪獸加入手牌', ai: 60 }, { label: '從手牌把岩石族怪獸裡側守備表示特殊召喚', ai: 40 }] }) : canSS ? 1 : 0;
        if (i === 0) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇岩石族怪獸', cards: rockDeck(ctx), hint: 'benefit' });
          if (c) d.addToHandFromDeck(c, ctx.card);
        } else {
          const c = await d.selectOne({ player: ctx.player, title: '選擇岩石族怪獸', cards: rockHand(ctx), hint: 'benefit' });
          if (c && d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card })) {
            c.faceUp = false;
            d.update();
          }
        }
      },
      ai: () => 80,
    },
  ],
});
const rockDeck = (ctx: EffectContext) => deckFilter(ctx, (x) => isMonster(x) && (x.race & RACE.ROCK) !== 0);
const rockHand = (ctx: EffectContext) => ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data) && (c.data.race & RACE.ROCK) !== 0 && canRevive(c));

// 無光之影 阿-寶・阿・庫
def(4731783, {
  link: { min: 2, validate: (set) => set.some((c) => (c.data.race & RACE.FIEND) !== 0) },
  aiSummonValue: () => 3400,
  effects: [
    {
      kind: 'quick',
      label: '丟棄 1 張手牌：場上 1 張卡破壞，或這張卡直到結束階段除外並從墓地特殊召喚光・暗屬性怪獸',
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.duel.p(ctx.player).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ld = d.p(ctx.player).grave.filter((c) => isMonster(c.data) && (c.data.attribute & (ATTR.LIGHT | ATTR.DARK)) !== 0 && canRevive(c));
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '場上 1 張卡破壞', ai: d.fieldCards(ctx.opp).length ? 70 : -1 },
            { label: '這張卡直到結束階段除外，從自己墓地把 1 隻光・暗屬性怪獸特殊召喚', ai: ld.length ? 40 : -1 },
          ],
        });
        if (i === 0) return destroyOne(ctx);
        if (!ctx.card.onField || !ld.length) return;
        const { banishUntilEnd } = await import('./elfnote');
        banishUntilEnd(d, [ctx.card], ctx.card);
        const c = await d.selectOne({ player: ctx.player, title: '選擇光・暗屬性怪獸', cards: ld, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c && d.freeMZones(ctx.player) > 0) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length && ctx.duel.p(ctx.player).hand.some((c) => cardValue(ctx.duel, c, ctx.player) < 1500) ? 80 : 0),
    },
    {
      kind: 'trigger',
      event: 'standby',
      label: '自己準備階段：抽出墓地的怪獸的種族種類的數量，那之後把相同數量的手牌回到牌組下面',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.player && raceKinds(ctx) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = raceKinds(ctx);
        const drawn = d.draw(ctx.player, n).length;
        if (!drawn) return;
        const back = await d.select({ player: ctx.player, title: `選擇 ${drawn} 張手牌回到牌組下面`, cards: d.p(ctx.player).hand, min: Math.min(drawn, d.p(ctx.player).hand.length), max: drawn, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        for (const c of back) d.moveTo(c, 'deck', { reason: 'effect', by: ctx.card, top: false });
      },
      ai: () => 70,
    },
  ],
});
const raceKinds = (ctx: EffectContext) => {
  let races = 0;
  for (const c of ctx.duel.p(ctx.player).grave) if (isMonster(c.data)) races |= c.data.race;
  let n = 0;
  for (let b = races; b; b &= b - 1) n++;
  return n;
};

// 超念銃士 瓦隆
def(40673853, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'quick',
      label: '取除 1 個超量素材：對方場上 1 隻表側表示怪獸變成裡側守備表示',
      once: 'name',
      categories: ['position'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.card.overlays.length > 0 && ctx.duel.faceUpMonsters(ctx.opp).some((c) => !isLink(c.data)),
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp).filter((c) => !isLink(c.data)), { title: '選擇怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || isLink(t.data)) return;
        t.faceUp = false;
        t.position = 'def';
        d.log(`「${t.name}」變成裡側守備表示`);
        d.update();
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.chain.length ? 80 : 50),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被送去墓地：場上 1 張裡側表示卡破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.fieldCards().some((c) => !c.faceUp),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => !c.faceUp), { title: '選擇裡側表示卡', aiValue: (c) => (c.controller === ctx.opp ? 100 : -100) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => !c.faceUp) ? 85 : 0),
    },
  ],
});

// 分體論聚合員
def(9940036, {
  xyz: { count: 2, max: 5 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '超量召喚：從額外牌組把 1 隻怪獸送去墓地',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['xyz']) && ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: d.p(ctx.player).extra.filter((c) => !c.faceUp), hint: 'benefit', aiValue: (x) => ((x.data.desc.match(/墓地/g) ?? []).length ? 100 : 0) });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '以墓地的怪獸為對象：取除相同數量的超量素材，把那些怪獸作為超量素材',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)), { title: '選擇墓地的怪獸', min: 1, max: ctx.card.overlays.length, hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (!ts.length || !ctx.card.isFaceUpMonster) return;
        d.detachMaterials(ctx.card, Math.min(ts.length, ctx.card.overlays.length));
        attach(d, ctx.card, ts.filter((c) => c.location === 'grave'));
      },
      ai: () => 30,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被送去墓地：場上 1 張表側表示卡的效果直到回合結束時無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp), { title: '選擇要無效的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField && t.faceUp) ctx.duel.setFlag(t, 'negated');
      },
      ai: () => 85,
    },
  ],
});

// 終戒超獸-武爾德拉斯
def(70636044, {
  xyz: { count: 2, max: 5 },
  aiSummonValue: () => 4200,
  effects: [
    {
      kind: 'quick',
      label: '對方把效果發動時，取除 1 個超量素材：那個發動無效，可以再取除 1 個超量素材把場上 1 張卡破壞',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && !!top && top.player === ctx.opp && !top.negated;
      },
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (link) d.negateLink(link);
        if (ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && d.fieldCards(ctx.opp).length && (await d.confirm({ player: ctx.player, title: '要再取除 1 個超量素材把場上 1 張卡破壞嗎？', ai: true }))) {
          d.detachMaterials(ctx.card, 1);
          await destroyOne(ctx);
        }
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'damageStepStart',
      label: '持有超量素材的這張卡攻擊的傷害步驟開始時：場上 1 張卡破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.battle?.attacker === ctx.card && ctx.card.overlays.length > 0 && ctx.duel.fieldCards(ctx.opp).length > 0,
      operation: async (ctx) => destroyOne(ctx),
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '超量召喚的這張卡被破壞：場上 1 張卡破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.summonType === 'xyz' && ctx.duel.fieldCards(ctx.opp).length > 0,
      operation: async (ctx) => destroyOne(ctx),
      ai: () => 85,
    },
  ],
});

// 軌跡之魔術師
def(22125101, {
  link: { min: 2, max: 2, filter: (c) => isEffectMon(c.data), validate: (set) => set.some((c) => isPendulum(c.data)) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '在額外怪獸區域連結召喚，支付 1200 基本分：從牌組把 1 隻靈擺怪獸加入手牌',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && ctx.card.zone >= 5 && ctx.duel.p(ctx.player).lp > 1200 && deckFilter(ctx, (x) => isMonster(x) && isPendulum(x)).length > 0,
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 1200);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇靈擺怪獸', cards: deckFilter(ctx, (x) => isMonster(x) && isPendulum(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
        const p = ctx.player;
        d.p(p).activationLocks.push(() => !!d.p(p).turnFlags.pendulumSummoned);
        d.lingering.push({ turn: d.turn, negate: (x) => x.controller === p && x.location === 'szone' && isPendulum(x.data) && x.faceUp && !d.p(p).turnFlags.pendulumSummoned && (x.zone === 0 || x.zone === 4) });
      },
      ai: () => 75,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '所連接區有原本等級不同的怪獸 2 隻同時靈擺召喚：場上 2 張卡破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const ev = ctx.event;
        if (!ctx.card.isFaceUpMonster || ev?.summonType !== 'pendulum') return false;
        const pointed = d.pointedMonsters(ctx.card);
        const inZone = (ev.cards ?? []).filter((c) => pointed.includes(c));
        return new Set(inZone.map((c) => c.data.level)).size >= 2 && d.fieldCards().length >= 2;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(), { title: '選擇 2 張卡', min: 2, max: 2, aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.onField);
        if (ts.length) await ctx.duel.destroy(ts, 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// DDD 怒濤大王 決策凱撒
def(79559912, {
  xyz: { count: 2, filter: (c) => (c.data.race & RACE.FIEND) !== 0 },
  effects: [
    {
      kind: 'quick',
      label: '包含把怪獸特殊召喚效果的效果發動時，取除 1 個超量素材：那個發動無效並破壞',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && !!top && top.card !== ctx.card && !top.negated && ((top.effect.categories ?? []).includes('summon') || /特殊召喚/.test(top.effect.label ?? top.card.data.desc));
      },
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
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
        const dd = d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && c.data.nameEn.includes('D/D'));
        if (ctx.card.isFaceUpMonster && dd.length && (await d.confirm({ player: ctx.player, title: '要讓攻擊力上升 1800 嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇「DD」怪獸', cards: dd, hint: 'benefit' });
          for (const m of [ctx.card, c].filter((x): x is Card => !!x)) d.addMod(m, { atk: 1800, until: 'endTurn' }, ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 90 : 0),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從場上送去墓地：從牌組把 1 張「契約書」卡加入手牌',
      categories: ['search'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && deckFilter(ctx, (x) => x.nameEn.includes('Contract') || x.name.includes('契約書')).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「契約書」卡', cards: deckFilter(ctx, (x) => x.nameEn.includes('Contract') || x.name.includes('契約書')), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 三英之相劍師
def(74405783, {
  synchro: { tuner: (c) => c.data.level === 4 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：攻擊力和守備力相同的 4・8 星魔法師族怪獸從牌組・墓地加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && champPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇魔法師族怪獸', cards: champPool(ctx), hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '以場上 1 張表側表示卡為對象：那張卡的效果無效（墓地有「艾克莉西婭」或「阿不思的落胤」時可以再破壞）',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp && !ctx.duel.isNegated(c)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp && c !== ctx.card), { title: '選擇要無效的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !t.faceUp) return;
        d.setFlag(t, 'negated', true);
        const fallen = d.p(ctx.player).grave.some((c) => c.id === 68468459 || (isMonster(c.data) && (c.data.name.includes('艾克莉西婭') || c.data.nameEn.includes('Ecclesia'))));
        if (fallen && (await d.confirm({ player: ctx.player, title: `要再把「${t.name}」破壞嗎？`, ai: true }))) await d.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.chain.length ? 80 : 60),
    },
  ],
});
const champPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter(
    (c) => isMonster(c.data) && (c.data.race & RACE.SPELLCASTER) !== 0 && (c.data.level === 4 || c.data.level === 8) && c.data.atk === c.data.def,
  );

// 蒼之深淵 淵眼白龍
const BEWD = 89631139;
const isBlueEyes = (d: CardData) => d.nameEn.includes('Blue-Eyes') || d.name.includes('青眼');
def(67886895, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌丟棄：從牌組把 1 隻光屬性・1 星調整加入手牌',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isMonster(x) && isTuner(x) && x.level === 1 && (x.attribute & ATTR.LIGHT) !== 0).length > 0,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇光屬性・1 星調整', cards: deckFilter(ctx, (x) => isMonster(x) && isTuner(x) && x.level === 1 && (x.attribute & ATTR.LIGHT) !== 0), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: ['toGrave', 'toGraveMulti'],
      label: '「青眼」儀式怪獸或「青眼白龍」被送去自己墓地：這張卡從手牌・墓地特殊召喚，攻擊力變成和對象相同',
      range: ['hand', 'grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && abyssTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, abyssTargets(ctx), { title: '選擇怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if ((ctx.card.location !== 'hand' && ctx.card.location !== 'grave') || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        d.setFlag(ctx.card, 'banishOnLeave', true);
        if (t) d.addMod(ctx.card, { setAtk: Math.max(0, t.data.atk), until: 'permanent' }, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const abyssTargets = (ctx: EffectContext) => {
  const ev = ctx.event;
  const cards = ev?.cards ?? (ev?.card ? [ev.card] : []);
  return cards.filter((c) => c.location === 'grave' && c.owner === ctx.player && c !== ctx.card && (c.id === BEWD || (isRitual(c.data) && isMonster(c.data) && isBlueEyes(c.data))));
};

// 禁忌的一滴
def(24299458, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => dropletTargets(ctx).length > 0 && dropletCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const max = Math.min(dropletCost(ctx).length, dropletTargets(ctx).length);
        const sel = await d.select({ player: ctx.player, title: `選擇要送去墓地的卡（最多 ${max} 張）`, cards: dropletCost(ctx), min: 1, max, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        const kinds = new Set(sel.map((c) => (isMonster(c.data) ? 'm' : isSpell(c.data) ? 's' : 't')));
        ctx.data.n = d.sendToGrave(sel, 'cost', ctx.card).length;
        ctx.data.noResponseKinds = [...kinds];
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = (ctx.data.n as number) ?? 0;
        const pool = dropletTargets(ctx);
        if (!n || !pool.length) return;
        const sel = await d.select({ player: ctx.player, title: `選擇 ${Math.min(n, pool.length)} 隻對方的效果怪獸`, cards: pool, min: Math.min(n, pool.length), max: Math.min(n, pool.length), hint: 'harm', aiValue: (c) => cardValue(d, c, ctx.player) });
        for (const c of sel) {
          if (d.isImmune(c, ctx.card)) continue;
          d.setFlag(c, 'negated');
          d.addMod(c, { setAtk: Math.floor(d.getAtk(c) / 2), until: 'endTurn' }, ctx.card);
        }
      },
      ai: (ctx) => (dropletTargets(ctx).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 80 : 0),
    }),
  ],
});
const dropletTargets = (ctx: EffectContext) => ctx.duel.faceUpMonsters(ctx.opp).filter((c) => isEffectMon(c.data));
const dropletCost = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.fieldCards(ctx.player)].filter((c) => c !== ctx.card);

// 禁忌的聖冠
def(98829635, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      cost: async (ctx) => {
        ctx.data.noMonsterResponse = true;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇場上 1 隻表側表示怪獸', cards: d.faceUpMonsters(), hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -1000) });
        if (!c) return;
        d.setFlag(c, 'negated');
        d.setFlag(c, 'cannotAttack');
        d.setFlag(c, 'battleIndestructible');
        d.setFlag(c, 'effectIndestructible');
        d.setFlag(c, 'cannotTribute');
        d.setFlag(c, 'cannotBeMaterial');
        d.setFlag(c, 'immuneOtherActivated');
        d.log(`「${c.name}」直到回合結束時效果無效・不能攻擊・不會被破壞・不受其他卡發動的效果影響`);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return (top && top.player === ctx.opp) || ctx.duel.faceUpMonsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2500) ? 75 : 0;
      },
    }),
  ],
});

// 神書的使者 拉哈穆
def(53904087, {
  link: { min: 2, max: 2, filter: (c) => isEffectMon(c.data) },
  effects: [
    { kind: 'continuous', onEvent: (_d, self, ev) => void (ev.type === 'summoned' && ev.card === self && self.summonType === 'link' && (self.flags.rahamuReady = true)) },
    {
      kind: 'quick',
      label: '進行 1 隻 5 星以上的暗屬性怪獸的召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.duel.p(ctx.player).hand.some((c) => rahamuOk(ctx.duel, ctx.card, c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要召喚的怪獸', cards: d.p(ctx.player).hand.filter((c) => rahamuOk(d, ctx.card, c)), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        if (ctx.card.flags.rahamuReady) {
          ctx.card.flags.rahamuReady = false;
          d.p(ctx.player).noTributeRules.push((x) => x === c);
        }
        await d.normalSummonByEffect(ctx.player, c);
      },
      ai: () => 75,
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '自己結束階段：把手牌的怪獸任意數量回到牌組下面，抽出相同數量',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.player && ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).hand.filter((c) => isMonster(c.data));
        const sel = await d.select({ player: ctx.player, title: '選擇要回到牌組下面的怪獸', cards: pool, min: 1, max: pool.length, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        d.log(`給對方觀看 ${sel.map((c) => `「${c.name}」`).join('、')}`);
        for (const c of sel) d.moveTo(c, 'deck', { reason: 'effect', by: ctx.card, top: false });
        if (sel.length) d.draw(ctx.player, sel.length);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && cardValue(ctx.duel, c, ctx.player) < 1200) ? 60 : 0),
    },
  ],
});
const rahamuOk = (d: Duel, self: Card, c: Card) =>
  isMonster(c.data) && c.data.level >= 5 && (c.data.attribute & ATTR.DARK) !== 0 && d.summonAllowed(self.controller, c, 'normal') &&
  ((self.flags.rahamuReady && d.freeMZones(self.controller) > 0) || d.tributable(self.controller, true, c).length >= d.tributesNeeded(c));

// 天霆號 阿宙斯
def(90448279, {
  xyz: {
    count: 2,
    over: (c, d) => isXyz(c.data) && c.isFaceUpMonster && d.xyzBattledTurn === d.turn && d.p(c.controller).usedNames['zeusOver'] !== d.turn,
    onOver: (d, card) => {
      d.p(card.controller).usedNames['zeusOver'] = d.turn;
    },
  },
  aiSummonValue: () => 4500,
  effects: [
    {
      kind: 'quick',
      label: '取除 2 個超量素材：場上的其他卡全部送去墓地',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.overlays.length >= 2 && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 2);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.sendToGrave(d.fieldCards().filter((c) => c !== ctx.card), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length - ctx.duel.fieldCards(ctx.player).length >= 2 ? 85 : 0),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '自己場上的其他卡被戰鬥或對方的效果破壞：從手牌・牌組・額外牌組把 1 張卡作為這張卡的超量素材',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ctx.card.isFaceUpMonster || !ev?.card || ev.card === ctx.card || (ev.prevController ?? ev.card.owner) !== ctx.player) return false;
        return ev.reason === 'battle' || (ev.reason === 'effect' && !!ev.by && controllerOf(ev.by) === ctx.opp);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).extra.filter((c) => !c.faceUp)];
        const c = await d.selectOne({ player: ctx.player, title: '選擇要作為超量素材的卡', cards: pool, hint: 'benefit', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c && ctx.card.isFaceUpMonster) attach(d, ctx.card, [c]);
      },
      ai: () => 70,
    },
  ],
});

void isToken;
void isTrap;
