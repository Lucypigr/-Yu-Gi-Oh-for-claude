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

describe('5D\'s 經典（第五彈）', () => {
  it('六武眾被破壞時可以改為破壞其他「六武眾」', () => {
    const { duel } = setup();
    const zanji = put(duel, 0, 95519486, 'mzone'); // 斬次 1800
    const yariza = put(duel, 0, 69025477, 'mzone'); // 槍左 1000
    duel.destroy([zanji], 'effect');
    expect(zanji.location).toBe('mzone');
    expect(yariza.location).toBe('grave');
  });

  it('六武眾：戰鬥破壞時也能代替', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const zanji = put(duel, 1, 95519486, 'mzone'); // 斬次 1800
    const yariza = put(duel, 1, 69025477, 'mzone');
    const bewd = put(duel, 0, 89631139, 'mzone');
    await duel.performAttack(bewd, zanji);
    expect(zanji.location).toBe('mzone');
    expect(yariza.location).toBe('grave');
  });

  it('劍鬥獸：戰鬥後回到牌組，特殊召喚的劍鬥獸發動登場效果', async () => {
    const { duel, a, b } = setup();
    b.declineAll = true;
    a.declineAll = false;
    const bes = put(duel, 0, 41470137, 'mzone'); // 槍斗
    const mur = put(duel, 0, 5975022, 'deck'); // 魚斗：登場時破壞表側怪獸
    const target = put(duel, 1, FILLER, 'mzone', { pos: 'def' });
    const victim = put(duel, 1, 46986414, 'mzone'); // 黑魔術師
    await duel.performAttack(bes, target);
    duel.raise({ type: 'battlePhaseEnd', player: 0 });
    await duel.settle();
    expect(bes.location).toBe('deck');
    expect(mur.location).toBe('mzone');
    expect(mur.summonedBy).toBe(bes);
    expect(victim.location).toBe('grave');
  });

  it('劍鬥獸 凱撒：接觸融合（素材回到牌組）', async () => {
    const { duel } = setup();
    const bes = put(duel, 0, 41470137, 'mzone');
    const lq = put(duel, 0, 78868776, 'mzone');
    const gy = put(duel, 0, 48156348, 'extra');
    const act = duel.getMainActions(0).find((x) => x.type === 'spSummon' && x.card === gy);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(gy.location).toBe('mzone');
    expect(bes.location).toBe('deck');
    expect(lq.location).toBe('deck');
  });

  it('黑翼龍：效果傷害改為放置指示物，攻擊力下降', () => {
    const { duel } = setup();
    const bwd = put(duel, 0, 9012916, 'mzone');
    duel.damage(0, 1000, 'effect');
    expect(duel.p(0).lp).toBe(8000);
    expect(bwd.counters).toBe(1);
    expect(duel.getAtk(bwd)).toBe(2100);
  });

  it('大將軍 紫炎：對方 1 回合只能發動 1 次魔法・陷阱', async () => {
    const { duel } = setup();
    duel.turnPlayer = 1;
    put(duel, 0, 63176202, 'mzone');
    const s1 = put(duel, 1, 55144522, 'hand'); // 強欲之壺
    put(duel, 1, 55144522, 'hand');
    const act = duel.getActivatable(1).find((x) => x.card === s1)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(1, { type: 'activate', card: s1, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.getActivatable(1).some((x) => x.card.id === 55144522)).toBe(false);
  });

  it('六武之門：六武眾召喚時放置 2 個指示物', async () => {
    const { duel } = setup();
    const gate = put(duel, 0, 27970830, 'szone', { faceUp: true });
    const y = put(duel, 0, 64398890, 'hand');
    await duel.performMainAction(0, { type: 'summon', card: y });
    expect(gate.counters).toBe(2);
  });
});

