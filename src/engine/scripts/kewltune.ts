// 第二十六彈：殺手級調整曲（Kewl Tune）
import type { Card } from '../card';
import { type CardData, ATTR, isMonster, isSpell, isSynchro, isTrap, isTuner } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt } from './lib';

const RECO = 89392810;
const CUE = 16387555;
const MIX = 16509007;
const ROTARY = 17209452;
const CLIP = 43904702;
const JJ = 14442329;
const KT_SYNCHRO = 78058681;
const B2B = 65961304;
const TRACK_MAKER = 42781164;
const RS = 15665977;
const REMIX = 88170262;
const LOUDNESS = 41069676;
const CRACKLE = 39576656;
const PLAYLIST = 40847034;
const ZALEN = 4891376;

const isKT = (d: CardData) => d.name.includes('殺手級調整曲');
const isKTMonster = (d: CardData) => isKT(d) && isMonster(d);
const tunerCard = (c: Card) => isMonster(c.data) && isTuner(c.data);
const isSynchroTuner = (c: Card) => isSynchro(c.data) && isTuner(c.data);
const other = (p: PlayerId) => (p === 0 ? 1 : 0) as PlayerId;

/** 這回合自己不是調整不能特殊召喚 */
const lockTunerOnly = (d: Duel, p: PlayerId) => d.addSummonLock(p, { kinds: ['special'], allow: (c) => tunerCard(c) });

/** 作為同步素材送去墓地 */
const asSynchroMaterial = (ctx: EffectContext) =>
  ctx.event?.card === ctx.card && !!ctx.event.asSynchro && ctx.card.location === 'grave';

/** 對方的場上或墓地有調整存在 */
const oppHasTuner = (d: Duel, p: PlayerId) => [...d.faceUpMonsters(other(p)), ...d.p(other(p)).grave].some(tunerCard);

/** 可以用效果同步召喚的同步怪獸調整 */
const synchroTunerCands = (d: Duel, p: PlayerId) => d.synchroCandidates(p).filter(isSynchroTuner);

