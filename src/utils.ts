import { GameState, Grade, MatchEvent, Player, Skill, StatEvent, TeamSide } from './types';

// Indoor: sets 1-4 to 25, set 5 to 15, win by 2, best of 5
export function getSetLimit(setNumber: number): number {
  return setNumber >= 5 ? 15 : 25;
}

export function isSetWon(score: { own: number; opponent: number }, setNumber: number): boolean {
  const limit = getSetLimit(setNumber);
  const max = Math.max(score.own, score.opponent);
  const diff = Math.abs(score.own - score.opponent);
  return max >= limit && diff >= 2;
}

export const SETS_TO_WIN = 3;

export function currentSetNumber(state: GameState): number {
  return state.setHistory.length + 1;
}

export function scoreForSet(events: MatchEvent[], set: number) {
  const score = { own: 0, opponent: 0 };
  for (const e of events) {
    if (e.set !== set) continue;
    if (e.kind === 'point') score[e.team]++;
    if (e.kind === 'stat' && e.point) score[e.point]++;
  }
  return score;
}

export function subsUsed(events: MatchEvent[], set: number): number {
  return events.filter(e => e.kind === 'sub' && e.set === set && e.counts).length;
}

// Which stats end the rally on their own
export function autoPointFor(skill: Skill, grade: Grade): TeamSide | null {
  if (skill === 'serve' && grade === 'plus') return 'own';      // ace
  if (skill === 'serve' && grade === 'minus') return 'opponent'; // serve error
  if (skill === 'attack' && grade === 'plus') return 'own';     // kill
  if (skill === 'attack' && grade === 'minus') return 'opponent'; // error / blocked
  return null;
}

export function formatMatchDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export function playerLabel(p: Player, idx?: number): string {
  const name = p.name.trim();
  const num = p.number.trim();
  if (name && num) return `#${num} ${name}`;
  if (name) return name;
  if (num) return `#${num}`;
  const n = p.slot ?? (idx !== undefined ? idx + 1 : undefined);
  return `Player ${n ?? ''}`.trim();
}

export interface SkillLine {
  minus: number;
  zero: number;
  plus: number;
  total: number;
  value: number | null; // efficiency: (# − −) / total
}

const emptyLine = (): SkillLine => ({ minus: 0, zero: 0, plus: 0, total: 0, value: null });

function finish(line: SkillLine, skill: Skill): SkillLine {
  line.total = line.minus + line.zero + line.plus;
  if (line.total === 0) { line.value = null; return line; }
  // Assist rate for setters: kills set / attempts set. Everything else: (# − −) / total
  line.value = skill === 'set' ? line.plus / line.total : (line.plus - line.minus) / line.total;
  return line;
}

export interface PlayerStats {
  player: Player;
  serve: SkillLine;
  attack: SkillLine;
  pass: SkillLine;
  set: SkillLine;
}

// set = null means whole match
export function calculateStats(state: GameState, set: number | null) {
  const stats: Record<string, PlayerStats> = {};
  state.players.forEach(p => {
    stats[p.id] = { player: p, serve: emptyLine(), attack: emptyLine(), pass: emptyLine(), set: emptyLine() };
  });
  const team = { serve: emptyLine(), attack: emptyLine(), pass: emptyLine(), set: emptyLine() };
  const opponent = { opp_attack_point: 0, opp_ace: 0, opp_attack_error: 0, opp_serve_error: 0, other_us: 0, other_them: 0 };

  state.events.forEach(e => {
    if (set !== null && e.set !== set) return;
    if (e.kind === 'point') {
      if (e.reason && e.reason !== 'other') opponent[e.reason]++;
      else if (e.team === 'own') opponent.other_us++;
      else opponent.other_them++;
      return;
    }
    if (e.kind !== 'stat') return;
    const ps = stats[e.playerId];
    if (!ps) return;
    ps[e.skill][e.grade]++;
    team[e.skill][e.grade]++;
  });

  const players = Object.values(stats).map(ps => ({
    ...ps,
    serve: finish(ps.serve, 'serve'),
    attack: finish(ps.attack, 'attack'),
    pass: finish(ps.pass, 'pass'),
    set: finish(ps.set, 'set'),
  }));

  return {
    players,
    opponent,
    team: {
      serve: finish(team.serve, 'serve'),
      attack: finish(team.attack, 'attack'),
      pass: finish(team.pass, 'pass'),
      set: finish(team.set, 'set'),
    },
  };
}

