// 魔法卡的效果腳本
import { Card } from '../card';
import { getCard, isMonster, RACE, cannotNormalSummon, isFlip } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, PlayerId } from '../types';
import { def, getScript } from './registry';
import {
  activate,
  bestBoostTarget,
  boardDiff,
  canRevive,
  cardValue,
  chooseTargets,
  deckFilter,
  equipSpell,
  equipStat,
  fieldSpell,
  searchDeck,
  sentFromFieldToGrave,
  sum,
  tgt,
  tgts,
} from './lib';

const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const discardOne = async (ctx: EffectContext, title = '選擇要丟棄的手牌') => {
  const hand = ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card);
  const c = await ctx.duel.selectOne({ player: ctx.player, title, cards: hand, hint: 'cost' });
  if (c) ctx.duel.discard([c], 'cost');
};
const handOthers = (ctx: EffectContext) => ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card);

// 強欲之壺
def(55144522, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 2,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 100,
    }),
  ],
});

// 天使的施捨
def(79571449, {
  effects: [
    activate({
      categories: ['draw', 'discard'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.draw(ctx.player, 3);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 張要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          min: 2,
          max: 2,
          hint: 'cost',
        });
        d.discard(sel, 'effect', ctx.card);
      },
      ai: () => 90,
    }),
  ],
});

// 死者蘇生
def(83764718, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].some(canRevive),
      target: async (ctx) => {
        await chooseTargets(ctx, [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter(canRevive), {
          title: '選擇要特殊召喚的怪獸',
          hint: 'benefit',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.location === 'grave') {
          const pos = await ctx.duel.choosePosition(ctx.player, t);
          ctx.duel.specialSummon(t, ctx.player, { position: pos, by: ctx.card });
        }
      },
      ai: (ctx) => {
        const best = Math.max(0, ...[...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter(canRevive).map((c) => c.data.atk));
        return best >= 1800 ? 75 : best >= 1400 ? 30 : 0;
      },
    }),
  ],
});

// 雷擊
def(12580477, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.monsters(ctx.opp), 'effect', ctx.card);
      },
      ai: (ctx) => (sum(ctx.duel.monsters(ctx.opp).map((c) => cardValue(ctx.duel, c, ctx.player))) >= 1500 ? 85 : 20),
    }),
  ],
});

// 黑洞
def(53129443, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters().length > 0,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.monsters(), 'effect', ctx.card);
      },
      ai: (ctx) => (boardDiff(ctx.duel, ctx.player) >= 1200 ? 75 : 0),
    }),
  ],
});

// 鷹身女妖的羽毛掃
def(18144506, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps(ctx.opp).length > 0,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.spellTraps(ctx.opp), 'effect', ctx.card);
      },
      ai: (ctx) => 40 + 15 * ctx.duel.spellTraps(ctx.opp).length,
    }),
  ],
});

// 旋風
def(5318639, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : 0) + (c.faceUp ? 500 : 1000) + (c.equipTarget ? 300 : 0),
        });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (!d.spellTraps(ctx.opp).length) return 0;
        // 對方回合的結束階段或回應對方的發動時使用
        const top = d.chainTop;
        if (top && top.player === ctx.opp && top.isCardActivation) return 55;
        if (d.turnPlayer === ctx.player && (d.phase === 'main1' || d.phase === 'main2')) return 45;
        if (d.turnPlayer === ctx.opp && d.phase === 'end') return 50;
        return 0;
      },
    }),
  ],
});

// 大風暴
def(19613556, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps().some((c) => c !== ctx.card),
      operation: async (ctx) => {
        ctx.duel.destroy(
          ctx.duel.spellTraps().filter((c) => c !== ctx.card),
          'effect',
          ctx.card,
        );
      },
      ai: (ctx) => {
        const mine = ctx.duel.spellTraps(ctx.player).filter((c) => c !== ctx.card).length;
        const theirs = ctx.duel.spellTraps(ctx.opp).length;
        return theirs > mine ? 50 + 10 * (theirs - mine) : 0;
      },
    }),
  ],
});

// 心變
def(4031928, {
  effects: [
    activate({
      categories: ['control'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0 && ctx.duel.freeMZones(ctx.player) > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要得到控制權的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.takeControl(t, ctx.player, true, ctx.card);
      },
      ai: (ctx) => (ctx.duel.turn > 1 && ctx.duel.monsters(ctx.opp).some((c) => c.faceUp && ctx.duel.getAtk(c) >= 1600) ? 65 : 0),
    }),
  ],
});

