import { useState } from 'react';
import type { DuelResult } from './engine/duel';
import { DECK_STYLE_NAMES, type LadderOpponent, rankOf } from './game/ladder';
import type { Opponent } from './game/opponents';
import { type DuelReward, type LadderResult, recordDuel, recordLadderDuel } from './game/profile';
import { CardInfoHost } from './ui/components/CardView';
import { DuelScreen, Modal } from './ui/duel/DuelScreen';
import { CollectionScreen } from './ui/screens/CollectionScreen';
import { DeckEditor } from './ui/screens/DeckEditor';
import { LadderScreen, RankBadge } from './ui/screens/LadderScreen';
import { MainMenu, type Screen } from './ui/screens/MainMenu';
import { OpponentSelect } from './ui/screens/OpponentSelect';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { ShopScreen } from './ui/screens/ShopScreen';
import { NewGameScreen } from './ui/screens/TitleScreen';
import { useProfile } from './ui/useProfile';

const SCREEN_TITLES: Record<Screen, string> = {
  menu: '主選單',
  ladder: '天梯對戰',
  duelSelect: '決鬥',
  shop: '商店',
  deck: '牌組編輯',
  collection: '卡片圖鑑',
  settings: '設定',
};

export default function App() {
  const profile = useProfile();
  const [screen, setScreen] = useState<Screen>('menu');
  const [duelOpp, setDuelOpp] = useState<Opponent | null>(null);
  const [reward, setReward] = useState<{
    result: DuelResult;
    reward: DuelReward;
    opp: Opponent;
  } | null>(null);
  const [ladderOpp, setLadderOpp] = useState<LadderOpponent | null>(null);
  const [ladderResult, setLadderResult] = useState<{
    result: DuelResult;
    ladder: LadderResult;
    opp: LadderOpponent;
  } | null>(null);

  if (!profile) return <NewGameScreen />;

  if (ladderOpp) {
    const deck = profile.decks.find((d) => d.id === profile.activeDeckId) ?? profile.decks[0];
    return (
      <>
        <CardInfoHost />
        <DuelScreen
          playerName={profile.playerName}
          deck={deck}
          opponent={ladderOpp}
          settings={profile.settings}
          onFinish={(result) => {
            const outcome = result.winner === 0 ? 'win' : result.winner === null ? 'draw' : 'loss';
            setLadderResult({ result, ladder: recordLadderDuel(ladderOpp, outcome), opp: ladderOpp });
            setLadderOpp(null);
            setScreen('ladder');
          }}
        />
      </>
    );
  }

  if (duelOpp) {
    const deck = profile.decks.find((d) => d.id === profile.activeDeckId) ?? profile.decks[0];
    return (
      <>
        <CardInfoHost />
        <DuelScreen
          playerName={profile.playerName}
          deck={deck}
          opponent={duelOpp}
          settings={profile.settings}
          onFinish={(result) => {
            const outcome = result.winner === 0 ? 'win' : result.winner === null ? 'draw' : 'loss';
            const r = recordDuel(duelOpp.id, outcome);
            setReward({ result, reward: r, opp: duelOpp });
            setDuelOpp(null);
            setScreen('duelSelect');
          }}
        />
      </>
    );
  }

  return (
    <div className="app">
      <CardInfoHost />
      <header className="app-header">
        {screen !== 'menu' ? (
          <button className="back-btn" onClick={() => setScreen('menu')}>
            ◀ 返回
          </button>
        ) : (
          <span />
        )}
        <span className="header-title">{SCREEN_TITLES[screen]}</span>
        <span className="coins">🪙 {profile.coins}</span>
      </header>
      <div className="app-body">
        {screen === 'menu' && <MainMenu profile={profile} go={setScreen} />}
        {screen === 'ladder' && <LadderScreen profile={profile} onStart={setLadderOpp} />}
        {screen === 'duelSelect' && <OpponentSelect profile={profile} onStart={setDuelOpp} />}
        {screen === 'shop' && <ShopScreen profile={profile} />}
        {screen === 'deck' && <DeckEditor profile={profile} />}
        {screen === 'collection' && <CollectionScreen profile={profile} />}
        {screen === 'settings' && <SettingsScreen profile={profile} />}
      </div>
      {reward && (
        <Modal title="決鬥結果" onClose={() => setReward(null)}>
          <div className="reward-box">
            <h2>
              {reward.result.winner === 0
                ? `打贏了 ${reward.opp.name}！`
                : reward.result.winner === null
                  ? '平手'
                  : `輸給了 ${reward.opp.name}`}
            </h2>
            <p>
              {reward.result.reason}（{reward.result.turns} 回合）
            </p>
            <p className="reward-coins">
              獲得 🪙 {reward.reward.coins}
              {reward.reward.firstWin && <span className="first-bonus">首勝獎勵加倍！</span>}
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setReward(null)}>
                確定
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReward(null);
                  setScreen('shop');
                }}
              >
                去商店
              </button>
            </div>
          </div>
        </Modal>
      )}
      {ladderResult && <LadderResultModal {...ladderResult} onClose={() => setLadderResult(null)} />}
    </div>
  );
}

function LadderResultModal({
  result,
  ladder,
  opp,
  onClose,
}: {
  result: DuelResult;
  ladder: LadderResult;
  opp: LadderOpponent;
  onClose: () => void;
}) {
  const before = rankOf(ladder.before);
  const after = rankOf(ladder.after);
  const promoted = after.label !== before.label && ladder.after > ladder.before;
  const demoted = after.label !== before.label && ladder.after < ladder.before;
  return (
    <Modal title="天梯結果" onClose={onClose}>
      <div className="reward-box">
        <h2>{result.winner === 0 ? '勝利！' : result.winner === null ? '平手' : '敗北⋯⋯'}</h2>
        <p>
          {result.reason}（{result.turns} 回合）
        </p>
        <div className="ladder-change">
          <RankBadge rating={ladder.after} big />
          <span className={`delta ${ladder.delta >= 0 ? 'up' : 'down'}`}>
            積分 {ladder.before} → {ladder.after}（{ladder.delta >= 0 ? '+' : ''}
            {ladder.delta}）
          </span>
        </div>
        {promoted && <p className="promo up">🎉 晉級到 {after.label}！</p>}
        {demoted && <p className="promo down">降到了 {after.label}</p>}
        {ladder.streak >= 3 && <p className="hint">🔥 {ladder.streak} 連勝！連勝中可以拿到額外積分</p>}
        <p className="reward-coins">獲得 🪙 {ladder.coins}</p>
        <div className="opp-reveal">
          <div>
            {opp.avatar} <b>{opp.name}</b> <RankBadge rating={opp.rating} />
          </div>
          <div className="hint">
            對手的牌組：{opp.deckName}（{DECK_STYLE_NAMES[opp.deckStyle]}）
          </div>
          <div className="chat-bubble">
            {opp.name}：{result.winner === 0 ? pickLine(LOSE_LINES, opp) : result.winner === null ? 'gg' : pickLine(WIN_LINES, opp)}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            確定
          </button>
        </div>
      </div>
    </Modal>
  );
}

const WIN_LINES = ['gg', 'gg wp', '好險', '謝謝指教', '運氣好而已', 'ez', '抽得不錯～', '再來一場？'];
const LOSE_LINES = ['gg', 'gg wp', '手牌卡死了⋯⋯', '你好強', '可惡，再來！', '我陷阱都沒抽到', '…', '學到了'];
const pickLine = (lines: string[], opp: LadderOpponent) => lines[Math.abs(opp.rating * 7 + opp.name.length * 13) % lines.length];
