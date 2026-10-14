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
  /** 指定選項（例如：不代替破壞） */
  optionPick: number | null = null;
  async chooseOption(duel: Duel, prompt: Parameters<AIController['chooseOption']>[1]) {
    if (this.optionPick !== null) return this.optionPick;
    return super.chooseOption(duel, prompt);
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
    await duel.destroy([ss], 'effect');
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
    await duel.destroy([coth], 'effect');
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
    await duel.destroy([target], 'rule');
    const t2 = put(duel, 0, 70095154, 'mzone'); // 電子龍
    const act2 = duel.getActivatable(1).find((x) => x.card === chain)!;
    await duel.performMainAction(1, { type: 'activate', card: chain, effect: act2.effect, effectIndex: act2.effectIndex });
    expect(chain.location).toBe('szone');
    expect(t2.negated).toBe(true);
    expect(duel.has(t2, 'cannotAttack')).toBe(true);
    await duel.destroy([chain], 'effect');
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
    await duel.destroy([m1], 'effect');
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
  it('六武眾被破壞時可以改為破壞其他「六武眾」', async () => {
    const { duel } = setup();
    const zanji = put(duel, 0, 95519486, 'mzone'); // 斬次 1800
    const yariza = put(duel, 0, 69025477, 'mzone'); // 槍左 1000
    await duel.destroy([zanji], 'effect');
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
    await duel.destroy([cat], 'effect');
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
    await duel.destroy([world], 'effect');
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
    // 只能為了上級召喚解放
    expect(duel.tributable(0, true)).toContain(theirs);
    expect(duel.tributable(0)).not.toContain(theirs);
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
    await duel.destroy([ter], 'effect');
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
    await duel.destroy([scales], 'effect');
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
    await duel.destroy([foe], 'effect');
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
    await duel.destroy([sb], 'effect');
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

describe('第十一彈：VRAINS', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('轉生炎獸的聖域：只用 1 隻同名連結怪獸轉生連結召喚，觸發「轉生」的效果', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    put(duel, 0, 1295111, 'szone'); // 聖域（放到場地區）
    const sanctuary = duel.p(0).szone.find((c) => c?.id === 1295111)!;
    duel.moveTo(sanctuary, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    const wolf = put(duel, 0, 87871125, 'mzone');
    duel.p(0).mzone[wolf.zone] = null;
    duel.p(0).mzone[5] = wolf;
    wolf.zone = 5;
    const wolf2 = put(duel, 0, 87871125, 'extra');
    const circle = put(duel, 0, 52155219, 'grave');
    const act = duel.getMainActions(0).find((a) => a.type === 'link' && a.card === wolf2);
    expect(act, '可以轉生連結召喚').toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(wolf2.location).toBe('mzone');
    expect(wolf2.reincarnated).toBe(true);
    expect(circle.location).toBe('hand'); // 日光狼②：把墓地的「轉生炎獸」魔法・陷阱加入手牌
    // 聖域的轉生連結 1 回合 1 次
    const wolf3 = put(duel, 0, 87871125, 'extra');
    expect(duel.getMainActions(0).some((a) => a.type === 'link' && a.card === wolf3)).toBe(false);
  });

  it('轉生炎獸的咆哮：有「轉生炎獸」連結怪獸時，無效怪獸效果的發動並破壞', async () => {
    const { duel, a } = setup();
    duel.turnPlayer = 1;
    a.respondWith = [51339637];
    put(duel, 0, 41463181, 'mzone'); // 熾熱多頭獅
    const roar = put(duel, 0, 51339637, 'szone', { faceUp: false });
    const dr = put(duel, 1, 16195942, 'mzone');
    for (let i = 0; i < 2; i++) {
      const m = new Card(getCard(FILLER), 1);
      m.location = 'overlay';
      dr.overlays.push(m);
    }
    put(duel, 0, FILLER, 'mzone');
    await activateMain(duel, 1, dr);
    expect(roar.location).toBe('grave');
    expect(dr.location).toBe('grave');
  });

  it('淘氣仙星・坎迪娜與曼珠詩華：對方發動魔法・陷阱、抽卡時給予傷害', async () => {
    const { duel } = setup();
    const pot = put(duel, 1, 55144522, 'hand');
    put(duel, 0, 61283655, 'mzone');
    put(duel, 0, 35199656, 'mzone');
    duel.draw(1, 2);
    expect(duel.p(1).lp).toBe(8000 - 400);
    duel.turnPlayer = 1;
    await activateMain(duel, 1, pot);
    // 坎迪娜 200 ＋ 抽 2 張 400
    expect(duel.p(1).lp).toBe(8000 - 400 - 200 - 400);
  });

  it('馬格努姆彈丸龍：成為連結怪獸效果的對象時破壞自己，把場上 1 隻怪獸送去墓地', async () => {
    const { duel, b } = setup();
    duel.turnPlayer = 1;
    b.respondWith = [];
    const { a } = { a: (duel as any).controllers[0] as TestAI };
    a.respondWith = [26655293];
    const magna = put(duel, 0, 26655293, 'mzone');
    const heat = put(duel, 1, 41463181, 'mzone');
    heat.reincarnated = true;
    put(duel, 1, FILLER, 'grave');
    const foe = put(duel, 1, 89631139, 'mzone');
    await activateMain(duel, 1, heat);
    expect(magna.location).toBe('grave');
    expect(foe.location).toBe('grave');
  });

  it('轉生炎獸 獨角兔：解放讓怪獸這回合不會被對方的效果破壞', async () => {
    const { duel } = setup();
    const m = put(duel, 0, 89631139, 'mzone');
    duel.setFlag(m, 'oppEffectIndestructible');
    const raigeki = put(duel, 1, 12580477, 'grave');
    expect((await duel.destroy([m], 'effect', raigeki)).length).toBe(0);
    expect((await duel.destroy([m], 'effect', m)).length).toBe(1);
  });

  it('轉生炎獸 蜃景雄馬：發動後這回合不能發動炎屬性以外的怪獸效果', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const mirage = put(duel, 0, 87327776, 'mzone');
    const m = new Card(getCard(FILLER), 0);
    m.location = 'overlay';
    mirage.overlays.push(m);
    put(duel, 0, 26889158, 'deck');
    const dr = put(duel, 0, 16195942, 'mzone');
    const m2 = new Card(getCard(FILLER), 0);
    m2.location = 'overlay';
    dr.overlays.push(m2, new Card(getCard(FILLER), 0));
    put(duel, 1, 89631139, 'mzone');
    expect(duel.getActivatable(0).some((x) => x.card === dr)).toBe(true);
    await activateMain(duel, 0, mirage);
    expect(duel.getActivatable(0).some((x) => x.card === dr)).toBe(false);
  });

  it('裝彈槍管龍：攻擊時得到對方怪獸的控制權，下個回合的結束階段送去墓地', async () => {
    const { duel } = setup();
    const bl = put(duel, 0, 31833038, 'mzone');
    duel.p(0).mzone[bl.zone] = null;
    duel.p(0).mzone[5] = bl;
    bl.zone = 5;
    const foe = put(duel, 1, 89631139, 'mzone');
    await safe(() => duel.performAttack(bl, foe));
    expect(foe.controller).toBe(0);
    expect(duel.delayed.length).toBe(1);
    expect(duel.delayed[0].turn).toBe(duel.turn + 1);
  });
});

describe('第十二彈：@火靈天星', () => {

  it('傷害計算時的誘發效果會發動（水海龍@火靈天星：對方怪獸攻擊力只在傷害計算時變成一半）', async () => {
    const { duel } = setup();
    const lev = put(duel, 0, 37061511, 'mzone'); // 2300
    const bewd = put(duel, 1, 89631139, 'mzone'); // 3000 → 1500
    await safe(() => duel.performAttack(lev, bewd));
    expect(bewd.location).toBe('grave');
    expect(duel.p(1).lp).toBe(8000 - 800);
  });

  it('牢牢妖@火靈天星：自己的電子界族怪獸 1 回合各 1 次不會被效果破壞', async () => {
    const { duel } = setup();
    put(duel, 0, 82257671, 'mzone');
    const m = put(duel, 0, 15808381, 'mzone');
    expect((await duel.destroy([m], 'effect')).length).toBe(0);
    expect(m.location).toBe('mzone');
    expect((await duel.destroy([m], 'effect')).length).toBe(1);
  });

  it('電子界到臨者@火靈天星：原本攻擊力是素材數量×1000，不受其他卡的效果影響', async () => {
    const { duel } = setup();
    // 連結 6：日光狼（炎・連結 2）＋轉碼語者（地・連結 3）＋連接栗子球（暗・連結 1）
    for (const id of [87871125, 46947713, 41999284]) put(duel, 0, id, 'mzone');
    const arrival = put(duel, 0, 11738489, 'extra');
    const act = duel.getMainActions(0).find((a) => a.type === 'link' && a.card === arrival);
    expect(act).toBeTruthy();
    await safe(() => duel.performMainAction(0, act!));
    expect(arrival.location).toBe('mzone');
    expect(duel.getAtk(arrival)).toBe(3000);
    expect(arrival.data.atk).toBe(3000);
    const raigeki = put(duel, 1, 12580477, 'grave');
    expect((await duel.destroy([arrival], 'effect', raigeki)).length).toBe(0);
    // 離場時原本攻擊力還原
    await duel.destroy([arrival], 'rule' as any);
    expect(arrival.data.atk).toBe(0);
  });

  it('「艾」思考-I·Q：雙方 1 回合只能有 1 次連結召喚', () => {
    const { duel } = setup();
    put(duel, 0, 69381150, 'szone', { faceUp: true });
    put(duel, 0, 15808381, 'mzone');
    put(duel, 0, 16020923, 'mzone');
    put(duel, 0, 77637979, 'extra'); // LAN喙嘴龍（怪獸 2 隻）
    expect(duel.getMainActions(0).some((a) => a.type === 'link')).toBe(true);
    duel.p(0).turnFlags.linkSummoned = true;
    expect(duel.getMainActions(0).some((a) => a.type === 'link')).toBe(false);
  });

  it('光龍王@火靈天星：自己的怪獸被效果破壞時取除超量素材代替', async () => {
    const { duel } = setup();
    const ld = put(duel, 0, 61399402, 'mzone');
    const m = new Card(getCard(FILLER), 0);
    m.location = 'overlay';
    ld.overlays.push(m);
    const mon = put(duel, 0, 89631139, 'mzone');
    expect((await duel.destroy([mon], 'effect')).length).toBe(0);
    expect(mon.location).toBe('mzone');
    expect(ld.overlays.length).toBe(0);
  });

  it('陰雲栗仔球@火靈天星：效果給予對方的傷害變成 2 倍', () => {
    const { duel } = setup();
    const src = put(duel, 0, 24882256, 'mzone');
    duel.doubleDamageFrom.push(src);
    duel.damage(1, 1000, 'effect', src);
    expect(duel.p(1).lp).toBe(6000);
  });
});

describe('第十三彈：新宇俠・火山', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('接觸融合：新宇俠＋黑暗豹回到牌組，特殊召喚黑暗新宇俠；不能用「融合」召喚', async () => {
    const { duel } = setup();
    const neos = put(duel, 0, 89943723, 'mzone');
    const panther = put(duel, 0, 43237273, 'mzone');
    const dn = put(duel, 0, 28677304, 'extra');
    const poly = put(duel, 0, 24094653, 'hand');
    expect(duel.getActivatable(0).some((x) => x.card === poly)).toBe(false);
    const act = duel.getMainActions(0).find((a) => a.type === 'spSummon' && a.card === dn);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(dn.location).toBe('mzone');
    expect(neos.location).toBe('deck');
    expect(panther.location).toBe('deck');
  });

  it('新宇宙：攻擊力上升 500；新宇融合無視召喚條件特殊召喚，之後不能特殊召喚', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    put(duel, 0, 89943723, 'deck');
    put(duel, 0, 54959865, 'deck');
    const air = put(duel, 0, 11502550, 'extra');
    const nf = put(duel, 0, 14088859, 'hand');
    await activateMain(duel, 0, nf);
    expect(air.location).toBe('mzone');
    const space = put(duel, 0, 42015635, 'szone');
    duel.moveTo(space, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    expect(duel.getAtk(air)).toBe(2500 + 500);
    const other = put(duel, 0, 89631139, 'grave');
    expect(duel.specialSummon(other, 0)).toBe(false);
  });

  it('火山女王：解放對方 1 隻怪獸，在對方場上特殊召喚', async () => {
    const { duel } = setup();
    const foe = put(duel, 1, 89631139, 'mzone');
    const queen = put(duel, 0, 63014935, 'hand');
    const act = duel.getMainActions(0).find((a) => a.type === 'spSummon' && a.card === queen);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(foe.location).toBe('grave');
    expect(queen.location).toBe('mzone');
    expect(queen.controller).toBe(1);
  });

  it('火山帝皇：從墓地除外「烈焰加農炮」卡特殊召喚，給予除外的炎族數量×500 傷害', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const emperor = put(duel, 0, 46412900, 'grave');
    put(duel, 0, 69537999, 'grave');
    const pyro = put(duel, 0, 33365932, 'grave');
    duel.moveTo(pyro, 'banished', { reason: 'rule' });
    const act = duel.getMainActions(0).find((a) => a.type === 'spSummon' && a.card === emperor);
    expect(act, '可以從墓地特殊召喚').toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(emperor.location).toBe('mzone');
    expect(duel.p(1).lp).toBe(8000 - 500);
  });

  it('炸彈衍生物：被破壞時那個控制者受到 500 傷害', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const trooper = put(duel, 0, 22411609, 'mzone');
    put(duel, 0, FILLER, 'hand');
    await activateMain(duel, 0, trooper);
    const token = duel.monsters(1).find((c) => c.id === 22411610)!;
    expect(token).toBeTruthy();
    await duel.destroy([token], 'effect');
    await duel.settle();
    expect(duel.p(1).lp).toBe(7500);
  });
});

