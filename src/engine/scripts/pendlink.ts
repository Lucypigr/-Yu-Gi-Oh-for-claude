// 靈擺・連結・電子界族（第三彈）
import type { Card } from '../card';
import { ATTR, RACE, isLink, isMonster, isPendulum, isVanilla, isExtraDeckCard, isToken } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import { bestBoostTarget, cardValue, chooseTargets, deckFilter, searchDeck, ssFromDeck, statAura, summonedSelf, tgt, tgts } from './lib';

const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** 在靈擺區域表側存在 */
const inPendZone = (c: Card) => c.location === 'szone' && c.faceUp && (c.zone === 0 || c.zone === 4);
/** 另一邊的自己的靈擺區域的卡 */
const otherScale = (duel: Duel, self: Card) => {
  const z = duel.p(self.controller).szone;
  const o = self.zone === 0 ? z[4] : z[0];
  return o && o.faceUp && isPendulum(o.data) ? o : null;
};
const isNormalMonster = (c: Card) => isVanilla(c.data) && !isExtraDeckCard(c.data) && !isToken(c.data);
const isCyberse = (c: Card) => (c.data.race & RACE.CYBERSE) !== 0;
const isEffectMonster = (c: Card) => (c.data.type & 0x20) !== 0;
const battleHas = (duel: Duel, pred: (c: Card) => boolean) => {
  const b = duel.battle;
  return !!b && (pred(b.attacker) || (!!b.target && pred(b.target)));
};

/** 自己的靈擺區域的卡發動的起動效果 */
function pendIgnition(e: Omit<EffectDef, 'kind' | 'range'>): EffectDef {
  return {
    kind: 'ignition',
    range: ['szone'],
    ...e,
    condition: (ctx) => inPendZone(ctx.card) && (e.condition ? e.condition(ctx) : true),
  };
}

// =====================================================================
// 靈擺
// =====================================================================

// 點火騎士：另一邊有點火騎士時，破壞自己的靈擺區域，檢索戰士族・炎屬性
const IGKNIGHTS = [24131534, 61639289, 97024987, 24019092, 50407691, 96802306, 67273917, 93662626];
const warriorFire = (c: Card) => isMonster(c.data) && !!(c.data.race & RACE.WARRIOR) && !!(c.data.attribute & ATTR.FIRE);
for (const id of IGKNIGHTS) {
  def(id, {
    effects: [
      pendIgnition({
        label: '破壞靈擺區域：檢索戰士族・炎屬性',
        categories: ['destroy', 'search'],
        condition: (ctx) => {
          const o = otherScale(ctx.duel, ctx.card);
          return !!o && o.data.nameEn.startsWith('Igknight');
        },
        operation: async (ctx) => {
          const d = ctx.duel;
          const [l, r] = d.pendulumScales(ctx.player);
          d.destroy([l, r].filter((c): c is Card => !!c), 'effect', ctx.card);
          const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter(warriorFire);
          if (!cands.length) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇戰士族・炎屬性怪獸加入手牌', cards: cands, hint: 'benefit' });
          if (!c) return;
          const fromDeck = c.location === 'deck';
          d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
          if (fromDeck) d.shuffleDeck(ctx.player);
          d.log(`「${c.name}」加入手牌`);
        },
        ai: (ctx) => (ctx.duel.p(ctx.player).turnFlags.pendulumSummoned ? 45 : 0),
      }),
    ],
  });
}

// 龍魔王 魔道矢·靈擺
def(69512157, { negateOppScales: true });

// 龍劍士 卓輝星·靈擺
def(75195825, {
  effects: [
    pendIgnition({
      label: '破壞靈擺區域的 1 張卡',
      categories: ['destroy'],
      condition: (ctx) => !ctx.card.flags.dracoslayerUsed && [0, 1].some((p) => ctx.duel.pendulumScales(p as PlayerId).some((c) => c)),
      cost: async (ctx) => {
        ctx.card.flags.dracoslayerUsed = true;
      },
      target: async (ctx) => {
        const cands = ([0, 1] as PlayerId[]).flatMap((p) => ctx.duel.pendulumScales(p)).filter((c): c is Card => !!c);
        await chooseTargets(ctx, cands, { title: '選擇靈擺區域的卡' });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.pendulumScales(ctx.opp).some((c) => c) ? 45 : 0),
    }),
  ],
});

