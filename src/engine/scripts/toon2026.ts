// 第二十八彈：卡通 2026（完美世界 卡通世界）與環境的連結怪獸
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isLink, isMonster, isSpell, isTrap, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, PlayerId } from '../types';
import { AS_TOON, isToon, mentionsToonWorld, toonWorldOn } from './gx';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const PERFECT_TW = 7293697;
const EYES = 34298391;
const BE_TOON = 53183600;
/** 「卡通」卡 */
const isToonName = (d: CardData) => d.name.includes('卡通') || d.nameEn.includes('Toon');
/** 「卡通」卡或者有「卡通」卡名記述的卡 */
const toonOrMention = (d: CardData) => isToonName(d) || /「[^」]*卡通[^」]*」/.test(d.desc);
void AS_TOON;

/** 從手牌・牌組等無視召喚條件特殊召喚 */
function ssIgnoring(d: Duel, c: Card, p: PlayerId, by: Card): boolean {
  const fromDeck = c.location === 'deck';
  const ok = d.specialSummon(c, p, { position: 'atk', by, ignoreConditions: true });
  if (fromDeck) d.shuffleDeck(p);
  return ok;
}

// =====================================================================
// 完美世界 卡通世界
// =====================================================================
def(PERFECT_TW, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 90) }),
    {
      kind: 'ignition',
      label: '從牌組把 1 張「卡通」卡或者有那卡名記述的卡加入手牌',
      range: ['fzone'],
      once: 'turn',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.faceUp && ((ctx.duel.p(ctx.player).turnFlags.perfectTW as number) ?? 0) < 3 && deckFilter(ctx, toonOrMention).length > 0,
      cost: async (ctx) => {
        const f = ctx.duel.p(ctx.player).turnFlags;
        f.perfectTW = ((f.perfectTW as number) ?? 0) + 1;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, toonOrMention), hint: 'benefit', aiValue: (x) => toonSearchValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
  ],
  beforeResolve: async (d, self, link) => {
    if (self.location !== 'fzone') return;
    const p = self.controller;
    const used = (n: string) => !!d.p(p).turnFlags[`ptwBanish:${n}`];
    const toons = d.faceUpMonsters(p).filter((c) => isToon(c) && !used((c.baseData ?? c.data).name));
    if (!toons.length) return;
    // AI：對方的效果以自己的卡通怪獸為對象，或是會讓怪獸離場的效果才躲開
    const threatened = toons.filter((c) => link.ctx.targets.some((t) => t.card === c));
    const harmful =
      link.player !== p &&
      (threatened.length > 0 ||
        (link.ctx.targets.length === 0 && (link.effect.categories ?? []).some((k) => ['destroy', 'banish', 'toHand', 'toDeck', 'control'].includes(k))));
    if (!(await d.confirm({ player: p, title: `要用「${self.name}」的效果把卡通怪獸直到「${link.card.name}」的效果處理後除外嗎？`, ai: harmful })))
      return;
    const c = await d.selectOne({
      player: p,
      title: '選擇要除外的卡通怪獸',
      cards: toons,
      hint: 'cost',
      aiValue: (x) => (threatened.includes(x) ? 5000 : 0) + cardValue(d, x, p),
    });
    if (!c) return;
    const pos = c.position;
    d.p(p).turnFlags[`ptwBanish:${(c.baseData ?? c.data).name}`] = true;
    if (!d.banish([c], 'effect', self).length) return;
    const stint = c.stint;
    d.log(`「${c.name}」直到效果處理後除外`);
    return () => {
      if (c.location !== 'banished' || c.stint !== stint) return;
      if (d.freeMZones(c.owner) > 0) d.moveTo(c, 'mzone', { reason: 'effect', player: c.owner, faceUp: true, position: pos });
      else d.sendToGrave([c], 'rule');
    };
  },
});
/** AI：要從牌組加入手牌的卡通相關卡 */
const toonSearchValue = (d: Duel, p: PlayerId, c: Card) => {
  const have = (id: number) => d.p(p).hand.some((h) => h.id === id);
  const pri: Record<number, number> = { 45536531: 90, 72921536: 85, 8915275: 70, 34314989: 60, 71808988: 0, 91500017: 50, 89997728: 50, [EYES]: 40 };
  return (pri[c.id] ?? 30) - (have(c.id) ? 40 : 0);
};

