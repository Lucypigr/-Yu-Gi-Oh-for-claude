// 第十九彈：雷火沸動、碼麗絲
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isLink, isMonster, isSpell, isTrap, isXyz, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { def, extend } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const isEffectMon = (d: CardData) => isMonster(d) && (d.type & 0x20) !== 0;

// =====================================================================
// 雷火沸動
// =====================================================================

const isRyzeal = (d: CardData) => d.nameEn.includes('Ryzeal');
const isRyzealMon = (d: CardData) => isMonster(d) && isRyzeal(d);
const isRyzealST = (d: CardData) => (isSpell(d) || isTrap(d)) && isRyzeal(d);
const isR4 = (c: Card) => isXyz(c.data) && c.data.level === 4;
const ryzealXyz = (d: Duel, p: PlayerId) => d.faceUpMonsters(p).filter((c) => isXyz(c.data) && isRyzeal(c.data));

/** 「這個方法特殊召喚過的回合，自己不是 4 階超量怪獸不能從額外牌組特殊召喚」 */
const lockRank4 = (d: Duel, p: PlayerId) =>
  d.addSummonLock(p, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isR4(c) });

/** 手牌特殊召喚的方法（1 回合 1 次）＋ 4 階限制 */
function ryzealProc(
  id: number,
  label: string,
  cond: (duel: Duel, card: Card) => boolean,
  cost?: (duel: Duel, card: Card) => Promise<void>,
  ai?: (duel: Duel, card: Card) => number,
) {
  const key = `ryzealProc${id}`;
  return {
    label,
    ai,
    condition: (duel: Duel, card: Card) => !duel.p(card.owner).turnFlags[key] && cond(duel, card),
    cost: async (duel: Duel, card: Card) => {
      duel.p(card.owner).turnFlags[key] = true;
      if (cost) await cost(duel, card);
      lockRank4(duel, card.owner);
    },
  };
}

/** 從手牌・場上把 1 張卡送去墓地（代價） */
async function sendHandOrField(duel: Duel, p: PlayerId, by: Card, exclude: Card[] = []) {
  const c = await duel.selectOne({
    player: p,
    title: '選擇要送去墓地的手牌・場上的卡',
    cards: [...duel.p(p).hand, ...duel.fieldCards(p)].filter((c) => !exclude.includes(c)),
    hint: 'cost',
    aiValue: (x) => (x.id === 53276089 && x.location === 'hand' ? 400 : 0) - cardValue(duel, x, p),
  });
  if (c) duel.sendToGrave([c], 'cost', by);
}

/** 自己場上的超量素材取除 n 個（可以從不同的超量怪獸） */
async function detachFromField(d: Duel, p: PlayerId, n: number) {
  for (let i = 0; i < n; i++) {
    const x = await d.selectOne({
      player: p,
      title: '選擇要取除超量素材的超量怪獸',
      cards: d.faceUpMonsters(p).filter((c) => c.overlays.length > 0),
      hint: 'cost',
      aiValue: (c) => c.overlays.length,
    });
    if (!x) return;
    d.detachMaterials(x, 1);
  }
}
const fieldMaterials = (d: Duel, p: PlayerId) => d.faceUpMonsters(p).reduce((s, c) => s + c.overlays.length, 0);

/** 正在發動中、處理後就會離場的魔法・陷阱卡（破壞它也阻止不了效果） */
const resolvingOnce = (d: Duel, c: Card) =>
  d.chain.some((l) => l.card === c && l.isCardActivation) &&
  (isSpell(c.data) || isTrap(c.data)) &&
  !['continuous', 'field', 'equip'].includes(isSpell(c.data) ? spellKind(c.data) : trapKind(c.data));
/** AI：破壞對方卡的價值 */
const destroyValue = (d: Duel, c: Card, me: PlayerId) => (c.controller === me ? -5000 : resolvingOnce(d, c) ? 0 : cardValue(d, c, me));

/** 「那之後，可以把○○作為自己場上 1 隻 4 階超量怪獸的超量素材」 */
async function attachToR4(ctx: EffectContext, pool: Card[], title: string) {
  const d = ctx.duel;
  const xyzs = d.faceUpMonsters(ctx.player).filter(isR4);
  if (!pool.length || !xyzs.length) return;
  if (!(await d.confirm({ player: ctx.player, title, ai: true }))) return;
  const c = await d.selectOne({ player: ctx.player, title: '選擇要作為超量素材的卡', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === 53276089 ? 300 : 0) });
  if (!c) return;
  const x = await d.selectOne({ player: ctx.player, title: '選擇 4 階超量怪獸', cards: xyzs, hint: 'benefit', aiValue: (m) => (isRyzeal(m.data) ? 100 : 0) });
  if (x) {
    const fromDeck = c.location === 'deck';
    d.attachMaterial(x, c);
    if (fromDeck) d.shuffleDeck(ctx.player);
  }
}

