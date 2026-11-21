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
export interface LogEntry { set: number; time: number; kind: 'point' | 'sub' | 'timeout' | 'alert'; winner?: 'own' | 'opponent'; own: number; opponent: number; text: string }

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
  // Alerts go in right after the last entry that happened before them
  (state.alertLog ?? []).filter(a => set === null || a.set === set).forEach(a => {
    const entry: LogEntry = { set: a.set, time: a.time, kind: 'alert', own: a.own, opponent: a.opponent, text: a.text };
    let i = out.length;
    while (i > 0 && (out[i - 1].set > a.set || (out[i - 1].set === a.set && out[i - 1].time > a.time))) i--;
    out.splice(i, 0, entry);
  });
  return out;
}

// ---------- Impact: what decided the set (or match) ----------
// Benchmarks, checked against the FIVB VNL 2025 technical report (women: attack eff 26.15%, out of system 15.3%,
// reception positivity 47.6%, serve errors above 10% of attempts). Crunch/opponent/unforced lines are judgment calls.
export const IMPACT_RULES = {
  attackBad: 0.15, attackGood: 0.30, attackMinAtt: 8,
  passBad: 0.35, passGood: 0.5, passErrPerSetMax: 1, passMin: 8,
  serveErrRate: 0.10, servePressureGood: 0.35, serveMin: 8,
  oppKillsPerSet: 12, unforcedPerSet: 3,
  crunchMin: 4, crunchShare: 0.6,
  playerMin: 3,
};

export type Rating = 'pos' | 'neu' | 'neg' | null;
export interface ImpactFactor { tone: 'good' | 'bad'; key: string; title: string; text: string; severity: number; idea?: string }
export interface ImpactPlayer { id: string; name: string; attack: Rating; pass: Rating; serve: Rating; net: number }
export interface Impact {
  result: 'won' | 'lost' | 'open';
  own: number; opponent: number;
  figures: [string, string][];
  factors: ImpactFactor[];
  players: ImpactPlayer[];
}

