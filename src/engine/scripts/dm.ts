// 第七彈：初代經典 — 青眼・真紅眼・黑魔術師・鷹身女郎
import type { Card } from '../card';
import { ATTR, RACE, isMonster, isNamed, isSpell, isTrap, isTuner, isVanilla } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import {
  activate,
  bestBoostTarget,
  canRevive,
  cardValue,
  chooseTargets,
  deckFilter,
  equipSpell,
  equipStat,
  searchDeck,
  ssFromDeck,
  statAura,
  summonedSelf,
  tgt,
  tgts,
} from './lib';
import { ritualSpell } from './spells';

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const isDragon = (c: Card) => isMonster(c.data) && (c.data.race & RACE.DRAGON) !== 0;
const isSpellcaster = (c: Card) => isMonster(c.data) && (c.data.race & RACE.SPELLCASTER) !== 0;
const isWarrior = (c: Card) => isMonster(c.data) && (c.data.race & RACE.WARRIOR) !== 0;
const isEffect = (c: Card) => isMonster(c.data) && (c.data.type & 0x20) !== 0;
const dragonsInGrave = (duel: Duel, p: PlayerId) => duel.p(p).grave.filter(isDragon).length;

/** 被選為攻擊對象時 */
const targetedForAttack = (ctx: EffectContext) => ctx.duel.battle?.target === ctx.card && ctx.duel.battle.attacker.controller === ctx.opp;

/** 從手牌・牌組・墓地選 1 張 */
const fromHDG = (duel: Duel, p: PlayerId, f: (c: Card) => boolean) =>
  [...duel.p(p).hand, ...duel.p(p).deck, ...duel.p(p).grave].filter((c) => f(c) && (c.location !== 'grave' || canRevive(c)));

/** 把怪獸卡當作裝備卡裝備給 target（龍騎士的裝備、真紅眼幼龍） */
function equipMonsterAsCard(duel: Duel, card: Card, target: Card, p: PlayerId): boolean {
  if (duel.freeSZones(p) <= 0 || !target.isFaceUpMonster) return false;
  if (!duel.moveTo(card, 'szone', { reason: 'effect', player: p, faceUp: true })) return false;
  return duel.equip(card, target);
}

// =====================================================================
// 青眼
// =====================================================================

const BEWD = 89631139;
const isBEWD = (c: Card) => isNamed(c.data, BEWD);
const isBlueEyes = (c: Card) => isMonster(c.data) && (c.data.nameEn.includes('Blue-Eyes') || c.id === 45467446);

// 青眼光龍
def(53347303, {
  spSummon: {
    label: '解放「青眼究極龍」特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => c.id === 23995346 || c.id === 56532353),
    cost: async (duel, card) => {
      const cands = duel.faceUpMonsters(card.owner).filter((c) => c.id === 23995346 || c.id === 56532353);
      const c = await duel.selectOne({ player: card.owner, title: '選擇要解放的「青眼究極龍」', cards: cands, hint: 'cost' });
      if (c) duel.moveTo(c, 'grave', { reason: 'tribute' });
    },
  },
  effects: [
    statAura((_d, self, t) => t === self, (duel, self) => 300 * dragonsInGrave(duel, self.controller)),
    {
      kind: 'quick',
      label: '以這張卡為對象的效果無效',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.player === ctx.opp && ctx.duel.targetsOf(top.ctx).includes(ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        if (ctx.data.link) ctx.duel.negateLink(ctx.data.link);
      },
      ai: () => 80,
    },
  ],
});

// 青眼亞白龍
def(38517737, {
  spSummon: {
    label: '給對方看手牌的「青眼白龍」特殊召喚',
    condition: (duel, card) => !duel.p(card.owner).turnFlags.alternativeSummoned && duel.p(card.owner).hand.some((c) => c.id === BEWD),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.alternativeSummoned = true;
      duel.log(`${duel.p(card.owner).name} 展示手牌的「青眼白龍」`);
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '破壞對方 1 隻怪獸（這張卡這回合不能攻擊）',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.attacks === 0 && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'cannotAttack');
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要破壞的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const best = Math.max(0, ...d.monsters(ctx.opp).map((c) => cardValue(d, c, ctx.player)));
        return best >= 2000 || d.monsters(ctx.opp).length > 1 ? 60 : 0;
      },
    },
  ],
});

// 白色靈龍
def(45467446, {
  effects: [
    {
      kind: 'trigger',
      label: '除外對方 1 張魔法・陷阱卡',
      event: 'summoned',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.spellTraps(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(ctx.opp), { title: '選擇要除外的魔法・陷阱卡' });
      },
      operation: async (ctx) => {
        ctx.duel.banish(tgts(ctx), 'effect', ctx.card);
      },
    },
    {
      kind: 'quick',
      label: '解放：從手牌特殊召喚「青眼白龍」',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0 && ctx.duel.p(ctx.player).hand.some((c) => c.id === BEWD),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = d.p(ctx.player).hand.find((x) => x.id === BEWD);
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 45 : 0),
    },
  ],
});

