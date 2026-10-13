// 第二十彈：巳劍、星辰
import type { Card } from '../card';
import { type CardData, RACE, isFusion, isMonster, isRitual, isSpell, isTrap, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, FusionConds, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const sameKind = (a: CardData, b: CardData) => (isMonster(a) && isMonster(b)) || (isSpell(a) && isSpell(b)) || (isTrap(a) && isTrap(b));
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';

// =====================================================================
// 巳劍
// =====================================================================

const MURAKUMO = 19899073;
const FUTSU = 55397172;
const HABAKIRI = 13332685;
const RITUAL_NAMES = [MURAKUMO, FUTSU, HABAKIRI];
const isMitsu = (d: CardData) => d.nameEn.includes('Mitsurugi');
const isMitsuMon = (d: CardData) => isMonster(d) && isMitsu(d);
const isReptile = (d: CardData) => isMonster(d) && (d.race & RACE.REPTILE) !== 0;
const isMitsuRitualSpell = (d: CardData) => isSpell(d) && spellKind(d) === 'ritual' && isMitsu(d);

/** 解放（送去墓地，原因為解放） */
const release = (d: Duel, cards: Card[], by?: Card) => {
  const done = d.sendToGrave(cards, 'tribute', by);
  if (done.length) d.log(`解放 ${done.map((c) => `「${c.name}」`).join('、')}`);
  return done;
};
/** 「這張卡被解放的場合」 */
const releasedSelf = (ctx: EffectContext) =>
  ctx.event?.type === 'toGrave' && ctx.event.card === ctx.card && ctx.event.reason === 'tribute' && ctx.card.location === 'grave';

const lvOf = (d: Duel, c: Card) => (c.location === 'mzone' ? d.getLevel(c) : c.data.level);

interface RitualOpts {
  /** 儀式怪獸從哪裡儀式召喚 */
  from: ('hand' | 'deck' | 'grave')[];
  ritual: (c: Card) => boolean;
  /** 解放的怪獸從哪裡選 */
  tributeFrom: ('hand' | 'field' | 'deck')[];
  tribute: (c: Card) => boolean;
  /** true：等級合計和儀式怪獸相同；false：等級合計以上 */
  exact: boolean;
  maxTributes?: number;
}

function ritualPool(ctx: EffectContext, o: RitualOpts, ritual: Card): Card[] {
  const d = ctx.duel;
  const ps = d.p(ctx.player);
  return [
    ...(o.tributeFrom.includes('hand') ? ps.hand : []),
    ...(o.tributeFrom.includes('field') ? d.faceUpMonsters(ctx.player) : []),
    ...(o.tributeFrom.includes('deck') ? ps.deck : []),
  ].filter((c) => c !== ritual && c !== ctx.card && isMonster(c.data) && lvOf(d, c) > 0 && o.tribute(c));
}

/** 解放的組合是否正確 */
function ritualValid(d: Duel, p: PlayerId, o: RitualOpts, ritual: Card, sel: Card[]): boolean {
  if (!sel.length || (o.maxTributes && sel.length > o.maxTributes)) return false;
  const total = sel.reduce((s, c) => s + lvOf(d, c), 0);
  const level = ritual.data.level;
  if (o.exact ? total !== level : total < level) return false;
  // 「以上」：不能多選不需要的卡
  if (!o.exact && sel.some((x) => total - lvOf(d, x) >= level)) return false;
  return d.freeMZones(p) > 0 || sel.some((c) => c.location === 'mzone');
}

/** 找出 1 組可以解放的怪獸 */
function findRitualSet(d: Duel, p: PlayerId, o: RitualOpts, ritual: Card, pool: Card[]): Card[] | null {
  const max = Math.min(o.maxTributes ?? pool.length, pool.length);
  const chosen: Card[] = [];
  const rec = (i: number): boolean => {
    if (chosen.length && ritualValid(d, p, o, ritual, chosen)) return true;
    if (chosen.length >= max) return false;
    for (let j = i; j < pool.length; j++) {
      chosen.push(pool[j]);
      if (rec(j + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return rec(0) ? [...chosen] : null;
}

function ritualCands(ctx: EffectContext, o: RitualOpts): Card[] {
  const d = ctx.duel;
  const ps = d.p(ctx.player);
  if (d.p(ctx.player).turnFlags.noSpecialSummon || d.playerHas(ctx.player, 'cannotSpecialSummon')) return [];
  return [...(o.from.includes('hand') ? ps.hand : []), ...(o.from.includes('deck') ? ps.deck : []), ...(o.from.includes('grave') ? ps.grave : [])].filter(
    (r) =>
      isRitual(r.data) &&
      o.ritual(r) &&
      d.summonAllowed(ctx.player, r, 'special') &&
      findRitualSet(d, ctx.player, o, r, ritualPool(ctx, o, r)) !== null,
  );
}

/** 儀式召喚（效果處理） */
async function ritualSummon(ctx: EffectContext, o: RitualOpts): Promise<Card | null> {
  const d = ctx.duel;
  const cands = ritualCands(ctx, o);
  if (!cands.length) return null;
  const ritual = await d.selectOne({
    player: ctx.player,
    title: '選擇要儀式召喚的儀式怪獸',
    cards: cands,
    hint: 'benefit',
    aiValue: (c) => (c.id === MURAKUMO && d.monsters(ctx.opp).length ? 3000 : 0) + c.data.atk,
  });
  if (!ritual) return null;
  const pool = ritualPool(ctx, o, ritual);
  const level = ritual.data.level;
  let sel = await d.select({
    player: ctx.player,
    title: `選擇要解放的怪獸（等級合計${o.exact ? '' : '以上'} ${level}${o.maxTributes ? `，最多 ${o.maxTributes} 隻` : ''}）`,
    cards: pool,
    min: 1,
    max: o.maxTributes ?? pool.length,
    hint: 'cost',
    // AI：解放時會發動效果的巳劍怪獸、牌組的卡優先
    aiValue: (c) =>
      (c.location === 'deck' ? 2000 : 0) + (isMitsuMon(c.data) ? 1000 : 0) - (c.location === 'mzone' ? cardValue(d, c, ctx.player) / 2 : 0),
    validate: (s) => ritualValid(d, ctx.player, o, ritual, s),
  });
  if (!ritualValid(d, ctx.player, o, ritual, sel)) sel = findRitualSet(d, ctx.player, o, ritual, pool) ?? [];
  if (!sel.length) return null;
  const fromDeck = ritual.location === 'deck' || sel.some((c) => c.location === 'deck');
  release(d, sel, ctx.card);
  d.log('儀式召喚！');
  if (fromDeck) d.shuffleDeck(ctx.player);
  if (!d.specialSummon(ritual, ctx.player, { position: 'atk', summonType: 'ritual', by: ctx.card })) return null;
  return ritual;
}

/** 儀式怪獸的「這張卡被解放的場合：檢索其他巳劍卡，那之後可以把這張卡特殊召喚」 */
const ritualReleased = (selfId: number): EffectDef => ({
  kind: 'trigger',
  event: 'toGrave',
  label: '從牌組把「巳劍」卡加入手牌，那之後可以特殊召喚這張卡',
  once: 'name',
  categories: ['search', 'summon'],
  condition: (ctx) => releasedSelf(ctx) && deckFilter(ctx, (x) => isMitsu(x) && x.id !== selfId).length > 0,
  operation: async (ctx) => {
    const d = ctx.duel;
    await searchDeck(ctx, (x) => isMitsu(x) && x.id !== selfId);
    if (ctx.card.location !== 'grave' || !canRevive(ctx.card) || d.freeMZones(ctx.player) <= 0) return;
    if (await d.confirm({ player: ctx.player, title: `要特殊召喚「${ctx.card.name}」嗎？`, ai: true }))
      d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
  },
  ai: () => 90,
});

/** 巳劍之尊的②：自己場上其他的爬蟲類族怪獸被破壞時，解放這張卡代替 */
const mikotoSubstitute = (key: string) => (d: Duel, self: Card, destroyed: Card, reason: string) => {
  if (reason !== 'battle' && reason !== 'effect') return null;
  if (destroyed === self || destroyed.location !== 'mzone' || !destroyed.faceUp || destroyed.controller !== self.controller || !isReptile(destroyed.data)) return null;
  if (self.location !== 'mzone' || !self.faceUp || d.p(self.controller).turnFlags[key]) return null;
  return () => {
    d.p(self.controller).turnFlags[key] = true;
    d.log(`解放「${self.name}」代替「${destroyed.name}」的破壞`);
    release(d, [self], self);
  };
};

// 天叢雲之巳劍
def(MURAKUMO, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '對方場上的怪獸全部破壞',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx) && !['normal', 'tribute', 'flip'].includes(ctx.card.summonType ?? '') && ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.monsters(ctx.opp), 'effect', ctx.card);
      },
      ai: () => 95,
    },
    {
      kind: 'quick',
      label: '對方把效果發動時：對方不丟棄 1 張手牌的話，那個效果無效化',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && !top.ctx.data.effectNegated;
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link;
        if (!link) return;
        const hand = d.p(ctx.opp).hand;
        if (hand.length && (await d.confirm({ player: ctx.opp, title: `要丟棄 1 張手牌，讓「${link.card.name}」的效果不被無效嗎？`, ai: hand.length >= 2 }))) {
          const c = await d.selectOne({ player: ctx.opp, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.opp) });
          if (c && d.discard([c], 'effect', ctx.card).length) return;
        }
        d.negateEffect(link);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && cardValue(ctx.duel, top.card, ctx.player) >= 500 ? 75 : 40;
      },
    },
    ritualReleased(MURAKUMO),
  ],
});