// 龍角的狩獵者
def(21970285, {
  effects: [
    statAura((_d, _s, t) => t.isFaceUpMonster && isNormalMonster(t), 200, 0, ['szone']),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (duel, self, q, _t, player) =>
        q === 'noBattleDamage' && player === self.controller && battleHas(duel, (c) => c.controller === self.controller && isNormalMonster(c)),
    },
  ],
});

// 德拉科尼亞的翼龍騎兵
def(68182934, {
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) =>
        inPendZone(ctx.card) &&
        ctx.event?.player === ctx.opp &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.player &&
        isNormalMonster(ctx.event.by) &&
        ctx.duel.fieldCards().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(), { title: '選擇要破壞的卡' });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 傅科魔炮石
def(43785278, {
  effects: [
    {
      kind: 'trigger',
      event: 'endPhase',
      categories: ['destroy'],
      condition: (ctx) =>
        inPendZone(ctx.card) && ctx.card.turnPlaced === ctx.duel.turn && ctx.duel.spellTraps().some((c) => c.faceUp && c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => c.faceUp && c !== ctx.card), { title: '選擇表側表示的魔法・陷阱卡' });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 槍頭喙嘴龍
def(48940337, {
  effects: [
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) => q === 'piercing' && !!t && t.controller === self.controller && isNormalMonster(t),
    },
  ],
});

// 德拉科尼亞的獸龍騎兵
def(73779005, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) =>
        inPendZone(ctx.card) &&
        ctx.event?.reason === 'battle' &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.player &&
        isNormalMonster(ctx.event.by) &&
        ctx.event.prevController === ctx.opp &&
        deckFilter(ctx, (d) => isMonster(d) && isVanilla(d) && d.level >= 4 && !isExtraDeckCard(d)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && isVanilla(d) && d.level >= 4 && !isExtraDeckCard(d), 1, '選擇 4 星以上的通常怪獸');
      },
    },
  ],
});

// 召喚師 萊斯貝爾特
def(45103815, {
  effects: [
    pendIgnition({
      label: '怪獸等級上升 1 星',
      once: 'turn',
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => !isLink(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => !isLink(c.data)), { title: '選擇等級上升的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) {
          ctx.duel.addMod(t, { level: 1, until: 'permanent' }, ctx.card);
          ctx.duel.log(`「${t.name}」等級上升 1 星`);
        }
      },
      ai: () => 0,
    }),
  ],
});

/** 擲骰子改變刻度（溫火雞・鬼牛肉） */
function diceScale(id: number, sign: 1 | -1) {
  def(id, {
    effects: [
      pendIgnition({
        label: sign < 0 ? '擲骰子：刻度下降' : '擲骰子：刻度上升',
        once: 'turn',
        operation: async (ctx) => {
          const d = ctx.duel;
          const n = d.random(6) + 1;
          const base = ctx.card.data.scale ?? 0;
          const target = sign < 0 ? Math.max(1, base - n) : Math.min(10, base + n);
          ctx.card.flags.scaleDelta = target - base;
          ctx.card.flags.scaleTurn = d.turn;
          d.log(`骰子點數：${n}，「${ctx.card.name}」的刻度變成 ${target}`);
        },
        ai: () => 0,
      }),
    ],
  });
}
diceScale(47558785, -1); // 溫火雞
diceScale(84046493, 1); // 鬼牛肉

// 德拉科尼亞的海龍騎兵
def(82114013, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        inPendZone(ctx.card) &&
        ctx.event?.reason === 'battle' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some(isNormalMonster),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的通常怪獸', cards: d.p(ctx.player).hand.filter(isNormalMonster), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: await d.choosePosition(ctx.player, c), by: ctx.card });
      },
    },
  ],
});

