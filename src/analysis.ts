// Stage 4: numbers for the Analysis tab
import { GameState, ScaleCode, StatEvent } from './types';
import { attackInfo, effOf, EffLine, N_MIN, Phase } from './alerts';
import { playerLabel, rotationTable } from './utils';
import { t } from './i18n';

export const inSet = (state: GameState, set: number | null): GameState =>
  set === null ? state : { ...state, events: state.events.filter(e => e.set === set) };

const stats = (state: GameState) => state.events.filter((e): e is StatEvent => e.kind === 'stat');
const nameOf = (state: GameState, id: string) => {
  const i = state.players.findIndex(p => p.id === id);
  return i >= 0 ? (state.players[i].name.trim() || playerLabel(state.players[i], i)) : '?';
};
const roleOf = (state: GameState, id: string) => state.players.find(p => p.id === id)?.role ?? 'outside';

// Older events only have −/0/#: map them onto the scale
const passCode = (e: StatEvent): ScaleCode => (e.code as ScaleCode) ?? (e.grade === 'plus' ? '+' : e.grade === 'minus' ? '=' : '!');
const serveCode = (e: StatEvent): ScaleCode => (e.code as ScaleCode) ?? (e.grade === 'plus' ? '#' : e.grade === 'minus' ? '=' : '!');

// ---------- Attack × rotation ----------
export interface HeatRow { id: string; name: string; role: string; byRot: EffLine[]; all: EffLine }

export function attackByRotation(state: GameState, set: number | null): { rows: HeatRow[]; sideOut: (number | null)[]; breakPt: (number | null)[]; so: [number, number][]; bp: [number, number][] } {
  const atk = stats(inSet(state, set)).filter(e => e.skill === 'attack');
  const ids = Array.from(new Set(atk.map(e => e.playerId)));
  const rows = ids.map(id => {
    const mine = atk.filter(e => e.playerId === id);
    return { id, name: nameOf(state, id), role: roleOf(state, id), byRot: [1, 2, 3, 4, 5, 6].map(r => effOf(mine.filter(e => e.rot === r))), all: effOf(mine) };
  }).sort((a, b) => b.all.att - a.all.att);
  const rot = rotationTable(state, set);
  return {
    rows,
    sideOut: rot.map(r => (r.soTotal ? r.soWon / r.soTotal : null)),
    breakPt: rot.map(r => (r.bpTotal ? r.bpWon / r.bpTotal : null)),
    so: rot.map(r => [r.soWon, r.soTotal]),
    bp: rot.map(r => [r.bpWon, r.bpTotal]),
  };
}

// ---------- Attack × pass phase ----------
export interface PhaseRow { id: string; name: string; byPhase: Record<Phase, EffLine> }

export function attackByPhase(state: GameState, set: number | null): PhaseRow[] {
  const info = attackInfo(inSet(state, set));
  const line = (list: typeof info): Record<Phase, EffLine> => ({
    in: effOf(list.filter(a => a.phase === 'in').map(a => a.ev)),
    out: effOf(list.filter(a => a.phase === 'out').map(a => a.ev)),
    transition: effOf(list.filter(a => a.phase === 'transition').map(a => a.ev)),
  });
  const ids = Array.from(new Set(info.map(a => a.ev.playerId)));
  const rows = ids.map(id => ({ id, name: nameOf(state, id), byPhase: line(info.filter(a => a.ev.playerId === id)) }))
    .sort((a, b) => (b.byPhase.in.att + b.byPhase.out.att + b.byPhase.transition.att) - (a.byPhase.in.att + a.byPhase.out.att + a.byPhase.transition.att));
  return info.length ? [{ id: 'team', name: t('Team'), byPhase: line(info) }, ...rows] : [];
}

// ---------- Pass + serve on the scale ----------
export interface ScaleRow { id: string; name: string; n: number; counts: Record<ScaleCode, number> }
const emptyCounts = (): Record<ScaleCode, number> => ({ '=': 0, '/': 0, '-': 0, '!': 0, '+': 0, '#': 0 });

function scaleRows(state: GameState, set: number | null, skill: 'pass' | 'serve'): ScaleRow[] {
  const list = stats(inSet(state, set)).filter(e => e.skill === skill);
  const code = skill === 'pass' ? passCode : serveCode;
  const build = (id: string, name: string, evs: StatEvent[]): ScaleRow => {
    const counts = emptyCounts();
    evs.forEach(e => { counts[code(e)]++; });
    return { id, name, n: evs.length, counts };
  };
  const ids = Array.from(new Set(list.map(e => e.playerId)));
  const rows = ids.map(id => build(id, nameOf(state, id), list.filter(e => e.playerId === id))).sort((a, b) => b.n - a.n);
  return list.length ? [build('team', t('Team'), list), ...rows] : [];
}
export const passRows = (s: GameState, set: number | null) => scaleRows(s, set, 'pass');
export const serveRows = (s: GameState, set: number | null) => scaleRows(s, set, 'serve');

// ---------- Setter ----------
export function setterRows(state: GameState, set: number | null) {
  const list = stats(inSet(state, set)).filter(e => e.skill === 'set');
  return Array.from(new Set(list.map(e => e.playerId))).map(id => {
    const l = effOf(list.filter(e => e.playerId === id));
    return { id, name: nameOf(state, id), att: l.att, assists: l.kills, eff: l.eff };
  });
}

