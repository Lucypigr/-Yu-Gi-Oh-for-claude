// 陷阱卡的效果腳本
import { isSpell, isTrap, spellKind } from '../cardDb';
import type { EffectContext } from '../types';
import { def } from './registry';
import {
  activate,
  attacker,
  attackHurts,
  bestBoostTarget,
  boardDiff,
  canRevive,
  cardValue,
  chooseTargets,
  oppAttackDeclared,
  sum,
  tgt,
  tgts,
} from './lib';

/** 對 AI 來說威脅很大的卡（反擊陷阱用） */
const HIGH_IMPACT = new Set([
  12580477, 53129443, 19613556, 18144506, 83764718, 4031928, 24094653, 45986603, 87910978, 44095762, 53582587, 69162969,
  72302403, 70828912, 97077563, 83555666, 62279055, 55761792, 76792184, 42703248, 63391643, 79759861,
]);

const discardOne = async (ctx: EffectContext) => {
  const c = await ctx.duel.selectOne({
    player: ctx.player,
    title: '選擇要丟棄的手牌',
    cards: ctx.duel.p(ctx.player).hand,
    hint: 'cost',
  });
  if (c) ctx.duel.discard([c], 'cost');
};

const summonedByOpp = (ctx: EffectContext, types: string[]) =>
  ctx.event?.type === 'summoned' && ctx.event.player === ctx.opp && types.includes(ctx.event.summonType!);

// 落穴
def(4206964, {
  effects: [
    activate({
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) =>
        summonedByOpp(ctx, ['normal', 'tribute', 'flip']) &&
        !!ctx.event!.card &&
        ctx.event!.card.isFaceUpMonster &&
        ctx.duel.getAtk(ctx.event!.card) >= 1000,
      target: async (ctx) => {
        ctx.duel.setTargets(ctx, [ctx.event!.card!]);
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.isFaceUpMonster && ctx.duel.getAtk(t) >= 1000) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 80,
    }),
  ],
});

// 奈落的落穴
def(29401950, {
  effects: [
    activate({
      event: 'summoned',
      categories: ['destroy', 'banish'],
      condition: (ctx) =>
        ctx.event?.player === ctx.opp && !!ctx.event.cards?.some((c) => c.isFaceUpMonster && ctx.duel.getAtk(c) >= 1500),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cards = ctx.event!.cards!.filter((c) => c.isFaceUpMonster && d.getAtk(c) >= 1500);
        const destroyed = (await d.destroy(cards, 'effect', ctx.card));
        d.banish(destroyed, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.event!.cards!.some((c) => cardValue(ctx.duel, c, ctx.player) >= 1700) ? 80 : 0),
    }),
  ],
});

// 神聖防護罩 -反射鏡力-
def(44095762, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['destroy'],
      condition: oppAttackDeclared,
      operation: async (ctx) => {
        await ctx.duel.destroy(
          ctx.duel.monsters(ctx.opp).filter((c) => c.position === 'atk'),
          'effect',
          ctx.card,
        );
      },
      ai: (ctx) => (sum(ctx.duel.monsters(ctx.opp).filter((c) => c.position === 'atk').map((c) => cardValue(ctx.duel, c))) >= 1500 ? 90 : 40),
    }),
  ],
});

// 魔法筒
def(62279055, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['negate', 'damage'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        ctx.duel.negateAttack();
        ctx.duel.damage(ctx.opp, ctx.duel.getAtk(t), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.getAtk(attacker(ctx)!) >= 1500 ? 85 : 30),
    }),
  ],
});

// 炸裂裝甲
def(56120475, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['destroy'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (cardValue(ctx.duel, attacker(ctx)!) >= 1400 ? 80 : 30),
    }),
  ],
});