/** 龍穴・龍脈之魔術師 */
function magicianPend(id: number, targetMonsters: boolean) {
  def(id, {
    effects: [
      pendIgnition({
        label: targetMonsters ? '丟棄靈擺怪獸：破壞表側怪獸' : '丟棄靈擺怪獸：破壞魔法・陷阱',
        once: 'turn',
        categories: ['destroy'],
        condition: (ctx) => {
          const o = otherScale(ctx.duel, ctx.card);
          const cands = targetMonsters ? ctx.duel.faceUpMonsters() : ctx.duel.spellTraps().filter((c) => c !== ctx.card);
          return !!o && o.data.nameEn.includes('Magician') && ctx.duel.p(ctx.player).hand.some((c) => isPendulum(c.data)) && cands.length > 0;
        },
        cost: async (ctx) => {
          const c = await ctx.duel.selectOne({
            player: ctx.player,
            title: '選擇要丟棄的靈擺怪獸',
            cards: ctx.duel.p(ctx.player).hand.filter((x) => isPendulum(x.data)),
            hint: 'cost',
          });
          if (c) ctx.duel.discard([c], 'cost');
        },
        target: async (ctx) => {
          const cands = targetMonsters ? ctx.duel.faceUpMonsters() : ctx.duel.spellTraps().filter((c) => c !== ctx.card);
          await chooseTargets(ctx, cands, { title: '選擇要破壞的卡' });
        },
        operation: async (ctx) => {
          ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
        },
        ai: (ctx) =>
          (targetMonsters ? ctx.duel.faceUpMonsters(ctx.opp) : ctx.duel.spellTraps(ctx.opp)).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1500)
            ? 45
            : 0,
      }),
    ],
  });
}
magicianPend(51531505, false); // 龍穴之魔術師
magicianPend(15146890, true); // 龍脈之魔術師

const magicianOrOddEyes = (c: Card | null) => !!c && (c.data.nameEn.includes('Magician') || c.data.nameEn.includes('Odd-Eyes'));
/** 另一邊沒有魔術師或異色眼時，刻度變成 4 */
const gazerScale = (duel: Duel, self: Card) => (inPendZone(self) && !magicianOrOddEyes(otherScale(duel, self)) ? 4 : undefined);
const ownPendulumBattling = (duel: Duel, self: Card) => battleHas(duel, (c) => c.controller === self.controller && isPendulum(c.data));

// 異色眼靈擺龍
def(16178681, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'doubleBattleDamage' && t === self },
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (duel, self, q, _t, player) => q === 'noBattleDamage' && player === self.controller && ownPendulumBattling(duel, self),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) =>
        inPendZone(ctx.card) &&
        ctx.duel.turnPlayer === ctx.player &&
        deckFilter(ctx, (d) => isPendulum(d) && d.atk <= 1500).length > 0,
      operation: async (ctx) => {
        if (!inPendZone(ctx.card)) return;
        ctx.duel.destroy([ctx.card], 'effect', ctx.card);
        await searchDeck(ctx, (d) => isPendulum(d) && d.atk <= 1500, 1, '選擇攻擊力 1500 以下的靈擺怪獸');
      },
    },
  ],
});

// 星讀之魔術師
def(94415058, {
  scaleOverride: gazerScale,
  effects: [
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (duel, self, q, _t, player) => q === 'cannotActivateSpells' && player === opp(self.controller) && ownPendulumBattling(duel, self),
    },
    {
      kind: 'trigger',
      event: 'toHand',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event!;
        const c = ev.card;
        return (
          ctx.card.isFaceUpMonster &&
          !!c &&
          c !== ctx.card &&
          ev.from === 'mzone' &&
          ev.prevController === ctx.player &&
          isPendulum(c.data) &&
          ev.by?.controller === ctx.opp &&
          c.location === 'hand' &&
          ctx.duel.freeMZones(ctx.player) > 0
        );
      },
      operation: async (ctx) => {
        const c = ctx.event!.card!;
        if (c.location === 'hand') ctx.duel.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 時讀之魔術師
def(20409757, {
  scaleOverride: gazerScale,
  scaleCondition: (duel, self) => duel.monsters(self.owner).length === 0,
  effects: [
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (duel, self, q, _t, player) => q === 'cannotActivateTraps' && player === opp(self.controller) && ownPendulumBattling(duel, self),
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'effectIndestructible' && !!t && t.controller === self.controller && inPendZone(t),
    },
  ],
});

// 娛樂夥伴 銀爪狼
const isPerformapal = (c: Card) => c.data.nameEn.startsWith('Performapal');
def(26270847, {
  effects: [
    statAura((_d, self, t) => t.isFaceUpMonster && t.controller === self.controller && isPerformapal(t), 300, 0, ['szone']),
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => ctx.event?.attacker === ctx.card,
      operation: async (ctx) => {
        for (const c of ctx.duel.faceUpMonsters(ctx.player)) if (isPerformapal(c)) ctx.duel.addMod(c, { atk: 300, until: 'battleEnd' });
      },
    },
  ],
});

// 娛樂夥伴 萬花筒蠍
const specialSummoned = (c: Card) => !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);
def(78835747, {
  effects: [
    statAura((_d, self, t) => t.isFaceUpMonster && t.controller === self.controller && !!(t.data.attribute & ATTR.LIGHT), 300, 0, ['szone']),
    {
      kind: 'ignition',
      label: '可以向對方所有特殊召喚的怪獸各攻擊 1 次',
      once: 'turn',
      condition: (ctx) => ctx.duel.monsters(ctx.opp).filter(specialSummoned).length >= 2 && ctx.duel.faceUpMonsters(ctx.player).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player), { title: '選擇自己的怪獸', hint: 'benefit', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        const n = ctx.duel.monsters(ctx.opp).filter(specialSummoned).length;
        t.extraAttacks += Math.max(0, n - 1);
        ctx.duel.log(`「${t.name}」這回合可以攻擊 ${n} 次`);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.turn > 1 ? 40 : 0),
    },
  ],
});

