import { describe, expect, it } from 'vitest';
import { AIController } from '../ai';
import { Card } from '../card';
import { getCard } from '../cardDb';
import { Duel, DuelEnd } from '../duel';
import type { Activation, PlayerId, Position } from '../types';

const FILLER = 76184692; // 獨眼巨人（通常怪獸）

/** 可以指定回應的 AI */
class TestAI extends AIController {
  respondWith: number[] = [];
  declineAll = false;
  async chooseResponse(duel: Duel, p: PlayerId, options: Activation[], win: any) {
    if (this.declineAll) return null;
    const forced = options.find((o) => this.respondWith.includes(o.card.id));
    if (forced) return forced;
    return super.chooseResponse(duel, p, options, win);
  }
}

function setup() {
  const a = new TestAI();
  const b = new TestAI();
  const deck = { main: Array(30).fill(FILLER), extra: [] as number[] };
  const duel = new Duel(
    [
      { name: '甲', deck, controller: a },
      { name: '乙', deck: { ...deck }, controller: b },
    ],
    { seed: 1, firstPlayer: 0 },
  );
  duel.turn = 3;
  duel.turnPlayer = 0;
  duel.phase = 'main1';
  return { duel, a, b };
}

function put(duel: Duel, p: PlayerId, id: number, loc: 'hand' | 'mzone' | 'szone' | 'grave' | 'extra' | 'deck', opts: { pos?: Position; faceUp?: boolean } = {}) {
  const c = new Card(getCard(id), p);
  c.location = 'void';
  if (loc === 'mzone' || loc === 'szone') {
    duel.moveTo(c, loc, { reason: 'rule', player: p, faceUp: opts.faceUp ?? loc === 'mzone', position: opts.pos ?? 'atk' });
    c.turnPlaced = 1;
  } else if (loc === 'deck') {
    c.location = 'deck';
    duel.p(p).deck.unshift(c);
  } else if (loc === 'extra') {
    c.location = 'extra';
    duel.p(p).extra.push(c);
  } else {
    duel.moveTo(c, loc, { reason: 'rule' });
  }
  return c;
}

async function safe(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof DuelEnd)) throw e;
  }
}

describe('戰鬥', () => {
  it('攻擊表示對攻擊表示：差值傷害並破壞', async () => {
    const { duel } = setup();
    const a = put(duel, 0, 89631139, 'mzone'); // 3000
    const b = put(duel, 1, 46986414, 'mzone'); // 2500
    await duel.performAttack(a, b);
    expect(b.location).toBe('grave');
    expect(duel.p(1).lp).toBe(7500);
  });

  it('攻擊守備表示：不受傷害；貫通有傷害', async () => {
    const { duel } = setup();
    const a = put(duel, 0, 31553716, 'mzone'); // 長槍龍 1900 貫通
    const b = put(duel, 1, FILLER, 'mzone', { pos: 'def' }); // 守備 1000
    await duel.performAttack(a, b);
    expect(b.location).toBe('grave');
    expect(duel.p(1).lp).toBe(7100);
    expect(a.position).toBe('def'); // 攻擊後變守備
  });

  it('攻擊力較低時攻擊方受傷', async () => {
    const { duel } = setup();
    const a = put(duel, 0, FILLER, 'mzone'); // 1200
    const b = put(duel, 1, 15025844, 'mzone', { pos: 'def' }); // 聖精靈 守 2000
    await duel.performAttack(a, b);
    expect(a.location).toBe('mzone');
    expect(duel.p(0).lp).toBe(7200);
  });

  it('直接攻擊與勝利', async () => {
    const { duel } = setup();
    duel.p(1).lp = 1000;
    const a = put(duel, 0, 89631139, 'mzone');
    await safe(() => duel.performAttack(a, null));
    expect(duel.winner).toBe(0);
  });

  it('反轉效果在傷害計算後發動', async () => {
    const { duel } = setup();
    const a = put(duel, 0, 89631139, 'mzone');
    put(duel, 1, 54652250, 'mzone', { pos: 'def', faceUp: false }); // 食人蟲
    await duel.performAttack(a, duel.monsters(1)[0]);
    expect(a.location).toBe('grave');
  });

  it('殺人番茄被戰鬥破壞後從牌組特殊召喚', async () => {
    const { duel } = setup();
    const a = put(duel, 0, 89631139, 'mzone');
    const t = put(duel, 1, 83011277, 'mzone');
    put(duel, 1, 26202165, 'deck'); // 三眼怪（暗 1000）
    await duel.performAttack(a, t);
    expect(duel.monsters(1).map((c) => c.id)).toContain(26202165);
  });
});