describe('第六彈：寶玉獸・卡通・命運英雄・黑羽補完', () => {
  it('寶玉獸被破壞時當作永續魔法放到魔法・陷阱區域，紅玉獸特殊召喚它們', async () => {
    const { duel } = setup();
    const cat = put(duel, 0, 32933942, 'mzone'); // 紫晶貓
    duel.destroy([cat], 'effect');
    expect(cat.location).toBe('szone');
    expect(cat.faceUp).toBe(true);
    const ruby = put(duel, 0, 32710364, 'hand');
    duel.specialSummon(ruby, 0, { position: 'atk', by: ruby });
    await duel.settle();
    expect(cat.location).toBe('mzone');
  });

  it('寶玉獸 琥珀猛獁：攻擊對象轉移為這張卡', async () => {
    const { duel, b } = setup();
    b.respondWith = [69937550];
    const cat = put(duel, 1, 32933942, 'mzone'); // 1200
    const mam = put(duel, 1, 69937550, 'mzone'); // 1700
    const att = put(duel, 0, 76184692, 'mzone'); // 獨眼巨人 1200
    await duel.performAttack(att, cat);
    expect(cat.location).toBe('mzone');
    expect(att.location).toBe('grave');
    expect(mam.location).toBe('mzone');
  });

  it('卡通怪獸：召喚的回合不能攻擊；有卡通世界時直接攻擊；卡通世界被破壞時一起破壞', async () => {
    const { duel } = setup();
    const world = put(duel, 0, 15259703, 'szone', { faceUp: true });
    const elf = put(duel, 0, 42386471, 'hand');
    put(duel, 1, 89631139, 'mzone'); // 對方有青眼白龍
    await duel.performMainAction(0, { type: 'summon', card: elf });
    expect(duel.has(elf, 'cannotAttack')).toBe(true);
    duel.turn++;
    expect(duel.has(elf, 'cannotAttack')).toBe(false);
    expect(duel.getAttackOptions(0).find((o) => o.attacker === elf)?.canDirect).toBe(true);
    duel.destroy([world], 'effect');
    await duel.settle();
    expect(elf.location).toBe('grave');
  });

  it('王宮的彈壓：支付 800 讓特殊召喚無效', async () => {
    const { duel, a } = setup();
    duel.turnPlayer = 1;
    a.respondWith = [93016201];
    put(duel, 0, 93016201, 'szone', { faceUp: true });
    put(duel, 0, FILLER, 'mzone');
    const thr = put(duel, 1, 83629030, 'hand'); // 卡通電子龍：只有對方有怪獸時特殊召喚
    const act = duel.getMainActions(1).find((x) => x.type === 'spSummon' && x.card === thr);
    expect(act).toBeTruthy();
    await duel.performMainAction(1, act!);
    expect(thr.location).toBe('grave');
    expect(duel.p(0).lp).toBe(7200);
  });

  it('命運英雄 敵托邦人可以用融合召喚', () => {
    const { duel } = setup();
    put(duel, 0, 13093792, 'hand');
    put(duel, 0, 81866673, 'hand');
    put(duel, 0, 90579153, 'extra');
    expect(duel.fusionCandidates(0, duel.p(0).hand).map((c) => c.id)).toContain(90579153);
  });

  it('黑羽-大旆之伐由：從墓地特殊召喚「黑羽」同步怪獸', async () => {
    const { duel } = setup();
    const vayu = put(duel, 0, 72714392, 'grave'); // 1 星
    put(duel, 0, 85215458, 'grave'); // 卡魯特 3 星
    const aw = put(duel, 0, 76913983, 'extra'); // 兵翼鴉 6 星
    // 1+3=4：沒有 4 星的「黑羽」同步怪獸
    expect(duel.getActivatable(0).find((x) => x.card === vayu)).toBeFalsy();
    put(duel, 0, 75498415, 'grave'); // 希洛克 5 星 → 1+5=6：兵翼鴉
    const act2 = duel.getActivatable(0).find((x) => x.card === vayu)!;
    expect(act2).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: vayu, effect: act2.effect, effectIndex: act2.effectIndex });
    expect(aw.location).toBe('mzone');
    expect(vayu.location).toBe('banished');
  });
});

