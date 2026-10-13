// 陷阱卡的效果腳本（第二彈）
import type { Card } from '../card';
import { isMonster, isTrap } from '../cardDb';
import type { EffectContext, EffectDef } from '../types';
import { def } from './registry';
import {
  activate,
  attacker,
  attackHurts,
  bestBoostTarget,
  canRevive,
  cardValue,
  chooseTargets,
  oppAttackDeclared,
  simulateBattle,
  statAura,
  sum,
  tgt,
  tgts,
} from './lib';

const isHero = (c: Card) => c.data.nameEn.startsWith('Elemental HERO');

/** 「自己的怪獸被戰鬥破壞送去墓地時」 */
const ownBattleDestroyed = (ctx: EffectContext) =>
  ctx.event?.type === 'destroyed' &&
  ctx.event.reason === 'battle' &&
  !!ctx.event.cards?.some((c) => c.owner === ctx.player && c.location === 'grave');

/** 把永續陷阱「綁」在對象怪獸上：怪獸離場時這張卡也送去墓地 */
function attachTo(card: Card, target: Card) {
  card.equipTarget = target;
  card.equipStint = target.stint;
}

const boundTo = (self: Card, t: Card | null) => !!t && self.equipTarget === t && self.equipStint === t.stint;

// 英雄標記
def(22020907, {
  effects: [
    activate({
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ownBattleDestroyed(ctx) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isHero(c) && c.data.level <= 4),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isHero(c) && c.data.level <= 4);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的元素英雄', cards: cands, hint: 'benefit' });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: await d.choosePosition(ctx.player, c), by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 70,
    }),
  ],
});

// 蓄積硫酸的落穴
def(41356845, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).some((c) => !c.faceUp),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters().filter((c) => !c.faceUp), { title: '選擇裡側守備表示的怪獸' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.faceUp) return;
        d.changePosition(t, 'def', true, ctx.card);
        if (d.getDef(t) <= 2000) await d.destroy([t], 'effect', ctx.card);
        else d.changePosition(t, 'def', false, ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => !c.faceUp && c.data.def <= 2000) ? 45 : 0),
    }),
  ],
});

/** 束縛類永續陷阱（暗之咒縛、六芒星之咒縛、魔族之鏈） */
function bindingTrap(id: number, opts: { atk?: number; negate?: boolean; effectOnly?: boolean; title: string }) {
  const cands = (ctx: EffectContext) =>
    ctx.duel.faceUpMonsters(opts.effectOnly ? undefined : ctx.opp).filter((c) => !opts.effectOnly || c.data.type & 0x20);
  const effects: EffectDef[] = [
    activate({
      categories: opts.negate ? ['negate'] : ['stat'],
      condition: (ctx) => cands(ctx).length > 0,
      target: async (ctx) => {
        const b = ctx.duel.battle;
        await chooseTargets(ctx, cands(ctx), {
          title: opts.title,
          aiValue: (c) => (c.controller === ctx.player ? -10000 : 0) + (b?.attacker === c ? 5000 : 0) + cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        attachTo(ctx.card, t);
        if (opts.negate) {
          t.negated = true;
          ctx.duel.log(`「${t.name}」的效果無效`);
        }
        if (ctx.duel.battle?.attacker === t) ctx.duel.negateAttack();
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (oppAttackDeclared(ctx) && attackHurts(d, ctx.player) >= 800) return 60;
        if (d.turnPlayer === ctx.opp && d.phase === 'battle' && !d.battle && d.faceUpMonsters(ctx.opp).some((c) => d.getAtk(c) >= 1800)) return 45;
        return 0;
      },
    }),
    {
      kind: 'continuous',
      query: (_d, self, q, t) => (q === 'cannotAttack' || (q === 'cannotChangePosition' && !opts.negate)) && boundTo(self, t),
    },
  ];
  if (opts.atk) effects.push(statAura((_d, self, t) => boundTo(self, t), opts.atk, 0, ['szone']));
  def(id, {
    effects,
    onLeaveField: (_duel, self) => {
      const t = self.equipTarget;
      if (opts.negate && t && t.stint === self.equipStint) t.negated = false;
    },
  });
}
bindingTrap(29267084, { atk: -700, title: '選擇對方表側表示的怪獸' }); // 暗之咒縛
bindingTrap(18807108, { title: '選擇對方的怪獸' }); // 六芒星之咒縛
bindingTrap(50078509, { negate: true, effectOnly: true, title: '選擇場上的效果怪獸' }); // 魔族之鏈

// 援護射擊
def(74458486, {
  effects: [
    activate({
      event: 'damageCalc',
      damageStep: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return (
          !!b && b.attacker.controller === ctx.opp && !!b.target && b.target.controller === ctx.player && b.target.faceUp &&
          ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== b.target)
        );
      },
      target: async (ctx) => {
        const b = ctx.duel.battle!;
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== b.target), {
          title: '選擇提供攻擊力的另 1 隻怪獸',
          hint: 'benefit',
          aiValue: (c) => ctx.duel.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        const helper = tgt(ctx);
        if (!b?.target || !helper?.isFaceUpMonster) return;
        ctx.duel.addMod(b.target, { atk: ctx.duel.getAtk(helper), until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle!;
        const best = Math.max(0, ...ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== b.target).map((c) => ctx.duel.getAtk(c)));
        return bestBoostTarget(ctx.duel, ctx.player, best) ? 65 : 0;
      },
    }),
  ],
});

// 夾擊
def(83887306, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.player).length >= 2 && ctx.duel.monsters(ctx.opp).length >= 1,
      target: async (ctx) => {
        const d = ctx.duel;
        const own = await d.select({ player: ctx.player, title: '選擇自己 2 隻怪獸', cards: d.monsters(ctx.player), min: 2, max: 2, hint: 'cost' });
        const foe = await d.selectOne({ player: ctx.player, title: '選擇對方 1 隻怪獸', cards: d.monsters(ctx.opp), hint: 'harm' });
        d.setTargets(ctx, [...own, ...(foe ? [foe] : [])]);
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const own = d.monsters(ctx.player).map((c) => cardValue(d, c, ctx.player)).sort((a, b) => a - b);
        const foe = Math.max(0, ...d.monsters(ctx.opp).map((c) => cardValue(d, c, ctx.player)));
        return own.length >= 2 && foe > own[0] + own[1] ? 45 : 0;
      },
    }),
  ],
});