describe('召喚', () => {
  it('上級召喚需要解放，三眼怪被解放時檢索', async () => {
    const { duel } = setup();
    const sangan = put(duel, 0, 26202165, 'mzone');
    put(duel, 0, 40640057, 'deck'); // 栗子球
    const skull = put(duel, 0, 70781052, 'hand');
    expect(duel.canNormalSummon(0, skull)).toBe(true);
    await duel.performMainAction(0, { type: 'summon', card: skull });
    expect(skull.location).toBe('mzone');
    expect(sangan.location).toBe('grave');
    expect(duel.p(0).hand.length).toBe(1); // 從牌組檢索了 1 張
    expect(duel.p(0).deck.length).toBe(30);
  });

  it('落穴破壞召喚的怪獸', async () => {
    const { duel, b } = setup();
    b.respondWith = [4206964];
    put(duel, 1, 4206964, 'szone', { faceUp: false });
    const m = put(duel, 0, 91152256, 'hand');
    await duel.performMainAction(0, { type: 'summon', card: m });
    expect(m.location).toBe('grave');
  });

  it('神之宣告無效召喚', async () => {
    const { duel, b } = setup();
    b.respondWith = [41420027];
    put(duel, 1, 41420027, 'szone', { faceUp: false });
    const m = put(duel, 0, 91152256, 'hand');
    await duel.performMainAction(0, { type: 'summon', card: m });
    expect(m.location).toBe('grave');
    expect(duel.p(1).lp).toBe(4000);
  });

  it('融合召喚青眼究極龍', async () => {
    const { duel } = setup();
    put(duel, 0, 89631139, 'hand');
    put(duel, 0, 89631139, 'hand');
    put(duel, 0, 89631139, 'mzone');
    const ext = put(duel, 0, 23995346, 'extra');
    const poly = put(duel, 0, 24094653, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === poly)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: poly, effect: act.effect, effectIndex: act.effectIndex });
    expect(ext.location).toBe('mzone');
    expect(ext.summonType).toBe('fusion');
    expect(duel.p(0).grave.filter((c) => c.id === 89631139).length).toBe(3);
    expect(poly.location).toBe('grave');
  });

  it('同步召喚廢品戰士並加攻', async () => {
    const { duel } = setup();
    put(duel, 0, 63977008, 'mzone'); // 廢品同調士 3
    put(duel, 0, 9365703, 'mzone'); // 高速戰士 2 (900)
    const jw = put(duel, 0, 60800381, 'extra');
    expect(duel.synchroMaterialSets(0, jw).length).toBe(1);
    await duel.performMainAction(0, { type: 'synchro', card: jw });
    expect(jw.location).toBe('mzone');
    expect(duel.getAtk(jw)).toBe(2300); // 素材已離場
  });

  it('超量召喚希望皇霍普並無效攻擊', async () => {
    const { duel } = setup();
    put(duel, 0, 91152256, 'mzone');
    put(duel, 0, 11321183, 'mzone');
    const u = put(duel, 0, 84013237, 'extra');
    await duel.performMainAction(0, { type: 'xyz', card: u });
    expect(u.location).toBe('mzone');
    expect(u.overlays.length).toBe(2);
    // 對方回合攻擊
    duel.turnPlayer = 1;
    const atk = put(duel, 1, 89631139, 'mzone');
    await duel.performAttack(atk, u);
    expect(u.location).toBe('mzone');
    expect(u.overlays.length).toBe(1);
    expect(duel.p(0).lp).toBe(8000);
  });

  it('儀式召喚混沌戰士', async () => {
    const { duel } = setup();
    const bls = put(duel, 0, 5405694, 'hand');
    put(duel, 0, 89631139, 'hand'); // 8 星
    const rit = put(duel, 0, 55761792, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === rit)!;
    await duel.performMainAction(0, { type: 'activate', card: rit, effect: act.effect, effectIndex: act.effectIndex });
    expect(bls.location).toBe('mzone');
  });

  it('電子龍可以從手牌特殊召喚', () => {
    const { duel } = setup();
    const cd = put(duel, 0, 70095154, 'hand');
    expect(duel.getMainActions(0).some((a) => a.type === 'spSummon' && a.card === cd)).toBe(false);
    put(duel, 1, FILLER, 'mzone');
    expect(duel.getMainActions(0).some((a) => a.type === 'spSummon' && a.card === cd)).toBe(true);
  });
});

