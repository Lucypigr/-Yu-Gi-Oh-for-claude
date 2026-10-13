// ZEXAL・超量（第四彈）：我我我・隆隆隆・怒怒怒・刷拉拉、光子・銀河眼、No. 系列
import { Card } from '../card';
import { ATTR, RACE, getCard, isMonster, isSpell, isVanilla, isXyz, isExtraDeckCard } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import {
  activate,
  canRevive,
  cardValue,
  chooseTargets,
  deckFilter,
  equipSpell,
  equipStat,
  searchDeck,
  simulateBattle,
  ssFromDeck,
  statAura,
  summonedSelf,
  tgt,
  tgts,
} from './lib';

const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const named = (prefix: string) => (c: Card) => c.data.nameEn.startsWith(prefix);
const isGagaga = named('Gagaga');
const isGogogo = named('Gogogo');
const isDododo = named('Dododo');
/** 「光子」或「銀河」卡 */
const isPhotonGalaxy = (c: Card) => /Photon|Galaxy/.test(c.data.nameEn);
const GALAXY_EYES = 93717133;
const UTOPIA = 84013237;
const PHOTON_TOKEN = 17418745;

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const noSynchroMaterial = () => false;
/** 用效果特殊召喚的怪獸（不是通常召喚・上級召喚・反轉召喚） */
const isSpecialSummoned = (c: Card) => !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);
/** 自己的這張卡攻擊過 */
const attackedThisTurn = (c: Card) => c.attacks > 0;

/** 取除超量素材的起動效果 */
function detach(n: number, e: Omit<EffectDef, 'kind' | 'cost'> & { kind?: 'ignition' | 'quick' }): EffectDef {
  return {
    kind: 'ignition',
    once: 'turn',
    ...e,
    condition: (ctx) => ctx.card.overlays.length >= n && (e.condition ? e.condition(ctx) : true),
    cost: async (ctx) => {
      ctx.duel.detachMaterials(ctx.card, n);
    },
  };
}

/** 戰鬥階段結束時，攻擊過的這張卡變成守備表示 */
const defAfterAttack: EffectDef = {
  kind: 'trigger',
  event: 'battlePhaseEnd',
  mandatory: true,
  condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.position === 'atk' && attackedThisTurn(ctx.card),
  operation: async (ctx) => {
    if (ctx.card.isFaceUpMonster) ctx.duel.changePosition(ctx.card, 'def');
  },
};

/** 額外牌組中，等級 lv 有能超量召喚的怪獸 */
const hasRankInExtra = (duel: Duel, p: PlayerId, lv: number) => duel.p(p).extra.some((c) => isXyz(c.data) && c.data.level === lv);

// =====================================================================
// 我我我・隆隆隆・怒怒怒・刷拉拉
// =====================================================================

// 我我我魔術師：宣言 1～8 的等級
def(26082117, {
  synchroMaterialRestriction: noSynchroMaterial,
  effects: [
    {
      kind: 'ignition',
      label: '宣言等級（1～8）',
      once: 'turn',
      categories: ['stat'],
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const others = d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && !isXyz(c.data));
        const score = (lv: number) =>
          (others.some((c) => d.getLevel(c) === lv) && hasRankInExtra(d, ctx.player, lv) ? 10 : 0) + (hasRankInExtra(d, ctx.player, lv) ? 1 : 0);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '宣言等級',
          card: ctx.card,
          options: [1, 2, 3, 4, 5, 6, 7, 8].map((lv) => ({ label: `${lv} 星`, ai: score(lv) })),
        });
        const lv = i + 1;
        d.addMod(ctx.card, { level: lv - d.getLevel(ctx.card), until: 'endTurn' });
        d.log(`「${ctx.card.name}」的等級變成 ${lv} 星`);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const own = d.getLevel(ctx.card);
        return d
          .faceUpMonsters(ctx.player)
          .some((c) => c !== ctx.card && !isXyz(c.data) && d.getLevel(c) !== own && hasRankInExtra(d, ctx.player, d.getLevel(c)))
          ? 45
          : 0;
      },
    },
  ],
});

// 我我我少女
def(3606728, {
  effects: [
    {
      kind: 'ignition',
      label: '等級變成和「我我我魔術師」相同',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === 26082117 && ctx.duel.getLevel(c) !== ctx.duel.getLevel(ctx.card)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.id === 26082117), {
          title: '選擇「我我我魔術師」',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.card.isFaceUpMonster)
          ctx.duel.addMod(ctx.card, { level: ctx.duel.getLevel(t) - ctx.duel.getLevel(ctx.card), until: 'permanent' });
      },
      ai: (ctx) => {
        const m = ctx.duel.faceUpMonsters(ctx.player).find((c) => c.id === 26082117);
        return m && hasRankInExtra(ctx.duel, ctx.player, ctx.duel.getLevel(m)) ? 40 : 0;
      },
    },
  ],
  // 只用「我我我」怪獸超量召喚時：對方 1 隻特殊召喚的怪獸攻擊力變成 0
  asXyzMaterial: async (duel, xyz) => {
    if (!xyz.overlays.every(isGagaga)) return;
    const p = xyz.controller;
    const cands = duel.faceUpMonsters(opp(p)).filter(isSpecialSummoned);
    if (!cands.length) return;
    const t = await duel.selectOne({ player: p, title: '選擇攻擊力變成 0 的怪獸（我我我少女）', cards: cands, hint: 'harm' });
    if (t) {
      duel.addMod(t, { setAtk: 0, until: 'permanent' }, xyz);
      duel.log(`「${t.name}」的攻擊力變成 0`);
    }
  },
});

