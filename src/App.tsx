import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, Settings, XCircle, Trophy, Plus, Trash2, Minus, Zap, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, Grade, MatchEvent, Player, PointReason, Role, Skill, TeamSide, GRADE_LABEL, SKILL_LABEL, ROLE_LABEL, POINT_REASONS } from './types';
import {
  autoPointFor, calculateStats, currentSetNumber, formatMatchDate, getSetLimit, isSetWon,
  playerLabel, scoreForSet, SETS_TO_WIN, formatValue, detectTrends,
} from './utils';
import TrackingView from './TrackingView';
import ReportView from './ReportView';

const MATCH_KEY = 'indoorstats_match';
const ROSTER_KEY = 'indoorstats_roster';

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const DEFAULT_ROLES: [Role, boolean][] = [
  ['setter', true], ['hitter', true], ['hitter', true], ['hitter', true], ['hitter', true], ['hitter', true], ['libero', true],
  ['setter', false], ['hitter', false], ['hitter', false], ['hitter', false], ['hitter', false], ['hitter', false], ['libero', false],
];

const defaultRoster = (): Player[] =>
  DEFAULT_ROLES.map(([role, onCourt]) => ({ id: uid('p'), name: '', number: '', role, onCourt }));

function freshState(players: Player[]): GameState {
  return {
    players,
    events: [],
    setHistory: [],
    sets: { own: 0, opponent: 0 },
    matchDate: new Date().toISOString(),
    opponentName: '',
    autoScore: true,
    subLimit: 8,
  };
}

const ROSTER_SIZE = 14;

// Older saves may have fewer slots: top up to 14 with bench hitters
function padRoster(players: Player[]): Player[] {
  const extra = Math.max(0, ROSTER_SIZE - players.length);
  return [...players, ...Array.from({ length: extra }, () => ({ id: uid('p'), name: '', number: '', role: 'hitter' as Role, onCourt: false }))];
}

function loadState(): GameState {
  try {
    const saved = localStorage.getItem(MATCH_KEY);
    if (saved) {
      const s: GameState = { ...freshState(defaultRoster()), ...JSON.parse(saved) };
      return { ...s, players: padRoster(s.players) };
    }
    const roster = localStorage.getItem(ROSTER_KEY);
    if (roster) return freshState(padRoster(JSON.parse(roster)));
  } catch { /* ignore */ }
  return freshState(defaultRoster());
}

type ConfirmState = { message: string; confirmLabel: string; onConfirm: () => void } | null;