// 光之護封劍
def(72302403, {
  effects: [
    activate({
      categories: ['position'],
      operation: async (ctx) => {
        for (const c of ctx.duel.monsters(ctx.opp)) if (!c.faceUp) ctx.duel.changePosition(c, c.position, true, ctx.card);
        ctx.card.counters = 0;
        // 通常魔法，但發動後繼續留在場上
        ctx.data.keepOnField = true;
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = Math.max(0, ...d.faceUpMonsters(ctx.opp).map((c) => d.getAtk(c)));
        const mine = Math.max(0, ...d.faceUpMonsters(ctx.player).map((c) => d.getAtk(c)));
        return theirs > mine || d.monsters(ctx.opp).length > d.monsters(ctx.player).length ? 55 : 10;
      },
    }),
    {
      kind: 'continuous',
      query: (_d, self, q, _t, player) => q === 'cannotDeclareAttack' && player === opp(self.controller),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp && ctx.duel.turnPlayer === ctx.opp,
      operation: async (ctx) => {
        ctx.card.counters++;
        ctx.duel.log(`「${ctx.card.name}」經過 ${ctx.card.counters} 回合`);
        if (ctx.card.counters >= 3) ctx.duel.destroy([ctx.card], 'rule');
      },
    },
  ],
});

// 地割
def(66788016, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters(ctx.opp);
        if (!mons.length) return;
        const low = Math.min(...mons.map((c) => d.getAtk(c)));
        const cands = mons.filter((c) => d.getAtk(c) === low);
        const c = cands.length > 1 ? await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: cands, hint: 'harm' }) : cands[0];
        if (c) d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).length ? 45 : 0),
    }),
  ],
});

// 火球 / 晝夜的大火災
for (const [id, dmg] of [
  [46130346, 500],
  [19523799, 800],
] as const) {
  def(id, {
    effects: [
      activate({
        categories: ['damage'],
        operation: async (ctx) => {
          ctx.duel.damage(ctx.opp, dmg, 'effect', ctx.card);
        },
        ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= dmg ? 200 : 8),
      }),
    ],
  });
}

// 治療之神 迪安·凱特
def(84257639, {
  effects: [
    activate({
      categories: ['recover'],
      operation: async (ctx) => {
        ctx.duel.recover(ctx.player, 1000);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp <= 3000 ? 30 : 5),
    }),
  ],
});

// 融合
def(24094653, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.fusionCandidates(ctx.player, fusionPool(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = fusionPool(ctx);
        const cands = d.fusionCandidates(ctx.player, pool);
        if (!cands.length) return;
        const f = await d.selectOne({ player: ctx.player, title: '選擇要融合召喚的融合怪獸', cards: cands, hint: 'benefit' });
        if (!f) return;
        const conds = getScript(f.id).fusion!;
        const usable = pool.filter((c) => conds.some((cond) => cond(c.data)));
        let mats = await d.select({
          player: ctx.player,
          title: `選擇「${f.name}」的融合素材`,
          cards: usable,
          min: conds.length,
          max: conds.length,
          hint: 'cost',
          validate: (sel) => d.matchMaterials(conds, sel),
        });
        if (!d.matchMaterials(conds, mats)) mats = d.findMaterialSet(conds, pool) ?? [];
        if (!mats.length) return;
        d.sendToGrave(mats, 'material');
        d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
        const pos = await d.choosePosition(ctx.player, f);
        d.specialSummon(f, ctx.player, { position: pos, summonType: 'fusion', by: ctx.card });
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const best = d.fusionCandidates(ctx.player, fusionPool(ctx));
        return best.length ? 80 : 0;
      },
    }),
  ],
});

function fusionPool(ctx: EffectContext): Card[] {
  const d = ctx.duel;
  return [...d.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...d.faceUpMonsters(ctx.player)];
}

// 過早的埋葬
def(70828912, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).lp > 800 && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some(canRevive),
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 800);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(canRevive), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        const d = ctx.duel;
        if (!t || t.location !== 'grave') return;
        if (d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) {
          d.equip(ctx.card, t);
          d.link(ctx.card, t);
        }
      },
      ai: (ctx) => {
        const best = Math.max(0, ...ctx.duel.p(ctx.player).grave.filter(canRevive).map((c) => c.data.atk));
        return best >= 1900 && ctx.duel.p(ctx.player).lp > 2500 ? 70 : 0;
      },
    }),
  ],
});