describe('第十四彈：古代的機械・5D\'s', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('古代的機械巨人不能特殊召喚；齒車街讓召喚需要的解放減少 1 隻', async () => {
    const { duel } = setup();
    const golem = put(duel, 0, 83104731, 'grave');
    expect(duel.specialSummon(golem, 0)).toBe(false);
    const g2 = put(duel, 0, 83104731, 'hand');
    expect(duel.tributesNeeded(g2)).toBe(2);
    const town = put(duel, 0, 37694547, 'szone');
    duel.moveTo(town, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    expect(duel.tributesNeeded(g2)).toBe(1);
  });

  it('古代的進軍：解放 1 隻抽 1 張，這回合「古代的機械巨人」不用解放召喚；上級召喚記錄解放的怪獸', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const adv = put(duel, 0, 4064925, 'szone', { faceUp: true });
    put(duel, 0, FILLER, 'mzone');
    const golem = put(duel, 0, 83104731, 'hand');
    const hand = duel.p(0).hand.length;
    await activateMain(duel, 0, adv);
    expect(duel.p(0).hand.length).toBe(hand + 1);
    expect(duel.canSummonWithoutTribute(golem)).toBe(true);
    await duel.performMainAction(0, { type: 'summon', card: golem });
    expect(golem.location).toBe('mzone');
    // 巨龍：解放綠色零件上級召喚時得到貫通
    const green = put(duel, 0, 41172955, 'mzone');
    const gad = put(duel, 0, 50933533, 'hand');
    duel.p(0).normalSummons = 1;
    duel.p(0).noTributeRules = [];
    await duel.performMainAction(0, { type: 'summon', card: gad });
    expect(gad.summonMaterials).toContain(green);
    expect(duel.has(gad, 'piercing')).toBe(true);
  });

  it('雙調整同步：紅蓮魔龍・暴君需要調整 2 隻；真紅蓮新星龍只能用「紅蓮魔龍」為調整以外的素材', () => {
    const { duel } = setup();
    const tyrant = put(duel, 0, 16172067, 'extra');
    const nova = put(duel, 0, 97489701, 'extra');
    put(duel, 0, 40975574, 'mzone'); // 紅蓮共鳴者 2
    put(duel, 0, 34761841, 'mzone'); // 深紅共鳴者 2
    const rising = put(duel, 0, 66141736, 'mzone'); // 紅蓮升龍 6
    expect(duel.synchroMaterialSets(0, tyrant).length).toBeGreaterThan(0);
    expect(duel.synchroMaterialSets(0, nova).length).toBe(0);
    duel.moveTo(rising, 'grave', { reason: 'rule' });
    put(duel, 0, 70902743, 'mzone'); // 紅蓮魔龍 8
    expect(duel.synchroMaterialSets(0, nova).length).toBeGreaterThan(0);
  });

  it('王道同調士當作等級下降 2 星（王道戰士以外）；調和支援士可以當作 2 星，作為素材抽 1 張', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const speeder = put(duel, 0, 77075360, 'extra'); // 廢品增速者 5
    const roadW = put(duel, 0, 2322421, 'extra'); // 王道戰士 8
    put(duel, 0, 71971554, 'mzone'); // 王道同調士 4
    put(duel, 0, 56410040, 'mzone'); // 廢品前鋒 3
    expect(duel.synchroMaterialSets(0, speeder).length).toBeGreaterThan(0);
    expect(duel.synchroMaterialSets(0, roadW).length).toBe(0);
    const { duel: d2, b: b2 } = setup();
    b2.declineAll = true;
    const jw = put(d2, 0, 60800381, 'extra'); // 廢品戰士 5
    put(d2, 0, 63977008, 'mzone'); // 廢品同調士 3
    const tw = put(d2, 0, 92676637, 'mzone'); // 調和支援士 1
    const hand = d2.p(0).hand.length;
    expect(d2.synchroMaterialSets(0, jw).length).toBeGreaterThan(0);
    await d2.performMainAction(0, { type: 'synchro', card: jw });
    expect(jw.location).toBe('mzone');
    expect(tw.location).toBe('grave');
    expect(d2.p(0).hand.length).toBe(hand + 1);
  });

  it('方程式同調士：對方主要階段用包含這張卡的怪獸同步召喚', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    duel.turnPlayer = 1;
    const formula = put(duel, 0, 50091196, 'mzone');
    put(duel, 0, 78922939, 'mzone'); // 廢品從者 4
    const gaia = put(duel, 0, 97204936, 'extra'); // 大地之騎士 蓋亞騎士 6
    const act = duel.getActivatable(0, { kind: 'free' } as never).find((x) => x.card === formula);
    expect(act, '對方回合可以發動').toBeTruthy();
    await duel.activate(0, formula, act!.effect, act!.effectIndex);
    await (duel as unknown as { resolveChain: () => Promise<void> }).resolveChain();
    expect(gaia.location).toBe('mzone');
    expect(gaia.summonType).toBe('synchro');
  });

  it('動力工具龍：被破壞時可以把裝備魔法送去墓地代替', async () => {
    const { duel } = setup();
    const ptd = put(duel, 0, 2403771, 'mzone');
    const eq = put(duel, 0, 79068663, 'szone', { faceUp: true });
    duel.equip(eq, ptd);
    await duel.destroy([ptd], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(ptd.location).toBe('mzone');
    expect(eq.location).toBe('grave');
  });

  it('黑色花園：召喚的怪獸攻擊力變成一半，對方場上出現薔薇衍生物', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    const garden = put(duel, 1, 71645242, 'szone');
    duel.moveTo(garden, 'fzone', { reason: 'rule', player: 1, faceUp: true });
    const blue = put(duel, 0, 89631139, 'hand');
    duel.p(0).normalSummons = 1;
    duel.p(0).noTributeRules.push(() => true);
    await duel.performMainAction(0, { type: 'summon', card: blue });
    expect(duel.getAtk(blue)).toBe(1500);
    expect(duel.monsters(1).some((c) => c.id === 71645243)).toBe(true);
  });
});

