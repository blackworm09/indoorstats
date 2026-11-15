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

export function LineupSheet({ players, setNum, initial, court, setInProgress, onSave, onRotate, onClose }: LineupSheetProps) {
  const [lineup, setLineup] = useState<SetLineup>(initial);
  const [slot, setSlot] = useState<number | null>(() => {
    const firstEmpty = initial.positions.findIndex(p => !p);
    return firstEmpty >= 0 ? firstEmpty + 1 : null;
  });

  const liberos = players.filter(p => p.role === 'libero');
  const courtPlayers = players.filter(p => p.role !== 'libero');
  const filled = lineup.positions.filter(Boolean).length;
  const canSave = filled === 6 && lineup.firstServe !== null;

  const assign = (playerId: string) => {
    if (slot === null) return;
    const positions = [...lineup.positions];
    const existing = positions.indexOf(playerId);
    // Already in another spot: swap the two
    if (existing >= 0) positions[existing] = positions[slot - 1];
    positions[slot - 1] = playerId;
    const stillOn = (id: string) => positions.includes(id);
    const replaces = lineup.liberoReplaces.filter(stillOn);
    setLineup({ ...lineup, positions, liberoReplaces: replaces });
    // Jump to the next empty spot
    const nextEmpty = positions.findIndex(p => !p);
    setSlot(nextEmpty >= 0 ? nextEmpty + 1 : null);
  };

  const toggleReplace = (id: string) => {
    const has = lineup.liberoReplaces.includes(id);
    const replaces = has ? lineup.liberoReplaces.filter(x => x !== id) : [...lineup.liberoReplaces, id].slice(-2);
    setLineup({ ...lineup, liberoReplaces: replaces });
  };

  const setServe = (t: TeamSide) => setLineup({ ...lineup, firstServe: t });

  const label = (id: string | null) => {
    if (!id) return null;
    const i = players.findIndex(p => p.id === id);
    return i >= 0 ? playerLabel(players[i], i) : null;
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xl">
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        className="bg-surface border border-white/10 p-5 sm:p-7 rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl space-y-5 max-h-[92dvh] overflow-y-auto">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-2xl font-black italic uppercase tracking-tighter text-primary">Set {setNum} Lineup</h3>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">Tap a spot, then a player</p>
          </div>
          {onClose && <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X className="w-6 h-6" /></button>}
        </div>

        {/* Live correction while the set is under way */}
        {setInProgress && court && (
          <div className="rounded-2xl border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Court out of sync? Rotation {court.rotation ?? '–'}</span>
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
            <p className="text-[10px] text-white/30">Changing the starting lineup below re-calculates the whole set.</p>
          </div>
        )}

        {/* Starting lineup court */}
        <div className="space-y-1.5">
          <div className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-white/30 border-b-2 border-white/20 pb-1">Net</div>
          {COURT_LAYOUT.map((row, r) => (
            <div key={r} className="grid grid-cols-3 gap-1.5">
              {row.map(pos => {
                const id = lineup.positions[pos - 1];
                const p = players.find(pp => pp.id === id);
                return (
                  <button key={pos} onClick={() => setSlot(pos)}
                    className={`h-16 rounded-xl border-2 px-2 text-left transition-all active:scale-95 ${slot === pos ? 'border-primary bg-primary/10' : id ? 'border-white/15 bg-white/5' : 'border-dashed border-white/15'}`}>
                    <span className="block text-[9px] font-mono font-bold text-white/40">P{pos}{pos === 1 ? ' · serve' : ''}</span>
                    <span className="block text-xs font-black uppercase truncate">{label(id) ?? <span className="text-white/25">Tap</span>}</span>
                    {p && <span className="block text-[9px] font-bold text-white/30">{ROLE_SHORT[p.role]}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Player picker for the selected spot */}
        {slot !== null && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Who plays P{slot}?</div>
            <div className="grid grid-cols-3 gap-1.5">
              {courtPlayers.map(p => {
                const i = players.findIndex(pp => pp.id === p.id);
                const at = lineup.positions.indexOf(p.id);
                return (
                  <button key={p.id} onClick={() => assign(p.id)}
                    className={`rounded-lg px-2 py-2 text-left border transition-all active:scale-95 ${at >= 0 ? 'border-white/5 bg-white/[0.02] opacity-50' : 'border-white/10 bg-white/5'}`}>
                    <span className="block text-[11px] font-black uppercase truncate">{playerLabel(p, i)}</span>
                    <span className="block text-[9px] font-bold text-white/30">{ROLE_SHORT[p.role]}{at >= 0 ? ` · P${at + 1}` : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Libero */}
        <div className="space-y-2 border-t border-white/5 pt-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Libero</div>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...liberos.map(l => l.id)].map(id => (
              <button key={id ?? 'none'} onClick={() => setLineup({ ...lineup, liberoId: id })}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase border ${lineup.liberoId === id ? 'bg-accent text-black border-accent' : 'border-white/10 text-white/50'}`}>
                {id ? label(id) : 'No libero'}
              </button>
            ))}
          </div>
          {lineup.liberoId && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 pt-1">Libero replaces (back row, max 2)</div>
              <div className="flex flex-wrap gap-1.5">
                {lineup.positions.filter((id): id is string => !!id).map(id => {
                  const p = players.find(pp => pp.id === id)!;
                  const on = lineup.liberoReplaces.includes(id);
                  return (
                    <button key={id} onClick={() => toggleReplace(id)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase border ${on ? 'bg-accent/20 text-accent border-accent/40' : 'border-white/10 text-white/50'}`}>
                      {label(id)} <span className="opacity-60">{ROLE_SHORT[p.role]}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-white/30">She comes in when they rotate to the back row. If they're in P1 while we serve, they serve first.</p>
            </>
          )}
        </div>

        {/* First serve */}
        <div className="space-y-2 border-t border-white/5 pt-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Who serves first?</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setServe('own')}
              className={`py-3 rounded-xl font-black uppercase text-sm border-2 ${lineup.firstServe === 'own' ? 'bg-primary text-black border-primary' : 'border-white/10 text-white/60'}`}>We serve</button>
            <button onClick={() => setServe('opponent')}
              className={`py-3 rounded-xl font-black uppercase text-sm border-2 ${lineup.firstServe === 'opponent' ? 'bg-secondary text-black border-secondary' : 'border-white/10 text-white/60'}`}>They serve</button>
          </div>
        </div>

        <button onClick={() => canSave && onSave(lineup)} disabled={!canSave}
          className="w-full p-4 bg-primary text-black rounded-2xl font-black uppercase text-xs tracking-widest active:scale-95 transition-all disabled:opacity-30">
          {filled < 6 ? `Fill all 6 spots (${filled}/6)` : lineup.firstServe === null ? 'Pick who serves first' : 'Save Lineup'}
        </button>
      </motion.div>
    </div>
  );
}