// 我我我守衛者
def(12423762, {
  effects: [
    {
      kind: 'trigger',
      label: '對方直接攻擊時從手牌特殊召喚',
      event: 'attackDeclared',
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        !!ctx.duel.battle &&
        ctx.duel.battle.attacker.controller === ctx.opp &&
        !ctx.duel.battle.target &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
    },
    {
      kind: 'trigger',
      label: '丟棄 1 張手牌：不會被這次戰鬥破壞',
      event: 'attackDeclared',
      condition: (ctx) => ctx.event?.target === ctx.card && ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.setFlag(ctx.card, 'battleIndestructible');
      },
      ai: (ctx) => {
        const sim = simulateBattle(ctx.duel);
        return sim?.targetDies ? 40 : 0;
      },
    },
  ],
});

// 隆隆隆石人：守備表示時 1 回合 1 次不會被戰鬥破壞
def(62476815, { effects: [selfQuery('battleIndesOnce', (_d, self) => self.position === 'def')] });

// 隆隆隆巨人
def(39695323, {
  effects: [
    {
      kind: 'trigger',
      label: '特殊召喚墓地的「隆隆隆」怪獸',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal', 'tribute']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isGogogo(c) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isGogogo(c) && canRevive(c)), {
          title: '選擇要特殊召喚的「隆隆隆」怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave' && ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card }) && ctx.card.isFaceUpMonster)
          ctx.duel.changePosition(ctx.card, 'def');
      },
    },
    defAfterAttack,
  ],
});

// 隆隆隆幽靈
def(56105047, {
  effects: [
    {
      kind: 'trigger',
      label: '特殊召喚墓地的「隆隆隆石人」',
      event: 'summoned',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        ctx.event?.summonType !== 'normal' &&
        ctx.event?.summonType !== 'tribute' &&
        ctx.event?.summonType !== 'flip' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => c.id === 62476815),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c.id === 62476815), { title: '選擇「隆隆隆石人」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave' && ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card }) && ctx.card.isFaceUpMonster)
          ctx.duel.changePosition(ctx.card, 'def');
      },
    },
  ],
});

// 怒怒怒戰士：可以不用解放召喚（原本攻擊力變成 1800）
def(83274244, {
  noTribute: {
    condition: () => true,
    apply: (duel, card) => {
      duel.addMod(card, { setAtk: 1800, until: 'permanent' });
      duel.log(`「${card.name}」的原本攻擊力變成 1800`);
    },
  },
});

// 刷拉拉騎士：攻擊表側守備表示怪獸的傷害步驟開始時破壞它
def(97896503, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker === ctx.card && !!b.target && b.target.faceUp && b.target.position === 'def';
      },
      operation: async (ctx) => {
        const t = ctx.duel.battle?.target;
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
    },
  ],
});

// 刷拉拉破壞者：給予戰鬥傷害後破壞攻擊力最低的怪獸
def(57036718, {
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters();
        if (!mons.length) return;
        const low = Math.min(...mons.map((c) => d.getAtk(c)));
        const cands = mons.filter((c) => d.getAtk(c) === low);
        const t = cands.length > 1 ? await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: cands }) : cands[0];
        if (t) await d.destroy([t], 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: -800, until: 'permanent' });
      },
    },
  ],
});

// 影蜥蜴：自己召喚 4 星怪獸時從手牌特殊召喚
def(94656263, {
  synchroMaterialRestriction: noSynchroMaterial,
  effects: [
    {
      kind: 'trigger',
      label: '從手牌特殊召喚',
      event: 'summoned',
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.event?.player === ctx.player &&
        (ctx.event.summonType === 'normal' || ctx.event.summonType === 'tribute') &&
        !!ctx.event.card &&
        ctx.event.card.data.level === 4 &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, summonType: 'special' });
      },
    },
  ],
});

// 哥布林德伯格
def(25259669, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌特殊召喚 4 星以下的怪獸',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.level <= 4 && !isExtraDeckCard(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.level <= 4 && !isExtraDeckCard(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: cands, hint: 'benefit' });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card }) && ctx.card.isFaceUpMonster && ctx.card.position === 'atk')
          d.changePosition(ctx.card, 'def');
      },
    },
  ],
});

// 英豪挑戰者 贈劍兵：以這張卡為素材的超量怪獸攻擊力上升 1000
def(34143852, {
  asXyzMaterial: async (duel, xyz) => {
    duel.addMod(xyz, { atk: 1000, until: 'permanent' });
    duel.log(`「${xyz.name}」的攻擊力上升 1000（英豪挑戰者 贈劍兵）`);
  },
});