// 蒼眼銀龍
def(40908371, {
  synchro: { nonTuner: (c) => isVanilla(c.data) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      condition: (ctx) => summonedSelf(ctx) && ctx.event?.summonType !== 'normal',
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters(ctx.player).filter(isDragon)) d.setFlag(c, 'effectIndestructible', d.turn + 1);
        d.log('自己的龍族怪獸到下個回合結束時不會被效果破壞');
      },
    },
    {
      kind: 'trigger',
      label: '特殊召喚墓地的通常怪獸',
      event: 'standby',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.event?.player === ctx.player &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isVanilla(c.data) && isMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isVanilla(c.data) && isMonster(c.data)), {
          title: '選擇要特殊召喚的通常怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 青眼雙爆裂龍：也可以把場上的 2 隻「青眼白龍」送去墓地特殊召喚
def(2129638, {
  spSummon: {
    label: '把場上 2 隻「青眼白龍」送去墓地特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).filter(isBEWD).length >= 2,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 2 隻「青眼白龍」',
        cards: duel.faceUpMonsters(card.owner).filter(isBEWD),
        min: 2,
        max: 2,
        hint: 'cost',
      });
      duel.sendToGrave(sel, 'cost');
    },
  },
  effects: [
    selfQuery('battleIndestructible'),
    selfQuery('doubleAttack'),
    {
      kind: 'trigger',
      label: '除外沒有被破壞的怪獸',
      event: 'damageStepEnd',
      categories: ['banish'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && !!ctx.event.target?.onField,
      operation: async (ctx) => {
        const t = ctx.event?.target;
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
    },
  ],
});

// 真青眼究極龍（融合素材自動）
def(56532353, {});

// 青眼混沌極龍
def(55410871, {
  effects: [
    {
      kind: 'continuous',
      query: (duel, self, q, t) => q === 'effectIndestructible' && t === self,
    },
    selfQuery('piercing'),
    selfQuery('doubleBattleDamage', (duel, self) => duel.battle?.attacker === self && duel.battle.target?.position === 'def'),
  ],
});

// 混沌形態：可以從墓地除外「青眼白龍」「黑魔術師」代替解放
def(
  21082832,
  ritualSpell([55410871, 5405694, 30208479], { graveBanish: (c) => c.id === BEWD || c.id === 46986414 }),
);

// 青色眼睛的賢士
def(8240199, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索光屬性 1 星調整',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        deckFilter(ctx, (d) => isTuner(d) && d.level === 1 && (d.attribute & ATTR.LIGHT) !== 0 && d.id !== 8240199).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isTuner(d) && d.level === 1 && (d.attribute & ATTR.LIGHT) !== 0 && d.id !== 8240199);
      },
    },
    {
      kind: 'ignition',
      label: '從手牌丟棄：自己的效果怪獸送去墓地，從牌組特殊召喚「青眼」',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some(isEffect) && ctx.duel.p(ctx.player).deck.some(isBlueEyes),
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isEffect), {
          title: '選擇要送去墓地的效果怪獸',
          hint: 'cost',
          aiValue: (c) => -cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField) return;
        d.sendToGrave([t], 'effect', ctx.card);
        await ssFromDeck(ctx, (dd) => dd.nameEn.includes('Blue-Eyes') || dd.id === 45467446);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => isEffect(c) && c.data.level <= 2) ? 60 : 0),
    },
  ],
});

// 青色眼睛的少女：被攻擊時攻擊無效，特殊召喚「青眼白龍」
def(88241506, {
  effects: [
    {
      kind: 'trigger',
      label: '攻擊無效，特殊召喚「青眼白龍」',
      event: 'attackDeclared',
      once: 'name',
      categories: ['negate', 'summon'],
      condition: (ctx) => targetedForAttack(ctx) && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.negateAttack();
        if (ctx.card.isFaceUpMonster) d.changePosition(ctx.card, ctx.card.position === 'atk' ? 'def' : 'atk');
        const cands = fromHDG(d, ctx.player, (c) => c.id === BEWD);
        if (!cands.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「青眼白龍」', cards: cands, hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 太古的白石
def(71039903, {
  effects: [
    {
      kind: 'trigger',
      label: '從牌組特殊召喚「青眼」怪獸',
      event: 'endPhase',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.card.movedTurn === ctx.duel.turn &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).deck.some(isBlueEyes),
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => d.nameEn.includes('Blue-Eyes') || d.id === 45467446);
      },
    },
    {
      kind: 'ignition',
      label: '除外：墓地的「青眼」怪獸加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.movedTurn !== ctx.duel.turn && ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isBlueEyes(c)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(isBlueEyes), { title: '選擇「青眼」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: () => 40,
    },
  ],
});

// 復活之福音
def(6853254, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isDragon(c) && (c.data.level === 7 || c.data.level === 8) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isDragon(c) && (c.data.level === 7 || c.data.level === 8) && canRevive(c)), {
          title: '選擇 7・8 星的龍族怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 60,
    }),
  ],
});

// 正義的同伴 海馬俠
def(34627841, {
  effects: [
    {
      kind: 'ignition',
      label: '解放：從手牌特殊召喚「青眼白龍」',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c.id === BEWD),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        const c = ctx.duel.p(ctx.player).hand.find((x) => x.id === BEWD);
        if (c) ctx.duel.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 65,
    },
  ],
});

// 白龍之聖騎士
def(73398797, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker === ctx.card && !!b.target && !b.target.faceUp;
      },
      operation: async (ctx) => {
        const t = ctx.duel.battle?.target;
        if (t?.onField && !t.faceUp) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
    },
    {
      kind: 'ignition',
      label: '解放：從手牌・牌組特殊召喚「青眼白龍」',
      categories: ['summon'],
      condition: (ctx) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === BEWD),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === BEWD);
        const c = await d.selectOne({ player: ctx.player, title: '選擇「青眼白龍」', cards: cands, hint: 'benefit' });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'cannotAttack');
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' || ctx.duel.monsters(ctx.opp).length === 0 ? 50 : 20),
    },
  ],
});