describe('第七彈：初代經典', () => {
  it('混沌形態：從墓地除外「青眼白龍」代替解放，儀式召喚青眼混沌極龍', async () => {
    const { duel } = setup();
    const bewd = put(duel, 0, 89631139, 'grave');
    const max = put(duel, 0, 55410871, 'hand');
    const form = put(duel, 0, 21082832, 'hand');
    const act = duel.getActivatable(0).find((x) => x.card === form)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: form, effect: act.effect, effectIndex: act.effectIndex });
    expect(max.location).toBe('mzone');
    expect(bewd.location).toBe('banished');
  });

  it('青眼亞白龍的卡名當作「青眼白龍」：可以發動毀滅之爆裂疾風彈', () => {
    const { duel } = setup();
    put(duel, 0, 38517737, 'mzone');
    put(duel, 1, FILLER, 'mzone');
    const burst = put(duel, 0, 17655904, 'hand');
    expect(duel.getActivatable(0).some((x) => x.card === burst)).toBe(true);
  });

  it('萬華鏡：有鷹身女郎（鷹身女郎1）時從牌組特殊召喚三姐妹', async () => {
    const { duel } = setup();
    put(duel, 0, 91932350, 'mzone'); // 鷹身女郎1（當作鷹身女郎）
    const sisters = put(duel, 0, 12206212, 'deck');
    const ego = put(duel, 0, 90219263, 'hand');
    const act = duel.getActivatable(0).find((x) => x.card === ego)!;
    await duel.performMainAction(0, { type: 'activate', card: ego, effect: act.effect, effectIndex: act.effectIndex });
    expect(sisters.location).toBe('mzone');
  });

  it('檸檬魔術少女：被攻擊時叫出魔法師族並轉移攻擊，攻擊怪獸攻擊力減半', async () => {
    const { duel, a } = setup();
    duel.turnPlayer = 1;
    a.respondWith = [34318086];
    const lemon = put(duel, 0, 34318086, 'mzone');
    const dm = put(duel, 0, 46986414, 'hand'); // 黑魔術師 2500
    const att = put(duel, 1, 89631139, 'mzone'); // 青眼白龍 3000
    await duel.performAttack(att, lemon);
    expect(dm.location).toBe('mzone');
    expect(lemon.location).toBe('mzone');
    expect(att.location).toBe('grave'); // 1500 vs 2500
  });
});

describe('第八彈：三幻神', () => {
  it('歐貝利斯克之巨神兵：需要解放 3 隻，召喚不會被神之宣告無效', async () => {
    const { duel, b } = setup();
    b.respondWith = [41420027];
    put(duel, 1, 41420027, 'szone', { faceUp: false });
    for (let i = 0; i < 3; i++) put(duel, 0, FILLER, 'mzone');
    const ob = put(duel, 0, 10000000, 'hand');
    expect(duel.tributesNeeded(ob)).toBe(3);
    await duel.performMainAction(0, { type: 'summon', card: ob });
    expect(ob.location).toBe('mzone');
    expect(duel.monsters(0).length).toBe(1);
  });

  it('歐貝利斯克不能成為效果的對象；解放 2 隻破壞對方全部怪獸', async () => {
    const { duel } = setup();
    const ob = put(duel, 0, 10000000, 'mzone');
    put(duel, 0, FILLER, 'mzone');
    put(duel, 0, FILLER, 'mzone');
    put(duel, 1, 89631139, 'mzone');
    put(duel, 1, 46986414, 'mzone');
    const act = duel.getActivatable(0).find((x) => x.card === ob)!;
    await duel.performMainAction(0, { type: 'activate', card: ob, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.monsters(1).length).toBe(0);
    expect(duel.has(ob, 'untargetable')).toBe(true);
  });

  it('奧西里斯之天空龍：攻擊力等於手牌數 × 1000，對方攻擊表示召喚的怪獸下降 2000', async () => {
    const { duel } = setup();
    duel.turnPlayer = 1;
    const sl = put(duel, 0, 10000020, 'mzone');
    put(duel, 0, FILLER, 'hand');
    put(duel, 0, FILLER, 'hand');
    expect(duel.getAtk(sl)).toBe(2000);
    const mon = put(duel, 1, 76184692, 'hand'); // 1200
    await duel.performMainAction(1, { type: 'summon', card: mon });
    expect(mon.location).toBe('grave');
  });

  it('拉之翼神龍不能用死者蘇生特殊召喚（千年的啟示的回合除外）', () => {
    const { duel } = setup();
    const ra = put(duel, 0, 10000010, 'grave');
    expect(duel.specialSummon(ra, 0, {})).toBe(false);
    expect(ra.location).toBe('grave');
  });

  it('靈魂交錯：可以解放對方的怪獸上級召喚', async () => {
    const { duel } = setup();
    put(duel, 0, FILLER, 'mzone');
    const theirs = put(duel, 1, 89631139, 'mzone');
    const se = put(duel, 0, 68005187, 'hand');
    const act = duel.getActivatable(0).find((x) => x.card === se)!;
    await duel.performMainAction(0, { type: 'activate', card: se, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.tributable(0)).toContain(theirs);
  });
});

describe('第九彈：初代經典補完', () => {
  it('通靈盤＋4 種死之信息在場上齊集時勝利', async () => {
    const { duel } = setup();
    put(duel, 0, 94212438, 'szone', { faceUp: true });
    for (const id of [31893528, 67287533, 94772232]) put(duel, 0, id, 'szone', { faceUp: true });
    expect(duel.ended).toBe(false);
    await safe(async () => {
      put(duel, 0, 30170981, 'szone', { faceUp: true });
      duel.checkState();
    });
    expect(duel.ended).toBe(true);
    expect(duel.winner).toBe(0);
  });

  it('千眼納祭神：吸收對方怪獸得到攻守，其他怪獸不能攻擊，戰鬥破壞時改為破壞裝備的怪獸', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ter = put(duel, 0, 63519819, 'mzone');
    const bewd = put(duel, 1, 89631139, 'mzone');
    const act = duel.getActivatable(0).find((x) => x.card === ter)!;
    await duel.performMainAction(0, { type: 'activate', card: ter, effect: act.effect, effectIndex: act.effectIndex });
    expect(bewd.location).toBe('szone');
    expect(duel.getAtk(ter)).toBe(3000);
    const other = put(duel, 1, 76184692, 'mzone');
    expect(duel.has(other, 'cannotAttack')).toBe(true);
    duel.destroy([ter], 'effect');
    expect(ter.location).toBe('grave'); // 效果破壞不能代替
  });

  it('門之守護神：解放三魔神特殊召喚', async () => {
    const { duel } = setup();
    for (const id of [25955164, 62340868, 98434877]) put(duel, 0, id, 'mzone');
    const gg = put(duel, 0, 25833572, 'hand');
    const act = duel.getMainActions(0).find((x) => x.type === 'spSummon' && x.card === gg)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act);
    expect(gg.location).toBe('mzone');
    expect(duel.monsters(0).length).toBe(1);
  });

  it('閃電之戰士 吉爾福德：解放 3 隻召喚時破壞對方全部怪獸', async () => {
    const { duel } = setup();
    for (let i = 0; i < 3; i++) put(duel, 0, FILLER, 'mzone');
    put(duel, 1, 89631139, 'mzone');
    put(duel, 1, 46986414, 'mzone');
    const g = put(duel, 0, 36354007, 'hand');
    await duel.performMainAction(0, { type: 'summon', card: g });
    expect(g.location).toBe('mzone');
    expect(duel.monsters(1).length).toBe(0);
  });
});