// ---------- Where points come from ----------
export function pointSources(state: GameState, set: number | null) {
  const s = inSet(state, set);
  const st = stats(s);
  const pts = s.events.filter(e => e.kind === 'point');
  const count = (f: (e: StatEvent) => boolean) => st.filter(f).length;
  const reason = (r: string) => pts.filter(e => e.kind === 'point' && e.reason === r).length;
  const other = (team: 'own' | 'opponent') => pts.filter(e => e.kind === 'point' && e.team === team && (!e.reason || e.reason === 'other')).length;
  const atkCode = (e: StatEvent) => e.code ?? (e.grade === 'plus' ? 'kill' : e.grade === 'minus' ? 'err' : 'play');
  return {
    won: [
      ['Attack kills', count(e => e.skill === 'attack' && atkCode(e) === 'kill')],
      ['Aces', count(e => e.skill === 'serve' && serveCode(e) === '#')],
      ['Blocks', reason('opp_blocked')],
      ['Their attack errors', reason('opp_attack_error')],
      ['Their serve errors', reason('opp_serve_error')],
      ['Their other faults', other('own')],
    ] as [string, number][],
    lost: [
      ['Their kills', reason('opp_attack_point')],
      ['Their aces', reason('opp_ace')],
      ['Our attack errors', count(e => e.skill === 'attack' && atkCode(e) === 'err')],
      ['Our attacks blocked', count(e => e.skill === 'attack' && atkCode(e) === 'blk')],
      ['Our serve errors', count(e => e.skill === 'serve' && serveCode(e) === '=')],
      ['Unforced errors', reason('own_error')],
      ['Our other faults', other('opponent')],
    ] as [string, number][],
  };
}

// ---------- Sorting: best to worst, players under N_MIN at the bottom ----------
export function bestFirst<T>(rows: T[], line: (r: T) => EffLine): T[] {
  return [...rows].sort((a, b) => {
    const la = line(a), lb = line(b);
    const qa = la.att >= N_MIN ? 1 : 0, qb = lb.att >= N_MIN ? 1 : 0;
    if (qa !== qb) return qb - qa;
    return (lb.eff ?? -2) - (la.eff ?? -2) || lb.att - la.att;
  });
}

// ---------- History: every point in order, plus subs and timeouts ----------
export interface LogEntry { set: number; time: number; kind: 'point' | 'sub' | 'timeout'; winner?: 'own' | 'opponent'; own: number; opponent: number; text: string }

const CODE_WORD: Record<string, string> = { '-': '−' };
const passCtx = (c: string) => ` · ${t('pass')} ${CODE_WORD[c] ?? c}`;
export function historyLog(state: GameState, set: number | null): LogEntry[] {
  const out: LogEntry[] = [];
  const score: Record<number, { own: number; opponent: number }> = {};
  const passOf: Record<string, StatEvent> = {};
  state.events.forEach(e => {
    if (set !== null && e.set !== set) return;
    const sc = (score[e.set] ??= { own: 0, opponent: 0 });
    const ctx = (rallyId?: string) => { const p = rallyId ? passOf[rallyId] : undefined; return p && p.code && p.code !== '=' ? passCtx(p.code) : ''; };
    const push = (winner: 'own' | 'opponent', text: string) => { sc[winner]++; out.push({ set: e.set, time: e.timestamp, kind: 'point', winner, own: sc.own, opponent: sc.opponent, text }); };
    if (e.kind === 'stat') {
      if (e.skill === 'pass' && e.rallyId) passOf[e.rallyId] = e;
      if (!e.point) return;
      const who = nameOf(state, e.playerId);
      const c = e.code ?? (e.grade === 'plus' ? (e.skill === 'serve' ? '#' : 'kill') : e.skill === 'serve' ? '=' : 'err');
      const text = e.skill === 'serve' ? (c === '#' ? t('{who} ace', { who }) : t('{who} serve error', { who }))
        : (c === 'kill' ? t('{who} kill', { who }) : c === 'blk' ? t('{who} blocked', { who }) : t('{who} attack error', { who })) + ctx(e.rallyId);
      push(e.point, text);
    } else if (e.kind === 'point') {
      const passer = e.rallyId && passOf[e.rallyId] ? nameOf(state, passOf[e.rallyId].playerId) : '';
      const text = ({
        opp_attack_point: t('Their kill') + ctx(e.rallyId),
        opp_ace: t('Their ace') + (passer ? ` (${passer})` : ''),
        opp_attack_error: t('Their attack error'),
        opp_serve_error: t('Their serve error'),
        opp_blocked: t('Our block'),
        own_error: e.playerId ? t('{who} unforced error', { who: nameOf(state, e.playerId) }) : t('Unforced error'),
      } as Record<string, string>)[e.reason ?? ''] ?? (e.team === 'own' ? t('Their fault') : t('Our fault'));
      push(e.team, text);
    } else if (e.kind === 'sub' && e.counts) {
      out.push({ set: e.set, time: e.timestamp, kind: 'sub', own: sc.own, opponent: sc.opponent, text: t('Sub: {a} for {b}', { a: nameOf(state, e.inId), b: nameOf(state, e.outId) }) });
    } else if (e.kind === 'timeout') {
      out.push({ set: e.set, time: e.timestamp, kind: 'timeout', own: sc.own, opponent: sc.opponent, text: e.team === 'own' ? t('Timeout us') : t('Timeout them') });
    }
  });
  return out;
}
