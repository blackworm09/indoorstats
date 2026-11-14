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
  return `Player ${idx !== undefined ? idx + 1 : ''}`.trim();
}

export interface SkillLine {
  minus: number;
  zero: number;
  plus: number;
  total: number;
  value: number | null; // serve/pass: average 0-2, attack: efficiency
}

const emptyLine = (): SkillLine => ({ minus: 0, zero: 0, plus: 0, total: 0, value: null });

function finish(line: SkillLine, skill: Skill): SkillLine {
  line.total = line.minus + line.zero + line.plus;
  if (line.total === 0) { line.value = null; return line; }
  if (skill === 'attack') {
    line.value = (line.plus - line.minus) / line.total;
  } else {
    line.value = (line.zero * 1 + line.plus * 2) / line.total;
  }
  return line;
}

export interface PlayerStats {
  player: Player;
  serve: SkillLine;
  attack: SkillLine;
  pass: SkillLine;
}

// set = null means whole match
export function calculateStats(state: GameState, set: number | null) {
  const stats: Record<string, PlayerStats> = {};
  state.players.forEach(p => {
    stats[p.id] = { player: p, serve: emptyLine(), attack: emptyLine(), pass: emptyLine() };
  });
  const team = { serve: emptyLine(), attack: emptyLine(), pass: emptyLine() };
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
  }));

  return {
    players,
    opponent,
    team: {
      serve: finish(team.serve, 'serve'),
      attack: finish(team.attack, 'attack'),
      pass: finish(team.pass, 'pass'),
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
      };
    }
    map[s.playerId][s.skill][s.grade]++;
  });
  return map;
}

export function formatValue(skill: Skill, value: number | null): string {
  if (value === null) return '–';
  if (skill === 'attack') return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(2);
}

// Colour cue: attack eff vs 0/0.3, averages vs 1.0/1.5
export function valueTone(skill: Skill, value: number | null): string {
  if (value === null) return 'text-white/30';
  if (skill === 'attack') return value >= 0.3 ? 'text-success' : value < 0 ? 'text-danger' : 'text-white';
  return value >= 1.5 ? 'text-success' : value < 1 ? 'text-danger' : 'text-white';
}