// =====================================================================
// 真紅眼
// =====================================================================

const REBD = 74677422;
const isREBD = (c: Card) => isNamed(c.data, REBD);
const isRE = (c: Card) => isMonster(c.data) && c.data.nameEn.includes('Red-Eyes');

// 金屬化·魔法反射裝甲
def(68540058, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇要裝備的怪獸',
          hint: 'benefit',
          aiValue: (c) => (c.controller === ctx.player ? 1000 + (isREBD(c) ? 3000 : 0) + ctx.duel.getAtk(c) : -1000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.card.onField && ctx.duel.equip(ctx.card, t)) ctx.data.keepOnField = true;
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.faceUpMonsters(ctx.player).some(isREBD) && d.p(ctx.player).deck.some((c) => c.id === 64335804)) return 60;
        return bestBoostTarget(d, ctx.player, 300) ? 50 : 0;
      },
    }),
    equipStat(300, 300),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      statMod: (duel, self, t) => {
        const b = duel.battle;
        if (!b || !b.damageStep || self.equipTarget !== t || self.equipStint !== t.stint || b.attacker !== t || !b.target) return null;
        return { atk: Math.floor(duel.getAtk(b.target) / 2) };
      },
    },
    {
      kind: 'ignition',
      label: '解放裝備的「真紅眼黑龍」：從牌組特殊召喚真紅眼黑鋼龍',
      range: ['szone'],
      categories: ['summon'],
      condition: (ctx) => {
        const t = ctx.card.equipTarget;
        return (
          !!t && t.stint === ctx.card.equipStint && t.controller === ctx.player && isREBD(t) && ctx.duel.p(ctx.player).deck.some((c) => c.id === 64335804)
        );
      },
      cost: async (ctx) => {
        const t = ctx.card.equipTarget;
        if (t) ctx.duel.moveTo(t, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => d.id === 64335804);
      },
      ai: () => 60,
    },
  ],
});

// 真紅眼黑鋼龍（金屬化的效果特殊召喚）
def(64335804, {});

// 真紅眼暗龍
def(96561011, {
  spSummon: {
    label: '解放「真紅眼黑龍」特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some(isREBD),
    cost: async (duel, card) => {
      const c = await duel.selectOne({ player: card.owner, title: '選擇「真紅眼黑龍」', cards: duel.faceUpMonsters(card.owner).filter(isREBD), hint: 'cost' });
      if (c) duel.moveTo(c, 'grave', { reason: 'tribute' });
    },
  },
  effects: [statAura((_d, self, t) => t === self, (duel, self) => 300 * dragonsInGrave(duel, self.controller))],
});

// 真紅眼暗鋼龍
def(88264978, {
  spSummon: {
    label: '除外自己場上 1 隻龍族怪獸特殊召喚',
    condition: (duel, card) => !duel.p(card.owner).turnFlags.redmdSummoned && duel.faceUpMonsters(card.owner).some(isDragon),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.redmdSummoned = true;
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要除外的龍族怪獸',
        cards: duel.faceUpMonsters(card.owner).filter(isDragon),
        hint: 'cost',
      });
      if (c) duel.banish([c], 'cost', card);
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '從手牌・墓地特殊召喚龍族怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => isDragon(c) && c.id !== 88264978 && (c.location === 'hand' || canRevive(c))),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter(
          (c) => isDragon(c) && c.id !== 88264978 && (c.location === 'hand' || canRevive(c)),
        );
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的龍族怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 60,
    },
  ],
});

// 真紅眼飛龍：結束階段除外，蘇生「真紅眼」怪獸
def(67300516, {
  effects: [
    {
      kind: 'trigger',
      label: '除外：特殊召喚墓地的「真紅眼」怪獸',
      event: 'endPhase',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.duel.turnPlayer === ctx.player &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isRE(c) && canRevive(c)) &&
        // 這張卡的效果發動的回合，自己不能通常召喚
        !ctx.duel.normalSummonedThisTurn(ctx.player),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
        ctx.duel.p(ctx.player).normalSummons = 0;
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRE(c) && canRevive(c)), {
          title: '選擇「真紅眼」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 黑龍之雛
def(36262024, {
  effects: [
    {
      kind: 'ignition',
      label: '送去墓地：從手牌特殊召喚「真紅眼黑龍」',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c.id === REBD),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        const c = ctx.duel.p(ctx.player).hand.find((x) => x.id === REBD);
        if (c) ctx.duel.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 65,
    },
  ],
});

// 真紅眼看破
const isRESpellTrap = (d: { nameEn: string; type: number }) => d.nameEn.includes('Red-Eyes') && (d.type & 0x6) !== 0;
def(92353449, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some(isRE) &&
        deckFilter(ctx, (d) => isRESpellTrap(d) && d.id !== 92353449).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「真紅眼」怪獸',
          cards: [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter(isRE),
          hint: 'cost',
          aiValue: (x) => (x.location === 'deck' ? 1000 : 0) - x.data.atk / 10,
        });
        if (c) d.sendToGrave([c], 'cost');
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isRESpellTrap(d) && d.id !== 92353449);
      },
      ai: () => 50,
    }),
  ],
});