// 英豪挑戰者 雙長槍兵
def(89774530, {
  synchroMaterialRestriction: noSynchroMaterial,
  effects: [
    {
      kind: 'trigger',
      label: '特殊召喚另 1 隻「雙長槍兵」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === 89774530),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => c.id === 89774530);
        const c = await d.selectOne({ player: ctx.player, title: '選擇「英豪挑戰者 雙長槍兵」', cards: cands, hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 救援兔
def(85138716, {
  effects: [
    {
      kind: 'ignition',
      label: '除外這張卡：從牌組特殊召喚 2 隻同名通常怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        if (ctx.duel.freeMZones(ctx.player) + 1 < 2) return false;
        const counts = new Map<number, number>();
        for (const c of ctx.duel.p(ctx.player).deck)
          if (isVanilla(c.data) && isMonster(c.data) && !isExtraDeckCard(c.data) && c.data.level <= 4) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
        return [...counts.values()].some((n) => n >= 2);
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) < 2) return;
        const pool = deckFilter(ctx, (dd) => isVanilla(dd) && isMonster(dd) && !isExtraDeckCard(dd) && dd.level <= 4);
        const twice = pool.filter((c) => pool.filter((x) => x.id === c.id).length >= 2);
        if (!twice.length) return;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻同名的通常怪獸',
          cards: twice,
          min: 2,
          max: 2,
          hint: 'benefit',
          validate: (s) => s.length === 2 && s[0].id === s[1].id,
          aiValue: (c) => c.data.atk,
        });
        if (sel.length !== 2 || sel[0].id !== sel[1].id) return;
        for (const c of sel) if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'destroyAtEnd');
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).extra.some((c) => isXyz(c.data) && c.data.level <= 4) ? 60 : 30),
    },
  ],
});

// 錘鯊：等級下降 1，從手牌特殊召喚水屬性 3 星以下
def(17201174, {
  effects: [
    {
      kind: 'ignition',
      label: '等級下降 1：特殊召喚水屬性 3 星以下',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && !isExtraDeckCard(c.data) && c.data.attribute & ATTR.WATER && c.data.level <= 3),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.addMod(ctx.card, { level: -1, until: 'permanent' });
        const cands = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && !isExtraDeckCard(c.data) && c.data.attribute & ATTR.WATER && c.data.level <= 3);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的水屬性怪獸', cards: cands, hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 45,
    },
  ],
});

// 粘鯊印魚：自己的魚族・海龍族・水族召喚時從手牌特殊召喚
def(20838380, {
  synchroMaterialRestriction: noSynchroMaterial,
  effects: [
    {
      kind: 'trigger',
      label: '從手牌特殊召喚',
      event: 'summoned',
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.event?.player === ctx.player &&
        (ctx.event.cards ?? []).some((c) => c.controller === ctx.player && c.data.race & (RACE.FISH | RACE.SEASERPENT | RACE.AQUA)) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 大顎鮫：攻擊過的話戰鬥階段結束時除外
def(51254277, {
  effects: [
    {
      kind: 'trigger',
      event: 'battlePhaseEnd',
      mandatory: true,
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && attackedThisTurn(ctx.card),
      operation: async (ctx) => {
        if (ctx.card.onField) ctx.duel.banish([ctx.card], 'effect', ctx.card);
      },
    },
  ],
});

// =====================================================================
// 光子・銀河
// =====================================================================

// 光子斬擊者
def(65367484, {
  spSummon: {
    label: '自己場上沒有怪獸時特殊召喚',
    condition: (duel, card) => duel.monsters(card.owner).length === 0,
  },
  effects: [selfQuery('cannotAttack', (duel, self) => duel.monsters(self.controller).some((c) => c !== self))],
});

// 光子粉碎者：攻擊的傷害步驟結束時變成守備表示
def(1362589, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      condition: (ctx) => ctx.event?.attacker === ctx.card && ctx.card.isFaceUpMonster && ctx.card.position === 'atk',
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.changePosition(ctx.card, 'def');
      },
    },
  ],
});

// 光子劍齒虎
def(80495985, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索「光子劍齒虎」',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['normal', 'flip']) && deckFilter(ctx, (d) => d.id === 80495985).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === 80495985);
      },
    },
    statAura(
      (duel, self, t) => t === self && !duel.faceUpMonsters(self.controller).some((c) => c !== self && c.id === 80495985),
      -800,
    ),
  ],
});

