// 電腦對手（啟發式 AI）
import type { Card } from './card';
import { cannotNormalSummon, isFlip, isMonster, isPendulum, isSpell, isTrap, spellKind } from './cardDb';
import type { Duel } from './duel';
import { getScript } from './scripts';
import { cardValue } from './scripts/lib';
import type {
  Activation,
  AttackOption,
  BattleAction,
  ConfirmPrompt,
  Controller,
  MainAction,
  OptionPrompt,
  PlayerId,
  SelectPrompt,
  WindowInfo,
} from './types';
import { other } from './types';

export interface AIOptions {
  /** 0~1，越高越常做出次佳選擇（簡單難度用） */
  randomness?: number;
}

export class AIController implements Controller {
  constructor(private opts: AIOptions = {}) {}

  private jitter(duel: Duel) {
    const r = this.opts.randomness ?? 0;
    return r > 0 ? (duel.rng() - 0.5) * 40 * r : 0;
  }

  // ---------------------------------------------------------------------
  async chooseMainAction(duel: Duel, p: PlayerId, actions: MainAction[]): Promise<MainAction> {
    let best: MainAction | null = null;
    let bestScore = 0;
    const opp = other(p);
    const oppMax = Math.max(0, ...duel.monsters(opp).map((c) => (c.faceUp ? duel.getAtk(c) : 1500)));
    const summonDone = duel.p(p).normalSummons <= 0;

    for (const a of actions) {
      let s = 0;
      switch (a.type) {
        case 'activate': {
          const ctx = duel.makeCtx(a.card, a.effect, p);
          s = a.effect.ai ? a.effect.ai(ctx) : isTrap(a.card.data) ? 0 : 10;
          // 不要在自己回合主動發動速攻／陷阱的低分效果
          if (isTrap(a.card.data) && s < 30) s = 0;
          break;
        }
        case 'summon':
          s = summonDone ? 0 : this.scoreSummon(duel, p, a.card, oppMax, false);
          break;
        case 'set':
          s = summonDone ? 0 : this.scoreSummon(duel, p, a.card, oppMax, true);
          break;
        case 'spSummon':
          s = 65 + a.card.data.atk / 100;
          break;
        case 'pendulumScale':
          s = this.scorePendulumScale(duel, p, a.card, a.zone);
          break;
        case 'pendulumSummon':
          s = 70 + 8 * Math.min(5, duel.pendulumCandidates(p).length);
          break;
        case 'synchro':
        case 'xyz':
        case 'link': {
          const sets =
            a.type === 'synchro'
              ? duel.synchroMaterialSets(p, a.card)
              : a.type === 'xyz'
                ? duel.xyzMaterialSets(p, a.card)
                : duel.linkMaterialSets(p, a.card);
          const cheapest = Math.min(...sets.map((s) => s.reduce((t, c) => t + cardValue(duel, c, p), 0)));
          const gain = cardValue(duel, a.card, p) + 600 - cheapest;
          s = gain > 0 ? 50 + gain / 100 : 0;
          break;
        }
        case 'flipSummon': {
          const c = a.card;
          if (isFlip(c.data)) s = duel.monsters(opp).length ? 40 : 0;
          else if (c.data.atk > oppMax && duel.phase === 'main1') s = 32;
          break;
        }
        case 'changePos': {
          const c = a.card;
          const atk = duel.getAtk(c);
          if (c.position === 'def' && duel.phase === 'main1' && atk > oppMax && atk >= duel.getDef(c)) s = 30;
          if (c.position === 'atk' && duel.phase === 'main2' && atk < oppMax && duel.getDef(c) > atk) s = 25;
          break;
        }
        case 'setST': {
          const d = a.card.data;
          const setCount = duel.spellTraps(p).filter((c) => !c.faceUp).length;
          if (setCount >= 4) break;
          if (isTrap(d)) s = 28;
          else if (isSpell(d) && spellKind(d) === 'quickplay') s = 22;
          // 第一回合沒有其他事情做的時候才蓋
          break;
        }
        default:
          break;
      }
      if (s > 0) s += this.jitter(duel);
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    if (best) return best;
    const toBattle = actions.find((a) => a.type === 'toBattle');
    if (toBattle && duel.getAttackOptions(p).length) return toBattle;
    return actions.find((a) => a.type === 'endTurn') ?? actions[actions.length - 1];
  }

  /** 放靈擺刻度：放下後能靈擺召喚手牌的怪獸才放 */
  private scorePendulumScale(duel: Duel, p: PlayerId, card: Card, zone: 0 | 4): number {
    const ps = duel.p(p);
    if (ps.turnFlags.pendulumSummoned) return 0;
    const otherZone = zone === 0 ? 4 : 0;
    const other = ps.szone[otherZone];
    const myScale = card.data.scale ?? 0;
    const inRange = (lo: number, hi: number, exclude: Card[]) =>
      [...ps.hand.filter((c) => !exclude.includes(c) && isMonster(c.data) && !cannotNormalSummon(c.data)), ...ps.extra.filter((c) => c.faceUp)].filter(
        (c) => c.data.level > lo && c.data.level < hi,
      ).length;
    if (other) {
      if (!(other.faceUp && isPendulum(other.data))) return 0;
      const os = duel.getScale(other);
      const n = inRange(Math.min(os, myScale), Math.max(os, myScale), [card]);
      return n > 0 ? 55 + 5 * n : 0;
    }
    // 另一邊是空的：手牌有能配對的靈擺卡才放
    let best = 0;
    for (const mate of ps.hand) {
      if (mate === card || !isPendulum(mate.data)) continue;
      const ms = mate.data.scale ?? 0;
      best = Math.max(best, inRange(Math.min(ms, myScale), Math.max(ms, myScale), [card, mate]));
    }
    return best > 0 ? 50 + 5 * best : 0;
  }

  private scoreSummon(duel: Duel, p: PlayerId, card: Card, oppMax: number, set: boolean): number {
    const need = duel.tributesNeeded(card);
    const atk = card.data.atk;
    const defv = card.data.def;
    let tributeCost = 0;
    if (need > 0) {
      const vals = duel
        .tributable(p)
        .map((c) => cardValue(duel, c, p))
        .sort((a, b) => a - b);
      tributeCost = vals.slice(0, need).reduce((a, b) => a + b, 0);
      if (cardValue(duel, card, p) < tributeCost + 400) return 0;
    }
    const flip = isFlip(card.data);
    const hasSummonTrigger = getScript(card.id).effects?.some((e) => e.kind === 'trigger' && e.event === 'summoned');
    const strongEnough = atk >= oppMax || duel.monsters(other(p)).length === 0;
    const base = 40 + atk / 100 + need * 10;
    if (set) {
      if (flip) return 48;
      if (!strongEnough && defv >= atk) return 35 + defv / 200;
      if (!strongEnough && need === 0) return 30;
      return 0;
    }
    if (flip) return 0;
    if (hasSummonTrigger) return base + 10;
    if (strongEnough) return base;
    // 打不贏對方的怪獸時，攻擊力高的還是可以召喚當壁
    return atk >= 1500 && atk >= defv ? base - 15 : 0;
  }

  // ---------------------------------------------------------------------
  async chooseBattleAction(duel: Duel, p: PlayerId, options: AttackOption[]): Promise<BattleAction> {
    const sorted = [...options].sort((a, b) => duel.getAtk(b.attacker) - duel.getAtk(a.attacker));
    for (const o of sorted) {
      const atk = duel.getAtk(o.attacker);
      if (o.canDirect) return { type: 'attack', attacker: o.attacker, target: null };
      let best: Card | null = null;
      let bestVal = 0;
      for (const t of o.targets) {
        let v = -1;
        if (!t.faceUp) {
          v = atk >= 1700 ? 900 : atk >= 1500 ? 300 : -1;
        } else if (t.position === 'atk') {
          const ta = duel.getAtk(t);
          if (atk > ta) v = cardValue(duel, t, p) + (atk - ta);
          else if (atk === ta && cardValue(duel, t, p) > cardValue(duel, o.attacker, p)) v = 100;
        } else {
          const td = duel.getDef(t);
          if (atk > td) v = cardValue(duel, t, p) + (duel.has(o.attacker, 'piercing') ? atk - td : 0);
        }
        v += this.jitter(duel) * 5;
        if (v > bestVal) {
          bestVal = v;
          best = t;
        }
      }
      if (best) return { type: 'attack', attacker: o.attacker, target: best };
    }
    return { type: 'endBattle' };
  }

  // ---------------------------------------------------------------------
  async chooseResponse(duel: Duel, p: PlayerId, options: Activation[], win: WindowInfo): Promise<Activation | null> {
    let best: Activation | null = null;
    let bestScore = 0;
    for (const o of options) {
      // 同一個效果已經在連鎖上就不再重複發動
      if (duel.chain.some((l) => l.card === o.card && l.effect === o.effect)) continue;
      // 已經有自己的「攻擊無效」在連鎖上
      if (o.effect.categories?.includes('negate') && duel.chain.some((l) => l.player === p && l.effect.categories?.includes('negate')))
        continue;
      const ctx = duel.makeCtx(o.card, o.effect, p, win.event ?? duel.windowEvent ?? undefined);
      let s = 0;
      try {
        s = o.effect.ai ? o.effect.ai(ctx) : 0;
      } catch {
        s = 0;
      }
      if (s > bestScore) {
        bestScore = s;
        best = o;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------
  async selectCards(duel: Duel, prompt: SelectPrompt): Promise<Card[]> {
    const p = prompt.player;
    const mine = (c: Card) => (c.onField ? c.controller : c.owner) === p;
    const score = (c: Card): number => {
      if (prompt.aiValue) return prompt.aiValue(c);
      const v = cardValue(duel, c, p);
      switch (prompt.hint) {
        case 'harm':
          return mine(c) ? -v - 5000 : v + 5000;
        case 'cost':
          return (mine(c) ? 0 : -5000) - v;
        case 'benefit':
        default:
          return v + (mine(c) ? 1000 : 0);
      }
    };
    const ranked = [...prompt.cards].sort((a, b) => score(b) - score(a));
    const { min, max } = prompt;

    if (!prompt.validate) {
      let k = min;
      if (prompt.hint !== 'cost') {
        const positive = ranked.filter((c) => score(c) > 0).length;
        k = Math.max(min, Math.min(max, positive));
      }
      return ranked.slice(0, k);
    }

    // 有驗證條件：列舉組合
    const n = ranked.length;
    if (n <= 14) {
      let bestSet: Card[] | null = null;
      let bestScore = -Infinity;
      for (let mask = 1; mask < 1 << n; mask++) {
        let count = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) count++;
        if (count < min || count > max) continue;
        const set = ranked.filter((_, i) => mask & (1 << i));
        if (!prompt.validate(set)) continue;
        const total = set.reduce((t, c) => t + score(c), 0);
        if (total > bestScore) {
          bestScore = total;
          bestSet = set;
        }
      }
      if (bestSet) return bestSet;
    }
    const out: Card[] = [];
    for (const c of ranked) {
      out.push(c);
      if (out.length >= min && prompt.validate(out)) return out;
      if (out.length >= max) break;
    }
    return ranked.slice(0, min);
  }

  async chooseOption(_duel: Duel, prompt: OptionPrompt): Promise<number> {
    let best = 0;
    let bs = -Infinity;
    prompt.options.forEach((o, i) => {
      const s = o.ai ?? 0;
      if (s > bs) {
        bs = s;
        best = i;
      }
    });
    return best;
  }

  async confirm(_duel: Duel, prompt: ConfirmPrompt): Promise<boolean> {
    return prompt.ai ?? true;
  }
}

