import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, RotateCcw, X } from 'lucide-react';
import {
  GameState, Grade, MatchEvent, PendingRally, Player, PointReason, RallyStep, Skill, StatEvent, TeamSide,
  GRADE_LABEL, ROLE_LABEL,
} from './types';
import { currentSetNumber, lastPointWinner, playerLabel, subsUsed, suggestedServer } from './utils';

interface RallyViewProps {
  gameState: GameState;
  setPending: (p: PendingRally | null) => void;
  commitRally: (events: MatchEvent[], message: string) => void;
  onSub: (inId: string, outId: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const STEP_TITLE: Record<RallyStep, string> = {
  our_serve: 'Our serve · who serves?',
  opp_serve: 'Opponent serves · who passes?',
  our_attack: 'Our attack · who attacks?',
  opp_attack: 'Opponent attack',
};

export default function RallyView({ gameState, setPending, commitRally, onSub, onUndo, canUndo }: RallyViewProps) {
  const setNum = currentSetNumber(gameState);
  const indexed = gameState.players.map((p, i) => ({ p, i }));
  const court = indexed.filter(x => x.p.onCourt);
  const lastWinner = lastPointWinner(gameState.events, setNum);

  // Current rally: stored pending rally, or a fresh one served by the last point winner
  const stored = gameState.pending && gameState.pending.set === setNum ? gameState.pending : null;
  const rally: PendingRally | null = stored ?? (lastWinner ? { ...freshRally(lastWinner, setNum), id: `r-${setNum}-${gameState.events.length}` } : null);

  const [selected, setSelected] = useState<string | null>(null);
  const [showSubs, setShowSubs] = useState(false);

  const serverSuggestion = rally?.step === 'our_serve' && rally.actions.length === 0 ? suggestedServer(gameState.events, setNum) : null;

  // Reset selection when the step changes; preselect the server who keeps serving
  const stepKey = rally ? `${rally.id}-${rally.step}-${rally.actions.length}-${rally.history.length}` : 'none';
  useEffect(() => {
    setSelected(serverSuggestion && court.some(c => c.p.id === serverSuggestion) ? serverSuggestion : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, serverSuggestion]);

  const nameOf = (id: string) => {
    const i = gameState.players.findIndex(p => p.id === id);
    return i >= 0 ? playerLabel(gameState.players[i], i) : '';
  };

  const advance = (r: PendingRally, step: RallyStep, actions: StatEvent[]) => {
    setPending({ ...r, step, actions, history: [...r.history, { step: r.step, actionCount: r.actions.length }] });
  };

  const stat = (r: PendingRally, playerId: string, skill: Skill, grade: Grade, point: TeamSide | null): StatEvent => ({
    kind: 'stat', id: uid('e'), rallyId: r.id, set: setNum, playerId, skill, grade, point, timestamp: Date.now(),
  });

  const endWithPoint = (r: PendingRally, team: TeamSide, reason: PointReason, extra: StatEvent[] = [], msg = '') => {
    const pointEvent: MatchEvent = { kind: 'point', id: uid('e'), rallyId: r.id, set: setNum, team, reason, timestamp: Date.now() };
    commitRally([...r.actions, ...extra, pointEvent], msg || (team === 'own' ? '+1 us' : '+1 them'));
  };

  const endWithStat = (r: PendingRally, ev: StatEvent, msg: string) => {
    commitRally([...r.actions, ev], msg);
  };

  const handleGrade = (grade: Grade) => {
    if (!rally) return;
    if (!selected) return;
    const who = nameOf(selected);
    if (rally.step === 'our_serve') {
      if (grade === 'plus') return endWithStat(rally, stat(rally, selected, 'serve', 'plus', 'own'), `${who} ace · +1 us`);
      if (grade === 'minus') return endWithStat(rally, stat(rally, selected, 'serve', 'minus', 'opponent'), `${who} serve error · +1 them`);
      return advance(rally, 'opp_attack', [...rally.actions, stat(rally, selected, 'serve', 'zero', null)]);
    }
    if (rally.step === 'opp_serve') {
      // − pass = aced: rally over, point them
      if (grade === 'minus') return endWithPoint(rally, 'opponent', 'opp_ace', [stat(rally, selected, 'pass', 'minus', null)], `${who} aced · +1 them`);
      return advance(rally, 'our_attack', [...rally.actions, stat(rally, selected, 'pass', grade, null)]);
    }
    if (rally.step === 'our_attack') {
      if (grade === 'plus') return endWithStat(rally, stat(rally, selected, 'attack', 'plus', 'own'), `${who} kill · +1 us`);
      if (grade === 'minus') return endWithStat(rally, stat(rally, selected, 'attack', 'minus', 'opponent'), `${who} attack error · +1 them`);
      return advance(rally, 'opp_attack', [...rally.actions, stat(rally, selected, 'attack', 'zero', null)]);
    }
  };

  const handleOppAttack = (grade: Grade) => {
    if (!rally) return;
    if (grade === 'minus') return endWithPoint(rally, 'own', 'opp_attack_error', [], 'Opponent attack error · +1 us');
    if (grade === 'plus') return endWithPoint(rally, 'opponent', 'opp_attack_point', [], 'Opponent kill · +1 them');
    advance(rally, 'our_attack', rally.actions);
  };

  const handleOther = (team: TeamSide) => {
    if (!rally) return;
    endWithPoint(rally, team, 'other');
  };

  // Eligible players per step
  const eligible = (step: RallyStep) => court.filter(({ p }) =>
    step === 'our_serve' ? p.role !== 'libero' :
    step === 'opp_serve' ? p.role !== 'setter' :
    step === 'our_attack' ? p.role === 'hitter' : false);

  const used = subsUsed(gameState.events, setNum);

  const gradeButtons = (labels: [string, string, string]) => (
    <div className="grid grid-cols-3 gap-2">
      {(['minus', 'zero', 'plus'] as Grade[]).map((g, i) => (
        <button key={g} onClick={() => handleGrade(g)} disabled={!selected}
          className={`py-5 rounded-2xl font-black uppercase transition-all active:scale-90 disabled:opacity-25 ${
            g === 'minus' ? 'bg-danger text-white' : g === 'zero' ? 'bg-white/10 text-white border border-white/20' : 'bg-success text-black'
          }`}>
          <span className="block text-2xl leading-none">{GRADE_LABEL[g]}</span>
          <span className="block text-[9px] tracking-wider mt-1 opacity-80">{labels[i]}</span>
        </button>
      ))}
    </div>
  );

  const playerGrid = (step: RallyStep) => {
    const list = eligible(step);
    if (list.length === 0) return <div className="text-xs text-white/30 border border-dashed border-white/10 rounded-xl p-4 text-center">No eligible players on court. Check the lineup.</div>;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {list.map(({ p, i }) => (
          <button key={p.id} onClick={() => setSelected(p.id)}
            className={`min-h-[56px] rounded-2xl px-3 py-2 text-left border-2 transition-all active:scale-95 ${
              selected === p.id ? 'border-primary bg-primary/15' : 'border-white/10 bg-white/5'
            }`}>
            <span className={`block font-black italic uppercase leading-none text-base truncate ${selected === p.id ? 'text-primary' : ''}`}>{playerLabel(p, i)}</span>
            <span className="block text-[9px] font-bold uppercase tracking-wider text-white/30 mt-1">{ROLE_LABEL[p.role]}</span>
          </button>
        ))}
      </div>
    );
  };

  // Breadcrumb of the rally so far
  const crumbs: string[] = [];
  if (rally) {
    crumbs.push(rally.servingTeam === 'own' ? 'We serve' : 'They serve');
    rally.actions.forEach(a => crumbs.push(`${nameOf(a.playerId)} ${a.skill} ${GRADE_LABEL[a.grade]}`));
  }

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-y-auto pb-32 gap-4">
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={onUndo} disabled={!canUndo}
          className="text-[10px] font-bold uppercase text-primary border border-primary/30 px-3 py-1.5 rounded-lg active:scale-95 flex items-center gap-1 disabled:opacity-30">
          <RotateCcw className="w-3 h-3" /> Undo
        </button>
        <button onClick={() => setShowSubs(true)}
          className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border flex items-center gap-1 active:scale-95 ${used >= gameState.subLimit ? 'text-danger border-danger/30' : 'text-white/60 border-white/10'}`}>
          <ArrowLeftRight className="w-3 h-3" /> Subs {used}/{gameState.subLimit}
        </button>
      </div>

      {/* Breadcrumb */}
      {crumbs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {crumbs.map((c, i) => (
            <span key={i} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${i === 0 ? (rally!.servingTeam === 'own' ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary') : 'bg-white/5 text-white/60'}`}>
              {c}
            </span>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {!rally ? (
          <motion.div key="choose" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col justify-center gap-3">
            <h3 className="text-xs font-bold text-white/30 uppercase tracking-widest text-center">Set {setNum} · who serves first?</h3>
            <button onClick={() => setPending(freshRally('own', setNum))}
              className="h-28 rounded-2xl bg-primary text-black font-black uppercase italic tracking-tighter text-3xl active:scale-95 transition-all">We serve</button>
            <button onClick={() => setPending(freshRally('opponent', setNum))}
              className="h-28 rounded-2xl bg-secondary text-black font-black uppercase italic tracking-tighter text-3xl active:scale-95 transition-all">They serve</button>
          </motion.div>
        ) : (
          <motion.div key={stepKey} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest">{STEP_TITLE[rally.step]}</h3>

            {rally.step === 'opp_serve' && (
              <button onClick={() => endWithPoint(rally, 'own', 'opp_serve_error', [], 'Opponent service error · +1 us')}
                className="w-full py-4 rounded-2xl bg-primary text-black font-black uppercase tracking-tight text-sm active:scale-95 transition-all">
                Service error opponent <span className="opacity-60 text-[10px] ml-1">+1 us · we serve</span>
              </button>
            )}

            {rally.step === 'opp_attack' ? (
              <div className="grid gap-2">
                <button onClick={() => handleOppAttack('minus')}
                  className="py-5 rounded-2xl bg-primary text-black font-black uppercase active:scale-95 transition-all">
                  − Their error <span className="block text-[10px] opacity-60 mt-0.5">+1 us</span>
                </button>
                <button onClick={() => handleOppAttack('zero')}
                  className="py-5 rounded-2xl bg-white/10 border border-white/20 text-white font-black uppercase active:scale-95 transition-all">
                  0 We dig it <span className="block text-[10px] opacity-60 mt-0.5">Our attack next</span>
                </button>
                <button onClick={() => handleOppAttack('plus')}
                  className="py-5 rounded-2xl bg-secondary text-black font-black uppercase active:scale-95 transition-all">
                  # Their kill <span className="block text-[10px] opacity-60 mt-0.5">+1 them</span>
                </button>
              </div>
            ) : (
              <>
                {playerGrid(rally.step)}
                {rally.step === 'our_serve' && gradeButtons(['Error', 'In play', 'Ace'])}
                {rally.step === 'opp_serve' && gradeButtons(['Aced · +1 them', 'OK', 'Perfect'])}
                {rally.step === 'our_attack' && gradeButtons(['Error / block', 'In play', 'Kill'])}
                {!selected && <p className="text-[10px] text-white/30 text-center uppercase tracking-wider">Pick a player, then rate</p>}
              </>
            )}

            {/* Points the flow doesn't cover: blocks, net faults, overpasses */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
              <button onClick={() => handleOther('own')}
                className="py-3 rounded-xl border border-primary/30 text-primary font-bold uppercase text-[10px] tracking-wider active:scale-95 transition-all">
                Point us (other)
              </button>
              <button onClick={() => handleOther('opponent')}
                className="py-3 rounded-xl border border-secondary/30 text-secondary font-bold uppercase text-[10px] tracking-wider active:scale-95 transition-all">
                Point them (other)
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SUB SHEET */}
      <AnimatePresence>
        {showSubs && <SubSheet players={gameState.players} onClose={() => setShowSubs(false)} onSub={onSub} used={used} limit={gameState.subLimit} />}
      </AnimatePresence>
    </div>
  );
}

export function freshRally(servingTeam: TeamSide, set: number): PendingRally {
  return {
    id: uid('r'), set, servingTeam,
    step: servingTeam === 'own' ? 'our_serve' : 'opp_serve',
    actions: [], history: [],
  };
}

function SubSheet({ players, onClose, onSub, used, limit }: {
  players: Player[]; onClose: () => void; onSub: (inId: string, outId: string) => void; used: number; limit: number;
}) {
  const [outId, setOutId] = useState<string | null>(null);
  const indexed = players.map((p, i) => ({ p, i }));
  const court = indexed.filter(x => x.p.onCourt);
  const bench = indexed.filter(x => !x.p.onCourt);
  const btn = (p: Player, i: number, active: boolean, onClick: () => void, disabled = false) => (
    <button key={p.id} onClick={onClick} disabled={disabled}
      className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all active:scale-95 disabled:opacity-30 ${active ? 'border-primary bg-primary/15' : 'border-white/10 bg-white/5'}`}>
      <span className="block font-black italic uppercase text-sm truncate">{playerLabel(p, i)}</span>
      <span className="block text-[9px] font-bold uppercase tracking-wider text-white/30">{ROLE_LABEL[p.role]}</span>
    </button>
  );
  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xl" onClick={onClose}>
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-white/10 p-5 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl max-h-[85dvh] overflow-y-auto space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-black italic uppercase tracking-tight">Substitution</h3>
            <p className="text-[10px] uppercase tracking-widest text-white/40">{outId ? 'Now tap who comes in' : 'Tap who goes out'} · {used}/{limit} used</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/30">Out (court)</div>
            {court.map(({ p, i }) => btn(p, i, outId === p.id, () => setOutId(outId === p.id ? null : p.id)))}
          </div>
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/30">In (bench)</div>
            {bench.length === 0 && <div className="text-[10px] text-white/30">Bench empty</div>}
            {bench.map(({ p, i }) => btn(p, i, false, () => { if (outId) { onSub(p.id, outId); setOutId(null); onClose(); } }, !outId))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