// 銀河眼光子龍：與對方怪獸戰鬥時，把兩者除外到戰鬥階段結束
const galaxyReturn = new WeakMap<Card, { selfStint: number; foe: Card; foeStint: number; foeOwner: PlayerId; bonus: number }>();
def(GALAXY_EYES, {
  spSummon: {
    label: '解放 2 隻攻擊力 2000 以上的怪獸特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).filter((c) => duel.getAtk(c) >= 2000).length >= 2,
    cost: async (duel, card) => {
      const cands = duel.faceUpMonsters(card.owner).filter((c) => duel.getAtk(c) >= 2000);
      const sel = await duel.select({ player: card.owner, title: '選擇 2 隻要解放的怪獸', cards: cands, min: 2, max: 2, hint: 'cost' });
      for (const c of sel) duel.moveTo(c, 'grave', { reason: 'tribute' });
    },
  },
  effects: [
    {
      kind: 'quick',
      label: '和對方怪獸一起除外',
      event: 'attackDeclared',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || b.negated || !b.target) return false;
        const foe = b.attacker === ctx.card ? b.target : b.target === ctx.card ? b.attacker : null;
        return !!foe && foe.controller === ctx.opp;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !ctx.card.onField) return;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        if (!foe?.onField) return;
        const bonus = isXyz(foe.data) ? foe.overlays.length * 500 : 0;
        const foeOwner = foe.owner;
        const out = d.banish([foe, ctx.card], 'effect', ctx.card);
        if (out.includes(ctx.card) && out.includes(foe))
          galaxyReturn.set(ctx.card, { selfStint: ctx.card.stint, foe, foeStint: foe.stint, foeOwner, bonus });
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return 0;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        if (!foe) return 0;
        const sim = simulateBattle(ctx.duel);
        const iLose = b.attacker === ctx.card ? sim?.attackerDies : sim?.targetDies;
        return iLose || (isXyz(foe.data) && foe.overlays.length > 0) ? 60 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'battlePhaseEnd',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) => {
        const r = galaxyReturn.get(ctx.card);
        return !!r && ctx.card.location === 'banished' && ctx.card.stint === r.selfStint;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const r = galaxyReturn.get(ctx.card);
        galaxyReturn.delete(ctx.card);
        if (!r) return;
        if (r.foe.location === 'banished' && r.foe.stint === r.foeStint) d.specialSummon(r.foe, r.foeOwner, { position: 'atk' });
        if (ctx.card.location === 'banished' && d.specialSummon(ctx.card, ctx.card.owner, { position: 'atk' })) {
          ctx.card.properlySummoned = true;
          if (r.bonus) d.addMod(ctx.card, { atk: r.bonus, until: 'permanent' });
        }
      },
    },
  ],
});

// 銀河騎士
def(35950025, {
  noTribute: { condition: (duel, card) => duel.faceUpMonsters(card.owner).some(isPhotonGalaxy) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.hasFlag(ctx.card, 'noTributeSummon') &&
        ctx.duel.p(ctx.player).grave.some((c) => c.id === GALAXY_EYES),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c.id === GALAXY_EYES), { title: '選擇「銀河眼光子龍」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: -1000, until: 'endTurn' });
        const t = tgt(ctx);
        if (t?.location === 'grave') d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 銀河魔導師
def(98555327, {
  effects: [
    {
      kind: 'ignition',
      label: '等級上升 4 星',
      once: 'turn',
      categories: ['stat'],
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { level: 4, until: 'endTurn' });
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const lv = d.getLevel(ctx.card) + 4;
        return d.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && d.getLevel(c) === lv) && hasRankInExtra(d, ctx.player, lv) ? 45 : 0;
      },
    },
    {
      kind: 'ignition',
      label: '解放這張卡：檢索「銀河」卡',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => d.nameEn.includes('Galaxy') && d.id !== 98555327).length > 0,
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.nameEn.includes('Galaxy') && d.id !== 98555327);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).normalSummons <= 0 && ctx.duel.phase === 'main2' ? 35 : 0),
    },
  ],
});

// 光子衍生物：不能攻擊
def(PHOTON_TOKEN, { effects: [selfQuery('cannotAttack')], synchroMaterialRestriction: noSynchroMaterial });

// =====================================================================
// 魔法・陷阱
// =====================================================================

// 超量禮物
def(72355441, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => {
        const xs = ctx.duel.faceUpMonsters(ctx.player).filter((c) => isXyz(c.data));
        return xs.length >= 2 && xs.reduce((s, c) => s + c.overlays.length, 0) >= 2;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (let i = 0; i < 2; i++) {
          const xs = d.faceUpMonsters(ctx.player).filter((c) => isXyz(c.data) && c.overlays.length > 0);
          if (!xs.length) return;
          const x = await d.selectOne({ player: ctx.player, title: '選擇要取除超量素材的怪獸', cards: xs, hint: 'cost', aiValue: (c) => c.overlays.length });
          if (x) d.detachMaterials(x, 1);
        }
        d.draw(ctx.player, 2);
      },
      ai: () => 55,
    }),
  ],
});

// 疊光再生：成為超量怪獸的超量素材
def(27068117, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => isXyz(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => isXyz(c.data)), {
          title: '選擇超量怪獸',
          hint: 'benefit',
          aiValue: (c) => (c.controller === ctx.player ? 1000 : -1000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.card.onField) ctx.duel.attachMaterial(t, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => isXyz(c.data)) ? 35 : 0),
    }),
  ],
});

// 銀河遠征
def(60222582, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isPhotonGalaxy(c) && ctx.duel.getLevel(c) >= 5) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (d) => isMonster(d) && /Photon|Galaxy/.test(d.nameEn) && d.level >= 5).length > 0,
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => /Photon|Galaxy/.test(d.nameEn) && d.level >= 5, { position: 'def' });
      },
      ai: () => 60,
    }),
  ],
});