// 手札抹殺
def(72892473, {
  effects: [
    activate({
      categories: ['draw', 'discard'],
      condition: (ctx) => handOthers(ctx).length > 0 || ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const counts = [ctx.player, ctx.opp].map((p) => [p, d.p(p).hand.length] as const);
        for (const [p] of counts) d.discard([...d.p(p).hand], 'effect', ctx.card);
        for (const [p, n] of counts) if (n > 0) d.draw(p, n);
      },
      ai: (ctx) => (handOthers(ctx).length <= 2 && ctx.duel.p(ctx.opp).hand.length >= 3 ? 25 : 0),
    }),
  ],
});

// 成金哥布林
def(70368879, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 1,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
        ctx.duel.recover(ctx.opp, 1000);
      },
      ai: () => 70,
    }),
  ],
});

// 洗腦
def(87910978, {
  effects: [
    activate({
      categories: ['control'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).lp > 800 &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => !cannotNormalSummon(c.data)),
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 800);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp).filter((c) => !cannotNormalSummon(c.data)), {
          title: '選擇要得到控制權的怪獸',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.faceUp) ctx.duel.takeControl(t, ctx.player, true, ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.turn > 1 &&
        ctx.duel.p(ctx.player).lp > 2000 &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => !cannotNormalSummon(c.data) && ctx.duel.getAtk(c) >= 1700)
          ? 60
          : 0,
    }),
  ],
});

// 月之書
def(14087893, {
  effects: [
    activate({
      categories: ['position'],
      damageStep: false,
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const b = ctx.duel.battle;
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇要變成裡側守備表示的怪獸',
          aiValue: (c) =>
            (b && b.attacker === c ? 20000 : 0) + (c.controller === ctx.player ? -10000 : 0) + cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.isFaceUpMonster) ctx.duel.changePosition(t, 'def', false, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (b && b.attacker.controller === ctx.opp && !b.damageStep) {
          const sim = simulateHurt(ctx);
          return sim >= 1500 ? 60 : 0;
        }
        return 0;
      },
    }),
  ],
});

function simulateHurt(ctx: EffectContext): number {
  // 延遲載入以避免循環引用
  const b = ctx.duel.battle;
  if (!b) return 0;
  const atk = ctx.duel.getAtk(b.attacker);
  if (!b.target) return atk;
  const t = b.target;
  if (t.position === 'atk') return atk > ctx.duel.getAtk(t) ? atk - ctx.duel.getAtk(t) + cardValue(ctx.duel, t) : 0;
  return atk > (t.faceUp ? ctx.duel.getDef(t) : t.data.def) ? cardValue(ctx.duel, t) : 0;
}

// 強奪
def(45986603, {
  equipFilter: (_d, self, t) => t.controller !== self.controller,
  effects: [
    equipSpell({
      side: 'opp',
      filter: (_d, _self, t, player) => t.controller !== player,
      extra: {
        operation: async (ctx) => {
          const t = tgt(ctx);
          const d = ctx.duel;
          if (!t || !t.isFaceUpMonster) return;
          if (d.equip(ctx.card, t)) d.takeControl(t, ctx.player, false, ctx.card);
        },
        ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 1500) && ctx.duel.freeMZones(ctx.player) > 0 ? 70 : 0),
        categories: ['control'],
      },
    }),
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      categories: ['recover'],
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp && !!ctx.card.equipTarget && ctx.event?.player === ctx.opp,
      operation: async (ctx) => {
        ctx.duel.recover(ctx.opp, 1000);
      },
    },
  ],
  onLeaveField: (duel, self) => {
    const t = self.equipTarget;
    if (t && t.location === 'mzone' && t.stint === self.equipStint && t.controller !== t.owner) duel.returnControl(t);
  },
});

// 惡魔之斧
def(40619825, {
  effects: [
    equipSpell({ side: 'own' }),
    equipStat(1000),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '解放 1 隻怪獸：回到牌組最上面',
      condition: (ctx) => sentFromFieldToGrave(ctx) && ctx.duel.tributable(ctx.player).length > 0,
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要解放的怪獸',
          cards: ctx.duel.tributable(ctx.player),
          hint: 'cost',
        });
        if (c) ctx.duel.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToDeck([ctx.card], true, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.player).some((c) => cardValue(ctx.duel, c) < 900) ? 20 : 0),
    },
  ],
});