// Quick per-player counts for the tracking buttons (whole match)
export function countsByPlayer(events: MatchEvent[]) {
  const map: Record<string, Record<Skill, Record<Grade, number>>> = {};
  events.forEach(e => {
    if (e.kind !== 'stat') return;
    const s = e as StatEvent;
    if (!map[s.playerId]) {
      map[s.playerId] = {
        serve: { minus: 0, zero: 0, plus: 0 },
        attack: { minus: 0, zero: 0, plus: 0 },
        pass: { minus: 0, zero: 0, plus: 0 },
        set: { minus: 0, zero: 0, plus: 0 },
      };
    }
    map[s.playerId][s.skill][s.grade]++;
  });
  return map;
}

export function formatValue(skill: Skill, value: number | null): string {
  if (value === null) return '–';
  return `${(value * 100).toFixed(0)}%`;
}

// Colour cue: green at 30%+ for attack, 20%+ for serve/pass; red below 0
export function valueTone(skill: Skill, value: number | null): string {
  if (value === null) return 'text-white/30';
  if (skill === 'set') return value >= 0.4 ? 'text-success' : 'text-white';
  const good = skill === 'attack' ? 0.3 : 0.2;
  return value >= good ? 'text-success' : value < 0 ? 'text-danger' : 'text-white';
}

// ---------- Live trends (quiet, no pop-ups) ----------
export type TrendTone = 'alert' | 'warning' | 'info';
export interface Trend { message: string; tone: TrendTone; group: string }

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

function efficiency(list: StatEvent[]) {
  if (list.length === 0) return null;
  const k = list.filter(e => e.grade === 'plus').length;
  const err = list.filter(e => e.grade === 'minus').length;
  return (k - err) / list.length;
}