describe('魔法・陷阱', () => {
  it('神聖防護罩 反射鏡力', async () => {
    const { duel, b } = setup();
    b.respondWith = [44095762];
    put(duel, 1, 44095762, 'szone', { faceUp: false });
    const a1 = put(duel, 0, 89631139, 'mzone');
    const a2 = put(duel, 0, 46986414, 'mzone');
    await duel.performAttack(a1, null);
    expect(a1.location).toBe('grave');
    expect(a2.location).toBe('grave');
    expect(duel.p(1).lp).toBe(8000);
  });

  it('人造人在場時不能發動陷阱', () => {
    const { duel } = setup();
    put(duel, 1, 44095762, 'szone', { faceUp: false });
    put(duel, 0, 77585513, 'mzone');
    const a = put(duel, 0, 89631139, 'mzone');
    duel.battle = { attacker: a, attackerStint: a.stint, target: null, targetStint: 0, negated: false, damageStep: false, noDamage: [false, false], skipCalc: false, flipped: false };
    expect(duel.getActivatable(1, { kind: 'attack', event: { type: 'attackDeclared', attacker: a, target: null } })).toEqual([]);
  });

  it('心變的控制權在結束階段返還', async () => {
    const { duel } = setup();
    const target = put(duel, 1, 89631139, 'mzone');
    const coh = put(duel, 0, 4031928, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === coh)!;
    await duel.performMainAction(0, { type: 'activate', card: coh, effect: act.effect, effectIndex: act.effectIndex });
    expect(target.controller).toBe(0);
    for (const c of duel.monsters()) if (c.controlUntilEnd) duel.returnControl(c);
    expect(target.controller).toBe(1);
  });

  it('強奪被破壞時控制權返還', async () => {
    const { duel } = setup();
    const target = put(duel, 1, 89631139, 'mzone');
    const ss = put(duel, 0, 45986603, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === ss)!;
    await duel.performMainAction(0, { type: 'activate', card: ss, effect: act.effect, effectIndex: act.effectIndex });
    expect(target.controller).toBe(0);
    expect(ss.location).toBe('szone');
    duel.destroy([ss], 'effect');
    expect(target.controller).toBe(1);
  });

  it('活死人的呼聲離場時怪獸破壞', async () => {
    const { duel } = setup();
    const m = put(duel, 0, 89631139, 'grave');
    const coth = put(duel, 0, 97077563, 'szone', { faceUp: false });
    const act = duel.getActivatable(0).find((a) => a.card === coth)!;
    await duel.performMainAction(0, { type: 'activate', card: coth, effect: act.effect, effectIndex: act.effectIndex });
    expect(m.location).toBe('mzone');
    expect(coth.location).toBe('szone');
    duel.destroy([coth], 'effect');
    expect(m.location).toBe('grave');
  });

  it('光之護封劍讓對方不能攻擊', async () => {
    const { duel } = setup();
    const sw = put(duel, 0, 72302403, 'hand');
    put(duel, 1, 89631139, 'mzone');
    const act = duel.getActivatable(0).find((a) => a.card === sw)!;
    await duel.performMainAction(0, { type: 'activate', card: sw, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.getAttackOptions(1)).toEqual([]);
  });

  it('替罪羊的衍生物不能上級召喚', async () => {
    const { duel } = setup();
    const sg = put(duel, 0, 73915051, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === sg)!;
    await duel.performMainAction(0, { type: 'activate', card: sg, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.monsters(0).length).toBe(4);
    const skull = put(duel, 0, 70781052, 'hand');
    expect(duel.canNormalSummon(0, skull)).toBe(false);
  });

  it('星塵龍無效雷擊', async () => {
    const { duel, b } = setup();
    b.respondWith = [44508094];
    const sd = put(duel, 1, 44508094, 'mzone');
    const rai = put(duel, 0, 12580477, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === rai)!;
    await duel.performMainAction(0, { type: 'activate', card: rai, effect: act.effect, effectIndex: act.effectIndex });
    expect(rai.location).toBe('grave');
    expect(sd.location).toBe('grave');
    // 結束階段回到場上
    duel.raise({ type: 'endPhase', player: 0 });
    await duel.settle();
    expect(sd.location).toBe('mzone');
  });

  it('連鎖：旋風破壞發動中的永續陷阱', async () => {
    const { duel, b } = setup();
    duel.turnPlayer = 1;
    const m = put(duel, 1, 89631139, 'grave');
    const coth = put(duel, 1, 97077563, 'szone', { faceUp: false });
    put(duel, 0, 5318639, 'szone', { faceUp: false });
    const a = duel.controllers[0] as TestAI;
    a.respondWith = [5318639];
    b.declineAll = false;
    const act = duel.getActivatable(1).find((x) => x.card === coth)!;
    duel.phase = 'main1';
    await duel.performMainAction(1, { type: 'activate', card: coth, effect: act.effect, effectIndex: act.effectIndex });
    expect(coth.location).toBe('grave');
    expect(m.location).toBe('grave');
  });

  it('魔法筒反彈傷害', async () => {
    const { duel, b } = setup();
    b.respondWith = [62279055];
    put(duel, 1, 62279055, 'szone', { faceUp: false });
    const a1 = put(duel, 0, 89631139, 'mzone');
    await duel.performAttack(a1, null);
    expect(duel.p(0).lp).toBe(5000);
    expect(duel.p(1).lp).toBe(8000);
  });
});