// 真紅眼之魂
def(44397496, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isRE(c) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRE(c) && canRevive(c)), {
          title: '選擇「真紅眼」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 55 : ctx.duel.battle?.attacker.controller === ctx.opp && !ctx.duel.battle.target ? 60 : 0),
    }),
  ],
});

// 真紅眼燒滅
def(71782404, {
  effects: [
    activate({
      event: 'destroyed',
      once: 'name',
      categories: ['damage'],
      condition: (ctx) =>
        (ctx.event?.cards ?? [ctx.event?.card]).some((c) => !!c && isRE(c) && (ctx.event?.prevController ?? c.owner) === ctx.player && ctx.event?.wasFaceUp !== false),
      operation: async (ctx) => {
        const d = ctx.duel;
        const list = (ctx.event?.cards ?? [ctx.event?.card]).filter((c): c is Card => !!c && isRE(c));
        const atk = Math.max(0, ...list.map((c) => c.data.atk));
        d.damage(ctx.opp, atk, 'effect', ctx.card);
        d.damage(ctx.player, atk, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const list = (ctx.event?.cards ?? [ctx.event?.card]).filter((c): c is Card => !!c && isRE(c));
        const atk = Math.max(0, ...list.map((c) => c.data.atk));
        return ctx.duel.p(ctx.opp).lp <= atk || ctx.duel.p(ctx.player).lp > ctx.duel.p(ctx.opp).lp + atk ? 60 : 0;
      },
    }),
  ],
});

// 真紅眼鐵騎士-基亞·弗里德
def(85651167, {
  effects: [
    {
      kind: 'ignition',
      label: '破壞裝備卡，再破壞對方 1 張魔法・陷阱',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.equipsOf(ctx.card).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!(await d.destroy(d.equipsOf(ctx.card), 'effect', ctx.card)).length) return;
        const sts = d.spellTraps(ctx.opp);
        if (!sts.length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的魔法・陷阱卡', cards: sts });
        if (c) await d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length && ctx.duel.equipsOf(ctx.card).every((c) => c.controller === ctx.opp || !isSpell(c.data)) ? 50 : 0),
    },
    {
      kind: 'ignition',
      label: '把裝備卡送去墓地：特殊召喚墓地 7 星以下的「真紅眼」',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.equipsOf(ctx.card).some((c) => c.controller === ctx.player) &&
        ctx.duel.p(ctx.player).grave.some((c) => isRE(c) && c.data.level <= 7 && canRevive(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的裝備卡', cards: d.equipsOf(ctx.card).filter((x) => x.controller === ctx.player), hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRE(c) && c.data.level <= 7 && canRevive(c)), {
          title: '選擇「真紅眼」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 55,
    },
  ],
});

// 真紅眼黑刃龍
def(21140872, {
  fusion: [(d) => isNamed(d, REBD), (d) => isMonster(d) && (d.race & RACE.WARRIOR) !== 0],
  effects: [
    statAura((_d, self, t) => t === self, (duel, self) => 200 * duel.equipsOf(self).filter((c) => isWarrior(c)).length),
    {
      kind: 'trigger',
      label: '把墓地的戰士族當作裝備卡裝備',
      event: 'attackDeclared',
      categories: ['stat'],
      condition: (ctx) => {
        const a = ctx.duel.battle?.attacker;
        return (
          ctx.card.isFaceUpMonster &&
          !!a &&
          a.controller === ctx.player &&
          isRE(a) &&
          ctx.duel.freeSZones(ctx.player) > 0 &&
          ctx.duel.p(ctx.player).grave.some(isWarrior)
        );
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(isWarrior), { title: '選擇戰士族怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave' && ctx.card.isFaceUpMonster) equipMonsterAsCard(ctx.duel, t, ctx.card, ctx.player);
      },
    },
  ],
});

// 真紅眼幼龍：被戰鬥破壞時特殊召喚「真紅眼」，這張卡成為攻擊力上升 300 的裝備卡
def(58257569, {
  effects: [
    {
      kind: 'trigger',
      label: '從牌組特殊召喚 7 星以下的「真紅眼」',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'battle' &&
        ctx.card.location === 'grave' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).deck.some((c) => isRE(c) && c.data.level <= 7),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await ssFromDeck(ctx, (dd) => dd.nameEn.includes('Red-Eyes') && dd.level <= 7);
        if (c && ctx.card.location === 'grave') equipMonsterAsCard(d, ctx.card, c, ctx.player);
      },
    },
    {
      kind: 'continuous',
      activeIn: ['szone'],
      statMod: (_d, self, t) => (self.equipTarget === t && self.equipStint === t.stint ? { atk: 300 } : null),
    },
  ],
});

// 真紅眼的鎧旋
def(39387565, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 35 : 0) }),
    {
      kind: 'ignition',
      label: '特殊召喚墓地的通常怪獸',
      range: ['szone'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.faceUpMonsters(ctx.player).some(isRE) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isVanilla(c.data) && isMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isVanilla(c.data) && isMonster(c.data)), {
          title: '選擇通常怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 55,
    },
    {
      kind: 'trigger',
      label: '特殊召喚墓地的「真紅眼」怪獸',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.opp &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isRE(c) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRE(c) && canRevive(c)), { title: '選擇「真紅眼」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// =====================================================================
// 黑魔術師
// =====================================================================

const DM = 46986414;
const DMG = 38033121;
const isDM = (c: Card) => isNamed(c.data, DM);
const isMagicianGirl = (c: Card) => isMonster(c.data) && (c.data.nameEn.includes('Magician Girl') || c.data.name.includes('魔術少女'));
/** 有「黑魔術師」卡名記述的魔法・陷阱 */
const mentionsDM = (d: { desc: string; type: number }) => (d.type & 0x6) !== 0 && d.desc.includes('「黑魔術師」');

// 黑魔術騎士
def(50725996, {
  effects: [
    {
      kind: 'trigger',
      label: '破壞場上 1 張卡',
      event: 'summoned',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 騎士的稱號
def(87210505, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isDM) && fromHDG(ctx.duel, ctx.player, (c) => c.id === 50725996).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的「黑魔術師」', cards: d.faceUpMonsters(ctx.player).filter(isDM), hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === 50725996);
        const c = await d.selectOne({ player: ctx.player, title: '選擇「黑魔術騎士」', cards: cands, hint: 'benefit' });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) c.properlySummoned = true;
        d.shuffleDeck(ctx.player);
      },
      ai: () => 60,
    }),
  ],
});