/** 「那之後，可以進行 1 隻同步怪獸調整的同步召喚」 */
async function maybeSynchroTuner(d: Duel, p: PlayerId, anySynchro = false) {
  const cands = anySynchro ? d.synchroCandidates(p) : synchroTunerCands(d, p);
  if (!cands.length || !(await d.confirm({ player: p, title: '要進行同步召喚嗎？', ai: true }))) return;
  const s = await d.selectOne({ player: p, title: '選擇要同步召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => synchroPref(x) });
  if (s) await d.synchroSummonByEffect(p, s);
}
/** AI 同步召喚的偏好 */
const synchroPref = (c: Card) =>
  ({ [B2B]: 5000, [LOUDNESS]: 4200, [TRACK_MAKER]: 4100, [ZALEN]: 4000, [RS]: 3600, [CRACKLE]: 3500, [REMIX]: 3400 })[c.id] ?? c.data.atk;

/** 對方的額外牌組的卡直到結束階段表側表示除外 */
function banishExtraUntilEnd(d: Duel, cards: Card[], by: Card) {
  const done = d.banish(cards, 'effect', by);
  for (const c of done) {
    const stint = c.stint;
    d.delayed.push({ turn: d.turn, run: () => void (c.location === 'banished' && c.stint === stint && d.returnToDeck([c], false, 'effect')) });
  }
  return done;
}

// =====================================================================
// 「作為同步素材送去墓地的場合」的效果（響度戰爭・播放列表可以適用）
// =====================================================================
interface MatFx {
  label: string;
  /** 以卡為對象的效果：可以選的卡 */
  pool?: (d: Duel, p: PlayerId) => Card[];
  poolTitle?: string;
  can?: (d: Duel, p: PlayerId) => boolean;
  run: (d: Duel, p: PlayerId, by: Card, target: Card | undefined) => Promise<void>;
}
const MAT_FX: Record<number, MatFx> = {
  [RECO]: {
    label: '對方場上 1 張魔法・陷阱卡破壞',
    pool: (d, p) => [...d.p(other(p)).szone, d.p(other(p)).fzone].filter((c): c is Card => !!c),
    poolTitle: '選擇要破壞的對方的魔法・陷阱卡',
    run: async (d, _p, by, t) => {
      if (t?.onField) await d.destroy([t], 'effect', by);
    },
  },
  [CUE]: {
    label: '把對方牌組上面 2 張翻開，1 張除外，另 1 張回到牌組最上面或最下面',
    can: (d, p) => d.p(other(p)).deck.length > 0,
    run: async (d, p, by) => {
      const top = d.p(other(p)).deck.slice(0, 2);
      if (!top.length) return;
      d.log(`翻開 ${top.map((c) => `「${c.name}」`).join('、')}`);
      const ban = top.length === 1 ? top[0] : await d.selectOne({ player: p, title: '選擇要除外的卡', cards: top, hint: 'harm', aiValue: (c) => cardValue(d, c, p) });
      if (ban) d.banish([ban], 'effect', by);
      const rest = top.find((c) => c !== ban && c.location === 'deck');
      if (!rest) return;
      const i = await d.chooseOption({
        player: p,
        title: `「${rest.name}」要放回哪裡？`,
        options: [
          { label: '牌組最上面', ai: cardValue(d, rest, p) < 1500 ? 60 : 10 },
          { label: '牌組最下面', ai: 40 },
        ],
      });
      const deck = d.p(other(p)).deck;
      deck.splice(deck.indexOf(rest), 1);
      if (i === 0) deck.unshift(rest);
      else deck.push(rest);
    },
  },
  [MIX]: {
    label: '對方場上 1 隻怪獸破壞',
    pool: (d, p) => d.monsters(other(p)),
    poolTitle: '選擇要破壞的對方的怪獸',
    run: async (d, _p, by, t) => {
      if (t?.onField) await d.destroy([t], 'effect', by);
    },
  },
  [ROTARY]: {
    label: '對方墓地 1 張卡回到牌組最下面，或確認對方手牌並把「殺手級調整曲」魔法・陷阱卡加入手牌',
    can: (d, p) => d.p(other(p)).grave.length > 0 || d.p(other(p)).hand.length > 0,
    run: async (d, p, by) => {
      const opp = other(p);
      const i = await d.chooseOption({
        player: p,
        title: '選擇要發動的效果',
        options: [
          { label: '從對方墓地讓 1 張卡回到牌組最下面', ai: d.p(opp).grave.length ? 40 : -1 },
          { label: '確認對方手牌，從牌組把「殺手級調整曲」魔法・陷阱卡加入手牌', ai: d.p(p).deck.some((c) => isKT(c.data) && !isMonster(c.data)) ? 70 : 20 },
        ],
      });
      if (i === 0 && d.p(opp).grave.length) {
        const c = await d.selectOne({ player: p, title: '選擇要回到牌組最下面的卡', cards: d.p(opp).grave, hint: 'harm', aiValue: (x) => cardValue(d, x, p) });
        if (c) d.moveTo(c, 'deck', { reason: 'effect', by, top: false });
        return;
      }
      d.log(`確認對方手牌：${d.p(opp).hand.map((c) => `「${c.name}」`).join('、') || '（沒有）'}`);
      const pool = d.p(p).deck.filter((c) => isKT(c.data) && !isMonster(c.data));
      if (!pool.length || !(await d.confirm({ player: p, title: '要從牌組把「殺手級調整曲」魔法・陷阱卡加入手牌嗎？', ai: true }))) return;
      const c = await d.selectOne({ player: p, title: '選擇要加入手牌的卡', cards: pool, hint: 'benefit' });
      if (c) d.addToHandFromDeck(c, by);
    },
  },
  [CLIP]: {
    label: '對方的額外牌組的裡側的卡隨機 1 張除外',
    can: (d, p) => d.p(other(p)).extra.some((c) => !c.faceUp),
    run: async (d, p, by) => {
      const fd = d.p(other(p)).extra.filter((c) => !c.faceUp);
      if (!fd.length) return;
      d.banish([fd[Math.floor(d.rng() * fd.length)]], 'effect', by);
    },
  },
  [TRACK_MAKER]: {
    label: '對方場上 1 張卡回到手牌',
    can: (d, p) => d.fieldCards(other(p)).length > 0,
    run: async (d, p, by) => {
      const c = await d.selectOne({ player: p, title: '選擇要回到手牌的對方的卡', cards: d.fieldCards(other(p)), hint: 'harm', aiValue: (x) => cardValue(d, x, p) });
      if (c) d.returnToHand([c], 'effect', by);
    },
  },
};
const matFxUsable = (d: Duel, p: PlayerId, id: number) => {
  const fx = MAT_FX[id];
  if (!fx) return false;
  if (fx.pool) return fx.pool(d, p).length > 0;
  return fx.can?.(d, p) ?? true;
};
/** 適用（不發動）「作為同步素材送去墓地的場合」的效果 */
async function applyMatFx(d: Duel, p: PlayerId, id: number, by: Card) {
  const fx = MAT_FX[id];
  if (!fx) return;
  d.log(`適用「${by.name}」以外的卡的效果：${fx.label}`);
  let t: Card | undefined;
  if (fx.pool) {
    const pool = fx.pool(d, p);
    if (!pool.length) return;
    t = (await d.selectOne({ player: p, title: fx.poolTitle ?? '選擇卡', cards: pool, hint: 'harm', aiValue: (c) => cardValue(d, c, p) })) ?? undefined;
  }
  await fx.run(d, p, by, t);
}
/** 這張卡作為同步素材送去墓地的場合的誘發效果 */
function matTrigger(id: number): EffectDef {
  const fx = MAT_FX[id];
  return {
    kind: 'trigger',
    event: 'toGrave',
    label: `作為同步素材送去墓地：${fx.label}`,
    once: 'name',
    categories: ['destroy'],
    condition: (ctx) => asSynchroMaterial(ctx) && matFxUsable(ctx.duel, ctx.player, id),
    target: fx.pool
      ? async (ctx) => {
          await chooseTargets(ctx, fx.pool!(ctx.duel, ctx.player), { title: fx.poolTitle ?? '選擇卡', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
        }
      : undefined,
    operation: async (ctx) => {
      const t = fx.pool ? tgt(ctx) : undefined;
      if (fx.pool && !t?.onField) return;
      await fx.run(ctx.duel, ctx.player, ctx.card, t);
    },
    ai: () => 85,
  };
}

/** 「從自己的卡組・墓地把○星怪獸以外的 1 隻『殺手級調整曲』怪獸加入手牌」 */
function searchKTExceptLevel(level: number): EffectDef {
  const pool = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isKTMonster(c.data) && c.data.level !== level);
  return {
    kind: 'trigger',
    event: 'summoned',
    label: `召喚・特殊召喚：從牌組・墓地把 ${level} 星以外的「殺手級調整曲」怪獸加入手牌`,
    once: 'name',
    categories: ['search'],
    condition: (ctx) => summonedSelf(ctx) && pool(ctx).length > 0,
    operation: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「殺手級調整曲」怪獸', cards: pool(ctx), hint: 'benefit', aiValue: (x) => ktHandValue(d, ctx.player, x) });
      if (!c) return;
      if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
      else d.returnToHand([c], 'effect', ctx.card);
    },
    ai: () => 90,
  };
}
/** AI：要加入手牌的「殺手級調整曲」怪獸 */
const ktHandValue = (d: Duel, p: PlayerId, c: Card) => {
  const hand = d.p(p).hand;
  const base = { [CUE]: 90, [ROTARY]: 70, [CLIP]: 80, [MIX]: 60, [RECO]: 60 }[c.id] ?? 30;
  return base - (hand.some((h) => h.id === c.id) ? 50 : 0) + (c.location === 'grave' ? 5 : 0);
};

// 殺手級調整曲・唱片師
def(RECO, { handTunerMaterial: true, effects: [searchKTExceptLevel(3), matTrigger(RECO)] });
// 殺手級調整曲・混音手
def(MIX, { handTunerMaterial: true, effects: [searchKTExceptLevel(2), matTrigger(MIX)] });

// 殺手級調整曲・提示員
const cuePool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => tunerCard(c) && c.id !== CUE && !isSynchro(c.data) && canRevive(c));
def(CUE, {
  handTunerMaterial: true,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚：從手牌・牌組・墓地把「殺手級調整曲・提示員」以外的 1 隻調整特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx, ['normal', 'tribute']) && ctx.duel.freeMZones(ctx.player) > 0 && cuePool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        lockTunerOnly(d, ctx.player);
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的調整', cards: cuePool(ctx), hint: 'benefit', aiValue: (x) => ktHandValue(d, ctx.player, x) });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 95,
    },
    matTrigger(CUE),
  ],
});