// 布都御魂之巳劍
def(FUTSU, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '對方把怪獸特殊召喚：特殊召喚自己墓地 1 隻爬蟲類族怪獸',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.event?.player === ctx.opp &&
        !['normal', 'tribute', 'flip'].includes(ctx.event.summonType ?? 'normal') &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        futsuTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, futsuTargets(ctx), { title: '選擇要特殊召喚的爬蟲類族怪獸', hint: 'benefit', aiValue: (c) => c.data.atk + (isMitsuMon(c.data) ? 500 : 0) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    ritualReleased(FUTSU),
  ],
});
const futsuTargets = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => isReptile(c.data) && c.id !== FUTSU && canRevive(c));

// 天羽羽斬之巳劍
def(HABAKIRI, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的這張卡給對方觀看：從牌組特殊召喚「巳劍」怪獸，那之後自己場上 1 隻怪獸解放',
      range: ['hand'],
      once: 'duel',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, (x, c) => isMitsuMon(x) && canRevive(c)).length > 0,
      cost: async (ctx) => {
        ctx.duel.log(`${ctx.duel.p(ctx.player).name} 給對方觀看「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的「巳劍」怪獸',
          cards: deckFilter(ctx, (x, c) => isMitsuMon(x) && canRevive(c)),
          hint: 'benefit',
          aiValue: (x) => (x.id === 40543231 ? 300 : x.id === 18176525 ? 200 : 100),
        });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        d.shuffleDeck(ctx.player);
        const mons = d.monsters(ctx.player).filter((m) => d.canTribute(m, false));
        if (!mons.length) return;
        const r = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的自己場上的怪獸',
          cards: mons,
          hint: 'cost',
          aiValue: (m) => (isMitsuMon(m.data) && !isRitual(m.data) ? 1000 : 0) - cardValue(d, m, ctx.player),
        });
        if (r) release(d, [r], ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'continuous',
      statMod: (_d, self, t) => (t.controller !== self.controller ? { atk: -800 } : null),
    },
    ritualReleased(HABAKIRI),
  ],
});

/** 巳劍之尊：①召喚・特殊召喚或被解放的場合 */
const mikotoTrigger = (label: string, body: Omit<EffectDef, 'kind' | 'event' | 'label' | 'once'>): EffectDef => ({
  kind: 'trigger',
  event: ['summoned', 'toGrave'],
  label,
  once: 'name',
  ...body,
  condition: (ctx) => (ctx.event?.type === 'summoned' ? summonedSelf(ctx) : releasedSelf(ctx)) && (!body.condition || body.condition(ctx)),
});

// 巳劍之尊 草那藝
def(82782870, {
  fieldSubstitute: mikotoSubstitute('kusanagiSub'),
  effects: [
    mikotoTrigger('墓地・除外的「巳劍」卡加入手牌', {
      categories: ['toHand'],
      condition: (ctx) => kusanagiTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, kusanagiTargets(ctx), {
          title: '選擇要加入手牌的「巳劍」卡',
          hint: 'benefit',
          aiValue: (c) => (isMitsuRitualSpell(c.data) ? 300 : isRitual(c.data) ? 250 : 100),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && (t.location === 'grave' || t.location === 'banished')) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 85,
    }),
  ],
});
const kusanagiTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => isMitsu(c.data) && c.id !== 82782870 && c !== ctx.card);

// 巳劍之尊 佐士
def(18176525, {
  fieldSubstitute: mikotoSubstitute('sajiSub'),
  effects: [
    mikotoTrigger('從牌組把「巳劍」魔法・陷阱卡加入手牌', {
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isMitsu(x)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => (isSpell(x) || isTrap(x)) && isMitsu(x));
      },
      ai: () => 90,
    }),
  ],
});

// 巳劍之尊 麁正
def(40543231, {
  fieldSubstitute: mikotoSubstitute('aramasaSub'),
  effects: [
    mikotoTrigger('從牌組把其他「巳劍」怪獸加入手牌', {
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isMitsuMon(x) && x.id !== 40543231).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isMitsuMon(x) && x.id !== 40543231);
      },
      ai: () => 90,
    }),
  ],
});

// 巳劍之皇子 小碓
def(76948970, {
  spSummon: {
    label: '解放手牌 1 隻其他爬蟲類族怪獸和對方場上 1 隻怪獸：從手牌特殊召喚',
    condition: (duel, card) =>
      !duel.p(card.owner).turnFlags.wousuProc &&
      duel.p(card.owner).hand.some((c) => c !== card && isReptile(c.data)) &&
      duel.monsters(1 - card.owner as PlayerId).some((c) => duel.canTribute(c, false)),
    cost: async (duel, card) => {
      const p = card.owner;
      const opp = (1 - p) as PlayerId;
      duel.p(p).turnFlags.wousuProc = true;
      const mine = await duel.selectOne({
        player: p,
        title: '選擇要解放的手牌的爬蟲類族怪獸',
        cards: duel.p(p).hand.filter((c) => c !== card && isReptile(c.data)),
        hint: 'cost',
        aiValue: (c) => (isMitsuMon(c.data) ? 500 : 0),
      });
      const foe = await duel.selectOne({
        player: p,
        title: '選擇要解放的對方場上的怪獸',
        cards: duel.monsters(opp).filter((c) => duel.canTribute(c, false)),
        hint: 'harm',
        aiValue: (c) => cardValue(duel, c, p),
      });
      release(duel, [mine, foe].filter((c): c is Card => !!c), card);
      duel.addSummonLock(p, { kinds: ['special'], allow: (c) => isReptile(c.data) });
      duel.p(p).activationLocks.push((c) => isReptile(c.data));
    },
    ai: (duel, card) => (duel.monsters(1 - card.owner as PlayerId).some((c) => cardValue(duel, c, card.owner) >= 1500) ? 80 : 0),
  },
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '丟棄 1 張手牌，這張卡加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => releasedSelf(ctx) && ctx.duel.p(ctx.player).hand.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (!c || !d.discard([c], 'effect', ctx.card).length) return;
        if (ctx.card.location === 'grave') d.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 巳劍勸請
def(45171524, {
  effects: [
    activate({
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) => deckFilter(ctx, isMitsuMon).length > 0 || prayerSS(ctx).length > 0 || prayerTributes(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const pool = prayerTributes(ctx);
        if (!pool.length) return;
        if (!(await d.confirm({ player: ctx.player, title: '要解放 1 隻爬蟲類族怪獸來發動（可以兩個效果都適用）嗎？', ai: pool.some((c) => isMitsuMon(c.data) && !isRitual(c.data)) })))
          return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的爬蟲類族怪獸',
          cards: pool,
          hint: 'cost',
          aiValue: (x) => (isMitsuMon(x.data) ? 1000 : 0) - (x.location === 'mzone' ? cardValue(d, x, ctx.player) / 2 : 0),
        });
        if (c) {
          release(d, [c], ctx.card);
          ctx.data.released = true;
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const options = [{ label: '從牌組把「巳劍」怪獸加入手牌', ai: 60 }, { label: '受到 800 傷害，可以特殊召喚手牌・墓地的「巳劍」怪獸', ai: prayerSS(ctx).length ? 50 : 0 }];
        if (ctx.data.released) options.push({ label: '兩方適用', ai: 80 });
        const i = await d.chooseOption({ player: ctx.player, title: '選擇要適用的效果', options });
        if (i === 0 || i === 2) await searchDeck(ctx, isMitsuMon);
        if (i === 1 || i === 2) {
          d.damage(ctx.player, 800, 'effect', ctx.card);
          const pool = prayerSS(ctx);
          if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
          if (!(await d.confirm({ player: ctx.player, title: '要特殊召喚「巳劍」怪獸嗎？', ai: true }))) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「巳劍」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
          if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'cannotDirectAttack', true);
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && inMainPhase(ctx.duel) ? 80 : 0),
    }),
  ],
});
const prayerTributes = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.monsters(ctx.player)].filter((c) => c !== ctx.card && isReptile(c.data) && ctx.duel.canTribute(c, false));
const prayerSS = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter((c) => isMitsuMon(c.data) && canRevive(c));

// 巳劍降臨
const descentDeck: RitualOpts = {
  from: ['deck'],
  ritual: (c) => isReptile(c.data),
  tributeFrom: ['hand', 'field'],
  tribute: (c) => isReptile(c.data),
  exact: true,
};
const descentHand: RitualOpts = {
  from: ['hand'],
  ritual: (c) => isReptile(c.data),
  tributeFrom: ['hand', 'deck', 'field'],
  tribute: (c) => isReptile(c.data),
  exact: true,
  maxTributes: 2,
};
def(81560239, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        (!ctx.duel.p(ctx.player).turnFlags.mitsuDescent1 && ritualCands(ctx, descentDeck).length > 0) ||
        (!ctx.duel.p(ctx.player).turnFlags.mitsuDescent2 && ritualCands(ctx, descentHand).length > 0),
      target: async (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        const a = !ps.turnFlags.mitsuDescent1 && ritualCands(ctx, descentDeck).length > 0;
        const b = !ps.turnFlags.mitsuDescent2 && ritualCands(ctx, descentHand).length > 0;
        const i =
          a && b
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇要發動的效果',
                options: [
                  { label: '解放手牌・場上的爬蟲類族怪獸，從牌組儀式召喚', ai: 60 },
                  { label: '解放手牌・牌組・場上最多 2 隻爬蟲類族怪獸，從手牌儀式召喚', ai: 55 },
                ],
              })
            : a
              ? 0
              : 1;
        ctx.data.mode = i;
        ps.turnFlags[i === 0 ? 'mitsuDescent1' : 'mitsuDescent2'] = true;
      },
      operation: async (ctx) => {
        await ritualSummon(ctx, ctx.data.mode === 0 ? descentDeck : descentHand);
      },
      ai: () => 85,
    }),
  ],
});

// 巳劍之神鏡
const mirrorOpts: RitualOpts = {
  from: ['hand', 'grave'],
  ritual: (c) => isReptile(c.data),
  tributeFrom: ['hand', 'field'],
  tribute: (c) => isReptile(c.data),
  exact: false,
};
def(49721684, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ritualCands(ctx, mirrorOpts).length > 0,
      operation: async (ctx) => {
        await ritualSummon(ctx, mirrorOpts);
      },
      ai: () => 85,
    }),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '這張卡回到牌組',
      range: ['grave'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.reason === 'tribute' &&
        ctx.event.from === 'mzone' &&
        ctx.event.prevController === ctx.player &&
        !!ctx.event.card &&
        RITUAL_NAMES.includes(ctx.event.card.id),
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToDeck([ctx.card], false, 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 巳劍之勾玉
const magatamaRitual: RitualOpts = {
  from: ['hand'],
  ritual: (c) => isMitsu(c.data),
  tributeFrom: ['field'],
  tribute: () => true,
  exact: false,
};
def(76725398, {
  effects: [
    activate({
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => inMainPhase(ctx.duel) && (magatamaDestroyOk(ctx) || ritualCands(ctx, magatamaRitual).length > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const a = magatamaDestroyOk(ctx);
        const b = ritualCands(ctx, magatamaRitual).length > 0;
        const i =
          a && b
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇要發動的效果',
                options: [
                  { label: '解放爬蟲類族怪獸，破壞對方 1 張表側表示卡', ai: d.fieldCards(ctx.opp).some((c) => c.faceUp && cardValue(d, c, ctx.player) >= 1500) ? 70 : 20 },
                  { label: '解放自己場上的怪獸，從手牌儀式召喚「巳劍」儀式怪獸', ai: 60 },
                ],
              })
            : a
              ? 0
              : 1;
        ctx.data.mode = i;
        if (i === 0) {
          const c = await d.selectOne({
            player: ctx.player,
            title: '選擇要解放的爬蟲類族怪獸',
            cards: d.monsters(ctx.player).filter((c) => c.faceUp && isReptile(c.data) && d.canTribute(c, false)),
            hint: 'cost',
            aiValue: (x) => (isMitsuMon(x.data) && !isRitual(x.data) ? 1000 : 0) - cardValue(d, x, ctx.player),
          });
          if (c) release(d, [c], ctx.card);
        }
      },
      target: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode !== 0) return;
        await chooseTargets(ctx, d.fieldCards(ctx.opp).filter((c) => c.faceUp), { title: '選擇要破壞的對方的表側表示卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        if (ctx.data.mode === 0) {
          const t = tgt(ctx);
          if (t?.onField && t.faceUp) await ctx.duel.destroy([t], 'effect', ctx.card);
        } else await ritualSummon(ctx, magatamaRitual);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (ritualCands(ctx, magatamaRitual).length && d.turnPlayer === ctx.player) return 80;
        return magatamaDestroyOk(ctx) && d.fieldCards(ctx.opp).some((c) => c.faceUp && cardValue(d, c, ctx.player) >= 1500) ? 70 : 0;
      },
    }),
  ],
});
const magatamaDestroyOk = (ctx: EffectContext) =>
  ctx.duel.monsters(ctx.player).some((c) => c.faceUp && isReptile(c.data) && ctx.duel.canTribute(c, false)) && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp);

// 巳劍之磐境
def(12210097, {
  effects: [
    activate({ ai: () => 70 }),
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'untargetableByOppExtraMonsters' && !!t && t.controller === self.controller && isRitual(t.data) && isMitsu(t.data),
    },
    {
      kind: 'ignition',
      label: '墓地 4 張「巳劍」卡回到牌組，對方必須把自身場上 1 隻怪獸解放',
      range: ['szone'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.card.faceUp && boundaryTargets(ctx).length >= 4,
      target: async (ctx) => {
        await chooseTargets(ctx, boundaryTargets(ctx), { title: '選擇 4 張「巳劍」卡', min: 4, max: 4, hint: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length < 4) return;
        d.returnToDeck(ts, false, 'effect', ctx.card);
        const foes = d.monsters(ctx.opp).filter((c) => d.canTribute(c, false));
        if (!foes.length) return;
        const c = await d.selectOne({ player: ctx.opp, title: '選擇要解放的自己場上的怪獸', cards: foes, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.opp) });
        if (c) release(d, [c], ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 75 : 20),
    },
  ],
});
const boundaryTargets = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => isMitsu(c.data) && c.id !== 12210097);

// 八雲斷巳劍
def(49604192, {
  effects: [
    activate({
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isMitsuRitualSpell(c.data)) && tempestSet(ctx) !== null,
      cost: async (ctx) => {
        const set = tempestSet(ctx);
        if (set) release(ctx.duel, set, ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const opp = ctx.opp;
        const pool = [...d.p(opp).hand, ...d.p(opp).extra, ...d.fieldCards(opp), ...d.p(opp).grave];
        const n = Math.min(8, pool.length);
        if (!n) return;
        const sel = await d.select({ player: opp, title: `選擇合計 ${n} 張要除外的卡`, cards: pool, min: n, max: n, hint: 'cost', aiValue: (x) => -cardValue(d, x, opp) });
        d.banish(sel, 'effect', ctx.card);
      },
      ai: () => 90,
    }),
  ],
});
/** 原本卡名是天叢雲・布都御魂・天羽羽斬的自己場上的怪獸各 1 隻 */
const tempestSet = (ctx: EffectContext): Card[] | null => {
  const d = ctx.duel;
  const out: Card[] = [];
  for (const id of RITUAL_NAMES) {
    const c = d.monsters(ctx.player).find((m) => m.id === id && d.canTribute(m, false));
    if (!c) return null;
    out.push(c);
  }
  return out;
};

// 巳劍大祓
def(17954937, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && purifyTributes(ctx).length > 0;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的 5 星以上的爬蟲類族怪獸', cards: purifyTributes(ctx), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) release(d, [c], ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link;
        if (!link) return;
        d.negateEffect(link);
        if (link.ctx.data.effectNegated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && cardValue(ctx.duel, top.card, ctx.player) >= 1000 ? 80 : 0;
      },
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：特殊召喚墓地的爬蟲類族怪獸，那之後解放自己場上 1 隻其他怪獸',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isReptile(c.data) && canRevive(c)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isReptile(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的爬蟲類族怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk + (isRitual(c.data) ? 1000 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) return;
        const others = d.monsters(ctx.player).filter((c) => c !== t && d.canTribute(c, false));
        if (!others.length) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的自己場上的怪獸',
          cards: others,
          hint: 'cost',
          aiValue: (x) => (isMitsuMon(x.data) && !isRitual(x.data) ? 1000 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) release(d, [c], ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).grave.some((c) => isRitual(c.data) && isReptile(c.data) && canRevive(c)) ? 75 : 30),
    },
  ],
});
const purifyTributes = (ctx: EffectContext) =>
  ctx.duel.monsters(ctx.player).filter((c) => c.faceUp && isReptile(c.data) && ctx.duel.getLevel(c) >= 5 && ctx.duel.canTribute(c, false));

// =====================================================================
// 星辰
// =====================================================================

const isDraco = (d: CardData) => d.nameEn.includes('Dracotail');
const isDracoMon = (d: CardData) => isMonster(d) && isDraco(d);
const isDracoST = (d: CardData) => (isSpell(d) || isTrap(d)) && isDraco(d);
const isDragonOrCaster = (d: CardData) => isMonster(d) && (d.race & (RACE.DRAGON | RACE.SPELLCASTER)) !== 0;
/** 融合素材：手牌的怪獸 */
const handMon = (d: CardData, c?: Card) => isMonster(d) && (!c || c.location === 'hand');
const handFieldPool = (ctx: EffectContext) => [
  ...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)),
  ...ctx.duel.faceUpMonsters(ctx.player),
];
const lockFusionOnly = (d: Duel, p: PlayerId) => d.addSummonLock(p, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isFusion(c.data) });

/** 「這張卡成為融合召喚的素材送去墓地的場合：從牌組把『星辰』魔法・陷阱在自己場上蓋放」（那之後的追加處理） */
const dracoSet = (label: string, after?: (ctx: EffectContext) => Promise<void>): EffectDef => ({
  kind: 'trigger',
  event: 'toGrave',
  label,
  once: 'name',
  categories: ['search'],
  condition: (ctx) =>
    ctx.event?.card === ctx.card && ctx.event.asFusion === true && ctx.card.location === 'grave' && ctx.duel.freeSZones(ctx.player) > 0 && deckFilter(ctx, isDracoST).length > 0,
  operation: async (ctx) => {
    const d = ctx.duel;
    if (d.freeSZones(ctx.player) <= 0) return;
    const c = await d.selectOne({
      player: ctx.player,
      title: '選擇要蓋放的「星辰」魔法・陷阱',
      cards: deckFilter(ctx, isDracoST),
      hint: 'benefit',
      aiValue: (x) => (isTrap(x.data) ? 200 : 0) + (x.id === 69932023 ? 100 : 0),
    });
    if (!c) return;
    d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
    c.turnPlaced = d.turn;
    d.shuffleDeck(ctx.player);
    d.log(`「${c.name}」在場上蓋放`);
    if (after) await after(ctx);
  },
  ai: () => 90,
});

/** 星辰的融合怪獸②：怪獸 2 隻以上同時被送去墓地的場合，從墓地特殊召喚（離場時除外） */
const dracoRevive = (): EffectDef => ({
  kind: 'trigger',
  event: 'toGraveMulti',
  label: '從墓地特殊召喚這張卡',
  range: ['grave'],
  once: 'name',
  categories: ['summon'],
  condition: (ctx) =>
    ctx.card.location === 'grave' && !(ctx.event?.cards ?? []).includes(ctx.card) && canRevive(ctx.card) && ctx.duel.freeMZones(ctx.player) > 0,
  operation: async (ctx) => {
    const d = ctx.duel;
    if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
  },
  ai: () => 85,
});

/** 「『XX』以外的自己的墓地・除外狀態的 1 張『星辰』卡回到牌組最下面，那之後抽 1 張」（可以適用） */
async function dracoRecycle(ctx: EffectContext, selfId: number) {
  const d = ctx.duel;
  const pool = [...d.p(ctx.player).grave, ...d.p(ctx.player).banished].filter((c) => isDraco(c.data) && c.id !== selfId);
  if (!pool.length || !(await d.confirm({ player: ctx.player, title: '要讓 1 張「星辰」卡回到牌組最下面，抽 1 張嗎？', ai: true }))) return;
  const c = await d.selectOne({ player: ctx.player, title: '選擇要回到牌組最下面的「星辰」卡', cards: pool, hint: 'benefit', aiValue: (x) => (x.location === 'banished' ? 100 : 0) });
  if (c && d.returnToDeck([c], false, 'effect', ctx.card).length) d.draw(ctx.player, 1);
}

// 星辰槍手 巨蟹魔
def(75003700, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把其他「星辰」怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => isDracoMon(x) && x.id !== 75003700).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isDracoMon(x) && x.id !== 75003700);
      },
      ai: () => 90,
    },
    dracoSet('成為融合素材：從牌組把「星辰」魔法・陷阱在自己場上蓋放'),
  ],
});

// 星辰炮手 寶瓶魔
def(1498449, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：用手牌・場上的怪獸融合召喚龍族・魔法師族融合怪獸',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => inMainPhase(ctx.duel) && fusionTargets(ctx.duel, ctx.player, faimenaOpts(ctx)).length > 0,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await fusionSummon(ctx, faimenaOpts(ctx));
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 85 : 60),
    },
    dracoSet('成為融合素材：從牌組把「星辰」魔法・陷阱在自己場上蓋放'),
  ],
});
const faimenaOpts = (ctx: EffectContext) => ({ pool: handFieldPool(ctx), filter: (f: Card) => isDragonOrCaster(f.data) });

// 星辰龍 摩羯龍
def(44482554, {
  effects: [
    dracoSet('成為融合素材：從牌組把「星辰」魔法・陷阱蓋放，那之後可以破壞場上 1 隻怪獸', async (ctx) => {
      const d = ctx.duel;
      const mons = d.monsters();
      if (!mons.length || !(await d.confirm({ player: ctx.player, title: '要破壞場上 1 隻怪獸嗎？', ai: d.monsters(ctx.opp).length > 0 }))) return;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: mons, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -5000) });
      if (c) await d.destroy([c], 'effect', ctx.card);
    }),
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '這張卡回到牌組最下面，從墓地特殊召喚「星辰」怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.card !== ctx.card &&
        ctx.event?.reason === 'effect' &&
        ctx.event.from === 'mzone' &&
        ctx.event.wasFaceUp === true &&
        ctx.event.prevController === ctx.player &&
        !!ctx.event.card &&
        isFusion(ctx.event.card.data) &&
        !!ctx.event.by &&
        (ctx.event.by.onField ? ctx.event.by.controller : ctx.event.by.owner) === ctx.opp &&
        ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isDracoMon(c.data) && !isFusion(c.data) && canRevive(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        const pool = d.p(ctx.player).grave.filter((c) => isDracoMon(c.data) && !isFusion(c.data) && canRevive(c));
        if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「星辰」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
  ],
});

// 星辰龍 獅子龍
def(70871153, {
  effects: [
    dracoSet('成為融合素材：從牌組把「星辰」魔法・陷阱蓋放，那之後可以破壞場上 1 張魔法・陷阱卡', async (ctx) => {
      const d = ctx.duel;
      const sts = d.spellTraps();
      if (!sts.length || !(await d.confirm({ player: ctx.player, title: '要破壞場上 1 張魔法・陷阱卡嗎？', ai: d.spellTraps(ctx.opp).length > 0 }))) return;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的魔法・陷阱卡', cards: sts, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? 500 + cardValue(d, x, ctx.player) : -5000) });
      if (c) await d.destroy([c], 'effect', ctx.card);
    }),
    {
      kind: 'ignition',
      label: '這張卡回到牌組最下面，墓地的魔法師族「星辰」怪獸加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => urgulaTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, urgulaTargets(ctx), { title: '選擇魔法師族「星辰」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (ctx.card.location !== 'grave' || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        if (t?.location === 'grave') d.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});
const urgulaTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isDracoMon(c.data) && (c.data.race & RACE.SPELLCASTER) !== 0);

// 星辰龍 天蠍龍
def(7375867, {
  effects: [
    {
      kind: 'quick',
      label: '用手牌・場上的怪獸融合召喚「星辰」融合怪獸',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) =>
        inMainPhase(ctx.duel) &&
        (ctx.card.location === 'hand' ? false : ctx.card.isFaceUpMonster) &&
        fusionTargets(ctx.duel, ctx.player, mululuOpts(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        lockFusionOnly(d, ctx.player);
        await fusionSummon(ctx, mululuOpts(ctx));
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 85 : 60),
    },
    dracoSet('成為融合素材：從牌組把「星辰」魔法・陷阱蓋放，那之後可以讓對方 1 隻表側表示怪獸的效果無效', async (ctx) => {
      const d = ctx.duel;
      const foes = d.faceUpMonsters(ctx.opp);
      if (!foes.length || !(await d.confirm({ player: ctx.player, title: '要讓對方 1 隻表側表示怪獸的效果無效嗎？', ai: true }))) return;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要讓效果無效的怪獸', cards: foes, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
      if (c && !d.isImmune(c, ctx.card)) {
        d.setFlag(c, 'negated', true);
        d.log(`「${c.name}」的效果無效`);
      }
    }),
  ],
});
const mululuOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: (f: Card) => isDraco(f.data),
});

// 星辰響手 金牛魔
def(84477320, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚墓地的「星辰」怪獸，那之後自己場上 1 隻怪獸回到手牌',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && phryxulTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, phryxulTargets(ctx), { title: '選擇要特殊召喚的「星辰」怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) return;
        const mons = d.monsters(ctx.player);
        if (!mons.length) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要回到手牌的自己場上的怪獸',
          cards: mons,
          hint: 'cost',
          aiValue: (x) => (x === ctx.card ? 500 : 0) - cardValue(d, x, ctx.player) / 10,
        });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    dracoSet('成為融合素材：從牌組把「星辰」魔法・陷阱在自己場上蓋放'),
  ],
});
const phryxulTargets = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => isDracoMon(c.data) && c.id !== 84477320 && canRevive(c));

// 星辰爪龍 巨蟹摩羯龍魔
def(33760966, {
  fusion: Object.assign([isDracoMon, handMon] as FusionConds, { more: handMon }),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '最多作為融合素材的手牌的怪獸數量的場上・墓地的怪獸回到手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && arthalionTargets(ctx).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const n = Math.max(1, Number(ctx.card.flags.handMaterials ?? 1));
        await chooseTargets(ctx, arthalionTargets(ctx), {
          title: `選擇最多 ${n} 隻要回到手牌的怪獸`,
          max: n,
          aiValue: (c) => (c.controller === ctx.opp && c.onField ? cardValue(d, c, ctx.player) + 500 : c.owner === ctx.player && !c.onField ? 300 : -3000),
        });
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.location === 'mzone' || c.location === 'grave');
        if (ts.length) ctx.duel.returnToHand(ts, 'effect', ctx.card);
      },
      ai: () => 85,
    },
    dracoRevive(),
  ],
});
const arthalionTargets = (ctx: EffectContext) =>
  [...ctx.duel.monsters(), ...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter((c) => c !== ctx.card && isMonster(c.data));

// 星辰法宮 獅子寶瓶龍魔
def(79755671, {
  fusion: [isDracoMon, handMon],
  effects: [
    {
      kind: 'trigger',
      event: 'activated',
      label: '自己把「星辰」卡的效果發動時：破壞對方場上 1 張卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => {
        const link = ctx.event?.link;
        return ctx.card.isFaceUpMonster && !!link && link.player === ctx.player && isDraco(link.card.data) && ctx.duel.fieldCards(ctx.opp).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp), { title: '選擇要破壞的對方的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    dracoRevive(),
  ],
});

// 星辰鋏龍 天蠍金牛龍魔
def(42125140, {
  fusion: [isDracoMon, handMon],
  effects: [
    {
      kind: 'ignition',
      label: '墓地 2 張「星辰」卡和場上 1 張相同種類的表側表示卡回到牌組',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.card.isFaceUpMonster && shaulasField(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isDraco(c.data))).length > 0 && shaulasGrave(ctx).length >= 2,
      target: async (ctx) => {
        const d = ctx.duel;
        const two = await d.select({
          player: ctx.player,
          title: '選擇墓地 2 張「星辰」卡',
          cards: shaulasGrave(ctx),
          min: 2,
          max: 2,
          hint: 'cost',
          validate: (s) => s.length === 2 && shaulasField(ctx, s).length > 0,
        });
        if (two.length < 2) return;
        const field = await d.select({
          player: ctx.player,
          title: '選擇場上 1 張表側表示卡',
          cards: shaulasField(ctx, two),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
        d.setTargets(ctx, [...two, ...field]);
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.location === 'grave' || c.onField);
        if (ts.length) ctx.duel.returnToDeck(ts, false, 'effect', ctx.card);
      },
      ai: (ctx) => (shaulasField(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isDraco(c.data))).some((c) => c.controller === ctx.opp) ? 80 : 0),
    },
    dracoRevive(),
  ],
});
const shaulasGrave = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => isDraco(c.data));
const shaulasField = (ctx: EffectContext, picked: Card[]) =>
  ctx.duel
    .fieldCards()
    .filter(
      (c) =>
        c.faceUp &&
        picked.some((g) => sameKind(g.data, c.data)) &&
        !ctx.duel.has(c, 'untargetable') &&
        !(c.controller !== ctx.player && ctx.duel.has(c, 'untargetableByOpp')),
    );

// 計都星辰
def(6153210, {
  effects: [
    activate({
      once: 'name',
      categories: ['search', 'summon', 'fusion'],
      condition: (ctx) => deckFilter(ctx, isDracoMon).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, isDracoMon);
        if (!d.monsters(ctx.opp).length) return;
        const opts = { pool: handFieldPool(ctx), filter: (f: Card) => isDragonOrCaster(f.data) };
        if (!fusionTargets(d, ctx.player, opts).length) return;
        if (await d.confirm({ player: ctx.player, title: '要再融合召喚龍族・魔法師族融合怪獸嗎？', ai: true })) await fusionSummon(ctx, opts);
      },
      ai: () => 90,
    }),
  ],
});

// 羅睺星辰
def(32548318, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, rahuOpts(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await fusionSummon(ctx, rahuOpts(ctx));
        lockFusionOnly(d, ctx.player);
      },
      ai: () => 90,
    }),
  ],
});
const rahuOpts = (ctx: EffectContext) => ({
  pool: [...handFieldPool(ctx), ...ctx.duel.p(ctx.player).deck.filter((c) => isMonster(c.data))],
  filter: (f: Card) => isDraco(f.data),
});

// 星辰的裂角
def(69932023, {
  effects: [
    activate({
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.monsters().some((c) => c.faceUp && c.position === 'atk'),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters().filter((c) => c.faceUp && c.position === 'atk'), {
          title: '選擇攻擊表示怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.returnToHand([t], 'effect', ctx.card).length) return;
        await dracoRecycle(ctx, 69932023);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => c.faceUp && c.position === 'atk' && cardValue(ctx.duel, c, ctx.player) >= 1500) ? 75 : 0),
    }),
  ],
});

// 星辰的吼炎
def(5431722, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.duel.spellTraps().some((c) => c.faceUp && isSpell(c.data)) || (ctx.duel.p(0).fzone?.faceUp ?? false) || (ctx.duel.p(1).fzone?.faceUp ?? false),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp && isSpell(c.data) && c !== ctx.card), {
          title: '選擇表側表示的魔法卡',
          aiValue: (c) => (c.controller === ctx.opp ? 1000 + cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !t.faceUp || d.isImmune(t, ctx.card)) return;
        d.setFlag(t, 'negated');
        d.log(`「${t.name}」的效果直到回合結束時無效`);
        await dracoRecycle(ctx, 5431722);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp && isSpell(c.data)) ? 70 : 0),
    }),
  ],
});

// 星辰的刺毒
def(80208225, {
  effects: [
    activate({
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(ctx.opp).grave.length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const grave = d.p(ctx.opp).grave;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇對方墓地的怪獸和魔法・陷阱卡各最多 1 張',
          cards: grave,
          min: 1,
          max: 2,
          hint: 'harm',
          aiValue: (c) => cardValue(d, c, ctx.player),
          validate: (s) => s.filter((c) => isMonster(c.data)).length <= 1 && s.filter((c) => !isMonster(c.data)).length <= 1,
        });
        d.setTargets(ctx, sel);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length) d.banish(ts, 'effect', ctx.card);
        await dracoRecycle(ctx, 80208225);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.p(ctx.opp).grave.some((c) => cardValue(ctx.duel, c, ctx.player) >= 1500) ? 60 : 0),
    }),
  ],
});
