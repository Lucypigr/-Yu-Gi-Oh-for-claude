// 決鬥中的一張卡（實體）
import type { CardData } from './cardDb';
import type { Loc, PlayerId, Position, StatMod, SummonType } from './types';

let nextUid = 1;

export class Card {
  readonly uid = nextUid++;
  data: CardData;
  owner: PlayerId;
  controller: PlayerId;
  location: Loc = 'deck';
  /** 在怪獸區/魔陷區的格子編號，其他位置為 -1 */
  zone = -1;
  faceUp = false;
  position: Position = 'atk';
  /** 每次移動位置都會 +1，用來判斷「對象」是否還是同一張卡 */
  stint = 0;
  /** 曾經以正規方法特殊召喚（融合・同步・超量・儀式等），之後可以被蘇生 */
  properlySummoned = false;
  /** 曾被當作融合召喚的素材（融合回收用） */
  fusionMaterial = false;

  // ---- 以下為在場上時的狀態，離場時重置 ----
  /** 來到場上（或被蓋放）的回合 */
  turnPlaced = 0;
  summonType: SummonType | null = null;
  /** 用效果特殊召喚這張卡的卡（劍鬥獸「用劍鬥獸的效果特殊召喚時」用） */
  summonedBy: Card | null = null;
  /** 最後一次移動的回合與移動前的位置 */
  movedTurn = 0;
  movedFrom: Loc | null = null;
  attacks = 0;
  /** 可以額外攻擊的次數 */
  extraAttacks = 0;
  /** 融合・連結召喚時使用的素材 */
  summonMaterials: Card[] = [];
  /** 出場前所在的位置（「從額外牌組特殊召喚的怪獸」用） */
  summonedFrom: Loc | null = null;
  /** 用和自身同名的怪獸作為素材召喚（轉生炎獸的「轉生」） */
  reincarnated = false;
  /** 最後一次被破壞送去墓地的回合（離場後保留） */
  destroyedTurn = 0;
  /** 離場前的召喚方式（「連結召喚的這張卡被破壞送去墓地的場合」用，離場後保留） */
  prevSummonType: SummonType | null = null;
  /** 暫時改變卡片資料（原本攻擊力・屬性）時的原始資料，離場或效果結束時還原 */
  baseData: CardData | null = null;
  /** 陷阱怪獸：在怪獸區域時原本的陷阱卡資料（離場時還原） */
  trapData: CardData | null = null;
  /** 暫時得到的卡名・效果（凶飢毒融合龍），回合開始時清除 */
  copied: { id: number; name: string } | null = null;
  /** 這回合攻擊過的怪獸（「向對方怪獸全部各作 1 次攻擊」用） */
  attackedTargets: Card[] = [];
  posChangedTurn = 0;
  counters = 0;
  equipTarget: Card | null = null;
  equipStint = 0;
  overlays: Card[] = [];
  mods: StatMod[] = [];
  /** 效果無效化 */
  negated = false;
  /** 暫時的旗標（例如：這回合不能攻擊） */
  flags: Record<string, number | boolean> = {};
  /** 與這張卡「連結」的卡（活死人的呼聲、過早的埋葬） */
  linked: Card | null = null;
  linkedStint = 0;
  /** 控制權暫時轉移，在結束階段返還 */
  controlUntilEnd = false;
  /** 1 回合 1 次的使用紀錄（效果索引） */
  usedTurn: Record<number, number> = {};

  constructor(data: CardData, owner: PlayerId) {
    this.data = data;
    this.owner = owner;
    this.controller = owner;
  }

  get id() {
    return this.data.id;
  }

  get name() {
    return this.copied ? this.copied.name : this.data.name;
  }

  get onField() {
    return this.location === 'mzone' || this.location === 'szone' || this.location === 'fzone';
  }

  get isFaceUpMonster() {
    return this.location === 'mzone' && this.faceUp;
  }

  resetFieldState() {
    this.turnPlaced = 0;
    this.summonType = null;
    this.summonedBy = null;
    this.attacks = 0;
    this.extraAttacks = 0;
    this.attackedTargets = [];
    this.copied = null;
    this.reincarnated = false;
    this.summonMaterials = [];
    this.summonedFrom = null;
    this.posChangedTurn = 0;
    this.counters = 0;
    this.equipTarget = null;
    this.overlays = [];
    this.mods = [];
    this.negated = false;
    this.flags = {};
    this.linked = null;
    this.controlUntilEnd = false;
  }
}
