// 玩家操作：把引擎的詢問轉成 UI 上的待處理請求
import type { Card } from '../../engine/card';
import type { Duel } from '../../engine/duel';
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
} from '../../engine/types';

export type HumanRequest =
  | { kind: 'main'; actions: MainAction[]; resolve: (a: MainAction) => void }
  | { kind: 'battle'; options: AttackOption[]; resolve: (a: BattleAction) => void }
  | { kind: 'response'; options: Activation[]; window: WindowInfo; resolve: (a: Activation | null) => void }
  | { kind: 'select'; prompt: SelectPrompt; resolve: (c: Card[]) => void }
  | { kind: 'option'; prompt: OptionPrompt; resolve: (i: number) => void }
  | { kind: 'confirm'; prompt: ConfirmPrompt; resolve: (b: boolean) => void };

export class HumanController implements Controller {
  request: HumanRequest | null = null;
  /** 每次新請求 +1（UI 用來重置對話框狀態） */
  seq = 0;
  autoPass = true;
  private listeners = new Set<() => void>();

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set<T>(make: (resolve: (v: T) => void) => HumanRequest): Promise<T> {
    return new Promise<T>((resolve) => {
      this.seq++;
      this.request = make((v: T) => {
        this.request = null;
        this.emit();
        resolve(v);
      });
      this.emit();
    });
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  chooseMainAction(_duel: Duel, _p: PlayerId, actions: MainAction[]) {
    return this.set<MainAction>((resolve) => ({ kind: 'main', actions, resolve }));
  }

  chooseBattleAction(_duel: Duel, _p: PlayerId, options: AttackOption[]) {
    return this.set<BattleAction>((resolve) => ({ kind: 'battle', options, resolve }));
  }

  async chooseResponse(duel: Duel, p: PlayerId, options: Activation[], window: WindowInfo) {
    if (this.autoPass && !this.worthAsking(duel, p, window)) return null;
    return this.set<Activation | null>((resolve) => ({ kind: 'response', options, window, resolve }));
  }

  /** 自動略過不重要的時機，避免一直跳出確認 */
  private worthAsking(duel: Duel, p: PlayerId, window: WindowInfo): boolean {
    if (window.kind !== 'phase') return true;
    const oppTurn = duel.turnPlayer !== p;
    if (oppTurn) return duel.phase === 'battle' || duel.phase === 'end';
    return duel.phase === 'battle';
  }

  selectCards(_duel: Duel, prompt: SelectPrompt) {
    return this.set<Card[]>((resolve) => ({ kind: 'select', prompt, resolve }));
  }

  chooseOption(_duel: Duel, prompt: OptionPrompt) {
    return this.set<number>((resolve) => ({ kind: 'option', prompt, resolve }));
  }

  confirm(_duel: Duel, prompt: ConfirmPrompt) {
    return this.set<boolean>((resolve) => ({ kind: 'confirm', prompt, resolve }));
  }
}