// 劍式陰極雷火沸動機
def(35844557, {
  spSummon: ryzealProc(35844557, '自己的場上或墓地有「雷火沸動」怪獸：從手牌特殊召喚', (duel, card) =>
    [...duel.faceUpMonsters(card.owner), ...duel.p(card.owner).grave].some((c) => isRyzealMon(c.data)),
  ),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把炎族・光屬性怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) && deckFilter(ctx, (x) => isMonster(x) && (x.race & RACE.PYRO) !== 0 && (x.attribute & ATTR.LIGHT) !== 0).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isMonster(x) && (x.race & RACE.PYRO) !== 0 && (x.attribute & ATTR.LIGHT) !== 0);
      },
      ai: () => 90,
    },
  ],
});

// 節式陽極雷火沸動機
def(72238166, {
  spSummon: ryzealProc(72238166, '自己的場上或墓地有超量怪獸：從手牌特殊召喚', (duel, card) =>
    [...duel.faceUpMonsters(card.owner), ...duel.p(card.owner).grave].some((c) => isXyz(c.data)),
  ),
  effects: [
    {
      kind: 'ignition',
      label: '從手牌・場上把 1 張卡送去墓地：墓地的「雷火沸動」怪獸效果無效守備表示特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.p(ctx.player).grave.some((c) => isRyzealMon(c.data) && c.id !== 72238166 && canRevive(c)) &&
        (ctx.duel.freeMZones(ctx.player) > 0 || ctx.duel.monsters(ctx.player).length > 0),
      cost: async (ctx) => sendHandOrField(ctx.duel, ctx.player, ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRyzealMon(c.data) && c.id !== 72238166 && canRevive(c)), {
          title: '選擇要特殊召喚的「雷火沸動」怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t && d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card })) d.setFlag(t, 'negated', true);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.length > 0 ? 70 : 30),
    },
  ],
});

// 內燃雷火沸動機
def(8633261, {
  spSummon: ryzealProc(
    8633261,
    '把自己的手牌・場上 1 張卡送去墓地：從手牌特殊召喚',
    (duel, card) => [...duel.p(card.owner).hand.filter((c) => c !== card), ...duel.fieldCards(card.owner)].length > 0,
    (duel, card) => sendHandOrField(duel, card.owner, card, [card]),
    // 還能通常召喚的話，先通常召喚發動②
    (duel, card) => (duel.p(card.owner).normalSummons > 0 ? 0 : 66),
  ),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組特殊召喚「雷火沸動」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal', 'tribute']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (x) => isRyzealMon(x) && x.id !== 8633261 && (x.type & 0x2000000) === 0).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的「雷火沸動」怪獸',
          cards: deckFilter(ctx, (x) => isRyzealMon(x) && x.id !== 8633261 && (x.type & 0x2000000) === 0),
          hint: 'benefit',
          aiValue: (x) => (x.id === 35844557 ? 100 : 0),
        });
        if (!c) return;
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 90,
    },
  ],
});

// 外燃雷火沸動機
def(34022970, {
  spSummon: ryzealProc(
    34022970,
    '把額外牌組 1 隻超量怪獸送去墓地：從手牌特殊召喚',
    (duel, card) => duel.p(card.owner).extra.some((c) => isXyz(c.data)),
    async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要送去墓地的超量怪獸',
        cards: duel.p(card.owner).extra.filter((c) => isXyz(c.data)),
        hint: 'cost',
        aiValue: (x) => (isRyzeal(x.data) ? -100 : 0),
      });
      if (c) duel.sendToGrave([c], 'cost', card);
    },
  ),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把雷族・炎屬性怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        !ctx.duel.faceUpMonsters(ctx.player).some((c) => (isXyz(c.data) ? c.data.level !== 4 : isLink(c.data) || ctx.duel.getLevel(c) !== 4)) &&
        deckFilter(ctx, (x) => isMonster(x) && (x.race & RACE.THUNDER) !== 0 && (x.attribute & ATTR.FIRE) !== 0).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isMonster(x) && (x.race & RACE.THUNDER) !== 0 && (x.attribute & ATTR.FIRE) !== 0);
      },
      ai: () => 90,
    },
  ],
});

// 星式熱氣雷火沸動機
def(84433129, {
  spSummon: ryzealProc(
    84433129,
    '把自己場上 1 個超量素材取除：從手牌特殊召喚',
    (duel, card) => fieldMaterials(duel, card.owner) > 0,
    (duel, card) => detachFromField(duel, card.owner, 1),
  ),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「雷火沸動」魔法・陷阱在自己場上蓋放',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) && !['normal', 'tribute', 'flip'].includes(ctx.card.summonType ?? '') && ctx.duel.freeSZones(ctx.player) > 0 && deckFilter(ctx, isRyzealST).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeSZones(ctx.player) <= 0) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要蓋放的「雷火沸動」魔法・陷阱',
          cards: deckFilter(ctx, isRyzealST),
          hint: 'benefit',
          aiValue: (x) => (x.id === 33787730 ? 300 : x.id === 60394026 ? 200 : 0),
        });
        if (!c) return;
        // 場地魔法放到場地區域
        if (isSpell(c.data) && (c.data.type & 0x80000) !== 0) d.moveTo(c, 'fzone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        else d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        c.turnPlaced = d.turn;
        d.shuffleDeck(ctx.player);
        d.log(`「${c.name}」在場上蓋放`);
      },
      ai: () => 90,
    },
  ],
});