// 龍騎士 黑魔術師：自己的魔法・陷阱不會被效果破壞
def(41721210, {
  fusion: [(d) => isNamed(d, DM), (d) => isMonster(d) && (d.race & RACE.DRAGON) !== 0],
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'effectIndestructible' && !!t && t.controller === self.controller && t.location === 'szone',
    },
  ],
});

// 超魔導師-黑魔術師徒
def(50237654, {
  fusion: [(d) => isNamed(d, DM) || d.id === DMG, (d) => isMonster(d) && (d.race & RACE.SPELLCASTER) !== 0],
  effects: [
    {
      kind: 'trigger',
      label: '魔法・陷阱的效果發動時抽 1 張',
      event: 'activated',
      once: 'turn',
      categories: ['draw'],
      condition: (ctx) => ctx.card.isFaceUpMonster && !!ctx.event?.card && (isSpell(ctx.event.card.data) || isTrap(ctx.event.card.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const [c] = d.draw(ctx.player, 1);
        if (c && (isSpell(c.data) || isTrap(c.data)) && d.freeSZones(ctx.player) > 0) {
          const set = await d.confirm({ player: ctx.player, title: `要把「${c.name}」蓋放嗎？`, card: c, ai: true });
          if (set) {
            d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false });
            c.turnPlaced = 0; // 盖放的回合也能發動
          }
        }
      },
    },
    {
      kind: 'trigger',
      label: '特殊召喚「黑魔術師」和「黑魔術少女」',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const id of [DM, DMG]) {
          if (d.freeMZones(ctx.player) <= 0) break;
          const cands = fromHDG(d, ctx.player, (c) => c.id === id);
          if (!cands.length) continue;
          const c = await d.selectOne({ player: ctx.player, title: `選擇「${id === DM ? '黑魔術師' : '黑魔術少女'}」`, cards: cands, hint: 'benefit' });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 龍騎士 黑魔術少女
def(43892408, {
  fusion: [(d) => d.id === DMG, (d) => isMonster(d) && (d.race & RACE.DRAGON) !== 0],
  effects: [
    {
      kind: 'quick',
      label: '丟棄 1 張：破壞場上 1 張表側的卡',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.fieldCards().some((c) => c.faceUp && c !== ctx.card),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c.faceUp && c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp && cardValue(ctx.duel, c, ctx.player) >= 1800) ? 55 : 0),
    },
  ],
});

/** 魔術少女：被選為攻擊對象時，叫出另一隻怪獸並轉移攻擊，攻擊怪獸的攻擊力減半 */
function magicianGirlSwap(label: string, cands: (ctx: EffectContext) => Card[], negate = false): EffectDef {
  return {
    kind: 'trigger',
    label,
    event: 'attackDeclared',
    once: 'turn',
    categories: ['summon'],
    condition: (ctx) => targetedForAttack(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && cands(ctx).length > 0,
    operation: async (ctx) => {
      const d = ctx.duel;
      const list = cands(ctx);
      const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的魔法師族', cards: list, hint: 'benefit', aiValue: (x) => x.data.def + x.data.atk });
      if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: negate })) return;
      const b = d.battle;
      if (!b) return;
      d.changeAttackTarget(c);
      if (b.attacker.isFaceUpMonster) d.addMod(b.attacker, { setAtk: Math.floor(d.getAtk(b.attacker) / 2), until: 'endTurn' }, ctx.card);
    },
  };
}

// 檸檬魔術少女
def(34318086, {
  effects: [
    {
      kind: 'ignition',
      label: '解放其他「魔術少女」：檢索魔法師族',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.player).some((c) => c !== ctx.card && c.faceUp && isMagicianGirl(c) && c.id !== 34318086) &&
        deckFilter(ctx, (d) => isMonster(d) && (d.race & RACE.SPELLCASTER) !== 0).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的「魔術少女」',
          cards: d.monsters(ctx.player).filter((x) => x !== ctx.card && x.faceUp && isMagicianGirl(x) && x.id !== 34318086),
          hint: 'cost',
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && (d.race & RACE.SPELLCASTER) !== 0);
      },
      ai: () => 0,
    },
    magicianGirlSwap('從手牌特殊召喚魔法師族並轉移攻擊', (ctx) => ctx.duel.p(ctx.player).hand.filter(isSpellcaster), true),
  ],
});