// 殺手級調整曲・旋鈕手
def(ROTARY, {
  handTunerMaterial: true,
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的這張卡和 1 隻調整給對方觀看：進行 1 隻調整的召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const hand = d.p(ctx.player).hand;
        return hand.some((c) => c !== ctx.card && tunerCard(c)) && hand.some((c) => tunerCard(c) && d.summonAllowed(ctx.player, c, 'normal') && d.tributesNeeded(c) === 0) && d.freeMZones(ctx.player) > 0;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要給對方觀看的調整', cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card && tunerCard(c)), hint: 'cost' });
        d.log(`給對方觀看「${ctx.card.name}」${c ? `和「${c.name}」` : ''}`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).hand.filter((c) => tunerCard(c) && d.summonAllowed(ctx.player, c, 'normal'));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要召喚的調整', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === CUE ? 100 : x.id === ROTARY ? 10 : 50) });
        if (c) await d.normalSummonByEffect(ctx.player, c);
      },
      ai: () => 88,
    },
    matTrigger(ROTARY),
  ],
});

// 殺手級調整曲・削波手
def(CLIP, {
  handTunerMaterial: true,
  effects: [
    {
      kind: 'quick',
      label: '對方主要階段：這張卡從手牌特殊召喚，那之後可以進行 1 隻同步怪獸調整的同步召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp && (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        await maybeSynchroTuner(d, ctx.player);
      },
      ai: (ctx) => (synchroTunerCandsWith(ctx) ? 85 : 25),
    },
    matTrigger(CLIP),
  ],
});
/** AI：特殊召喚這張卡之後可以同步召喚 */
const synchroTunerCandsWith = (ctx: EffectContext) => {
  const d = ctx.duel;
  const mons = d.faceUpMonsters(ctx.player);
  return mons.some((c) => tunerCard(c)) || mons.length > 0;
};

