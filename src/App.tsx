import { useEffect, useMemo, useState } from 'react';
import { XCircle, Trophy, Plus, Trash2, Minus, Maximize } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, MatchEvent, PendingRally, Player, Role, TeamSide, ROLE_LABEL, ROLE_SHORT, ROLES, SetLineup, TIMEOUTS_PER_SET } from './types';
import {
  calculateStats, currentSetNumber, formatMatchDate, getSetLimit, isSetWon,
  playerLabel, scoreForSet, SETS_TO_WIN, formatValue, rotationTable, statsByPosition,
} from './utils';
import RallyView from './RallyView';
import ReportView from './ReportView';
import { courtState, defaultLineup } from './court';
import { LineupSheet } from './Lineup';
import { attackByPhase, attackByRotation, historyLog, passRows, serveRows } from './analysis';

const MATCH_KEY = 'indoorstats_match';
const ROSTER_KEY = 'indoorstats_roster';

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// First 6 fill P1..P6 of the default lineup (S, OH, MB, OPP, OH, MB), then libero, then bench
const DEFAULT_ROLES: [Role, boolean][] = [
  ['setter', true], ['outside', true], ['middle', true], ['opposite', true], ['outside', true], ['middle', true], ['libero', true],
  ['setter', false], ['outside', false], ['middle', false], ['opposite', false], ['outside', false], ['middle', false], ['libero', false],
];

const defaultRoster = (): Player[] =>
  DEFAULT_ROLES.map(([role, onCourt], i) => ({ id: uid('p'), name: '', number: '', role, onCourt, slot: i + 1 }));

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
    pending: null,
    lineups: {},
    templateLineup: null,
  };
}

const ROSTER_SIZE = 14;

// Older saves may have fewer slots: top up to 14 with bench hitters
function padRoster(players: Player[]): Player[] {
  const withSlots = players.map((p, i) => ({ ...p, slot: p.slot ?? i + 1 }));
  const extra = Math.max(0, ROSTER_SIZE - players.length);
  return [...withSlots, ...Array.from({ length: extra }, (_, k) => ({ id: uid('p'), name: '', number: '', role: 'outside' as Role, onCourt: false, slot: players.length + k + 1 }))];
}

// Pre-rotation saves used a single 'hitter' role
const migrateRoles = (players: Player[]): Player[] =>
  players.map(p => ((p.role as string) === 'hitter' ? { ...p, role: 'outside' as Role } : p));