// 光子聖域：特殊召喚 2 隻光子衍生物
const isLightMonster = (c: Card) => !!(c.data.attribute & ATTR.LIGHT);
def(17418744, {
  effects: [
    activate({
      categories: ['summon'],
      // 這張卡發動的回合，自己不是光屬性怪獸不能召喚・反轉召喚・特殊召喚
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) >= 2 && !ctx.duel.summonedOtherThan(ctx.player, isLightMonster, ['normal', 'flip', 'special']),
      cost: async (ctx) => {
        ctx.duel.addSummonLock(ctx.player, { kinds: ['normal', 'flip', 'special'], allow: isLightMonster });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) < 2) return;
        for (let i = 0; i < 2; i++) {
          const token = new Card(getCard(PHOTON_TOKEN), ctx.player);
          token.location = 'void';
          d.specialSummon(token, ctx.player, { position: 'def', by: ctx.card });
        }
      },
      ai: (ctx) =>
        ctx.duel.p(ctx.player).hand.some((c) => c.id === GALAXY_EYES) || ctx.duel.p(ctx.player).extra.some((c) => isXyz(c.data) && c.data.level === 4)
          ? 55
          : 25,
    }),
  ],
});

// 光子引導：從手牌特殊召喚 4 星以下的光屬性
const lightLow = (c: Card) => isMonster(c.data) && !isExtraDeckCard(c.data) && c.data.level <= 4 && !!(c.data.attribute & ATTR.LIGHT);
def(35848254, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some(lightLow),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇光屬性怪獸', cards: d.p(ctx.player).hand.filter(lightLow), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 45 : 0),
    }),
  ],
});

// 超量組件：攻擊力上升階級 × 200
def(13032689, {
  equipFilter: (_d, _s, t) => isXyz(t.data),
  effects: [equipSpell({ filter: (_d, _s, t) => isXyz(t.data) }), equipStat((_d, _s, t) => t.data.level * 200)],
});

// 擬聲連攜：丟棄 1 張，檢索 2 種不同的「刷拉拉」「我我我」「隆隆隆」「怒怒怒」怪獸
const ONOMATO = ['Zubaba', 'Gagaga', 'Gogogo', 'Dododo'];
const onomatoKind = (nameEn: string) => ONOMATO.findIndex((p) => nameEn.startsWith(p));
def(6595475, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card) && deckFilter(ctx, (d) => isMonster(d) && onomatoKind(d.nameEn) >= 0).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的手牌', cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card), hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, (dd) => isMonster(dd) && onomatoKind(dd.nameEn) >= 0);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇各 1 種，最多 2 張加入手牌',
          cards: cands,
          min: 1,
          max: 2,
          hint: 'benefit',
          validate: (s) => new Set(s.map((c) => onomatoKind(c.data.nameEn))).size === s.length,
        });
        const kinds = new Set<number>();
        for (const c of sel) {
          const k = onomatoKind(c.data.nameEn);
          if (kinds.has(k)) continue;
          kinds.add(k);
          d.addToHandFromDeck(c, ctx.card);
        }
      },
      ai: () => 50,
    }),
  ],
});

// 我我我電擊
def(17494901, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isGagaga) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 60 : 0),
    }),
  ],
});

// 怒怒怒抽卡
def(73866096, {
  effects: [
    activate({
      once: 'name',
      categories: ['draw'],
      condition: (ctx) =>
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.faceUpMonsters(ctx.player)].some((c) => c !== ctx.card && isDododo(c) && isMonster(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.faceUpMonsters(ctx.player)].filter((c) => c !== ctx.card && isDododo(c) && isMonster(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「怒怒怒」怪獸', cards: cands, hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isDododo(c)) ? 50 : 0),
    }),
  ],
});

// 超量蘇生：特殊召喚墓地的超量怪獸，這張卡成為素材
def(26708437, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isXyz(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isXyz(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的超量怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location === 'grave' && d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card }) && ctx.card.onField)
          d.attachMaterial(t, ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 50 : ctx.duel.battle ? 0 : 20),
    }),
  ],
});

// 奇妙超量：用自己場上的怪獸超量召喚
const xyzCandidates = (ctx: EffectContext) => ctx.duel.p(ctx.player).extra.filter((c) => isXyz(c.data) && ctx.duel.xyzMaterialSets(ctx.player, c).length > 0);
def(73860462, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => xyzCandidates(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要超量召喚的怪獸',
          cards: xyzCandidates(ctx),
          hint: 'benefit',
          aiValue: (x) => x.data.atk,
        });
        if (c) await d.xyzSummonByEffect(ctx.player, c);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer === ctx.opp && (d.phase === 'end' || !!d.battle)) return 55;
        return 0;
      },
    }),
  ],
});

// =====================================================================
// 超量怪獸
// =====================================================================