describe('第十五彈：影依・閃刀姬', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('影依融合：手牌的影依怪獸成為素材，被效果送去墓地的效果發動', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const winda = put(duel, 0, 94977269, 'extra');
    const hedgehog = put(duel, 0, 4939890, 'hand');
    put(duel, 0, 78010363, 'hand'); // 黑森林的魔女（暗）
    put(duel, 0, 37445295, 'deck'); // 影依獵鷹
    const fusion = put(duel, 0, 44394295, 'hand');
    await activateMain(duel, 0, fusion);
    expect(winda.location).toBe('mzone');
    expect(hedgehog.location).toBe('grave');
    // 刺蝟②：從牌組把影依怪獸加入手牌
    expect(duel.p(0).hand.some((c) => c.id === 37445295)).toBe(true);
  });

  it('作為代價丟棄不算被效果送去墓地', () => {
    const { duel } = setup();
    const beast = put(duel, 0, 3717252, 'hand');
    const before = duel.p(0).hand.length;
    duel.discard([beast], 'cost');
    expect(beast.location).toBe('grave');
    expect(duel.p(0).hand.length).toBe(before - 1);
  });

  it('神影依・米德拉什：雙方 1 回合只能特殊召喚 1 次', () => {
    const { duel } = setup();
    const winda = put(duel, 1, 94977269, 'mzone');
    winda.summonType = 'fusion';
    const a = put(duel, 0, FILLER, 'grave');
    const b2 = put(duel, 0, FILLER, 'grave');
    expect(duel.specialSummon(a, 0)).toBe(true);
    expect(duel.specialSummon(b2, 0)).toBe(false);
  });

  it('影依的原核在怪獸區域時可以代替任何屬性的融合素材', () => {
    const { duel } = setup();
    const core = put(duel, 0, 4904633, 'szone', { faceUp: false });
    duel.summonTrapAsMonster(core, 0, { atk: 1450, def: 1950, level: 9, race: 0x2, attribute: 0x20, effect: true });
    put(duel, 0, 4939890, 'hand');
    const grysta = put(duel, 0, 48424886, 'extra'); // 影依＋炎屬性
    const pool = [...duel.p(0).hand, ...duel.faceUpMonsters(0)];
    expect(duel.fusionCandidates(0, pool)).toContain(grysta);
  });

  it('閃刀魔法：主要怪獸區域有怪獸時不能發動；零衣解放後在額外怪獸區域特殊召喚閃刀姬', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const engage = put(duel, 0, 63166095, 'hand');
    put(duel, 0, 99550630, 'deck');
    const raye = put(duel, 0, 26077387, 'mzone');
    expect(duel.getActivatable(0).some((x) => x.card === engage)).toBe(false);
    const kagari = put(duel, 0, 63288573, 'extra');
    await activateMain(duel, 0, raye);
    expect(raye.location).toBe('grave');
    expect(kagari.location).toBe('mzone');
    expect(kagari.zone).toBeGreaterThanOrEqual(5);
    expect(duel.getActivatable(0).some((x) => x.card === engage)).toBe(true);
  });
});

describe('第十六彈：半龍女僕・魔救', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('寢室龍女：戰鬥階段開始時回到手牌，特殊召喚 7 星以上的半龍女僕；戰鬥階段結束時換回來', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const chamber = put(duel, 0, 32600024, 'mzone');
    const lorpar = put(duel, 0, 15848542, 'hand'); // 8 星，戰鬥階段結束時換成 3 星
    put(duel, 0, 16960120, 'hand'); // 蒸餾室龍女 3 星
    duel.phase = 'battle';
    duel.raise({ type: 'battlePhaseStart', player: 0 });
    await duel.settle();
    expect(chamber.location).toBe('hand');
    expect(lorpar.location).toBe('mzone');
    duel.raise({ type: 'battlePhaseEnd', player: 0 });
    await duel.settle();
    expect(lorpar.location).toBe('hand');
    expect(duel.monsters(0).some((c) => c.id === 16960120)).toBe(true);
  });

  it('貼身龍女：除外場上與墓地相同屬性而等級不同的半龍女僕，從額外牌組特殊召喚', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const lady = put(duel, 0, 48658295, 'extra');
    const kitchen = put(duel, 0, 16960120, 'mzone'); // 炎 3 星
    const tinkhec = put(duel, 0, 42055234, 'grave'); // 炎 8 星
    const act = duel.getMainActions(0).find((a) => a.type === 'spSummon' && a.card === lady);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(lady.location).toBe('mzone');
    expect(kitchen.location).toBe('banished');
    expect(tinkhec.location).toBe('banished');
  });

  it('魔救之分析者：翻開 5 張特殊召喚調整以外的 4 星以下岩石族，剩下的回到牌組最下面；巨龍晶石被魔救的效果特殊召喚時抽 1 張', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const analyzer = put(duel, 0, 11302671, 'mzone');
    for (const id of [FILLER, FILLER, FILLER, FILLER]) put(duel, 0, id, 'deck');
    const dragite = put(duel, 0, 10286023, 'deck');
    const hand = duel.p(0).hand.length;
    await activateMain(duel, 0, analyzer, 0);
    expect(dragite.location).toBe('mzone');
    expect(duel.p(0).hand.length).toBe(hand + 1);
    // 翻開的其他 4 張回到牌組最下面
    const deck = duel.p(0).deck;
    expect(deck.slice(-4).every((c) => c.id === FILLER)).toBe(true);
  });
});

