import { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, RotateCw, X } from 'lucide-react';
import { COURT_LAYOUT, Player, Role, ROLE_SHORT, SetLineup } from './types';
import { playerLabel } from './utils';
import { InfoDot } from './RallyView';

interface LineupSheetProps {
  players: Player[];
  setNum: number;
  initial: SetLineup;
  onSave: (lineup: SetLineup) => void;
  onClose: (() => void) | null; // null = must set a lineup first
}

type Step = 1 | 2; // first serve is picked on the live screen when tracking starts

// After a pick, move counterclockwise around the court (rotation order): P1 → P2 → … → P6 → P1
const nextEmpty = (positions: (string | null)[], after: number) => {
  for (let k = 1; k <= 6; k++) {
    const pos = ((after - 1 + k) % 6) + 1;
    if (!positions[pos - 1]) return pos;
  }
  return null;
};

// 5-1 order around the court, counted from the setter: S, OH, MB, OPP, OH, MB
const ORDER_FROM_SETTER: Role[] = ['setter', 'outside', 'middle', 'opposite', 'outside', 'middle'];

// Which role fits a position: the first pick is the setter, then S, OH, MB, OPP, OH, MB around the court
function roleFor(players: Player[], positions: (string | null)[], pos: number): Role | null {
  const roleAt = (i: number) => players.find(p => p.id === positions[i])?.role;
  let setterIdx = positions.findIndex((_, i) => roleAt(i) === 'setter');
  if (setterIdx < 0) {
    const opp = positions.findIndex((_, i) => roleAt(i) === 'opposite');
    if (opp >= 0) setterIdx = (opp + 3) % 6;
  }
  if (setterIdx < 0) return positions.some(Boolean) ? null : 'setter'; // first pick = the setter
  return ORDER_FROM_SETTER[(pos - 1 - setterIdx + 6) % 6];
}

const nameOf = (players: Player[], id: string | null | undefined) => {
  if (!id) return null;
  const i = players.findIndex(p => p.id === id);
  if (i < 0) return null;
  return players[i].name.trim() || playerLabel(players[i], i);
};