// 巧克力魔術少女
def(7198399, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄魔法師族：抽 1 張',
      once: 'turn',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some(isSpellcaster),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的魔法師族', cards: d.p(ctx.player).hand.filter(isSpellcaster), hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.filter(isSpellcaster).length >= 2 ? 40 : 0),
    },
    magicianGirlSwap('蘇生墓地的魔法師族並轉移攻擊', (ctx) =>
      ctx.duel.p(ctx.player).grave.filter((c) => isSpellcaster(c) && c.id !== 7198399 && canRevive(c)),
    ),
  ],
});

// 漿果魔術少女
def(20747792, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索「魔術少女」',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['normal']) && ctx.duel.p(ctx.player).deck.some(isMagicianGirl),
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && (d.nameEn.includes('Magician Girl') || d.name.includes('魔術少女')));
      },
    },
    {
      kind: 'trigger',
      label: '改變表示形式，從牌組特殊召喚「魔術少女」',
      event: 'attackDeclared',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        targetedForAttack(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).deck.some((c) => isMagicianGirl(c) && c.id !== 20747792),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.isFaceUpMonster) d.changePosition(ctx.card, ctx.card.position === 'atk' ? 'def' : 'atk');
        await ssFromDeck(ctx, (dd) => (dd.nameEn.includes('Magician Girl') || dd.name.includes('魔術少女')) && dd.id !== 20747792);
      },
    },
  ],
});

// 蘋果魔術少女
def(56132807, {
  effects: [
    magicianGirlSwap('從手牌特殊召喚 5 星以下的魔法師族並轉移攻擊', (ctx) => ctx.duel.p(ctx.player).hand.filter((c) => isSpellcaster(c) && c.data.level <= 5)),
    {
      kind: 'trigger',
      label: '墓地最多 3 隻「魔術少女」加入手牌',
      event: 'destroyed',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isMagicianGirl(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 3 隻「魔術少女」（同名最多 1 張）',
          cards: d.p(ctx.player).grave.filter((c) => c !== ctx.card && isMagicianGirl(c)),
          min: 1,
          max: 3,
          hint: 'benefit',
          validate: (s) => new Set(s.map((c) => c.id)).size === s.length,
        });
        const seen = new Set<number>();
        for (const c of sel) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
        }
      },
    },
  ],
});

// 奇異果魔術少女
def(82627406, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：「魔術少女」攻守上升',
      range: ['hand'],
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isMagicianGirl),
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const kinds = new Set(
          [...d.faceUpMonsters(), ...d.p(0).grave, ...d.p(1).grave].filter(isMagicianGirl).map((c) => c.id),
        ).size;
        for (const c of d.faceUpMonsters(ctx.player).filter(isMagicianGirl)) d.addMod(c, { atk: 300 * kinds, def: 300 * kinds, until: 'endTurn' });
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return 0;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        return mine && isMagicianGirl(mine) && bestBoostTarget(ctx.duel, ctx.player, 600) ? 60 : 0;
      },
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'effectIndestructible' && !!t && t.controller === self.controller && isSpellcaster(t),
    },
  ],
});

// 黑幻想之魔術師：對方回合自己發動魔法・陷阱時，從手牌特殊召喚
def(35191415, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌特殊召喚',
      event: 'activated',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.duel.turnPlayer === ctx.opp &&
        ctx.event?.player === ctx.player &&
        !!ctx.event.card &&
        (isSpell(ctx.event.card.data) || isTrap(ctx.event.card.data)) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 魔術師之杖
def(7084129, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索有「黑魔術師」記述的魔法・陷阱',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['normal']) && deckFilter(ctx, mentionsDM).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, mentionsDM);
      },
    },
  ],
});

// 永遠之魂
def(48680970, {
  onLeaveField: (duel, self) => {
    const mons = duel.monsters(self.controller);
    if (mons.length) {
      duel.log(`「${self.name}」離場，自己場上的怪獸全部破壞`);
      duel.queueDestroy(mons, 'effect', self);
    }
  },
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 35 : 0) }),
    {
      kind: 'quick',
      label: '特殊召喚「黑魔術師」或檢索「黑·魔·導」「千把刀」',
      range: ['szone'],
      once: 'name',
      categories: ['summon', 'search'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ((ctx.duel.freeMZones(ctx.player) > 0 && [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === DM)) ||
          ctx.duel.p(ctx.player).deck.some((c) => c.id === 2314238 || c.id === 63391643)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const dms = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => c.id === DM);
        const canSS = dms.length > 0 && d.freeMZones(ctx.player) > 0;
        const canSearch = d.p(ctx.player).deck.some((c) => c.id === 2314238 || c.id === 63391643);
        const mode =
          canSS && canSearch
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [{ label: '特殊召喚「黑魔術師」', ai: 2 }, { label: '檢索「黑·魔·導」或「千把刀」', ai: 1 }],
              })
            : canSS
              ? 0
              : 1;
        if (mode === 0) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇「黑魔術師」', cards: dms, hint: 'benefit' });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        } else {
          await searchDeck(ctx, (dd) => dd.id === 2314238 || dd.id === 63391643);
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 55 : ctx.duel.phase === 'end' ? 40 : 0),
    },
  ],
});

// 黑·魔·導·連·彈
def(70168345, {
  effects: [
    activate({
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isDM),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isDM), { title: '選擇「黑魔術師」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const girls = [...d.faceUpMonsters(), ...d.p(0).grave, ...d.p(1).grave].filter((c) => c.id === DMG);
        const sum = girls.reduce((s, c) => s + (c.location === 'mzone' ? d.getAtk(c) : c.data.atk), 0);
        d.addMod(t, { atk: sum, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const girls = [...d.faceUpMonsters(), ...d.p(0).grave, ...d.p(1).grave].filter((c) => c.id === DMG).length;
        if (!girls) return 0;
        const t = d.faceUpMonsters(ctx.player).find(isDM);
        return t && (bestBoostTarget(d, ctx.player, 2000) === t || (d.phase === 'main1' && d.monsters(ctx.opp).length === 0)) ? 60 : 0;
      },
    }),
  ],
});

