// Stage 3: attack board + version-1 alerts (see the Alert Catalog Review doc).
// Thresholds are relative: "Δ below the team's own match average, after N_min actions".
import { GameState, MatchEvent, StatEvent } from './types';
import { getSetLimit, playerLabel, rotationTable } from './utils';
import { t } from './i18n';

export const N_MIN = 5;      // no rate before this many actions
export const WINDOW = 10;    // "recent" window (actions)
export const STREAK = 3;     // consecutive actions of the same player, across sets
export const DELTA = 0.15;   // 15 percentage points

// ---------- Attack outcome helpers ----------
type Outcome = 'kill' | 'neg' | 'play';
const outcome = (e: StatEvent): Outcome => {
  if (e.code) return e.code === 'kill' ? 'kill' : e.code === 'err' || e.code === 'blk' ? 'neg' : 'play';
  return e.grade === 'plus' ? 'kill' : e.grade === 'minus' ? 'neg' : 'play'; // pre-v2 events
};

export interface EffLine { att: number; kills: number; neg: number; eff: number | null }
export function effOf(list: StatEvent[]): EffLine {
  const kills = list.filter(e => outcome(e) === 'kill').length;
  const neg = list.filter(e => outcome(e) === 'neg').length;
  return { att: list.length, kills, neg, eff: list.length ? (kills - neg) / list.length : null };
}

const isPositivePass = (e: StatEvent) => (e.code ? e.code === '#' || e.code === '+' : e.grade === 'plus');

export type Phase = 'in' | 'out' | 'transition';

// Per attack: pass phase (first attack after our reception) and whether it was crunch time
export interface AttackInfo { ev: StatEvent; phase: Phase; crunch: boolean }

export function attackInfo(state: GameState): AttackInfo[] {
  const out: AttackInfo[] = [];
  const score: Record<number, { own: number; opponent: number }> = {};
  const seenAttackInRally = new Set<string>();
  const passInRally: Record<string, StatEvent> = {};
  state.events.forEach((e: MatchEvent) => {
    const sc = (score[e.set] ??= { own: 0, opponent: 0 });
    if (e.kind === 'stat') {
      if (e.skill === 'pass' && e.rallyId) passInRally[e.rallyId] = e;
      if (e.skill === 'attack') {
        let phase: Phase = 'transition';
        const pass = e.rallyId ? passInRally[e.rallyId] : undefined;
        if (pass && !seenAttackInRally.has(e.rallyId!)) {
          if (pass.code !== '/' && pass.code !== '=') phase = isPositivePass(pass) ? 'in' : 'out';
        }
        if (e.rallyId) seenAttackInRally.add(e.rallyId);
        const crunchFrom = getSetLimit(e.set) === 15 ? 10 : 20;
        const crunch = Math.max(sc.own, sc.opponent) >= crunchFrom && Math.abs(sc.own - sc.opponent) <= 2;
        out.push({ ev: e, phase, crunch });
      }
      if (e.point) sc[e.point]++;
    }
    if (e.kind === 'point') sc[e.team]++;
  });
  return out;
}

// ---------- Board ----------
export interface BoardRow { playerId: string; name: string; role: string; match: EffLine; now: EffLine }

export function attackBoard(state: GameState, rotation: number | null, onCourt: (string | null)[]): BoardRow[] {
  const attacks = state.events.filter((e): e is StatEvent => e.kind === 'stat' && e.skill === 'attack');
  const rows: BoardRow[] = [];
  state.players.forEach((p, i) => {
    if (p.role === 'libero') return;
    const mine = attacks.filter(e => e.playerId === p.id);
    if (!mine.length && !onCourt.includes(p.id)) return;
    rows.push({
      playerId: p.id, name: p.name.trim() || playerLabel(p, i), role: p.role,
      match: effOf(mine), now: effOf(rotation ? mine.filter(e => e.rot === rotation) : []),
    });
  });
  // On court first, then by attempts
  return rows.sort((a, b) => (Number(onCourt.includes(b.playerId)) - Number(onCourt.includes(a.playerId))) || b.match.att - a.match.att);
}

// ---------- Alerts ----------
export interface Alert { id: string; severity: number; text: string; tone: 'bad' | 'neutral' }