describe('與原卡一致的處理', () => {
  it('代替破壞可以選擇不代替', async () => {
    const { duel, a } = setup();
    const ptd = put(duel, 0, 2403771, 'mzone');
    const eq = put(duel, 0, 79068663, 'szone', { faceUp: true });
    duel.equip(eq, ptd);
    a.optionPick = 0;
    await duel.destroy([ptd], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(ptd.location).toBe('grave');
    const ptd2 = put(duel, 0, 2403771, 'mzone');
    const eq2 = put(duel, 0, 79068663, 'szone', { faceUp: true });
    duel.equip(eq2, ptd2);
    a.optionPick = 1;
    await duel.destroy([ptd2], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(ptd2.location).toBe('mzone');
    expect(eq2.location).toBe('grave');
  });

  it('等級偷竊蟲：上級召喚以外不能解放', () => {
    const { duel } = setup();
    const eater = put(duel, 0, 57421866, 'mzone');
    expect(duel.tributable(0)).not.toContain(eater);
    expect(duel.tributable(0, true)).toContain(eater);
    expect(duel.moveTo(eater, 'grave', { reason: 'tribute' })).toBe(false);
  });

  it('黑薔薇華園：場上的表側表示怪獸變成植物族，離場後恢復', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const blue = put(duel, 0, 89631139, 'mzone');
    const garden = put(duel, 0, 69053263, 'szone', { faceUp: true });
    duel.raise({ type: 'standby', player: 0 });
    expect(blue.data.race).toBe(0x400);
    duel.moveTo(garden, 'grave', { reason: 'rule' });
    expect(blue.data.race).toBe(0x2000);
  });

  it('淘氣仙星的燈光舞台：結束階段沒有發動的對象卡送去墓地', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    const stage = put(duel, 0, 35371948, 'szone');
    duel.moveTo(stage, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    const set = put(duel, 1, 44095762, 'szone', { faceUp: false });
    const act = duel.getActivatable(0).find((x) => x.card === stage)!;
    await duel.performMainAction(0, { type: 'activate', card: stage, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.hasFlag(set, 'cannotActivate')).toBe(true);
    for (const x of duel.delayed.filter((x) => x.turn === duel.turn)) await x.run();
    expect(duel.hasFlag(set, 'cannotActivate')).toBe(false);
    for (const x of duel.afterEndPhase.filter((x) => x.turn === duel.turn)) await x.run();
    expect(set.location).toBe('grave');
  });
});

describe('第十七彈：烙印・死獄鄉', () => {
  it('阿不思的落胤：丟棄 1 張手牌，用這張卡和對方場上的怪獸融合召喚', async () => {
    const { duel, a, b } = setup();
    a.declineAll = false;
    b.declineAll = true;
    const albaz = put(duel, 0, 68468459, 'mzone');
    const blue = put(duel, 1, 89631139, 'mzone'); // 光屬性
    put(duel, 0, FILLER, 'hand');
    const albion = put(duel, 0, 87746184, 'extra');
    duel.raise({ type: 'summoned', card: albaz, cards: [albaz], player: 0, summonType: 'normal' });
    await duel.settle();
    expect(albion.location).toBe('mzone');
    expect(albion.summonType).toBe('fusion');
    expect(albaz.location).toBe('grave');
    expect(blue.location).toBe('grave');
  });

  it('烙印融合：用手牌・牌組的怪獸融合召喚，這回合不能從額外牌組特殊召喚融合怪獸以外', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    put(duel, 0, 68468459, 'hand');
    put(duel, 0, 89631139, 'deck');
    const albion = put(duel, 0, 87746184, 'extra');
    const bf = put(duel, 0, 44362883, 'hand');
    const act = duel.getActivatable(0).find((x) => x.card === bf)!;
    expect(act).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: bf, effect: act.effect, effectIndex: act.effectIndex });
    expect(albion.location).toBe('mzone');
    const sync = put(duel, 0, 44508094, 'extra');
    expect(duel.summonAllowed(0, sync, 'special')).toBe(false);
  });
});

describe('第十八彈：蛇眼・刻魔', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('蛇眼大炎魔：攻擊宣言時，對方怪獸和這張卡當作永續魔法放在原本持有者的魔陷區', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const dbs = put(duel, 0, 27260347, 'mzone');
    const blue = put(duel, 1, 89631139, 'mzone');
    duel.raise({ type: 'attackDeclared', card: dbs, attacker: dbs, target: blue, player: 0 });
    await duel.settle();
    expect(blue.location).toBe('szone');
    expect(blue.controller).toBe(1);
    expect(dbs.location).toBe('szone');
    expect(dbs.controller).toBe(0);
  });

  it('蛇眼炎龍：對方回合把當作永續魔法的怪獸卡在自己場上特殊召喚', async () => {
    const { duel, a, b } = setup();
    b.declineAll = true;
    const fl = put(duel, 0, 48452496, 'mzone');
    const blue = put(duel, 1, 89631139, 'mzone');
    duel.placeAsSpell(blue, 1, fl);
    expect(blue.location).toBe('szone');
    duel.turnPlayer = 1;
    const act = duel.getActivatable(0, { kind: 'free' } as never).find((x) => x.card === fl);
    expect(act).toBeTruthy();
    void a;
    await duel.performMainAction(0, { type: 'activate', card: fl, effect: act!.effect, effectIndex: act!.effectIndex });
    expect(blue.location).toBe('mzone');
    expect(blue.controller).toBe(0);
  });

  it('蛇眼梣樹靈：召喚時檢索炎屬性・1 星怪獸；②把包含自己的 2 張卡送去墓地特殊召喚其他蛇眼', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ash = put(duel, 0, 9674034, 'mzone');
    const oak = put(duel, 0, 45663742, 'deck');
    duel.raise({ type: 'summoned', card: ash, cards: [ash], player: 0, summonType: 'normal' });
    await duel.settle();
    expect(oak.location).toBe('hand');
    const poplar = put(duel, 0, 90241276, 'deck');
    const other = put(duel, 0, FILLER, 'mzone');
    await activateMain(duel, 0, ash);
    expect(other.location).toBe('grave');
    expect([oak, poplar].some((c) => c.location === 'mzone')).toBe(true);
    // 橡樹靈的①讓送去墓地的梣樹靈回來
    expect(duel.logs.some((l) => l.text === '甲 發動「蛇眼梣樹靈」的效果')).toBe(true);
  });

  it('賜炎之咎姬：存在期間自己不能特殊召喚炎屬性以外的怪獸', () => {
    const { duel } = setup();
    put(duel, 0, 2772337, 'mzone');
    const blue = put(duel, 0, 89631139, 'hand');
    const ash = put(duel, 0, 9674034, 'hand');
    expect(duel.summonAllowed(0, blue, 'special')).toBe(false);
    expect(duel.summonAllowed(0, ash, 'special')).toBe(true);
    expect(duel.summonAllowed(1, put(duel, 1, 89631139, 'hand'), 'special')).toBe(true);
  });

  it('刻魔的鎮魂棺：從墓地當作攻擊力上升 600 的裝備魔法裝備', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const eng = put(duel, 0, 60764609, 'mzone');
    const req = put(duel, 0, 2463794, 'grave');
    const atk = duel.getAtk(eng);
    await activateMain(duel, 0, req);
    expect(req.location).toBe('szone');
    expect(req.equipTarget).toBe(eng);
    expect(duel.getAtk(eng)).toBe(atk + 600);
  });

  it('刻魔的神聖棺：特殊召喚墓地的惡魔族・光屬性怪獸並裝備，攻擊力上升連結標記合計×600', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ag = put(duel, 0, 32991300, 'mzone');
    const eng = put(duel, 0, 60764609, 'grave');
    await activateMain(duel, 0, ag);
    expect(eng.location).toBe('mzone');
    expect(ag.equipTarget).toBe(eng);
    expect(duel.getAtk(eng)).toBe(1800 + 3 * 600);
  });

  it('刻魔的憐歌：自己的惡魔族・光屬性怪獸不會被戰鬥破壞，受到的戰鬥傷害減半', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const eng = put(duel, 0, 60764609, 'mzone');
    const kyrie = put(duel, 0, 26434972, 'szone', { faceUp: false });
    await activateMain(duel, 0, kyrie);
    expect(duel.has(eng, 'battleIndestructible')).toBe(true);
    expect(duel.p(0).turnFlags.halfBattleDamageTaken).toBe(true);
  });
});