// 殺手級調整曲・音軌制作人
def(TRACK_MAKER, {
  aiSummonValue: () => 3200,
  handTunerMaterial: true,
  synchro: { custom: (set) => set.every(tunerCard) && set.some((c) => isKT(c.data)) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從牌組把 1 張「殺手級調整曲」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, isKT).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「殺手級調整曲」卡', cards: deckFilter(ctx, isKT), hint: 'benefit', aiValue: (x) => (x.id === JJ && !d.p(ctx.player).fzone ? 120 : ktHandValue(d, ctx.player, x)) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
    matTrigger(TRACK_MAKER),
  ],
});

// 點唱機酒吧「殺手級調整曲」
def(JJ, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 90) }),
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      query: (d, self, q, t) => q === 'extraNormalSummon' && !!t && t.location === 'hand' && t.owner === self.controller && tunerCard(t) && d.turnPlayer === self.controller,
    },
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      statMod: (d, self, t) => (t.id === LOUDNESS && t.controller === self.controller && oppHasTuner(d, self.controller) ? { atk: 3300 } : null),
    },
    {
      kind: 'ignition',
      label: '解放自己場上 1 隻調整：從牌組把 1 隻「殺手級調整曲」怪獸加入手牌或特殊召喚',
      range: ['fzone'],
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) =>
        ctx.card.faceUp && ctx.duel.monsters(ctx.player).some((c) => c.faceUp && tunerCard(c) && ctx.duel.canTribute(c, false)) && deckFilter(ctx, isKTMonster).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的調整',
          cards: d.monsters(ctx.player).filter((c) => c.faceUp && tunerCard(c) && d.canTribute(c, false)),
          hint: 'cost',
          aiValue: (x) => -(isSynchro(x.data) ? 3000 : 0) - x.data.level * 10,
        });
        if (c) d.sendToGrave([c], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        lockTunerOnly(d, ctx.player);
        const c = await d.selectOne({ player: ctx.player, title: '選擇「殺手級調整曲」怪獸', cards: deckFilter(ctx, isKTMonster), hint: 'benefit', aiValue: (x) => ktHandValue(d, ctx.player, x) });
        if (!c) return;
        const canSS = d.freeMZones(ctx.player) > 0 && canRevive(c);
        const i = canSS
          ? await d.chooseOption({ player: ctx.player, title: `「${c.name}」要怎麼處理？`, options: [{ label: '加入手牌', ai: 40 }, { label: '特殊召喚', ai: 60 }] })
          : 0;
        if (i === 1) {
          d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          d.shuffleDeck(ctx.player);
        } else d.addToHandFromDeck(c, ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.player).some((c) => c.faceUp && tunerCard(c) && !isSynchro(c.data)) ? 70 : 0),
    },
  ],
});