// =====================================================================
// 滑稽暗黑兔
// =====================================================================
def(45536531, {
  effects: [
    {
      kind: 'continuous',
      onEvent: (d, self, ev) => {
        if (ev.type !== 'summoned' || !(ev.cards ?? [ev.card]).includes(self) || !self.isFaceUpMonster) return;
        const p = self.controller;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'extraNormalSummon' && c.owner === p && c.location === 'hand' && isMonster(c.data) && mentionsToonWorld(c.data) });
        d.log(`這個回合 ${d.p(p).name} 在通常召喚外加上可以召喚 1 隻有「卡通世界」的卡名記述的怪獸`);
      },
    },
    {
      kind: 'ignition',
      label: '從牌組選 1 張「卡通」場地・永續魔法卡加入手牌或在自己場上表側表示放置',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && deckFilter(ctx, toonFieldCont).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「卡通」場地・永續魔法卡', cards: deckFilter(ctx, toonFieldCont), hint: 'benefit', aiValue: (x) => (x.id === PERFECT_TW && !d.p(ctx.player).fzone ? 100 : 30) });
        if (!c) return;
        const field = spellKind(c.data) === 'field';
        const canPlace = field ? true : d.freeSZones(ctx.player) > 0;
        const i = canPlace
          ? await d.chooseOption({ player: ctx.player, title: `「${c.name}」要怎麼處理？`, options: [{ label: '加入手牌', ai: 30 }, { label: '在自己場上表側表示放置', ai: field && !d.p(ctx.player).fzone ? 80 : 20 }] })
          : 0;
        if (i === 1) {
          if (field && d.p(ctx.player).fzone) d.sendToGrave([d.p(ctx.player).fzone!], 'rule');
          d.moveTo(c, field ? 'fzone' : 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
          d.shuffleDeck(ctx.player);
          d.log(`「${c.name}」在場上表側表示放置`);
        } else d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const toonFieldCont = (d: CardData) => isSpell(d) && isToonName(d) && (spellKind(d) === 'field' || spellKind(d) === 'continuous');

// =====================================================================
// 漫畫貓
// =====================================================================
const catPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isMonster(c.data) && mentionsToonWorld(c.data) && c !== ctx.card);
const catTributes = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [...d.monsters(ctx.player), ...(toonWorldOn(d, ctx.player) ? d.monsters(ctx.opp) : [])].filter((c) => d.canTribute(c, false));
};
def(72921536, {
  effects: [
    {
      kind: 'quick',
      label: '自己場上 1 隻怪獸解放，從手牌・牌組把有「卡通世界」的卡名記述的 1 隻怪獸無視召喚條件特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && catTributes(ctx).length > 0 && catPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的怪獸',
          cards: catTributes(ctx),
          hint: 'cost',
          aiValue: (x) => (x.controller === ctx.opp ? 5000 + cardValue(d, x, ctx.player) : x === ctx.card ? 100 : -cardValue(d, x, ctx.player)),
        });
        if (!t || !d.sendToGrave([t], 'tribute', ctx.card).length) return;
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: catPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) ssIgnoring(d, c, ctx.player, ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player || ctx.duel.monsters(ctx.opp).length ? 80 : 0),
    },
  ],
});