// 師徒的牽絆
def(60709218, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some(isDM) && ctx.duel.freeMZones(ctx.player) > 0 && fromHDG(ctx.duel, ctx.player, (c) => c.id === DMG).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「黑魔術少女」', cards: fromHDG(d, ctx.player, (x) => x.id === DMG), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        const sets = d.p(ctx.player).deck.filter((x) => x.id === 2314238 || x.id === 70168345);
        if (sets.length && d.freeSZones(ctx.player) > 1) {
          const s = await d.selectOne({ player: ctx.player, title: '選擇要蓋放的魔法卡（可以不選）', cards: sets, hint: 'benefit' });
          if (s) d.moveTo(s, 'szone', { reason: 'effect', player: ctx.player, faceUp: false });
        }
        d.shuffleDeck(ctx.player);
      },
      ai: () => 60,
    }),
  ],
});

// =====================================================================
// 鷹身女郎
// =====================================================================

const HARPIE_LADY = 76812113;
const SISTERS = 12206212;
const isHarpieLady = (c: Card) => isNamed(c.data, HARPIE_LADY);
const isHarpie = (c: Card) => c.data.nameEn.includes('Harpie');
const isHarpieMonster = (c: Card) => isHarpie(c) && isMonster(c.data);
const ladiesOrSisters = (c: Card) => isHarpieLady(c) || c.id === SISTERS;

// 鷹身女郎三姐妹（萬華鏡的效果特殊召喚）
def(SISTERS, {});
// 鷹身女郎 電子緊身裝束（卡名當作「鷹身女郎」）
def(80316585, {});
// 鷹身女郎2
def(27927359, {});

// 鷹身女妖的寵物龍
def(52040216, {
  effects: [
    statAura(
      (_d, self, t) => t === self,
      (duel) => 300 * duel.faceUpMonsters().filter(isHarpieLady).length,
      (duel) => 300 * duel.faceUpMonsters().filter(isHarpieLady).length,
    ),
  ],
});

// 鷹身女郎1：場上的風屬性怪獸攻擊力上升 300
def(91932350, { effects: [statAura((_d, _s, t) => t.isFaceUpMonster && (t.data.attribute & ATTR.WIND) !== 0, 300)] });

// 鷹身女郎3：戰鬥的對方怪獸在對方 2 個回合內不能攻擊
def(54415063, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      condition: (ctx) => {
        const foe = ctx.event?.attacker === ctx.card ? ctx.event.target : ctx.event?.target === ctx.card ? ctx.event.attacker : null;
        return !!foe && foe.onField && foe.controller === ctx.opp;
      },
      operation: async (ctx) => {
        const foe = ctx.event?.attacker === ctx.card ? ctx.event.target : ctx.event?.attacker;
        if (foe?.onField) {
          ctx.duel.setFlag(foe, 'cannotAttack', ctx.duel.turn + 4);
          ctx.duel.log(`「${foe.name}」在對方的 2 個回合內不能攻擊`);
        }
      },
    },
  ],
});

// 鷹身女妖的狩獵場
def(75782277, {
  effects: [
    activate({ label: '發動', ai: () => 35 }),
    statAura((_d, _s, t) => t.isFaceUpMonster && (t.data.race & RACE.WINGEDBEAST) !== 0, 200, 200, ['fzone']),
    {
      kind: 'trigger',
      label: '破壞場上 1 張魔法・陷阱卡',
      event: 'summoned',
      range: ['fzone'],
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.location === 'fzone' &&
        ctx.card.faceUp &&
        ctx.event?.player === ctx.player &&
        (ctx.event.cards ?? []).some(ladiesOrSisters) &&
        ctx.duel.spellTraps().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 鷹身女妖的寵物仔龍
const otherHarpies = (duel: Duel, self: Card) => duel.faceUpMonsters(self.controller).filter((c) => c !== self && isHarpieMonster(c) && c.id !== 6924874).length;
def(6924874, {
  effects: [
    {
      kind: 'continuous',
      query: (duel, self, q, t) =>
        q === 'cannotBeAttackTarget' && !!t && t !== self && t.controller === self.controller && isHarpieMonster(t) && t.id !== 6924874 && otherHarpies(duel, self) >= 1,
    },
    statAura(
      (duel, self, t) => t === self && otherHarpies(duel, self) >= 2,
      (_d, self) => self.data.atk,
      (_d, self) => self.data.def,
    ),
  ],
});

// 鷹身女王：從手牌丟棄，檢索狩獵場
def(75064463, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌丟棄：檢索「鷹身女妖的狩獵場」',
      range: ['hand'],
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.some((c) => c.id === 75782277),
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === 75782277);
      },
      ai: (ctx) => (!ctx.duel.p(ctx.player).fzone ? 45 : 0),
    },
  ],
});

// 鷹身通靈師
def(90238142, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄「鷹身」卡：從牌組特殊召喚「鷹身」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.some(isHarpie) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).deck.some((c) => isHarpieMonster(c) && c.id !== 90238142),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的「鷹身」卡', cards: d.p(ctx.player).hand.filter(isHarpie), hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => d.nameEn.includes('Harpie') && d.id !== 90238142, { position: 'def' });
      },
      ai: () => 50,
    },
  ],
});