// 殺手級調整曲同調（1 回合最多 2 張）
def(KT_SYNCHRO, {
  effects: [
    activate({
      categories: ['search', 'summon'],
      condition: (ctx) => ((ctx.duel.p(ctx.player).turnFlags.ktSynchro as number) ?? 0) < 2 && deckFilter(ctx, (x) => isKT(x) && x.id !== KT_SYNCHRO).length > 0,
      cost: async (ctx) => {
        const f = ctx.duel.p(ctx.player).turnFlags;
        f.ktSynchro = ((f.ktSynchro as number) ?? 0) + 1;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要加入手牌的「殺手級調整曲」卡',
          cards: deckFilter(ctx, (x) => isKT(x) && x.id !== KT_SYNCHRO),
          hint: 'benefit',
          aiValue: (x) => (x.id === JJ && !d.p(ctx.player).fzone ? 120 : ktHandValue(d, ctx.player, x)),
        });
        if (c) d.addToHandFromDeck(c, ctx.card);
        await maybeSynchroTuner(d, ctx.player);
        lockTunerOnly(d, ctx.player);
      },
      ai: () => 85,
    }),
  ],
});

// 殺手級調整曲播放列表（1 回合最多 2 張）
const playlistTargets = (ctx: EffectContext) =>
  [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isKTMonster(c.data));
def(PLAYLIST, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => ((ctx.duel.p(ctx.player).turnFlags.ktPlaylist as number) ?? 0) < 2 && playlistTargets(ctx).length > 0,
      cost: async (ctx) => {
        const f = ctx.duel.p(ctx.player).turnFlags;
        f.ktPlaylist = ((f.ktPlaylist as number) ?? 0) + 1;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, playlistTargets(ctx), {
          title: '選擇「殺手級調整曲」怪獸',
          hint: 'benefit',
          aiValue: (c) => (matFxUsable(d, ctx.player, c.id) ? ({ [MIX]: 100, [TRACK_MAKER]: 90, [RECO]: 80 }[c.id] ?? 30) : 0) + (c.location === 'grave' ? 20 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        lockTunerOnly(d, ctx.player);
        if (!t || (t.location !== 'grave' && !t.onField)) return;
        if (matFxUsable(d, ctx.player, t.id)) await applyMatFx(d, ctx.player, t.id, ctx.card);
        if (t.location === 'grave' || t.onField) d.returnToHand([t], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.chain.some((l) => l.card.id === PLAYLIST)) return 0;
        if (d.phase === 'draw' || d.phase === 'standby' || d.phase === 'end') return 0;
        // 破壞・彈回對方的卡的效果才主動使用
        const strong = playlistTargets(ctx).some((c) => (c.id === MIX || c.id === RECO || c.id === TRACK_MAKER) && matFxUsable(d, ctx.player, c.id));
        return strong ? 75 : 0;
      },
    }),
  ],
});

// 同調超車
/** 同步怪獸的素材記述的卡名（「○○」＋調整以外的怪獸） */
const namedMaterials = (s: CardData): string[] => {
  const first = s.desc.split('\n')[0];
  return [...first.matchAll(/「(.+?)」/g)].map((m) => m[1]).filter((n) => !n.includes('殺手級調整曲」') && n !== s.name);
};
const overtakePool = (ctx: EffectContext, s: Card) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isMonster(c.data) && namedMaterials(s.data).includes(c.data.name));
def(99243014, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        !ctx.duel.summonedOtherThan(ctx.player, (c) => isSynchro(c.data) || c.summonedFrom !== 'extra') &&
        ctx.duel.p(ctx.player).extra.some((s) => isSynchro(s.data) && overtakePool(ctx, s).length > 0),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });
        const s = await d.selectOne({
          player: ctx.player,
          title: '選擇要給對方觀看的同步怪獸',
          cards: d.p(ctx.player).extra.filter((s) => isSynchro(s.data) && overtakePool(ctx, s).length > 0),
          hint: 'benefit',
          aiValue: (x) => synchroPref(x),
        });
        if (!s) return;
        d.log(`給對方觀看「${s.name}」`);
        const c = await d.selectOne({ player: ctx.player, title: '選擇有卡名記述的同步素材怪獸', cards: overtakePool(ctx, s), hint: 'benefit', aiValue: (x) => ktHandValue(d, ctx.player, x) });
        if (!c) return;
        const canSS = d.freeMZones(ctx.player) > 0 && canRevive(c);
        const i = canSS
          ? await d.chooseOption({ player: ctx.player, title: `「${c.name}」要怎麼處理？`, options: [{ label: '加入手牌', ai: 40 }, { label: '特殊召喚', ai: 60 }] })
          : 0;
        const fromDeck = c.location === 'deck';
        if (i === 1) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        else if (fromDeck) d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    }),
  ],
});

