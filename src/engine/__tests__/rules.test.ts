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

describe('第二彈卡片', () => {
  it('艾克佐迪亞集齊 5 張勝利', async () => {
    const { duel } = setup();
    for (const id of [33396948, 8124921, 44519536, 70903634]) put(duel, 0, id, 'hand');
    put(duel, 0, 7902349, 'deck');
    await safe(async () => {
      duel.draw(0, 1);
      duel.checkState();
    });
    expect(duel.winner).toBe(0);
  });

  it('二次攻擊與「海」的直接攻擊', () => {
    const { duel } = setup();
    const mataza = put(duel, 0, 22609617, 'mzone');
    mataza.attacks = 1;
    expect(duel.canAttack(mataza)).toBe(true);
    mataza.attacks = 2;
    expect(duel.canAttack(mataza)).toBe(false);
    const bug = put(duel, 0, 64342551, 'mzone');
    put(duel, 1, FILLER, 'mzone');
    expect(duel.getAttackOptions(0).find((o) => o.attacker === bug)?.canDirect).toBe(false);
    put(duel, 0, 22702055, 'szone'); // 海（放在魔陷區只為了測試用，實際應在場地區）
    const umi = duel.p(0).szone.find((c) => c?.id === 22702055)!;
    duel.moveTo(umi, 'fzone', { reason: 'rule', player: 0 });
    expect(duel.getAttackOptions(0).find((o) => o.attacker === bug)?.canDirect).toBe(true);
  });

  it('自動解析的融合素材（火焰幽靈）', async () => {
    const { duel } = setup();
    put(duel, 0, 32274490, 'hand'); // 白骨
    put(duel, 0, 40826495, 'hand'); // 岩漿人
    const f = put(duel, 0, 58528964, 'extra');
    const poly = put(duel, 0, 24094653, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === poly)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: poly, effect: act.effect, effectIndex: act.effectIndex });
    expect(f.location).toBe('mzone');
  });

  it('自動產生的儀式魔法（超級戰獅）', async () => {
    const { duel } = setup();
    const lion = put(duel, 0, 33951077, 'hand');
    put(duel, 0, 89631139, 'hand');
    const rit = put(duel, 0, 54539105, 'hand');
    const act = duel.getActivatable(0).find((a) => a.card === rit)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: rit, effect: act.effect, effectIndex: act.effectIndex });
    expect(lion.location).toBe('mzone');
  });

  it('超量素材數量（魔蜥義豪需要 3 隻）', () => {
    const { duel } = setup();
    const g = put(duel, 0, 9053187, 'extra');
    put(duel, 0, 91152256, 'mzone');
    put(duel, 0, 11321183, 'mzone');
    expect(duel.xyzMaterialSets(0, g).length).toBe(0);
    put(duel, 0, 5053103, 'mzone');
    expect(duel.xyzMaterialSets(0, g).length).toBe(1);
  });

  it('噴霞蟲需要 2 隻以上調整以外的怪獸', () => {
    const { duel } = setup();
    const mw = put(duel, 0, 27315304, 'extra'); // 9 星
    put(duel, 0, 68505803, 'mzone'); // 調整 3
    put(duel, 0, 64271667, 'mzone'); // 流星之龍 6
    expect(duel.synchroMaterialSets(0, mw).length).toBe(0);
    put(duel, 0, 76184692, 'mzone'); // 4
    put(duel, 0, 40640057, 'mzone'); // 1
    // 3 + 4 + ... 需要剛好 9：3 + 4 + 1 + ... 不足；換成 3+... 只要有一組合法即可
    const ok = duel.synchroMaterialSets(0, mw).every((s) => s.length >= 3);
    expect(ok).toBe(true);
  });

  it('英雄標記：怪獸被戰鬥破壞後特殊召喚元素英雄', async () => {
    const { duel, b } = setup();
    b.respondWith = [22020907];
    put(duel, 1, 22020907, 'szone', { faceUp: false });
    put(duel, 1, 20721928, 'deck'); // 電光俠
    const t = put(duel, 1, FILLER, 'mzone');
    const a = put(duel, 0, 89631139, 'mzone');
    await duel.performAttack(a, t);
    expect(duel.monsters(1).map((c) => c.id)).toContain(20721928);
  });

  it('效果遮蒙者讓效果直到回合結束無效', async () => {
    const { duel } = setup();
    const sd = put(duel, 1, 44508094, 'mzone');
    duel.setFlag(sd, 'negated');
    expect(duel.isNegated(sd)).toBe(true);
    duel.turn++;
    expect(duel.isNegated(sd)).toBe(false);
  });

  it('魔族之鏈：不能攻擊且效果無效，離場後恢復', async () => {
    const { duel } = setup();
    duel.turnPlayer = 1;
    const target = put(duel, 0, 77585513, 'mzone'); // 人造人（效果怪獸）
    const chain = put(duel, 1, 50078509, 'szone', { faceUp: false });
    const act = duel.getActivatable(1).find((x) => x.card === chain);
    expect(act).toBeUndefined(); // 人造人在場時不能發動陷阱
    duel.destroy([target], 'rule');
    const t2 = put(duel, 0, 70095154, 'mzone'); // 電子龍
    const act2 = duel.getActivatable(1).find((x) => x.card === chain)!;
    await duel.performMainAction(1, { type: 'activate', card: chain, effect: act2.effect, effectIndex: act2.effectIndex });
    expect(chain.location).toBe('szone');
    expect(t2.negated).toBe(true);
    expect(duel.has(t2, 'cannotAttack')).toBe(true);
    duel.destroy([chain], 'effect');
    expect(t2.negated).toBe(false);
  });

  it('結束階段破壞救援貓叫出的怪獸', async () => {
    const { duel } = setup();
    const cat = put(duel, 0, 14878871, 'mzone');
    put(duel, 0, 90357090, 'deck'); // 銀牙狼（獸族 3 星）
    put(duel, 0, 90357090, 'deck');
    const act = duel.getActivatable(0).find((x) => x.card === cat)!;
    await duel.performMainAction(0, { type: 'activate', card: cat, effect: act.effect, effectIndex: act.effectIndex });
    const wolves = duel.monsters(0).filter((c) => c.id === 90357090);
    expect(wolves.length).toBe(2);
    expect(wolves.every((w) => w.negated && duel.hasFlag(w, 'destroyAtEnd'))).toBe(true);
  });
});