// 掌式永磁雷火沸動機
def(61116514, {
  spSummon: {
    label: '讓手牌・墓地 1 隻「雷火沸動」怪獸回到牌組・額外牌組：從手牌特殊召喚',
    condition: (duel, card) => [...duel.p(card.owner).hand.filter((c) => c !== card), ...duel.p(card.owner).grave].some((c) => isRyzealMon(c.data)),
    cost: async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要回到牌組・額外牌組的「雷火沸動」怪獸',
        cards: [...duel.p(card.owner).hand.filter((c) => c !== card), ...duel.p(card.owner).grave].filter((c) => isRyzealMon(c.data)),
        hint: 'cost',
        aiValue: (x) => (x.location === 'grave' ? 100 : 0),
      });
      if (c) duel.returnToDeck([c], false, 'cost', card);
    },
  },
  summonRestriction: (_d, self, p, card, kind) => !(kind === 'special' && p === self.controller && card.location === 'extra' && !isR4(card)),
  effects: [
    {
      kind: 'trigger',
      event: 'damageCalc',
      label: '從手牌・牌組把 4 星怪獸送去墓地，攻擊力上升那個攻擊力',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return ctx.card.isFaceUpMonster && foe.controller === ctx.opp && palmPool(ctx).length > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的 4 星怪獸', cards: palmPool(ctx), hint: 'cost', aiValue: (x) => x.data.atk });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        const atk = Math.max(0, c.data.atk);
        d.sendToGrave([c], 'effect', ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk, until: 'battleEnd' });
      },
      ai: () => 80,
    },
  ],
});
const palmPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isMonster(c.data) && !isXyz(c.data) && !isLink(c.data) && c.data.level === 4);

// 雷火沸動油電雙動機
def(7511613, {
  xyz: { count: 2, max: 5 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '把墓地 1 隻「雷火沸動」怪獸作為這張卡的超量素材',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        summonedSelf(ctx) && !['normal', 'tribute', 'flip'].includes(ctx.card.summonType ?? '') && ctx.duel.p(ctx.player).grave.some((c) => isRyzealMon(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「雷火沸動」怪獸', cards: d.p(ctx.player).grave.filter((c) => isRyzealMon(c.data)), hint: 'benefit' });
        if (c && ctx.card.isFaceUpMonster) d.attachMaterial(ctx.card, c);
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      statMod: (_d, self, t) => {
        const n = self.overlays.length * 100;
        if (!n) return null;
        return t.controller === self.controller ? { atk: n } : { atk: -n };
      },
    },
    {
      kind: 'ignition',
      label: '自己場上 2 個超量素材取除：從牌組把 2 張「雷火沸動」卡加入手牌（同名卡最多 1 張）',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && fieldMaterials(ctx.duel, ctx.player) >= 2 && new Set(deckFilter(ctx, isRyzeal).map((c) => c.id)).size >= 2,
      cost: async (ctx) => detachFromField(ctx.duel, ctx.player, 2),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, isRyzeal);
        if (new Set(cands.map((c) => c.id)).size < 2) return;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 張卡名不同的「雷火沸動」卡',
          cards: cands,
          min: 2,
          max: 2,
          hint: 'benefit',
          validate: (s) => s.length === 2 && s[0].id !== s[1].id,
          aiValue: (x) => (x.id === 33787730 ? 300 : x.id === 6798031 ? 250 : x.id === 8633261 ? 200 : 0),
        });
        if (sel.length === 2 && sel[0].id !== sel[1].id) for (const c of sel) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 雷火沸動死旋爆震機
def(34909328, {
  xyz: { count: 2, max: 5, filter: (c) => isRyzeal(c.data) },
  selfSubstitute: (_d, self, reason) =>
    (reason === 'battle' || reason === 'effect') && self.overlays.length > 0 ? () => detonatorDetach(_d, self) : null,
  fieldSubstitute: (d, self, destroyed, reason) =>
    (reason === 'battle' || reason === 'effect') &&
    self.overlays.length > 0 &&
    destroyed.location === 'mzone' &&
    destroyed.faceUp &&
    destroyed.controller === self.controller &&
    isXyz(destroyed.data)
      ? () => detonatorDetach(d, self)
      : null,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '把自己墓地 1 隻怪獸作為這張卡的超量素材',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        summonedSelf(ctx) && !['normal', 'tribute', 'flip'].includes(ctx.card.summonType ?? '') && ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要作為超量素材的怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isMonster(c.data)),
          hint: 'benefit',
          aiValue: (x) => (isRyzeal(x.data) ? 100 : 0),
        });
        if (c && ctx.card.isFaceUpMonster) d.attachMaterial(ctx.card, c);
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '對方把卡的效果發動時，取除 1 個超量素材：破壞場上 1 張卡',
      categories: ['destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && !!top && top.player === ctx.opp && ctx.duel.fieldCards().length > 0;
      },
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        await chooseTargets(ctx, d.fieldCards(), {
          title: '選擇要破壞的卡',
          aiValue: (c) => destroyValue(d, c, ctx.player) + (top?.card === c && !resolvingOnce(d, c) ? 3000 : 0),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const best = Math.max(0, ...d.fieldCards(ctx.opp).map((c) => destroyValue(d, c, ctx.player)));
        return best >= 800 ? 80 : 0;
      },
    },
  ],
});
function detonatorDetach(d: Duel, self: Card) {
  d.log(`「${self.name}」取除 1 個超量素材代替破壞`);
  d.detachMaterials(self, 1);
}