/** 「調整＋同步怪獸 1 隻以上」 */
const tunerPlusSynchros = (set: Card[], d: Duel) =>
  set.some(
    (t) =>
      tunerCard(t) &&
      !d.isNegated(t) &&
      set.filter((c) => c !== t).every((c) => isSynchro(c.data) && (!isTuner(c.data) || (c.id === ZALEN && !d.isNegated(c)))),
  );

// 殺手級調整曲 B2B
def(B2B, {
  aiSummonValue: () => 4200,
  synchro: { custom: tunerPlusSynchros },
  effects: [
    { kind: 'continuous', levelMod: (_d, self, t) => (t.controller !== self.controller ? 2 : 0) },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'doubleAttack' && !!t && t.controller === self.controller && tunerCard(t) },
    {
      kind: 'quick',
      label: '對方把怪獸的效果發動時：墓地・除外的 1 隻調整加入手牌或特殊召喚，那之後可以同步召喚',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          ((d.p(ctx.player).turnFlags[`b2b${ctx.card.stint}`] as number) ?? 0) < 2 &&
          !!top &&
          top.player === ctx.opp &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          b2bTargets(ctx).length > 0
        );
      },
      target: async (ctx) => {
        const f = ctx.duel.p(ctx.player).turnFlags;
        const k = `b2b${ctx.card.stint}`;
        f[k] = ((f[k] as number) ?? 0) + 1;
        await chooseTargets(ctx, b2bTargets(ctx), { title: '選擇調整', hint: 'benefit', aiValue: (c) => ktHandValue(ctx.duel, ctx.player, c) + c.data.level });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || (t.location !== 'grave' && t.location !== 'banished')) return;
        const canSS = d.freeMZones(ctx.player) > 0 && canRevive(t);
        const i = canSS
          ? await d.chooseOption({ player: ctx.player, title: `「${t.name}」要怎麼處理？`, options: [{ label: '加入手牌', ai: 30 }, { label: '特殊召喚', ai: 70 }] })
          : 0;
        if (i === 1) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
        else d.returnToHand([t], 'effect', ctx.card);
        await maybeSynchroTuner(d, ctx.player, true);
      },
      ai: () => 90,
    },
  ],
});
const b2bTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp)].filter((c) => tunerCard(c) && c.data.level !== 10);

// 殺手級調整曲・紅印鑑唱片師
def(RS, {
  aiSummonValue: () => 3200,
  synchro: { custom: (set) => set.every(tunerCard) && set.some((c) => c.id === RECO) },
  effects: [
    { kind: 'continuous', statMod: (d, self, t) => (t === self ? { atk: [...d.p(0).grave, ...d.p(1).grave].filter(tunerCard).length * 300 } : null) },
    { kind: 'continuous', levelMod: (_d, self, t) => (t.controller !== self.controller && (t.baseData ?? t.data).atk <= 1700 ? 1 : 0) },
    {
      kind: 'quick',
      label: '從墓地把 1 隻調整除外：對方場上 1 張表側表示卡的效果直到回合結束時無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const d = ctx.duel;
        return (
          ctx.card.isFaceUpMonster &&
          (d.phase === 'main1' || d.phase === 'main2') &&
          d.p(ctx.player).grave.some(tunerCard) &&
          d.fieldCards(ctx.opp).some((c) => c.faceUp && !d.isNegated(c))
        );
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的調整', cards: d.p(ctx.player).grave.filter(tunerCard), hint: 'cost', aiValue: (x) => -(MAT_FX[x.id] ? 50 : 0) });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp).filter((c) => c.faceUp && !d.isNegated(c)), { title: '選擇要無效的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !t.faceUp) return;
        d.setFlag(t, 'negated');
        d.log(`「${t.name}」的效果直到回合結束時無效`);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp && isMonster(c.data)) ? 70 : 0),
    },
  ],
});

