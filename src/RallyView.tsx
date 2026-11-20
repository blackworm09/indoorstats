import { t } from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, RotateCcw, RotateCw, Undo2, X } from 'lucide-react';
import {
  AttackCode, GameState, Grade, MatchEvent, PendingRally, Player, PointReason, RallyStep, RatingCode, ScaleCode, Skill, StatEvent, TeamSide,
  ROLE_LABEL, ROLE_SHORT, COURT_LAYOUT,
} from './types';
import { currentSetNumber, legalSubsIn, playerLabel, setterFor, subsUsed } from './utils';
import { attackBoard, computeAlerts, EffLine, N_MIN } from './alerts';
import { CourtState, positionOf } from './court';

interface RallyViewProps {
  gameState: GameState;
  setPending: (p: PendingRally | null) => void;
  commitRally: (events: MatchEvent[], message: string) => void;
  onSub: (inId: string, outId: string) => void;
  onUndo: () => void;
  onRotate: (delta: number) => void;
  canUndo: boolean;
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
  neu: 'bg-[#262B33] text-[#F5F7FA] border-[1.5px] border-[#3A404A]',
  good: 'bg-[#6EE7B7] text-[#0D0F12]',
  mid: 'bg-[#10B981] text-[#0D0F12]',
  top: 'bg-[#047857] text-white',
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

// ---------- Where players act (attack zone derived from the role) ----------
interface Slot { label: string; id: string | null }
const posOf = (display: (string | null)[], id: string) => display.indexOf(id) + 1;

function attackSlots(display: (string | null)[], roleOf: (id: string) => Player['role'] | undefined): Slot[][] {
  // Arrays, not objects: number-like object keys would reorder to 2, 3, 4
  const front: Slot[] = [{ label: '4', id: null }, { label: '3', id: null }, { label: '2', id: null }];
  const back: Slot[] = [{ label: '', id: null }, { label: 'Pipe', id: null }, { label: 'D', id: null }];
  const frontIds = [4, 3, 2].map(p => display[p - 1]).filter((id): id is string => !!id && roleOf(id) !== 'libero');
  const backIds = [5, 6, 1].map(p => display[p - 1]).filter((id): id is string => !!id && roleOf(id) !== 'libero' && roleOf(id) !== 'setter');
  const place = (slots: Slot[], ids: string[], pref: (id: string) => string | undefined, byPos: (id: string) => string) => {
    const at = (label: string | undefined) => slots.find(x => x.label === label);
    const left: string[] = [];
    ids.forEach(id => { const sl = at(pref(id)); if (sl && !sl.id) sl.id = id; else left.push(id); });
    left.forEach(id => { const sl = at(byPos(id)); if (sl && !sl.id) sl.id = id; else { const free = slots.find(x => !x.id); if (free) free.id = id; } });
  };
  place(front, frontIds, id => ({ outside: '4', middle: '3', opposite: '2', setter: '2' } as Record<string, string>)[roleOf(id) ?? ''], id => String(posOf(display, id)));
  place(back, backIds, id => ({ outside: 'Pipe', opposite: 'D' } as Record<string, string>)[roleOf(id) ?? ''], id => ({ 5: '', 6: 'Pipe', 1: 'D' } as Record<number, string>)[posOf(display, id)]);
  return [front, back];
}

// Receivers left to right as they stand: libero and outsides first, the rest below
function passSlots(display: (string | null)[], roleOf: (id: string) => Player['role'] | undefined): Slot[][] {
  const x = (id: string) => ({ 4: 0, 5: 0, 3: 1, 6: 1, 2: 2, 1: 2 } as Record<number, number>)[posOf(display, id)];
  const back = (id: string) => [5, 6, 1].includes(posOf(display, id)) ? 0 : 1;
  // Everyone on court can take the first ball (short serves): setter and middles sit in the second row
  const ids = display.filter((id): id is string => !!id).sort((a, b) => x(a) - x(b) || back(a) - back(b));
  const primary = ids.filter(id => roleOf(id) === 'libero' || roleOf(id) === 'outside');
  const rest = ids.filter(id => !primary.includes(id));
  return [primary.map(id => ({ label: '', id })), rest.map(id => ({ label: '', id }))].filter(r => r.length);
}

const STEP_TITLE: Record<RallyStep, string> = {
  our_serve: 'Our serve', opp_serve: 'Our pass', our_attack: 'Our attack', opp_attack: 'Their attack',
};

export default function RallyView({ gameState, setPending, commitRally, onSub, onUndo, onRotate, canUndo, court, onOpenLineup, onFirstServe }: RallyViewProps) {
  const setNum = currentSetNumber(gameState);
  const stored = gameState.pending && gameState.pending.set === setNum ? gameState.pending : null;
  const rally: PendingRally | null = stored ?? (court.serving ? { ...freshRally(court.serving, setNum), id: `r-${setNum}-${gameState.events.length}` } : null);

  // Selection belongs to one step: a new step starts clean in the same render (no leftover highlight)
  const [pick, setPick] = useState<{ key: string; id: string | null }>({ key: '', id: null });
  const [showSubs, setShowSubs] = useState(false);
  const [quickFor, setQuickFor] = useState<string | null>(null);

  const serverSuggestion = rally?.step === 'our_serve' ? court.display[0] : null;
  const stepKey = rally ? `${rally.id}-${rally.step}-${rally.actions.length}-${rally.history.length}` : 'none';
  const selected = pick.key === stepKey ? pick.id : (serverSuggestion ?? null);
  const setSelected = (id: string | null) => setPick({ key: stepKey, id });

  const roleOf = (id: string) => gameState.players.find(p => p.id === id)?.role;
  const shortName = (id: string) => {
    const i = gameState.players.findIndex(p => p.id === id);
    return i >= 0 ? (gameState.players[i].name.trim() || playerLabel(gameState.players[i], i)) : '';
  };
  const nameOf = (id: string) => {
    const i = gameState.players.findIndex(p => p.id === id);
    return i >= 0 ? playerLabel(gameState.players[i], i) : '';
  };

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
    commitRally([...r.actions, ...extra, pointEvent], msg || (team === 'own' ? '+1 us' : '+1 them'));
  };