// =====================================================================
// 邪魔箱
// =====================================================================
def(8915275, {
  effects: [
    {
      kind: 'ignition',
      label: '自己場上有「卡通世界」：這張卡從手牌特殊召喚，那之後可以把「卡通」陷阱卡加入手牌或蓋放',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'search'],
      condition: (ctx) => toonWorldOn(ctx.duel, ctx.player) && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const traps = deckFilter(ctx, (x) => isTrap(x) && isToonName(x));
        if (!traps.length || !(await d.confirm({ player: ctx.player, title: '要從牌組選「卡通」陷阱卡嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「卡通」陷阱卡', cards: traps, hint: 'benefit' });
        if (!c) return;
        const i = d.freeSZones(ctx.player) > 0 ? await d.chooseOption({ player: ctx.player, title: `「${c.name}」要怎麼處理？`, options: [{ label: '加入手牌', ai: 30 }, { label: '在自己場上蓋放', ai: 60 }] }) : 0;
        if (i === 1) {
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
          c.turnPlaced = d.turn;
          d.shuffleDeck(ctx.player);
          d.log(`「${ctx.card.name}」的效果：蓋放 1 張陷阱卡`);
        } else d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '雙方墓地 1 張卡回到牌組最下面',
      once: 'turn',
      categories: ['toDeck'],
      condition: (ctx) => ctx.card.isFaceUpMonster && [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, [...d.p(ctx.opp).grave, ...d.p(ctx.player).grave], { title: '選擇要回到牌組最下面的卡', aiValue: (c) => (c.owner === ctx.opp ? cardValue(d, c, ctx.player) : -100) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'deck', { reason: 'effect', by: ctx.card, top: false });
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp && top.activatedFrom === 'grave' ? 85 : ctx.duel.phase === 'end' ? 40 : 0;
      },
    },
  ],
});

// =====================================================================
// 暗眼幻想師・無臉幻想師
// =====================================================================
const fantasistGrave = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isMonster(c.data) && mentionsToonWorld(c.data));
def(34314989, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌丟棄：把「看透心靈之眼」放置，或從墓地把有「卡通世界」的卡名記述的怪獸加入手牌',
      range: ['hand'],
      categories: ['toHand'],
      condition: (ctx) => {
        const f = ctx.duel.p(ctx.player).turnFlags;
        const eyes = !f.fantasist0 && ctx.duel.freeSZones(ctx.player) > 0 && [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === EYES);
        return eyes || (!f.fantasist1 && fantasistGrave(ctx).length > 0);
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const f = d.p(ctx.player).turnFlags;
        const eyesOk = !f.fantasist0 && d.freeSZones(ctx.player) > 0 && [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].some((c) => c.id === EYES);
        const graveOk = !f.fantasist1 && fantasistGrave(ctx).length > 0;
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '從手牌・牌組把「看透心靈之眼」在自己場上表側表示放置', ai: eyesOk ? 60 : -1 },
            { label: '從墓地把有「卡通世界」的卡名記述的怪獸加入手牌', ai: graveOk ? 70 : -1 },
          ],
        });
        ctx.data.mode = i === 0 && eyesOk ? 0 : 1;
        f[`fantasist${ctx.data.mode}`] = true;
        d.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 0) {
          const c = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].find((x) => x.id === EYES);
          if (!c || d.freeSZones(ctx.player) <= 0) return;
          const fromDeck = c.location === 'deck';
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
          if (fromDeck) d.shuffleDeck(ctx.player);
          d.log(`「${c.name}」在場上表側表示放置`);
          return;
        }
        const pool = fantasistGrave(ctx);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c || !d.returnToHand([c], 'effect', ctx.card).length) return;
        if (d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: `要把「${c.name}」無視召喚條件特殊召喚嗎？`, ai: true })))
          ssIgnoring(d, c, ctx.player, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => {
        if (q !== 'battleIndestructible' || !t || !self.isFaceUpMonster) return false;
        const b = d.battle;
        if (!b || (b.attacker !== self && b.target !== self)) return false;
        return t === b.attacker || t === b.target;
      },
    },
  ],
});