// 雷火沸動機插電
def(60394026, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && plugTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, plugTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => (isXyz(c.data) ? 1000 : 0) + c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'cannotAttack' && c.controller === p && !isR4(c) });
        if (!t || !d.specialSummon(t, p, { position: 'atk', by: ctx.card })) return;
        await attachToR4(ctx, deckFilter(ctx, isRyzeal), '要從牌組把 1 張「雷火沸動」卡作為 4 階超量怪獸的超量素材嗎？');
      },
      ai: () => 80,
    }),
  ],
});
const plugTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => (isXyz(c.data) || isRyzealMon(c.data)) && canRevive(c));

// 雷火沸動交界機
def(6798031, {
  effects: [
    activate({ ai: () => 80 }),
    {
      kind: 'continuous',
      query: (duel, self, q, t, p) =>
        q === 'cannotXyzSummon' && p === self.controller && !!t && duel.fieldCards(self.controller).some((c) => c.faceUp && c.id === t.id),
    },
    {
      kind: 'ignition',
      label: '墓地 2 張「雷火沸動」卡用喜歡的順序回到牌組下面，抽 1 張',
      range: ['fzone'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.p(ctx.player).grave.filter((c) => isRyzeal(c.data) && c.id !== 6798031).length >= 2,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRyzeal(c.data) && c.id !== 6798031), {
          title: '選擇 2 張「雷火沸動」卡',
          min: 2,
          max: 2,
          hint: 'cost',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length < 2) return;
        // 用喜歡的順序回到牌組下面
        const first = await d.selectOne({ player: ctx.player, title: '選擇先放到牌組最下面的卡', cards: ts, hint: 'benefit' });
        const order = first ? [first, ...ts.filter((c) => c !== first)] : ts;
        if (d.returnToDeck(order, false, 'effect', ctx.card).length < 2) return;
        d.draw(ctx.player, 1);
      },
      ai: () => 70,
    },
  ],
  resolveNegate: async (d, self, link) => {
    const p = self.controller;
    if (self.location !== 'fzone' || link.player === p) return false;
    if (d.p(p).turnFlags.ryzealCrossNegate) return false;
    const xyzs = ryzealXyz(d, p).filter((c) => c.overlays.length > 0);
    if (!xyzs.length) return false;
    if (!(await d.confirm({ player: p, title: `要取除超量素材讓「${link.card.name}」的效果無效嗎？`, ai: cardValue(d, link.card, p) >= 1000 || link.card.controller !== p })))
      return false;
    const x = await d.selectOne({ player: p, title: '選擇要取除超量素材的「雷火沸動」超量怪獸', cards: xyzs, hint: 'cost', aiValue: (c) => c.overlays.length });
    if (!x) return false;
    d.p(p).turnFlags.ryzealCrossNegate = true;
    d.detachMaterials(x, 1);
    d.log(`「${self.name}」的效果：讓那個效果無效化`);
    return true;
  },
});

// 雷火沸動霍爾洞推進器
def(33787730, {
  effects: [
    activate({
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ryzealXyz(ctx.duel, ctx.player).length > 0 && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp).filter((c) => c.faceUp), {
          title: '選擇要破壞的對方的表側表示卡',
          max: ryzealXyz(d, ctx.player).length,
          aiValue: (c) => destroyValue(d, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.onField && c.faceUp);
        if (!ts.length) return;
        await d.destroy(ts, 'effect', ctx.card);
        await attachToR4(ctx, d.p(ctx.player).grave.filter((c) => isRyzeal(c.data)), '要從墓地把 1 張「雷火沸動」卡作為 4 階超量怪獸的超量素材嗎？');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const best = Math.max(0, ...d.fieldCards(ctx.opp).filter((c) => c.faceUp).map((c) => destroyValue(d, c, ctx.player)));
        return best >= 800 ? 85 : 0;
      },
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：用包含「雷火沸動」怪獸的自己場上的怪獸超量召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => plasmaXyz(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const x = await d.selectOne({ player: ctx.player, title: '選擇要超量召喚的怪獸', cards: plasmaXyz(ctx), hint: 'benefit', aiValue: (c) => c.data.atk });
        if (x) await d.xyzSummonByEffect(ctx.player, x, hasRyzealMat);
      },
      ai: () => 80,
    },
  ],
});
const hasRyzealMat = (set: Card[]) => set.some((c) => isRyzealMon(c.data));
const plasmaXyz = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).extra.filter(
    (c) => isXyz(c.data) && ctx.duel.summonAllowed(ctx.player, c, 'special') && ctx.duel.xyzMaterialSets(ctx.player, c).some(hasRyzealMat),
  );