  const rateServe = (code: ScaleCode) => {
    if (!rally || !selected) return;
    const who = nameOf(selected);
    if (code === '#') return commitRally([...rally.actions, stat(rally, selected, 'serve', code, 'own')], `${who} ace · +1 us`);
    if (code === '=') return commitRally([...rally.actions, stat(rally, selected, 'serve', code, 'opponent')], `${who} serve error · +1 them`);
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
      return commitRally([...rally.actions, ...setEv, stat(rally, selected, 'attack', code, 'own')], `${who} kill${assist} · +1 us`);
    }
    if (code === 'err' || code === 'blk') return commitRally([...rally.actions, ...setEv, stat(rally, selected, 'attack', code, 'opponent')], `${who} ${codeText(code)} · +1 them`);
    advance(rally, code === 'rec' ? 'our_attack' : 'opp_attack', [...rally.actions, ...setEv, stat(rally, selected, 'attack', code, null)], t('{who} attack {c}', { who, c: codeText(code) }));
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
    step === 'our_attack' ? p.role !== 'libero' : false;

  const used = subsUsed(gameState.events, setNum);
  // Subs only between rallies
  const rallyRunning = !!(stored && (stored.history.length > 0 || stored.actions.length > 0));
  const legalFor = (outId: string) => legalSubsIn(gameState, setNum, outId, court.positions);
  const alerts = useMemo(() => computeAlerts(gameState, court.rotation).slice(0, 3), [gameState, court.rotation]);
  const board = useMemo(() => attackBoard(gameState, court.rotation, court.display), [gameState, court.rotation, court.display]);
  const own = rally ? rally.step !== 'opp_attack' : true;