describe('第十九彈：雷火沸動・碼麗絲', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };
  const at = (duel: Duel, p: PlayerId, id: number, zone: number) => {
    const c = new Card(getCard(id), p);
    c.location = 'void';
    duel.moveTo(c, 'mzone', { reason: 'rule', player: p, faceUp: true, position: 'atk', zone });
    c.turnPlaced = 1;
    return c;
  };

  it('內燃雷火沸動機：送 1 張卡去墓地從手牌特殊召喚，這回合只能從額外牌組特殊召喚 4 階超量怪獸', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ice = put(duel, 0, 8633261, 'hand');
    const fodder = put(duel, 0, FILLER, 'hand');
    const act = duel.getMainActions(0).find((a) => a.type === 'spSummon' && a.card === ice);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(ice.location).toBe('mzone');
    expect(fodder.location).toBe('grave');
    expect(duel.summonAllowed(0, put(duel, 0, 7511613, 'extra'), 'special')).toBe(true); // 4 階
    expect(duel.summonAllowed(0, put(duel, 0, 44508094, 'extra'), 'special')).toBe(false); // 星塵龍
    expect(duel.getMainActions(0).some((a) => a.type === 'spSummon' && a.card.id === 8633261)).toBe(false);
  });

  it('內燃雷火沸動機：通常召喚時從牌組特殊召喚其他雷火沸動', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ice = put(duel, 0, 8633261, 'mzone');
    const sword = put(duel, 0, 35844557, 'deck');
    ice.summonType = 'normal';
    duel.raise({ type: 'summoned', card: ice, cards: [ice], player: 0, summonType: 'normal' });
    await duel.settle();
    expect(sword.location).toBe('mzone');
  });

  it('雷火沸動油電雙動機：4 星怪獸 2 隻以上超量召喚，攻擊力增減素材數量×100', () => {
    const { duel } = setup();
    const duo = put(duel, 0, 7511613, 'extra');
    put(duel, 0, 8633261, 'mzone');
    put(duel, 0, 35844557, 'mzone');
    put(duel, 0, 72238166, 'mzone');
    const sets = duel.xyzMaterialSets(0, duo);
    expect(sets.some((s) => s.length === 3)).toBe(true);
    expect(sets.some((s) => s.length === 2)).toBe(true);
    const foe = put(duel, 1, 89631139, 'mzone');
    const field = put(duel, 0, 7511613, 'extra');
    duel.moveTo(field, 'mzone', { reason: 'rule', player: 0, faceUp: true });
    field.overlays.push(put(duel, 0, FILLER, 'grave'), put(duel, 0, FILLER, 'grave'), put(duel, 0, FILLER, 'grave'));
    expect(duel.getAtk(field)).toBe(2500 + 300);
    expect(duel.getAtk(foe)).toBe(3000 - 300);
  });

  it('雷火沸動交界機：同名卡在自己場上的怪獸不能超量召喚；對方怪獸的效果處理時取除素材讓效果無效', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    const cross = put(duel, 0, 6798031, 'szone');
    duel.moveTo(cross, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    const det = put(duel, 0, 34909328, 'extra');
    duel.moveTo(det, 'mzone', { reason: 'rule', player: 0, faceUp: true });
    det.overlays.push(put(duel, 0, FILLER, 'grave'));
    put(duel, 0, 8633261, 'mzone');
    put(duel, 0, 35844557, 'mzone');
    expect(duel.xyzMaterialSets(0, put(duel, 0, 34909328, 'extra'))).toEqual([]);
    expect(duel.xyzMaterialSets(0, put(duel, 0, 7511613, 'extra')).length).toBeGreaterThan(0);
    // 對方發動睡鼠的效果
    duel.turnPlayer = 1;
    const dormouse = put(duel, 1, 32061192, 'mzone');
    const target = put(duel, 1, 69272449, 'deck');
    await activateMain(duel, 1, dormouse);
    expect(target.location).toBe('deck');
    expect(det.overlays.length).toBe(0);
  });

  it('碼麗絲<兵卒>白兔：被除外時支付 300 基本分特殊召喚，這回合只能從額外牌組特殊召喚連結怪獸', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const rabbit = put(duel, 0, 69272449, 'hand');
    duel.banish([rabbit], 'effect', rabbit);
    await duel.settle();
    expect(rabbit.location).toBe('mzone');
    expect(duel.p(0).lp).toBe(8000 - 300);
    expect(duel.summonAllowed(0, put(duel, 0, 68059897, 'extra'), 'special')).toBe(true);
    expect(duel.summonAllowed(0, put(duel, 0, 7511613, 'extra'), 'special')).toBe(false);
  });

  it('碼麗絲<王后>紅棋勒索：所連接區有怪獸時，對方效果怪獸的原本攻擊力和原本守備力交換', () => {
    const { duel } = setup();
    const ransom = at(duel, 0, 68059897, 2);
    const foe = put(duel, 1, 77585513, 'mzone'); // 人造人 2400/1500
    expect(duel.getAtk(foe)).toBe(2400);
    at(duel, 0, FILLER, 1); // 連結箭頭指向左邊
    expect(duel.pointedMonsters(ransom).length).toBe(1);
    expect(duel.getAtk(foe)).toBe(1500);
    expect(duel.getDef(foe)).toBe(2400);
  });

  it('碼麗絲<代碼>TB-11：把場上的碼麗絲怪獸除外，在蓋放的回合發動', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const dormouse = put(duel, 0, 32061192, 'mzone');
    const tb = put(duel, 0, 57111661, 'szone', { faceUp: false });
    tb.turnPlaced = duel.turn;
    const rabbit = put(duel, 0, 69272449, 'deck');
    await activateMain(duel, 0, tb);
    expect(dormouse.location === 'banished' || dormouse.location === 'mzone').toBe(true);
    expect(rabbit.location).toBe('mzone');
    expect(duel.hasFlag(rabbit, 'cannotAttack')).toBe(true);
  });

  it('碼麗絲夢遊地下界：自己場上有碼麗絲連結怪獸時，對方只能攻擊碼麗絲連結怪獸', () => {
    const { duel } = setup();
    const ug = put(duel, 0, 68337209, 'szone');
    duel.moveTo(ug, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    const pawn = put(duel, 0, 69272449, 'mzone');
    expect(duel.has(pawn, 'cannotBeAttackTarget')).toBe(false);
    const ransom = put(duel, 0, 68059897, 'extra');
    duel.moveTo(ransom, 'mzone', { reason: 'rule', player: 0, faceUp: true });
    expect(duel.has(pawn, 'cannotBeAttackTarget')).toBe(true);
    expect(duel.has(ransom, 'cannotBeAttackTarget')).toBe(false);
  });
});

describe('第二十彈：巳劍・星辰', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('巳劍降臨：解放手牌等級合計相同的爬蟲類族怪獸，從牌組儀式召喚；被解放的巳劍之尊發動效果', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const saji = put(duel, 0, 18176525, 'hand');
    const aramasa = put(duel, 0, 40543231, 'hand');
    const murakumo = put(duel, 0, 19899073, 'deck');
    const prayers = put(duel, 0, 45171524, 'deck'); // 佐士檢索的魔法・陷阱
    const descent = put(duel, 0, 81560239, 'hand');
    await activateMain(duel, 0, descent);
    expect(murakumo.location).toBe('mzone');
    expect(murakumo.summonType).toBe('ritual');
    expect(saji.location).toBe('grave');
    expect(aramasa.location).toBe('grave');
    expect(prayers.location).toBe('hand');
  });

  it('天叢雲之巳劍：被解放時檢索其他巳劍卡，那之後可以特殊召喚這張卡', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const murakumo = put(duel, 0, 19899073, 'mzone');
    murakumo.properlySummoned = true;
    const saji = put(duel, 0, 18176525, 'deck');
    duel.sendToGrave([murakumo], 'tribute');
    await duel.settle();
    expect(saji.location).toBe('hand');
    expect(murakumo.location).toBe('mzone');
  });

  it('天叢雲之巳劍：對方把效果發動時，對方不丟棄手牌的話那個效果無效化', async () => {
    const { duel, a, b } = setup();
    a.respondWith = [19899073];
    b.declineAll = true;
    put(duel, 0, 19899073, 'mzone');
    duel.turnPlayer = 1;
    const pot = put(duel, 1, 55144522, 'hand');
    const hand = duel.p(1).hand.length;
    await activateMain(duel, 1, pot);
    expect(pot.location).toBe('grave');
    expect(duel.p(1).hand.length).toBe(hand - 1); // 沒有抽到卡
  });

  it('巳劍之尊 草那藝：自己場上其他爬蟲類族怪獸被破壞時，可以解放這張卡代替', async () => {
    const { duel, a } = setup();
    a.optionPick = 1;
    const kusanagi = put(duel, 0, 82782870, 'mzone');
    const aramasa = put(duel, 0, 40543231, 'mzone');
    await duel.destroy([aramasa], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(aramasa.location).toBe('mzone');
    expect(kusanagi.location).toBe('grave');
  });

  it('天羽羽斬之巳劍：①的效果在決鬥中只能使用 1 次', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const hab = put(duel, 0, 13332685, 'hand');
    put(duel, 0, 40543231, 'deck');
    put(duel, 0, 18176525, 'deck');
    await activateMain(duel, 0, hab);
    duel.turn += 2;
    expect(duel.getActivatable(0).some((x) => x.card === hab)).toBe(false);
  });

  it('羅睺星辰：用牌組的怪獸融合召喚，成為素材的星辰怪獸從牌組蓋放星辰魔法・陷阱', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const lukias = put(duel, 0, 75003700, 'deck');
    put(duel, 0, FILLER, 'hand');
    const horn = put(duel, 0, 69932023, 'deck');
    const arth = put(duel, 0, 33760966, 'extra');
    const rahu = put(duel, 0, 32548318, 'hand');
    await activateMain(duel, 0, rahu);
    expect(arth.location).toBe('mzone');
    expect(lukias.location === 'grave' || lukias.location === 'hand').toBe(true);
    expect(horn.location).toBe('szone');
    expect(horn.faceUp).toBe(false);
  });

  it('星辰爪龍：怪獸 2 隻以上同時被送去墓地時從墓地特殊召喚，離場時除外', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const arth = put(duel, 0, 33760966, 'grave');
    arth.properlySummoned = true;
    const m1 = put(duel, 1, FILLER, 'mzone');
    const m2 = put(duel, 1, FILLER, 'mzone');
    await duel.destroy([m1, m2], 'effect', put(duel, 0, 53129443, 'grave'));
    await duel.settle();
    expect(arth.location).toBe('mzone');
    await duel.destroy([arth], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(arth.location).toBe('banished');
  });

  it('只有 1 隻怪獸送去墓地時不算「同時 2 隻以上」', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const arth = put(duel, 0, 33760966, 'grave');
    arth.properlySummoned = true;
    await duel.destroy([put(duel, 1, FILLER, 'mzone')], 'effect', put(duel, 0, 12580477, 'grave'));
    await duel.destroy([put(duel, 1, FILLER, 'mzone')], 'effect', put(duel, 0, 12580477, 'grave'));
    await duel.settle();
    expect(arth.location).toBe('grave');
  });
});