// 攻擊無力化
def(14315573, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['negate'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        ctx.duel.negateAttack();
        ctx.duel.p(ctx.duel.turnPlayer).turnFlags.endBattle = true;
        ctx.duel.log('戰鬥階段結束');
      },
      ai: (ctx) => (attackHurts(ctx.duel, ctx.player) >= 1500 ? 60 : 0),
    }),
  ],
});

// 次元幽閉
def(70342110, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['banish'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        ctx.duel.banish(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (cardValue(ctx.duel, attacker(ctx)!) >= 1400 ? 85 : 30),
    }),
  ],
});

// 激流葬
def(53582587, {
  effects: [
    activate({
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.type === 'summoned',
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.monsters(), 'effect', ctx.card);
      },
      ai: (ctx) => (boardDiff(ctx.duel, ctx.player) >= 1000 ? 70 : 0),
    }),
  ],
});

// 活死人的呼聲
def(97077563, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some(canRevive),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(canRevive), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t || t.location !== 'grave') return;
        if (ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) ctx.duel.link(ctx.card, t);
      },
      ai: (ctx) => {
        const best = Math.max(0, ...ctx.duel.p(ctx.player).grave.filter(canRevive).map((c) => c.data.atk));
        const d = ctx.duel;
        // 對方回合的結束階段，或攻擊宣言時當擋箭牌
        if (best >= 1800 && (d.phase === 'end' || d.battle || d.turnPlayer === ctx.player)) return 55;
        return 0;
      },
    }),
  ],
});

// 神之宣告
def(41420027, {
  effects: [
    activate({
      label: '支付一半基本分：無效',
      categories: ['negate'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (ctx.event?.type === 'summonAttempt' && !d.chain.length) return true;
        const top = d.chainTop;
        return !!top && top.isCardActivation && !top.negated && top.card !== ctx.card;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.mode = ctx.event?.type === 'summonAttempt' && !d.chain.length ? 'summon' : 'activation';
        ctx.data.link = d.chainTop;
        ctx.data.ev = ctx.event;
        d.payLP(ctx.player, Math.floor(d.p(ctx.player).lp / 2));
      },
      operation: async (ctx) => {
        if (ctx.data.mode === 'summon') ctx.data.ev.negated = true;
        else if (ctx.data.link) ctx.duel.negateLink(ctx.data.link);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.p(ctx.player).lp < 2500) return 0;
        if (ctx.event?.type === 'summonAttempt' && !d.chain.length) {
          if (ctx.event.player !== ctx.opp) return 0;
          const c = ctx.event.card!;
          return d.getAtk(c) >= 2300 || ['synchro', 'xyz', 'special'].includes(ctx.event.summonType!) && d.getAtk(c) >= 2000 ? 70 : 0;
        }
        const top = d.chainTop;
        return top && top.player === ctx.opp && HIGH_IMPACT.has(top.card.id) ? 75 : 0;
      },
    }),
  ],
});

// 魔法干擾陣
def(77414722, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.isCardActivation && isSpell(top.card.data) && !top.negated && ctx.duel.p(ctx.player).hand.length > 0;
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        await discardOne(ctx);
      },
      operation: async (ctx) => {
        if (ctx.data.link) ctx.duel.negateLink(ctx.data.link);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp && HIGH_IMPACT.has(top.card.id) ? 70 : 0;
      },
    }),
  ],
});

// 盜賊的七道具
def(3819470, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.isCardActivation && isTrap(top.card.data) && !top.negated && ctx.duel.p(ctx.player).lp > 1000;
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        ctx.duel.payLP(ctx.player, 1000);
      },
      operation: async (ctx) => {
        if (ctx.data.link) ctx.duel.negateLink(ctx.data.link);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        if (!top || top.player !== ctx.opp) return 0;
        return HIGH_IMPACT.has(top.card.id) || top.effect.categories?.some((c) => c === 'destroy' || c === 'banish' || c === 'negate') ? 70 : 0;
      },
    }),
  ],
});