function loadState(): GameState {
  try {
    const saved = localStorage.getItem(MATCH_KEY);
    if (saved) {
      const s: GameState = { ...freshState(defaultRoster()), ...JSON.parse(saved) };
      return { ...s, players: padRoster(migrateRoles(s.players)), lineups: s.lineups ?? {} };
    }
    const roster = localStorage.getItem(ROSTER_KEY);
    if (roster) return freshState(padRoster(migrateRoles(JSON.parse(roster))));
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
  const [showLineup, setShowLineup] = useState(false);

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
  const court = useMemo(() => courtState(gameState, setNum), [gameState, setNum]);
  const needsLineup = !court.hasLineup && !matchOver;

  // New set without a lineup: open the lineup screen (after the roster is closed)
  useEffect(() => {
    if (needsLineup && !showConfig && view === 'track') setShowLineup(true);
  }, [needsLineup, showConfig, view]);

  const saveLineup = (lineup: SetLineup) => {
    setGameState(prev => ({ ...prev, lineups: { ...prev.lineups, [setNum]: lineup }, templateLineup: lineup, pending: null }));
    setShowLineup(false);
    flash(`Set ${setNum} lineup saved`);
  };

  const timeoutsUsed = (team: TeamSide) => currentSetEvents.filter(e => e.kind === 'timeout' && e.team === team).length;
  const callTimeout = (team: TeamSide) => {
    if (matchOver || timeoutsUsed(team) >= TIMEOUTS_PER_SET) return;
    pushEvent({ kind: 'timeout', id: uid('e'), set: setNum, team, timestamp: Date.now() });
  };

  const rotateCourt = (delta: number) => {
    pushEvent({ kind: 'rotate', id: uid('e'), set: setNum, delta, timestamp: Date.now() });
    flash(delta > 0 ? 'Rotated forward' : 'Rotated back');
  };

  // Set end detection
  useEffect(() => {
    if (!matchOver && isSetWon(score, setNum)) {
      setSetEndWinner(score.own > score.opponent ? 'own' : 'opponent');
    } else {
      setSetEndWinner(null);
    }
  }, [score, setNum, matchOver]);

  // No pop-up notifications during play (kept as a hook in case a quiet status line comes back)
  const flash = (_msg: string) => {};

  const pushEvent = (e: MatchEvent) => setGameState(prev => ({ ...prev, events: [...prev.events, e] }));

  const handleSub = (inId: string, outId: string) => {
    const inP = gameState.players.find(p => p.id === inId);
    const outP = gameState.players.find(p => p.id === outId);
    if (!inP || !outP) return;
    const counts = inP.role !== 'libero' && outP.role !== 'libero';
    // Incoming player takes the outgoing player's court position (see court.ts replay)
    setGameState(prev => ({
      ...prev,
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
      const lastEv = lastIdx >= 0 ? prev.events[lastIdx] : null;
      const sideEvent = !!lastEv && (lastEv.kind === 'sub' || lastEv.kind === 'rotate' || lastEv.kind === 'timeout');
      // Step back inside the rally in progress, unless a timeout/sub/rotation happened after its last step
      const p = prev.pending && prev.pending.set === s ? prev.pending : null;
      if (p && p.history.length > 0 && !(sideEvent && lastEv!.timestamp > (p.lastAt ?? 0))) {
        const h = p.history[p.history.length - 1];
        return { ...prev, pending: { ...p, step: h.step, actions: p.actions.slice(0, h.actionCount), trail: (p.trail ?? []).slice(0, h.trailCount ?? 0), history: p.history.slice(0, -1) } };
      }
      if (lastIdx < 0) {
        if (p) return { ...prev, pending: null };
        // Nothing played yet: undo the first-serve choice so it can be picked again
        const lu = prev.lineups?.[s];
        return lu?.firstServe ? { ...prev, lineups: { ...prev.lineups, [s]: { ...lu, firstServe: null } } } : prev;
      }
      const last = prev.events[lastIdx];
      // A whole rally comes off together
      const events = last.rallyId
        ? prev.events.filter(e => e.rallyId !== last.rallyId)
        : prev.events.filter((_, i) => i !== lastIdx);
      const keepPending = last.kind === 'sub' || last.kind === 'rotate' || last.kind === 'timeout';
      return { ...prev, events, pending: keepPending ? prev.pending : null };
    });
    flash('Undone');
  };

  const commitRally = (events: MatchEvent[], message: string) => {
    setGameState(prev => ({ ...prev, events: [...prev.events, ...events], pending: null }));
    flash(message);
  };

  const setPending = (pending: PendingRally | null) => setGameState(prev => ({ ...prev, pending }));

  const closeSet = (winner: TeamSide) => {
    setGameState(prev => {
      const s = currentSetNumber(prev);
      const sc = scoreForSet(prev.events, s);
      const sets = { ...prev.sets, [winner]: prev.sets[winner] + 1 };
      return { ...prev, sets, setHistory: [...prev.setHistory, sc], pending: null, templateLineup: prev.lineups[s] ?? prev.templateLineup };
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
          templateLineup: prev.lineups[1] ?? prev.templateLineup ?? null,
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
    csv += `\nPlayer,Role,Serve -,Serve 0,Serve #,Serve Eff,Attack -,Attack 0,Attack #,Attack Recycles,Attack Eff,Pass -,Pass 0,Pass #,Pass Eff,Set Attempts,Assists,Assist %\n`;
    const line = (label: string, role: string, s: typeof st.team) =>
      `${label},${role},${s.serve.minus},${s.serve.zero},${s.serve.plus},${formatValue('serve', s.serve.value)},` +
      `${s.attack.minus},${s.attack.zero - s.attack.recycle},${s.attack.plus},${s.attack.recycle},${formatValue('attack', s.attack.value)},` +
      `${s.pass.minus},${s.pass.zero},${s.pass.plus},${formatValue('pass', s.pass.value)},` +
      `${s.set.total},${s.set.plus},${formatValue('set', s.set.value)}\n`;
    st.players.forEach(ps => {
      const idx = gameState.players.findIndex(p => p.id === ps.player.id);
      csv += line(playerLabel(ps.player, idx), ROLE_LABEL[ps.player.role], ps);
    });
    csv += line('TEAM', '', st.team);
    csv += `\nBY ROTATION\nRotation,Won,Lost,Side-out won,Side-out total,Break won,Break total\n`;
    rotationTable(gameState, null).forEach(r => { csv += `R${r.rotation},${r.won},${r.lost},${r.soWon},${r.soTotal},${r.bpWon},${r.bpTotal}\n`; });
    csv += `\nBY POSITION\nPlayer,Position,Serve Eff,Serve n,Attack Eff,Attack n,Pass Eff,Pass n\n`;
    gameState.players.forEach((pl, idx) => {
      const bp = statsByPosition(gameState, pl.id, null);
      Object.keys(bp).map(Number).sort().forEach(pos => {
        const b = bp[pos];
        csv += `${playerLabel(pl, idx)},P${pos},${formatValue('serve', b.serve.value)},${b.serve.total},${formatValue('attack', b.attack.value)},${b.attack.total},${formatValue('pass', b.pass.value)},${b.pass.total}\n`;
      });
    });
    const o = st.opponent;
    csv += `\nOPPONENT\nAttack points,${o.opp_attack_point}\nAces,${o.opp_ace}\nAttack mistakes,${o.opp_attack_error}\nService mistakes,${o.opp_serve_error}\nOur blocks,${o.opp_blocked}\nOur unforced errors,${o.own_error}\nOther points us,${o.other_us}\nOther points them,${o.other_them}\n`;
    const p100 = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`);
    csv += `\nPASSING (scale)\nPlayer,N,=,/,-,!,+,#,Positive %,Perfect %,Error %\n`;
    passRows(gameState, null).forEach(r => { const c = r.counts; csv += `${r.name},${r.n},${c['=']},${c['/']},${c['-']},${c['!']},${c['+']},${c['#']},${p100((c['#'] + c['+']) / r.n)},${p100(c['#'] / r.n)},${p100(c['='] / r.n)}\n`; });
    csv += `\nSERVING (scale)\nPlayer,N,=,-,!,+,/,#,Pressure %\n`;
    serveRows(gameState, null).forEach(r => { const c = r.counts; csv += `${r.name},${r.n},${c['=']},${c['-']},${c['!']},${c['+']},${c['/']},${c['#']},${p100((c['#'] + c['+'] + c['/']) / r.n)}\n`; });
    csv += `\nATTACK BY ROTATION (eff / attempts)\nPlayer,R1,R2,R3,R4,R5,R6,All\n`;
    attackByRotation(gameState, null).rows.forEach(r => { csv += `${r.name},${r.byRot.map(l => l.att ? `${p100(l.eff)} / ${l.att}` : '').join(',')},${p100(r.all.eff)} / ${r.all.att}\n`; });
    csv += `\nATTACK BY PASS (eff / attempts)\nPlayer,In system,Out of system,Transition\n`;
    attackByPhase(gameState, null).forEach(r => { const f = (l: { eff: number | null; att: number }) => (l.att ? `${p100(l.eff)} / ${l.att}` : ''); csv += `${r.name},${f(r.byPhase.in)},${f(r.byPhase.out)},${f(r.byPhase.transition)}\n`; });
    csv += `\nEVENT LOG (time = when the scout tapped)\nTime,Set,Score,Event\n`;
    historyLog(gameState, null).forEach(h => { csv += `${new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })},${h.set},${h.kind === 'point' ? `${h.own}:${h.opponent}` : ''},${h.text.replace(/,/g, ' ')}\n`; });
    const subject = encodeURIComponent(`IndoorStats Match Report - vs ${opp} - ${date}`);
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(csv)}`;
  };

  // Roster editing
  const updatePlayer = (id: string, patch: Partial<Player>) =>
    setGameState(prev => ({ ...prev, players: prev.players.map(p => (p.id === id ? { ...p, ...patch } : p)) }));
  const addPlayer = () =>
    setGameState(prev => ({ ...prev, players: [...prev.players, { id: uid('p'), name: '', number: '', role: 'outside', onCourt: false, slot: Math.max(0, ...prev.players.map(p => p.slot ?? 0)) + 1 }] }));
  const removePlayer = (id: string) => {
    const hasStats = gameState.events.some(e => (e.kind === 'stat' && e.playerId === id) || (e.kind === 'sub' && (e.inId === id || e.outId === id)));
    const doRemove = () => setGameState(prev => ({ ...prev, players: prev.players.filter(p => p.id !== id) }));
    if (hasStats) {
      setConfirmState({ message: 'This player has stats in the current match. Remove anyway? Their stats will drop out of the report.', confirmLabel: 'Remove', onConfirm: doRemove });
    } else doRemove();
  };


  return (
    <div className="h-[100dvh] flex flex-col font-sans bg-background text-ink selection:bg-primary selection:text-black">
      {/* HEADER */}
      <header className="flex items-center gap-3 sm:gap-6 px-4 sm:px-6 h-14 sm:h-16 border-b border-line bg-surface sticky top-0 z-50">
        <span className="font-display font-bold tracking-[0.16em] text-sm sm:text-base hidden sm:inline">INDOORSTATS</span>
        <nav className="flex gap-4 h-full">
          {([['track', 'Live'], ['report', 'Analysis']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`h-full font-display font-bold tracking-[0.12em] uppercase text-xs sm:text-sm border-b-2 ${view === v ? 'border-primary text-ink' : 'border-transparent text-mute'}`}>{label}</button>
          ))}
          <button onClick={() => setShowConfig(true)} className="h-full font-display font-bold tracking-[0.12em] uppercase text-xs sm:text-sm border-b-2 border-transparent text-mute">Team</button>
        </nav>
        <div className="flex-1 flex items-center justify-center gap-2 sm:gap-3">
          <span className="font-display text-[11px] font-bold tracking-[0.14em] text-primary hidden sm:inline">US</span>
          <span className="font-display text-3xl sm:text-4xl font-bold tabular-nums leading-none">{score.own}</span>
          <span className="font-display text-2xl text-mute leading-none">:</span>
          <span className="font-display text-3xl sm:text-4xl font-bold tabular-nums leading-none">{score.opponent}</span>
          <span className="font-display text-[11px] font-bold tracking-[0.14em] text-secondary hidden sm:inline">THEM</span>
          <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-mute ml-2 hidden md:inline">SET {matchOver ? '–' : setNum} · {gameState.sets.own}–{gameState.sets.opponent} · TO {setLimit}</span>
        </div>
        {(['own', 'opponent'] as TeamSide[]).map(team => {
          const n = timeoutsUsed(team);
          return (
            <button key={team} onClick={() => callTimeout(team)} disabled={matchOver || n >= TIMEOUTS_PER_SET}
              aria-label={team === 'own' ? 'Our timeout' : 'Their timeout'}
              className={`h-9 px-2.5 rounded-md border font-display font-bold tracking-[0.1em] uppercase text-xs whitespace-nowrap disabled:opacity-35 ${team === 'own' ? 'border-primary/50 text-primary' : 'border-secondary/50 text-secondary'}`}>
              TO {n}/{TIMEOUTS_PER_SET}
            </button>
          );
        })}
        <button onClick={manualEndSet} disabled={matchOver}
          className="h-9 px-3 rounded-md border border-line font-display font-bold tracking-[0.1em] uppercase text-xs whitespace-nowrap disabled:opacity-30">End set</button>
        <button onClick={() => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch { /* not supported */ } }}
          aria-label="Fullscreen" className="h-9 w-9 rounded-md border border-line hidden sm:flex items-center justify-center text-mute"><Maximize className="w-4 h-4" /></button>
      </header>

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-y-auto lg:overflow-hidden min-h-0">
        {view === 'track' ? (
          <div className="flex-1 flex flex-col bg-background min-h-0 w-full">
            {matchOver && (
              <div className="mx-4 mt-4 p-3 rounded-lg border border-primary/40 text-primary font-display font-bold tracking-[0.1em] uppercase text-sm text-center">
                Match over · {gameState.sets.own}–{gameState.sets.opponent}. Check Analysis or start a new match.
              </div>
            )}
            <RallyView
              gameState={gameState}
              setPending={setPending}
              commitRally={commitRally}
              onSub={handleSub}
              onUndo={handleUndo}
              onRotate={rotateCourt}
              canUndo={currentSetEvents.length > 0 || !!(gameState.pending && gameState.pending.set === setNum) || !!gameState.lineups?.[setNum]?.firstServe}
              court={court}
              onOpenLineup={() => setShowLineup(true)}
              onFirstServe={team => setGameState(prev => prev.lineups?.[setNum] ? ({ ...prev, lineups: { ...prev.lineups, [setNum]: { ...prev.lineups[setNum], firstServe: team } } }) : prev)}
            />
          </div>
        ) : (
          <div className="flex-1 bg-background overflow-y-auto">
            <ReportView gameState={gameState} onExport={handleExport} onReset={newMatch} />
          </div>
        )}
      </main>

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

      {/* LINEUP SHEET */}
      <AnimatePresence>
        {showLineup && !matchOver && (
          <LineupSheet
            key={`lineup-${setNum}`}
            players={gameState.players}
            setNum={setNum}
            initial={gameState.lineups[setNum] ?? defaultLineup(gameState, setNum)}
            onSave={saveLineup}
            onClose={court.hasLineup ? () => setShowLineup(false) : null}
          />
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
                    {gameState.players.length} players · OH outside · MB middle · OPP opposite · S setter · L libero
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
                  <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-2 space-y-2">
                    <div className="flex gap-2">
                      <input type="text" inputMode="numeric" value={p.number} maxLength={3}
                        onChange={e => updatePlayer(p.id, { number: e.target.value.replace(/[^0-9]/g, '') })}
                        placeholder="#" aria-label="Jersey number"
                        className="w-12 bg-white/5 border border-white/10 focus:border-primary p-2 rounded-lg outline-none font-mono font-bold text-center text-sm" />
                      <input type="text" value={p.name}
                        onChange={e => updatePlayer(p.id, { name: e.target.value })}
                        placeholder={`Player ${p.slot ?? idx + 1}`} aria-label="Player name"
                        className="flex-1 min-w-0 bg-white/5 border border-white/10 focus:border-primary p-2 rounded-lg outline-none font-bold uppercase text-sm" />
                      <button onClick={() => removePlayer(p.id)} aria-label="Remove player"
                        className="p-2 text-white/30 hover:text-danger rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-1 p-0.5 bg-white/5 rounded-lg">
                      {ROLES.map(r => (
                        <button key={r} onClick={() => updatePlayer(p.id, { role: r })}
                          className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${p.role === r ? 'bg-white text-black' : 'text-white/40'}`}>
                          {ROLE_SHORT[r]}
                        </button>
                      ))}
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