// 雷火沸動質量驅動器
def(53276089, {
  effects: [
    activate({
      once: 'name',
      categories: ['stat'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, stat: (c) => (c.controller === p && isRyzeal(c.data) ? { atk: 1000 } : null) });
        d.log('這個回合中，自己場上的「雷火沸動」怪獸的攻擊力上升 1000');
        if (ctx.card.location === 'szone') await attachToR4(ctx, [ctx.card], '要把這張卡作為 4 階超量怪獸的超量素材嗎？');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        // 自己的回合，在戰鬥前讓「雷火沸動」怪獸變強
        if (d.turnPlayer !== ctx.player || d.phase !== 'main1') return 0;
        return d.faceUpMonsters(ctx.player).some((c) => isRyzeal(c.data) && c.position === 'atk') && d.faceUpMonsters(ctx.player).some(isR4) ? 60 : 0;
      },
    }),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '除外對方墓地 1 張卡',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        !['mzone', 'szone', 'fzone'].includes(ctx.event.from ?? '') &&
        ctx.duel.p(ctx.opp).grave.length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.p(ctx.opp).grave, { title: '選擇對方墓地的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// =====================================================================
// 碼麗絲
// =====================================================================

const isMaliss = (d: CardData) => d.nameEn.includes('Maliss');
const isMalissMon = (d: CardData) => isMonster(d) && isMaliss(d);
const isMalissTrap = (d: CardData) => isTrap(d) && isMaliss(d);
const isMalissLink = (c: Card) => isLink(c.data) && isMaliss(c.data);
/** 有 self 位於所連接區的「碼麗絲」連結怪獸 */
const pointsTo = (d: Duel, link: Card, self: Card) =>
  isMalissLink(link) && link.isFaceUpMonster && self.location === 'mzone' && self.faceUp && !d.isNegated(self) && d.pointedMonsters(link).includes(self);
const lockLinkOnly = (d: Duel, p: PlayerId) => d.addSummonLock(p, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isLink(c.data) });

/** 「這張卡被除外的場合，支付○基本分才能發動」 */
function banishedRevive(label: string, lp: number, opts: { lockLink?: boolean; after?: (ctx: EffectContext) => Promise<void>; double?: boolean } = {}): EffectDef {
  return {
    kind: 'trigger',
    event: 'banished',
    label,
    once: 'name',
    categories: ['summon'],
    condition: (ctx) =>
      ctx.event?.card === ctx.card &&
      ctx.card.location === 'banished' &&
      ctx.duel.p(ctx.player).lp > lp &&
      ctx.duel.freeMZones(ctx.player) > 0,
    cost: async (ctx) => ctx.duel.payLP(ctx.player, lp),
    operation: async (ctx) => {
      const d = ctx.duel;
      if (ctx.card.location !== 'banished') return;
      if (!d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
      if (opts.double) d.addMod(ctx.card, { setAtk: Math.max(0, ctx.card.data.atk) * 2, until: 'permanent' }, ctx.card);
      if (opts.lockLink) lockLinkOnly(d, ctx.player);
      if (opts.after) await opts.after(ctx);
    },
    ai: (ctx) => (ctx.duel.p(ctx.player).lp > lp + 1500 ? 85 : 0),
  };
}
const pawnRevive = () => banishedRevive('支付 300 基本分：特殊召喚這張卡', 300, { lockLink: true });

/** 「從牌組把 1 張『碼麗絲』陷阱卡在自己場上蓋放」 */
async function setMalissTrap(ctx: EffectContext, pool: Card[]) {
  const d = ctx.duel;
  if (!pool.length || d.freeSZones(ctx.player) <= 0) return;
  const c = await d.selectOne({
    player: ctx.player,
    title: '選擇要蓋放的「碼麗絲」陷阱卡',
    cards: pool,
    hint: 'benefit',
    aiValue: (x) => (x.id === 57111661 ? 300 : x.id === 94722358 ? 200 : 100),
  });
  if (!c) return;
  const fromDeck = c.location === 'deck';
  d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
  c.turnPlaced = d.turn;
  if (fromDeck) d.shuffleDeck(ctx.player);
  d.log(`「${c.name}」在場上蓋放`);
}

// 碼麗絲<兵卒>白兔
def(69272449, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同名卡不在墓地的「碼麗絲」陷阱卡從牌組在自己場上蓋放',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.freeSZones(ctx.player) > 0 && rabbitPool(ctx).length > 0,
      operation: async (ctx) => setMalissTrap(ctx, rabbitPool(ctx)),
      ai: () => 90,
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'noBattleDamageToController' && !!t && pointsTo(d, t, self),
    },
    pawnRevive(),
  ],
});
const rabbitPool = (ctx: EffectContext) =>
  deckFilter(ctx, (x) => isMalissTrap(x) && !ctx.duel.p(ctx.player).grave.some((g) => g.id === x.id));