// 混沌No.39 希望皇 霍普雷
def(56840427, {
  xyz: { count: 3, filter: (c) => !!(c.data.attribute & ATTR.LIGHT), over: (c) => c.id === UTOPIA },
  effects: [
    detach(1, {
      label: '取除 1 個素材：攻擊力上升 500，對方怪獸下降 1000',
      once: undefined,
      categories: ['stat'],
      condition: (ctx) => ctx.duel.p(ctx.player).lp <= 1000 && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.p(ctx.player).lp > 1000) return;
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: 500, until: 'endTurn' });
        const t = await d.selectOne({ player: ctx.player, title: '選擇攻擊力下降 1000 的怪獸', cards: d.faceUpMonsters(ctx.opp), aiValue: (c) => d.getAtk(c) });
        if (t) d.addMod(t, { atk: -1000, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 50 : 0),
    }),
  ],
});

// No.50 黑玉米號
def(51735257, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：對方怪獸送去墓地，給予 1000 傷害',
      categories: ['damage'],
      condition: (ctx) => ctx.card.attacks === 0 && ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) <= ctx.duel.getAtk(ctx.card)),
      target: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'cannotAttack');
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp).filter((c) => ctx.duel.getAtk(c) <= ctx.duel.getAtk(ctx.card)), {
          title: '選擇要送去墓地的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && ctx.duel.sendToGrave([t], 'effect', ctx.card).length) ctx.duel.damage(ctx.opp, 1000, 'effect', ctx.card);
      },
      ai: () => 60,
    }),
  ],
});

// No.101 寂靜榮譽方舟騎士
def(48739166, {
  effects: [
    detach(2, {
      label: '取除 2 個素材：把對方特殊召喚的怪獸變成素材',
      once: 'name',
      categories: ['control'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk' && isSpecialSummoned(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk' && isSpecialSummoned(c)), {
          title: '選擇要成為超量素材的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.card.isFaceUpMonster && !ctx.duel.isImmune(t, ctx.card)) ctx.duel.attachMaterial(ctx.card, t);
      },
      ai: () => 65,
    }),
  ],
});

// No.103 神葬零娘 暮零
def(94380860, {
  effects: [
    detach(1, {
      kind: 'quick',
      label: '取除 1 個素材：破壞攻擊力改變的怪獸，抽 1 張',
      categories: ['destroy', 'draw'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk' && ctx.duel.getAtk(c) !== Math.max(0, c.data.atk)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk' && ctx.duel.getAtk(c) !== Math.max(0, c.data.atk)),
          { title: '選擇要破壞的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) },
        );
      },
      operation: async (ctx) => {
        if ((await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card)).length) ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 60,
    }),
  ],
});

// No.82 心園小龍
def(31437713, {
  effects: [
    selfQuery('cannotBeAttackTarget', (duel, self) => duel.spellTraps(self.controller).some((c) => c.faceUp && isSpell(c.data))),
    detach(1, {
      label: '取除 1 個素材：這張卡可以直接攻擊',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.card.attacks === 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.monsters(ctx.player)) if (c !== ctx.card) d.setFlag(c, 'cannotAttack');
        if (ctx.card.isFaceUpMonster) d.setFlag(ctx.card, 'directAttack');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mine = d.getAtk(ctx.card);
        const oppMax = Math.max(0, ...d.monsters(ctx.opp).map((c) => (c.faceUp ? d.getAtk(c) : 1500)));
        return d.monsters(ctx.opp).length && mine <= oppMax && ctx.card.position === 'atk' ? 45 : 0;
      },
    }),
  ],
});

// No.34 電算機獸 太位元組
def(32003338, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：得到對方 4 星以下怪獸的控制權',
      categories: ['control'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk' && ctx.duel.getLevel(c) <= 4 && !isXyz(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk' && ctx.duel.getLevel(c) <= 4 && !isXyz(c.data)),
          { title: '選擇要奪取的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.position === 'atk') ctx.duel.takeControl(t, ctx.player, true, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 55 : 0),
    }),
  ],
});

// No.10 白輝士 啟明者
def(11411223, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：丟 1 張手牌，抽 1 張',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (!c) return;
        d.moveTo(c, 'grave', { reason: 'effect', by: ctx.card });
        d.draw(ctx.player, 1);
      },
      ai: () => 30,
    }),
  ],
});

// No.62 銀河眼光子龍皇
const hasGalaxyEyesMaterial = (c: Card) => c.overlays.some((o) => o.id === GALAXY_EYES);
def(31801517, {
  effects: [
    {
      kind: 'quick',
      label: '取除 1 個素材：攻擊力上升超量怪獸階級合計 × 200',
      event: 'damageCalc',
      damageStep: true,
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && (b.attacker === ctx.card || b.target === ctx.card) && ctx.card.overlays.length > 0;
      },
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ranks = d.faceUpMonsters().filter((c) => isXyz(c.data)).reduce((s, c) => s + c.data.level, 0);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: ranks * 200, until: 'damageCalc' });
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const ranks = d.faceUpMonsters().filter((c) => isXyz(c.data)).reduce((s, c) => s + c.data.level, 0);
        const before = simulateBattle(d);
        const after = simulateBattle(d, ctx.card, ranks * 200);
        if (!before || !after) return 0;
        const mineIsAttacker = d.battle?.attacker === ctx.card;
        const iDieBefore = mineIsAttacker ? before.attackerDies : before.targetDies;
        const iDieAfter = mineIsAttacker ? after.attackerDies : after.targetDies;
        const foeDieBefore = mineIsAttacker ? before.targetDies : before.attackerDies;
        const foeDieAfter = mineIsAttacker ? after.targetDies : after.attackerDies;
        return (iDieBefore && !iDieAfter) || (!foeDieBefore && foeDieAfter) ? 70 : 0;
      },
    },
    selfQuery('halfBattleDamage', (_d, self) => !hasGalaxyEyesMaterial(self)),
  ],
});