// 黑項鍊
def(65169794, {
  effects: [
    equipSpell({ side: 'own' }),
    equipStat(500),
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      categories: ['damage'],
      condition: sentFromFieldToGrave,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
    },
  ],
});

// 團結之力
def(56747793, {
  effects: [
    equipSpell({ side: 'own' }),
    equipStat(
      (duel, self) => duel.faceUpMonsters(self.controller).length * 800,
      (duel, self) => duel.faceUpMonsters(self.controller).length * 800,
    ),
  ],
});

// 突進
def(70046172, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const best = bestBoostTarget(ctx.duel, ctx.player, 700);
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇攻擊力上升 700 的怪獸',
          hint: 'benefit',
          aiValue: (c) => (c === best ? 10000 : 0) + (c.controller === ctx.player ? 1000 : -10000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.addMod(t, { atk: 700, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, 700) ? 60 : 0),
    }),
  ],
});

// 敵人操縱器
def(98045062, {
  effects: [
    activate({
      categories: ['position', 'control'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const canSteal = d.tributable(ctx.player).length > 0;
        const b = d.battle;
        const opt = canSteal
          ? await d.chooseOption({
              player: ctx.player,
              title: '選擇效果',
              card: ctx.card,
              options: [
                { label: '改變對方怪獸的表示形式', ai: b ? 2 : 0 },
                { label: '解放自己 1 隻怪獸：得到對方怪獸控制權', ai: b ? 0 : 1 },
              ],
            })
          : 0;
        ctx.data.mode = opt;
        if (opt === 1) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: d.tributable(ctx.player), hint: 'cost' });
          if (c) d.moveTo(c, 'grave', { reason: 'cost' });
        }
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), {
          title: '選擇對方表側表示的怪獸',
          aiValue: (c) => (b && b.attacker === c ? 20000 : 0) + cardValue(d, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t || !t.isFaceUpMonster) return;
        if (ctx.data.mode === 1) ctx.duel.takeControl(t, ctx.player, true, ctx.card);
        else ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (b && b.attacker.controller === ctx.opp && !b.damageStep) return simulateHurt(ctx) >= 1500 ? 55 : 0;
        if (d.turnPlayer === ctx.player && d.phase === 'main1' && d.turn > 1) {
          const weak = d.tributable(ctx.player).some((c) => cardValue(d, c) < 1300);
          const strong = d.faceUpMonsters(ctx.opp).some((c) => d.getAtk(c) >= 2000);
          return weak && strong && d.freeMZones(ctx.player) >= 0 ? 45 : 0;
        }
        return 0;
      },
    }),
  ],
});

// 閃電漩渦
def(69162969, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => handOthers(ctx).length > 0 && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      cost: async (ctx) => discardOne(ctx),
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.faceUpMonsters(ctx.opp), 'effect', ctx.card);
      },
      ai: (ctx) => (sum(ctx.duel.faceUpMonsters(ctx.opp).map((c) => cardValue(ctx.duel, c))) >= 2200 ? 70 : 0),
    }),
  ],
});

// 地碎
def(97169186, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.monsters(ctx.opp);
        if (!mons.length) return;
        const defOf = (c: Card) => (c.faceUp ? d.getDef(c) : c.data.def);
        const high = Math.max(...mons.map(defOf));
        const cands = mons.filter((c) => defOf(c) === high);
        const c = cands.length > 1 ? await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: cands, hint: 'harm' }) : cands[0];
        if (c) d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 45 : 0),
    }),
  ],
});

// 抹殺之使徒
def(71044499, {
  effects: [
    activate({
      categories: ['destroy', 'banish'],
      condition: (ctx) => ctx.duel.monsters().some((c) => !c.faceUp),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters().filter((c) => !c.faceUp), { title: '選擇裡側表示的怪獸' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.faceUp) return;
        const flip = isFlip(t.data);
        const code = t.id;
        const destroyed = d.destroy([t], 'effect', ctx.card);
        d.banish(destroyed, 'effect', ctx.card);
        if (flip && destroyed.length) {
          for (const p of [0, 1] as PlayerId[]) d.banish(d.p(p).deck.filter((c) => c.id === code), 'effect', ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => !c.faceUp) ? 50 : 0),
    }),
  ],
});