  const crumbs = rally ? [rally.servingTeam === 'own' ? t('We serve') : t('They serve'), ...trailOf(rally)] : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[270px_minmax(0,1fr)_270px] xl:grid-cols-[minmax(280px,28%)_minmax(0,1fr)_minmax(300px,25%)]">
      {/* COURT */}
      <section className="flex flex-col gap-4 p-4 lg:p-5 border-b lg:border-b-0 lg:border-r border-line">
        <div className="flex items-center justify-between">
          <button onClick={onOpenLineup} className="font-display text-lg font-bold tracking-[0.08em] uppercase text-ink">
            {court.rotation ? `R${court.rotation}` : t('Lineup')}
          </button>
          <div className="flex gap-1.5">
            <button onClick={() => onRotate(-1)} aria-label="Rotate back" className="h-8 px-2 rounded-md border border-line text-mute font-display font-bold text-xs flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />−1</button>
            <button onClick={() => onRotate(1)} aria-label="Rotate forward" className="h-8 px-2 rounded-md border border-line text-mute font-display font-bold text-xs flex items-center gap-1"><RotateCw className="w-3.5 h-3.5" />+1</button>
          </div>
        </div>
        <div className="border-t-[3px] border-ink pt-3 space-y-3">
          {COURT_LAYOUT.map((row, r) => (
            <div key={r} className={`grid grid-cols-3 gap-2 ${r === 1 ? 'pt-3 border-t border-dashed border-line' : ''}`}>
              {row.map(pos => {
                const id = court.display[pos - 1];
                const i = gameState.players.findIndex(p => p.id === id);
                const p = i >= 0 ? gameState.players[i] : null;
                const ok = !!(p && rally && isEligible(rally.step, p));
                return (
                  <CourtSlot key={pos} pos={pos} player={p} label={p ? (p.name.trim() || playerLabel(p, i)) : '–'} selected={!!p && selected === p.id}
                    dimmed={!!rally && rally.step !== 'opp_attack' && !ok}
                    onTap={() => { if (!p) return; if (ok) setSelected(p.id); else setQuickFor(p.id); }}
                    onLong={() => p && setQuickFor(p.id)} />
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-mute font-display tracking-[0.08em] uppercase">{t("Hold a player for error or sub")}</p>
        <div className="mt-auto grid grid-cols-2 gap-2">
          <button onClick={onUndo} disabled={!canUndo} className="h-11 rounded-lg border border-line font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center justify-center gap-1.5 disabled:opacity-30"><Undo2 className="w-4 h-4" /> {t("Undo")}</button>
          <button onClick={() => setShowSubs(true)} disabled={rallyRunning} className={`disabled:opacity-30 h-11 rounded-lg border font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center justify-center gap-1.5 ${used >= gameState.subLimit ? 'border-bad text-bad' : 'border-line'}`}><ArrowLeftRight className="w-4 h-4" /> {t('Sub')} {used}/{gameState.subLimit}</button>
        </div>
      </section>

      {/* PHASE PANEL */}
      <section className={`flex flex-col p-4 lg:p-6 border-t-[3px] ${own ? 'border-t-primary' : 'border-t-secondary bg-[#1C1A24]'}`}>
        {!rally ? (
          <div className="flex-1 flex items-center justify-center">
            {court.hasLineup ? (
              <div className="grid grid-cols-2 gap-3 w-full max-w-xl">
                <button onClick={() => onFirstServe('own')} className="h-32 rounded-xl bg-primary text-[#0D0F12] font-display font-bold tracking-[0.12em] uppercase text-2xl">{t("We serve")}</button>
                <button onClick={() => onFirstServe('opponent')} className="h-32 rounded-xl bg-secondary text-[#0D0F12] font-display font-bold tracking-[0.12em] uppercase text-2xl">{t("They serve")}</button>
              </div>
            ) : (
              <button onClick={onOpenLineup} className="h-20 px-10 rounded-xl bg-primary text-[#0D0F12] font-display font-bold tracking-[0.12em] uppercase text-xl">{t('Set lineup for set {n}', { n: setNum })}</button>
            )}
          </div>
        ) : (
          <>
            <h2 className={`font-display text-3xl font-bold tracking-[0.06em] uppercase ${own ? 'text-primary' : 'text-secondary'}`}>{t(STEP_TITLE[rally.step])}</h2>
            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 font-display text-sm font-semibold tracking-[0.1em] uppercase text-mute">
              {crumbs.map((c, i) => <span key={i}>{i > 0 && <span className="mr-2 opacity-50">/</span>}{c}</span>)}
            </div>
            <div className="flex-1 flex flex-col justify-center py-6">
              {/* No exit animation: old buttons must never stay tappable after a step change */}
              <motion.div key={stepKey} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }}>
                  {rally.step === 'our_serve' && <Scale items={SERVE_SCALE} cols={3} disabled={!selected} onPick={rateServe} />}
                  {rally.step === 'opp_serve' && <>
                    <Picker rows={passSlots(court.display, roleOf)} selected={selected} onPick={setSelected} label={shortName} roleOf={roleOf} />
                    <Scale items={PASS_SCALE} cols={3} compact disabled={!selected} onPick={ratePass} />
                  </>}
                  {rally.step === 'our_attack' && <>
                    <Picker rows={attackSlots(court.display, roleOf)} selected={selected} onPick={setSelected} label={shortName} roleOf={roleOf} />
                    <Scale items={ATTACK_SCALE} cols={5} compact disabled={!selected} onPick={rateAttack} />
                  </>}
                  {rally.step === 'opp_attack' && <Scale items={OPP_ATTACK_SCALE} cols={5} disabled={false} onPick={rateOpp} />}
                  {rally.step === 'our_serve' && !selected && (
                    <p className="mt-3 text-center font-display text-xs font-semibold tracking-[0.12em] uppercase text-mute">{t("Tap the player on the court")}</p>
                  )}
              </motion.div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={theirFault} className="h-11 rounded-lg border border-line font-display font-bold tracking-[0.06em] uppercase text-sm px-1 leading-tight">{t("Their fault")}</button>
              <button onClick={ourFault} className="h-11 rounded-lg border border-line font-display font-bold tracking-[0.06em] uppercase text-sm px-1 leading-tight">{t("Our fault")}</button>
              <button onClick={replay} className="h-11 rounded-lg border border-line font-display font-bold tracking-[0.1em] uppercase text-sm flex items-center justify-center gap-1.5"><RotateCcw className="w-4 h-4" /> {t("Replay")}</button>
            </div>
          </>
        )}
      </section>

      {/* ALERTS + ATTACK BOARD */}
      <aside className="flex flex-col gap-5 p-4 lg:p-5 border-t lg:border-t-0 lg:border-l border-line lg:overflow-y-auto">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t("Alerts")}</span>
            <InfoDot light text={t('Max 3, most important first. Shown while true. No rate before {n} actions.', { n: N_MIN })} />
          </div>
          {alerts.length === 0 && <span className="text-sm text-mute">{t("Nothing right now.")}</span>}
          {alerts.map(a => (
            <div key={a.id} data-alert={a.id} className="flex gap-2 text-sm leading-snug">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.tone === 'bad' ? 'bg-bad' : 'bg-mute'}`} />
              <span>{a.text}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t("Attack")}</span>
            <InfoDot light text={t("Eff = (kills − errors − blocked) / attempts. Att = attempts. Now = current rotation.")} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_44px_28px_44px_28px] gap-x-1.5 items-baseline font-display text-[11px] font-bold tracking-[0.1em] text-mute">
            <span />
            <span className="col-span-2 text-center">{t("MATCH")}</span>
            <span className="col-span-2 text-center text-ink">{t('NOW')} {court.rotation ? `R${court.rotation}` : ''}</span>
            <span>{t("PLAYER")}</span><span className="text-right">{t("EFF")}</span><span className="text-right">{t("ATT")}</span><span className="text-right">{t("EFF")}</span><span className="text-right">{t("ATT")}</span>
          </div>
          {board.map(r => (
            <div key={r.playerId} data-board={r.name} data-oncourt={court.display.includes(r.playerId) ? '1' : '0'}
              className={`grid grid-cols-[minmax(0,1fr)_44px_28px_44px_28px] gap-x-1.5 items-baseline py-1.5 border-t border-line ${court.display.includes(r.playerId) ? '' : 'opacity-40'}`}>
              <span className="font-display text-sm xl:text-base font-bold uppercase truncate">{r.name} <span className="text-[11px] text-mute">{t(ROLE_SHORT[r.role as Player['role']])}</span></span>
              <EffCell line={r.match} />
              <span className="text-right font-display text-sm text-mute tabular-nums">{r.match.att}</span>
              <EffCell line={r.now} />
              <span className="text-right font-display text-sm text-mute tabular-nums">{r.now.att || '–'}</span>
            </div>
          ))}
        </div>
      </aside>

      <AnimatePresence>
        {showSubs && <SubSheet players={gameState.players} courtIds={court.positions} legalFor={legalFor} onClose={() => setShowSubs(false)} onSub={onSub} used={used} limit={gameState.subLimit} />}
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

export function freshRally(servingTeam: TeamSide, set: number): PendingRally {
  return { id: uid('r'), set, servingTeam, step: servingTeam === 'own' ? 'our_serve' : 'opp_serve', actions: [], trail: [], history: [] };
}

// ---------- Pieces ----------

// Player picker in the middle panel: one place to tap, laid out as they play
function Picker({ rows, selected, onPick, label, roleOf }: { rows: Slot[][]; selected: string | null; onPick: (id: string) => void; label: (id: string) => string; roleOf: (id: string) => Player['role'] | undefined }) {
  return (
    <div className="flex flex-col gap-2 mb-4">
      {rows.map((row, r) => (
        <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(3, row.length)}, minmax(0, 1fr))` }}>
          {row.map((slot, k) => slot.id ? (
            <button key={slot.id} data-pick={label(slot.id)} onClick={() => onPick(slot.id!)}
              className={`relative h-14 lg:h-16 rounded-lg flex flex-col items-center justify-center transition-all active:scale-95 ${
                selected === slot.id ? 'border-2 border-primary bg-primary/10 text-primary' : r > 0 && rows.length > 1 && !slot.label ? 'border border-line text-mute' : 'border border-line'}`}>
              {slot.label && <span className="absolute top-1 left-2 font-display text-[10px] font-bold tracking-[0.1em] text-mute uppercase">{t(slot.label)}</span>}
              <span className="font-display text-lg lg:text-xl font-bold uppercase leading-none truncate max-w-full px-2">{label(slot.id)}</span>
              <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-mute">{t(ROLE_SHORT[roleOf(slot.id) ?? 'outside'])}</span>
            </button>
          ) : <div key={`e${k}`} className="h-14 lg:h-16" />)}
        </div>
      ))}
    </div>
  );
}

