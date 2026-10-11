import { useState } from "react";
import type { DuelResult } from "./engine/duel";
import type { Opponent } from "./game/opponents";
import { type DuelReward, recordDuel } from "./game/profile";
import { CardInfoHost } from "./ui/components/CardView";
import { DuelScreen, Modal } from "./ui/duel/DuelScreen";
import { CollectionScreen } from "./ui/screens/CollectionScreen";
import { DeckEditor } from "./ui/screens/DeckEditor";
import { MainMenu, type Screen } from "./ui/screens/MainMenu";
import { OpponentSelect } from "./ui/screens/OpponentSelect";
import { SettingsScreen } from "./ui/screens/SettingsScreen";
import { ShopScreen } from "./ui/screens/ShopScreen";
import { NewGameScreen } from "./ui/screens/TitleScreen";
import { useProfile } from "./ui/useProfile";

const SCREEN_TITLES: Record<Screen, string> = {
  menu: "主選單",
  duelSelect: "決鬥",
  shop: "商店",
  deck: "牌組編輯",
  collection: "卡片圖鑑",
  settings: "設定",
};

export default function App() {
  const profile = useProfile();
  const [screen, setScreen] = useState<Screen>("menu");
  const [duelOpp, setDuelOpp] = useState<Opponent | null>(null);
  const [reward, setReward] = useState<{
    result: DuelResult;
    reward: DuelReward;
    opp: Opponent;
  } | null>(null);

  if (!profile) return <NewGameScreen />;

  if (duelOpp) {
    const deck =
      profile.decks.find((d) => d.id === profile.activeDeckId) ??
      profile.decks[0];
    return (
      <>
        <CardInfoHost />
        <DuelScreen
          playerName={profile.playerName}
          deck={deck}
          opponent={duelOpp}
          settings={profile.settings}
          onFinish={(result) => {
            const outcome =
              result.winner === 0
                ? "win"
                : result.winner === null
                  ? "draw"
                  : "loss";
            const r = recordDuel(duelOpp.id, outcome);
            setReward({ result, reward: r, opp: duelOpp });
            setDuelOpp(null);
            setScreen("duelSelect");
          }}
        />
      </>
    );
  }

  return (
    <div className="app">
      <CardInfoHost />
      <header className="app-header">
        {screen !== "menu" ? (
          <button className="back-btn" onClick={() => setScreen("menu")}>
            ◀ 返回
          </button>
        ) : (
          <span />
        )}
        <span className="header-title">{SCREEN_TITLES[screen]}</span>
        <span className="coins">🪙 {profile.coins}</span>
      </header>
      <div className="app-body">
        {screen === "menu" && <MainMenu profile={profile} go={setScreen} />}
        {screen === "duelSelect" && (
          <OpponentSelect profile={profile} onStart={setDuelOpp} />
        )}
        {screen === "shop" && <ShopScreen profile={profile} />}
        {screen === "deck" && <DeckEditor profile={profile} />}
        {screen === "collection" && <CollectionScreen profile={profile} />}
        {screen === "settings" && <SettingsScreen profile={profile} />}
      </div>
      {reward && (
        <Modal title="決鬥結果" onClose={() => setReward(null)}>
          <div className="reward-box">
            <h2>
              {reward.result.winner === 0
                ? `打贏了 ${reward.opp.name}！`
                : reward.result.winner === null
                  ? "平手"
                  : `輸給了 ${reward.opp.name}`}
            </h2>
            <p>
              {reward.result.reason}（{reward.result.turns} 回合）
            </p>
            <p className="reward-coins">
              獲得 🪙 {reward.reward.coins}
              {reward.reward.firstWin && (
                <span className="first-bonus">首勝獎勵加倍！</span>
              )}
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setReward(null)}>
                確定
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReward(null);
                  setScreen("shop");
                }}
              >
                去商店
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