// 碼麗絲<兵卒>柴郡貓
def(96676583, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌把「碼麗絲」卡除外，可以抽 2 張',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).hand.some((c) => isMaliss(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「碼麗絲」卡',
          cards: d.p(ctx.player).hand.filter((c) => isMaliss(c.data)),
          hint: 'cost',
          aiValue: (x) => (isMalissMon(x.data) ? 200 : 0),
        });
        if (!c || !d.banish([c], 'effect', ctx.card).length) return;
        if (await d.confirm({ player: ctx.player, title: '要抽 2 張嗎？', ai: true })) d.draw(ctx.player, 2);
      },
      ai: () => 85,
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'banishBattleKills' && !!t && pointsTo(d, t, self),
    },
    pawnRevive(),
  ],
});

// 碼麗絲<兵卒>睡鼠
def(32061192, {
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把「碼麗絲」怪獸除外，這回合自己的「碼麗絲」怪獸攻擊力上升 600',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && deckFilter(ctx, isMalissMon).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「碼麗絲」怪獸',
          cards: deckFilter(ctx, isMalissMon),
          hint: 'benefit',
          aiValue: (x) => (x.id === 69272449 ? 300 : x.id === 20938824 ? 200 : 100),
        });
        if (c) {
          d.banish([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, stat: (m) => (m.controller === p && isMalissMon(m.data) ? { atk: 600 } : null) });
      },
      ai: () => 85,
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'effectIndestructible' && !!t && pointsTo(d, t, self),
    },
    pawnRevive(),
  ],
});

// 碼麗絲<兵卒>三月兔
def(20938824, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌・墓地把其他「碼麗絲」卡除外，從手牌特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        hareCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「碼麗絲」卡',
          cards: hareCost(ctx),
          hint: 'cost',
          aiValue: (x) => (isMalissMon(x.data) ? 300 : isMalissTrap(x.data) ? 100 : 0),
        });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 85 : 40),
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'untargetableByOpp' && !!t && pointsTo(d, t, self),
    },
    {
      kind: 'trigger',
      event: 'banished',
      label: '支付 300 基本分：除外的「碼麗絲」怪獸加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'banished' &&
        ctx.duel.p(ctx.player).lp > 300 &&
        ctx.duel.p(ctx.player).banished.some((c) => isMalissMon(c.data)),
      cost: async (ctx) => ctx.duel.payLP(ctx.player, 300),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).banished.filter((c) => isMalissMon(c.data)), {
          title: '選擇除外的「碼麗絲」怪獸',
          hint: 'benefit',
          aiValue: (c) => (isLink(c.data) ? -100 : 100),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'banished') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp > 2000 ? 80 : 0),
    },
  ],
});
const hareCost = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter((c) => c !== ctx.card && isMaliss(c.data));

// 碼麗絲<王后>紅棋勒索
def(68059897, {
  link: { min: 2, max: 3, validate: (set) => set.some((c) => isMalissMon(c.data)) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「碼麗絲」魔法卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) && deckFilter(ctx, (x) => isSpell(x) && isMaliss(x)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isSpell(x) && isMaliss(x));
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) =>
        q === 'swapBaseAtkDef' && !!t && t.controller !== self.controller && isEffectMon(t.data) && d.pointedMonsters(self).length > 0,
    },
    banishedRevive('支付 900 基本分：特殊召喚這張卡', 900, {
      after: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, (x) => isMonster(x) && (x.race & RACE.CYBERSE) !== 0);
        if (!pool.length || !(await d.confirm({ player: ctx.player, title: '要從牌組把 1 隻電子界族怪獸除外嗎？', ai: true }))) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的電子界族怪獸',
          cards: pool,
          hint: 'benefit',
          aiValue: (x) => (isMalissMon(x.data) ? 200 : 0),
        });
        if (c) {
          d.banish([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
    }),
  ],
});