// 殺手級調整曲・再混音手
def(REMIX, {
  aiSummonValue: () => 2900,
  synchro: { custom: (set) => set.every(tunerCard) && set.some((c) => c.id === MIX) },
  effects: [
    { kind: 'continuous', statMod: (d, self, t) => (t === self && oppHasTuner(d, self.controller) ? { atk: 1500 } : null) },
    {
      kind: 'quick',
      label: '對方回合，解放這張卡：從墓地選 2 隻調整，1 隻加入手牌，另 1 隻特殊召喚，那之後可以同步召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && ctx.duel.p(ctx.player).grave.filter((c) => tunerCard(c) && !isSynchro(c.data)).length >= 2,
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).grave.filter((c) => tunerCard(c) && !isSynchro(c.data));
        if (pool.length < 2) return;
        const sel = await d.select({ player: ctx.player, title: '選擇 2 隻調整', cards: pool, min: 2, max: 2, hint: 'benefit', aiValue: (x) => ktHandValue(d, ctx.player, x) });
        if (sel.length < 2) return;
        const ss = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的調整（另 1 隻加入手牌）', cards: sel, hint: 'benefit', aiValue: (x) => (x.id === CLIP ? -10 : x.data.level) });
        const hand = sel.find((c) => c !== ss);
        if (hand) d.returnToHand([hand], 'effect', ctx.card);
        if (ss && d.freeMZones(ctx.player) > 0) d.specialSummon(ss, ctx.player, { position: 'atk', by: ctx.card });
        await maybeSynchroTuner(d, ctx.player);
      },
      ai: (ctx) => (ctx.duel.chain.length ? 70 : 40),
    },
  ],
});

