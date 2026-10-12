// 天梯對戰：配對到的「玩家」其實都是電腦
import { useEffect, useMemo, useState } from 'react';
import { validateDeck } from '../../game/deckRules';
import {
  DECK_STYLE_NAMES,
  type LadderOpponent,
  TOTAL_PLAYERS,
  estimatedPlacement,
  generateLadderOpponent,
  ladderCoins,
  leaderboard,
  rankOf,
} from '../../game/ladder';
import { type Profile, setActiveDeck } from '../../game/profile';

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching'; opp: LadderOpponent; wait: number; started: number }
  | { kind: 'found'; opp: LadderOpponent; at: number };

/** 找到對手後自動開始的倒數秒數 */
const ACCEPT_SECONDS = 5;

export function RankBadge({ rating, big }: { rating: number; big?: boolean }) {
  const r = rankOf(rating);
  return (
    <span className={`rank-badge ${big ? 'big' : ''}`} style={{ borderColor: r.tier.color, color: r.tier.color }}>
      {r.tier.icon} {r.label}
    </span>
  );
}

export function LadderScreen({ profile, onStart }: { profile: Profile; onStart: (o: LadderOpponent) => void }) {
  const deck = profile.decks.find((d) => d.id === profile.activeDeckId) ?? profile.decks[0];
  const errors = validateDeck(deck, profile.collection);
  const ladder = profile.ladder;
  const rank = rankOf(ladder.rating);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [now, setNow] = useState(Date.now());
  const board = useMemo(() => leaderboard(), []);

  useEffect(() => {
    if (phase.kind === 'idle') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase.kind]);

  // 搜尋時間到了就「配對成功」，接受倒數結束就開始
  useEffect(() => {
    if (phase.kind === 'searching' && now - phase.started >= phase.wait) setPhase({ kind: 'found', opp: phase.opp, at: Date.now() });
    if (phase.kind === 'found' && now - phase.at >= ACCEPT_SECONDS * 1000) onStart(phase.opp);
  }, [now, phase, onStart]);

  const search = () => {
    const opp = generateLadderOpponent(ladder.rating);
    // 段位越高，玩家越少，等比較久
    const wait = 1500 + Math.random() * 3000 + rank.tierIndex * 600;
    const t = Date.now();
    setNow(t);
    setPhase({ kind: 'searching', opp, wait, started: t });
  };

  const games = ladder.wins + ladder.losses + ladder.draws;
  const placement = estimatedPlacement(ladder.rating);
  const myEntry = { name: profile.playerName, avatar: '⭐', rating: ladder.rating, me: true };
  const top = [...board, ...(ladder.rating >= board[board.length - 1].rating ? [myEntry] : [])]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10);

  return (
    <div className="screen ladder-screen">
      <div className="ladder-top">
        <div className="ladder-rank" style={{ borderColor: rank.tier.color }}>
          <div className="ladder-rank-icon">{rank.tier.icon}</div>
          <div className="ladder-rank-name" style={{ color: rank.tier.color }}>
            {rank.label}
          </div>
          <div className="ladder-rating">積分 {ladder.rating}</div>
          {rank.progress !== null && (
            <div className="ladder-progress">
              <div style={{ width: `${Math.round(rank.progress * 100)}%`, background: rank.tier.color }} />
            </div>
          )}
          {rank.next !== null && <div className="hint">再 {rank.next - ladder.rating} 分晉級</div>}
        </div>
        <div className="ladder-stats">
          <div>
            戰績：<b>{ladder.wins}</b> 勝 <b>{ladder.losses}</b> 敗{ladder.draws ? ` ${ladder.draws} 和` : ''}
            {games > 0 && <span className="hint">（勝率 {Math.round((ladder.wins / games) * 100)}%）</span>}
          </div>
          <div>
            {ladder.streak >= 2 && <span className="streak hot">🔥 {ladder.streak} 連勝中</span>}
            {ladder.streak <= -2 && <span className="streak cold">🥶 {-ladder.streak} 連敗中</span>}
          </div>
          <div>
            最高紀錄：
            <RankBadge rating={ladder.peak} />
          </div>
          <div>
            全服排名：第 <b>{placement.toLocaleString()}</b> 名 <span className="hint">/ {TOTAL_PLAYERS.toLocaleString()} 人</span>
          </div>
          <div className="hint">
            勝利獎勵 🪙 {ladderCoins(ladder.rating, 'win')}，輸了也有 🪙 {ladderCoins(ladder.rating, 'loss')}
          </div>
        </div>
      </div>

      <div className="deck-picker">
        <span>使用牌組：</span>
        <select value={deck.id} disabled={phase.kind !== 'idle'} onChange={(e) => setActiveDeck(e.target.value)}>
          {profile.decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}（{d.main.length}＋{d.extra.length}）
            </option>
          ))}
        </select>
        {errors.length > 0 && <span className="error">牌組不合法：{errors[0]}</span>}
      </div>

      <div className="ladder-match">
        {phase.kind === 'idle' && (
          <button className="btn primary big" disabled={errors.length > 0} onClick={search}>
            ⚔️ 開始配對
          </button>
        )}
        {phase.kind === 'searching' && (
          <div className="matching">
            <div className="matching-spinner" />
            <div>正在尋找對手⋯⋯ {Math.floor((now - phase.started) / 1000)} 秒</div>
            <div className="hint">
              配對範圍：{rankOf(Math.max(0, ladder.rating - 100)).label} ～ {rankOf(ladder.rating + 100).label}
            </div>
            <button className="btn" onClick={() => setPhase({ kind: 'idle' })}>
              取消
            </button>
          </div>
        )}
        {phase.kind === 'found' && (
          <div className="match-found">
            <div className="match-title">配對成功！</div>
            <div className="match-vs">
              <div className="match-side">
                <div className="opp-avatar">⭐</div>
                <div className="opp-name">{profile.playerName}</div>
                <RankBadge rating={ladder.rating} />
              </div>
              <div className="vs">VS</div>
              <div className="match-side">
                <div className="opp-avatar">{phase.opp.avatar}</div>
                <div className="opp-name">{phase.opp.name}</div>
                <RankBadge rating={phase.opp.rating} />
              </div>
            </div>
            <div className="chat-bubble">
              {phase.opp.name}：{phase.opp.greeting}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onStart(phase.opp)}>
                開始決鬥（{Math.max(0, ACCEPT_SECONDS - Math.floor((now - phase.at) / 1000))}）
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="ladder-columns">
        <div className="ladder-panel">
          <h3>最近對戰</h3>
          {ladder.history.length === 0 && <div className="hint">還沒有天梯對戰紀錄</div>}
          {ladder.history.map((h, i) => (
            <div key={i} className={`ladder-row ${h.result}`}>
              <span className="res">{h.result === 'win' ? '勝' : h.result === 'loss' ? '敗' : '和'}</span>
              <span className="who">
                {h.avatar} {h.name} <RankBadge rating={h.oppRating} />
              </span>
              <span className="deck-name" title={DECK_STYLE_NAMES[h.deckStyle]}>
                {h.deckName}
              </span>
              <span className={`delta ${h.delta >= 0 ? 'up' : 'down'}`}>
                {h.delta >= 0 ? '+' : ''}
                {h.delta}
              </span>
            </div>
          ))}
        </div>
        <div className="ladder-panel">
          <h3>排行榜</h3>
          {top.map((e, i) => (
            <div key={i} className={`ladder-row ${'me' in e ? 'me' : ''}`}>
              <span className="res">#{i + 1}</span>
              <span className="who">
                {e.avatar} {e.name}
              </span>
              <RankBadge rating={e.rating} />
              <span className="delta">{e.rating}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