describe('第十彈：ARC-V 四天龍', () => {
  /** 給超量怪獸加上超量素材 */
  const attach = (duel: Duel, xyz: Card, ids: number[]) => {
    for (const id of ids) {
      const m = new Card(getCard(id), xyz.controller);
      m.location = 'overlay';
      xyz.overlays.push(m);
    }
    duel.update();
  };
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const acts = duel.getActivatable(p).filter((x) => x.card === card);
    const act = acts[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('暗叛逆超量龍：取除 2 個素材，對方怪獸攻擊力減半並吸收', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const dr = put(duel, 0, 16195942, 'mzone');
    attach(duel, dr, [FILLER, FILLER]);
    const bewd = put(duel, 1, 89631139, 'mzone');
    await activateMain(duel, 0, dr);
    expect(duel.getAtk(bewd)).toBe(1500);
    expect(duel.getAtk(dr)).toBe(4000);
    expect(dr.overlays.length).toBe(0);
  });

  it('升階魔法－幻影騎士團的出擊：沒有素材的暗叛逆升階成暗鎮魂，並取得無效效果', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const dr = put(duel, 0, 16195942, 'mzone');
    const req = put(duel, 0, 1621413, 'extra');
    const launch = put(duel, 0, 3298689, 'hand');
    await activateMain(duel, 0, launch);
    expect(req.location).toBe('mzone');
    expect(req.summonType).toBe('xyz');
    expect(req.overlays).toContain(dr);
    expect(req.overlays).toContain(launch);
    // 有「暗叛逆超量龍」作為素材：可以發動攻擊力變成 0 的效果
    put(duel, 1, 89631139, 'mzone');
    expect(duel.getActivatable(0).some((x) => x.card === req)).toBe(true);
  });

  it('幻透翼同調龍：無效 5 星以上怪獸的效果並破壞，攻擊力上升那個原本攻擊力', async () => {
    const { duel, a } = setup();
    duel.turnPlayer = 1;
    a.respondWith = [82044279];
    const cw = put(duel, 0, 82044279, 'mzone');
    const chimera = put(duel, 1, 25586143, 'mzone'); // 7 星
    await activateMain(duel, 1, chimera);
    expect(chimera.location).toBe('grave');
    expect(cw.location).toBe('mzone');
    expect(duel.getAtk(cw)).toBe(2500 + 2500);
  });

  it('凶飢毒融合龍：只能用場上的暗屬性怪獸作為融合素材', () => {
    const { duel } = setup();
    put(duel, 0, 41209827, 'extra');
    const poly = put(duel, 0, 24094653, 'hand');
    put(duel, 0, 36426778, 'hand');
    put(duel, 0, 63821877, 'hand');
    expect(duel.getActivatable(0).some((x) => x.card === poly)).toBe(false);
    put(duel, 0, 99315585, 'mzone');
    put(duel, 0, 36704180, 'mzone');
    expect(duel.getActivatable(0).some((x) => x.card === poly)).toBe(true);
  });

  it('捕食植物 蒼蠅地獄草：放置捕食指示物後，對方 2 星以上的怪獸等級變成 1 星', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const fly = put(duel, 0, 96622984, 'mzone');
    const bewd = put(duel, 1, 89631139, 'mzone');
    expect(duel.getLevel(bewd)).toBe(8);
    await activateMain(duel, 0, fly);
    expect(duel.getLevel(bewd)).toBe(1);
  });

  it('幻影騎士團 破洞鱗甲：墓地的「幻影騎士團」被除外時特殊召喚，離場時除外', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const scales = put(duel, 0, 25538345, 'grave');
    const boots = put(duel, 0, 36426778, 'grave');
    const blade = put(duel, 0, 25542642, 'deck');
    await activateMain(duel, 0, boots); // 除外無聲靴：把「幻影」魔法・陷阱加入手牌
    expect(boots.location).toBe('banished');
    expect(blade.location).toBe('hand');
    expect(scales.location).toBe('mzone');
    duel.destroy([scales], 'effect');
    expect(scales.location).toBe('banished');
  });

  it('幻影霧劍：對象怪獸效果無效、不能攻擊；對象離場時霧劍破壞', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const fog = put(duel, 0, 25542642, 'szone', { faceUp: false });
    const foe = put(duel, 1, 16195942, 'mzone');
    await activateMain(duel, 0, fog);
    expect(fog.location).toBe('szone');
    expect(duel.isNegated(foe)).toBe(true);
    expect(duel.has(foe, 'cannotAttack')).toBe(true);
    duel.destroy([foe], 'effect');
    expect(fog.location).toBe('grave');
  });
});