export function detectTrends(state: GameState): Trend[] {
  const trends: Trend[] = [];
  const setNum = currentSetNumber(state);
  const stats = state.events.filter((e): e is StatEvent => e.kind === 'stat');
  const inSet = (s: number) => stats.filter(e => e.set === s);

  state.players.forEach((p, idx) => {
    const name = playerLabel(p, idx);
    const mine = stats.filter(e => e.playerId === p.id);

    // Passing: last 6 passes
    const passes = mine.filter(e => e.skill === 'pass').slice(-6);
    if (passes.length >= 4) {
      const eff = efficiency(passes)!;
      if (eff < 0) trends.push({ group: 'Passing', tone: 'warning', message: `${name} passing eff ${pct(eff)} over the last ${passes.length}. Under pressure.` });
    }

    // Serving: last 5 serves
    const serves = mine.filter(e => e.skill === 'serve').slice(-5);
    const serveErr = serves.filter(e => e.grade === 'minus').length;
    if (serveErr >= 3) trends.push({ group: 'Serving', tone: 'warning', message: `${name}: ${serveErr} serve errors in the last ${serves.length}.` });

    // Attack: hot over last 6, cold over the match
    const attacks = mine.filter(e => e.skill === 'attack');
    const recent = attacks.slice(-6);
    const kills = recent.filter(e => e.grade === 'plus').length;
    const errs = recent.filter(e => e.grade === 'minus').length;
    if (kills >= 4 && errs === 0) {
      trends.push({ group: 'Attack', tone: 'info', message: `${name} hot: ${kills} kills, 0 errors in the last ${recent.length}. Keep feeding.` });
    } else if (attacks.length >= 5) {
      const eff = efficiency(attacks)!;
      if (eff <= -0.1) trends.push({ group: 'Attack', tone: 'warning', message: `${name} attack eff ${pct(eff)} on ${attacks.length} swings. Go elsewhere.` });
    }
  });

  // Team serve errors this set
  const setServeErr = inSet(setNum).filter(e => e.skill === 'serve' && e.grade === 'minus').length;
  if (setServeErr >= 4) trends.push({ group: 'Serving', tone: 'warning', message: `Team gave away ${setServeErr} points on serve this set.` });

  // Opponent buttons this set
  const setPoints = state.events.filter(e => e.kind === 'point' && e.set === setNum);
  const countReason = (r: string) => setPoints.filter(e => e.kind === 'point' && e.reason === r).length;
  const oppAces = countReason('opp_ace');
  const oppServeErr = countReason('opp_serve_error');
  const oppKills = countReason('opp_attack_point');
  if (oppAces >= 3) trends.push({ group: 'Opponent', tone: 'alert', message: `${oppAces} opponent aces this set. Serve receive is the problem.` });
  if (oppServeErr >= 4) trends.push({ group: 'Opponent', tone: 'info', message: `Opponent gave you ${oppServeErr} service errors this set. Their serve is shaky.` });
  if (oppKills >= 6) trends.push({ group: 'Opponent', tone: 'alert', message: `Opponent has ${oppKills} attack points this set. Check block and defense.` });

  // Runs in the current set
  const sequence: TeamSide[] = [];
  state.events.forEach(e => {
    if (e.set !== setNum) return;
    if (e.kind === 'point') sequence.push(e.team);
    if (e.kind === 'stat' && e.point) sequence.push(e.point);
  });
  if (sequence.length > 0) {
    const last = sequence[sequence.length - 1];
    let run = 0;
    for (let i = sequence.length - 1; i >= 0 && sequence[i] === last; i--) run++;
    if (run >= 4) {
      trends.push(last === 'opponent'
        ? { group: 'Runs', tone: 'alert', message: `Opponent on a ${run}-0 run. Timeout?` }
        : { group: 'Runs', tone: 'info', message: `You're on a ${run}-0 run.` });
    }
  }

  // Set vs previous set
  if (setNum >= 2) {
    const cur = inSet(setNum), prev = inSet(setNum - 1);
    const curAtk = cur.filter(e => e.skill === 'attack'), prevAtk = prev.filter(e => e.skill === 'attack');
    if (curAtk.length >= 5 && prevAtk.length >= 5) {
      const a = efficiency(curAtk)!, b = efficiency(prevAtk)!;
      if (Math.abs(a - b) >= 0.15) {
        trends.push({ group: 'Set vs set', tone: a < b ? 'warning' : 'info', message: `Attack eff ${a < b ? 'down' : 'up'} from ${pct(b)} to ${pct(a)} vs set ${setNum - 1}.` });
      }
    }
    const curPas = cur.filter(e => e.skill === 'pass'), prevPas = prev.filter(e => e.skill === 'pass');
    if (curPas.length >= 5 && prevPas.length >= 5) {
      const a = efficiency(curPas)!, b = efficiency(prevPas)!;
      if (Math.abs(a - b) >= 0.2) {
        trends.push({ group: 'Set vs set', tone: a < b ? 'warning' : 'info', message: `Team passing eff ${a < b ? 'down' : 'up'} from ${pct(b)} to ${pct(a)} vs set ${setNum - 1}.` });
      }
    }
  }

  // Most urgent first
  const order: Record<TrendTone, number> = { alert: 0, warning: 1, info: 2 };
  return trends.sort((x, y) => order[x.tone] - order[y.tone]);
}

// ---------- Rally flow helpers ----------
// Team that won the last point in a set (they serve next)
export function lastPointWinner(events: MatchEvent[], set: number): TeamSide | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.set !== set) continue;
    if (e.kind === 'point') return e.team;
    if (e.kind === 'stat' && e.point) return e.point;
  }
  return null;
}

// If we served the last rally and won it, the same player keeps serving
export function suggestedServer(events: MatchEvent[], set: number): string | null {
  let lastRallyId: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.set !== set) continue;
    if (e.kind === 'point' || (e.kind === 'stat' && e.point)) { lastRallyId = e.rallyId; break; }
  }
  if (!lastRallyId) return null;
  const rally = events.filter(e => e.rallyId === lastRallyId);
  const serve = rally.find((e): e is StatEvent => e.kind === 'stat' && e.skill === 'serve');
  const end = rally[rally.length - 1];
  const winner = end.kind === 'point' ? end.team : end.kind === 'stat' ? end.point : null;
  return serve && winner === 'own' ? serve.playerId : null;
}

// ---------- Setter assists ----------
// The setter on court gets the credit for a teammate's attack. No credit when she attacks herself.
export function setterFor(state: GameState, attackerId: string): string | null {
  const setter = state.players.find(p => p.onCourt && p.role === 'setter');
  if (!setter || setter.id === attackerId) return null;
  return setter.id;
}