// No.44 白天馬
def(80764541, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：破壞對方怪獸（對方可以支付 1000 基本分無效）',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇要破壞的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        if (d.p(ctx.opp).lp > 1000) {
          const pay = await d.confirm({
            player: ctx.opp,
            title: `支付 1000 基本分讓「${ctx.card.name}」的效果無效嗎？`,
            card: t,
            ai: d.p(ctx.opp).lp > 3000 && cardValue(d, t, ctx.opp) >= 2000,
          });
          if (pay) {
            d.payLP(ctx.opp, 1000);
            d.log('效果被無效');
            return;
          }
        }
        await d.destroy([t], 'effect', ctx.card);
      },
      ai: () => 55,
    }),
  ],
});

// No.52 鑽蟹王
def(7194917, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：攻擊力變成 3000，守備力變成 0',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.phase === 'main1',
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { setAtk: 3000, setDef: 0, until: 'endTurn' });
      },
      ai: (ctx) => (ctx.card.position === 'atk' && ctx.duel.turn > 1 ? 45 : 0),
    }),
    defAfterAttack,
  ],
});

// No.37 希望織龍 蜘蛛鯊
def(37279508, {
  xyz: { count: 2, filter: (c) => !!(c.data.attribute & ATTR.WATER) },
  effects: [
    detach(1, {
      kind: 'quick',
      label: '取除 1 個素材：對方全部怪獸攻擊力下降 1000',
      event: 'attackDeclared',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        for (const c of ctx.duel.faceUpMonsters(ctx.opp)) ctx.duel.addMod(c, { atk: -1000, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return 0;
        const delta = b.attacker.controller === ctx.opp ? -1000 : 0;
        const foe = b.attacker.controller === ctx.opp ? b.attacker : b.target;
        if (!foe) return b.attacker.controller === ctx.opp ? 40 : 0;
        const after = simulateBattle(ctx.duel, foe, delta || -1000);
        return after && (b.attacker.controller === ctx.opp ? after.attackerDies || after.dmgToDefender === 0 : after.targetDies) ? 55 : 0;
      },
    }),
    {
      kind: 'trigger',
      label: '特殊召喚墓地的怪獸',
      event: 'destroyed',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && canRevive(c)), {
          title: '選擇要特殊召喚的怪獸',
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

// No.25 重裝光學攝影機 焦點之力
def(64554883, {
  effects: [
    detach(1, {
      kind: 'quick',
      label: '取除 1 個素材：對方 5 星以上效果怪獸的效果無效',
      categories: ['negate'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => (c.data.type & 0x20) !== 0 && ctx.duel.getLevel(c) >= 5 && !ctx.duel.isNegated(c)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.opp).filter((c) => (c.data.type & 0x20) !== 0 && ctx.duel.getLevel(c) >= 5 && !ctx.duel.isNegated(c)),
          { title: '選擇要無效效果的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && !ctx.duel.isImmune(t, ctx.card)) {
          ctx.duel.setFlag(t, 'negated');
          ctx.duel.log(`「${t.name}」的效果直到回合結束時無效`);
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 45 : 0),
    }),
  ],
});

// 電光千鳥
def(22653490, {
  xyz: { count: 2, filter: (c) => !!(c.data.attribute & ATTR.WIND) },
  effects: [
    {
      kind: 'trigger',
      label: '對方蓋放的卡回到牌組最下面',
      event: 'summoned',
      mandatory: true,
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx, ['xyz']) && ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(ctx.opp).filter((c) => !c.faceUp), { title: '選擇對方蓋放的卡' });
      },
      operation: async (ctx) => {
        ctx.duel.returnToDeck(tgts(ctx), false, 'effect', ctx.card);
      },
    },
    detach(1, {
      label: '取除 1 個素材：對方表側的卡回到牌組最上面',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp).filter((c) => c.faceUp), {
          title: '選擇要回到牌組最上面的卡',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        ctx.duel.returnToDeck(tgts(ctx), true, 'effect', ctx.card);
      },
      ai: () => 55,
    }),
  ],
});

// 深淵的潛伏者：有水屬性素材時，自己的水屬性怪獸攻擊力上升 500
def(21044178, {
  effects: [
    statAura(
      (_d, self, t) => t.controller === self.controller && t.isFaceUpMonster && !!(t.data.attribute & ATTR.WATER) && self.overlays.some((o) => o.data.attribute & ATTR.WATER),
      500,
    ),
  ],
});

// 鳥銃士 卡斯泰爾
def(82633039, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：表側怪獸變成裡側守備表示',
      once: 'nameShared',
      categories: ['position'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => c !== ctx.card), {
          title: '選擇要變成裡側守備表示的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.changePosition(t, 'def', false, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= ctx.duel.getAtk(ctx.card)) ? 45 : 0),
    }),
    detach(2, {
      label: '取除 2 個素材：場上 1 張表側的卡回到牌組',
      once: 'nameShared',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.fieldCards().some((c) => c !== ctx.card && c.faceUp),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card && c.faceUp), {
          title: '選擇要回到牌組的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.returnToDeck(tgts(ctx), false, 'effect', ctx.card);
        d.shuffleDeck(ctx.opp);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp && cardValue(ctx.duel, c, ctx.player) >= 2400) ? 60 : 0),
    }),
  ],
});