export default function App() {
  const [gameState, setGameState] = useState<GameState>(loadState);
  const [view, setView] = useState<'track' | 'report'>('track');
  const [showConfig, setShowConfig] = useState(() => gameState.events.length === 0);
  const [setEndWinner, setSetEndWinner] = useState<TeamSide | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showTrends, setShowTrends] = useState(false);
  const feedbackTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(MATCH_KEY, JSON.stringify(gameState));
      localStorage.setItem(ROSTER_KEY, JSON.stringify(gameState.players));
    } catch { /* ignore */ }
  }, [gameState]);

  const setNum = currentSetNumber(gameState);
  const setLimit = getSetLimit(setNum);
  const score = useMemo(() => scoreForSet(gameState.events, setNum), [gameState.events, setNum]);
  const matchOver = gameState.sets.own >= SETS_TO_WIN || gameState.sets.opponent >= SETS_TO_WIN;
  const currentSetEvents = gameState.events.filter(e => e.set === setNum);
  const trends = useMemo(() => detectTrends(gameState), [gameState]);

  // Set end detection
  useEffect(() => {
    if (!matchOver && isSetWon(score, setNum)) {
      setSetEndWinner(score.own > score.opponent ? 'own' : 'opponent');
    } else {
      setSetEndWinner(null);
    }
  }, [score, setNum, matchOver]);

  const flash = (msg: string) => {
    setFeedback(msg);
    window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 1200);
  };

  const pushEvent = (e: MatchEvent) => setGameState(prev => ({ ...prev, events: [...prev.events, e] }));

  const handleStat = (playerId: string, skill: Skill, grade: Grade) => {
    const point = gameState.autoScore ? autoPointFor(skill, grade) : null;
    pushEvent({ kind: 'stat', id: uid('e'), set: setNum, playerId, skill, grade, point, timestamp: Date.now() });
    const p = gameState.players.find(pp => pp.id === playerId);
    const idx = gameState.players.findIndex(pp => pp.id === playerId);
    flash(`${p ? playerLabel(p, idx) : ''} · ${SKILL_LABEL[skill]} ${GRADE_LABEL[grade]}${point ? (point === 'own' ? ' · +1 us' : ' · +1 them') : ''}`);
  };

  const handlePoint = (team: TeamSide, reason: PointReason = 'other') => {
    pushEvent({ kind: 'point', id: uid('e'), set: setNum, team, reason, timestamp: Date.now() });
    const label = POINT_REASONS.find(r => r.reason === reason)?.label;
    flash(`${label ? label + ' · ' : ''}${team === 'own' ? '+1 us' : '+1 them'}`);
  };

  // Incoming player takes the outgoing player's slot
  const swapPlayers = (players: Player[], inId: string, outId: string): Player[] => {
    const next = players.map(p => ({ ...p }));
    const a = next.findIndex(p => p.id === inId);
    const b = next.findIndex(p => p.id === outId);
    if (a < 0 || b < 0) return players;
    const inOnCourt = next[a].onCourt;
    next[a].onCourt = next[b].onCourt;
    next[b].onCourt = inOnCourt;
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  };

  const handleSub = (inId: string, outId: string) => {
    const inP = gameState.players.find(p => p.id === inId);
    const outP = gameState.players.find(p => p.id === outId);
    if (!inP || !outP) return;
    const counts = inP.role !== 'libero' && outP.role !== 'libero';
    setGameState(prev => ({
      ...prev,
      players: swapPlayers(prev.players, inId, outId),
      events: [...prev.events, { kind: 'sub', id: uid('e'), set: setNum, inId, outId, counts, timestamp: Date.now() }],
    }));
    flash(`${playerLabel(inP)} in · ${playerLabel(outP)} out`);
  };

  const handleUndo = () => {
    setGameState(prev => {
      const s = currentSetNumber(prev);
      let lastIdx = -1;
      for (let i = prev.events.length - 1; i >= 0; i--) {
        if (prev.events[i].set === s) { lastIdx = i; break; }
      }
      if (lastIdx < 0) return prev;
      const last = prev.events[lastIdx];
      const events = prev.events.filter((_, i) => i !== lastIdx);
      const players = last.kind === 'sub' ? swapPlayers(prev.players, last.outId, last.inId) : prev.players;
      return { ...prev, events, players };
    });
    flash('Undone');
  };

  const closeSet = (winner: TeamSide) => {
    setGameState(prev => {
      const s = currentSetNumber(prev);
      const sc = scoreForSet(prev.events, s);
      const sets = { ...prev.sets, [winner]: prev.sets[winner] + 1 };
      return { ...prev, sets, setHistory: [...prev.setHistory, sc] };
    });
    setSetEndWinner(null);
    const newWins = gameState.sets[winner] + 1;
    if (newWins >= SETS_TO_WIN) setTimeout(() => setView('report'), 300);
  };

  const manualEndSet = () => {
    if (score.own === score.opponent) {
      setConfirmState({ message: `Score is tied ${score.own}:${score.opponent}. Add the last point first.`, confirmLabel: 'OK', onConfirm: () => {} });
      return;
    }
    const winner: TeamSide = score.own > score.opponent ? 'own' : 'opponent';
    setConfirmState({
      message: `End set ${setNum} at ${score.own}:${score.opponent}? Indoor sets go to ${setLimit}, win by 2.`,
      confirmLabel: 'End Set',
      onConfirm: () => closeSet(winner),
    });
  };

  const newMatch = () => {
    setConfirmState({
      message: 'Start a new match? All stats from this match will be cleared. Your roster stays.',
      confirmLabel: 'New Match',
      onConfirm: () => {
        setGameState(prev => ({
          ...freshState(prev.players),
          autoScore: prev.autoScore,
          subLimit: prev.subLimit,
        }));
        setView('track');
        setShowConfig(true);
      },
    });
  };

  const handleExport = () => {
    const st = calculateStats(gameState, null);
    const date = formatMatchDate(gameState.matchDate);
    const opp = gameState.opponentName || 'Opponent';
    let csv = `Match Date: ${date}\nOpponent: ${opp}\nSets: ${gameState.sets.own} - ${gameState.sets.opponent}\n`;
    if (gameState.setHistory.length) {
      csv += `Set Scores: ${gameState.setHistory.map((s, i) => `Set${i + 1} ${s.own}-${s.opponent}`).join(', ')}\n`;
    }
    csv += `\nPlayer,Role,Serve -,Serve 0,Serve #,Serve Avg,Attack -,Attack 0,Attack #,Attack Eff,Pass -,Pass 0,Pass #,Pass Avg\n`;
    const line = (label: string, role: string, s: typeof st.team) =>
      `${label},${role},${s.serve.minus},${s.serve.zero},${s.serve.plus},${formatValue('serve', s.serve.value)},` +
      `${s.attack.minus},${s.attack.zero},${s.attack.plus},${formatValue('attack', s.attack.value)},` +
      `${s.pass.minus},${s.pass.zero},${s.pass.plus},${formatValue('pass', s.pass.value)}\n`;
    st.players.forEach(ps => {
      const idx = gameState.players.findIndex(p => p.id === ps.player.id);
      csv += line(playerLabel(ps.player, idx), ROLE_LABEL[ps.player.role], ps);
    });
    csv += line('TEAM', '', st.team);
    const o = st.opponent;
    csv += `\nOPPONENT\nAttack points,${o.opp_attack_point}\nAces,${o.opp_ace}\nAttack mistakes,${o.opp_attack_error}\nService mistakes,${o.opp_serve_error}\nOther points us,${o.other_us}\nOther points them,${o.other_them}\n`;
    const subject = encodeURIComponent(`IndoorStats Match Report - vs ${opp} - ${date}`);
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(csv)}`;
  };

  // Roster editing
  const updatePlayer = (id: string, patch: Partial<Player>) =>
    setGameState(prev => ({ ...prev, players: prev.players.map(p => (p.id === id ? { ...p, ...patch } : p)) }));
  const addPlayer = () =>
    setGameState(prev => ({ ...prev, players: [...prev.players, { id: uid('p'), name: '', number: '', role: 'hitter', onCourt: false }] }));
  const removePlayer = (id: string) => {
    const hasStats = gameState.events.some(e => (e.kind === 'stat' && e.playerId === id) || (e.kind === 'sub' && (e.inId === id || e.outId === id)));
    const doRemove = () => setGameState(prev => ({ ...prev, players: prev.players.filter(p => p.id !== id) }));
    if (hasStats) {
      setConfirmState({ message: 'This player has stats in the current match. Remove anyway? Their stats will drop out of the report.', confirmLabel: 'Remove', onConfirm: doRemove });
    } else doRemove();
  };

  const onCourtCount = gameState.players.filter(p => p.onCourt).length;

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col font-sans selection:bg-primary selection:text-black">
      {/* HEADER */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-3 sm:py-5 border-b border-white/10 bg-surface sticky top-0 z-50">
        <div className="bg-primary text-black font-black px-2 py-0.5 rounded text-sm sm:text-lg uppercase tracking-tighter">INDOORSTATS</div>
        <div className="flex items-center gap-4 sm:gap-8">
          <div className="text-center">
            <div className="text-[9px] text-white/40 uppercase tracking-widest">Set {matchOver ? '–' : setNum} <span className="text-white/20">to {setLimit}</span></div>
            <div className="text-3xl sm:text-4xl font-black tracking-tighter tabular-nums leading-none">
              {score.own} <span className="text-white/20 text-lg">:</span> {score.opponent}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-white/40 uppercase tracking-widest">Sets</div>
            <div className="text-xl sm:text-2xl font-black italic text-primary leading-none">{gameState.sets.own}-{gameState.sets.opponent}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trends.length > 0 && (
            <button onClick={() => setShowTrends(true)} aria-label="Live trends"
              className="relative p-2.5 bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10">
              <Zap className="w-4 h-4 text-primary" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-black text-[9px] font-black rounded-full flex items-center justify-center">
                {trends.length}
              </span>
            </button>
          )}
          <button onClick={() => setView(view === 'track' ? 'report' : 'track')} aria-label="Toggle report"
            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10">
            {view === 'track' ? <BarChart3 className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowConfig(true)} aria-label="Roster and settings"
            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {view === 'track' ? (
          <div className="flex-1 flex flex-col bg-surface min-h-0 max-w-5xl w-full mx-auto">
            {matchOver && (
              <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs font-bold uppercase text-center">
                Match over · {gameState.sets.own}-{gameState.sets.opponent}. Check the report or start a new match.
              </div>
            )}
            <TrackingView
              gameState={gameState}
              onStat={handleStat}
              onPoint={handlePoint}
              onSub={handleSub}
              onUndo={handleUndo}
              canUndo={currentSetEvents.length > 0}
              feedback={feedback}
            />
          </div>
        ) : (
          <div className="flex-1 bg-surface overflow-y-auto">
            <ReportView gameState={gameState} onExport={handleExport} onReset={newMatch} />
          </div>
        )}
      </main>

      {/* BOTTOM BAR */}
      {view === 'track' && (
        <div className="sticky bottom-0 z-40 bg-surface/95 backdrop-blur-xl border-t border-white/10 px-4 py-2 flex items-center gap-2 safe-bottom">
          <button onClick={manualEndSet} disabled={matchOver}
            className="flex-1 py-3 bg-white/10 text-white font-bold uppercase text-[10px] tracking-wider rounded-xl active:scale-95 transition-all border border-white/10 disabled:opacity-30">
            End Set
          </button>
          <button onClick={() => setView('report')}
            className="flex-1 py-3 bg-primary text-black font-black uppercase text-[10px] tracking-wider rounded-xl active:scale-95 transition-all">
            Report
          </button>
        </div>
      )}

      {/* SET END MODAL */}
      <AnimatePresence>
        {setEndWinner && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface border border-white/10 p-8 rounded-3xl w-full max-w-sm text-center space-y-6">
              <Trophy className="w-12 h-12 text-primary mx-auto" />
              <div>
                <h3 className="text-2xl font-black italic uppercase tracking-tight">Set {setNum} Over!</h3>
                <p className="text-sm text-white/50 mt-1">{score.own} - {score.opponent}</p>
                <p className={`text-lg font-black italic uppercase mt-2 ${setEndWinner === 'own' ? 'text-primary' : 'text-secondary'}`}>
                  {setEndWinner === 'own' ? 'My Team' : (gameState.opponentName || 'Opponent')} wins the set!
                </p>
              </div>
              <div className="space-y-2">
                <button onClick={() => closeSet(setEndWinner)}
                  className="w-full py-4 bg-primary text-black font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all">
                  {gameState.sets[setEndWinner] + 1 >= SETS_TO_WIN ? 'Finish Match' : 'Next Set'}
                </button>
                <button onClick={handleUndo}
                  className="w-full py-3 text-white/50 font-bold uppercase tracking-widest text-[10px] rounded-2xl border border-white/10 active:scale-95 transition-all">
                  Undo last point
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TRENDS MODAL */}
      <AnimatePresence>
        {showTrends && (
          <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xl" onClick={() => setShowTrends(false)}>
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-surface border border-white/10 p-6 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl max-h-[80dvh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-black italic uppercase tracking-tight">Live Trends</h3>
                </div>
                <button onClick={() => setShowTrends(false)} className="p-2 hover:bg-white/10 rounded-full"><X className="w-5 h-5" /></button>
              </div>
              {trends.length === 0 ? (
                <div className="text-center py-12 opacity-30 text-sm">No trends right now. Keep tracking!</div>
              ) : (
                <div className="space-y-2">
                  {trends.map((t, i) => (
                    <div key={i} className={`p-3 rounded-xl border ${
                      t.tone === 'alert' ? 'bg-secondary/20 text-secondary border-secondary/30' :
                      t.tone === 'warning' ? 'bg-accent/20 text-accent border-accent/30' :
                      'bg-primary/20 text-primary border-primary/30'
                    }`}>
                      <div className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-0.5">{t.group}</div>
                      <div className="text-xs font-bold uppercase leading-tight">{t.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CONFIRM MODAL */}
      <AnimatePresence>
        {confirmState && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface border border-white/10 p-6 rounded-3xl w-full max-w-sm space-y-5">
              <p className="text-sm text-white/80">{confirmState.message}</p>
              <div className="flex gap-2">
                {confirmState.confirmLabel !== 'OK' && (
                  <button onClick={() => setConfirmState(null)}
                    className="flex-1 py-3 border border-white/10 text-white/60 font-bold uppercase text-[10px] tracking-widest rounded-xl">Cancel</button>
                )}
                <button onClick={() => { confirmState.onConfirm(); setConfirmState(null); }}
                  className="flex-1 py-3 bg-primary text-black font-black uppercase text-[10px] tracking-widest rounded-xl">{confirmState.confirmLabel}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ROSTER MODAL */}
      <AnimatePresence>
        {showConfig && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xl">
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
              className="bg-surface border border-white/10 p-5 sm:p-8 rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl space-y-6 max-h-[92dvh] overflow-y-auto">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter text-primary">Roster</h3>
                  <p className="text-[10px] opacity-50 uppercase tracking-widest mt-1 font-mono">
                    {onCourtCount} on court · {gameState.players.length - onCourtCount} bench
                  </p>
                </div>
                <button onClick={() => setShowConfig(false)} className="p-2 hover:bg-white/10 rounded-full"><XCircle className="w-6 h-6" /></button>
              </div>

              <input type="text" value={gameState.opponentName}
                onChange={e => setGameState(prev => ({ ...prev, opponentName: e.target.value }))}
                placeholder="Opponent name (optional)"
                className="w-full bg-white/5 border-2 border-white/10 focus:border-secondary p-3 rounded-xl outline-none font-bold uppercase text-sm" />

              <div className="space-y-2">
                {gameState.players.map((p, idx) => (
                  <div key={p.id} className={`rounded-xl border p-2 space-y-2 ${p.onCourt ? 'border-primary/30 bg-primary/5' : 'border-white/10 bg-white/[0.02]'}`}>
                    <div className="flex gap-2">
                      <input type="text" inputMode="numeric" value={p.number} maxLength={3}
                        onChange={e => updatePlayer(p.id, { number: e.target.value.replace(/[^0-9]/g, '') })}
                        placeholder="#" aria-label="Jersey number"
                        className="w-12 bg-white/5 border border-white/10 focus:border-primary p-2 rounded-lg outline-none font-mono font-bold text-center text-sm" />
                      <input type="text" value={p.name}
                        onChange={e => updatePlayer(p.id, { name: e.target.value })}
                        placeholder={`Player ${idx + 1}`} aria-label="Player name"
                        className="flex-1 min-w-0 bg-white/5 border border-white/10 focus:border-primary p-2 rounded-lg outline-none font-bold uppercase text-sm" />
                      <button onClick={() => removePlayer(p.id)} aria-label="Remove player"
                        className="p-2 text-white/30 hover:text-danger rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 flex gap-1 p-0.5 bg-white/5 rounded-lg">
                        {(['hitter', 'setter', 'libero'] as Role[]).map(r => (
                          <button key={r} onClick={() => updatePlayer(p.id, { role: r })}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${p.role === r ? 'bg-white text-black' : 'text-white/40'}`}>
                            {ROLE_LABEL[r]}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => updatePlayer(p.id, { onCourt: !p.onCourt })}
                        className={`px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${p.onCourt ? 'bg-primary text-black border-primary' : 'text-white/40 border-white/10'}`}>
                        {p.onCourt ? 'Court' : 'Bench'}
                      </button>
                    </div>
                  </div>
                ))}
                <button onClick={addPlayer}
                  className="w-full py-3 border border-dashed border-white/15 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white/50 flex items-center justify-center gap-1.5">
                  <Plus className="w-3 h-3" /> Add Player
                </button>
              </div>

              <div className="space-y-3 border-t border-white/5 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-white/60">Subs per set</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setGameState(prev => ({ ...prev, subLimit: Math.max(0, prev.subLimit - 1) }))} className="p-1.5 border border-white/10 rounded-lg"><Minus className="w-3 h-3" /></button>
                    <span className="w-6 text-center font-mono font-bold">{gameState.subLimit}</span>
                    <button onClick={() => setGameState(prev => ({ ...prev, subLimit: prev.subLimit + 1 }))} className="p-1.5 border border-white/10 rounded-lg"><Plus className="w-3 h-3" /></button>
                  </div>
                </div>
                <button onClick={() => setGameState(prev => ({ ...prev, autoScore: !prev.autoScore }))}
                  className="w-full flex items-center justify-between text-left">
                  <span>
                    <span className="block text-xs font-bold uppercase tracking-wider text-white/60">Auto-score from stats</span>
                    <span className="block text-[10px] text-white/30 mt-0.5">Serve # / attack # = point us. Serve − / attack − = point them.</span>
                  </span>
                  <span className={`shrink-0 ml-3 w-10 h-6 rounded-full p-0.5 transition-all ${gameState.autoScore ? 'bg-success' : 'bg-white/15'}`}>
                    <span className={`block w-5 h-5 rounded-full bg-white transition-all ${gameState.autoScore ? 'translate-x-4' : ''}`} />
                  </span>
                </button>
              </div>

              <div className="space-y-3 pt-2">
                <button onClick={() => setShowConfig(false)}
                  className="w-full p-4 bg-primary text-black rounded-2xl font-black uppercase text-xs tracking-widest active:scale-95 transition-all">
                  Save & Start
                </button>
                <button onClick={newMatch}
                  className="w-full p-3 bg-danger/10 text-danger border border-danger/20 rounded-2xl font-bold uppercase text-[10px] tracking-widest active:scale-95 transition-all">
                  New Match (clear stats)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