// 和睦的使者
def(12607053, {
  effects: [
    activate({
      categories: [],
      operation: async (ctx) => {
        const f = ctx.duel.p(ctx.player).turnFlags;
        f.noBattleDamage = true;
        f.battleIndestructible = true;
        ctx.duel.log('這回合自己的怪獸不會被戰鬥破壞，戰鬥傷害變成 0');
      },
      ai: (ctx) => (oppAttackDeclared(ctx) && attackHurts(ctx.duel, ctx.player) >= 1200 ? 55 : 0),
    }),
  ],
});

// 沙塵之大龍捲
def(60082869, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(ctx.opp), { title: '選擇要破壞的對方魔法・陷阱卡' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(tgts(ctx), 'effect', ctx.card);
        const settable = d.p(ctx.player).hand.filter((c) => (isSpell(c.data) && spellKind(c.data) !== 'field') || isTrap(c.data));
        if (settable.length && d.freeSZones(ctx.player) > 1) {
          const c = await d.select({
            player: ctx.player,
            title: '可以從手牌蓋放 1 張魔法・陷阱卡（可不選）',
            cards: settable,
            min: 0,
            max: 1,
            hint: 'benefit',
          });
          if (c[0]) {
            d.moveTo(c[0], 'szone', { reason: 'effect', player: ctx.player, faceUp: false });
            d.log(`${d.p(ctx.player).name} 蓋放 1 張魔法・陷阱卡`);
          }
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        if (top && top.player === ctx.opp && top.isCardActivation) return 50;
        if (d.turnPlayer === ctx.opp && d.phase === 'end') return 45;
        return d.spellTraps(ctx.opp).some((c) => c.faceUp) ? 35 : 0;
      },
    }),
  ],
});

// 雷破
def(4178474, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      cost: async (ctx) => discardOne(ctx),
      target: async (ctx) => {
        const b = ctx.duel.battle;
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -10000 : 0) + (b?.attacker === c ? 5000 : 0) + cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (oppAttackDeclared(ctx) && attackHurts(d, ctx.player) >= 1000) return 60;
        if (d.turnPlayer === ctx.opp && d.phase === 'end' && d.fieldCards(ctx.opp).some((c) => cardValue(d, c, ctx.player) >= 1800)) return 45;
        return 0;
      },
    }),
  ],
});

// 破壞輪
def(83555666, {
  effects: [
    activate({
      once: 'name',
      categories: ['destroy', 'damage'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) <= ctx.duel.p(ctx.opp).lp),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.opp).filter((c) => ctx.duel.getAtk(c) <= ctx.duel.p(ctx.opp).lp),
          { title: '選擇要破壞的對方怪獸', aiValue: (c) => c.data.atk },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !t.isFaceUpMonster) return;
        const dmg = Math.max(0, t.data.atk);
        if (!(await d.destroy([t], 'effect', ctx.card)).length) return;
        if (d.p(ctx.player).lp <= dmg && d.p(ctx.opp).lp <= dmg) {
          d.p(ctx.player).lp = 0;
          d.p(ctx.opp).lp = 0;
          d.drawGame('雙方的基本分同時歸零，平手');
        }
        d.damage(ctx.player, dmg, 'effect', ctx.card);
        d.damage(ctx.opp, dmg, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters(ctx.opp).filter((c) => d.getAtk(c) <= d.p(ctx.opp).lp);
        const maxAtk = Math.max(0, ...mons.map((c) => c.data.atk));
        if (maxAtk >= d.p(ctx.opp).lp && d.p(ctx.player).lp > maxAtk) return 200;
        return maxAtk >= 2000 && d.p(ctx.player).lp > maxAtk + 2500 && (oppAttackDeclared(ctx) || d.phase === 'end') ? 50 : 0;
      },
    }),
  ],
});

