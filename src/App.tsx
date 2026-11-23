import { useEffect, useMemo, useRef, useState } from 'react';
import { XCircle, Trophy, Plus, Trash2, Minus, Maximize, Undo2, Redo2 } from 'lucide-react';
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
import { InfoDot } from './RallyView';
import { attackByPhase, attackByRotation, historyLog, passRows, serveRows } from './analysis';
import { computeAlerts } from './alerts';
import { hasData, loadCurrentTeamId, loadMatches, loadTeams, newId, SavedMatch, saveCurrentTeamId, saveMatches, saveTeams, Team } from './storage';
import { getLang, Lang, setLang, t } from './i18n';

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
  const [lang, setLangState] = useState<Lang>(getLang);
  const changeLang = (l: Lang) => { setLang(l); setLangState(l); };

  // Teams: the current roster is the first team on a fresh install
  const [teams, setTeams] = useState<Team[]>(() => {
    const saved = loadTeams();
    return saved.length ? saved : [{ id: newId('t'), name: 'My team', players: gameState.players, subLimit: gameState.subLimit }];
  });
  const [teamId, setTeamId] = useState<string>(() => {
    const want = gameState.teamId ?? loadCurrentTeamId();
    return teams.some(x => x.id === want) ? want! : teams[0].id;
  });
  const team = teams.find(x => x.id === teamId) ?? teams[0];
  const [matches, setMatches] = useState<SavedMatch[]>(loadMatches);
  const [reportMatchId, setReportMatchId] = useState<string | null>(null); // null = this match

  // Roster edits are saved to the current team
  useEffect(() => {
    setTeams(prev => {
      const next = prev.map(x => (x.id === teamId ? { ...x, players: gameState.players, subLimit: gameState.subLimit } : x));
      saveTeams(next);
      return next;
    });
    saveCurrentTeamId(teamId);
  }, [gameState.players, gameState.subLimit, teamId]);

  const matchStarted = hasData(gameState);
  const viewedState = (reportMatchId && matches.find(m => m.id === reportMatchId)?.state) || gameState;
  const switchTeam = (id: string) => {
    const tm = teams.find(x => x.id === id);
    if (!tm || matchStarted) return; // switching team mid-match is not allowed: start a new match first
    setTeamId(id);
    setGameState(prev => ({ ...freshState(padRoster(tm.players)), subLimit: tm.subLimit, opponentName: prev.opponentName, teamId: id }));
  };
  const addTeam = () => {
    const tm: Team = { id: newId('t'), name: t('Team {n}', { n: teams.length + 1 }), players: defaultRoster(), subLimit: 8 };
    setTeams(prev => { const next = [...prev, tm]; saveTeams(next); return next; });
    if (!matchStarted) { setTeamId(tm.id); setGameState(prev => ({ ...freshState(tm.players), opponentName: prev.opponentName, teamId: tm.id })); }
  };
  const renameTeam = (name: string) => setTeams(prev => { const next = prev.map(x => (x.id === teamId ? { ...x, name } : x)); saveTeams(next); return next; });
  const deleteTeam = (id: string) => {
    const tm = teams.find(x => x.id === id);
    if (!tm || id === teamId) return;
    setConfirmState({
      message: t('Delete team {name}? Saved matches stay.', { name: tm.name }),
      confirmLabel: t('Delete'),
      onConfirm: () => setTeams(prev => { const next = prev.filter(x => x.id !== id); saveTeams(next); return next; }),
    });
  };
  const deleteMatch = (id: string) => setConfirmState({
    message: t('Delete this saved match? This cannot be undone.'),
    confirmLabel: t('Delete'),
    onConfirm: () => { setMatches(prev => { const next = prev.filter(m => m.id !== id); saveMatches(next); return next; }); setReportMatchId(null); },
  });

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

  // Alert log: record each alert when it shows up on the live screen (top 3), with set and score
  const shownAlerts = useRef<Set<string> | null>(null);
  useEffect(() => {
    // No logging once the match is over
    const now = matchOver ? [] : computeAlerts(gameState, court.rotation, court.display).slice(0, 3);
    const ids = new Set(now.map(a => a.id));
    if (shownAlerts.current === null) { shownAlerts.current = ids; return; } // first render / reload: don't re-log
    const fresh = now.filter(a => !shownAlerts.current!.has(a.id));
    shownAlerts.current = ids;
    if (!fresh.length) return;
    const sc = scoreForSet(gameState.events, setNum);
    setGameState(prev => ({
      ...prev,
      alertLog: [...(prev.alertLog ?? []), ...fresh.map(a => ({ id: a.id, set: setNum, time: Date.now(), own: sc.own, opponent: sc.opponent, text: a.text }))],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.events, court.rotation]);


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

  // Back = last action: one step back in the rally; right after a point it reopens that rally at its final rating
  const handleBack = () => {
    setGameState(prev => {
      const s = currentSetNumber(prev);
      const p = prev.pending && prev.pending.set === s ? prev.pending : null;
      if (p && p.history.length > 0) {
        const h = p.history[p.history.length - 1];
        return { ...prev, pending: { ...p, step: h.step, actions: p.actions.slice(0, h.actionCount), trail: (p.trail ?? []).slice(0, h.trailCount ?? 0), history: p.history.slice(0, -1) } };
      }
      const lr = prev.lastRally;
      if (!lr || lr.set !== s) return prev;
      const inSet = prev.events.filter(e => e.set === s);
      if (inSet[inSet.length - 1]?.rallyId !== lr.rallyId) return prev; // something happened since (sub, timeout)
      return { ...prev, events: prev.events.filter(e => e.rallyId !== lr.rallyId), pending: lr.pending, lastRally: null };
    });
  };
  const canBack = (() => {
    const p = gameState.pending && gameState.pending.set === setNum ? gameState.pending : null;
    if (p && p.history.length > 0) return true;
    const lr = gameState.lastRally;
    return !!lr && lr.set === setNum && currentSetEvents[currentSetEvents.length - 1]?.rallyId === lr.rallyId;
  })();

  // Undo (header) = the whole last rally (or the last sub/rotate/timeout); a rally in progress is dropped too
  const undoRallyOf = (prev: GameState): GameState => {
    const s = currentSetNumber(prev);
    let lastIdx = -1;
    for (let i = prev.events.length - 1; i >= 0; i--) {
      if (prev.events[i].set === s) { lastIdx = i; break; }
    }
    if (lastIdx < 0) {
      if (prev.pending) return { ...prev, pending: null };
      // Nothing played yet: undo the first-serve choice so it can be picked again
      const lu = prev.lineups?.[s];
      return lu?.firstServe ? { ...prev, lineups: { ...prev.lineups, [s]: { ...lu, firstServe: null } } } : prev;
    }
    const last = prev.events[lastIdx];
    const events = last.rallyId
      ? prev.events.filter(e => e.rallyId !== last.rallyId)
      : prev.events.filter((_, i) => i !== lastIdx);
    // A timeout/sub comes off alone; the rally in progress stays
    const side = last.kind === 'sub' || last.kind === 'rotate' || last.kind === 'timeout';
    return { ...prev, events, pending: side ? prev.pending : null, lastRally: side ? prev.lastRally : null };
  };
  // Redo brings back what Undo removed, as long as nothing else happened in between
  const [redoStack, setRedoStack] = useState<GameState[]>([]);
  const undoResult = useRef<GameState | null>(null);
  useEffect(() => {
    if (gameState !== undoResult.current && redoStack.length) setRedoStack([]);
  }, [gameState]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleUndo = () => {
    const next = undoRallyOf(gameState);
    if (next === gameState) return;
    setRedoStack(r => [...r, gameState]);
    undoResult.current = next;
    setGameState(next);
  };
  const handleRedo = () => {
    const top = redoStack[redoStack.length - 1];
    if (!top) return;
    setRedoStack(r => r.slice(0, -1));
    undoResult.current = top;
    setGameState(top);
  };
  const canUndo = currentSetEvents.length > 0 || !!(gameState.pending && gameState.pending.set === setNum) || !!gameState.lineups?.[setNum]?.firstServe;

  const commitRally = (events: MatchEvent[], message: string, snapshot?: PendingRally) => {
    const rallyId = events.find(e => e.rallyId)?.rallyId;
    setGameState(prev => ({ ...prev, events: [...prev.events, ...events], pending: null,
      lastRally: snapshot && rallyId ? { set: currentSetNumber(prev), rallyId, pending: snapshot } : null }));
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

  // Undo a set end (e.g. the last point of the match was a mistake): the set is open again
  const reopenLastSet = () => {
    setGameState(prev => {
      const last = prev.setHistory[prev.setHistory.length - 1];
      if (!last) return prev;
      const winner: TeamSide = last.own > last.opponent ? 'own' : 'opponent';
      return { ...prev, setHistory: prev.setHistory.slice(0, -1), sets: { ...prev.sets, [winner]: Math.max(0, prev.sets[winner] - 1) } };
    });
  };

  const manualEndSet = () => {
    if (score.own === score.opponent) {
      setConfirmState({ message: t('Score is tied {a}:{b}. Add the last point first.', { a: score.own, b: score.opponent }), confirmLabel: 'OK', onConfirm: () => {} });
      return;
    }
    const winner: TeamSide = score.own > score.opponent ? 'own' : 'opponent';
    setConfirmState({
      message: t('End set {n} at {a}:{b}? Sets go to {l}, win by 2.', { n: setNum, a: score.own, b: score.opponent, l: setLimit }),
      confirmLabel: t('End set'),
      onConfirm: () => closeSet(winner),
    });
  };

  const newMatch = () => {
    setConfirmState({
      message: matchStarted ? t('Start a new match? This match is saved on this device and stays in Analysis.') : t('Start a new match?'),
      confirmLabel: t('New match'),
      onConfirm: () => {
        if (matchStarted) {
          const saved: SavedMatch = { id: newId('m'), teamId, teamName: team.name, savedAt: Date.now(), state: { ...gameState, pending: null, teamId } };
          const next = [saved, ...matches];
          // Browser storage is full: keep the match in the app, warn, and don't clear it
          if (!saveMatches(next)) {
            setConfirmState({ message: t('Storage on this device is full. Delete old matches in Analysis, then try again.'), confirmLabel: t('OK'), onConfirm: () => {} });
            return;
          }
          setMatches(next);
        }
        setGameState(prev => ({
          ...freshState(prev.players),
          autoScore: prev.autoScore,
          subLimit: prev.subLimit,
          teamId,
          templateLineup: prev.lineups[1] ?? prev.templateLineup ?? null,
        }));
        setReportMatchId(null);
        setView('track');
        setShowConfig(true);
      },
    });
  };

  const handleExport = (gameState: GameState) => {
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
    historyLog(gameState, null).forEach(h => { csv += `${new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })},${h.set},${h.kind === 'point' || h.kind === 'alert' ? `${h.own}:${h.opponent}` : ''},${h.kind === 'alert' ? `${t('Alert')}: ` : ''}${h.text.replace(/,/g, ' ')}\n`; });
    // Share sheet with a CSV file (Mail, AirDrop, Files, WhatsApp...). Fallback: download. No mailto: it opens whatever the default mail app is and cuts long bodies
    const safe = (x: string) => x.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
    const fileName = `IndoorStats_${(gameState.matchDate || new Date().toISOString()).slice(0, 10)}_${safe(opp)}.csv`;
    const file = new File(['\ufeff' + csv], fileName, { type: 'text/csv' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      nav.share({ files: [file], title: `IndoorStats · vs ${opp} · ${date}` }).catch(() => { /* cancelled */ });
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      setConfirmState({ message: t('This player has stats in the current match. Remove anyway? Their stats will drop out of the report.'), confirmLabel: t('Remove'), onConfirm: doRemove });
    } else doRemove();
  };


  return (
    <div className="h-[100dvh] flex flex-col font-sans bg-background text-ink selection:bg-primary selection:text-black">
      {/* HEADER */}
      <header className="flex items-center gap-2 sm:gap-4 lg:gap-6 px-3 sm:px-6 h-14 sm:h-16 border-b border-line bg-surface sticky top-0 z-50">
        <span className="font-display font-bold tracking-[0.16em] text-sm sm:text-base hidden lg:inline">{t("INDOORSTATS")}</span>
        <nav className="flex gap-3 sm:gap-4 h-full">
          {([['track', 'Live'], ['report', 'Analysis']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`h-full font-display font-bold tracking-[0.12em] uppercase text-xs sm:text-sm border-b-2 ${view === v ? 'border-primary text-ink' : 'border-transparent text-mute'}`}>{t(label)}</button>
          ))}
          <button onClick={() => setShowConfig(true)} className="h-full font-display font-bold tracking-[0.12em] uppercase text-xs sm:text-sm border-b-2 border-transparent text-mute">{t("Team")}</button>
        </nav>
        <div className="flex-1 flex items-center justify-center gap-2 sm:gap-3">
          <span className="font-display text-[11px] font-bold tracking-[0.14em] text-primary hidden sm:inline">{t("US")}</span>
          <span className="font-display text-3xl sm:text-4xl font-bold tabular-nums leading-none">{score.own}</span>
          <span className="font-display text-2xl text-mute leading-none">:</span>
          <span className="font-display text-3xl sm:text-4xl font-bold tabular-nums leading-none">{score.opponent}</span>
          <span className="font-display text-[11px] font-bold tracking-[0.14em] text-secondary hidden sm:inline">{t("THEM")}</span>
          <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-mute ml-2 hidden xl:inline whitespace-nowrap">{t('SET')} {matchOver ? '–' : setNum} · {gameState.sets.own}–{gameState.sets.opponent} · {t('TO {n}', { n: setLimit })}</span>
        </div>
        {view === 'track' && !matchOver && (
          <div className="flex gap-1.5">
            <button onClick={handleUndo} disabled={!canUndo} data-undo-rally aria-label={t('Undo last rally')} title={t('Undo last rally')}
              className="h-9 w-9 rounded-md border border-line flex items-center justify-center disabled:opacity-30"><Undo2 className="w-4 h-4" /></button>
            <button onClick={handleRedo} disabled={!redoStack.length} data-redo-rally aria-label={t('Redo')} title={t('Redo')}
              className="h-9 w-9 rounded-md border border-line flex items-center justify-center disabled:opacity-30"><Redo2 className="w-4 h-4" /></button>
          </div>
        )}
        {(['own', 'opponent'] as TeamSide[]).map(team => {
          const n = timeoutsUsed(team);
          return (
            <button key={team} onClick={() => callTimeout(team)} disabled={matchOver || n >= TIMEOUTS_PER_SET}
              aria-label={team === 'own' ? 'Our timeout' : 'Their timeout'}
              className={`h-9 px-2.5 rounded-md border font-display font-bold tracking-[0.1em] uppercase text-xs whitespace-nowrap disabled:opacity-35 ${team === 'own' ? 'border-primary/50 text-primary' : 'border-secondary/50 text-secondary'}`}>
              {t('TO')} {n}/{TIMEOUTS_PER_SET}
            </button>
          );
        })}
        <button onClick={manualEndSet} disabled={matchOver}
          className="h-9 px-3 rounded-md border border-line font-display font-bold tracking-[0.1em] uppercase text-xs whitespace-nowrap disabled:opacity-30">{t("End set")}</button>
        <button onClick={() => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch { /* not supported */ } }}
          aria-label="Fullscreen" className="h-9 w-9 rounded-md border border-line hidden lg:flex items-center justify-center text-mute"><Maximize className="w-4 h-4" /></button>
      </header>

      {/* MAIN */}
      <main key={lang} className="flex-1 flex flex-col overflow-y-auto lg:overflow-hidden min-h-0">
        {view === 'track' ? (
          <div className="flex-1 flex flex-col bg-background min-h-0 w-full">
            {matchOver ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 text-center">
                <span className="font-display text-sm font-bold tracking-[0.14em] uppercase text-mute">{t('Match over')}</span>
                <span className={`font-display text-7xl font-bold tabular-nums ${gameState.sets.own > gameState.sets.opponent ? 'text-primary' : 'text-secondary'}`}>{gameState.sets.own}–{gameState.sets.opponent}</span>
                <span className="font-display text-lg font-semibold tracking-[0.08em] text-mute">{gameState.setHistory.map(x => `${x.own}:${x.opponent}`).join('  ·  ')}</span>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  <button onClick={() => setView('report')} className="h-14 px-6 rounded-lg bg-primary text-[#0D0F12] font-display font-bold uppercase tracking-[0.12em] text-lg">{t('Analysis')}</button>
                  <button onClick={newMatch} className="h-14 px-6 rounded-lg border border-line font-display font-bold uppercase tracking-[0.12em]">{t('New match')}</button>
                  <button onClick={reopenLastSet} className="h-14 px-6 rounded-lg border border-line text-mute font-display font-bold uppercase tracking-[0.12em]">{t('Reopen set {n}', { n: gameState.setHistory.length })}</button>
                </div>
              </div>
            ) : (
            <RallyView
              gameState={gameState}
              setPending={setPending}
              commitRally={commitRally}
              onSub={handleSub}
              onBack={handleBack}
              canBack={canBack}
              onRotate={rotateCourt}
              court={court}
              onOpenLineup={() => setShowLineup(true)}
              onFirstServe={team => setGameState(prev => prev.lineups?.[setNum] ? ({ ...prev, lineups: { ...prev.lineups, [setNum]: { ...prev.lineups[setNum], firstServe: team } } }) : prev)}
            />
            )}
          </div>
        ) : (
          <div className="flex-1 bg-background overflow-y-auto">
            <ReportView
              gameState={viewedState}
              onExport={() => handleExport(viewedState)}
              onReset={reportMatchId ? () => deleteMatch(reportMatchId) : newMatch}
              past={!!reportMatchId}
              selector={matches.length > 0 ? (
                <select value={reportMatchId ?? ''} onChange={e => setReportMatchId(e.target.value || null)} aria-label={t('Match')}
                  className="h-10 max-w-full bg-card border border-line rounded-lg px-3 font-display font-bold uppercase tracking-[0.06em] text-sm outline-none focus:border-primary">
                  <option value="">{t('This match')} · {gameState.sets.own}–{gameState.sets.opponent}</option>
                  {matches.map(m => (
                    <option key={m.id} value={m.id}>
                      {formatMatchDate(m.state.matchDate)} · {m.teamName}{m.state.opponentName ? ` vs ${m.state.opponentName}` : ''} · {m.state.sets.own}–{m.state.sets.opponent}
                    </option>
                  ))}
                </select>
              ) : null}
            />
          </div>
        )}
      </main>

      {/* SET END MODAL */}
      <AnimatePresence>
        {setEndWinner && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface border border-line p-7 rounded-2xl w-full max-w-sm text-center space-y-5">
              <Trophy className={`w-10 h-10 mx-auto ${setEndWinner === 'own' ? 'text-primary' : 'text-secondary'}`} />
              <div>
                <h3 className="font-display text-3xl font-bold uppercase tracking-[0.04em]">{t('Set {n}', { n: setNum })} · {score.own}:{score.opponent}</h3>
                <p className={`font-display text-lg font-bold uppercase tracking-[0.08em] mt-1 ${setEndWinner === 'own' ? 'text-primary' : 'text-secondary'}`}>
                  {setEndWinner === 'own' ? t('We win the set') : t('{name} wins the set', { name: gameState.opponentName || t('Opponent') })}
                </p>
              </div>
              <div className="space-y-2">
                <button onClick={() => closeSet(setEndWinner)}
                  className="w-full h-14 bg-primary text-[#0D0F12] font-display font-bold uppercase tracking-[0.12em] text-lg rounded-lg">
                  {gameState.sets[setEndWinner] + 1 >= SETS_TO_WIN ? t('Finish match') : t('Next set')}
                </button>
                <button onClick={handleUndo}
                  className="w-full h-12 border border-line font-display font-bold uppercase tracking-[0.1em] text-sm rounded-lg">{t('Undo last point')}</button>
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
            onClose={() => setShowLineup(false)}
          />
        )}
      </AnimatePresence>

      {/* CONFIRM MODAL */}
      <AnimatePresence>
        {confirmState && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/80">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface border border-line p-6 rounded-2xl w-full max-w-sm space-y-5">
              <p className="text-base">{confirmState.message}</p>
              <div className="flex gap-2">
                {confirmState.confirmLabel !== 'OK' && (
                  <button onClick={() => setConfirmState(null)}
                    className="flex-1 h-12 border border-line font-display font-bold uppercase text-sm tracking-[0.1em] rounded-lg">{t('Cancel')}</button>
                )}
                {/* Close first, so onConfirm can open a follow-up message */}
                <button onClick={() => { const c = confirmState; setConfirmState(null); c.onConfirm(); }}
                  className="flex-1 h-12 bg-primary text-[#0D0F12] font-display font-bold uppercase text-sm tracking-[0.1em] rounded-lg">{confirmState.confirmLabel}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TEAM WINDOW */}
      <AnimatePresence>
        {showConfig && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80">
            <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={{ duration: 0.15 }}
              className="bg-surface border border-line p-5 sm:p-7 lg:p-6 rounded-t-2xl sm:rounded-2xl w-full max-w-xl lg:max-w-5xl shadow-2xl space-y-5 lg:space-y-3 max-h-[96dvh] overflow-y-auto">
              <div className="flex flex-wrap justify-between items-center gap-x-5 gap-y-3">
                <span className="font-display text-3xl font-bold uppercase tracking-[0.04em]">{t('Team')}</span>
                {/* Team switcher */}
                <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
                {teams.map(x => (
                  <div key={x.id} className="relative">
                    <button onClick={() => switchTeam(x.id)} disabled={x.id !== teamId && matchStarted}
                      className={`h-10 pl-3.5 ${x.id !== teamId && !matchStarted ? 'pr-9' : 'pr-3.5'} rounded-lg font-display font-bold uppercase tracking-[0.06em] disabled:opacity-35 ${x.id === teamId ? 'border-[1.5px] border-primary text-primary' : 'border border-line'}`}>{x.name || t('Team')}</button>
                    {x.id !== teamId && !matchStarted && (
                      <button onClick={() => deleteTeam(x.id)} aria-label={t('Delete')} className="absolute right-1.5 top-2 w-6 h-6 rounded-md border border-line flex items-center justify-center text-mute hover:text-bad"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
                <button onClick={addTeam} className="h-10 px-3 rounded-lg border border-dashed border-line font-display font-bold uppercase text-sm text-mute flex items-center gap-1"><Plus className="w-4 h-4" /> {t('Team')}</button>
                {matchStarted && teams.length > 1 && <InfoDot light text={t('To switch team, start a new match first.')} />}
              </div>

                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-line overflow-hidden" role="group" aria-label="Language">
                    {(['de', 'en'] as Lang[]).map(l => (
                      <button key={l} onClick={() => changeLang(l)}
                        className={`h-9 px-3 font-display font-bold text-sm tracking-[0.1em] uppercase ${lang === l ? 'bg-primary text-[#0D0F12]' : 'text-mute'}`}>{l}</button>
                    ))}
                  </div>
                  <button onClick={() => setShowConfig(false)} aria-label="Close" className="w-9 h-9 rounded-lg border border-line flex items-center justify-center"><XCircle className="w-5 h-5" /></button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={team.name} onChange={e => renameTeam(e.target.value)} placeholder={t('Team name')} aria-label={t('Team name')}
                  className="bg-card border border-line focus:border-primary h-11 px-3 rounded-lg outline-none font-display font-bold uppercase" />
                <input type="text" value={gameState.opponentName} onChange={e => setGameState(prev => ({ ...prev, opponentName: e.target.value }))}
                  placeholder={t('Opponent')} aria-label={t('Opponent')}
                  className="bg-card border border-line focus:border-secondary h-11 px-3 rounded-lg outline-none font-display font-bold uppercase" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 lg:gap-y-1.5 lg:gap-x-6">
                {gameState.players.map((p, idx) => (
                  <div key={p.id} className="flex gap-2 items-center">
                    <input type="text" inputMode="numeric" value={p.number} maxLength={3}
                      onChange={e => updatePlayer(p.id, { number: e.target.value.replace(/[^0-9]/g, '') })}
                      placeholder="#" aria-label={t('Jersey number')}
                      className="w-12 bg-card border border-line focus:border-primary h-10 rounded-lg outline-none font-display font-bold text-center" />
                    <input type="text" value={p.name} onChange={e => updatePlayer(p.id, { name: e.target.value })}
                      placeholder={t('Player {n}', { n: p.slot ?? idx + 1 })} aria-label={t('Player name')}
                      className="flex-1 min-w-0 bg-card border border-line focus:border-primary h-10 px-3 rounded-lg outline-none font-display font-bold uppercase" />
                    <div className="flex rounded-lg border border-line overflow-hidden shrink-0">
                      {ROLES.map(r => (
                        <button key={r} onClick={() => updatePlayer(p.id, { role: r })}
                          className={`h-10 w-9 sm:w-10 font-display text-xs font-bold ${p.role === r ? 'bg-ink text-[#0B0C0E]' : 'text-mute'}`}>{t(ROLE_SHORT[r])}</button>
                      ))}
                    </div>
                    <button onClick={() => removePlayer(p.id)} aria-label={t('Remove player')} className="w-10 h-10 shrink-0 rounded-lg border border-line flex items-center justify-center text-mute hover:text-bad"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={addPlayer}
                  className="w-full h-10 border border-dashed border-line rounded-lg font-display text-sm font-bold uppercase tracking-[0.1em] text-mute flex items-center justify-center gap-1.5">
                  <Plus className="w-4 h-4" /> {t('Add player')}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <span className="font-display text-sm font-bold uppercase tracking-[0.12em] text-mute">{t('Subs per set')}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setGameState(prev => ({ ...prev, subLimit: Math.max(0, prev.subLimit - 1) }))} aria-label="−" className="w-9 h-9 border border-line rounded-lg flex items-center justify-center"><Minus className="w-4 h-4" /></button>
                  <span className="w-6 text-center font-display text-lg font-bold">{gameState.subLimit}</span>
                  <button onClick={() => setGameState(prev => ({ ...prev, subLimit: prev.subLimit + 1 }))} aria-label="+" className="w-9 h-9 border border-line rounded-lg flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                </div>
              
                <div className="flex gap-2 w-full lg:w-auto lg:ml-auto">
                  <button onClick={newMatch}
                    className="h-14 lg:h-12 px-4 rounded-lg border border-line font-display font-bold uppercase text-sm tracking-[0.1em]">{t('New match')}</button>
                  <button onClick={() => setShowConfig(false)}
                    className="flex-1 lg:flex-none lg:w-56 h-14 lg:h-12 bg-primary text-[#0D0F12] rounded-lg font-display font-bold uppercase text-lg tracking-[0.12em]">{t('Done')}</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
