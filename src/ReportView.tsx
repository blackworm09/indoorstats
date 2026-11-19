import { useMemo, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { GameState, ROLE_SHORT, Role, ScaleCode } from './types';
import { currentSetNumber, formatMatchDate, scoreForSet } from './utils';
import { EffLine, N_MIN } from './alerts';
import { attackByPhase, attackByRotation, bestFirst, historyLog, passRows, pointSources, ScaleRow, serveRows, setterRows } from './analysis';
import { InfoDot, PASS_SCALE, SERVE_SCALE, TONE_CLASS } from './RallyView';

interface ReportViewProps {
  gameState: GameState;
  onExport: () => void;
  onReset: () => void;
}

const pct = (v: number | null) => (v === null ? '–' : `${v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`);
const share = (a: number, b: number) => (b ? a / b : null);

function Card({ title, info, children, className = '' }: { title: string; info: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-t border-line pt-4 flex flex-col gap-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-bold tracking-[0.14em] uppercase">{title}</span>
        <InfoDot light text={info} />
      </div>
      {children}
    </section>
  );
}

const Empty = () => <span className="text-sm text-mute">No data yet.</span>;

// Heatmap cell: strong green 40%+, light green 25%+, neutral 0+, red below 0. Faded until N_MIN attempts.
function HeatCell({ line }: { line: EffLine }) {
  if (!line.att) return <div className="h-12 rounded-md border border-dashed border-line" />;
  const v = line.eff!;
  const cls = v >= 0.4 ? 'bg-[rgba(16,185,129,0.85)] text-[#0B0C0E]' : v >= 0.25 ? 'bg-[rgba(16,185,129,0.35)]' : v >= 0 ? 'bg-card' : 'bg-[rgba(244,63,94,0.85)] text-[#0B0C0E]';
  return (
    <div className={`h-12 rounded-md flex flex-col items-center justify-center leading-none ${cls} ${line.att < N_MIN ? 'opacity-55' : ''}`}>
      <span className="font-display text-lg font-bold tabular-nums">{pct(v)}</span>
      <span className="font-display text-[10px] font-semibold opacity-70 mt-0.5">{line.att}</span>
    </div>
  );
}

// Efficiency as a number: green from 25%, red below 0, faded under N_MIN. Small number = attempts.
function EffNum({ line }: { line: EffLine }) {
  if (!line.att) return <span className="font-display text-mute">–</span>;
  const v = line.eff!;
  const tone = v >= 0.25 ? 'text-good' : v < 0 ? 'text-bad' : '';
  return (
    <span className={`font-display tabular-nums ${line.att < N_MIN ? 'opacity-55' : ''}`}>
      <span className={`text-base font-bold ${tone}`}>{pct(v)}</span> <span className="text-[11px] text-mute">{line.att}</span>
    </span>
  );
}

// One small count column per rating, in the rating colours (worst → best)
function ScaleHead({ scale }: { scale: typeof PASS_SCALE }) {
  return <>{scale.map(sc => <span key={sc.code} className={`h-5 rounded-sm flex items-center justify-center font-display text-xs font-bold ${TONE_CLASS[sc.tone]}`} title={sc.label}>{sc.sym}</span>)}</>;
}
function ScaleCounts({ row, scale }: { row: ScaleRow; scale: typeof PASS_SCALE }) {
  return <>{scale.map(sc => <span key={sc.code} className={`text-center font-display text-sm tabular-nums ${row.counts[sc.code] ? '' : 'text-mute/40'}`}>{row.counts[sc.code]}</span>)}</>;
}

export default function ReportView({ gameState, onExport, onReset }: ReportViewProps) {
  const [setFilter, setSetFilter] = useState<number | null>(null);
  const setNum = currentSetNumber(gameState);
  const setsWithData = Array.from(new Set(gameState.events.map(e => e.set))).sort((a, b) => a - b);
  const setScores = [...gameState.setHistory, ...(setsWithData.includes(setNum) ? [scoreForSet(gameState.events, setNum)] : [])];

  const heat = useMemo(() => { const h = attackByRotation(gameState, setFilter); return { ...h, rows: bestFirst(h.rows, r => r.all) }; }, [gameState, setFilter]);
  const phase = useMemo(() => {
    const rows = attackByPhase(gameState, setFilter);
    const total = (r: typeof rows[number]): EffLine => {
      const ls = [r.byPhase.in, r.byPhase.out, r.byPhase.transition];
      const att = ls.reduce((a, l) => a + l.att, 0), kills = ls.reduce((a, l) => a + l.kills, 0), neg = ls.reduce((a, l) => a + l.neg, 0);
      return { att, kills, neg, eff: att ? (kills - neg) / att : null };
    };
    return rows.length ? [rows[0], ...bestFirst(rows.slice(1), total)] : rows;
  }, [gameState, setFilter]);
  // Rate as an EffLine so the same best-first rule applies: passing by Positive %, serving by Pressure %
  const asLine = (n: number, good: number): EffLine => ({ att: n, kills: good, neg: 0, eff: n ? good / n : null });
  const pass = useMemo(() => { const r = passRows(gameState, setFilter); return r.length ? [r[0], ...bestFirst(r.slice(1), x => asLine(x.n, x.counts['#'] + x.counts['+']))] : r; }, [gameState, setFilter]);
  const serve = useMemo(() => { const r = serveRows(gameState, setFilter); return r.length ? [r[0], ...bestFirst(r.slice(1), x => asLine(x.n, x.counts['#'] + x.counts['+'] + x.counts['/']))] : r; }, [gameState, setFilter]);
  const history = useMemo(() => historyLog(gameState, setFilter), [gameState, setFilter]);
  const setters = useMemo(() => setterRows(gameState, setFilter), [gameState, setFilter]);
  const points = useMemo(() => pointSources(gameState, setFilter), [gameState, setFilter]);

  const filterBtn = (label: string, value: number | null) => (
    <button key={label} onClick={() => setSetFilter(value)}
      className={`h-9 px-3.5 rounded-md font-display text-sm font-bold tracking-[0.1em] uppercase ${setFilter === value ? 'border border-primary text-ink' : 'border border-line text-mute'}`}>{label}</button>
  );
  const th = 'font-display text-[11px] font-bold tracking-[0.12em] uppercase text-mute';
  const name = 'font-display text-base font-bold uppercase truncate';

  return (
    <div className="p-4 lg:p-7 flex flex-col gap-7 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-display text-sm font-semibold tracking-[0.12em] uppercase text-mute">
            {formatMatchDate(gameState.matchDate)}{gameState.opponentName ? ` · vs ${gameState.opponentName}` : ''}
          </div>
          <div className="flex items-baseline gap-4 mt-1">
            <span className="font-display text-4xl font-bold tabular-nums">{gameState.sets.own}–{gameState.sets.opponent}</span>
            <span className="font-display text-sm font-semibold tracking-[0.08em] text-mute">
              {setScores.map((s, i) => `${s.own}–${s.opponent}`).join('  ·  ')}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filterBtn('Match', null)}
          {setsWithData.map(s => filterBtn(`Set ${s}`, s))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-x-9 gap-y-7">
        {/* Attack × rotation */}
        <Card title="Attack · Rotation" info="Attack efficiency per attacker and rotation: (kills − errors − blocked) / attempts. Small number = attempts. Faded = under 5. Side-out = rallies won when they serve. Break = rallies won when we serve.">
          {heat.rows.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[110px_repeat(6,minmax(48px,1fr))_68px] gap-1.5 items-center min-w-[520px]">
                <span />
                {[1, 2, 3, 4, 5, 6].map(r => <span key={r} className={`${th} text-center`}>R{r}</span>)}
                <span className={`${th} text-center`}>All</span>
                {heat.rows.map(r => (
                  <div key={r.id} className="contents" data-heat={r.name}>
                    <span className={name}>{r.name} <span className="text-[11px] text-mute">{ROLE_SHORT[r.role as Role]}</span></span>
                    {r.byRot.map((l, k) => <HeatCell key={k} line={l} />)}
                    <span className="text-center font-display text-lg font-bold tabular-nums">{pct(r.all.eff)}</span>
                  </div>
                ))}
                {([['Side-out', heat.sideOut, heat.so], ['Break', heat.breakPt, heat.bp]] as const).map(([label, vals, raw]) => (
                  <div key={label} className="contents">
                    <span className={th}>{label}</span>
                    {vals.map((v, k) => (
                      <span key={k} className={`text-center font-display text-base font-bold tabular-nums ${v === null ? 'text-mute' : v < 0.45 ? 'text-bad' : ''}`} title={`${raw[k][0]} of ${raw[k][1]}`}>
                        {pct(v)}<span className="block text-[10px] font-semibold text-mute">{raw[k][1] ? `${raw[k][0]}/${raw[k][1]}` : ''}</span>
                      </span>
                    ))}
                    <span />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Attack × pass */}
        <Card title="Attack · Pass" info="In system = first attack after a # or + pass. Out of system = after ! or −. Transition = every other attack (after our serve, a dig or a recycle). Small number = attempts.">
          {phase.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[90px_repeat(3,minmax(0,1fr))] gap-x-2 gap-y-3 items-center">
              <span />
              {['In system', 'Out of system', 'Transition'].map(h => <span key={h} className={th}>{h}</span>)}
              {phase.map(r => (
                <div key={r.id} className="contents" data-phase={r.name}>
                  <span className={`${name} ${r.id === 'team' ? 'text-primary' : ''}`}>{r.name}</span>
                  <EffNum line={r.byPhase.in} /><EffNum line={r.byPhase.out} /><EffNum line={r.byPhase.transition} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Passing */}
        <Card title="Passing" info="Positive % = # and +. Perfect % = #. Error % = = (aced). Coloured columns = count per rating. Best Positive % first.">
          {pass.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[84px_32px_repeat(3,48px)_repeat(6,minmax(22px,1fr))] gap-x-1.5 gap-y-2.5 items-center overflow-x-auto">
              <span /><span className={`${th} text-right`}>N</span>
              <span className={`${th} text-right`}>Pos</span><span className={`${th} text-right`}>Perf</span><span className={`${th} text-right`}>Err</span><ScaleHead scale={PASS_SCALE} />
              {pass.map(r => (
                <div key={r.id} className="contents" data-pass={r.name}>
                  <span className={`${name} ${r.id === 'team' ? 'text-primary' : ''}`}>{r.name}</span>
                  <span className="text-right font-display text-sm text-mute tabular-nums">{r.n}</span>
                  <span className="text-right font-display text-base font-bold tabular-nums">{pct(share(r.counts['#'] + r.counts['+'], r.n))}</span>
                  <span className="text-right font-display text-base tabular-nums">{pct(share(r.counts['#'], r.n))}</span>
                  <span className={`text-right font-display text-base tabular-nums ${r.counts['='] ? 'text-bad' : ''}`}>{pct(share(r.counts['='], r.n))}</span>
                  <ScaleCounts row={r} scale={PASS_SCALE} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Serving */}
        <Card title="Serving" info="Rated by how they passed it. Pressure % = serves that put them out of system or worse for them (+, / and aces). Coloured columns = count per rating. Best Pressure % first.">
          {serve.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[84px_32px_repeat(3,48px)_repeat(6,minmax(22px,1fr))] gap-x-1.5 gap-y-2.5 items-center overflow-x-auto">
              <span /><span className={`${th} text-right`}>N</span>
              <span className={`${th} text-right`}>Ace</span><span className={`${th} text-right`}>Err</span><span className={`${th} text-right`}>Press</span><ScaleHead scale={SERVE_SCALE} />
              {serve.map(r => (
                <div key={r.id} className="contents" data-serve={r.name}>
                  <span className={`${name} ${r.id === 'team' ? 'text-primary' : ''}`}>{r.name}</span>
                  <span className="text-right font-display text-sm text-mute tabular-nums">{r.n}</span>
                  <span className="text-right font-display text-base font-bold tabular-nums">{r.counts['#']}</span>
                  <span className={`text-right font-display text-base tabular-nums ${r.counts['='] ? 'text-bad' : ''}`}>{r.counts['=']}</span>
                  <span className="text-right font-display text-base tabular-nums">{pct(share(r.counts['#'] + r.counts['+'] + r.counts['/'], r.n))}</span>
                  <ScaleCounts row={r} scale={SERVE_SCALE} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Points */}
        <Card title="Points" info="Where our points came from, and how we gave points away.">
          <div className="grid grid-cols-2 gap-6">
            {([['Won', points.won, 'text-good'], ['Lost', points.lost, 'text-bad']] as const).map(([label, list, tone]) => (
              <div key={label} className="flex flex-col gap-1.5">
                <span className={`${th} ${tone}`}>{label} · {list.reduce((a, [, n]) => a + n, 0)}</span>
                {list.filter(([, n]) => n > 0).map(([l, n]) => (
                  <div key={l} className="flex justify-between text-sm border-t border-line pt-1.5"><span>{l}</span><span className="font-display font-bold tabular-nums">{n}</span></div>
                ))}
              </div>
            ))}
          </div>
        </Card>

        {/* Setter */}
        <Card title="Setter" info="Every teammate attack counts as a set. Assist = the attack was a kill. Eff = attack efficiency of the hitters she set.">
          {setters.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[90px_repeat(3,64px)] gap-x-2 gap-y-2 items-center">
              <span /><span className={`${th} text-right`}>Sets</span><span className={`${th} text-right`}>Assists</span><span className={`${th} text-right`}>Eff</span>
              {setters.map(r => (
                <div key={r.id} className="contents">
                  <span className={name}>{r.name}</span>
                  <span className="text-right font-display text-sm text-mute tabular-nums">{r.att}</span>
                  <span className="text-right font-display text-base font-bold tabular-nums">{r.assists}</span>
                  <span className="text-right font-display text-base tabular-nums">{pct(r.eff)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        {/* History */}
        <Card title="History" info="Every point in order with the score after it, plus subs and timeouts. Orange = our point, purple = theirs." className="xl:col-span-2">
          {history.length === 0 ? <Empty /> : (
            <div className="max-h-[440px] overflow-y-auto pr-1 flex flex-col">
              {history.map((h, i) => (
                <div key={i} data-history className={`flex items-center gap-3 py-1.5 border-t border-line text-sm ${h.kind !== 'point' ? 'text-mute' : ''}`}>
                  {(i === 0 || history[i - 1].set !== h.set) && setFilter === null ? <span className="font-display text-[11px] font-bold tracking-[0.12em] text-mute w-10 shrink-0">SET {h.set}</span> : <span className="w-10 shrink-0" />}
                  <span className="font-display text-xs text-mute w-14 shrink-0 tabular-nums">{new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${h.winner === 'own' ? 'bg-primary' : h.winner === 'opponent' ? 'bg-secondary' : 'bg-transparent'}`} />
                  <span className="font-display text-base font-bold tabular-nums w-14 shrink-0">{h.kind === 'point' ? `${h.own}:${h.opponent}` : ''}</span>
                  <span className="truncate">{h.text}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <button onClick={onExport} className="h-11 px-4 rounded-lg border border-line font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center gap-2"><Download className="w-4 h-4" /> Export (email)</button>
        <button onClick={onReset} className="h-11 px-4 rounded-lg border border-bad/40 text-bad font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center gap-2"><RotateCcw className="w-4 h-4" /> New match</button>
      </div>
    </div>
  );
}