// 援軍
def(17814387, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const best = bestBoostTarget(ctx.duel, ctx.player, 500);
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇攻擊力上升 500 的怪獸',
          hint: 'benefit',
          aiValue: (c) => (c === best ? 10000 : 0) + (c.controller === ctx.player ? 1000 : -10000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.addMod(t, { atk: 500, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, 500) ? 60 : 0),
    }),
  ],
});

// 強制脫出裝置
def(94192409, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        const b = ctx.duel.battle;
        await chooseTargets(ctx, ctx.duel.monsters(), {
          title: '選擇要回到手牌的怪獸',
          aiValue: (c) =>
            (c.controller === ctx.player ? -10000 : 0) +
            (b?.attacker === c ? 5000 : 0) +
            (c.data.type & 0x802040 ? 3000 : 0) +
            cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (oppAttackDeclared(ctx) && attackHurts(d, ctx.player) >= 1000) return 55;
        if (ctx.event?.type === 'summoned' && ctx.event.player === ctx.opp && ctx.event.card && ['synchro', 'xyz', 'fusion'].includes(ctx.event.summonType!))
          return 60;
        return 0;
      },
    }),
  ],
});

// 威嚇之咆哮
def(36361633, {
  effects: [
    activate({
      categories: [],
      condition: (ctx) => ctx.duel.turnPlayer === ctx.opp,
      operation: async (ctx) => {
        ctx.duel.p(ctx.opp).turnFlags.cannotDeclareAttack = true;
        ctx.duel.log(`這回合 ${ctx.duel.p(ctx.opp).name} 不能攻擊宣言`);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.phase !== 'battle' || d.battle) return 0;
        const threat = sum(d.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk').map((c) => d.getAtk(c)));
        return threat >= 2000 ? 60 : 0;
      },
    }),
  ],
});

// 廢鐵稻草人
def(98427577, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['negate'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        ctx.duel.negateAttack();
        if (ctx.card.location === 'szone') {
          ctx.card.faceUp = false;
          ctx.card.turnPlaced = ctx.duel.turn;
          ctx.data.keepOnField = true;
          ctx.duel.log(`「${ctx.card.name}」再度蓋放`);
        }
      },
      ai: (ctx) => (attackHurts(ctx.duel, ctx.player) >= 1000 ? 60 : 0),
    }),
  ],
});

// 吸收盾
def(43250041, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['negate', 'recover'],
      condition: oppAttackDeclared,
      target: async (ctx) => {
        const a = attacker(ctx);
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        ctx.duel.negateAttack();
        if (t.isFaceUpMonster) ctx.duel.recover(ctx.player, ctx.duel.getAtk(t));
      },
      ai: (ctx) => (attackHurts(ctx.duel, ctx.player) >= 1000 ? 65 : 0),
    }),
  ],
});

// 超重力網
def(85742772, {
  effects: [
    activate({
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = d.faceUpMonsters(ctx.opp).filter((c) => c.data.level >= 4).length;
        const mine = d.faceUpMonsters(ctx.player).filter((c) => c.data.level >= 4).length;
        return theirs > mine ? 50 : 0;
      },
    }),
    {
      kind: 'continuous',
      query: (duel, _self, q, t) => q === 'cannotAttack' && !!t && t.location === 'mzone' && duel.getLevel(t) >= 4 && !(t.data.type & 0x800000),
    },
  ],
});

// 強欲之瓶
def(83968380, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 40 : 0),
    }),
  ],
});

// 萬能地雷 闊劍式
def(77754944, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['destroy'],
      condition: (ctx) => oppAttackDeclared(ctx) && ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk'),
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk');
        if (!mons.length) return;
        const top = Math.max(...mons.map((c) => d.getAtk(c)));
        const cands = mons.filter((c) => d.getAtk(c) === top);
        const c = cands.length > 1 ? await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: cands, hint: 'harm' }) : cands[0];
        if (c) await d.destroy([c], 'effect', ctx.card);
      },
      ai: () => 75,
    }),
  ],
});