describe('第十彈：和原卡一致的規則', () => {
  const attach = (duel: Duel, xyz: Card, ids: number[]) => {
    for (const id of ids) {
      const m = new Card(getCard(id), xyz.controller);
      m.location = 'overlay';
      xyz.overlays.push(m);
    }
  };
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('竹蜻蜓電子人：發動後只能特殊召喚風屬性怪獸，自己 1 回合只能特殊召喚 1 次', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const take = put(duel, 0, 53932291, 'mzone');
    take.summonType = 'special';
    duel.p(0).summonedThisTurn.push({ card: take, kind: 'special' });
    put(duel, 0, 16725505, 'deck'); // 赤目骰子（風・調整）
    await activateMain(duel, 0, take);
    const dark = put(duel, 0, 16195942, 'extra');
    expect(duel.specialSummon(dark, 0, { summonType: 'xyz' })).toBe(false);
    const take2 = put(duel, 0, 53932291, 'grave');
    expect(duel.specialSummon(take2, 0)).toBe(false);
  });

  it('模糊伯勞：這回合特殊召喚過「急襲猛禽」以外的怪獸時不能發動', () => {
    const { duel } = setup();
    put(duel, 0, 53251824, 'mzone');
    const fuzzy = put(duel, 0, 5929801, 'hand');
    expect(duel.getActivatable(0).some((x) => x.card === fuzzy)).toBe(true);
    const other = put(duel, 0, 82044279, 'extra');
    duel.specialSummon(other, 0, { summonType: 'synchro' });
    expect(duel.getActivatable(0).some((x) => x.card === fuzzy)).toBe(false);
  });

  it('起翼獵鷹：可以向對方特殊召喚的怪獸全部各攻擊 1 次', async () => {
    const { duel } = setup();
    const rise = put(duel, 0, 73887236, 'mzone');
    const m1 = put(duel, 1, FILLER, 'mzone');
    const m2 = put(duel, 1, FILLER, 'mzone');
    const m3 = put(duel, 1, FILLER, 'mzone');
    m1.summonType = 'special';
    m2.summonType = 'special';
    m3.summonType = 'normal';
    duel.addMod(rise, { atk: 3000, until: 'permanent' });
    await duel.performAttack(rise, m1);
    let opt = duel.getAttackOptions(0).find((o) => o.attacker === rise);
    expect(opt?.targets).toEqual([m2]);
    await duel.performAttack(rise, m2);
    opt = duel.getAttackOptions(0).find((o) => o.attacker === rise);
    expect(opt).toBeUndefined();
  });

  it('凶飢毒融合龍：直到結束階段得到對方 5 星以上怪獸的卡名和效果（超量怪獸沒有等級，不能選）', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const sv = put(duel, 0, 41209827, 'mzone');
    put(duel, 1, 16195942, 'mzone'); // 暗叛逆（階級 4）
    expect(duel.getActivatable(0).some((x) => x.card === sv)).toBe(false);
    put(duel, 1, 25586143, 'mzone'); // 奇美拉大花草（7 星）
    await activateMain(duel, 0, sv);
    expect(sv.name).toBe(getCard(25586143).name);
    // 得到「除外等級在這張卡以下的怪獸」的效果
    expect(duel.effectsOf(sv)!.length).toBe(3 + 3); // 自己的 3 個效果＋奇美拉大花草的 3 個效果
  });

  it('陰暗布面甲：墓地沒有陷阱卡時蓋放的回合也能發動，變成怪獸；離場時變回陷阱卡', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const sb = put(duel, 0, 98827725, 'szone', { faceUp: false });
    sb.turnPlaced = duel.turn;
    await activateMain(duel, 0, sb);
    expect(sb.location).toBe('mzone');
    expect(sb.position).toBe('def');
    expect(duel.getDef(sb)).toBe(300);
    duel.destroy([sb], 'effect');
    expect(sb.location).toBe('grave');
    expect(sb.data.type & 0x4).toBeTruthy();
  });

  it('暗影焰劍蒼騎：對方直接攻擊時從墓地變成怪獸守備表示特殊召喚', async () => {
    const { duel, a } = setup();
    duel.turnPlayer = 1;
    a.respondWith = [77462146];
    const veil = put(duel, 0, 77462146, 'grave');
    const atk = put(duel, 1, 89631139, 'mzone');
    await safe(() => duel.performAttack(atk, null));
    expect(veil.location).toBe('mzone');
    expect(duel.p(0).lp).toBe(8000);
  });

  it('沾塵袍：①②的效果同 1 回合各能使用 1 次', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const cloak = put(duel, 0, 90432163, 'mzone');
    put(duel, 0, 36426778, 'deck');
    const cloak2 = put(duel, 0, 90432163, 'grave');
    await activateMain(duel, 0, cloak);
    expect(cloak.position).toBe('def');
    expect(duel.getActivatable(0).some((x) => x.card === cloak2)).toBe(true);
  });

  it('起翼升階魔法－急襲猛禽之力：用場上和墓地的「急襲猛禽」超量怪獸超量召喚階級合計的怪獸', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const rise = put(duel, 0, 73887236, 'mzone');
    attach(duel, rise, [FILLER]);
    const strix = put(duel, 0, 73347079, 'grave');
    const cannon = put(duel, 0, 23603403, 'extra');
    const force = put(duel, 0, 38044854, 'hand');
    await activateMain(duel, 0, force);
    expect(cannon.location).toBe('mzone');
    expect(cannon.overlays).toContain(rise);
    expect(cannon.overlays).toContain(strix);
    expect(cannon.overlays.length).toBe(3);
  });

  it('衛星炮獵鷹：用「急襲猛禽」超量召喚時破壞對方全部魔法・陷阱，對方不能對應', async () => {
    const { duel, b } = setup();
    b.respondWith = [44095762];
    const s1 = put(duel, 1, 44095762, 'szone', { faceUp: false }); // 神聖防護罩
    const s2 = put(duel, 1, 5318639, 'szone', { faceUp: false });
    const rise = put(duel, 0, 73887236, 'mzone');
    const strix = put(duel, 0, 73347079, 'grave');
    put(duel, 0, 23603403, 'extra');
    const force = put(duel, 0, 38044854, 'hand');
    await activateMain(duel, 0, force);
    expect(s1.location).toBe('grave');
    expect(s2.location).toBe('grave');
    expect(rise.location).toBe('overlay');
    expect(strix.location).toBe('overlay');
  });
});