// 靈擺呼喚
const magicianPendulum = (d: { nameEn: string; type: number }) => isPendulum(d as never) && d.nameEn.includes('Magician');
def(53208660, {
  effects: [
    {
      kind: 'activate',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => {
        const names = new Set(deckFilter(ctx, (d) => magicianPendulum(d)).map((c) => c.id));
        return names.size >= 2 && ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card);
      },
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: ctx.duel.p(ctx.player).hand.filter((x) => x !== ctx.card),
          hint: 'cost',
        });
        if (c) ctx.duel.discard([c], 'cost');
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, (x) => magicianPendulum(x));
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻卡名不同的「魔術師」靈擺怪獸',
          cards: cands,
          min: 2,
          max: 2,
          hint: 'benefit',
          validate: (s) => s.length === 2 && s[0].id !== s[1].id,
        });
        for (const c of sel) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 靈擺顯現
def(74926274, {
  effects: [
    {
      kind: 'activate',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.player).some((m) => deckFilter(ctx, (d) => isPendulum(d) && d.level === m.data.level).length > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的怪獸',
          cards: d.monsters(ctx.player).filter((m) => deckFilter(ctx, (x) => isPendulum(x) && x.level === m.data.level).length > 0),
          hint: 'cost',
        });
        if (c) {
          ctx.data.level = c.data.level;
          d.sendToGrave([c], 'cost');
        }
      },
      operation: async (ctx) => {
        const c = await ssFromDeck(ctx, (d) => isPendulum(d) && d.level === ctx.data.level);
        if (c) ctx.duel.setFlag(c, 'destroyAtEnd');
      },
      ai: () => 0,
    },
  ],
});

// =====================================================================
// 連結
// =====================================================================

function link(id: number, spec: CardScript['link'], effects: EffectDef[] = [], extra: Partial<CardScript> = {}) {
  def(id, { link: spec, effects, ...extra });
}
const pointedOwn = (duel: Duel, self: Card) => duel.pointedMonsters(self).filter((c) => c.controller === self.controller);
/** 連結怪獸所連接區的自己的主要怪獸區 */
const pointedOwnZones = (duel: Duel, self: Card) =>
  duel.pointedZones(self).filter((z) => z.player === self.controller && z.idx < 5).map((z) => z.idx);

// 無效果的連結怪獸
link(41248270, { min: 3, max: 3 }); // 流量幽靈
link(77637979, { min: 2, max: 2 }); // LAN喙嘴龍
link(67598234, { min: 2 }); // 電影之騎士 蓋亞劍士

// 連接蜘蛛
link(98978921, { min: 1, max: 1, filter: (c) => isNormalMonster(c) }, [
  {
    kind: 'ignition',
    label: '把手牌的通常怪獸特殊召喚到連接區',
    once: 'turn',
    categories: ['summon'],
    condition: (ctx) =>
      ctx.duel.p(ctx.player).hand.some((c) => isNormalMonster(c) && c.data.level <= 4) &&
      pointedOwnZones(ctx.duel, ctx.card).some((i) => !ctx.duel.p(ctx.player).mzone[i]),
    operation: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({
        player: ctx.player,
        title: '選擇 4 星以下的通常怪獸',
        cards: d.p(ctx.player).hand.filter((x) => isNormalMonster(x) && x.data.level <= 4),
        hint: 'benefit',
      });
      if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, zones: pointedOwnZones(d, ctx.card) });
    },
    ai: () => 50,
  },
]);

