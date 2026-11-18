import { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, RotateCw, X } from 'lucide-react';
import { COURT_LAYOUT, Player, ROLE_SHORT, SetLineup, TeamSide } from './types';
import { CourtState } from './court';
import { playerLabel } from './utils';

const shortName = (players: Player[], id: string | null) => {
  if (!id) return '';
  const i = players.findIndex(p => p.id === id);
  if (i < 0) return '';
  const p = players[i];
  return p.name.trim() ? p.name.trim() : playerLabel(p, i);
};

// Small read-only court for the top of the tracking screens
export function CourtMini({ players, court, onOpen }: { players: Player[]; court: CourtState; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 active:scale-[0.99] transition-all">
      <div className="flex justify-between items-center mb-1.5 px-0.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-primary">
          Rotation {court.rotation ?? '–'}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">
          {court.serving === 'own' ? 'We serve' : court.serving === 'opponent' ? 'They serve' : ''} · Lineup
        </span>
      </div>
      <div className="grid grid-rows-2 gap-1">
        {COURT_LAYOUT.map((row, r) => (
          <div key={r} className="grid grid-cols-3 gap-1">
            {row.map(pos => {
              const id = court.display[pos - 1];
              const isLibero = id !== null && id === court.liberoId;
              return (
                <div key={pos} className={`rounded-lg px-2 py-1 flex items-baseline gap-1.5 min-w-0 ${isLibero ? 'bg-accent/15' : pos === 1 && court.serving === 'own' ? 'bg-primary/15' : 'bg-white/5'}`}>
                  <span className="text-[9px] font-mono font-bold text-white/30">P{pos}</span>
                  <span className={`text-[11px] font-black uppercase truncate ${isLibero ? 'text-accent' : ''}`}>{shortName(players, id) || '–'}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </button>
  );
}

interface LineupSheetProps {
  players: Player[];
  setNum: number;
  initial: SetLineup;
  court: CourtState | null;     // live court when the set is under way
  setInProgress: boolean;
  onSave: (lineup: SetLineup) => void;
  onRotate: (delta: number) => void;
  onClose: (() => void) | null; // null = must set a lineup first
}

type Step = 1 | 2 | 3;
// Fill order follows the court as you see it: front row P4 P3 P2, then back row P5 P6 P1
const FILL_ORDER = COURT_LAYOUT.flat();
const nextEmpty = (positions: (string | null)[], after: number | null) => {
  const start = after === null ? 0 : FILL_ORDER.indexOf(after) + 1;
  for (let k = 0; k < FILL_ORDER.length; k++) {
    const pos = FILL_ORDER[(start + k) % FILL_ORDER.length];
    if (!positions[pos - 1]) return pos;
  }
  return null;
};

export function LineupSheet({ players, setNum, initial, court, setInProgress, onSave, onRotate, onClose }: LineupSheetProps) {
  const [lineup, setLineup] = useState<SetLineup>(initial);
  const [step, setStep] = useState<Step>(1);
  const [slot, setSlot] = useState<number | null>(() => nextEmpty(initial.positions, null));

  const liberos = players.filter(p => p.role === 'libero');
  const courtPlayers = players.filter(p => p.role !== 'libero');
  const filled = lineup.positions.filter(Boolean).length;

  const label = (id: string | null) => {
    if (!id) return null;
    const i = players.findIndex(p => p.id === id);
    return i >= 0 ? playerLabel(players[i], i) : null;
  };

  const assign = (playerId: string) => {
    if (slot === null) return;
    const positions = [...lineup.positions];
    const existing = positions.indexOf(playerId);
    if (existing >= 0) positions[existing] = positions[slot - 1]; // already placed: swap the two spots
    positions[slot - 1] = playerId;
    setLineup({ ...lineup, positions, liberoReplaces: lineup.liberoReplaces.filter(id => positions.includes(id)) });
    setSlot(nextEmpty(positions, slot)); // keep the picker open on the next empty spot
  };

  const clearSpot = () => {
    if (slot === null) return;
    const positions = [...lineup.positions];
    const removed = positions[slot - 1];
    positions[slot - 1] = null;
    setLineup({ ...lineup, positions, liberoReplaces: lineup.liberoReplaces.filter(id => id !== removed) });
    setSlot(null);
  };

  const toggleReplace = (id: string) => {
    const has = lineup.liberoReplaces.includes(id);
    const replaces = has ? lineup.liberoReplaces.filter(x => x !== id) : [...lineup.liberoReplaces, id].slice(-2);
    setLineup({ ...lineup, liberoReplaces: replaces });
  };

  const canNext: Record<Step, boolean> = {
    1: filled === 6,
    2: !lineup.liberoId || lineup.liberoReplaces.length > 0,
    3: lineup.firstServe !== null,
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xl">
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        className="bg-surface border border-white/10 p-5 sm:p-7 rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl space-y-5 max-h-[92dvh] overflow-y-auto">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-2xl font-black italic uppercase tracking-tighter text-primary">Set {setNum} Lineup</h3>
          </div>
          {onClose && <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X className="w-6 h-6" /></button>}
        </div>

        {/* STEP 1: starting six */}
        {step === 1 && (
          <>
            {setInProgress && court && (
              <div className="rounded-2xl border border-white/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Now R{court.rotation ?? '–'}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => onRotate(-1)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 text-[10px] font-bold uppercase active:scale-95">
                      <RotateCcw className="w-3 h-3" /> Back
                    </button>
                    <button onClick={() => onRotate(1)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 text-[10px] font-bold uppercase active:scale-95">
                      <RotateCw className="w-3 h-3" /> Rotate
                    </button>
                  </div>
                </div>
                <div className="grid grid-rows-2 gap-1">
                  {COURT_LAYOUT.map((row, r) => (
                    <div key={r} className="grid grid-cols-3 gap-1">
                      {row.map(pos => (
                        <div key={pos} className={`rounded-lg px-2 py-1 text-[11px] font-black uppercase truncate ${court.display[pos - 1] === court.liberoId ? 'bg-accent/15 text-accent' : 'bg-white/5'}`}>
                          <span className="text-[9px] font-mono text-white/30 mr-1">P{pos}</span>{label(court.display[pos - 1]) ?? '–'}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-white/30 border-b-2 border-white/20 pb-1">Net</div>
              {COURT_LAYOUT.map((row, r) => (
                <div key={r} className="grid grid-cols-3 gap-1.5">
                  {row.map(pos => {
                    const id = lineup.positions[pos - 1];
                    const p = players.find(pp => pp.id === id);
                    return (
                      <button key={pos} onClick={() => setSlot(slot === pos ? null : pos)}
                        className={`h-16 rounded-xl border-2 px-2 text-left transition-all active:scale-95 ${slot === pos ? 'border-primary bg-primary/10' : id ? 'border-white/15 bg-white/5' : 'border-dashed border-white/20'}`}>
                        <span className="block text-[9px] font-mono font-bold text-white/40">P{pos}</span>
                        <span className="block text-xs font-black uppercase truncate">{label(id) ?? <span className="text-white/25">+ Add</span>}</span>
                        {p && <span className="block text-[9px] font-bold text-white/30">{ROLE_SHORT[p.role]}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {slot !== null && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                  {courtPlayers.map(p => {
                    const i = players.findIndex(pp => pp.id === p.id);
                    const at = lineup.positions.indexOf(p.id);
                    return (
                      <button key={p.id} onClick={() => assign(p.id)}
                        className={`rounded-lg px-2 py-2 text-left border transition-all active:scale-95 ${at >= 0 ? 'border-white/5 bg-white/[0.02] opacity-40' : 'border-white/10 bg-white/5'}`}>
                        <span className="block text-[11px] font-black uppercase truncate">{playerLabel(p, i)}</span>
                        <span className="block text-[9px] font-bold text-white/30">{ROLE_SHORT[p.role]}{at >= 0 ? ` · in P${at + 1}` : ''}</span>
                      </button>
                    );
                  })}
                </div>
                {lineup.positions[slot - 1] && (
                  <button onClick={clearSpot} className="text-[10px] font-bold uppercase tracking-widest text-white/40 underline">Clear P{slot}</button>
                )}
              </div>
            )}

            {filled > 0 && slot === null && (
              <button onClick={() => setLineup({ ...lineup, positions: [null, null, null, null, null, null], liberoReplaces: [] })}
                className="text-[10px] font-bold uppercase tracking-widest text-white/40 underline">Clear all</button>
            )}
          </>
        )}

        {/* STEP 2: libero */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {[...liberos.map(l => l.id), null].map(id => (
                  <button key={id ?? 'none'} onClick={() => setLineup({ ...lineup, liberoId: id, liberoReplaces: id ? lineup.liberoReplaces : [] })}
                    className={`px-3 py-2 rounded-lg text-xs font-bold uppercase border ${lineup.liberoId === id ? 'bg-primary text-black border-primary' : 'border-white/10 text-white/60'}`}>
                    {id ? label(id) : 'No libero'}
                  </button>
                ))}
              </div>
              {liberos.length === 0 && <p className="text-[10px] text-white/30">No libero in roster.</p>}
            </div>
            {lineup.liberoId && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {lineup.positions.map((id, k) => {
                    if (!id) return null;
                    const p = players.find(pp => pp.id === id)!;
                    const on = lineup.liberoReplaces.includes(id);
                    return (
                      <button key={id} onClick={() => toggleReplace(id)}
                        className={`rounded-lg px-2 py-2 text-left border-2 transition-all active:scale-95 ${on ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5'}`}>
                        <span className="block text-[9px] font-mono text-white/40">P{k + 1}</span>
                        <span className={`block text-[11px] font-black uppercase truncate ${on ? 'text-primary' : ''}`}>{label(id)}</span>
                        <span className="block text-[9px] font-bold text-white/30">{ROLE_SHORT[p.role]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: first serve */}
        {step === 3 && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setLineup({ ...lineup, firstServe: 'own' })}
                className={`py-5 rounded-xl font-black uppercase text-base border-2 ${lineup.firstServe === 'own' ? 'bg-primary text-black border-primary' : 'border-white/10 text-white/60'}`}>We serve</button>
              <button onClick={() => setLineup({ ...lineup, firstServe: 'opponent' })}
                className={`py-5 rounded-xl font-black uppercase text-base border-2 ${lineup.firstServe === 'opponent' ? 'bg-secondary text-black border-secondary' : 'border-white/10 text-white/60'}`}>They serve</button>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-2">
          {step > 1 && (
            <button onClick={() => setStep((step - 1) as Step)}
              className="px-5 py-4 border border-white/10 text-white/60 rounded-2xl font-bold uppercase text-xs tracking-widest">Back</button>
          )}
          {step < 3 ? (
            <button onClick={() => canNext[step] && setStep((step + 1) as Step)} disabled={!canNext[step]}
              className="flex-1 p-4 bg-primary text-black rounded-2xl font-black uppercase text-xs tracking-widest active:scale-95 transition-all disabled:opacity-30">
              {step === 1 && filled < 6 ? `Next · ${filled}/6` : 'Next'}
            </button>
          ) : (
            <button onClick={() => canNext[3] && filled === 6 && onSave(lineup)} disabled={!canNext[3] || filled < 6}
              className="flex-1 p-4 bg-primary text-black rounded-2xl font-black uppercase text-xs tracking-widest active:scale-95 transition-all disabled:opacity-30">
              Save
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