// 碼麗絲<王后>白棋綑綁
def(95454996, {
  link: { min: 2, max: 3, validate: (set) => set.some((c) => isMalissMon(c.data)) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '雙方墓地的卡合計最多 3 張除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) =>
        summonedSelf(ctx) && !['normal', 'tribute', 'flip'].includes(ctx.card.summonType ?? '') && [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, [...d.p(0).grave, ...d.p(1).grave], {
          title: '選擇最多 3 張要除外的墓地的卡',
          max: 3,
          aiValue: (c) => (c.owner === ctx.player ? (isMaliss(c.data) ? 500 : -1000) : cardValue(d, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length) ctx.duel.banish(ts, 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '從牌組・墓地把「碼麗絲」陷阱卡在自己場上蓋放',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeSZones(ctx.player) > 0 && binderPool(ctx).length > 0,
      operation: async (ctx) => setMalissTrap(ctx, binderPool(ctx)),
      ai: () => 85,
    },
    banishedRevive('支付 900 基本分：特殊召喚這張卡', 900, {
      after: async (ctx) => {
        const d = ctx.duel;
        if (await d.confirm({ player: ctx.player, title: '要抽 1 張嗎？', ai: true })) d.draw(ctx.player, 1);
      },
    }),
  ],
});
const binderPool = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isMalissTrap(c.data));

// 碼麗絲<王后>紅心加密
def(21848500, {
  link: { min: 3, max: 3, validate: (set) => set.some((c) => isMalissMon(c.data)) },
  effects: [
    {
      kind: 'quick',
      label: '除外的「碼麗絲」卡回到牌組，場上 1 張卡除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).banished.some((c) => isMaliss(c.data)) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        // 這張卡所連接區有怪獸存在的場合，這個發動和這個效果不會被無效化
        if (d.pointedMonsters(ctx.card).length > 0) ctx.data.unnegatable = true;
        await chooseTargets(ctx, d.p(ctx.player).banished.filter((c) => isMaliss(c.data)), {
          title: '選擇要回到牌組的除外的「碼麗絲」卡',
          hint: 'cost',
          aiValue: (c) => (isLink(c.data) ? -100 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'banished' || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        const cands = d.fieldCards();
        if (!cands.length) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的場上的卡',
          cards: cands,
          hint: 'harm',
          aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : x === ctx.card ? -9000 : -3000),
        });
        if (c) d.banish([c], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (!d.fieldCards(ctx.opp).length) return 0;
        return d.chainTop?.player === ctx.opp || d.turnPlayer === ctx.player ? 80 : 40;
      },
    },
    banishedRevive('支付 900 基本分：攻擊力變成 2 倍特殊召喚', 900, { double: true }),
  ],
});

// 碼麗絲夢遊地下界
def(68337209, {
  effects: [
    activate({
      once: 'name',
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => isMaliss(c.data) && c !== ctx.card);
        if (!pool.length || !(await d.confirm({ player: ctx.player, title: '要把 1 張「碼麗絲」卡除外嗎？', ai: true }))) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「碼麗絲」卡',
          cards: pool,
          hint: 'benefit',
          aiValue: (x) => (x.id === 69272449 ? 300 : isMalissMon(x.data) && !isLink(x.data) ? 200 : isMalissTrap(x.data) ? 100 : 0),
        });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.banish([c], 'effect', ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    }),
    {
      kind: 'continuous',
      statMod: (d, self, t) =>
        t.controller === self.controller && isMalissLink(t) && new Set(d.p(self.controller).banished.filter((c) => isMalissTrap(c.data)).map((c) => c.id)).size >= 3
          ? { atk: 3000 }
          : null,
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) =>
        q === 'cannotBeAttackTarget' &&
        !!t &&
        t.controller === self.controller &&
        !isMalissLink(t) &&
        d.faceUpMonsters(self.controller).some((c) => isMalissLink(c)),
    },
  ],
});

/** 「被除外的場合」的效果在 effects 中的位置 */
const REVIVE_INDEX: Record<number, number> = { 69272449: 2, 96676583: 2, 32061192: 2, 20938824: 2, 68059897: 2, 95454996: 2, 21848500: 1 };
/** AI：這隻碼麗絲怪獸被除外後，這回合還能用③回來（或回收） */
const canComeBack = (d: Duel, c: Card) => {
  const i = REVIVE_INDEX[c.id];
  return i !== undefined && d.p(c.controller).usedNames[`${c.id}:${i}`] !== d.turn && d.p(c.controller).lp > 1500;
};
/** AI：在蓋放的回合發動時，有能回來的怪獸可以除外才划算 */
const setTurnAi = (ctx: EffectContext, base: number) => {
  const d = ctx.duel;
  if (ctx.card.turnPlaced !== d.turn) return base;
  return d.faceUpMonsters(ctx.player).some((c) => isMalissMon(c.data) && canComeBack(d, c)) ? base : 0;
};

/** 碼麗絲的陷阱：也能把自己場上 1 隻表側表示的「碼麗絲」怪獸除外，在蓋放的回合發動 */
const malissSetTurn = (duel: Duel, _card: Card, p: PlayerId) => duel.faceUpMonsters(p).some((c) => isMalissMon(c.data));
async function malissSetTurnCost(ctx: EffectContext) {
  const d = ctx.duel;
  if (ctx.card.turnPlaced !== d.turn) return;
  const c = await d.selectOne({
    player: ctx.player,
    title: '選擇要除外的自己場上的「碼麗絲」怪獸',
    cards: d.faceUpMonsters(ctx.player).filter((c) => isMalissMon(c.data)),
    hint: 'cost',
    aiValue: (x) => (canComeBack(d, x) ? 1000 : 0) + (isLink(x.data) ? -1000 : 300) - cardValue(d, x, ctx.player) / 10,
  });
  if (c) d.banish([c], 'cost', ctx.card);
}
const hasMalissLink = (ctx: EffectContext) => ctx.duel.faceUpMonsters(ctx.player).some(isMalissLink);