// 同路人
def(37580756, {
  effects: [
    activate({
      event: 'destroyed',
      categories: ['destroy'],
      condition: (ctx) => ownBattleDestroyed(ctx) && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 60 : 0),
    }),
  ],
});

// 靈魂障壁
def(53239672, {
  effects: [
    activate({ ai: (ctx) => (oppAttackDeclared(ctx) && (simulateBattle(ctx.duel)?.dmgToDefender ?? 0) >= 1000 ? 50 : 0) }),
    {
      kind: 'continuous',
      query: (duel, self, q, _t, player) => q === 'noBattleDamage' && player === self.controller && duel.monsters(self.controller).length > 0,
    },
  ],
});

// 城壁
def(44209392, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const b = ctx.duel.battle;
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇守備力上升 500 的怪獸',
          hint: 'benefit',
          aiValue: (c) => (b?.target === c && c.controller === ctx.player ? 10000 : 0) + (c.controller === ctx.player ? 1000 : -10000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.addMod(t, { def: 500, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b?.target || b.target.controller !== ctx.player || b.target.position !== 'def' || !b.target.faceUp) return 0;
        const atk = ctx.duel.getAtk(b.attacker);
        const def = ctx.duel.getDef(b.target);
        return atk > def && atk <= def + 500 ? 60 : 0;
      },
    }),
  ],
});

