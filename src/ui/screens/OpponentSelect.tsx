// 選擇對手
import { useState } from 'react';
import { validateDeck } from '../../game/deckRules';
import { OPPONENTS, type Opponent } from '../../game/opponents';
import { FIRST_WIN_BONUS, type Profile, isOpponentUnlocked, setActiveDeck } from '../../game/profile';

export function OpponentSelect({ profile, onStart }: { profile: Profile; onStart: (o: Opponent) => void }) {
  const deck = profile.decks.find((d) => d.id === profile.activeDeckId) ?? profile.decks[0];
  const errors = validateDeck(deck, profile.collection);
  const [chosen, setChosen] = useState<Opponent | null>(null);

  return (
    <div className="screen opp-screen">
      <h2>選擇對手</h2>
      <div className="deck-picker">
        <span>使用牌組：</span>
        <select value={deck.id} onChange={(e) => setActiveDeck(e.target.value)}>
          {profile.decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}（{d.main.length}＋{d.extra.length}）
            </option>
          ))}
        </select>
        {errors.length > 0 && <span className="error">牌組不合法：{errors[0]}</span>}
      </div>
      <div className="opp-list">
        {OPPONENTS.map((o) => {
          const unlocked = isOpponentUnlocked(profile, o.id);
          const wins = profile.stats.beaten[o.id] ?? 0;
          const req = o.requires ? OPPONENTS.find((x) => x.id === o.requires) : null;
          return (
            <div
              key={o.id}
              className={`opp-card ${unlocked ? '' : 'locked'} ${chosen?.id === o.id ? 'chosen' : ''}`}
              onClick={() => unlocked && setChosen(o)}
            >
              <div className="opp-avatar">{unlocked ? o.avatar : '🔒'}</div>
              <div className="opp-info">
                <div className="opp-name">
                  {o.name} <span className="opp-title">{o.title}</span>
                </div>
                <div className="opp-level">{'★'.repeat(o.level)}{'☆'.repeat(5 - o.level)}</div>
                <div className="opp-desc">{unlocked ? o.desc : `打贏「${req?.name}」後解鎖`}</div>
                <div className="opp-reward">
                  勝利獎勵 🪙 {o.reward}
                  {wins === 0 && unlocked ? <span className="first-bonus">首勝 ×{1 + FIRST_WIN_BONUS}</span> : null}
                  {wins > 0 && <span className="wins">已勝 {wins} 次</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="bottom-bar">
        <button className="btn primary big" disabled={!chosen || errors.length > 0} onClick={() => chosen && onStart(chosen)}>
          {chosen ? `挑戰 ${chosen.name}` : '請選擇對手'}
        </button>
      </div>
    </div>
  );
}