// 連接栗子球
link(41999284, { min: 1, max: 1, filter: (c, d) => !isLink(c.data) && d.getLevel(c) === 1 }, [
  {
    kind: 'quick',
    label: '解放：攻擊怪獸的攻擊力變成 0',
    event: 'attackDeclared',
    categories: ['stat'],
    condition: (ctx) => !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp,
    cost: async (ctx) => {
      ctx.data.attacker = ctx.duel.battle?.attacker;
      ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
    },
    operation: async (ctx) => {
      const a = ctx.data.attacker as Card | undefined;
      if (a?.isFaceUpMonster) ctx.duel.addMod(a, { setAtk: 0, until: 'endTurn' }, ctx.card);
    },
    ai: (ctx) => (ctx.duel.battle && ctx.duel.getAtk(ctx.duel.battle.attacker) >= 1500 ? 70 : 0),
  },
  {
    kind: 'ignition',
    label: '解放 1 星怪獸：從墓地特殊召喚',
    range: ['grave'],
    once: 'name',
    categories: ['summon'],
    condition: (ctx) =>
      ctx.duel.monsters(ctx.player).some((c) => !isLink(c.data) && ctx.duel.getLevel(c) === 1) && ctx.duel.extraZones(ctx.player, ctx.card).length > 0,
    cost: async (ctx) => {
      const c = await ctx.duel.selectOne({
        player: ctx.player,
        title: '選擇要解放的 1 星怪獸',
        cards: ctx.duel.monsters(ctx.player).filter((x) => !isLink(x.data) && ctx.duel.getLevel(x) === 1),
        hint: 'cost',
      });
      if (c) ctx.duel.moveTo(c, 'grave', { reason: 'cost' });
    },
    operation: async (ctx) => {
      if (ctx.card.location !== 'grave') return;
      const zones = ctx.duel.extraZones(ctx.player, ctx.card);
      ctx.duel.moveTo(ctx.card, 'mzone', { reason: 'summon', player: ctx.player, faceUp: true, position: 'atk', zone: zones[0] });
      ctx.card.summonType = 'special';
    },
    ai: () => 20,
  },
]);

/** 碼語者系列：攻擊力上升所連接區怪獸數量 × 500 */
const talkerAura = statAura((_d, self, t) => self === t, (duel, self) => 500 * duel.pointedMonsters(self).length);

// 碼語者
link(53413628, { min: 2, max: 2, filter: isEffectMonster }, [
  talkerAura,
  {
    kind: 'continuous',
    query: (duel, self, q, t) =>
      (q === 'battleIndestructible' || q === 'effectIndestructible') && t === self && duel.pointedMonsters(self).length > 0,
  },
]);

// 解碼語者
link(1861629, { min: 2, filter: isEffectMonster }, [
  talkerAura,
  {
    kind: 'quick',
    label: '解放連接區的怪獸：無效以自己的卡為對象的效果',
    categories: ['negate'],
    condition: (ctx) => {
      const top = ctx.duel.chainTop;
      return (
        !!top &&
        !top.negated &&
        top.player === ctx.opp &&
        top.ctx.targets.some((t) => t.card.controller === ctx.player && t.card.onField) &&
        pointedOwn(ctx.duel, ctx.card).length > 0
      );
    },
    cost: async (ctx) => {
      ctx.data.link = ctx.duel.chainTop;
      const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: pointedOwn(ctx.duel, ctx.card), hint: 'cost' });
      if (c) ctx.duel.moveTo(c, 'grave', { reason: 'cost' });
    },
    operation: async (ctx) => {
      const l = ctx.data.link;
      if (!l) return;
      ctx.duel.negateLink(l);
      if (!l.isCardActivation && l.card.onField) ctx.duel.destroy([l.card], 'effect', ctx.card);
    },
    ai: () => 65,
  },
]);