// 弱體化之假面
def(57882509, {
  effects: [
    activate({
      event: 'attackDeclared',
      damageStep: true,
      categories: ['stat'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.addMod(t, { atk: -700, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle!;
        if (!b.target) return 30;
        return bestBoostTarget(ctx.duel, ctx.player, 700) ? 60 : 0;
      },
    }),
  ],
});

// 停戰協定
def(36468556, {
  effects: [
    activate({
      categories: ['damage', 'position'],
      condition: (ctx) => ctx.duel.monsters().some((c) => !c.faceUp || c.data.type & 0x20),
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.monsters()) {
          if (!c.faceUp) {
            c.faceUp = true;
            c.position = 'def';
          }
        }
        d.log('場上的裡側怪獸全部變成表側守備表示');
        d.damage(ctx.opp, 500 * d.monsters().filter((c) => c.data.type & 0x20).length, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const n = ctx.duel.monsters().filter((c) => c.data.type & 0x20 || !c.faceUp).length;
        return ctx.duel.p(ctx.opp).lp <= 500 * n ? 200 : n >= 3 ? 35 : 0;
      },
    }),
  ],
});

// 內置式機槍
def(27053506, {
  effects: [
    activate({
      categories: ['damage'],
      operation: async (ctx) => {
        const d = ctx.duel;
        d.damage(ctx.opp, 200 * (d.p(ctx.opp).hand.length + d.fieldCards(ctx.opp).length), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const dmg = 200 * (d.p(ctx.opp).hand.length + d.fieldCards(ctx.opp).length);
        return dmg >= d.p(ctx.opp).lp ? 200 : dmg >= 1600 ? 40 : 0;
      },
    }),
  ],
});

// 自業自得
def(24068492, {
  effects: [
    activate({
      categories: ['damage'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500 * ctx.duel.monsters(ctx.opp).length, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const dmg = 500 * ctx.duel.monsters(ctx.opp).length;
        return dmg >= ctx.duel.p(ctx.opp).lp ? 200 : dmg >= 1500 ? 40 : 0;
      },
    }),
  ],
});

// 聖精靈的祝福
def(98299011, {
  effects: [
    activate({
      categories: ['recover'],
      operation: async (ctx) => {
        ctx.duel.recover(ctx.player, 300 * ctx.duel.monsters().length);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp <= 3000 && ctx.duel.monsters().length >= 3 ? 35 : 0),
    }),
  ],
});

// ---- 反擊陷阱 ----

/** 召喚之際（神之警告・升天之角笛） */
const summonAttempt = (ctx: EffectContext) => ctx.event?.type === 'summonAttempt' && !ctx.duel.chain.length;
const summonAttemptAi = (ctx: EffectContext) => {
  if (ctx.event?.player !== ctx.opp) return 0;
  const c = ctx.event.card!;
  return ctx.duel.getAtk(c) >= 2200 || (['synchro', 'xyz', 'special'].includes(ctx.event.summonType!) && ctx.duel.getAtk(c) >= 1900) ? 70 : 0;
};

// 神之警告
def(84749824, {
  effects: [
    activate({
      label: '支付 2000：無效召喚或特殊召喚的效果',
      categories: ['negate'],
      condition: (ctx) => {
        if (ctx.duel.p(ctx.player).lp <= 2000) return false;
        if (summonAttempt(ctx)) return true;
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.card !== ctx.card && !!top.effect.categories?.includes('summon');
      },
      cost: async (ctx) => {
        ctx.data.mode = summonAttempt(ctx) ? 'summon' : 'activation';
        ctx.data.link = ctx.duel.chainTop;
        ctx.data.ev = ctx.event;
        ctx.duel.payLP(ctx.player, 2000);
      },
      operation: async (ctx) => {
        if (ctx.data.mode === 'summon') ctx.data.ev.negated = true;
        else if (ctx.data.link) {
          ctx.duel.negateLink(ctx.data.link);
          const l = ctx.data.link;
          if (!l.isCardActivation && l.card.onField) await ctx.duel.destroy([l.card], 'effect', ctx.card);
        }
      },
      ai: (ctx) => {
        if (ctx.duel.p(ctx.player).lp < 4000) return 0;
        if (summonAttempt(ctx)) return summonAttemptAi(ctx);
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp ? 55 : 0;
      },
    }),
  ],
});

// 升天之角笛
def(98069388, {
  effects: [
    activate({
      label: '解放 1 隻怪獸：無效召喚',
      categories: ['negate'],
      condition: (ctx) => summonAttempt(ctx) && ctx.duel.tributable(ctx.player).length > 0,
      cost: async (ctx) => {
        ctx.data.ev = ctx.event;
        const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: ctx.duel.tributable(ctx.player), hint: 'cost' });
        if (c) ctx.duel.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        ctx.data.ev.negated = true;
      },
      ai: (ctx) => {
        const cheapest = Math.min(...ctx.duel.tributable(ctx.player).map((c) => cardValue(ctx.duel, c, ctx.player)));
        return summonAttemptAi(ctx) && cardValue(ctx.duel, ctx.event!.card!, ctx.player) > cheapest ? 65 : 0;
      },
    }),
  ],
});

// 魔宮的賄賂
def(77538567, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.isCardActivation && top.player === ctx.opp && !top.negated;
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        if (!ctx.data.link) return;
        ctx.duel.negateLink(ctx.data.link);
        ctx.duel.draw(ctx.opp, 1);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop!;
        return top.effect.categories?.some((c) => c === 'destroy' || c === 'control' || c === 'banish') ? 65 : 0;
      },
    }),
  ],
});

// 天罰
def(49010598, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.isCardActivation && isMonster(top.card.data) && !top.negated && ctx.duel.p(ctx.player).hand.length > 0;
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: ctx.duel.p(ctx.player).hand, hint: 'cost' });
        if (c) ctx.duel.discard([c], 'cost');
      },
      operation: async (ctx) => {
        const l = ctx.data.link;
        if (!l) return;
        ctx.duel.negateLink(l);
        if (l.card.onField) await ctx.duel.destroy([l.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 60 : 0),
    }),
  ],
});