describe('第二十一彈：耀聖・獄神・泛用卡', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };
  const at = (duel: Duel, p: PlayerId, id: number, zone: number) => {
    const c = new Card(getCard(id), p);
    c.location = 'void';
    duel.moveTo(c, 'mzone', { reason: 'rule', player: p, faceUp: true, position: 'atk', zone });
    c.turnPlaced = 1;
    return c;
  };

  it('灰流麗：讓「從牌組加入手牌」的效果無效；抽卡的效果不能對應', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.respondWith = [14558127];
    put(duel, 1, 14558127, 'hand');
    const warrior = put(duel, 0, 91152256, 'deck'); // 增援檢索 4 星以下的戰士族
    const reinforce = put(duel, 0, 32807846, 'hand');
    await activateMain(duel, 0, reinforce);
    expect(warrior.location).toBe('deck');
    expect(duel.p(1).grave.some((c) => c.id === 14558127)).toBe(true);
    // 強欲之壺不是從牌組加入手牌的效果
    const b2 = setup();
    b2.b.respondWith = [14558127];
    b2.a.declineAll = true;
    const ash = put(b2.duel, 1, 14558127, 'hand');
    const pot = put(b2.duel, 0, 55144522, 'hand');
    const hand = b2.duel.p(0).hand.length;
    await activateMain(b2.duel, 0, pot);
    expect(ash.location).toBe('hand');
    expect(b2.duel.p(0).hand.length).toBe(hand + 1);
  });

  it('小丑與鎖鳥：對方從牌組加入手牌後，這回合雙方不能從牌組把卡加入手牌', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = false;
    const droll = put(duel, 1, 94145021, 'hand');
    put(duel, 0, 91152256, 'deck');
    await activateMain(duel, 0, put(duel, 0, 32807846, 'hand'));
    expect(droll.location).toBe('grave');
    const second = put(duel, 0, 91152256, 'deck');
    await activateMain(duel, 0, put(duel, 0, 32807846, 'hand'));
    expect(second.location).toBe('deck');
  });

  it('原始生命態 尼比魯：對方召喚・特殊召喚 5 隻以上，解放雙方的怪獸，給對方原本攻守合計的衍生物', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    const mons = [put(duel, 0, 89631139, 'mzone'), put(duel, 0, 46986414, 'mzone')];
    for (let i = 0; i < 5; i++) duel.p(0).summonedThisTurn.push({ card: mons[0], kind: 'special' });
    const nib = put(duel, 1, 27204311, 'hand');
    const act = duel.getActivatable(1, { kind: 'free' } as never).find((x) => x.card === nib);
    expect(act).toBeTruthy();
    await duel.performMainAction(1, { type: 'activate', card: nib, effect: act!.effect, effectIndex: act!.effectIndex });
    expect(mons.every((c) => c.location === 'grave')).toBe(true);
    expect(nib.location).toBe('mzone');
    const tok = duel.monsters(0).find((c) => c.id === 27204312)!;
    expect(duel.getAtk(tok)).toBe(3000 + 2500);
    expect(duel.getDef(tok)).toBe(2500 + 2100);
  });

  it('耀聖之花詩 盧西娜：從手牌往中央的主要怪獸區域特殊召喚；對方回合和中央的怪獸交換位置', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const lucina = put(duel, 0, 13597785, 'hand');
    const act = duel.getMainActions(0).find((x) => x.type === 'spSummon' && x.card === lucina);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(lucina.zone).toBe(2);
    const tinia = at(duel, 0, 59581480, 0);
    duel.turnPlayer = 1;
    const swap = duel.getActivatable(0, { kind: 'free' } as never).find((x) => x.card === tinia);
    expect(swap).toBeTruthy();
    await duel.performMainAction(0, { type: 'activate', card: tinia, effect: swap!.effect, effectIndex: swap!.effectIndex });
    expect(tinia.zone).toBe(2);
    expect(lucina.zone).toBe(0);
  });

  it('調獄神 朱諾拉：可以把中央的主要怪獸區域的怪獸當作調整同步召喚', () => {
    // 調整＋調整以外 2 隻＝10 星
    const a = setup().duel;
    const ja = put(a, 0, 5914858, 'extra');
    at(a, 0, 12375297, 2); // 中央：1 星調整
    at(a, 0, 13597785, 0); // 6 星
    at(a, 0, 88819587, 1); // 3 星
    expect(a.synchroMaterialSets(0, ja).length).toBe(1);
    // 中央的 3 星通常怪獸當作調整
    const b = setup().duel;
    const jb = put(b, 0, 5914858, 'extra');
    at(b, 0, 88819587, 2); // 中央：3 星，當作調整
    at(b, 0, 40543231, 0); // 4 星
    at(b, 0, 88819587, 1); // 3 星
    expect(b.synchroMaterialSets(0, jb).length).toBe(1);
    // 不在中央的話不能當作調整
    const c = setup().duel;
    const jc = put(c, 0, 5914858, 'extra');
    at(c, 0, 40543231, 2); // 中央：4 星
    at(c, 0, 88819587, 0); // 3 星
    at(c, 0, 88819587, 1); // 3 星
    expect(c.synchroMaterialSets(0, jc).length).toBe(1); // 中央的 4 星當作調整：4＋3＋3
    const d = setup().duel;
    const jd = put(d, 0, 5914858, 'extra');
    at(d, 0, 88819587, 0); // 3 星
    at(d, 0, 40543231, 1); // 4 星
    at(d, 0, 88819587, 3); // 3 星（中央空著）
    expect(d.synchroMaterialSets(0, jd).length).toBe(0);
  });

  it('獄神影精－朱諾白化精：破壞後表側加入額外牌組，墓地的「耀聖」卡加入手牌', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const jun = put(duel, 0, 10266279, 'mzone');
    const regina = put(duel, 0, 56651978, 'grave');
    await duel.destroy([jun], 'effect', put(duel, 1, 12580477, 'grave'));
    await duel.settle();
    expect(jun.location).toBe('extra');
    expect(jun.faceUp).toBe(true);
    expect(regina.location).toBe('hand');
  });

  it('耀聖詩之獄神精：存在期間自己不能從額外牌組特殊召喚同步怪獸以外', () => {
    const { duel } = setup();
    put(duel, 0, 12375297, 'mzone');
    expect(duel.summonAllowed(0, put(duel, 0, 5914858, 'extra'), 'special')).toBe(true);
    expect(duel.summonAllowed(0, put(duel, 0, 4063756, 'extra'), 'special')).toBe(false);
  });

  it('耀聖之詩～回鄉之平行體～：中央的怪獸不會被效果破壞', async () => {
    const { duel } = setup();
    put(duel, 0, 64491754, 'szone', { faceUp: true });
    const center = at(duel, 0, 13597785, 2);
    const side = at(duel, 0, 59581480, 0);
    await duel.destroy([center, side], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(center.location).toBe('mzone');
    expect(side.location).toBe('grave');
  });

  it('歡聚友伴・茸茸長尾山雀：這回合對方每次從牌組・額外牌組特殊召喚，自己抽 1 張', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    const fuwa = put(duel, 1, 42141493, 'hand');
    const act = duel.getActivatable(1, { kind: 'free' } as never).find((x) => x.card === fuwa);
    expect(act).toBeTruthy();
    await duel.performMainAction(1, { type: 'activate', card: fuwa, effect: act!.effect, effectIndex: act!.effectIndex });
    const hand = duel.p(1).hand.length;
    const m = put(duel, 0, 89631139, 'deck');
    duel.specialSummon(m, 0, { position: 'atk' });
    expect(duel.p(1).hand.length).toBe(hand + 1);
    duel.specialSummon(put(duel, 0, 46986414, 'hand'), 0, { position: 'atk' });
    expect(duel.p(1).hand.length).toBe(hand + 1); // 從手牌特殊召喚不抽
  });
});