// Efficiency: green from 30%, red below 0. Muted until N_MIN attempts.
function EffCell({ line }: { line: EffLine }) {
  if (line.eff === null) return <span className="text-right font-display text-base text-mute">–</span>;
  const tone = line.att < N_MIN ? 'text-mute' : line.eff >= 0.3 ? 'text-good' : line.eff < 0 ? 'text-bad' : 'text-ink';
  return <span className={`text-right font-display text-sm xl:text-base font-bold tabular-nums whitespace-nowrap ${tone}`}>{line.eff < 0 ? '−' : ''}{Math.abs(Math.round(line.eff * 100))}%</span>;
}

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
    <span className="relative inline-flex">
      {/* Small circle, but a ~28px invisible tap area around it */}
      <span role="button" tabIndex={0} aria-label="Info"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        onPointerDown={e => e.stopPropagation()}
        className="p-[7px] -m-[7px] cursor-pointer inline-flex">
        <span className={`w-[14px] h-[14px] rounded-full border flex items-center justify-center text-[10px] leading-none italic font-bold font-serif ${light ? 'border-white/45 text-white/75' : 'border-black/30 text-black/55'}`}>i</span>
      </span>
      {open && (
        <span onClick={e => { e.stopPropagation(); setOpen(false); }}
          className="absolute right-0 bottom-[calc(100%+8px)] z-20 w-52 rounded-lg bg-ink text-[#0B0C0E] px-3 py-2 text-[13px] font-bold leading-snug shadow-2xl normal-case tracking-normal text-left font-sans">{text}</span>
      )}
    </span>
  );
}