// 陷阱干擾陣
def(19252988, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.duel.phase === 'battle' && !!top && top.isCardActivation && isTrap(top.card.data) && top.player === ctx.opp && !top.negated;
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        if (ctx.data.link) ctx.duel.negateLink(ctx.data.link);
      },
      ai: () => 70,
    }),
  ],
});

// 來自異次元的歸還
def(27174286, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).banished.some((c) => isMonster(c.data) && canRevive(c)),
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, Math.floor(ctx.duel.p(ctx.player).lp / 2));
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const list = d.p(ctx.player).banished.filter((c) => isMonster(c.data) && canRevive(c)).sort((a, b) => b.data.atk - a.data.atk);
        for (const c of list) {
          if (d.freeMZones(ctx.player) <= 0) break;
          if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'banishAtEnd');
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const power = sum(d.p(ctx.player).banished.filter((c) => isMonster(c.data) && canRevive(c)).map((c) => c.data.atk));
        return d.turnPlayer === ctx.player && d.phase === 'main1' && d.turn > 1 && power >= d.p(ctx.opp).lp ? 150 : 0;
      },
    }),
  ],
});

// 命之綱
def(93382620, {
  effects: [
    activate({
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) => ownBattleDestroyed(ctx) && ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.freeMZones(ctx.player) > 0,
      cost: async (ctx) => {
        ctx.duel.discard([...ctx.duel.p(ctx.player).hand], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          (ctx.event!.cards ?? []).filter((c) => c.owner === ctx.player && c.location === 'grave'),
          { title: '選擇要特殊召喚的怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location !== 'grave') return;
        if (ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) ctx.duel.addMod(t, { atk: 800, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.length <= 1 && (ctx.event!.cards ?? []).some((c) => c.data.atk >= 1800) ? 50 : 0),
    }),
  ],
});

// 惡魔的骰子
def(126218, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const n = ctx.duel.random(6) + 1;
        ctx.duel.log(`骰子點數：${n}`);
        for (const c of ctx.duel.faceUpMonsters(ctx.opp)) ctx.duel.addMod(c, { atk: -n * 100, def: -n * 100, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (oppAttackDeclared(ctx) && bestBoostTarget(ctx.duel, ctx.player, 300) ? 50 : 0),
    }),
  ],
});

// 哥布林攔路賊
def(88279736, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.player).length > 0 ? 30 : 0) }),
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      categories: ['discard'],
      condition: (ctx) =>
        ctx.card.location === 'szone' &&
        ctx.card.faceUp &&
        ctx.event?.player === ctx.opp &&
        ctx.event.by?.controller === ctx.player &&
        ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        const hand = ctx.duel.p(ctx.opp).hand;
        if (hand.length) ctx.duel.discard([hand[ctx.duel.random(hand.length)]], 'effect', ctx.card);
      },
    },
  ],
});

// 附鎖鏈的回力鏢
def(37390589, {
  effects: [
    activate({
      categories: ['position', 'stat'],
      condition: (ctx) => oppAttackDeclared(ctx) || ctx.duel.faceUpMonsters(ctx.player).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const canA = oppAttackDeclared(ctx);
        const canB = d.faceUpMonsters(ctx.player).length > 0;
        const mode =
          canA && canB
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [{ label: '攻擊怪獸變成守備表示', ai: 2 }, { label: '當作裝備卡（攻擊力 +500）', ai: 1 }],
              })
            : canA
              ? 0
              : 1;
        ctx.data.mode = mode;
        if (mode === 0) {
          const a = attacker(ctx);
          if (a) d.setTargets(ctx, [a]);
        } else {
          await chooseTargets(ctx, d.faceUpMonsters(ctx.player), { title: '選擇要裝備的自己怪獸', hint: 'benefit' });
        }
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        if (ctx.data.mode === 0) {
          ctx.duel.changePosition(t, 'def', true, ctx.card);
          ctx.duel.negateAttack();
        } else if (ctx.card.onField) {
          attachTo(ctx.card, t);
          ctx.data.keepOnField = true;
        }
      },
      ai: (ctx) => (oppAttackDeclared(ctx) && attackHurts(ctx.duel, ctx.player) >= 1000 ? 55 : bestBoostTarget(ctx.duel, ctx.player, 500) ? 45 : 0),
    }),
    statAura((_d, self, t) => boundTo(self, t), 500, 0, ['szone']),
  ],
});