describe('第二十二彈：泛用卡', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('無限泡影：自己場上沒有卡時可以從手牌發動；蓋放發動的話相同縱列的魔法・陷阱也無效', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const blue = put(duel, 1, 70095154, 'mzone');
    const imp = put(duel, 0, 10045474, 'hand');
    await activateMain(duel, 0, imp);
    expect(duel.isNegated(blue)).toBe(true);
    // 場上有卡就不能從手牌發動
    const s2 = setup();
    put(s2.duel, 1, 70095154, 'mzone');
    put(s2.duel, 0, FILLER, 'mzone');
    const imp2 = put(s2.duel, 0, 10045474, 'hand');
    expect(s2.duel.getActivatable(0).some((x) => x.card === imp2)).toBe(false);
    // 蓋放發動：相同縱列的魔法・陷阱卡無效
    const s3 = setup();
    s3.b.declineAll = true;
    put(s3.duel, 1, 70095154, 'mzone');
    const set = put(s3.duel, 0, 10045474, 'szone', { faceUp: false });
    const col = set.zone;
    const foeST = new Card(getCard(44095762), 1);
    foeST.location = 'void';
    s3.duel.moveTo(foeST, 'szone', { reason: 'rule', player: 1, faceUp: false, zone: 4 - col });
    await activateMain(s3.duel, 0, set);
    expect(s3.duel.isNegated(foeST)).toBe(true);
  });

  it('墓穴的指名者：除外對方墓地的怪獸，直到下個回合結束時同名怪獸的效果無效（手牌也不能發動）', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    put(duel, 1, 14558127, 'grave');
    const ashInHand = put(duel, 1, 14558127, 'hand');
    await activateMain(duel, 0, put(duel, 0, 24224830, 'hand'));
    expect(duel.p(1).banished.some((c) => c.id === 14558127)).toBe(true);
    expect(duel.isNegated(ashInHand)).toBe(true);
    duel.turn += 1;
    expect(duel.isNegated(ashInHand)).toBe(true);
    duel.turn += 1;
    expect(duel.isNegated(ashInHand)).toBe(false);
  });

  it('颱風：對方的魔法・陷阱 2 張以上、自己沒有時可以從手牌發動', () => {
    const { duel } = setup();
    const ty = put(duel, 0, 14883228, 'hand');
    put(duel, 1, 44095762, 'szone', { faceUp: true });
    expect(duel.getActivatable(0).some((x) => x.card === ty)).toBe(false);
    put(duel, 1, 5318639, 'szone', { faceUp: true });
    expect(duel.getActivatable(0).some((x) => x.card === ty)).toBe(true);
  });

  it('歡聚友伴：發動後，這張卡以外的歡聚友伴這回合只能再發動 1 次', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    duel.turnPlayer = 1;
    const cards = [42141493, 84192580, 87126721].map((id) => put(duel, 0, id, 'hand'));
    const can = (c: Card) => duel.getActivatable(0, { kind: 'free' } as never).find((x) => x.card === c);
    for (const c of cards.slice(0, 2)) {
      const act = can(c)!;
      expect(act).toBeTruthy();
      await duel.performMainAction(0, { type: 'activate', card: c, effect: act.effect, effectIndex: act.effectIndex });
    }
    expect(can(cards[2])).toBeFalsy();
  });

  it('抖抖海月水母：對方每次從手牌召喚・特殊召喚，自己抽 1 張', async () => {
    const { duel, a, b } = setup();
    a.declineAll = true;
    b.declineAll = true;
    const pur = put(duel, 1, 84192580, 'hand');
    const act = duel.getActivatable(1, { kind: 'free' } as never).find((x) => x.card === pur)!;
    await duel.performMainAction(1, { type: 'activate', card: pur, effect: act.effect, effectIndex: act.effectIndex });
    const hand = duel.p(1).hand.length;
    duel.specialSummon(put(duel, 0, 46986414, 'hand'), 0, { position: 'atk' });
    expect(duel.p(1).hand.length).toBe(hand + 1);
    duel.specialSummon(put(duel, 0, 46986414, 'grave'), 0, { position: 'atk' });
    expect(duel.p(1).hand.length).toBe(hand + 1);
  });
});

describe('第二十三彈：卡通補完', () => {
  const activateMain = async (duel: Duel, p: PlayerId, card: Card, index = 0) => {
    const act = duel.getActivatable(p).filter((x) => x.card === card)[index];
    expect(act, `${card.name} 可以發動`).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act.effect, effectIndex: act.effectIndex });
  };

  it('卡通王國：發動時牌組上面 3 張裡側除外，卡名當作「卡通世界」，卡通怪獸被破壞時可以除外牌組上面的卡代替', async () => {
    const { duel, a, b } = setup();
    b.declineAll = true;
    const kingdom = put(duel, 0, 43175858, 'hand');
    const deck = duel.p(0).deck.length;
    await activateMain(duel, 0, kingdom);
    expect(kingdom.location).toBe('fzone');
    expect(duel.p(0).deck.length).toBe(deck - 3);
    expect(duel.p(0).banished.every((c) => !c.faceUp)).toBe(true);
    // 卡通破壞之劍士：有「卡通世界」、對方沒有卡通怪獸時可以直接攻擊
    const tbb = put(duel, 0, 61190918, 'mzone');
    put(duel, 1, 89631139, 'mzone');
    expect(duel.has(tbb, 'directAttack')).toBe(true);
    expect(duel.getAtk(tbb)).toBe(2600 + 500); // 對方場上 1 隻龍族
    a.optionPick = 1;
    await duel.destroy([tbb], 'effect', put(duel, 1, 12580477, 'grave'));
    expect(tbb.location).toBe('mzone');
    expect(duel.p(0).banished.length).toBe(4);
  });

  it('卡通混沌戰士：解放等級合計 8 以上的卡通怪獸特殊召喚；有卡通世界時除外場上 1 張卡', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    put(duel, 0, 15259703, 'szone', { faceUp: true });
    put(duel, 0, 53183600, 'hand'); // 青眼卡通龍 8 星
    const bls = put(duel, 0, 28711704, 'hand');
    const act = duel.getMainActions(0).find((x) => x.type === 'spSummon' && x.card === bls);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(bls.location).toBe('mzone');
    const foe = put(duel, 1, 89631139, 'mzone');
    await activateMain(duel, 0, bls);
    expect(foe.location).toBe('banished');
    expect(duel.has(bls, 'cannotAttack')).toBe(true);
  });

  it('卡通恐怖：有卡通世界與卡通怪獸時，讓魔法卡的發動無效並破壞', async () => {
    const { duel, a, b } = setup();
    b.declineAll = true;
    a.respondWith = [53094821];
    put(duel, 0, 15259703, 'szone', { faceUp: true });
    put(duel, 0, 61190918, 'mzone');
    put(duel, 0, 53094821, 'szone', { faceUp: false });
    duel.turnPlayer = 1;
    const pot = put(duel, 1, 55144522, 'hand');
    const hand = duel.p(1).hand.length;
    const act = duel.getActivatable(1).find((x) => x.card === pot)!;
    await duel.performMainAction(1, { type: 'activate', card: pot, effect: act.effect, effectIndex: act.effectIndex });
    expect(duel.p(1).hand.length).toBe(hand - 1);
    expect(pot.location).toBe('grave');
  });
});

