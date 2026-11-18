import { GameState, MatchEvent, SetLineup, TeamSide } from './types';

// Rotate one step clockwise (side-out): P2 -> P1, P3 -> P2, ..., P1 -> P6
function rotate(positions: (string | null)[], delta: number): (string | null)[] {
  const n = 6;
  const d = ((delta % n) + n) % n;
  return positions.map((_, i) => positions[(i + d) % n]);
}

export interface CourtState {
  hasLineup: boolean;
  positions: (string | null)[];   // base occupants P1..P6 (no libero)
  display: (string | null)[];     // who is physically there, libero applied
  liberoId: string | null;
  liberoReplaces: string[];
  liberoSlot: number | null;      // 1-6 where the libero currently is
  serving: TeamSide | null;       // who serves the next rally
  rotation: number | null;        // setter's position (1-6)
}

const isScoring = (e: MatchEvent): TeamSide | null =>
  e.kind === 'point' ? e.team : e.kind === 'stat' ? e.point : null;

function applyLibero(base: (string | null)[], liberoId: string | null, replaces: string[], serving: TeamSide | null) {
  const display = [...base];
  let liberoSlot: number | null = null;
  if (liberoId) {
    // Back row = P1 (idx 0), P6 (idx 5), P5 (idx 4). The replaced player serves herself from P1.
    for (const idx of [0, 5, 4]) {
      const id = base[idx];
      if (!id || !replaces.includes(id)) continue;
      if (idx === 0 && serving === 'own') continue;
      display[idx] = liberoId;
      liberoSlot = idx + 1;
      break;
    }
  }
  return { display, liberoSlot };
}

function rotationOf(state: GameState, base: (string | null)[]): number | null {
  const idx = base.findIndex(id => id && state.players.find(p => p.id === id)?.role === 'setter');
  return idx >= 0 ? idx + 1 : null;
}

// Replay a set's events on top of its starting lineup.
// uptoExclusive: only replay events before this index of state.events (for "state at the time of event X")
export function courtState(state: GameState, set: number, uptoExclusive?: number): CourtState {
  const lineup: SetLineup | undefined = state.lineups?.[set];
  if (!lineup) {
    return { hasLineup: false, positions: [null, null, null, null, null, null], display: [null, null, null, null, null, null], liberoId: null, liberoReplaces: [], liberoSlot: null, serving: null, rotation: null };
  }
  let positions = [...lineup.positions];
  let liberoId = lineup.liberoId;
  let libero2Id = lineup.libero2Id ?? null;
  let replaces = [...lineup.liberoReplaces];
  let serving: TeamSide | null = lineup.firstServe;

  const end = uptoExclusive ?? state.events.length;
  for (let i = 0; i < end; i++) {
    const e = state.events[i];
    if (e.set !== set) continue;
    if (e.kind === 'sub') {
      if (e.outId === liberoId) { liberoId = e.inId; continue; }
      if (e.outId === libero2Id) { libero2Id = e.inId; continue; }
      positions = positions.map(id => (id === e.outId ? e.inId : id));
      replaces = replaces.map(id => (id === e.outId ? e.inId : id)); // sub inherits the libero swap
      continue;
    }
    if (e.kind === 'rotate') { positions = rotate(positions, e.delta); continue; }
    const winner = isScoring(e);
    if (winner) {
      if (serving === 'opponent' && winner === 'own') positions = rotate(positions, 1); // side-out
      serving = winner;
    }
  }

  // Two liberos by phase: defence libero when we serve, receive libero when they serve
  const active = serving === 'own' && libero2Id ? libero2Id : liberoId;
  const { display, liberoSlot } = applyLibero(positions, active, replaces, serving);
  return { hasLineup: true, positions, display, liberoId: active, liberoReplaces: replaces, liberoSlot, serving, rotation: rotationOf(state, positions) };
}

export function positionOf(court: CourtState, playerId: string): number | null {
  const i = court.display.indexOf(playerId);
  return i >= 0 ? i + 1 : null;
}

// One entry per point in the set: rotation + who served, for the per-rotation report
export interface PointLog { set: number; rotation: number | null; serving: TeamSide | null; winner: TeamSide }

export function pointLog(state: GameState): PointLog[] {
  const out: PointLog[] = [];
  const sets = Array.from(new Set(state.events.map(e => e.set)));
  for (const set of sets) {
    const lineup = state.lineups?.[set];
    if (!lineup) continue;
    let positions = [...lineup.positions];
    let serving: TeamSide | null = lineup.firstServe;
    let liberoId = lineup.liberoId;
    for (const e of state.events) {
      if (e.set !== set) continue;
      if (e.kind === 'sub') {
        if (e.outId === liberoId) { liberoId = e.inId; continue; }
        positions = positions.map(id => (id === e.outId ? e.inId : id));
        continue;
      }
      if (e.kind === 'rotate') { positions = rotate(positions, e.delta); continue; }
      const winner = isScoring(e);
      if (!winner) continue;
      out.push({ set, rotation: rotationOf(state, positions), serving, winner });
      if (serving === 'opponent' && winner === 'own') positions = rotate(positions, 1);
      serving = winner;
    }
  }
  return out;
}

// Set 1 starts empty. Later sets start from the previous set's lineup (first serve unset).
export function defaultLineup(state: GameState, set: number): SetLineup {
  const prev = set > 1 ? state.lineups?.[set - 1] : undefined;
  if (prev) return { ...prev, positions: [...prev.positions], liberoReplaces: [...prev.liberoReplaces], firstServe: null };
  // No lineup yet: preselect the roster's liberos (two = by phase)
  const libs = state.players.filter(p => p.role === 'libero').map(p => p.id);
  return { positions: [null, null, null, null, null, null], liberoId: libs[0] ?? null, libero2Id: libs[1] ?? null, liberoReplaces: [], firstServe: null };
}