export function impactReport(state: GameState, set: number | null): Impact {
  const s = inSet(state, set);
  const st = stats(s);
  const pts = s.events.filter(e => e.kind === 'point');
  const R = IMPACT_RULES;
  const nSets = Math.max(1, new Set(s.events.map(e => e.set)).size);
  const pc = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`;
  const atkCode = (e: StatEvent) => e.code ?? (e.grade === 'plus' ? 'kill' : e.grade === 'minus' ? 'err' : 'play');

  // Score + result
  let own = 0, opponent = 0, result: Impact['result'] = 'open';
  if (set !== null) {
    const done = state.setHistory[set - 1];
    const sc = done ?? s.events.reduce((a, e) => {
      if (e.kind === 'point') a[e.team]++;
      if (e.kind === 'stat' && e.point) a[e.point]++;
      return a;
    }, { own: 0, opponent: 0 });
    own = sc.own; opponent = sc.opponent;
    if (done) result = own > opponent ? 'won' : 'lost';
  } else {
    own = state.sets.own; opponent = state.sets.opponent;
    if (Math.max(own, opponent) >= 3) result = own > opponent ? 'won' : 'lost';
  }
  // Point difference over rallies in scope
  let won = 0, lost = 0;
  s.events.forEach(e => { if (e.kind === 'point') (e.team === 'own' ? won++ : lost++); if (e.kind === 'stat' && e.point) (e.point === 'own' ? won++ : lost++); });

  const attacks = st.filter(e => e.skill === 'attack');
  const team = effOf(attacks);
  const passes = st.filter(e => e.skill === 'pass');
  const posPass = passes.filter(e => ['#', '+'].includes(passCode(e))).length;
  const serves = st.filter(e => e.skill === 'serve');
  const serveErr = serves.filter(e => serveCode(e) === '=').length;
  const aces = serves.filter(e => serveCode(e) === '#').length;
  const pressure = serves.filter(e => ['#', '+', '/'].includes(serveCode(e))).length;
  const oppKills = pts.filter(e => e.kind === 'point' && e.reason === 'opp_attack_point').length;
  const blocks = pts.filter(e => e.kind === 'point' && e.reason === 'opp_blocked').length;
  const unforced = pts.filter(e => e.kind === 'point' && (e.reason === 'own_error' || (e.team === 'opponent' && (!e.reason || e.reason === 'other')))).length;

  const figures: [string, string][] = [
    [t('Point difference'), `${won - lost > 0 ? '+' : won - lost < 0 ? '−' : ''}${Math.abs(won - lost)}`],
    [t('Positive passes'), passes.length ? pc(posPass / passes.length) : '–'],
    [t('Attack efficiency'), team.eff === null ? '–' : pc(team.eff)],
    [t('Serve errors'), String(serveErr)],
    [t('Their attack points'), String(oppKills)],
  ];

  // Per player: attack eff, positive pass %, serve, net points
  const ids = Array.from(new Set(st.filter(e => e.skill !== 'set').map(e => e.playerId)));
  const players: ImpactPlayer[] = ids.map((id): ImpactPlayer => {
    const a = effOf(attacks.filter(e => e.playerId === id));
    const ps = passes.filter(e => e.playerId === id);
    const sv = serves.filter(e => e.playerId === id);
    const svErr = sv.filter(e => serveCode(e) === '=').length;
    const svAce = sv.filter(e => serveCode(e) === '#').length;
    const svPress = sv.filter(e => ['#', '+', '/'].includes(serveCode(e))).length;
    const pos = ps.filter(e => ['#', '+'].includes(passCode(e))).length;
    const aced = ps.filter(e => passCode(e) === '=').length;
    const ue = pts.filter(e => e.kind === 'point' && e.reason === 'own_error' && e.playerId === id).length;
    return {
      id, name: nameOf(state, id),
      attack: a.att >= R.playerMin ? (a.eff! >= 0.3 ? 'pos' : a.eff! < 0.1 ? 'neg' : 'neu') : null,
      pass: ps.length >= R.playerMin ? (pos / ps.length >= 0.5 ? 'pos' : pos / ps.length < 0.3 ? 'neg' : 'neu') : null,
      // Serve errors only count against her when she also makes more errors than aces: risk that pays off is fine
      serve: sv.length >= R.playerMin ? (svErr / sv.length > R.serveErrRate && svErr > svAce ? 'neg' : svPress / sv.length >= R.servePressureGood && svErr <= svAce ? 'pos' : 'neu') : null,
      net: a.kills + svAce - a.neg - svErr - aced - ue,
    };
  }).sort((x, y) => y.net - x.net);

  // Factors
  const f: ImpactFactor[] = [];
  const byAttacker = Array.from(new Set(attacks.map(e => e.playerId))).map(id => ({ id, l: effOf(attacks.filter(e => e.playerId === id)) }));
  if (team.att >= R.attackMinAtt && team.eff !== null) {
    if (team.eff < R.attackBad) {
      const worst = byAttacker.sort((a, b) => b.l.neg - a.l.neg)[0];
      f.push({ tone: 'bad', key: 'attack', severity: 80 + (R.attackBad - team.eff) * 100, title: t('Attack problems'),
        text: t('Attack efficiency {a}. Most errors/blocked: {who} ({n}).', { a: pc(team.eff), who: nameOf(state, worst.id), n: worst.l.neg }),
        idea: t('Check attack distribution and options for {who}.', { who: nameOf(state, worst.id) }) });
    } else if (team.eff >= R.attackGood) {
      const best = byAttacker.filter(x => x.l.att >= R.playerMin).sort((a, b) => (b.l.eff ?? -1) - (a.l.eff ?? -1))[0];
      f.push({ tone: 'good', key: 'attack', severity: 40, title: t('Strong attack'),
        text: best ? t('Attack efficiency {a}. Best: {who} ({b}).', { a: pc(team.eff), who: nameOf(state, best.id), b: pc(best.l.eff!) }) : t('Attack efficiency {a}.', { a: pc(team.eff) }) });
    }
  }
  // Crunch time from 20 (10 in set 5), gap ≤ 2, counted on the score before each point
  let cWon = 0, cLost = 0;
  const sc: Record<number, { own: number; opponent: number }> = {};
  s.events.forEach(e => {
    const winner = e.kind === 'point' ? e.team : e.kind === 'stat' ? e.point : null;
    if (!winner) return;
    const x = (sc[e.set] ??= { own: 0, opponent: 0 });
    const from = e.set === 5 ? 10 : 20;
    if (Math.max(x.own, x.opponent) >= from && Math.abs(x.own - x.opponent) <= 2) (winner === 'own' ? cWon++ : cLost++);
    x[winner]++;
  });
  const cN = cWon + cLost;
  if (cN >= R.crunchMin) {
    if (cLost / cN >= R.crunchShare) f.push({ tone: 'bad', key: 'crunch', severity: 75, title: t('Weak finish'), text: t('Lost {l} of {n} points in crunch time.', { l: cLost, n: cN }), idea: t('Plan crunch-time plays before 20.') });
    else if (cWon / cN >= R.crunchShare) f.push({ tone: 'good', key: 'crunch', severity: 45, title: t('Strong finish'), text: t('Won {w} of {n} points in crunch time.', { w: cWon, n: cN }) });
  }
  if (passes.length >= R.passMin) {
    const pp = posPass / passes.length;
    if (pp < R.passBad) {
      const byP = Array.from(new Set(passes.map(e => e.playerId))).map(id => { const l = passes.filter(e => e.playerId === id); return { id, n: l.length, p: l.filter(e => ['#', '+'].includes(passCode(e))).length / l.length }; }).filter(x => x.n >= R.playerMin).sort((a, b) => a.p - b.p);
      f.push({ tone: 'bad', key: 'pass', severity: 70 + (R.passBad - pp) * 100, title: t('Reception under pressure'),
        text: t('Positive passes {a}.', { a: pc(pp) }) + (byP[0] ? ' ' + t('Weakest: {who} ({b}).', { who: nameOf(state, byP[0].id), b: pc(byP[0].p) }) : ''),
        idea: byP[0] ? t('Adjust reception around {who}.', { who: nameOf(state, byP[0].id) }) : t('Adjust the reception formation.') });
    } else {
      // Strength only with few reception errors: passing well but getting aced often is not stable
      const recErr = passes.filter(e => passCode(e) === '=').length;
      if (pp >= R.passGood && recErr / nSets <= R.passErrPerSetMax) f.push({ tone: 'good', key: 'pass', severity: 42, title: t('Stable reception'), text: t('Positive passes {a}, {n} reception errors.', { a: pc(pp), n: recErr }) });
    }
  }
  if (serves.length >= R.serveMin && serveErr / serves.length > R.serveErrRate && serveErr > aces) f.push({ tone: 'bad', key: 'serve', severity: 65 + serveErr, title: t('Too many serve errors'), text: t('{n} serve errors in {m} serves ({r}), {a} aces.', { n: serveErr, m: serves.length, r: pc(serveErr / serves.length), a: aces }), idea: t('Lower serve risk when the score is close.') });
  else if (serves.length >= R.serveMin && pressure / serves.length >= R.servePressureGood) f.push({ tone: 'good', key: 'serve', severity: 41, title: t('Serve pressure'), text: t('{a} of serves put them out of system.', { a: pc(pressure / serves.length) }) });
  if (oppKills / nSets >= R.oppKillsPerSet) f.push({ tone: 'bad', key: 'opp', severity: 60 + oppKills / nSets, title: t('Their attack dominated'), text: t('{n} points from their attack, {b} blocks for us.', { n: oppKills, b: blocks }), idea: t('Review block and defence against their attack.') });
  if (unforced / nSets >= R.unforcedPerSet) f.push({ tone: 'bad', key: 'ue', severity: 55 + unforced, title: t('Unforced errors'), text: t('{n} points given away by our own faults.', { n: unforced }), idea: t('Cut net and line faults.') });

  // Up to 2 problems and 1 strength, filled up to 3
  const bad = f.filter(x => x.tone === 'bad').sort((a, b) => b.severity - a.severity);
  const good = f.filter(x => x.tone === 'good').sort((a, b) => b.severity - a.severity);
  const pick = [...bad.slice(0, 2), ...good.slice(0, 1)];
  const rest = [...bad.slice(2), ...good.slice(1)];
  while (pick.length < 3 && rest.length) pick.push(rest.shift()!);

  return { result, own, opponent, figures, factors: pick, players };
}

// ---------- Attack per player: how the attacks ended, per set and match ----------
export interface AttackRow { id: string; name: string; counts: Record<'err' | 'blk' | 'play' | 'rec' | 'kill', number>; line: EffLine; bySet: { set: number; line: EffLine }[] }

export function attackBreakdown(state: GameState, set: number | null): AttackRow[] {
  const all = stats(state).filter(e => e.skill === 'attack');
  const scope = set === null ? all : all.filter(e => e.set === set);
  const sets = Array.from(new Set(stats(state).map(e => e.set))).sort((a, b) => a - b);
  const code = (e: StatEvent) => (e.code as 'err' | 'blk' | 'play' | 'rec' | 'kill') ?? (e.grade === 'plus' ? 'kill' : e.grade === 'minus' ? 'err' : 'play');
  const build = (id: string, name: string, list: StatEvent[], full: StatEvent[]): AttackRow => {
    const counts = { err: 0, blk: 0, play: 0, rec: 0, kill: 0 };
    list.forEach(e => { counts[code(e)]++; });
    return { id, name, counts, line: effOf(list), bySet: sets.map(s => ({ set: s, line: effOf(full.filter(e => e.set === s)) })) };
  };
  const ids = Array.from(new Set(scope.map(e => e.playerId)));
  const rows = bestFirst(ids.map(id => build(id, nameOf(state, id), scope.filter(e => e.playerId === id), all.filter(e => e.playerId === id))), r => r.line);
  return scope.length ? [build('team', t('Team'), scope, all), ...rows] : [];
}