// 力碼語者
link(15844566, { min: 3, max: 3 }, [
  {
    kind: 'ignition',
    label: '無效 1 隻怪獸的效果',
    once: 'turn',
    categories: ['negate'],
    condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c !== ctx.card && isEffectMonster(c)),
    target: async (ctx) => {
      await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => c !== ctx.card && isEffectMonster(c)), { title: '選擇要無效效果的怪獸' });
    },
    operation: async (ctx) => {
      const t = tgt(ctx);
      if (t?.isFaceUpMonster) {
        ctx.duel.setFlag(t, 'negated');
        ctx.duel.log(`「${t.name}」的效果直到回合結束時無效`);
      }
    },
    ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => isEffectMonster(c) && cardValue(ctx.duel, c, ctx.player) >= 1800) ? 40 : 0),
  },
  {
    kind: 'quick',
    label: '解放連接區的怪獸：攻擊力變成 2 倍',
    event: 'damageCalc',
    damageStep: true,
    once: 'turn',
    categories: ['stat'],
    condition: (ctx) => {
      const b = ctx.duel.battle;
      return !!b && !!b.target && (b.attacker === ctx.card || b.target === ctx.card) && pointedOwn(ctx.duel, ctx.card).length > 0;
    },
    cost: async (ctx) => {
      const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: pointedOwn(ctx.duel, ctx.card), hint: 'cost' });
      if (c) ctx.duel.moveTo(c, 'grave', { reason: 'cost' });
    },
    operation: async (ctx) => {
      if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { setAtk: ctx.card.data.atk * 2, until: 'damageCalc' });
    },
    ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, ctx.card.data.atk) === ctx.card ? 60 : 0),
  },
]);

// 蜜罐機器人
link(34472920, { min: 2, max: 2, filter: isCyberse }, [
  {
    kind: 'continuous',
    query: (duel, self, q, t) => q === 'battleIndestructible' && !!t && duel.pointedMonsters(self).includes(t),
  },
]);

// 協議守衛者
link(5329790, { min: 2, max: 2, filter: isCyberse }, [
  {
    kind: 'continuous',
    query: (duel, self, q, t) => q === 'cannotBeAttackTarget' && !!t && t.controller === self.controller && duel.pointedMonsters(self).includes(t),
  },
  { kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndesOnce' && t === self },
]);

// 滲透測試鍬甲
link(72336818, { min: 2, max: 2, filter: isEffectMonster }, [
  {
    kind: 'continuous',
    query: (duel, self, q, t) => q === 'piercing' && !!t && t.controller === self.controller && duel.isLinked(t),
  },
]);

// 炎上框架管理員
link(49847524, { min: 2, max: 2, filter: isCyberse }, [
  statAura((_d, self, t) => t.isFaceUpMonster && t.controller === self.controller && isLink(t.data), 800),
]);

// 降頻承辦員
link(77058170, { min: 2, max: 2, filter: isEffectMonster }, [
  {
    kind: 'ignition',
    label: '對方怪獸攻擊力下降',
    once: 'turn',
    categories: ['stat'],
    condition: (ctx) => pointedOwn(ctx.duel, ctx.card).some((c) => c.faceUp) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
    target: async (ctx) => {
      const d = ctx.duel;
      const mine = await d.selectOne({ player: ctx.player, title: '選擇所連接區的自己怪獸', cards: pointedOwn(d, ctx.card).filter((c) => c.faceUp), hint: 'benefit', aiValue: (c) => d.getAtk(c) });
      const foe = await d.selectOne({ player: ctx.player, title: '選擇對方的怪獸', cards: d.faceUpMonsters(ctx.opp), hint: 'harm' });
      d.setTargets(ctx, [mine, foe].filter((c): c is Card => !!c));
    },
    operation: async (ctx) => {
      const [mine, foe] = tgts(ctx);
      if (mine?.isFaceUpMonster && foe?.isFaceUpMonster) ctx.duel.addMod(foe, { atk: -ctx.duel.getAtk(mine), until: 'endTurn' }, ctx.card);
    },
    ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.turn > 1 ? 45 : 0),
  },
]);

// 飛濺閃屏法師
link(59859086, { min: 2, max: 2, filter: isCyberse }, [
  {
    kind: 'ignition',
    label: '特殊召喚墓地的電子界族',
    once: 'name',
    categories: ['summon'],
    condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isCyberse(c) && !isExtraDeckCard(c.data)),
    target: async (ctx) => {
      await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isCyberse(c) && !isExtraDeckCard(c.data)), {
        title: '選擇電子界族怪獸',
        hint: 'benefit',
      });      // 這個效果的發動後，直到回合結束時自己不是電子界族怪獸不能特殊召喚
      ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], allow: isCyberse });
    },
    operation: async (ctx) => {
      const t = tgt(ctx);
      if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', negateEffects: true, by: ctx.card });
    },
    ai: () => 45,
  },
]);