// 殺手級調整曲響度戰爭
def(LOUDNESS, {
  aiSummonValue: () => 3800,
  synchro: { custom: (set) => set.every(tunerCard) },
  effects: [
    {
      kind: 'continuous',
      query: (d, self, q, t) =>
        !!t &&
        t !== self &&
        t.location === 'mzone' &&
        t.faceUp &&
        t.controller === self.controller &&
        tunerCard(t) &&
        (q === 'effectIndestructible' || q === 'untargetableByOpp'),
    },
    {
      kind: 'quick',
      label: '對方把效果發動時，從墓地把「殺手級調整曲」怪獸除外：適用那隻怪獸作為同步素材送去墓地的場合的效果',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && d.p(ctx.player).grave.some((c) => isKTMonster(c.data) && matFxUsable(d, ctx.player, c.id));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「殺手級調整曲」怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isKTMonster(c.data) && matFxUsable(d, ctx.player, c.id)),
          hint: 'cost',
          aiValue: (x) => ({ [MIX]: 90, [RECO]: 70, [TRACK_MAKER]: 80, [CLIP]: 40, [CUE]: 30, [ROTARY]: 30 })[x.id] ?? 0,
        });
        if (!c) return;
        ctx.data.fxId = c.id;
        d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const id = ctx.data.fxId as number | undefined;
        if (id) await applyMatFx(ctx.duel, ctx.player, id, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 殺手級調整曲・噼啪削波手
def(CRACKLE, {
  aiSummonValue: () => 3300,
  synchro: { custom: (set) => set.every(tunerCard) && set.some((c) => c.id === CLIP) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：確認對方的額外牌組，1 張直到結束階段表側除外，可以讓這張卡攻擊力上升',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.p(ctx.opp).extra.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const ex = d.p(ctx.opp).extra;
        if (!ex.length) return;
        d.log(`確認對方的額外牌組：${ex.map((c) => `「${c.name}」`).join('、')}`);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的卡', cards: ex, hint: 'harm', aiValue: (x) => x.data.atk });
        if (!c || !banishExtraUntilEnd(d, [c], ctx.card).length) return;
        if (isMonster(c.data) && c.data.atk > 0 && ctx.card.isFaceUpMonster && (await d.confirm({ player: ctx.player, title: `要讓攻擊力上升 ${c.data.atk} 嗎？`, ai: true })))
          d.addMod(ctx.card, { atk: c.data.atk, until: 'permanent' }, ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '同步召喚的這張卡被送去墓地：這張卡特殊召喚，可以把對方的額外牌組 2 張直到結束階段表側除外',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.card.location === 'grave' && ctx.event.from === 'mzone' && ctx.card.summonType === 'synchro' && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const ex = d.p(ctx.opp).extra;
        if (!ex.length || !(await d.confirm({ player: ctx.player, title: '要把對方的額外牌組 2 張除外嗎？', ai: true }))) return;
        d.log(`確認對方的額外牌組：${ex.map((c) => `「${c.name}」`).join('、')}`);
        const sel = await d.select({ player: ctx.player, title: '選擇要除外的 2 張卡', cards: ex, min: Math.min(2, ex.length), max: 2, hint: 'harm', aiValue: (x) => x.data.atk });
        banishExtraUntilEnd(d, sel, ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 鎖縛龍 鎖鐮
def(ZALEN, {
  aiSummonValue: () => 3400,
  synchroAsNonTuner: true,
  synchro: { custom: tunerPlusSynchros },
  effects: [
    {
      kind: 'quick',
      label: '連鎖卡的效果的發動讓效果發動時：那個效果，或那個效果連鎖的卡的效果無效並破壞',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || d.chain.length < 2) return false;
        const top = d.chain[d.chain.length - 1];
        const prev = d.chain[d.chain.length - 2];
        return (top.player === ctx.opp && !top.negated) || (prev.player === ctx.opp && !prev.negated);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const top = d.chain[d.chain.length - 1];
        const prev = d.chain[d.chain.length - 2];
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要無效的效果',
          options: [
            { label: `「${top.card.name}」的效果無效並破壞`, ai: top.player === ctx.opp ? 70 : 0 },
            { label: `「${prev.card.name}」的效果無效並破壞`, ai: prev.player === ctx.opp ? 60 : 0 },
          ],
        });
        ctx.data.link = i === 0 ? top : prev;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateEffect(link);
        if (link.ctx.data.effectNegated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 維薩斯-阿密哩多羅
const isLightC = (c: Card) => isMonster(c.data) && (c.data.attribute & ATTR.LIGHT) !== 0;
def(821049, {
  synchro: {
    custom: (set, d) =>
      set.some(
        (l) =>
          isLightC(l) &&
          (!isTuner(l.data) || (l.id === ZALEN && !d.isNegated(l))) &&
          set.filter((c) => c !== l).every((c) => tunerCard(c) && !d.isNegated(c)),
      ),
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：從牌組把有「維薩斯-斯塔弗羅斯特」的卡名記述的魔法・陷阱卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && x.desc.includes('「維薩斯-斯塔弗羅斯特」')).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && x.desc.includes('「維薩斯-斯塔弗羅斯特」')), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '自己場上 1 隻怪獸破壞：這回合自己場上的同步怪獸攻擊力上升 800',
      once: 'name',
      categories: ['destroy', 'stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.monsters(ctx.player).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的自己的怪獸', cards: d.monsters(ctx.player), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) await d.destroy([c], 'effect', ctx.card);
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, stat: (t) => (t.controller === p && isSynchro(t.data) ? { atk: 800 } : null) });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.player).some((c) => !c.faceUp || c.data.atk < 1000) ? 40 : 0),
    },
  ],
});

// 決鬥者創世紀
const isSynchroST = (d: CardData) => (isSpell(d) || isTrap(d)) && d.name.includes('同調');
def(97474300, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some(tunerCard) && deckFilter(ctx, isSynchroST).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「同調」魔法・陷阱卡', cards: deckFilter(ctx, isSynchroST), hint: 'benefit', aiValue: (x) => (x.id === KT_SYNCHRO ? 100 : 50) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 80,
    }),
  ],
});

// 過度調和
const overTuningPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter(
    (c) => tunerCard(c) && !isSynchro(c.data) && canRevive(c),
  );
def(613496, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(tunerCard) && ctx.duel.freeMZones(ctx.player) > 0 && overTuningPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的調整', cards: overTuningPool(ctx), hint: 'benefit', aiValue: (x) => ktHandValue(d, ctx.player, x) });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    }),
  ],
});

// 自然薔薇鞭
def(61049315, {
  effects: [{ kind: 'continuous', query: (_d, self, q, _t, player) => q === 'oneSpellTrapPerTurn' && player !== null && player !== self.controller }],
});