export function LineupSheet({ players, setNum, initial, onSave, onClose }: LineupSheetProps) {
  const [lineup, setLineup] = useState<SetLineup>(initial);
  const [step, setStep] = useState<Step>(1);
  const [slot, setSlot] = useState<number | null>(null); // tap where the setter starts

  const liberos = players.filter(p => p.role === 'libero');
  const courtPlayers = players.filter(p => p.role !== 'libero');
  const filled = lineup.positions.filter(Boolean).length;
  const twoMode = !!lineup.libero2Id;

  const assign = (playerId: string) => {
    if (slot === null) return;
    const positions = [...lineup.positions];
    const existing = positions.indexOf(playerId);
    if (existing >= 0) positions[existing] = positions[slot - 1]; // already placed: swap the two spots
    positions[slot - 1] = playerId;
    setLineup({ ...lineup, positions, liberoReplaces: lineup.liberoReplaces.filter(id => positions.includes(id)) });
    setSlot(nextEmpty(positions, slot)); // picker stays open on the next empty spot
  };

  const clearSpot = () => {
    if (slot === null) return;
    const positions = [...lineup.positions];
    const removed = positions[slot - 1];
    positions[slot - 1] = null;
    setLineup({ ...lineup, positions, liberoReplaces: lineup.liberoReplaces.filter(id => id !== removed) });
  };

  const toggleReplace = (id: string) => {
    const has = lineup.liberoReplaces.includes(id);
    const replaces = has ? lineup.liberoReplaces.filter(x => x !== id) : [...lineup.liberoReplaces, id].slice(-2);
    setLineup({ ...lineup, liberoReplaces: replaces });
  };

  const goLibero = () => {
    // Middles are the usual swap: preselect them the first time
    if (lineup.liberoId && lineup.liberoReplaces.length === 0) {
      const middles = lineup.positions.filter(id => id && players.find(p => p.id === id)?.role === 'middle') as string[];
      setLineup({ ...lineup, liberoReplaces: middles.slice(0, 2) });
    }
    setStep(2);
  };

  const setMode = (two: boolean) => {
    if (!two) return setLineup({ ...lineup, libero2Id: null });
    const first = lineup.liberoId ?? liberos[0]?.id ?? null;
    const other = liberos.find(l => l.id !== first);
    setLineup({ ...lineup, liberoId: first, libero2Id: other?.id ?? null });
  };

  const canNext: Record<Step, boolean> = {
    1: filled === 6,
    2: !lineup.liberoId || (lineup.liberoReplaces.length > 0 && (!twoMode || lineup.libero2Id !== lineup.liberoId)),
  };

  // Same six, different starting rotation (+1 = everyone moves one spot, P2 → P1)
  const rotateLineup = (delta: number) => {
    const n = ((delta % 6) + 6) % 6;
    const positions = lineup.positions.map((_, i) => lineup.positions[(i + n) % 6]);
    setLineup({ ...lineup, positions });
    setSlot(null);
  };

  const slotRole = slot !== null ? roleFor(players, lineup.positions, slot) : null;
  const suggested = slotRole ? courtPlayers.filter(p => p.role === slotRole) : [];
  const others = courtPlayers.filter(p => !suggested.includes(p));

  const pickBtn = (p: Player, primary: boolean) => {
    const i = players.findIndex(pp => pp.id === p.id);
    const at = lineup.positions.indexOf(p.id);
    const here = slot !== null && at === slot - 1;
    return (
      <button key={p.id} onClick={() => assign(p.id)}
        className={`h-16 rounded-lg px-3.5 flex flex-col items-start justify-center transition-all active:scale-95 ${
          here ? 'border-[1.5px] border-primary bg-primary/10' : primary ? 'border-[1.5px] border-primary' : 'border border-line'
        } ${at >= 0 && !here ? 'opacity-35' : ''}`}>
        <span className="font-display text-lg font-bold uppercase leading-tight truncate max-w-full">{p.name.trim() || playerLabel(p, i)}</span>
        <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute">
          {p.number.trim() ? `#${p.number.trim()} · ` : ''}{ROLE_SHORT[p.role]}{at >= 0 && !here ? ` · P${at + 1}` : ''}
        </span>
      </button>
    );
  };

  const choice = (label: string, value: string, on: boolean, onClick: () => void, info?: string) => (
    <div className="relative">
      <button onClick={onClick}
        className={`w-full rounded-lg p-3.5 text-left flex flex-col gap-1 ${on ? 'border-[1.5px] border-primary' : 'border border-line'}`}>
        <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{label}</span>
        <span className="font-display text-xl font-bold uppercase">{value}</span>
      </button>
      {info && <span className="absolute top-3 right-3"><InfoDot light text={info} /></span>}
    </div>
  );

  const liberoRow = (label: string, current: string | null | undefined, onPick: (id: string | null) => void, allowNone: boolean, exclude?: string | null) => (
    <div className="space-y-2">
      <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{label}</span>
      <div className="flex flex-wrap gap-2">
        {liberos.map(l => (
          <button key={l.id} onClick={() => onPick(l.id)} disabled={l.id === exclude}
            className={`h-12 px-4 rounded-lg font-display text-base font-bold uppercase disabled:opacity-30 ${current === l.id ? 'border-[1.5px] border-primary text-primary' : 'border border-line'}`}>
            {nameOf(players, l.id)}{l.number.trim() ? <span className="text-mute text-xs ml-1.5">#{l.number.trim()}</span> : null}
          </button>
        ))}
        {allowNone && (
          <button onClick={() => onPick(null)}
            className={`h-12 px-4 rounded-lg font-display text-base font-bold uppercase ${!current ? 'border-[1.5px] border-primary text-primary' : 'border border-line text-mute'}`}>None</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-background flex flex-col">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
        className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">

        {/* COURT */}
        <section className="lg:w-[46%] p-5 lg:p-7 flex flex-col gap-5 border-b lg:border-b-0 lg:border-r border-line">
          <div className="flex items-center justify-between">
            <span className="font-display text-3xl font-bold tracking-[0.06em] uppercase">Set {setNum}</span>
            <div className="flex items-center gap-3">
              <span className="font-display text-sm font-bold tracking-[0.12em] text-mute">{step}/2</span>
              {onClose && <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-lg border border-line flex items-center justify-center"><X className="w-5 h-5" /></button>}
            </div>
          </div>
          <div className="border-t-[3px] border-ink pt-4">
            {COURT_LAYOUT.map((row, r) => (
              <div key={r} className={`grid grid-cols-3 gap-2 ${r === 1 ? 'mt-4 pt-4 border-t border-dashed border-line' : ''}`}>
                {row.map(pos => {
                  const id = lineup.positions[pos - 1];
                  const p = players.find(pp => pp.id === id);
                  const active = step === 1 && slot === pos;
                  const lib = step >= 2 && !!id && !!lineup.liberoId && lineup.liberoReplaces.includes(id);
                  const onClick = step === 1 ? () => setSlot(pos) : step === 2 && id && lineup.liberoId ? () => toggleReplace(id) : undefined;
                  return (
                    <button key={pos} onClick={onClick} disabled={!onClick} data-pos={pos}
                      className={`h-24 rounded-lg flex flex-col items-center justify-center gap-0.5 px-1 transition-all ${
                        active ? 'border-2 border-primary' : lib ? 'border-[1.5px] border-primary' : id ? 'border border-line' : 'border border-dashed border-mute'
                      }`}>
                      <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute">P{pos}</span>
                      {p ? (
                        <>
                          <span className="font-display text-xl font-bold uppercase leading-none truncate max-w-full">{nameOf(players, id)}</span>
                          <span className={`font-display text-[11px] font-bold tracking-[0.1em] ${lib ? 'text-primary' : 'text-mute'}`}>{lib ? 'L ✓' : ROLE_SHORT[p.role]}</span>
                        </>
                      ) : <span className={`font-display text-2xl font-medium ${active ? 'text-primary' : 'text-mute'}`}>+</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {step === 1 && filled === 6 && (
            <div className="flex items-center gap-2">
              <button onClick={() => rotateLineup(-1)} aria-label="Rotate back" className="h-10 px-3 rounded-lg border border-line font-display font-bold text-sm flex items-center gap-1.5"><RotateCcw className="w-4 h-4" /> −1</button>
              <button onClick={() => rotateLineup(1)} aria-label="Rotate forward" className="h-10 px-3 rounded-lg border border-line font-display font-bold text-sm flex items-center gap-1.5"><RotateCw className="w-4 h-4" /> +1</button>
              <span className="font-display text-xs font-bold tracking-[0.12em] uppercase text-mute ml-1">Rotation</span>
            </div>
          )}
          {step === 1 && filled > 0 && (
            <button onClick={() => { setLineup({ ...lineup, positions: [null, null, null, null, null, null], liberoReplaces: [] }); setSlot(null); }}
              className="self-start font-display text-xs font-bold tracking-[0.12em] uppercase text-mute underline">Clear all</button>
          )}
        </section>

        {/* PANEL */}
        <section className="flex-1 p-5 lg:p-7 flex flex-col gap-4 lg:overflow-y-auto">
          {step === 1 && slot !== null && (
            <>
              <div className="flex items-center justify-between">
                <span className="font-display text-3xl font-bold tracking-[0.06em] uppercase">P{slot}</span>
                {lineup.positions[slot - 1] && (
                  <button onClick={clearSpot} className="font-display text-xs font-bold tracking-[0.12em] uppercase text-mute underline">Clear P{slot}</button>
                )}
              </div>
              {suggested.length > 0 && (
                <>
                  <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-primary">Suggested</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{suggested.map(p => pickBtn(p, true))}</div>
                  <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute mt-2">Others</span>
                </>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{others.map(p => pickBtn(p, false))}</div>
            </>
          )}

          {step === 2 && (
            <>
              {liberos.length === 0 && <p className="text-mute">No libero in roster.</p>}
              {liberos.length >= 2 && (
                <div className="grid grid-cols-2 gap-2">
                  {choice('One libero', 'All set', !twoMode, () => setMode(false))}
                  {choice('Two liberos', 'By phase', twoMode, () => setMode(true), 'Receive libero when they serve, defence libero when we serve. The app swaps them.')}
                </div>
              )}
              {liberos.length > 0 && (twoMode ? (
                <>
                  {/* Picking the other libero swaps the two */}
                  {liberoRow('Receive', lineup.liberoId, id => setLineup({ ...lineup, liberoId: id, libero2Id: id === lineup.libero2Id ? lineup.liberoId : lineup.libero2Id }), false)}
                  {liberoRow('Defence', lineup.libero2Id, id => setLineup({ ...lineup, libero2Id: id, liberoId: id === lineup.liberoId ? lineup.libero2Id ?? null : lineup.liberoId }), false)}
                </>
              ) : liberoRow('Libero', lineup.liberoId, id => setLineup({ ...lineup, liberoId: id, libero2Id: null, liberoReplaces: id ? lineup.liberoReplaces : [] }), true))}
              {lineup.liberoId && (
                <div className="flex items-center justify-between mt-2">
                  <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">Replaces · {lineup.liberoReplaces.length}/2</span>
                  <InfoDot light text="Tap the players on the court the libero replaces in the back row (max 2)." />
                </div>
              )}
            </>
          )}

          <div className="mt-auto pt-4 flex gap-2">
            {step > 1 && (
              <button onClick={() => setStep((step - 1) as Step)}
                className="w-28 h-14 rounded-lg border border-line font-display text-base font-bold tracking-[0.12em] uppercase">Back</button>
            )}
            {step === 1 ? (
              <button onClick={() => canNext[1] && goLibero()} disabled={!canNext[1]}
                className="flex-1 h-14 rounded-lg bg-primary text-[#0D0F12] font-display text-lg font-bold tracking-[0.12em] uppercase disabled:opacity-35">
                {filled < 6 ? `Next · ${filled}/6` : 'Next'}
              </button>
            ) : (
              <button onClick={() => canNext[2] && filled === 6 && onSave(lineup)} disabled={!canNext[2] || filled < 6}
                className="flex-1 h-14 rounded-lg bg-primary text-[#0D0F12] font-display text-lg font-bold tracking-[0.12em] uppercase disabled:opacity-35">Save</button>
            )}
          </div>
        </section>
      </motion.div>
    </div>
  );
}