// 雙三角龍
link(
  66015185,
  { min: 2, max: 2, filter: (c) => !isToken(c.data) && !!(c.data.race & RACE.DRAGON) && c.data.level <= 4 && !isLink(c.data) },
  [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['link']) &&
        ctx.duel.p(ctx.player).lp > 500 &&
        pointedOwnZones(ctx.duel, ctx.card).some((i) => !ctx.duel.p(ctx.player).mzone[i]) &&
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.level >= 5 && !isLink(c.data)),
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 500);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.level >= 5 && !isLink(c.data)), {
          title: '選擇 5 星以上的怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location !== 'grave') return;
        if (ctx.duel.specialSummon(t, ctx.player, { position: 'atk', negateEffects: true, by: ctx.card, zones: pointedOwnZones(ctx.duel, ctx.card) }))
          ctx.duel.setFlag(t, 'cannotAttack');
      },
    },
  ],
);

// 混沌之戰士 混沌戰士
link(49202162, { min: 3, max: 3, validate: (set) => new Set(set.map((c) => c.id)).size === set.length }, [
  {
    kind: 'trigger',
    event: 'summoned',
    mandatory: true,
    condition: (ctx) => summonedSelf(ctx, ['link']) && ctx.duel.lastLinkMaterials.some((c) => !isLink(c.data) && c.data.level >= 7),
    operation: async (ctx) => {
      ctx.duel.setFlag(ctx.card, 'effectIndestructible', true);
      ctx.duel.log(`「${ctx.card.name}」不會被對方的效果破壞`);
    },
  },
  {
    kind: 'trigger',
    event: 'destroyed',
    categories: ['stat', 'banish'],
    condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.card !== ctx.card && ctx.card.isFaceUpMonster,
    operation: async (ctx) => {
      const d = ctx.duel;
      const i = await d.chooseOption({
        player: ctx.player,
        title: '選擇效果',
        card: ctx.card,
        options: [
          { label: '攻擊力上升 1500', ai: 1 },
          { label: '下次自己的戰鬥階段可以攻擊 2 次', ai: 0 },
          { label: '場上 1 張卡除外', ai: d.fieldCards(ctx.opp).length ? 2 : 0 },
        ],
      });
      if (i === 0) d.addMod(ctx.card, { atk: 1500, until: 'permanent' });
      else if (i === 1) d.setFlag(ctx.card, 'doubleAttack', d.turn + 2);
      else {
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的卡', cards: d.fieldCards(), hint: 'harm' });
        if (c) d.banish([c], 'effect', ctx.card);
      }
    },
  },
]);

// 冥宮的番人
link(31897444, { min: 2, max: 2, filter: (c) => isNormalMonster(c) }, [
  statAura(
    (_d, self, t) => t.isFaceUpMonster && (t.controller === self.controller ? !isEffectMonster(t) : isEffectMonster(t)),
    (_d, self, t) => (t.controller === self.controller ? 500 : -500),
  ),
  {
    kind: 'trigger',
    event: 'destroyed',
    once: 'name',
    categories: ['summon'],
    condition: (ctx) =>
      ctx.event?.card === ctx.card &&
      (ctx.event.by?.controller === ctx.opp || ctx.event.reason === 'battle') &&
      ctx.duel.freeMZones(ctx.player) > 0 &&
      ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && !isEffectMonster(c) && !isExtraDeckCard(c.data)),
    target: async (ctx) => {
      await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && !isEffectMonster(c) && !isExtraDeckCard(c.data)), {
        title: '選擇效果怪獸以外的怪獸',
        hint: 'benefit',
      });
    },
    operation: async (ctx) => {
      const t = tgt(ctx);
      if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
    },
  },
]);