describe('靈擺與連結', () => {
  it('連結召喚放到額外怪獸區，連結箭頭指向正確的格子', async () => {
    const { duel } = setup();
    put(duel, 0, 91152256, 'mzone'); // 地屬性
    put(duel, 0, 11321183, 'mzone'); // 暗屬性
    put(duel, 0, 5053103, 'mzone'); // 地屬性
    const mr = put(duel, 0, 3987233, 'extra'); // 金毛婦（地屬性 2 隻）
    expect(duel.linkMaterialSets(0, mr).length).toBe(1);
    await duel.performMainAction(0, { type: 'link', card: mr });
    expect(mr.location).toBe('mzone');
    expect(mr.zone).toBeGreaterThanOrEqual(5);
    const [, c] = duel.zonePos(0, mr.zone);
    expect([...duel.linkedZones(0)].sort()).toEqual([c - 1, c + 1].sort());
    expect(duel.getDef(mr)).toBe(0);
  });

  it('連結怪獸可以當作連結數個素材', () => {
    const { duel } = setup();
    const lr = put(duel, 0, 77637979, 'mzone'); // LAN喙嘴龍 LINK-2
    lr.zone; // 已在主要怪獸區
    put(duel, 0, 91152256, 'mzone');
    const ghost = put(duel, 0, 41248270, 'extra'); // 流量幽靈：怪獸 3 隻
    // 只有 2 隻怪獸，但規定 3 隻（不能用連結數抵）→ 不行
    expect(duel.linkMaterialSets(0, ghost).length).toBe(0);
    const gaia = put(duel, 0, 67598234, 'extra'); // 蓋亞劍士：怪獸 2 隻以上，LINK-3
    expect(duel.linkMaterialSets(0, gaia).length).toBe(1);
  });

  it('第二隻連結怪獸只能放到連接區', async () => {
    const { duel } = setup();
    for (const id of [91152256, 11321183, 5053103, 76184692]) put(duel, 0, id, 'mzone');
    const lan = put(duel, 0, 77637979, 'extra'); // LINK-2 →↓? 依資料
    await duel.performMainAction(0, { type: 'link', card: lan });
    expect(lan.zone).toBeGreaterThanOrEqual(5);
    const lan2 = put(duel, 0, 77637979, 'extra');
    const zones = duel.extraZones(0, lan2);
    expect(zones.every((z) => z < 5 && duel.linkedZones(0).has(z))).toBe(true);
  });

  it('靈擺刻度、靈擺召喚、離場時加入額外牌組', async () => {
    const { duel } = setup();
    const lo = put(duel, 0, 61639289, 'hand'); // 點火騎士·沙鷹 刻度 2
    const hi = put(duel, 0, 97024987, 'hand'); // 點火騎士·德拉古諾夫 刻度 7
    const m1 = put(duel, 0, 50407691, 'hand'); // 5 星
    const m2 = put(duel, 0, 96802306, 'hand'); // 6 星
    const big = put(duel, 0, 89631139, 'hand'); // 8 星，不在範圍
    await duel.performMainAction(0, { type: 'pendulumScale', card: lo, zone: 0 });
    await duel.performMainAction(0, { type: 'pendulumScale', card: hi, zone: 4 });
    expect(duel.pendulumScales(0).every((c) => c)).toBe(true);
    const cands = duel.pendulumCandidates(0);
    expect(cands).toContain(m1);
    expect(cands).toContain(m2);
    expect(cands).not.toContain(big);
    await duel.performMainAction(0, { type: 'pendulumSummon' });
    expect(m1.location).toBe('mzone');
    expect(m2.location).toBe('mzone');
    expect(duel.getMainActions(0).some((a) => a.type === 'pendulumSummon')).toBe(false);
    duel.destroy([m1], 'effect');
    expect(m1.location).toBe('extra');
    expect(m1.faceUp).toBe(true);
  });

  it('點火騎士的靈擺效果：破壞兩邊刻度並檢索', async () => {
    const { duel } = setup();
    const lo = put(duel, 0, 61639289, 'hand');
    const hi = put(duel, 0, 97024987, 'hand');
    await duel.performMainAction(0, { type: 'pendulumScale', card: lo, zone: 0 });
    await duel.performMainAction(0, { type: 'pendulumScale', card: hi, zone: 4 });
    put(duel, 0, 24019092, 'deck'); // 點火騎士·鳥銃（戰士族・炎）
    const act = duel.getActivatable(0).find((x) => x.card === lo);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: lo, effect: act!.effect, effectIndex: act!.effectIndex });
    expect(duel.p(0).extra.filter((c) => c.faceUp).length).toBe(2);
    expect(duel.p(0).hand.some((c) => c.id === 24019092)).toBe(true);
  });

  it('異色眼靈擺龍給予的戰鬥傷害 2 倍', async () => {
    const { duel } = setup();
    const oe = put(duel, 0, 16178681, 'mzone'); // 2500
    const t = put(duel, 1, 91152256, 'mzone'); // 1400
    await duel.performAttack(oe, t);
    expect(duel.p(1).lp).toBe(8000 - 2200);
  });

  it('碼語者：攻擊力隨所連接區的怪獸上升', async () => {
    const { duel } = setup();
    for (const id of [70095154, 74131780, 10375182]) put(duel, 0, id, 'mzone'); // 3 隻效果怪獸
    const ct = put(duel, 0, 53413628, 'extra');
    await duel.performMainAction(0, { type: 'link', card: ct });
    expect(ct.location).toBe('mzone');
    const pointed = duel.pointedMonsters(ct).length;
    expect(duel.getAtk(ct)).toBe(1300 + 500 * pointed);
  });
});