// =====================================================================
// 看透心靈之眼
// =====================================================================
const eyesReady = (d: Duel, p: PlayerId) => {
  const pool = [...d.fieldCards(p).filter((c) => c.faceUp), ...d.p(p).grave];
  return pool.some((c) => isToon(c)) && pool.some((c) => isSpell(c.data) && isToonName(c.data));
};
def(EYES, {
  effects: [
    activate({ ai: (ctx) => (eyesReady(ctx.duel, ctx.player) ? 30 : 10) }),
    {
      kind: 'quick',
      label: '宣言 1 個卡名：直到回合結束時，原本卡名和宣言的卡相同的卡發動的效果無效化',
      range: ['szone'],
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.card.faceUp && eyesReady(ctx.duel, ctx.player),
      target: async (ctx) => {
        const d = ctx.duel;
        const inChain = new Set(d.chain.map((l) => (l.card.baseData ?? l.card.data).name));
        const seen = new Map<string, Card>();
        // 對方手牌持續公開：從對方的手牌・場上・墓地・額外牌組選擇
        for (const c of [...d.p(ctx.opp).hand, ...d.fieldCards(ctx.opp), ...d.p(ctx.opp).grave, ...d.p(ctx.opp).extra, ...d.p(ctx.opp).deck]) {
          const n = (c.baseData ?? c.data).name;
          if (!inChain.has(n) && !seen.has(n)) seen.set(n, c);
        }
        const c = await d.selectOne({
          player: ctx.player,
          title: '宣言 1 個卡名',
          cards: [...seen.values()],
          hint: 'harm',
          aiValue: (x) => (x.location === 'hand' ? 300 : x.onField ? 200 : 0) + (isMonster(x.data) && (x.data.type & 0x20) ? 100 : 0) + (x.data.desc.includes('從手牌') ? 100 : 0),
        });
        ctx.data.name = c ? (c.baseData ?? c.data).name : undefined;
        if (c) d.log(`宣言「${ctx.data.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const name = ctx.data.name as string | undefined;
        if (!name) return;
        const self = ctx.card;
        const stint = self.stint;
        const turn = d.turn;
        d.listeners.push((ev) => {
          if (d.turn !== turn || self.stint !== stint || !self.faceUp || !self.onField) return true;
          if (ev.type === 'activated' && ev.link && (ev.link.card.baseData ?? ev.link.card.data).name === name) {
            d.negateEffect(ev.link);
            d.log(`「${self.name}」的效果：「${name}」的效果無效`);
          }
          return false;
        });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && (ctx.duel.phase === 'standby' || ctx.duel.phase === 'main1') && !ctx.duel.chain.length ? 75 : 0),
    },
  ],
});

// =====================================================================
// 青眼卡通究極龍
// =====================================================================
const ultPool = (d: Duel, p: PlayerId) => [...d.p(p).hand, ...d.faceUpMonsters(p), ...d.p(p).grave].filter((c) => isMonster(c.data));
const ultSet = (d: Duel, p: PlayerId): Card[] | null => {
  const pool = ultPool(d, p);
  const be = pool.find((c) => c.id === BE_TOON);
  if (!be) return null;
  const toons = pool.filter((c) => c !== be && isToon(c));
  return toons.length >= 2 ? [be, toons[0], toons[1]] : null;
};
def(71808988, {
  spSummon: {
    label: '讓「青眼卡通龍」＋卡通怪獸×2 回到牌組，從額外牌組特殊召喚',
    condition: (d, card) => !!ultSet(d, card.owner) && (d.freeMZones(card.owner) > 0 || d.faceUpMonsters(card.owner).length > 0),
    cost: async (d, card) => {
      const p = card.owner;
      const pool = ultPool(d, p);
      const be = await d.selectOne({ player: p, title: '選擇「青眼卡通龍」', cards: pool.filter((c) => c.id === BE_TOON), hint: 'cost', aiValue: (x) => (x.location === 'grave' ? 100 : 0) });
      if (!be) return;
      const toons = await d.select({
        player: p,
        title: '選擇 2 隻卡通怪獸',
        cards: pool.filter((c) => c !== be && isToon(c)),
        min: 2,
        max: 2,
        hint: 'cost',
        aiValue: (x) => (x.location === 'grave' ? 100 : x.location === 'hand' ? 50 : -cardValue(d, x, p)),
      });
      d.returnToDeck([be, ...toons], false, 'cost', card);
    },
    ai: () => 85,
  },
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'directAttack' && !!t && t.controller === self.controller && t.location === 'mzone' && isToon(t),
    },
    {
      kind: 'ignition',
      label: '從墓地把 1 張「卡通」卡或者有那卡名記述的卡加入手牌',
      once: 'turn',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).grave.some((c) => toonOrMention(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: d.p(ctx.player).grave.filter((c) => toonOrMention(c.data)), hint: 'benefit', aiValue: (x) => toonSearchValue(d, ctx.player, x) });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'damageCalc',
      label: '自己的卡通怪獸被攻擊的傷害計算時：那隻怪獸直到傷害步驟結束時除外',
      categories: ['banish'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return ctx.card.isFaceUpMonster && !!b?.target && b.target.controller === ctx.player && isToon(b.target);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = d.battle?.target;
        if (!t?.onField) return;
        const pos = t.position;
        if (!d.banish([t], 'effect', ctx.card).length) return;
        const stint = t.stint;
        d.listeners.push((ev) => {
          if (d.battle && ev.type !== 'damageStepEnd') return false;
          if (t.location === 'banished' && t.stint === stint && d.freeMZones(t.owner) > 0) d.moveTo(t, 'mzone', { reason: 'effect', player: t.owner, faceUp: true, position: pos });
          return true;
        });
      },
      ai: () => 85,
    },
  ],
});

// =====================================================================
// 完美電子多元驅動蛇・神龍
// =====================================================================
const SERPENT_ATTRS = ATTR.LIGHT | ATTR.WATER | ATTR.FIRE | ATTR.WIND;
async function serpentWipe(ctx: EffectContext) {
  const d = ctx.duel;
  const mons = d.monsters(ctx.opp);
  if (mons.length) await d.destroy(mons, 'effect', ctx.card);
  const n = d.p(ctx.player).grave.filter((c) => isLink(c.data)).length;
  if (n) d.damage(ctx.opp, n * 300, 'effect', ctx.card);
}
def(13203964, {
  link: { min: 1, filter: (c) => isLink(c.data) },
  aiSummonValue: () => 6000,
  selfSubstitute: (d, self, reason) =>
    (reason === 'battle' || reason === 'effect') && d.getAtk(self) >= 1000
      ? [{ label: '攻擊力下降 1000 代替破壞', apply: () => d.addMod(self, { atk: -1000, until: 'permanent' }, self) }]
      : null,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚：對方場上的怪獸全部破壞，給予自己墓地的連結怪獸數量×300 傷害',
      mandatory: true,
      categories: ['destroy', 'damage'],
      condition: (ctx) => summonedSelf(ctx, ['link']),
      operation: serpentWipe,
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      label: '戰鬥的傷害步驟結束時：對方場上的怪獸全部破壞，給予自己墓地的連結怪獸數量×300 傷害',
      mandatory: true,
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.card.isFaceUpMonster && (ctx.event?.attacker === ctx.card || ctx.event?.target === ctx.card),
      operation: serpentWipe,
    },
    {
      kind: 'continuous',
      onEvent: (d, self, ev) => {
        if (ev.type === 'summoned' && (ev.cards ?? [ev.card]).includes(self) && self.isFaceUpMonster && !self.baseData)
          d.overrideData(self, { attribute: self.data.attribute | SERPENT_ATTRS });
      },
    },
    {
      kind: 'continuous',
      immune: (d, self, target, source) =>
        target === self &&
        self.location === 'mzone' &&
        isMonster(source.data) &&
        source !== self &&
        d.resolvingLink?.card === source &&
        ((source.location === 'mzone' ? source.data.attribute : (source.baseData ?? source.data).attribute) & self.data.attribute) !== 0,
    },
  ],
});

// =====================================================================
// 環境的連結怪獸
// =====================================================================

// 四花繚亂之靈使
const quartetPairs = (ctx: EffectContext): [Card, Card][] => {
  const g = ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && canRevive(c));
  const out: [Card, Card][] = [];
  for (let i = 0; i < g.length; i++)
    for (let j = i + 1; j < g.length; j++) {
      const a = g[i].data;
      const b = g[j].data;
      if ((a.attribute === b.attribute && a.race !== b.race) || (a.race === b.race && a.attribute !== b.attribute)) out.push([g[i], g[j]]);
    }
  return out;
};
def(27519978, {
  aiSummonValue: () => 3200,
  effects: [
    {
      kind: 'continuous',
      statMod: (d, self, t) => {
        if (t !== self) return null;
        let attrs = 0;
        for (const c of d.faceUpMonsters()) attrs |= c.data.attribute;
        let n = 0;
        for (let b = attrs; b; b &= b - 1) n++;
        return { atk: n * 300 };
      },
    },
    {
      kind: 'quick',
      label: '墓地 2 隻相同屬性而種族不同（或相同種族而屬性不同）的怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && !ctx.card.flags.quartetUsed && inMainPhase(ctx.duel) && ctx.duel.freeMZones(ctx.player) >= 2 && quartetPairs(ctx).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        ctx.card.flags.quartetUsed = true;
        const pairs = quartetPairs(ctx);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻怪獸',
          cards: [...new Set(pairs.flat())],
          min: 2,
          max: 2,
          hint: 'benefit',
          validate: (s) => s.length === 2 && pairs.some(([a, b]) => s.includes(a) && s.includes(b)),
          aiValue: (x) => x.data.atk,
        });
        d.setTargets(ctx, sel.length === 2 && pairs.some(([a, b]) => sel.includes(a) && sel.includes(b)) ? sel : pairs[0]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length < 2 || d.freeMZones(ctx.player) < 2) return;
        const until = d.turn + 1;
        for (const c of ts) if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'cannotBeMaterial', until);
        if (ctx.card.onField) d.setFlag(ctx.card, 'cannotBeMaterial', until);
      },
      ai: () => 80,
    },
  ],
});

// 暗影之暗靈使 達克
def(8264361, {
  aiSummonValue: () => 2600,
  link: { min: 2, max: 2, validate: (set) => set.some((c) => (c.data.attribute & ATTR.DARK) !== 0) },
  effects: [
    {
      kind: 'ignition',
      label: '對方墓地 1 隻暗屬性怪獸在這張卡所連接區的自己場上特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && dharcZones(ctx).length > 0 && ctx.duel.p(ctx.opp).grave.some((c) => isMonster(c.data) && (c.data.attribute & ATTR.DARK) !== 0 && canRevive(c)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.p(ctx.opp).grave.filter((c) => isMonster(c.data) && (c.data.attribute & ATTR.DARK) !== 0 && canRevive(c)), { title: '選擇暗屬性怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        const zones = dharcZones(ctx);
        if (t?.location === 'grave' && zones.length) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card, zones });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '連結召喚的這張卡被戰鬥或對方的效果破壞：從牌組把守備力 1500 以下的暗屬性怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ev?.card !== ctx.card || ctx.card.summonType !== 'link') return false;
        const byOpp = ev.reason === 'effect' && !!ev.by && controllerOf(ev.by) === ctx.opp;
        return (ev.reason === 'battle' || byOpp) && deckFilter(ctx, dharcSearch).length > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇暗屬性怪獸', cards: deckFilter(ctx, dharcSearch), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const dharcSearch = (x: CardData) => isMonster(x) && (x.attribute & ATTR.DARK) !== 0 && x.def <= 1500;
const dharcZones = (ctx: EffectContext) =>
  ctx.duel
    .pointedZones(ctx.card)
    .filter((z) => z.player === ctx.player && z.idx < 5 && !ctx.duel.p(ctx.player).mzone[z.idx])
    .map((z) => z.idx);

// 保護碼語者
const isFirewallLink = (c: Card) => isLink(c.data) && (c.data.name.includes('防火') || c.data.nameEn.includes('Firewall'));
const protectCostSets = (ctx: EffectContext): Card[][] => {
  const links = ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isLink(c.data));
  const out: Card[][] = [];
  const rec = (i: number, cur: Card[], sum: number) => {
    if (sum === 3) out.push([...cur]);
    if (sum >= 3) return;
    for (let j = i; j < links.length; j++) rec(j + 1, [...cur, links[j]], sum + links[j].data.level);
  };
  rec(0, [], 0);
  return out;
};
def(58036229, {
  aiSummonValue: () => 2600,
  link: { min: 2, filter: (c) => isMonster(c.data) && (c.data.type & 0x20) !== 0 },
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) =>
        !!t && t.controller === self.controller && t.location === 'mzone' && isLink(t.data) && t.data.level >= 4 && (q === 'untargetableByOpp' || q === 'battleIndestructible'),
    },
    {
      kind: 'quick',
      label: '自己場上有「防火」連結怪獸：從墓地把連結標記合計 3 的連結怪獸除外，這張卡從墓地特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some(isFirewallLink) && ctx.duel.extraZones(ctx.player, ctx.card).length > 0 && protectCostSets(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sets = protectCostSets(ctx);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇要除外的連結怪獸（連結標記合計 3）',
          cards: [...new Set(sets.flat())],
          min: 1,
          max: 3,
          hint: 'cost',
          validate: (s) => sets.some((x) => x.length === s.length && x.every((c) => s.includes(c))),
        });
        d.banish(sets.some((x) => x.length === sel.length && x.every((c) => sel.includes(c))) ? sel : sets[0], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: () => 70,
    },
  ],
});

// 連接解碼員
def(30342076, {
  link: { min: 1, max: 1, filter: (c) => isMonster(c.data) && c.data.level <= 4 && !isLink(c.data) && (c.data.race & RACE.CYBERSE) !== 0 },
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '作為原本攻擊力 2300 以上的電子界族連結怪獸的連結素材送去墓地：這張卡特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const l = d.lastLinkSummon;
        return (
          ctx.event?.card === ctx.card &&
          ctx.event.reason === 'material' &&
          !!l &&
          (d.lastLinkMaterials ?? []).includes(ctx.card) &&
          (l.data.race & RACE.CYBERSE) !== 0 &&
          (l.baseData ?? l.data).atk >= 2300 &&
          d.extraZones(ctx.player, ctx.card).length > 0
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: () => 85,
    },
  ],
});

// 複製梁龍
const RACES: [number, string][] = [
  [RACE.WARRIOR, '戰士族'],
  [RACE.SPELLCASTER, '魔法師族'],
  [RACE.DRAGON, '龍族'],
  [RACE.FIEND, '惡魔族'],
  [RACE.MACHINE, '機械族'],
  [RACE.CYBERSE, '電子界族'],
  [RACE.BEAST, '獸族'],
  [RACE.FAIRY, '天使族'],
];
const ATTRS: [number, string][] = [
  [ATTR.LIGHT, '光'],
  [ATTR.DARK, '暗'],
  [ATTR.EARTH, '地'],
  [ATTR.WATER, '水'],
  [ATTR.FIRE, '炎'],
  [ATTR.WIND, '風'],
];
def(34989413, {
  link: { min: 2, max: 2 },
  effects: [
    {
      kind: 'ignition',
      label: '宣言種族或屬性：所連接區的全部表側表示怪獸直到回合結束時變成宣言的種族・屬性',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.pointedMonsters(ctx.card).some((c) => c.faceUp),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pointed = d.pointedMonsters(ctx.card).filter((c) => c.faceUp);
        if (!pointed.length) return;
        const i = await d.chooseOption({ player: ctx.player, title: '要宣言什麼？', options: [{ label: '宣言種族', ai: 50 }, { label: '宣言屬性', ai: 40 }] });
        const list = i === 0 ? RACES : ATTRS;
        const j = await d.chooseOption({ player: ctx.player, title: '選擇要宣言的項目', options: list.map(([, n]) => ({ label: n, ai: 10 })) });
        const [v, n] = list[j] ?? list[0];
        for (const c of pointed) d.overrideData(c, i === 0 ? { race: v } : { attribute: v }, d.turn);
        d.log(`所連接區的怪獸直到回合結束時變成${n}`);
      },
      ai: () => 0,
    },
  ],
});

// 神聖魔皇后 塞勒涅
def(45819647, {
  aiSummonValue: () => 2600,
  link: { min: 2, validate: (set) => set.some((c) => (c.data.race & RACE.SPELLCASTER) !== 0) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚：放置雙方的場上・墓地的魔法卡數量的魔力指示物',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx, ['link']),
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = [...d.spellTraps(), ...d.p(0).grave, ...d.p(1).grave].filter((c) => isSpell(c.data) && (c.location === 'grave' || c.faceUp)).length;
        if (ctx.card.isFaceUpMonster && n) {
          ctx.card.counters += n;
          d.log(`「${ctx.card.name}」放置 ${n} 個魔力指示物`);
        }
      },
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'cannotBeAttackTarget' && t === self && d.fieldCards().some((c) => c.faceUp && c.data.name.includes('恩底彌翁')),
    },
    {
      kind: 'quick',
      label: '取除自己場上 3 個魔力指示物：從手牌・墓地把 1 隻魔法師族怪獸在所連接區守備表示特殊召喚',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        inMainPhase(ctx.duel) &&
        ctx.duel.fieldCards(ctx.player).reduce((s, c) => s + c.counters, 0) >= 3 &&
        dharcZones(ctx).length > 0 &&
        seleneCands(ctx).length > 0,
      cost: async (ctx) => {
        let need = 3;
        for (const c of [ctx.card, ...ctx.duel.fieldCards(ctx.player)]) {
          const k = Math.min(need, c.counters);
          c.counters -= k;
          need -= k;
          if (!need) break;
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const zones = dharcZones(ctx);
        const c = await d.selectOne({ player: ctx.player, title: '選擇魔法師族怪獸', cards: seleneCands(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c && zones.length) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card, zones });
      },
      ai: () => 70,
    },
  ],
});
const seleneCands = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter((c) => isMonster(c.data) && (c.data.race & RACE.SPELLCASTER) !== 0 && canRevive(c));

// 禪那之追儺儀姬
def(7594154, {
  aiSummonValue: () => 3400,
  link: { min: 2, filter: (c) => isMonster(c.data) && (c.data.type & 0x20) !== 0, handMaterial: true },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚：從牌組把 1 隻怪獸送去墓地（只用場上的怪獸為素材的場合也能從額外牌組）',
      once: 'name',
      condition: (ctx) => summonedSelf(ctx, ['link']),
      operation: async (ctx) => {
        const d = ctx.duel;
        const onlyField = (ctx.card.summonMaterials ?? []).every((m) => m.controller === ctx.player && m.location !== 'hand' && !m.flags.fromHandMaterial);
        const pool = [...d.p(ctx.player).deck.filter((c) => isMonster(c.data)), ...(onlyField ? d.p(ctx.player).extra.filter((c) => !c.faceUp) : [])];
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => ((x.data.desc.match(/墓地/g) ?? []).length * 100) + x.data.atk / 100 });
        if (!c) return;
        d.sendToGrave([c], 'effect', ctx.card);
        if (c.location === 'grave' && d.p(ctx.player).deck.includes(c)) d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從場上送去墓地：下次的自己準備階段，從墓地把 1 隻怪獸加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone',
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        const after = d.turn;
        const by = ctx.card;
        d.listeners.push((ev) => {
          if (ev.type !== 'standby' || ev.player !== p || d.turn <= after) return false;
          const pool = d.p(p).grave.filter((c) => isMonster(c.data));
          if (pool.length) {
            const c = [...pool].sort((a, b) => cardValue(d, b, p) - cardValue(d, a, p))[0];
            d.returnToHand([c], 'effect', by);
          }
          return true;
        });
      },
      ai: () => 80,
    },
  ],
});

void (null as unknown as ChainLink);