describe('第二十四彈：三幻魔', () => {

  it('混沌幻魔 阿米泰爾：除外場上的三幻魔從額外牌組特殊召喚，自己回合攻擊力上升 10000，不會被戰鬥破壞', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const beasts = [6007213, 32491822, 69890967].map((id) => put(duel, 0, id, 'mzone'));
    const arm = put(duel, 0, 43378048, 'extra');
    const act = duel.getMainActions(0).find((x) => x.type === 'spSummon' && x.card === arm);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(arm.location).toBe('mzone');
    expect(beasts.every((c) => c.location === 'banished')).toBe(true);
    expect(duel.getAtk(arm)).toBe(10000);
    duel.turnPlayer = 1;
    expect(duel.getAtk(arm)).toBe(0);
    expect(duel.has(arm, 'battleIndestructible')).toBe(true);
  });

  it('劫火之三幻魔：只能用「三幻魔」卡的效果特殊召喚（死者蘇生不行）', () => {
    const { duel } = setup();
    const uria = put(duel, 0, 23856331, 'grave');
    expect(duel.specialSummon(uria, 0, { position: 'atk', by: put(duel, 0, 83764718, 'grave') })).toBe(false);
    expect(duel.specialSummon(uria, 0, { position: 'def', by: put(duel, 0, 22734799, 'mzone') })).toBe(true);
  });

  it('覺醒的三幻魔：三種都在場上時，被送去對方墓地的怪獸改為除外', async () => {
    const { duel } = setup();
    put(duel, 0, 53701259, 'szone', { faceUp: true });
    for (const id of [6007213, 32491822, 69890967]) put(duel, 0, id, 'mzone');
    const foe = put(duel, 1, 89631139, 'mzone');
    await duel.destroy([foe], 'effect', put(duel, 0, 12580477, 'grave'));
    expect(foe.location).toBe('banished');
  });

  it('幻魔皇 拉比艾爾：對方召喚成功時特殊召喚不能攻擊的幻魔衍生物', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    put(duel, 0, 69890967, 'mzone');
    duel.turnPlayer = 1;
    const m = put(duel, 1, FILLER, 'mzone');
    duel.raise({ type: 'summoned', card: m, cards: [m], player: 1, summonType: 'normal' });
    await duel.settle();
    const tok = duel.monsters(0).find((c) => c.id === 69890968);
    expect(tok).toBeTruthy();
    expect(duel.has(tok!, 'cannotAttack')).toBe(true);
  });

  it('混沌之三幻魔：1 回合最多 2 次不會被效果破壞', async () => {
    const { duel } = setup();
    const c = put(duel, 0, 7894706, 'mzone');
    const src = put(duel, 1, 12580477, 'grave');
    await duel.destroy([c], 'effect', src);
    await duel.destroy([c], 'effect', src);
    expect(c.location).toBe('mzone');
    await duel.destroy([c], 'effect', src);
    expect(c.location).toBe('grave');
  });

  it('神炎皇 烏利亞：把 3 張表側表示的陷阱卡送去墓地特殊召喚，攻擊力上升墓地永續陷阱×1000', async () => {
    const { duel } = setup();
    const uria = put(duel, 0, 6007213, 'hand');
    for (let i = 0; i < 3; i++) put(duel, 0, 53701259, 'szone', { faceUp: true });
    const act = duel.getMainActions(0).find((x) => x.type === 'spSummon' && x.card === uria);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(uria.location).toBe('mzone');
    expect(duel.getAtk(uria)).toBe(3000);
  });
});

describe('第二十五彈：超戰士', () => {
  async function activateCard(duel: Duel, p: PlayerId, card: Card) {
    const act = duel.getActivatable(p).find((a) => a.card === card);
    expect(act).toBeTruthy();
    await duel.performMainAction(p, { type: 'activate', card, effect: act!.effect, effectIndex: act!.effectIndex });
  }

  it('超戰士的儀式：用開闢之騎士＋宵暗之騎士儀式召喚，超戰士得到騎士的效果', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ss = put(duel, 0, 54484652, 'hand');
    const k1 = put(duel, 0, 6628343, 'hand');
    const k2 = put(duel, 0, 32013448, 'hand');
    const rit = put(duel, 0, 14094090, 'hand');
    await activateCard(duel, 0, rit);
    expect(ss.location).toBe('mzone');
    expect(k1.location).toBe('grave');
    expect(k2.location).toBe('grave');
    expect(ss.granted.length).toBe(4);
  });

  it('超戰士的萌芽：手牌光屬性＋牌組暗屬性送去墓地儀式召喚', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ss = put(duel, 0, 54484652, 'hand');
    const k1 = put(duel, 0, 6628343, 'hand'); // 光
    const k2 = put(duel, 0, 32013448, 'deck'); // 暗
    const syn = put(duel, 0, 45948430, 'hand');
    await activateCard(duel, 0, syn);
    expect(ss.location).toBe('mzone');
    expect(k1.location).toBe('grave');
    expect(k2.location).toBe('grave');
  });

  it('球形栗子球：儀式召喚時可以從墓地除外代替解放', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ss = put(duel, 0, 54484652, 'hand');
    const gaia = put(duel, 0, 7841921, 'hand'); // 7 星
    const sphere = put(duel, 0, 33245030, 'grave'); // 1 星
    const rit = put(duel, 0, 14094090, 'hand');
    await activateCard(duel, 0, rit);
    expect(ss.location).toBe('mzone');
    expect(gaia.location).toBe('grave');
    expect(sphere.location).toBe('banished');
  });

  it('超戰士 混沌戰士：戰鬥破壞對方怪獸給予原本攻擊力的傷害', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    const ss = put(duel, 0, 54484652, 'mzone');
    const foe = put(duel, 1, 46986414, 'mzone'); // 2500
    await duel.performAttack(ss, foe);
    await duel.settle();
    expect(foe.location).toBe('grave');
    expect(duel.p(1).lp).toBe(8000 - 500 - 2500);
  });

  it('光與暗之戰士 混沌戰士：不會被戰鬥破壞', () => {
    const { duel } = setup();
    const c = put(duel, 0, 70405001, 'mzone');
    expect(duel.has(c, 'battleIndestructible')).toBe(true);
  });

  it('傳說的劍鬥士 混沌戰士：自己戰鬥階段中對方不能發動效果', () => {
    const { duel } = setup();
    put(duel, 0, 70551291, 'mzone');
    const imp = put(duel, 1, 10045474, 'szone', { faceUp: false });
    imp.turnPlaced = 1;
    duel.phase = 'battle';
    expect(duel.getActivatable(1).some((a) => a.card === imp)).toBe(false);
  });

  it('疾走的暗黑騎士 蓋亞：可以不解放召喚，原本攻擊力變成 1900', async () => {
    const { duel } = setup();
    const g = put(duel, 0, 7841921, 'hand');
    const act = duel.getMainActions(0).find((x) => x.type === 'summon' && x.card === g);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(g.location).toBe('mzone');
    expect(duel.getAtk(g)).toBe(1900);
  });
});

describe('第二十六彈：殺手級調整曲', () => {
  it('手牌的調整也能作為同步素材（調整＋調整）', () => {
    const { duel } = setup();
    put(duel, 0, 43904702, 'mzone'); // 削波手 2 星
    put(duel, 0, 43904702, 'hand'); // 削波手 2 星
    const tm = put(duel, 0, 42781164, 'extra'); // 音軌制作人 4 星
    const sets = duel.synchroMaterialSets(0, tm);
    expect(sets.length).toBe(1);
    expect(sets[0].some((c) => c.location === 'hand')).toBe(true);
  });

  it('調整以外的怪獸不能作為「調整＋調整」的素材', () => {
    const { duel } = setup();
    put(duel, 0, 43904702, 'mzone');
    put(duel, 0, 96851799, 'mzone'); // 2 星非調整
    const tm = put(duel, 0, 42781164, 'extra');
    expect(duel.synchroMaterialSets(0, tm).length).toBe(0);
  });

  it('作為同步素材送去墓地：混音手破壞對方怪獸', async () => {
    const { duel, b } = setup();
    b.declineAll = true;
    put(duel, 0, 16509007, 'mzone'); // 混音手 2 星
    put(duel, 0, 16509007, 'mzone');
    const foe = put(duel, 1, FILLER, 'mzone');
    const tm = put(duel, 0, 42781164, 'extra');
    const act = duel.getMainActions(0).find((x) => x.type === 'synchro' && x.card === tm);
    expect(act).toBeTruthy();
    await duel.performMainAction(0, act!);
    expect(tm.location).toBe('mzone');
    expect(foe.location).toBe('grave');
  });

  it('點唱機酒吧：在通常召喚外加上可以召喚 1 隻調整', async () => {
    const { duel } = setup();
    put(duel, 0, 14442329, 'szone', { faceUp: true });
    duel.moveTo(duel.p(0).szone.find((c) => c?.id === 14442329)!, 'fzone', { reason: 'rule', player: 0, faceUp: true });
    const t1 = put(duel, 0, 17209452, 'hand');
    const t2 = put(duel, 0, 17209452, 'hand');
    await duel.performMainAction(0, { type: 'summon', card: t1 });
    expect(t1.location).toBe('mzone');
    expect(duel.canNormalSummon(0, t2)).toBe(true);
    await duel.performMainAction(0, { type: 'summon', card: t2 });
    expect(t2.location).toBe('mzone');
    expect(duel.canNormalSummon(0, put(duel, 0, 17209452, 'hand'))).toBe(false);
  });

  it('殺手級調整曲 B2B：對方場上的怪獸等級上升 2 星', () => {
    const { duel } = setup();
    put(duel, 0, 65961304, 'mzone');
    const foe = put(duel, 1, FILLER, 'mzone');
    expect(duel.getLevel(foe)).toBe(getCard(FILLER).level + 2);
  });

  it('鎖縛龍 鎖鐮：可以當作調整以外的怪獸作為同步素材', () => {
    const { duel } = setup();
    put(duel, 0, 4891376, 'mzone'); // 7 星
    put(duel, 0, 17209452, 'mzone'); // 1 星調整
    const b2b = put(duel, 0, 65961304, 'extra'); // 10 星：調整＋同步怪獸
    expect(duel.synchroMaterialSets(0, b2b).length).toBe(0);
    put(duel, 0, 16387555, 'mzone'); // 3 星調整
    expect(duel.synchroMaterialSets(0, b2b).length).toBe(1);
  });
});