// 龍神鯊：從額外牌組特殊召喚 3 階以下的水屬性超量怪獸
const lowWaterXyz = (c: Card) => isXyz(c.data) && c.data.level <= 3 && !!(c.data.attribute & ATTR.WATER);
def(440556, {
  xyz: { count: 2, filter: (c) => !!(c.data.attribute & ATTR.WATER) },
  effects: [
    detach(1, {
      label: '取除 1 個素材：特殊召喚 3 階以下的水屬性超量怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).extra.some((c) => lowWaterXyz(c) && ctx.duel.extraZones(ctx.player, c).length > 0),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.setFlag(ctx.card, 'cannotAttack');
        const cands = d.p(ctx.player).extra.filter(lowWaterXyz);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的超量怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) c.properlySummoned = true;
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' || ctx.duel.monsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 2600) ? 45 : 0),
    }),
  ],
});

// 輝光公子 帕拉迪奧斯
def(61344030, {
  xyz: { count: 2, filter: (c) => !!(c.data.attribute & ATTR.LIGHT) },
  effects: [
    detach(2, {
      label: '取除 2 個素材：對方怪獸攻擊力變成 0，效果無效',
      categories: ['negate', 'stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || d.isImmune(t, ctx.card)) return;
        d.addMod(t, { setAtk: 0, until: 'permanent' }, ctx.card);
        d.setFlag(t, 'negated', true);
        d.log(`「${t.name}」的攻擊力變成 0，效果無效`);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 2000) ? 55 : 0),
    }),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        ctx.event.from === 'mzone' &&
        !!ctx.event.by &&
        ctx.event.by.controller !== ctx.player,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 我我我槍手
def(12014404, {
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        const b = duel.battle;
        if (!b || !b.damageStep || b.attacker !== self || !b.target || !duel.hasFlag(self, 'cowboy')) return null;
        if (t === self) return { atk: 1000 };
        if (t === b.target) return { atk: -500 };
        return null;
      },
    },
    detach(1, {
      label: '取除 1 個素材：攻擊時強化／守備時給予 800 傷害',
      categories: ['damage', 'stat'],
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        if (ctx.card.position === 'def') d.damage(ctx.opp, 800, 'effect', ctx.card);
        else d.setFlag(ctx.card, 'cowboy');
      },
      ai: (ctx) => (ctx.card.position === 'def' ? 60 : ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.opp).length > 0 ? 40 : 0),
    }),
  ],
});

// 我我我侍
def(91499077, {
  effects: [
    detach(1, {
      label: '取除 1 個素材：「我我我」怪獸可以攻擊 2 次',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).some(isGagaga),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isGagaga), {
          title: '選擇「我我我」怪獸',
          hint: 'benefit',
          aiValue: (c) => ctx.duel.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.setFlag(t, 'doubleAttack');
      },
      ai: (ctx) => (ctx.duel.turn > 1 ? 40 : 0),
    }),
  ],
});

// 刷拉拉將軍：把手牌的戰士族怪獸裝備，攻擊力上升它的攻擊力
def(31563350, {
  effects: [
    statAura(
      (_d, self, t) => t === self,
      (duel, self) => duel.equipsOf(self).filter((c) => isMonster(c.data)).reduce((s, c) => s + Math.max(0, c.data.atk), 0),
    ),
    detach(1, {
      label: '取除 1 個素材：裝備手牌的戰士族怪獸',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.freeSZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.race & RACE.WARRIOR),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || d.freeSZones(ctx.player) <= 0) return;
        const cands = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.race & RACE.WARRIOR);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要裝備的戰士族怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
        d.equip(c, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 45 : 0),
    }),
  ],
});

// 鐵皮大公
def(66506689, {
  effects: [
    detach(1, {
      kind: 'quick',
      label: '取除 1 個素材：改變對方怪獸的表示形式',
      categories: ['position'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), {
          title: '選擇要改變表示形式的怪獸',
          aiValue: (c) => (c.position === 'atk' ? ctx.duel.getAtk(c) - ctx.duel.getDef(c) : ctx.duel.getDef(c) - ctx.duel.getAtk(c)),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        // 對方攻擊時把攻擊怪獸變成守備表示
        if (b && b.attacker.controller === ctx.opp && !b.damageStep) return 60;
        if (d.turnPlayer === ctx.player && d.phase === 'main1')
          return d.faceUpMonsters(ctx.opp).some((c) => c.position === 'def' && d.getAtk(c) < 1500 && d.getDef(c) > d.getAtk(c)) ? 40 : 0;
        return 0;
      },
    }),
  ],
});