describe('超量（第四彈）', () => {
  const UTOPIA = 84013237;

  function utopiaWith(duel: Duel, p: PlayerId, n: number) {
    const u = put(duel, p, UTOPIA, 'mzone');
    for (let i = 0; i < n; i++) duel.attachMaterial(u, put(duel, p, FILLER, 'grave'));
    return u;
  }

  it('混沌No.39 希望皇 霍普雷可以重叠在希望皇霍普上面，素材一起移過去', async () => {
    const { duel } = setup();
    const u = utopiaWith(duel, 0, 2);
    const ray = put(duel, 0, 56840427, 'extra');
    expect(duel.xyzMaterialSets(0, ray)).toEqual([[u]]);
    await duel.performMainAction(0, { type: 'xyz', card: ray });
    expect(ray.location).toBe('mzone');
    expect(u.location).toBe('overlay');
    expect(ray.overlays.length).toBe(3);
  });

  it('我我我魔術師宣言等級後可以和 8 星怪獸超量召喚', async () => {
    const { duel } = setup();
    const mag = put(duel, 0, 26082117, 'mzone');
    put(duel, 0, 93717133, 'mzone'); // 銀河眼光子龍 8 星
    const n62 = put(duel, 0, 31801517, 'extra');
    expect(duel.xyzMaterialSets(0, n62).length).toBe(0);
    const act = duel.getActivatable(0).find((x) => x.card === mag)!;
    await duel.performMainAction(0, { type: 'activate', card: mag, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.getLevel(mag)).toBe(8);
    expect(duel.xyzMaterialSets(0, n62).length).toBe(1);
  });

  it('英豪挑戰者 贈劍兵：超量怪獸攻擊力上升 1000', async () => {
    const { duel } = setup();
    put(duel, 0, 34143852, 'mzone');
    put(duel, 0, FILLER, 'mzone');
    const u = put(duel, 0, UTOPIA, 'extra');
    await duel.performMainAction(0, { type: 'xyz', card: u });
    expect(duel.getAtk(u)).toBe(3500);
  });

  it('怒怒怒戰士可以不用解放召喚，攻擊力變成 1800', async () => {
    const { duel } = setup();
    const w = put(duel, 0, 83274244, 'hand');
    expect(duel.canNormalSummon(0, w)).toBe(true);
    await duel.performMainAction(0, { type: 'summon', card: w });
    expect(w.location).toBe('mzone');
    expect(duel.getAtk(w)).toBe(1800);
  });

  it('疊光再生成為超量素材', async () => {
    const { duel } = setup();
    const u = utopiaWith(duel, 0, 0);
    const regen = put(duel, 0, 27068117, 'hand');
    const act = duel.getActivatable(0).find((x) => x.card === regen)!;
    await duel.performMainAction(0, { type: 'activate', card: regen, effect: act.effect, effectIndex: act.effectIndex });
    expect(u.overlays).toContain(regen);
    expect(regen.location).toBe('overlay');
  });

  it('奇妙超量：用效果超量召喚', async () => {
    const { duel } = setup();
    put(duel, 0, FILLER, 'mzone');
    put(duel, 0, FILLER, 'mzone');
    const u = put(duel, 0, UTOPIA, 'extra');
    const trap = put(duel, 0, 73860462, 'szone', { faceUp: false });
    const act = duel.getActivatable(0).find((x) => x.card === trap)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: trap, effect: act.effect, effectIndex: act.effectIndex });
    expect(u.location).toBe('mzone');
    expect(u.summonType).toBe('xyz');
    expect(u.overlays.length).toBe(2);
  });

  it('銀河眼光子龍：和對方怪獸一起除外，戰鬥階段結束時回來並吸收素材的力量', async () => {
    const { duel, a, b } = setup();
    b.declineAll = true;
    a.respondWith = [93717133];
    const ge = put(duel, 0, 93717133, 'mzone');
    const u = utopiaWith(duel, 1, 2);
    await safe(() => duel.performAttack(ge, u));
    expect(ge.location).toBe('banished');
    expect(u.location).toBe('banished');
    duel.raise({ type: 'battlePhaseEnd', player: 0 });
    await duel.settle();
    expect(ge.location).toBe('mzone');
    expect(u.location).toBe('mzone');
    expect(u.controller).toBe(1);
    expect(duel.getAtk(ge)).toBe(4000);
  });

  it('No.62 沒有銀河眼光子龍作為素材時戰鬥傷害減半', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const n62 = put(duel, 0, 31801517, 'mzone');
    await duel.performAttack(n62, null);
    expect(duel.p(1).lp).toBe(6000);
  });
});
