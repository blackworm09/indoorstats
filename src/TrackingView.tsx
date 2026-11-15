import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, RotateCcw, Plus, X } from 'lucide-react';
import {
  GameState, Grade, Player, PointReason, Skill, TeamSide,
  SKILLS_BY_ROLE, SKILL_SHORT, GRADE_LABEL, ROLE_LABEL, POINT_REASONS,
} from './types';
import { countsByPlayer, currentSetNumber, playerLabel, recyclesByPlayer, subsUsed } from './utils';

interface TrackingViewProps {
  gameState: GameState;
  onStat: (playerId: string, skill: Skill, grade: Grade, recycle?: boolean) => void;
  onPoint: (team: TeamSide, reason?: PointReason) => void;
  onSub: (inId: string, outId: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  feedback: string | null;
}

const ROLE_CHIP: Record<string, string> = {
  hitter: 'bg-primary/15 text-primary',
  setter: 'bg-secondary/20 text-secondary',
  libero: 'bg-accent/20 text-accent',
};

const GRADE_STYLE: Record<Grade, string> = {
  minus: 'bg-danger/15 text-danger border-danger/30 active:bg-danger active:text-white',
  zero: 'bg-white/5 text-white border-white/15 active:bg-white/30',
  plus: 'bg-success/15 text-success border-success/30 active:bg-success active:text-black',
};

export default function TrackingView({ gameState, onStat, onPoint, onSub, onUndo, canUndo, feedback }: TrackingViewProps) {
  const [pendingSwap, setPendingSwap] = useState<string | null>(null);
  const counts = countsByPlayer(gameState.events);
  const recycles = recyclesByPlayer(gameState.events);
  const setNum = currentSetNumber(gameState);
  const used = subsUsed(gameState.events, setNum);

  const indexed = gameState.players.map((p, i) => ({ p, i }));
  const court = indexed.filter(x => x.p.onCourt);
  const bench = indexed.filter(x => !x.p.onCourt);

  const pending = gameState.players.find(p => p.id === pendingSwap) || null;

  // Cancel a pending swap if that player disappears
  useEffect(() => {
    if (pendingSwap && !pending) setPendingSwap(null);
  }, [pendingSwap, pending]);

  const handleSwapTap = (p: Player) => {
    if (!pending) { setPendingSwap(p.id); return; }
    if (pending.id === p.id) { setPendingSwap(null); return; }
    if (pending.onCourt === p.onCourt) { setPendingSwap(p.id); return; } // switch selection on same side
    const inP = pending.onCourt ? p : pending;
    const outP = pending.onCourt ? pending : p;
    onSub(inP.id, outP.id);
    setPendingSwap(null);
  };

  const renderCard = ({ p, i }: { p: Player; i: number }) => {
    const skills = SKILLS_BY_ROLE[p.role];
    const isPending = pendingSwap === p.id;
    const isTarget = pending && pending.onCourt !== p.onCourt;
    return (
      <motion.div
        key={p.id}
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        className={`rounded-2xl border-2 p-3 transition-colors ${
          isPending ? 'border-primary bg-primary/10' :
          isTarget ? 'border-primary/40 border-dashed bg-white/5' :
          p.onCourt ? 'border-white/10 bg-white/5' : 'border-white/5 bg-white/[0.02]'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`font-black italic uppercase leading-none text-base sm:text-lg truncate ${p.onCourt ? '' : 'opacity-60'}`}>
              {playerLabel(p, i)}
            </span>
            <span className={`shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${ROLE_CHIP[p.role]}`}>
              {ROLE_LABEL[p.role]}
            </span>
          </div>
          <button
            onClick={() => handleSwapTap(p)}
            className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all active:scale-95 ${
              isPending ? 'bg-primary text-black border-primary' :
              isTarget ? 'bg-primary/20 text-primary border-primary/40' :
              'text-white/40 border-white/10'
            }`}
          >
            <ArrowLeftRight className="w-3 h-3" />
            {isTarget ? (p.onCourt ? 'Out' : 'In') : 'Sub'}
          </button>
        </div>
        <div className="space-y-1.5">
          {skills.map(skill => (
            <div key={skill} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/40">{SKILL_SHORT[skill]}</span>
              <div className={`flex-1 grid gap-1.5 ${skill === 'attack' ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {(skill === 'attack' ? ['minus', 'recycle', 'zero', 'plus'] : ['minus', 'zero', 'plus']).map(key => {
                  const isRecycle = key === 'recycle';
                  const g: Grade = isRecycle ? 'zero' : key as Grade;
                  // 0 count excludes recycles (stored as 0 attempts)
                  const n = isRecycle ? (recycles[p.id] ?? 0)
                    : g === 'zero' && skill === 'attack' ? (counts[p.id]?.attack?.zero ?? 0) - (recycles[p.id] ?? 0)
                    : counts[p.id]?.[skill]?.[g] ?? 0;
                  return (
                    <button
                      key={key}
                      onClick={() => onStat(p.id, skill, g, isRecycle)}
                      className={`relative h-11 rounded-xl border font-black text-lg transition-all active:scale-90 ${isRecycle ? 'bg-accent/15 text-accent border-accent/30 active:bg-accent active:text-black' : GRADE_STYLE[g]}`}
                    >
                      {isRecycle ? '↺' : GRADE_LABEL[g]}
                      {n > 0 && (
                        <span className="absolute top-0.5 right-1.5 text-[9px] font-mono font-bold opacity-60">{n}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-y-auto pb-32 gap-4">
      {/* Opponent actions: keep the score right when no stat of ours covers the point */}
      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest font-bold text-white/30">Opponent</div>
        <div className="grid grid-cols-2 gap-2">
          {POINT_REASONS.map(r => (
            <button key={r.reason} onClick={() => onPoint(r.team, r.reason)}
              className={`py-3 px-2 rounded-2xl font-black uppercase tracking-tight text-[11px] leading-tight active:scale-95 transition-all ${
                r.team === 'opponent' ? 'bg-secondary text-black' : 'bg-primary text-black'
              }`}>
              {r.label}
              <span className="block text-[9px] font-bold opacity-60 mt-0.5 normal-case tracking-wider">
                {r.team === 'opponent' ? '+1 them' : '+1 us'}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onPoint('own')}
            className="py-2 rounded-xl border border-primary/30 text-primary font-bold uppercase text-[10px] tracking-wider flex items-center justify-center gap-1 active:scale-95 transition-all">
            <Plus className="w-3 h-3" /> Other point us
          </button>
          <button onClick={() => onPoint('opponent')}
            className="py-2 rounded-xl border border-secondary/30 text-secondary font-bold uppercase text-[10px] tracking-wider flex items-center justify-center gap-1 active:scale-95 transition-all">
            <Plus className="w-3 h-3" /> Other point them
          </button>
        </div>
      </section>

      {/* Undo + subs + auto-score */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={onUndo} disabled={!canUndo}
          className="text-[10px] font-bold uppercase text-primary border border-primary/30 px-3 py-1.5 rounded-lg active:scale-95 flex items-center gap-1 disabled:opacity-30">
          <RotateCcw className="w-3 h-3" /> Undo
        </button>
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
          <span className={used >= gameState.subLimit ? 'text-danger' : 'text-white/40'}>
            Subs {used}/{gameState.subLimit}
          </span>
          <span className="text-white/20">|</span>
          <span className={gameState.autoScore ? 'text-success/70' : 'text-white/30'}>
            Auto-score {gameState.autoScore ? 'on' : 'off'}
          </span>
        </div>
      </div>

      {/* Pending sub banner */}
      <AnimatePresence>
        {pending && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs font-bold uppercase">
            <span>
              {pending.onCourt ? 'Sub out' : 'Sub in'} {playerLabel(pending)}: tap {pending.onCourt ? 'a bench player' : 'a court player'}
            </span>
            <button onClick={() => setPendingSwap(null)} className="p-1"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* On court */}
      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest font-bold text-white/30">On court ({court.length})</div>
        <div className="grid gap-2 lg:grid-cols-2">
          {court.length === 0
            ? <div className="text-xs text-white/30 border border-dashed border-white/10 rounded-xl p-6 text-center">Nobody on court. Tap Sub on a bench player.</div>
            : court.map(renderCard)}
        </div>
      </section>

      {/* Bench */}
      {bench.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/30">Bench ({bench.length})</div>
          <div className="grid gap-2 lg:grid-cols-2">{bench.map(renderCard)}</div>
        </section>
      )}

      {/* Tap feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0 } }}
            className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-white text-black text-xs font-black uppercase tracking-wider shadow-2xl whitespace-nowrap">
            {feedback}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