// 鷹身舞者：風屬性怪獸回到手牌，再召喚 1 隻風屬性怪獸
def(68815132, {
  effects: [
    {
      kind: 'ignition',
      label: '風屬性怪獸回到手牌，可以再召喚',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => (c.data.attribute & ATTR.WIND) !== 0),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => (c.data.attribute & ATTR.WIND) !== 0), {
          title: '選擇要回到手牌的風屬性怪獸',
          hint: 'cost',
          aiValue: (c) => (c === ctx.card ? 500 : 0) - c.data.level * 100,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.returnToHand(tgts(ctx), 'effect', ctx.card).length) {
          d.p(ctx.player).normalSummons++;
          d.log('這回合可以再召喚 1 次');
        }
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isHarpieMonster(c) && c.data.level <= 4) ? 35 : 0),
    },
  ],
});

// 鷹身豎琴師
def(56585883, {
  effects: [
    {
      kind: 'trigger',
      label: '自己的鳥獸族和對方怪獸回到手牌',
      event: 'summoned',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && (c.data.race & RACE.WINGEDBEAST) !== 0) &&
        ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await d.selectOne({
          player: ctx.player,
          title: '選擇自己的鳥獸族怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && (c.data.race & RACE.WINGEDBEAST) !== 0),
          hint: 'cost',
        });
        const theirs = await d.selectOne({ player: ctx.player, title: '選擇對方的怪獸', cards: d.faceUpMonsters(ctx.opp), aiValue: (c) => cardValue(d, c, ctx.player) });
        d.setTargets(ctx, [mine, theirs].filter((c): c is Card => !!c));
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '檢索攻擊力 1500 以下的鳥獸族',
      event: 'endPhase',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.card.movedTurn === ctx.duel.turn &&
        deckFilter(ctx, (d) => isMonster(d) && (d.race & RACE.WINGEDBEAST) !== 0 && d.atk <= 1500).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && (d.race & RACE.WINGEDBEAST) !== 0 && d.atk <= 1500);
      },
    },
  ],
});

// 萬華鏡-華麗的分身-
def(90219263, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters().some(isHarpieLady) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === HARPIE_LADY || c.id === SISTERS),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === HARPIE_LADY || c.id === SISTERS);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card }) && c.id === SISTERS) c.properlySummoned = true;
        d.shuffleDeck(ctx.player);
      },
      ai: () => 60,
    }),
  ],
});

// 歇斯底里的簽訂
const hystericUsed = (ctx: EffectContext) => ctx.duel.p(ctx.player).usedNames[19337371] === ctx.duel.turn;
def(19337371, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => !hystericUsed(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.p(ctx.player).usedNames[19337371] = d.turn;
        const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === 90219263);
        if (!cands.length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「萬華鏡-華麗的分身-」', cards: cands, hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: () => 50,
    }),
    {
      kind: 'trigger',
      label: '檢索最多 3 張「鷹身」卡',
      event: 'endPhase',
      mandatory: true,
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.card.movedTurn === ctx.duel.turn &&
        (ctx.card.movedFrom === 'hand' || ctx.card.movedFrom === 'szone') &&
        !hystericUsed(ctx) &&
        ctx.duel.p(ctx.player).deck.some(isHarpie),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.p(ctx.player).usedNames[19337371] = d.turn;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 3 張「鷹身」卡（同名最多 1 張）',
          cards: d.p(ctx.player).deck.filter(isHarpie),
          min: 1,
          max: 3,
          hint: 'benefit',
          validate: (s) => new Set(s.map((c) => c.id)).size === s.length,
        });
        const seen = new Set<number>();
        for (const c of sel) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          d.addToHandFromDeck(c, ctx.card);
        }
      },
    },
  ],
});

// 鷹身女郎 -鳳凰之陣-
def(86308219, {
  effects: [
    activate({
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).filter(ladiesOrSisters).length >= 3 && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const n = d.faceUpMonsters(ctx.player).filter(ladiesOrSisters).length;
        d.p(ctx.player).turnFlags.cannotDeclareAttack = true;
        await chooseTargets(ctx, d.monsters(ctx.opp), {
          title: `選擇最多 ${n} 隻對方的怪獸`,
          min: Math.min(n, d.monsters(ctx.opp).length),
          max: n,
          aiValue: (c) => cardValue(d, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const done = (await d.destroy(tgts(ctx), 'effect', ctx.card));
        const atk = Math.max(0, ...done.map((c) => c.data.atk));
        if (atk) d.damage(ctx.opp, atk, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2' ? 70 : 0),
    }),
  ],
});

// 三角神迷火花
def(12181376, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c.id === SISTERS),
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters().filter((x) => x.id === SISTERS)) d.addMod(c, { setAtk: 2700, until: 'endTurn' }, ctx.card);
        d.p(ctx.opp).turnFlags.cannotActivateTraps = true;
        d.log('這回合對方不能發動陷阱卡');
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === SISTERS) ? 55 : 0),
    }),
  ],
});

// 電子緊身衣
const cyberShield: CardScript = {
  equipFilter: (_d, _s, t) => ladiesOrSisters(t),
  effects: [equipSpell({ filter: (_d, _s, t) => ladiesOrSisters(t) }), equipStat(500)],
};
def(63224564, cyberShield);