// 颶風
def(42703248, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.spellTraps().some((c) => c !== ctx.card),
      operation: async (ctx) => {
        ctx.duel.returnToHand(
          ctx.duel.spellTraps().filter((c) => c !== ctx.card),
          'effect',
          ctx.card,
        );
      },
      ai: (ctx) => {
        const mine = ctx.duel.spellTraps(ctx.player).filter((c) => c !== ctx.card).length;
        const theirs = ctx.duel.spellTraps(ctx.opp).length;
        return theirs >= mine + 2 ? 40 : 0;
      },
    }),
  ],
});

// 替罪羊
def(73915051, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) >= 4 && !ctx.duel.p(ctx.player).turnFlags.summoned,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (let i = 0; i < 4; i++) {
          const token = new Card(getCard(73915052), ctx.player);
          token.location = 'void';
          d.specialSummon(token, ctx.player, { position: 'def', by: ctx.card });
        }
        d.p(ctx.player).turnFlags.noSummon = true;
        d.p(ctx.player).turnFlags.noSpecialSummon = true;
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (b && b.attacker.controller === ctx.opp && !b.target && d.getAtk(b.attacker) >= 1000) return 65;
        if (d.turnPlayer === ctx.opp && d.phase === 'end') return 30;
        return 0;
      },
    }),
  ],
});

// 場地魔法
def(50913601, { effects: fieldSpell([RACE.DRAGON, RACE.WINGEDBEAST, RACE.THUNDER]) }); // 山
def(59197169, { effects: fieldSpell([RACE.FIEND, RACE.SPELLCASTER], [RACE.FAIRY]) }); // 暗
def(86318356, { effects: fieldSpell([RACE.WARRIOR, RACE.BEASTWARRIOR]) }); // 草原
def(22702055, { effects: fieldSpell([RACE.FISH, RACE.SEASERPENT, RACE.THUNDER, RACE.AQUA], [RACE.MACHINE, RACE.PYRO]) }); // 海
def(87430998, { effects: fieldSpell([RACE.INSECT, RACE.BEAST, RACE.PLANT, RACE.BEASTWARRIOR]) }); // 森
def(23424603, { effects: fieldSpell([RACE.DINOSAUR, RACE.ZOMBIE, RACE.ROCK]) }); // 荒野

// 儀式魔法
function ritualSpell(monsterId: number) {
  const level = getCard(monsterId).level;
  const ritualMons = (ctx: EffectContext) => ctx.duel.p(ctx.player).hand.filter((c) => c.id === monsterId);
  const tributePool = (ctx: EffectContext, ritual?: Card) =>
    [...ctx.duel.p(ctx.player).hand, ...ctx.duel.monsters(ctx.player)].filter(
      (c) => c !== ctx.card && c !== ritual && isMonster(c.data) && c.data.level > 0,
    );
  const canRitual = (ctx: EffectContext) =>
    ritualMons(ctx).some((r) => sum(tributePool(ctx, r).map((c) => c.data.level)) >= level) &&
    (ctx.duel.freeMZones(ctx.player) > 0 || ctx.duel.monsters(ctx.player).length > 0);
  return {
    effects: [
      activate({
        categories: ['summon'],
        condition: canRitual,
        operation: async (ctx) => {
          const d = ctx.duel;
          const ritual = ritualMons(ctx)[0];
          if (!ritual) return;
          const pool = tributePool(ctx, ritual);
          const valid = (sel: Card[]) =>
            sum(sel.map((c) => c.data.level)) >= level &&
            // 不能多選不需要的卡
            sel.every((x) => sum(sel.filter((y) => y !== x).map((c) => c.data.level)) < level) &&
            (d.freeMZones(ctx.player) > 0 || sel.some((c) => c.location === 'mzone'));
          const sel = await d.select({
            player: ctx.player,
            title: `選擇要解放的怪獸（等級合計 ${level} 以上）`,
            cards: pool,
            min: 1,
            max: pool.length,
            hint: 'cost',
            validate: valid,
          });
          if (!valid(sel)) return;
          d.sendToGrave(sel, 'tribute');
          d.log(`解放 ${sel.map((c) => `「${c.name}」`).join('、')}，儀式召喚！`);
          const pos = await d.choosePosition(ctx.player, ritual);
          d.specialSummon(ritual, ctx.player, { position: pos, summonType: 'ritual', by: ctx.card });
        },
        ai: () => 75,
      }),
    ],
  };
}
def(55761792, ritualSpell(5405694)); // 混沌的儀式
def(76792184, ritualSpell(30208479)); // 混沌-黑魔術的儀式

