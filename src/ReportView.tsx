import { t } from './i18n';
import { useMemo, useState } from 'react';
import { AlertTriangle, Download, RotateCcw, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { GameState, ROLE_SHORT, Role, ScaleCode } from './types';
import { currentSetNumber, formatMatchDate, scoreForSet } from './utils';
import { EffLine, N_MIN } from './alerts';
import { attackBreakdown, attackByPhase, attackByRotation, bestFirst, historyLog, impactReport, passRows, pointSources, Rating, ScaleRow, serveRows, setterRows } from './analysis';
import { ATTACK_SCALE, InfoDot, PASS_SCALE, SERVE_SCALE, TONE_CLASS } from './RallyView';

interface ReportViewProps {
  gameState: GameState;
  onExport: () => void;
  onReset: () => void;     // this match: new match. Saved match: delete it
  past?: boolean;          // viewing a saved match
  selector?: React.ReactNode;
}

const pct = (v: number | null) => (v === null ? '–' : `${v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`);
const share = (a: number, b: number) => (b ? a / b : null);

function Card({ title, info, children, className = '' }: { title: string; info: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-t border-line pt-4 flex flex-col gap-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="font-display text-base font-bold tracking-[0.14em] uppercase">{title}</span>
        <InfoDot light text={info} />
      </div>
      {children}
    </section>
  );
}

function RatingBadge({ r }: { r: Rating }) {
  if (!r) return <span className="font-display text-mute">–</span>;
  const cls = r === 'pos' ? 'bg-good/15 text-good' : r === 'neg' ? 'bg-bad/15 text-bad' : 'bg-card text-mute';
  return <span className={`justify-self-start px-2.5 py-1 rounded-full font-display text-sm font-bold uppercase tracking-[0.04em] ${cls}`}>{r === 'pos' ? t('Positive') : r === 'neg' ? t('Negative') : t('Neutral')}</span>;
}

const Empty = () => <span className="text-sm text-mute">{t("No data yet.")}</span>;

// Heatmap cell: strong green 40%+, light green 25%+, neutral 0+, red below 0. Faded until N_MIN attempts.
function HeatCell({ line }: { line: EffLine }) {
  if (!line.att) return <div className="h-14 rounded-md border border-dashed border-line" />;
  const v = line.eff!;
  const cls = v >= 0.4 ? 'bg-[rgba(16,185,129,0.85)] text-[#0B0C0E]' : v >= 0.25 ? 'bg-[rgba(16,185,129,0.35)]' : v >= 0 ? 'bg-card' : 'bg-[rgba(244,63,94,0.85)] text-[#0B0C0E]';
  return (
    <div className={`h-14 rounded-md flex flex-col items-center justify-center leading-none ${cls} ${line.att < N_MIN ? 'opacity-55' : ''}`}>
      <span className="font-display text-xl font-bold tabular-nums">{pct(v)}</span>
      <span className="font-display text-xs font-semibold opacity-70 mt-0.5">{line.att}</span>
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
      <span className={`text-xl font-bold ${tone}`}>{pct(v)}</span> <span className="text-sm text-mute">{line.att}</span>
    </span>
  );
}

// One small count column per rating, in the rating colours (worst → best)
function ScaleHead({ scale }: { scale: typeof PASS_SCALE }) {
  return <>{scale.map(sc => <span key={sc.code} className={`h-5 rounded-sm flex items-center justify-center font-display text-xs font-bold ${TONE_CLASS[sc.tone]}`} title={t(sc.label)}>{sc.sym}</span>)}</>;
}
function ScaleCounts({ row, scale }: { row: ScaleRow; scale: typeof PASS_SCALE }) {
  return <>{scale.map(sc => <span key={sc.code} className={`text-center font-display text-base tabular-nums ${row.counts[sc.code] ? '' : 'text-mute/40'}`}>{row.counts[sc.code]}</span>)}</>;
}

export default function ReportView({ gameState, onExport, onReset, past, selector }: ReportViewProps) {
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
  const attackRows = useMemo(() => attackBreakdown(gameState, setFilter), [gameState, setFilter]);
  const impact = useMemo(() => impactReport(gameState, setFilter), [gameState, setFilter]);
  const setters = useMemo(() => setterRows(gameState, setFilter), [gameState, setFilter]);
  const points = useMemo(() => pointSources(gameState, setFilter), [gameState, setFilter]);

  const filterBtn = (label: string, value: number | null) => (
    <button key={label} onClick={() => setSetFilter(value)}
      className={`h-9 px-3.5 rounded-md font-display text-sm font-bold tracking-[0.1em] uppercase ${setFilter === value ? 'border border-primary text-ink' : 'border border-line text-mute'}`}>{t(label)}</button>
  );
  const th = 'font-display text-[13px] font-bold tracking-[0.12em] uppercase text-mute';
  const name = 'font-display text-lg font-bold uppercase truncate';

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
        <div className="flex flex-wrap gap-1.5 items-center">
          {selector}
          {filterBtn('Match', null)}
          {setsWithData.map(s => filterBtn(t('Set {n}', { n: s }), s))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-x-9 gap-y-7">
        {/* Attack per player */}
        <Card title={t("Attack · Players")} className="xl:col-span-2"
          info={t("Every attack and how it ended, in the colours of the rating buttons. Eff = (kills − errors − blocked) / attempts. In match view: attempts and Eff per set.")}>
          {attackRows.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <div className="grid gap-x-2 gap-y-2.5 items-center min-w-[640px]"
                style={{ gridTemplateColumns: `110px 44px repeat(5, minmax(40px, 1fr)) 64px${setFilter === null ? ` repeat(${attackRows[0].bySet.length}, minmax(70px, 1fr))` : ''}` }}>
                <span /><span className={`${th} text-right`}>{t('Att')}</span>
                {ATTACK_SCALE.map(sc => <span key={sc.code} className={`h-6 rounded-sm flex items-center justify-center gap-1 font-display text-xs font-bold ${TONE_CLASS[sc.tone]}`} title={t(sc.label)}>{sc.sym} <span className="hidden xl:inline uppercase tracking-[0.04em]">{t(sc.label)}</span></span>)}
                <span className={`${th} text-right`}>{t('Eff')}</span>
                {setFilter === null && attackRows[0].bySet.map(b => <span key={b.set} className={`${th} text-center`}>{t('Set {n}', { n: b.set })}</span>)}
                {attackRows.map(r => (
                  <div key={r.id} className="contents" data-attack-row={r.name}>
                    <span className={`${name} ${r.id === 'team' ? 'text-primary' : ''}`}>{r.name}</span>
                    <span className="text-right font-display text-lg font-bold tabular-nums">{r.line.att}</span>
                    {ATTACK_SCALE.map(sc => <span key={sc.code} className={`text-center font-display text-lg tabular-nums ${r.counts[sc.code] ? '' : 'text-mute/40'}`}>{r.counts[sc.code]}</span>)}
                    <span className={`text-right font-display text-lg font-bold tabular-nums ${r.line.att < N_MIN ? 'opacity-55' : ''} ${r.line.eff !== null && r.line.eff >= 0.25 ? 'text-good' : r.line.eff !== null && r.line.eff < 0 ? 'text-bad' : ''}`}>{pct(r.line.eff)}</span>
                    {setFilter === null && r.bySet.map(b => (
                      <span key={b.set} className="text-center font-display tabular-nums">
                        {b.line.att ? <><span className={`text-base font-bold ${b.line.eff! >= 0.25 ? 'text-good' : b.line.eff! < 0 ? 'text-bad' : ''}`}>{pct(b.line.eff)}</span> <span className="text-sm text-mute">{b.line.att}</span></> : <span className="text-mute">–</span>}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Attack × rotation */}
        <Card title={t("Attack · Rotation")} info={t("Attack efficiency per attacker and rotation: (kills − errors − blocked) / attempts. Small number = attempts. Faded = under 5. Side-out = rallies won when they serve. Break = rallies won when we serve.")}>
          {heat.rows.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[120px_repeat(6,minmax(52px,1fr))_72px] gap-1.5 items-center min-w-[520px]">
                <span />
                {[1, 2, 3, 4, 5, 6].map(r => <span key={r} className={`${th} text-center`}>R{r}</span>)}
                <span className={`${th} text-center`}>{t("All")}</span>
                {heat.rows.map(r => (
                  <div key={r.id} className="contents" data-heat={r.name}>
                    <span className={name}>{r.name} <span className="text-[11px] text-mute">{t(ROLE_SHORT[r.role as Role])}</span></span>
                    {r.byRot.map((l, k) => <HeatCell key={k} line={l} />)}
                    <span className="text-center font-display text-xl font-bold tabular-nums">{pct(r.all.eff)}</span>
                  </div>
                ))}
                {([['Side-out', heat.sideOut, heat.so], ['Break', heat.breakPt, heat.bp]] as const).map(([label, vals, raw]) => (
                  <div key={label} className="contents">
                    <span className={th}>{t(label)}</span>
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
        <Card title={t("Attack · Pass")} info={t("In system = first attack after a # or + pass. Out of system = after ! or −. Transition = every other attack (after our serve, a dig or a recycle). Small number = attempts.")}>
          {phase.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[110px_repeat(3,minmax(0,1fr))] gap-x-2 gap-y-3 items-center">
              <span />
              {['In system', 'Out of system', 'Transition'].map(h => <span key={h} className={th}>{t(h)}</span>)}
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
        <Card title={t("Passing")} info={t("Positive % = # and +. Perfect % = #. Error % = = (aced). Coloured columns = count per rating. Best Positive % first.")}>
          {pass.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[100px_40px_repeat(3,60px)_repeat(6,minmax(28px,1fr))] gap-x-1.5 gap-y-2.5 items-center overflow-x-auto">
              <span /><span className={`${th} text-right`}>N</span>
              <span className={`${th} text-right`}>{t("Pos")}</span><span className={`${th} text-right`}>{t("Perf")}</span><span className={`${th} text-right`}>{t("Err")}</span><ScaleHead scale={PASS_SCALE} />
              {pass.map(r => (
                <div key={r.id} className="contents" data-pass={r.name}>
                  <span className={`${name} ${r.id === 'team' ? 'text-primary' : ''}`}>{r.name}</span>
                  <span className="text-right font-display text-base text-mute tabular-nums">{r.n}</span>
                  <span className="text-right font-display text-lg font-bold tabular-nums">{pct(share(r.counts['#'] + r.counts['+'], r.n))}</span>
                  <span className="text-right font-display text-lg tabular-nums">{pct(share(r.counts['#'], r.n))}</span>
                  <span className={`text-right font-display text-lg tabular-nums ${r.counts['='] ? 'text-bad' : ''}`}>{pct(share(r.counts['='], r.n))}</span>
                  <ScaleCounts row={r} scale={PASS_SCALE} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Serving */}
        <Card title={t("Serving")} info={t("Rated by how they passed it. Pressure % = serves that put them out of system or worse for them (+, / and aces). Coloured columns = count per rating. Best Pressure % first.")}>
          {serve.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[100px_40px_repeat(3,60px)_repeat(6,minmax(28px,1fr))] gap-x-1.5 gap-y-2.5 items-center overflow-x-auto">
              <span /><span className={`${th} text-right`}>N</span>
              <span className={`${th} text-right`}>{t("Ace")}</span><span className={`${th} text-right`}>{t("Err")}</span><span className={`${th} text-right`}>{t("Press")}</span><ScaleHead scale={SERVE_SCALE} />
              {serve.map(r => (
                <div key={r.id} className="contents" data-serve={r.name}>
                  <span className={`${name} ${r.id === 'team' ? 'text-primary' : ''}`}>{r.name}</span>
                  <span className="text-right font-display text-base text-mute tabular-nums">{r.n}</span>
                  <span className="text-right font-display text-lg font-bold tabular-nums">{r.counts['#']}</span>
                  <span className={`text-right font-display text-lg tabular-nums ${r.counts['='] ? 'text-bad' : ''}`}>{r.counts['=']}</span>
                  <span className="text-right font-display text-lg tabular-nums">{pct(share(r.counts['#'] + r.counts['+'] + r.counts['/'], r.n))}</span>
                  <ScaleCounts row={r} scale={SERVE_SCALE} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Points */}
        <Card title={t("Points")} info={t("Where our points came from, and how we gave points away.")}>
          <div className="grid grid-cols-2 gap-6">
            {([['Won', points.won, 'text-good'], ['Lost', points.lost, 'text-bad']] as const).map(([label, list, tone]) => (
              <div key={label} className="flex flex-col gap-1.5">
                <span className={`${th} ${tone}`}>{t(label)} · {list.reduce((a, [, n]) => a + n, 0)}</span>
                {list.filter(([, n]) => n > 0).map(([l, n]) => (
                  <div key={l} className="flex justify-between text-base lg:text-lg border-t border-line pt-2"><span>{t(l)}</span><span className="font-display font-bold tabular-nums">{n}</span></div>
                ))}
              </div>
            ))}
          </div>
        </Card>

        {/* Setter */}
        <Card title={t("Setter")} info={t("Every teammate attack counts as a set. Assist = the attack was a kill. Eff = attack efficiency of the hitters she set.")}>
          {setters.length === 0 ? <Empty /> : (
            <div className="grid grid-cols-[110px_repeat(3,72px)] gap-x-2 gap-y-2 items-center">
              <span /><span className={`${th} text-right`}>{t("Sets")}</span><span className={`${th} text-right`}>{t("Assists")}</span><span className={`${th} text-right`}>{t("Eff")}</span>
              {setters.map(r => (
                <div key={r.id} className="contents">
                  <span className={name}>{r.name}</span>
                  <span className="text-right font-display text-base text-mute tabular-nums">{r.att}</span>
                  <span className="text-right font-display text-lg font-bold tabular-nums">{r.assists}</span>
                  <span className="text-right font-display text-lg tabular-nums">{pct(r.eff)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        {/* History */}
        <Card title={t("History")} info={t("Every point in order with the score after it, plus subs, timeouts and alerts (with the score when they showed). Orange = our point, purple = theirs.")}>
          {history.length === 0 ? <Empty /> : (
            <div className="max-h-[640px] overflow-y-auto pr-1 flex flex-col">
              {history.map((h, i) => (
                <div key={i} data-history className={`flex items-center gap-3 py-2 border-t border-line text-base lg:text-lg ${h.kind !== 'point' ? 'text-mute' : ''}`}>
                  {(i === 0 || history[i - 1].set !== h.set) && setFilter === null ? <span className="font-display text-xs font-bold tracking-[0.12em] text-mute w-12 shrink-0">{t('SET')} {h.set}</span> : <span className="w-12 shrink-0" />}
                  <span className="font-display text-sm text-mute w-[4.5rem] shrink-0 tabular-nums whitespace-nowrap">{new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {h.kind === 'alert'
                    ? <AlertTriangle className="w-3.5 h-3.5 -mx-[3px] text-bad/80 shrink-0" />
                    : <span className={`w-2 h-2 rounded-full shrink-0 ${h.winner === 'own' ? 'bg-primary' : h.winner === 'opponent' ? 'bg-secondary' : 'bg-transparent'}`} />}
                  <span className={`font-display tabular-nums w-16 shrink-0 ${h.kind === 'point' ? 'text-xl font-bold' : 'text-base'}`}>{h.kind === 'point' || h.kind === 'alert' ? `${h.own}:${h.opponent}` : ''}</span>
                  <span className={h.kind === 'alert' ? 'text-ink/80' : 'truncate'} data-kind={h.kind}>{h.text}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Impact */}
        <Card title={setFilter === null ? t('Impact · Match') : t('Impact · Set {n}', { n: setFilter })}
          info={t("What decided it. Benchmarks checked against the FIVB VNL 2025 report: attack eff below 15% is a problem, from 30% a strength. Positive passes below 35% is a problem, 50%+ with max 1 reception error per set a strength. Serve errors above 10% of serves is a problem when there are more errors than aces. Also: 12+ their attack points or 3+ unforced errors per set, crunch time won or lost 60%+. Player: Pos/Neg from 3 actions. Net = points won minus points given away.")}>
          {!impact.figures.length || history.length === 0 ? <Empty /> : (
            <div className="flex flex-col gap-6" data-impact>
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-5xl font-bold tabular-nums">{impact.own} : {impact.opponent}</span>
                {impact.result !== 'open' && (
                  <span className={`px-3 py-1.5 rounded-full font-display text-sm font-bold uppercase tracking-[0.08em] ${impact.result === 'won' ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>
                    {setFilter === null ? (impact.result === 'won' ? t('Match won') : t('Match lost')) : (impact.result === 'won' ? t('Set won') : t('Set lost'))}
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                {impact.figures.map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2 border-t border-line text-base lg:text-lg"><span>{k}</span><span className="font-display text-xl font-bold tabular-nums">{v}</span></div>
                ))}
              </div>
              {impact.factors.length > 0 && (
                <div className="flex flex-col gap-4">
                  <span className={th}>{t('What decided it')}</span>
                  {impact.factors.map(fct => (
                    <div key={fct.key} className="flex gap-3" data-factor={fct.key}>
                      {fct.tone === 'bad' ? <TrendingDown className="w-6 h-6 text-bad shrink-0 mt-0.5" /> : <TrendingUp className="w-6 h-6 text-good shrink-0 mt-0.5" />}
                      <div>
                        <div className="font-display text-xl font-bold uppercase tracking-[0.03em]">{fct.title}</div>
                        <div className="text-base text-ink/75 leading-snug">{fct.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {impact.players.length > 0 && (
                <div className="grid grid-cols-[minmax(80px,1fr)_repeat(3,minmax(64px,auto))_48px] gap-x-2 gap-y-2 items-center">
                  <span className={th}>{t('Player')}</span><span className={th}>{t('Attack')}</span><span className={th}>{t('Pass')}</span><span className={th}>{t('Serve')}</span><span className={`${th} text-right`}>{t('Net')}</span>
                  {impact.players.map(pl => (
                    <div key={pl.id} className="contents" data-impact-player={pl.name}>
                      <span className={name}>{pl.name}</span>
                      <RatingBadge r={pl.attack} /><RatingBadge r={pl.pass} /><RatingBadge r={pl.serve} />
                      <span className={`text-right font-display text-xl font-bold tabular-nums ${pl.net > 0 ? 'text-good' : pl.net < 0 ? 'text-bad' : 'text-mute'}`}>{pl.net > 0 ? '+' : ''}{pl.net}</span>
                    </div>
                  ))}
                </div>
              )}
              {impact.factors.some(x => x.idea) && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between"><span className={th}>{t('Starting points')}</span><InfoDot light text={t('Generated from the problems above. A prompt for the bench, not a verdict.')} /></div>
                  <ul className="list-disc pl-5 text-base lg:text-lg space-y-1">
                    {impact.factors.filter(x => x.idea).map(x => <li key={x.key}>{x.idea}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <button onClick={onExport} className="h-11 px-4 rounded-lg border border-line font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center gap-2"><Download className="w-4 h-4" /> {t("Export (CSV)")}</button>
        <button onClick={onReset} className="h-11 px-4 rounded-lg border border-bad/40 text-bad font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center gap-2">{past ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />} {past ? t("Delete match") : t("New match")}</button>
      </div>
    </div>
  );
}
