import { t } from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Repeat, RotateCcw, RotateCw, X } from 'lucide-react';
import {
  AttackCode, GameState, Grade, MatchEvent, PendingRally, Player, PointReason, RallyStep, RatingCode, ScaleCode, Skill, StatEvent, TeamSide,
  ROLE_LABEL, ROLE_SHORT, COURT_LAYOUT,
} from './types';
import { currentSetNumber, legalSubsIn, playerLabel, setterFor, subsUsed } from './utils';
import { computeAlerts, N_MIN } from './alerts';
import { attackBreakdown, passRows, serveRows } from './analysis';
import { CourtState, positionOf } from './court';

interface RallyViewProps {
  gameState: GameState;
  setPending: (p: PendingRally | null) => void;
  commitRally: (events: MatchEvent[], message: string, snapshot?: PendingRally) => void;
  onSub: (inId: string, outId: string) => void;
  onBack: () => void;      // last action
  canBack: boolean;
  onRotate: (delta: number) => void;
  court: CourtState;
  onOpenLineup: () => void;
  onFirstServe: (team: TeamSide) => void;
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ---------- Rating scales ----------
// Colour = quality of the action being rated: dark red worst … dark green best
export type Tone = 'poor' | 'rose' | 'low' | 'neu' | 'good' | 'mid' | 'top';
export const TONE_CLASS: Record<Tone, string> = {
  poor: 'bg-[#9F1239] text-white',
  rose: 'bg-[#F43F5E] text-[#0D0F12]',
  low: 'bg-[#FDA4AF] text-[#0D0F12]',
  neu: 'bg-[#262B33] text-[#F5F7FA]',
  good: 'bg-[#6EE7B7] text-[#0D0F12]',
  mid: 'bg-[#10B981] text-[#0D0F12]',
  top: 'bg-[#047857] text-white',
};
// Only tappable buttons get a border (lighter shade of the fill).
export const TONE_BORDER: Record<Tone, string> = {
  poor: 'border-2 border-[#C81E4E]', rose: 'border-2 border-[#FB7185]', low: 'border-2 border-[#FECDD3]',
  neu: 'border-2 border-[#4A515C]', good: 'border-2 border-[#A7F3D0]', mid: 'border-2 border-[#34D399]', top: 'border-2 border-[#10B981]',
};

interface ScaleItem<C extends RatingCode> { code: C; sym: string; label: string; tone: Tone; info: string }

export const SERVE_SCALE: ScaleItem<ScaleCode>[] = [
  { code: '=', sym: '=', label: 'Error', tone: 'poor', info: 'Serve error. +1 them.' },
  { code: '-', sym: '−', label: 'Negative', tone: 'low', info: 'They pass # or +. All options for them.' },
  { code: '!', sym: '!', label: 'OK', tone: 'neu', info: 'They pass !. No quick for them.' },
  { code: '+', sym: '+', label: 'Positive', tone: 'good', info: 'They pass −. High ball only for them.' },
  { code: '/', sym: '/', label: 'Overpass', tone: 'mid', info: 'They send it straight back. Free ball: our attack next.' },
  { code: '#', sym: '#', label: 'Ace', tone: 'top', info: '+1 us.' },
];

export const PASS_SCALE: ScaleItem<ScaleCode>[] = [
  { code: '=', sym: '=', label: 'Error', tone: 'poor', info: 'Aced or reception error. +1 them.' },
  { code: '/', sym: '/', label: 'Overpass', tone: 'rose', info: "Straight back or can't be attacked. Free ball for them." },
  { code: '-', sym: '−', label: 'Negative', tone: 'low', info: 'Far off the net or so low the setter must bump. High ball only.' },
  { code: '!', sym: '!', label: 'OK', tone: 'neu', info: 'High ball inside 3 m. No quick.' },
  { code: '+', sym: '+', label: 'Positive', tone: 'good', info: 'Setter moves a little. Quick still possible.' },
  { code: '#', sym: '#', label: 'Perfect', tone: 'top', info: 'Setter has every option.' },
];

export const ATTACK_SCALE: ScaleItem<AttackCode>[] = [
  { code: 'err', sym: '−', label: 'Error', tone: 'poor', info: 'Out or net. +1 them.' },
  { code: 'blk', sym: '■', label: 'Blocked', tone: 'rose', info: 'Blocked for a point. +1 them. Counts as an error.' },
  { code: 'play', sym: '0', label: 'In play', tone: 'neu', info: 'They defend it.' },
  { code: 'rec', sym: '↺', label: 'Recycle', tone: 'good', info: 'Covered or played back by us. We attack again.' },
  { code: 'kill', sym: '#', label: 'Kill', tone: 'top', info: '+1 us.' },
];

export const OPP_ATTACK_SCALE: ScaleItem<AttackCode>[] = [
  { code: 'err', sym: '−', label: 'Error', tone: 'poor', info: 'Their attack out or net. +1 us.' },
  { code: 'blk', sym: '■', label: 'We block', tone: 'rose', info: 'We block it for a point. +1 us.' },
  { code: 'play', sym: '0', label: 'We dig', tone: 'neu', info: 'We dig it. Our attack next.' },
  { code: 'rec', sym: '↺', label: 'Recycle', tone: 'good', info: 'They keep it alive and attack again.' },
  { code: 'kill', sym: '#', label: 'Kill', tone: 'top', info: 'Their kill. +1 them.' },
];

// Coarse grade for the existing reports (stage 4 replaces these with the full scale)
export function gradeFor(skill: Skill, code: RatingCode): Grade {
  if (skill === 'attack' || skill === 'set') return code === 'kill' ? 'plus' : code === 'err' || code === 'blk' ? 'minus' : 'zero';
  if (skill === 'serve') return code === '#' ? 'plus' : code === '=' ? 'minus' : 'zero';
  return code === '#' || code === '+' ? 'plus' : code === '=' || code === '/' ? 'minus' : 'zero'; // pass
}

const CODE_TEXT: Record<string, string> = { err: 'error', blk: 'blocked', play: 'in play', rec: 'recycle', kill: 'kill', '-': '−' };
const codeText = (c: RatingCode) => (CODE_TEXT[c] ? t(CODE_TEXT[c]) : c);

const STEP_TITLE: Record<RallyStep, string> = {
  our_serve: 'Our serve', opp_serve: 'Our pass', our_attack: 'Our attack', opp_attack: 'Their attack',
};

export default function RallyView({ gameState, setPending, commitRally, onSub, onBack, canBack, onRotate, court, onOpenLineup, onFirstServe }: RallyViewProps) {
  const setNum = currentSetNumber(gameState);
  const stored = gameState.pending && gameState.pending.set === setNum ? gameState.pending : null;
  const rally: PendingRally | null = stored ?? (court.serving ? { ...freshRally(court.serving, setNum), id: `r-${setNum}-${gameState.events.length}` } : null);

  // Selection belongs to one step: a new step starts clean in the same render (no leftover highlight)
  const [pick, setPick] = useState<{ key: string; id: string | null }>({ key: '', id: null });
  const [quickFor, setQuickFor] = useState<string | null>(null);

  const serverSuggestion = rally?.step === 'our_serve' ? court.display[0] : null;
  const stepKey = rally ? `${rally.id}-${rally.step}-${rally.actions.length}-${rally.history.length}` : 'none';
  const selected = pick.key === stepKey ? pick.id : (serverSuggestion ?? null);
  const setSelected = (id: string | null) => setPick({ key: stepKey, id });

  const roleOf = (id: string) => gameState.players.find(p => p.id === id)?.role;
  const nameOf = (id: string) => {
    const i = gameState.players.findIndex(p => p.id === id);
    return i >= 0 ? playerLabel(gameState.players[i], i) : '';
  };

  // Commit and remember the state before the final tap, so Back can reopen the rally
  const commitFrom = (events: MatchEvent[], msg: string) => commitRally(events, msg, rally ?? undefined);
  const trailOf = (r: PendingRally) => r.trail ?? [];
  const advance = (r: PendingRally, step: RallyStep, actions: StatEvent[], crumb: string) => {
    setPending({
      ...r, step, actions, trail: [...trailOf(r), crumb], lastAt: Date.now(),
      history: [...r.history, { step: r.step, actionCount: r.actions.length, trailCount: trailOf(r).length }],
    });
  };

  const stat = (r: PendingRally, playerId: string, skill: Skill, code: RatingCode, point: TeamSide | null): StatEvent => ({
    kind: 'stat', id: uid('e'), rallyId: r.id, set: setNum, playerId, skill, code, grade: gradeFor(skill, code), point, timestamp: Date.now(),
    pos: positionOf(court, playerId) ?? undefined, rot: court.rotation ?? undefined,
    ...(code === 'rec' ? { recycle: true } : {}),
  });

  const endWithPoint = (r: PendingRally, team: TeamSide, reason: PointReason, extra: StatEvent[] = [], msg = '', playerId?: string) => {
    const pointEvent: MatchEvent = { kind: 'point', id: uid('e'), rallyId: r.id, set: setNum, team, reason, timestamp: Date.now(), ...(playerId ? { playerId } : {}) };
    commitRally([...r.actions, ...extra, pointEvent], msg || (team === 'own' ? '+1 us' : '+1 them'), r);
  };

  const rateServe = (code: ScaleCode) => {
    if (!rally || !selected) return;
    const who = nameOf(selected);
    if (code === '#') return commitFrom([...rally.actions, stat(rally, selected, 'serve', code, 'own')], `${who} ace · +1 us`);
    if (code === '=') return commitFrom([...rally.actions, stat(rally, selected, 'serve', code, 'opponent')], `${who} serve error · +1 them`);
    // Overpass = free ball: our attack next. Everything else: they attack.
    advance(rally, code === '/' ? 'our_attack' : 'opp_attack', [...rally.actions, stat(rally, selected, 'serve', code, null)], t('{who} serve {c}', { who, c: codeText(code) }));
  };

  const ratePass = (code: ScaleCode) => {
    if (!rally || !selected) return;
    const who = nameOf(selected);
    if (code === '=') return endWithPoint(rally, 'opponent', 'opp_ace', [stat(rally, selected, 'pass', code, null)], `${who} aced · +1 them`);
    // Overpass = free ball for them
    advance(rally, code === '/' ? 'opp_attack' : 'our_attack', [...rally.actions, stat(rally, selected, 'pass', code, null)], t('{who} pass {c}', { who, c: codeText(code) }));
  };

  const rateAttack = (code: AttackCode) => {
    if (!rally || !selected) return;
    const who = nameOf(selected);
    // Setter gets an attempt on every teammate attack, an assist on a kill
    const setterId = setterFor(gameState, selected);
    const setEv = setterId ? [stat(rally, setterId, 'set', code, null)] : [];
    if (code === 'kill') {
      const assist = setterId ? ` · assist ${nameOf(setterId)}` : '';
      return commitFrom([...rally.actions, ...setEv, stat(rally, selected, 'attack', code, 'own')], `${who} kill${assist} · +1 us`);
    }
    if (code === 'err' || code === 'blk') return commitFrom([...rally.actions, ...setEv, stat(rally, selected, 'attack', code, 'opponent')], `${who} ${codeText(code)} · +1 them`);
    advance(rally, code === 'rec' ? 'our_attack' : 'opp_attack', [...rally.actions, ...setEv, stat(rally, selected, 'attack', code, null)], t('{who} attack {c}', { who, c: codeText(code) }));
  };

  // Freeball: a neutral team ball, no player stats. Ours → their attack next; theirs → our attack next.
  // If it drops, the scout uses Their fault / Our fault.
  const freeball = () => {
    if (!rally) return;
    if (rally.step === 'our_attack') advance(rally, 'opp_attack', rally.actions, t('Our freeball'));
    else if (rally.step === 'opp_attack') advance(rally, 'our_attack', rally.actions, t('Their freeball'));
  };

  const rateOpp = (code: AttackCode) => {
    if (!rally) return;
    if (code === 'err') return endWithPoint(rally, 'own', 'opp_attack_error', [], 'Their attack error · +1 us');
    if (code === 'blk') return endWithPoint(rally, 'own', 'opp_blocked', [], 'Our block · +1 us');
    if (code === 'kill') return endWithPoint(rally, 'opponent', 'opp_attack_point', [], 'Their kill · +1 them');
    advance(rally, code === 'rec' ? 'opp_attack' : 'our_attack', rally.actions, code === 'rec' ? t('Their recycle') : t('We dig'));
  };

  const theirFault = () => rally && endWithPoint(rally, 'own', rally.step === 'opp_serve' && rally.actions.length === 0 ? 'opp_serve_error' : 'other',
    [], rally.step === 'opp_serve' && rally.actions.length === 0 ? 'Their serve error · +1 us' : 'Their fault · +1 us');
  const ourFault = () => rally && endWithPoint(rally, 'opponent', 'other', [], 'Our fault · +1 them');
  const replay = () => { setPending(null); };

  const unforcedError = (playerId: string) => {
    if (!rally) return;
    endWithPoint(rally, 'opponent', 'own_error', [], `${nameOf(playerId)} unforced error · +1 them`, playerId);
    setQuickFor(null);
  };

  const isEligible = (step: RallyStep, p: Player) =>
    step === 'our_serve' ? p.role !== 'libero' :
    step === 'opp_serve' ? true :
    step === 'our_attack' ? p.role !== 'libero' && !(p.role === 'setter' && [5, 6, 1].includes(court.display.indexOf(p.id) + 1)) : false;

  const used = subsUsed(gameState.events, setNum);
  // Subs only between rallies
  const rallyRunning = !!(stored && (stored.history.length > 0 || stored.actions.length > 0));
  const legalFor = (outId: string) => legalSubsIn(gameState, setNum, outId, court.positions);
  const own = rally ? rally.step !== 'opp_attack' : true;

  const crumbs = rally ? [rally.servingTeam === 'own' ? t('We serve') : t('They serve'), ...trailOf(rally)] : [];

  const needsPick = !!rally && (rally.step === 'our_serve' || rally.step === 'opp_serve' || rally.step === 'our_attack');

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,47fr)_minmax(0,53fr)]">
      {/* LEFT: alerts + stats */}
      <aside className="order-2 lg:order-1 shrink-0 lg:shrink flex flex-col lg:min-h-0 border-t lg:border-t-0 lg:border-r border-line">
        <AlertsPanel gameState={gameState} rotation={court.rotation} display={court.display} />
        <StatsTable gameState={gameState} display={court.display} />
      </aside>

      {/* RIGHT: court, step, rating buttons */}
      <section className={`order-1 lg:order-2 shrink-0 lg:shrink flex flex-col lg:min-h-0 gap-3 p-4 lg:px-5 lg:py-4 border-t-[3px] ${own ? 'border-t-primary' : 'border-t-secondary bg-[#1C1A24]'}`}>
        <div className="flex items-center gap-1.5">
          <button onClick={() => onRotate(-1)} aria-label="Rotate back" className="h-9 px-2.5 rounded-md border border-line text-mute font-display font-bold text-xs flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />−1</button>
          <button onClick={() => onRotate(1)} aria-label="Rotate forward" className="h-9 px-2.5 rounded-md border border-line text-mute font-display font-bold text-xs flex items-center gap-1"><RotateCw className="w-3.5 h-3.5" />+1</button>
          <div className="flex-1 flex justify-center">
            <button onClick={onOpenLineup} data-rotation className="h-9 px-3 rounded-md border border-line font-display text-lg font-bold tracking-[0.08em] uppercase text-ink">
              {court.rotation ? `R${court.rotation}` : t('Lineup')}
            </button>
          </div>
          <span data-subs className={`font-display font-bold tracking-[0.08em] uppercase text-[13px] whitespace-nowrap ${used >= gameState.subLimit ? 'text-bad' : 'text-mute'}`}>{t('Subs')} {used}/{gameState.subLimit}</span>
        </div>
        <div className="space-y-2.5">
          {COURT_LAYOUT.map((row, r) => (
            <div key={r} className={`grid grid-cols-3 gap-2.5 ${r === 1 ? 'pt-2.5 border-t border-dashed border-line' : ''}`}>
              {row.map(pos => {
                const id = court.display[pos - 1];
                const i = gameState.players.findIndex(p => p.id === id);
                const p = i >= 0 ? gameState.players[i] : null;
                const ok = !!(p && rally && isEligible(rally.step, p));
                return (
                  <CourtSlot key={pos} pos={pos} player={p} label={p ? (p.name.trim() || playerLabel(p, i)) : '–'} selected={!!p && selected === p.id}
                    dimmed={needsPick && !ok}
                    onTap={() => { if (!p) return; if (ok) setSelected(p.id); else setQuickFor(p.id); }}
                    onLong={() => p && setQuickFor(p.id)} />
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-mute font-display tracking-[0.08em] uppercase -mt-1">{t("Hold a player for error or sub")}</p>

        {!rally ? (
          <div className="flex-1 flex items-center justify-center">
            {court.hasLineup ? (
              <div className="grid grid-cols-2 gap-3 w-full">
                <button onClick={() => onFirstServe('own')} className="h-28 rounded-xl bg-primary text-[#0D0F12] font-display font-bold tracking-[0.12em] uppercase text-2xl">{t("We serve")}</button>
                <button onClick={() => onFirstServe('opponent')} className="h-28 rounded-xl bg-secondary text-[#0D0F12] font-display font-bold tracking-[0.12em] uppercase text-2xl">{t("They serve")}</button>
              </div>
            ) : (
              <button onClick={onOpenLineup} className="h-20 px-10 rounded-xl bg-primary text-[#0D0F12] font-display font-bold tracking-[0.12em] uppercase text-xl">{t('Set lineup for set {n}', { n: setNum })}</button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mt-1">
              <h2 className={`flex-1 font-display text-2xl xl:text-3xl font-bold tracking-[0.06em] uppercase leading-none ${own ? 'text-primary' : 'text-secondary'}`}>{t(STEP_TITLE[rally.step])}</h2>
              <button onClick={replay} data-replay
                className="h-9 px-3 rounded-lg border border-line font-display font-bold tracking-[0.1em] uppercase text-xs flex items-center gap-1.5 text-mute"><Repeat className="w-4 h-4" /> {t("Replay")}</button>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 -mt-1 font-display text-[13px] font-semibold tracking-[0.1em] uppercase text-mute">
              {/* Back = last action. Right after a point it reopens that rally at its final rating */}
              <button onClick={onBack} disabled={!canBack} data-back
                className="h-8 px-3 mr-1 rounded-md border-[1.5px] border-primary text-primary font-display font-bold text-xs tracking-[0.1em] uppercase disabled:opacity-25 disabled:border-line disabled:text-mute">← {t('Back')}</button>
              {crumbs.map((c, i) => <span key={i}>{i > 0 && <span className="mr-2 opacity-50">/</span>}{c}</span>)}
            </div>
            <div className="lg:flex-1 flex flex-col justify-center py-2 lg:py-0">
              {/* No exit animation: old buttons must never stay tappable after a step change */}
              <motion.div key={stepKey} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }}>
                {rally.step === 'our_serve' && <Scale items={SERVE_SCALE} cols={3} disabled={!selected} onPick={rateServe} />}
                {rally.step === 'opp_serve' && <Scale items={PASS_SCALE} cols={3} disabled={!selected} onPick={ratePass} />}
                {rally.step === 'our_attack' && <Scale items={ATTACK_SCALE} cols={5} disabled={!selected} onPick={rateAttack} />}
                {rally.step === 'opp_attack' && <Scale items={OPP_ATTACK_SCALE} cols={5} disabled={false} onPick={rateOpp} />}
                {needsPick && !selected && (
                  <p className="mt-3 text-center font-display text-xs font-semibold tracking-[0.12em] uppercase text-mute">{t("Tap the player on the court")}</p>
                )}
              </motion.div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={theirFault} className="h-11 rounded-lg border border-line font-display font-bold tracking-[0.06em] uppercase text-sm px-1 leading-tight">{t("Their fault")}</button>
              <button onClick={ourFault} className="h-11 rounded-lg border border-line font-display font-bold tracking-[0.06em] uppercase text-sm px-1 leading-tight">{t("Our fault")}</button>
              {rally.step === 'our_attack' || rally.step === 'opp_attack' ? (
                <div className="relative">
                  <button onClick={freeball} data-freeball
                    className={`w-full h-11 rounded-lg border-[1.5px] font-display font-bold tracking-[0.1em] uppercase text-sm ${rally.step === 'our_attack' ? 'border-primary text-primary' : 'border-secondary text-secondary'}`}>{t('Freeball')}</button>
                  <span className="absolute top-1 right-1 flex leading-none"><InfoDot light text={rally.step === 'our_attack' ? t('We send a freeball over. Neutral, no player stats. Their attack next. If it drops: Their fault.') : t('They send a freeball over. Neutral. Our attack next. If it drops: Our fault.')} /></span>
                </div>
              ) : <div />}
            </div>
          </>
        )}
      </section>

      <AnimatePresence>
        {quickFor && (
          <QuickSheet key="quick" player={gameState.players.find(p => p.id === quickFor)!} pos={positionOf(court, quickFor)}
            label={nameOf(quickFor)} players={gameState.players} legal={legalFor(quickFor)} blocked={rallyRunning} canError={!!rally}
            used={used} limit={gameState.subLimit}
            onError={() => unforcedError(quickFor)} onSub={inId => { onSub(inId, quickFor); setQuickFor(null); }} onClose={() => setQuickFor(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Left panel ----------

type AlertFilter = 'all' | 'player' | 'rotation' | 'team';
const alertCat = (id: string): Exclude<AlertFilter, 'all'> => /^A(3|4|8r)/.test(id) ? 'rotation' : /^A(5|7)$/.test(id) ? 'team' : 'player';
const FILTER_LABEL: Record<AlertFilter, string> = { all: 'All', player: 'Players', rotation: 'Rotation', team: 'Team' };
const TAG_LABEL: Record<Exclude<AlertFilter, 'all'>, string> = { player: 'Player', rotation: 'Rotation', team: 'Team' };

// Top 3 now; Show all = every alert that is true now plus everything logged this match
function AlertsPanel({ gameState, rotation, display }: { gameState: GameState; rotation: number | null; display: (string | null)[] }) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const [menu, setMenu] = useState(false);
  const all = useMemo(() => computeAlerts(gameState, rotation, display), [gameState, rotation, display]);
  const keep = (id: string) => filter === 'all' || alertCat(id) === filter;
  const now = all.filter(a => keep(a.id));
  const shown = showAll ? now : now.slice(0, 3);
  const log = showAll ? [...(gameState.alertLog ?? [])].filter(a => keep(a.id)).reverse() : [];
  const tagTone = (id: string) => alertCat(id) === 'rotation' ? 'text-[#FDA4AF]' : alertCat(id) === 'team' ? 'text-secondary' : 'text-primary';
  return (
    <div className={`flex flex-col p-4 lg:px-5 lg:py-4 min-h-0 ${showAll ? 'flex-1' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-display text-sm font-bold tracking-[0.14em] uppercase">{t("Alerts")}</span>
        <span className="font-display text-xs font-bold tracking-[0.1em] uppercase text-mute">· {now.length}</span>
        <InfoDot light text={t('Max 3, most important first. Shown while true. No rate before {n} actions.', { n: N_MIN })} />
        <div className="flex-1" />
        <div className="relative">
          <button onClick={() => setMenu(m => !m)} data-alert-filter
            className="h-8 px-2.5 rounded-md border border-line font-display font-bold tracking-[0.08em] uppercase text-xs whitespace-nowrap">{t('Filter')}: {t(FILTER_LABEL[filter])} ▾</button>
          {menu && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg bg-surface border border-line shadow-2xl p-1">
              {(Object.keys(FILTER_LABEL) as AlertFilter[]).map(f => (
                <button key={f} onClick={() => { setFilter(f); setMenu(false); }}
                  className={`w-full text-left px-3 py-2 rounded-md font-display font-bold tracking-[0.06em] uppercase text-sm ${filter === f ? 'text-primary bg-background' : ''}`}>{t(FILTER_LABEL[f])}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setShowAll(v => !v)} data-alert-all
          className={`h-8 px-2.5 rounded-md border font-display font-bold tracking-[0.08em] uppercase text-xs whitespace-nowrap ${showAll ? 'border-primary text-primary' : 'border-line'}`}>{showAll ? t('Top 3') : t('Show all')}</button>
      </div>
      <div className={showAll ? 'flex-1 min-h-0 overflow-y-auto' : ''}>
        {shown.length === 0 && <p className="text-sm text-mute py-2">{t("Nothing right now.")}</p>}
        {shown.map(a => (
          <div key={a.id} data-alert={a.id} className="flex gap-3 items-start py-2 border-t border-line">
            <span className={`w-[70px] shrink-0 pt-0.5 font-display text-[11px] font-bold tracking-[0.1em] uppercase ${tagTone(a.id)}`}>{t(TAG_LABEL[alertCat(a.id)])}</span>
            <span className={`text-sm leading-snug font-bold ${a.tone === 'bad' ? '' : 'text-mute'}`}>{a.text}</span>
          </div>
        ))}
        {showAll && log.length > 0 && (
          <>
            <div className="pt-3 pb-1 font-display text-[11px] font-bold tracking-[0.14em] uppercase text-mute">{t('Earlier')}</div>
            {log.map((a, k) => (
              <div key={`${a.id}-${a.time}-${k}`} data-alert-log className="flex gap-3 items-start py-1.5 border-t border-line">
                <span className="w-[70px] shrink-0 pt-0.5 font-display text-[11px] font-bold tracking-[0.06em] text-mute whitespace-nowrap">{t('SET')} {a.set} · {a.own}:{a.opponent}</span>
                <span className="text-[13px] leading-snug text-mute">{a.text}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const pctTxt = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');

// Match stats per player: on court first (by number), then the bench
function StatsTable({ gameState, display }: { gameState: GameState; display: (string | null)[] }) {
  const atk = useMemo(() => attackBreakdown(gameState, null), [gameState]);
  const pass = useMemo(() => passRows(gameState, null), [gameState]);
  const serve = useMemo(() => serveRows(gameState, null), [gameState]);
  const num = (p: Player) => parseInt(p.number, 10) || 999;
  const onCourt = gameState.players.filter(p => display.includes(p.id)).sort((a, b) => num(a) - num(b));
  const bench = gameState.players.filter(p => !display.includes(p.id)).sort((a, b) => num(a) - num(b));
  const th = 'font-display text-[11px] font-bold tracking-[0.08em] text-mute text-right px-1.5 pb-1.5';
  const grp = 'font-display text-[13px] font-bold tracking-[0.12em] uppercase text-ink text-center px-1.5 pb-0.5 border-l border-line';
  const td = 'text-right px-1.5 py-[5px] font-display text-[15px] font-bold tabular-nums';
  const row = (p: Player, dim: boolean) => {
    const a = atk.find(r => r.id === p.id);
    const ps = pass.find(r => r.id === p.id);
    const sv = serve.find(r => r.id === p.id);
    const c = a?.counts;
    const eff = a?.line.eff ?? null;
    const att = a?.line.att ?? 0;
    const effTone = eff === null || att < N_MIN ? 'text-mute' : eff >= 0.3 ? 'text-good' : eff < 0.15 ? 'text-bad' : '';
    const pPos = ps ? ps.counts['#'] + ps.counts['+'] : 0;
    const pTone = !ps || ps.n < N_MIN ? '' : pPos / ps.n >= 0.5 ? 'text-good' : pPos / ps.n < 0.35 ? 'text-bad' : '';
    const err = c ? c.err + c.blk : 0;
    return (
      <tr key={p.id} data-stat={p.name.trim() || p.number} className={`border-t border-line ${dim ? 'opacity-45' : ''}`}>
        <td className="px-1.5 py-[5px] font-display text-base font-bold w-10">{p.number.trim() || p.name.trim().slice(0, 3).toUpperCase()}</td>
        <td className={`${td} border-l border-line ${effTone}`}>{eff === null ? '–' : `${eff < 0 ? '−' : ''}${Math.abs(Math.round(eff * 100))}%`}</td>
        <td className={`${td} ${c?.kill ? 'text-good' : 'text-mute'}`}>{c ? c.kill : 0}</td>
        <td className={`${td} ${c && c.play + c.rec ? '' : 'text-mute'}`}>{c ? c.play + c.rec : 0}</td>
        <td className={`${td} ${err ? 'text-bad' : 'text-mute'}`}>{err}</td>
        <td className={`${td} text-mute`}>{att}</td>
        <td className={`${td} border-l border-line ${pTone}`}>{ps ? pctTxt(pPos, ps.n) : '–'}</td>
        <td className={td}>{ps ? pctTxt(ps.counts['='] + ps.counts['/'] + ps.counts['-'], ps.n) : '–'}</td>
        <td className={`${td} border-l border-line`}>{sv ? pctTxt(sv.counts['#'] + sv.counts['/'] + sv.counts['+'], sv.n) : '–'}</td>
        <td className={td}>{sv ? pctTxt(sv.counts['='] + sv.counts['-'], sv.n) : '–'}</td>
      </tr>
    );
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-line p-4 lg:px-5 lg:py-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-display text-sm font-bold tracking-[0.14em] uppercase">{t('Stats')}</span>
        <span className="font-display text-xs font-bold tracking-[0.1em] uppercase text-mute">· {t('Match')}</span>
        <div className="flex-1" />
        <InfoDot light text={t('K kills · N in play + recycle · ERR error + blocked · TOT attacks. Pass POS # and +, NEG = / −. Serve POS # / +, NEG = and −.')} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full border-collapse" data-stats>
          <thead>
            <tr><th /><th colSpan={5} className={grp}>{t('Attack')}</th><th colSpan={2} className={grp}>{t('Pass')}</th><th colSpan={2} className={grp}>{t('Serve')}</th></tr>
            <tr>
              <th className={`${th} text-left`}>#</th>
              <th className={`${th} border-l border-line`}>{t('EFF')}</th><th className={th}>K</th><th className={th}>N</th><th className={th}>{t('ERR')}</th><th className={th}>{t('TOT')}</th>
              <th className={`${th} border-l border-line`}>{t('POS')}</th><th className={th}>{t('NEG')}</th>
              <th className={`${th} border-l border-line`}>{t('POS')}</th><th className={th}>{t('NEG')}</th>
            </tr>
          </thead>
          <tbody>
            {onCourt.map(p => row(p, false))}
            {bench.length > 0 && (
              <tr><td colSpan={10} className="pt-2.5 pb-1 px-1.5 font-display text-[11px] font-bold tracking-[0.14em] uppercase text-mute border-t border-[#3A404A]">{t('Bench')}</td></tr>
            )}
            {bench.map(p => row(p, true))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function freshRally(servingTeam: TeamSide, set: number): PendingRally {
  return { id: uid('r'), set, servingTeam, step: servingTeam === 'own' ? 'our_serve' : 'opp_serve', actions: [], trail: [], history: [] };
}

// ---------- Pieces ----------

export function InfoDot({ text, light }: { text: string; light?: boolean }) {
  const [open, setOpen] = useState(false);
  // Closes on its own after 4.5 s, or on the next tap anywhere
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 4500);
    const close = () => setOpen(false);
    const id = window.setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => { window.clearTimeout(timer); window.clearTimeout(id); document.removeEventListener('pointerdown', close); };
  }, [open]);
  return (
    <span className="relative inline-flex leading-none">
      {/* Small circle with a ~24px tap area, kept in the corner so it is not hit by accident */}
      <span role="button" tabIndex={0} aria-label="Info"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        onPointerDown={e => e.stopPropagation()}
        className="p-[5px] -m-[5px] cursor-pointer inline-flex">
        <span className={`w-[14px] h-[14px] rounded-full border flex items-center justify-center text-[10px] leading-none italic font-bold font-serif ${light ? 'border-white/45 text-white/75' : 'border-black/30 text-black/55'}`}>i</span>
      </span>
      {open && (
        <span onClick={e => { e.stopPropagation(); setOpen(false); }}
          className="absolute right-0 bottom-[calc(100%+8px)] z-20 w-52 rounded-lg bg-ink text-[#0B0C0E] px-3 py-2 text-[13px] font-bold leading-snug shadow-2xl normal-case tracking-normal text-left font-sans">{text}</span>
      )}
    </span>
  );
}

function Scale<C extends RatingCode>({ items, cols, disabled, onPick }: { items: ScaleItem<C>[]; cols: 3 | 5; disabled: boolean; onPick: (c: C) => void }) {
  return (
    <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-5'}`}>
      {items.map(it => {
        const light = it.tone === 'poor' || it.tone === 'neu' || it.tone === 'top';
        return (
          <div key={it.code} className="relative">
            <button onClick={() => onPick(it.code)} disabled={disabled} data-code={it.code}
              className={`w-full ${cols === 3 ? 'h-20 lg:h-[88px] xl:h-28' : 'h-24 lg:h-28 xl:h-32'} rounded-xl flex flex-col items-center justify-center gap-1.5 transition-transform active:scale-95 disabled:opacity-30 ${TONE_CLASS[it.tone]} ${TONE_BORDER[it.tone]}`}>
              <span className={`font-display font-bold leading-[0.9] ${cols === 3 ? 'text-5xl' : 'text-[44px]'}`}>{it.sym}</span>
              <span className={`font-display font-bold uppercase text-center leading-tight px-1 ${cols === 3 ? 'text-[15px] tracking-[0.12em]' : 'text-[12px] lg:text-[13px] tracking-[0.02em]'}`}>{t(it.label)}</span>
            </button>
            <span className="absolute top-1 right-1 flex leading-none"><InfoDot text={t(it.info)} light={light} /></span>
          </div>
        );
      })}
    </div>
  );
}

function CourtSlot({ pos, player, label, selected, dimmed, onTap, onLong }: {
  pos: number; player: Player | null; label: string; selected: boolean; dimmed: boolean; onTap: () => void; onLong: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const longFired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fireLong = () => { if (longFired.current) return; longFired.current = true; window.clearTimeout(timer.current); onLong(); };
  // Touch browsers cancel the pointer during a hold (pointercancel/pointerleave), so only movement or lifting the finger stops it
  const start = (e: React.PointerEvent) => {
    longFired.current = false; origin.current = { x: e.clientX, y: e.clientY };
    window.clearTimeout(timer.current); timer.current = window.setTimeout(fireLong, 450);
  };
  const move = (e: React.PointerEvent) => {
    const o = origin.current;
    if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 12) { window.clearTimeout(timer.current); origin.current = null; }
  };
  const end = () => { window.clearTimeout(timer.current); origin.current = null; };
  const libero = player?.role === 'libero';
  return (
    <button
      onPointerDown={start} onPointerMove={move} onPointerUp={end}
      onContextMenu={e => { e.preventDefault(); if (origin.current || timer.current) fireLong(); }}
      onClick={() => { if (!longFired.current) onTap(); longFired.current = false; }}
      style={{ WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      data-slot={label} data-dim={dimmed ? '1' : '0'}
      className={`h-[68px] xl:h-20 rounded-lg flex flex-col items-center justify-center gap-0.5 px-1 transition-all select-none ${
        selected ? 'border-[1.5px] border-primary bg-primary/10' : libero ? 'border border-dashed border-mute' : 'border border-line'
      } ${dimmed ? 'opacity-35' : ''}`}>
      <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute">P{pos}</span>
      {/* Narrow court column (iPad landscape): smaller name, no jersey number */}
      <span className={`font-display text-lg xl:text-xl font-bold uppercase leading-none truncate max-w-full ${selected ? 'text-primary' : ''}`}>{label}</span>
      {player && <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute whitespace-nowrap">{player.name.trim() && player.number.trim() ? <span>#{player.number.trim()} · </span> : null}{t(ROLE_SHORT[player.role])}</span>}
    </button>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Lifting the finger after a long press sends a tap that would land on the backdrop: ignore taps right after opening
  const openedAt = useRef(Date.now());
  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/70"
      onClick={() => { if (Date.now() - openedAt.current > 500) onClose(); }}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.15 }}
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-line p-5 rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl max-h-[85dvh] overflow-y-auto space-y-4">
        {children}
      </motion.div>
    </div>
  );
}

function QuickSheet({ player, pos, label, players, legal, blocked, canError, used, limit, onError, onSub, onClose }: {
  player: Player; pos: number | null; label: string; players: Player[]; legal: string[]; blocked: boolean; canError: boolean;
  used: number; limit: number; onError: () => void; onSub: (inId: string) => void; onClose: () => void;
}) {
  // Only legal subs are offered (see legalSubsIn)
  const bench = players.map((p, i) => ({ p, i })).filter(x => legal.includes(x.p.id));
  // Suggested first: same role; setter and opposite also suggest each other. Then by jersey number.
  const pair: Partial<Record<string, string>> = { setter: 'opposite', opposite: 'setter' };
  const suggested = (r: string) => r === player.role || r === pair[player.role];
  const rank = (r: string) => (r === player.role ? 0 : suggested(r) ? 1 : 2);
  const num = (x: { p: Player }) => parseInt(x.p.number, 10) || 999;
  const sorted = [...bench].sort((a, b) => rank(a.p.role) - rank(b.p.role) || num(a) - num(b));
  const subsOpen = !blocked && used < limit;
  return (
    <Sheet onClose={onClose}>
      <div className="flex justify-between items-start">
        <div>
          <div className="font-display text-3xl font-bold uppercase tracking-[0.04em] leading-none">{label}</div>
          <div className="font-display text-xs font-semibold tracking-[0.12em] text-mute mt-1">{t(ROLE_SHORT[player.role])}{pos ? ` · P${pos}` : ''}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-lg border border-line flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      <div className="relative">
        <button onClick={onError} disabled={!canError}
          className={`w-full h-16 rounded-xl font-display text-lg font-bold tracking-[0.12em] uppercase disabled:opacity-30 ${TONE_CLASS.poor} ${TONE_BORDER.poor}`}>{t("Unforced error")}</button>
        <span className="absolute top-1/2 -translate-y-1/2 right-3.5 flex"><InfoDot light text={t("Net touch, foot fault, double contact. +1 them. Pass and attacks so far stay recorded.")} /></span>
      </div>
      {player.role === 'libero' && (
        <>
          <div className="flex justify-between items-center">
            <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t('Libero swap')}{blocked ? ` · ${t('after the rally')}` : ''}</span>
            <InfoDot light text={t("Doesn't count as a sub.")} />
          </div>
          {players.filter(p => p.role === 'libero' && p.id !== player.id).length === 0 && <p className="text-sm text-mute">{t('No other libero in roster.')}</p>}
          <div className="grid grid-cols-2 gap-2">
            {players.map((p, i) => ({ p, i })).filter(x => x.p.role === 'libero' && x.p.id !== player.id).map(({ p, i }) => (
              <button key={p.id} onClick={() => onSub(p.id)} disabled={blocked}
                className="h-14 rounded-lg text-left px-3.5 flex flex-col justify-center disabled:opacity-30 border-[1.5px] border-primary">
                <span className="font-display text-lg font-bold uppercase leading-tight truncate">{p.name.trim() || playerLabel(p, i)}</span>
                <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute">{p.number.trim() ? `#${p.number.trim()} · ` : ''}{t(ROLE_SHORT[p.role])}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {player.role !== 'libero' && (
        <>
          <div className="flex justify-between items-center">
            <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t('Sub')} · {used}/{limit}{blocked ? ` · ${t('after the rally')}` : ''}</span>
            <InfoDot light text={t("Only legal subs are shown. Same role first (orange); setter and opposite also suggest each other.")} />
          </div>
          {!blocked && used >= limit && <p className="text-sm text-bad">{t("Sub limit reached.")}</p>}
          {!blocked && used < limit && sorted.length === 0 && <p className="text-sm text-mute">{t("No legal sub.")}</p>}
          <div className="grid grid-cols-2 gap-2">
            {sorted.map(({ p, i }) => (
              <button key={p.id} onClick={() => onSub(p.id)} disabled={!subsOpen}
                className={`h-14 rounded-lg text-left px-3.5 flex flex-col justify-center disabled:opacity-30 ${suggested(p.role) ? 'border-[1.5px] border-primary' : 'border border-line'}`}>
                <span className="font-display text-lg font-bold uppercase leading-tight truncate">{p.name.trim() || playerLabel(p, i)}</span>
                <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute">{p.number.trim() ? `#${p.number.trim()} · ` : ''}{t(ROLE_SHORT[p.role])}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