// 增援
def(32807846, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d) && !!(d.race & RACE.WARRIOR) && d.level <= 4).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && !!(d.race & RACE.WARRIOR) && d.level <= 4, 1, '選擇 4 星以下的戰士族怪獸');
      },
      ai: () => 80,
    }),
  ],
});

// 愚蠢的埋葬
def(81439173, {
  effects: [
    activate({
      categories: [],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的怪獸',
          cards: deckFilter(ctx, (x) => isMonster(x)),
          hint: 'benefit',
          aiValue: (c) => (c.id === 79814787 ? 10000 : 0) + c.data.atk,
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: (ctx) =>
        deckFilter(ctx, (d) => d.id === 79814787).length ||
        ctx.duel.p(ctx.player).hand.some((c) => [83764718, 70828912].includes(c.id))
          ? 50
          : 0,
    }),
  ],
});

// 二重召喚
def(43422537, {
  effects: [
    activate({
      operation: async (ctx) => {
        ctx.duel.p(ctx.player).normalSummons++;
        ctx.duel.log('這回合可以再通常召喚 1 次');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        const summonable = ps.hand.filter((c) => isMonster(c.data) && !cannotNormalSummon(c.data) && c.data.level <= 4).length;
        return summonable >= (ps.normalSummons > 0 ? 2 : 1) && d.freeMZones(ctx.player) >= 2 ? 35 : 0;
      },
    }),
  ],
});

// 對死者的供奉
def(79759861, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => handOthers(ctx).length > 0 && ctx.duel.monsters().length > 0,
      cost: async (ctx) => discardOne(ctx),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 55 : 0),
    }),
  ],
});

// E-緊急呼喚
def(213326, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d) && d.nameEn.startsWith('Elemental HERO')).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && d.nameEn.startsWith('Elemental HERO'), 1, '選擇「元素英雄」怪獸');
      },
      ai: () => 80,
    }),
  ],
});

// 千把刀
def(63391643, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === 46986414) && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要破壞的對方怪獸' });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: () => 60,
    }),
  ],
});

// 收縮
def(55713623, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const b = ctx.duel.battle;
        const other = b ? (b.attacker.controller === ctx.player ? b.target : b.attacker) : null;
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇原本攻擊力變成一半的怪獸',
          aiValue: (c) => (c === other ? 20000 : 0) + (c.controller === ctx.player ? -10000 : 0) + c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.addMod(t, { atk: -Math.ceil(t.data.atk / 2), until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => shrinkAi(ctx, (c) => Math.ceil(c.data.atk / 2)),
    }),
  ],
});

/** 讓戰鬥中的對方怪獸攻擊力下降，能扭轉戰鬥時發動 */
function shrinkAi(ctx: EffectContext, amount: (c: Card) => number): number {
  const d = ctx.duel;
  const b = d.battle;
  if (!b || !b.target) return 0;
  const other = b.attacker.controller === ctx.player ? b.target : b.attacker;
  if (!other.faceUp) return 0;
  return bestBoostTargetNeg(d, ctx.player, other, amount(other)) ? 55 : 0;
}

function bestBoostTargetNeg(d: Duel, me: PlayerId, other: Card, amount: number): boolean {
  // 讓對方怪獸 -amount 等同於自己的怪獸 +amount（對攻擊表示戰鬥而言）
  const b = d.battle!;
  const mine = b.attacker.controller === me ? b.attacker : b.target!;
  if (!mine.faceUp) return false;
  if (other.position === 'def' && other === b.target) return false;
  return bestBoostTarget(d, me, amount) === mine;
}

// 禁忌的聖槍
def(27243130, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const b = ctx.duel.battle;
        const other = b ? (b.attacker.controller === ctx.player ? b.target : b.attacker) : null;
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇攻擊力下降 800 的怪獸',
          aiValue: (c) => (c === other ? 20000 : 0) + (c.controller === ctx.player ? -10000 : 0) + c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        ctx.duel.addMod(t, { atk: -800, until: 'endTurn' }, ctx.card);
        ctx.duel.setFlag(t, 'immuneSpellsTraps');
      },
      ai: (ctx) => shrinkAi(ctx, () => 800),
    }),
  ],
});