// 碼麗絲<代碼>MTP-07
def(94722358, {
  effects: [
    activate({
      once: 'name',
      categories: ['search', 'banish'],
      setTurnActivation: malissSetTurn,
      condition: (ctx) => deckFilter(ctx, isMalissMon).length > 0,
      cost: malissSetTurnCost,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, isMalissMon);
        const cands = d.fieldCards().filter((c) => c !== ctx.card);
        if (!hasMalissLink(ctx) || !cands.length) return;
        if (!(await d.confirm({ player: ctx.player, title: '要再把場上 1 張卡除外嗎？', ai: d.fieldCards(ctx.opp).length > 0 }))) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的卡',
          cards: cands,
          hint: 'harm',
          aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -3000),
        });
        if (c) d.banish([c], 'effect', ctx.card);
      },
      ai: (ctx) => setTurnAi(ctx, 75),
    }),
  ],
});

// 碼麗絲<代碼>GWC-06
def(20726052, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      setTurnActivation: malissSetTurn,
      condition: (ctx) => gwcPool(ctx).length > 0,
      cost: malissSetTurnCost,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = gwcPool(ctx);
        if (!pool.length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「碼麗絲」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        const atk = Math.max(0, c.data.atk);
        if (hasMalissLink(ctx) && atk > 0 && (await d.confirm({ player: ctx.player, title: `要回復 ${atk} 基本分嗎？`, ai: true }))) d.recover(ctx.player, atk);
      },
      ai: (ctx) => setTurnAi(ctx, 75),
    }),
  ],
});
const gwcPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter(
    (c) => isMalissMon(c.data) && canRevive(c) && ctx.duel.freeMZones(ctx.player) > 0,
  );

// 碼麗絲<代碼>TB-11
def(57111661, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      setTurnActivation: malissSetTurn,
      condition: (ctx) =>
        (ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, isMalissMon).length > 0) || tbExtra(ctx).length > 0,
      cost: malissSetTurnCost,
      operation: async (ctx) => {
        const d = ctx.duel;
        const fromDeck = d.freeMZones(ctx.player) > 0 ? deckFilter(ctx, isMalissMon) : [];
        const fromExtra = tbExtra(ctx);
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的「碼麗絲」怪獸',
          cards: [...fromDeck, ...fromExtra],
          hint: 'benefit',
          aiValue: (x) => (x.id === 69272449 ? 400 : isLink(x.data) ? x.data.atk / 10 : 100),
        });
        if (!c) return;
        const wasDeck = c.location === 'deck';
        if (!d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        if (wasDeck) d.shuffleDeck(ctx.player);
        d.setFlag(c, 'cannotAttack');
        d.setFlag(c, 'cannotActivate');
      },
      ai: (ctx) => setTurnAi(ctx, 80),
    }),
  ],
});
const tbExtra = (ctx: EffectContext) =>
  ctx.duel.fieldCards(ctx.opp).length >= 3
    ? ctx.duel.p(ctx.player).extra.filter((c) => isMalissLink(c) && ctx.duel.summonAllowed(ctx.player, c, 'special') && ctx.duel.extraZones(ctx.player, c).length > 0)
    : [];

// 碼麗絲鏡中奇像
def(93453053, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.opp).length > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.faceUpMonsters(ctx.player)].some((c) => isMalissMon(c.data)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), { title: '選擇對方的表側表示怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        const pool = [...d.p(ctx.player).hand, ...d.faceUpMonsters(ctx.player)].filter((c) => isMalissMon(c.data));
        if (!t || !pool.length) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「碼麗絲」怪獸',
          cards: pool,
          hint: 'cost',
          aiValue: (x) => (x.location === 'hand' ? 200 : isLink(x.data) ? -500 : 100),
        });
        if (!c || !d.banish([c], 'effect', ctx.card).length) return;
        if (t.isFaceUpMonster && !d.isImmune(t, ctx.card)) {
          d.setFlag(t, 'negated');
          d.log(`「${t.name}」的效果直到回合結束時無效`);
        }
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp && isMonster(ctx.duel.chainTop.card.data) ? 80 : 0),
    }),
    {
      kind: 'trigger',
      event: 'banished',
      label: '除外墓地的「碼麗絲」卡，相同種類的「碼麗絲」卡從牌組加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'banished' && mirrorTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, mirrorTargets(ctx), { title: '選擇墓地的「碼麗絲」卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.banish([t], 'effect', ctx.card).length) return;
        await searchDeck(ctx, (x) => isMaliss(x) && sameKind(x, t.data));
      },
      ai: () => 85,
    },
  ],
});
const sameKind = (a: CardData, b: CardData) => (isMonster(a) && isMonster(b)) || (isSpell(a) && isSpell(b)) || (isTrap(a) && isTrap(b));
const mirrorTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => isMaliss(c.data) && deckFilter(ctx, (x) => isMaliss(x) && sameKind(x, c.data)).length > 0);

// AI：碼麗絲的王后（連結 3）很強，要先用電子界族的連結 2 怪獸當跳板
for (const id of [68059897, 95454996, 21848500]) extend(id, { aiSummonValue: () => 3800 });
const malissStep = (duel: Duel, card: Card) =>
  duel.faceUpMonsters(card.owner).some((c) => isMalissMon(c.data)) && duel.p(card.owner).extra.some((c) => isMalissLink(c) && c.data.level === 3)
    ? 3200
    : cardValue(duel, card, card.owner);
for (const id of [53413628, 34472920, 59859086]) extend(id, { aiSummonValue: malissStep });