// 屬性連結怪獸（金毛婦等）
for (const [id, up, down] of [
  [3987233, ATTR.EARTH, ATTR.WIND], // 金毛婦
  [65170459, ATTR.WATER, ATTR.FIRE], // 孩星老爺
  [37880706, ATTR.FIRE, ATTR.WATER], // 小懶奇美拉
  [90512490, ATTR.WIND, ATTR.EARTH], // 巨蠅
  [71384012, ATTR.DARK, ATTR.LIGHT], // 見習魔娘
  [7778726, ATTR.LIGHT, ATTR.DARK], // 極超流星
] as const) {
  link(id, { min: 2, max: 2, filter: (c) => !!(c.data.attribute & up) }, [
    statAura(
      (_d, _s, t) => t.isFaceUpMonster && !!(t.data.attribute & (up | down)),
      (_d, _s, t) => (t.data.attribute & up ? 500 : -400),
      (_d, _s, t) => (t.data.attribute & up ? 500 : -400),
    ),
    {
      kind: 'trigger',
      event: 'destroyed',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isMonster(c.data) && !!(c.data.attribute & up)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isMonster(c.data) && !!(c.data.attribute & up)), {
          title: '選擇要加入手牌的怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ]);
}

// =====================================================================
// 電子界族
// =====================================================================

// 備份秘書
def(63528891, {
  spSummon: {
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some(isCyberse) && !duel.p(card.owner).turnFlags.backupSecretary,
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.backupSecretary = true;
    },
  },
});

// ROM雲雌羊
def(44956694, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx, ['normal']) && ctx.duel.p(ctx.player).grave.some((c) => isCyberse(c) && c.id !== 44956694),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isCyberse(c) && c.id !== 44956694), {
          title: '選擇要加入手牌的電子界族怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'mzone' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (d) => isMonster(d) && !!(d.race & RACE.CYBERSE) && d.level <= 4 && d.id !== 44956694 && !isExtraDeckCard(d)).length > 0,
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => !!(d.race & RACE.CYBERSE) && d.level <= 4 && d.id !== 44956694 && !isExtraDeckCard(d));
      },
    },
  ],
});

// 網絡小龍
def(62706865, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isNormalMonster(c) && c.data.level <= 2),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isNormalMonster(c) && c.data.level <= 2);
        const c = await d.selectOne({ player: ctx.player, title: '選擇 2 星以下的通常怪獸', cards: cands, hint: 'benefit' });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 控件小子
def(10705656, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some(isCyberse),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇電子界族怪獸', cards: d.p(ctx.player).hand.filter(isCyberse), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 點陣圖跳離士
def(18789533, {
  effects: [
    {
      kind: 'trigger',
      event: ['toGrave', 'banished'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        !ctx.duel.p(ctx.card.owner).turnFlags.dotscaperTurn &&
        !(ctx.duel.p(ctx.card.owner).usedNames[-ctx.card.id - (ctx.event.type === 'banished' ? 1 : 0)] ?? 0) &&
        ctx.duel.freeMZones(ctx.card.owner) > 0,
      operation: async (ctx) => {
        const ps = ctx.duel.p(ctx.card.owner);
        ps.turnFlags.dotscaperTurn = true;
        ps.usedNames[-ctx.card.id - (ctx.event!.type === 'banished' ? 1 : 0)] = ctx.duel.turn;
        if (ctx.card.location === 'grave' || ctx.card.location === 'banished') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 戒備轉換鳥
def(76353872, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄電子界族：特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card && isCyberse(c)),
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的電子界族怪獸',
          cards: ctx.duel.p(ctx.player).hand.filter((x) => x !== ctx.card && isCyberse(x)),
          hint: 'cost',
        });
        if (c) ctx.duel.discard([c], 'cost');
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 35,
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && !!ctx.event?.target && ctx.event.target.controller === ctx.player && isCyberse(ctx.event.target) && ctx.event.target.faceUp,
      operation: async (ctx) => {
        const t = ctx.event!.target!;
        if (!t.isFaceUpMonster) return;
        ctx.duel.addMod(t, { setAtk: t.data.atk * 2, setDef: t.data.atk * 2, until: 'battleEnd' });
      },
    },
  ],
});

// 連接設施飛行員
def(65100616, {
  spSummon: {
    label: '特殊召喚到連接區',
    condition: (duel, card) =>
      !duel.p(card.owner).turnFlags.infraFlier && [...duel.linkedZones(card.owner)].some((i) => !duel.p(card.owner).mzone[i]),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.infraFlier = true;
    },
    zones: (duel, card) => [...duel.linkedZones(card.owner)].filter((i) => !duel.p(card.owner).mzone[i]),
  },
});

// 堆棧修復員
def(9523599, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'material' &&
        ctx.duel.lastLinkMaterials.includes(ctx.card) &&
        !ctx.duel.p(ctx.player).usedNames[-9523599] &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.lastLinkMaterials.some((c) => c !== ctx.card && c.location === 'grave' && isCyberse(c) && c.data.level <= 4 && !isLink(c.data)),
      target: async (ctx) => {
        ctx.duel.p(ctx.player).usedNames[-9523599] = ctx.duel.turn;
        await chooseTargets(
          ctx,
          ctx.duel.lastLinkMaterials.filter((c) => c !== ctx.card && c.location === 'grave' && isCyberse(c) && c.data.level <= 4 && !isLink(c.data)),
          { title: '選擇要特殊召喚的素材', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