const pct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`;

export function computeAlerts(state: GameState, rotation: number | null): Alert[] {
  const alerts: Alert[] = [];
  const info = attackInfo(state);
  const attacks = info.map(a => a.ev);
  const team = effOf(attacks);
  const teamKillRate = team.att ? team.kills / team.att : 0;
  const teamNegRate = team.att ? team.neg / team.att : 0;
  const name = (id: string) => {
    const i = state.players.findIndex(p => p.id === id);
    return i >= 0 ? (state.players[i].name.trim() || playerLabel(state.players[i], i)) : '';
  };
  const attackers = Array.from(new Set(attacks.map(e => e.playerId)));

  attackers.forEach(id => {
    const mine = attacks.filter(e => e.playerId === id);
    const m = effOf(mine);

    // A1 Attacker closes negatively: error + blocked, last W, or a streak of K
    const last = mine.slice(-WINDOW);
    const lastNeg = last.filter(e => outcome(e) === 'neg').length;
    const streak = (() => { let k = 0; for (let i = mine.length - 1; i >= 0 && outcome(mine[i]) === 'neg'; i--) k++; return k; })();
    if (streak >= STREAK) {
      alerts.push({ id: `A1s-${id}`, severity: 80 + streak, tone: 'bad', text: t('{who}: {n} errors/blocked in a row.', { who: name(id), n: streak }) });
    } else if (last.length >= N_MIN && lastNeg / last.length >= teamNegRate + DELTA) {
      alerts.push({ id: `A1-${id}`, severity: 60 + Math.round((lastNeg / last.length - teamNegRate) * 100), tone: 'bad', text: t('{who}: {n} errors/blocked in the last {m}.', { who: name(id), n: lastNeg, m: last.length }) });
    }

    // A2 Attacker doesn't score
    if (m.att >= N_MIN) {
      const kr = m.kills / m.att;
      if (m.kills === 0) alerts.push({ id: `A2-${id}`, severity: 65 + m.att, tone: 'bad', text: t('{who}: 0 kills in {n} attacks.', { who: name(id), n: m.att }) });
      else if (kr <= teamKillRate - DELTA) alerts.push({ id: `A2-${id}`, severity: 50 + Math.round((teamKillRate - kr) * 100), tone: 'bad', text: t('{who}: kill rate {a} (team {b}).', { who: name(id), a: pct(kr), b: pct(teamKillRate) }) });
    }

    // A3 Attacker weak in the current rotation
    if (rotation && m.eff !== null) {
      const r = effOf(mine.filter(e => e.rot === rotation));
      if (r.att >= N_MIN && r.eff! <= m.eff - DELTA) {
        alerts.push({ id: `A3-${id}`, severity: 90 + Math.round((m.eff - r.eff!) * 100) / 10, tone: 'bad', text: t('{who} {a} in R{r} ({n} swings, match {b}).', { who: name(id), a: pct(r.eff!), r: rotation, n: r.att, b: pct(m.eff) }) });
      }
    }
  });

  // A4 Rotation with weak side-out (current rotation, match)
  const rows = rotationTable(state, null);
  const so = rows.reduce((a, r) => ({ won: a.won + r.soWon, total: a.total + r.soTotal }), { won: 0, total: 0 });
  if (rotation && so.total) {
    const r = rows[rotation - 1];
    const teamSo = so.won / so.total;
    if (r.soTotal >= N_MIN && r.soWon / r.soTotal <= teamSo - DELTA) {
      alerts.push({ id: 'A4', severity: 95, tone: 'bad', text: t('Side-out in R{r}: {w} of {n} ({a}, team {b}).', { r: rotation, w: r.soWon, n: r.soTotal, a: pct(r.soWon / r.soTotal), b: pct(teamSo) }) });
    }
  }

  // A5 Attack breaks down out of system
  const inSys = effOf(info.filter(a => a.phase === 'in').map(a => a.ev));
  const outSys = effOf(info.filter(a => a.phase === 'out').map(a => a.ev));
  if (inSys.att >= N_MIN && outSys.att >= N_MIN && outSys.eff! <= inSys.eff! - DELTA) {
    alerts.push({ id: 'A5', severity: 55, tone: 'bad', text: t('Out of system: team attack {a} (in system {b}).', { a: pct(outSys.eff!), b: pct(inSys.eff!) }) });
  }

  // A6 One attacker carries the load (last W team attacks)
  const lastTeam = attacks.slice(-WINDOW);
  if (lastTeam.length >= WINDOW) {
    const counts: Record<string, number> = {};
    lastTeam.forEach(e => { counts[e.playerId] = (counts[e.playerId] ?? 0) + 1; });
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n >= Math.ceil(WINDOW / 2)) alerts.push({ id: 'A6', severity: 40 + n, tone: 'neutral', text: t('{who} took {n} of the last {m} attacks. Predictable?', { who: name(top), n, m: WINDOW }) });
  }

  // A7 Crunch time attack (match)
  const crunch = effOf(info.filter(a => a.crunch).map(a => a.ev));
  if (crunch.att >= N_MIN && team.eff !== null && crunch.eff! <= team.eff - DELTA) {
    alerts.push({ id: 'A7', severity: 70, tone: 'bad', text: t('Crunch time: team attack {a} (match {b}).', { a: pct(crunch.eff!), b: pct(team.eff) }) });
  }

  // A8 Pass quality drops: Positive % per player (last W) and in the current rotation
  const passes = state.events.filter((e): e is StatEvent => e.kind === 'stat' && e.skill === 'pass');
  if (passes.length) {
    const teamPos = passes.filter(isPositivePass).length / passes.length;
    Array.from(new Set(passes.map(e => e.playerId))).forEach(id => {
      const recent = passes.filter(e => e.playerId === id).slice(-WINDOW);
      if (recent.length < N_MIN) return;
      const pos = recent.filter(isPositivePass).length / recent.length;
      if (pos <= teamPos - DELTA) alerts.push({ id: `A8-${id}`, severity: 50 + Math.round((teamPos - pos) * 100) / 2, tone: 'bad', text: t('{who} passing: {a} positive in the last {n} (team {b}).', { who: name(id), a: pct(pos), n: recent.length, b: pct(teamPos) }) });
    });
    if (rotation) {
      const inRot = passes.filter(e => e.rot === rotation);
      if (inRot.length >= N_MIN) {
        const pos = inRot.filter(isPositivePass).length / inRot.length;
        if (pos <= teamPos - DELTA) alerts.push({ id: 'A8r', severity: 75, tone: 'bad', text: t('Passing in R{r}: {a} positive (team {b}).', { r: rotation, a: pct(pos), b: pct(teamPos) }) });
      }
    }
  }

  // Repeat while true: recomputed on every change. Show the 3 most severe.
  return alerts.sort((a, b) => b.severity - a.severity);
}