function Scale<C extends RatingCode>({ items, cols, disabled, onPick, compact }: { items: ScaleItem<C>[]; cols: 3 | 5; disabled: boolean; onPick: (c: C) => void; compact?: boolean }) {
  return (
    <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-5'}`}>
      {items.map(it => {
        const light = it.tone === 'poor' || it.tone === 'neu' || it.tone === 'top';
        return (
          <div key={it.code} className="relative">
            <button onClick={() => onPick(it.code)} disabled={disabled} data-code={it.code}
              className={`w-full ${compact ? (cols === 3 ? 'h-20 lg:h-24' : 'h-24 lg:h-28') : cols === 3 ? 'h-28 lg:h-32' : 'h-28 lg:h-36'} rounded-xl flex flex-col items-center justify-center gap-1.5 transition-transform active:scale-95 disabled:opacity-30 ${TONE_CLASS[it.tone]}`}>
              <span className={`font-display font-bold leading-[0.9] ${cols === 3 ? 'text-5xl' : 'text-[44px]'}`}>{it.sym}</span>
              <span className={`font-display font-bold uppercase text-center leading-tight px-1 ${cols === 3 ? 'text-[15px] tracking-[0.12em]' : 'text-[12px] lg:text-[13px] tracking-[0.02em]'}`}>{t(it.label)}</span>
            </button>
            <span className="absolute top-1.5 right-1.5 lg:top-2 lg:right-2"><InfoDot text={t(it.info)} light={light} /></span>
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
      className={`h-20 lg:h-24 rounded-lg flex flex-col items-center justify-center gap-0.5 px-1 transition-all select-none ${
        selected ? 'border-[1.5px] border-primary bg-primary/10' : libero ? 'border border-dashed border-mute' : 'border border-line'
      } ${dimmed ? 'opacity-35' : ''}`}>
      <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute">P{pos}</span>
      {/* Narrow court column (iPad landscape): smaller name, no jersey number */}
      <span className={`font-display text-lg lg:text-base xl:text-xl font-bold uppercase leading-none truncate max-w-full ${selected ? 'text-primary' : ''}`}>{label}</span>
      {player && <span className="font-display text-[11px] font-semibold tracking-[0.1em] text-mute whitespace-nowrap">{player.name.trim() && player.number.trim() ? <span className="lg:hidden xl:inline">#{player.number.trim()} · </span> : null}{t(ROLE_SHORT[player.role])}</span>}
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
  const sorted = [...bench.filter(x => x.p.role === player.role), ...bench.filter(x => x.p.role !== player.role)];
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
          className={`w-full h-16 rounded-xl font-display text-lg font-bold tracking-[0.12em] uppercase disabled:opacity-30 ${TONE_CLASS.poor}`}>{t("Unforced error")}</button>
        <span className="absolute top-1/2 -translate-y-1/2 right-3.5 flex"><InfoDot light text={t("Net touch, foot fault, double contact. +1 them. Pass and attacks so far stay recorded.")} /></span>
      </div>
      {player.role !== 'libero' && (
        <>
          <div className="flex justify-between items-center">
            <span className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t('Sub')} · {used}/{limit}{blocked ? ` · ${t('after the rally')}` : ''}</span>
            <InfoDot light text={t("Only legal subs are shown. Same role first (orange).")} />
          </div>
          {!blocked && used >= limit && <p className="text-sm text-bad">{t("Sub limit reached.")}</p>}
          {!blocked && used < limit && sorted.length === 0 && <p className="text-sm text-mute">{t("No legal sub.")}</p>}
          <div className="grid grid-cols-2 gap-2">
            {sorted.map(({ p, i }) => (
              <button key={p.id} onClick={() => onSub(p.id)} disabled={!subsOpen}
                className={`h-14 rounded-lg text-left px-3.5 flex flex-col justify-center disabled:opacity-30 ${p.role === player.role ? 'border-[1.5px] border-primary' : 'border border-line'}`}>
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

function SubSheet({ players, courtIds, legalFor, onClose, onSub, used, limit }: {
  players: Player[]; courtIds: (string | null)[]; legalFor: (outId: string) => string[]; onClose: () => void; onSub: (inId: string, outId: string) => void; used: number; limit: number;
}) {
  const [outId, setOutId] = useState<string | null>(null);
  const indexed = players.map((p, i) => ({ p, i })).filter(x => x.p.role !== 'libero');
  const court = courtIds.map((id, k) => ({ id, pos: k + 1 })).filter(x => x.id).map(x => ({ ...indexed.find(y => y.p.id === x.id)!, pos: x.pos })).filter(x => x.p);
  const legal = outId ? legalFor(outId) : [];
  const bench = indexed.filter(x => legal.includes(x.p.id));
  const outRole = players.find(p => p.id === outId)?.role;
  const btn = (p: Player, i: number, active: boolean, onClick: () => void, disabled = false, hint = false) => (
    <button key={p.id} onClick={onClick} disabled={disabled}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all disabled:opacity-30 ${active ? 'border-[1.5px] border-primary bg-primary/10' : hint ? 'border-[1.5px] border-primary' : 'border border-line'}`}>
      <span className="block font-display font-bold uppercase text-base truncate">{p.name.trim() || playerLabel(p, i)}</span>
      <span className="block font-display text-[11px] font-semibold tracking-[0.1em] text-mute">{t(ROLE_LABEL[p.role])}</span>
    </button>
  );
  return (
    <Sheet onClose={onClose}>
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-display text-2xl font-bold uppercase tracking-[0.04em]">{t("Sub")}</h3>
          <p className="font-display text-xs font-semibold tracking-[0.12em] uppercase text-mute">{used}/{limit}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-lg border border-line flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t("Out")}</div>
          {court.map(({ p, i, pos }) => (
            <div key={p.id} className="relative">
              {btn(p, i, outId === p.id, () => setOutId(outId === p.id ? null : p.id), legalFor(p.id).length === 0)}
              <span className="absolute top-2 right-2 font-display text-[11px] text-mute">P{pos}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="font-display text-xs font-bold tracking-[0.14em] uppercase text-mute">{t("In")}</div>
          {outId && bench.length === 0 && <div className="text-sm text-mute">{t("No legal sub")}</div>}
          {bench.map(({ p, i }) => btn(p, i, false, () => { if (outId) { onSub(p.id, outId); setOutId(null); onClose(); } }, used >= limit, !!outRole && p.role === outRole))}
        </div>
      </div>
    </Sheet>
  );
}
