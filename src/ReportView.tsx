import { useState } from 'react';
import { BarChart3, Download, RotateCcw } from 'lucide-react';
import { GameState, Skill, REPORT_SKILLS_BY_ROLE, SKILL_LABEL, ROLE_LABEL } from './types';
import { calculateStats, formatMatchDate, formatValue, playerLabel, scoreForSet, valueTone, SkillLine, currentSetNumber, rotationTable, statsByPosition } from './utils';

const pctOf = (a: number, b: number) => (b === 0 ? '–' : `${Math.round((a / b) * 100)}%`);

interface ReportViewProps {
  gameState: GameState;
  onExport: () => void;
  onReset: () => void;
}

function SkillBlock({ skill, line }: { skill: Skill; line: SkillLine }) {
  return (
    <div className="bg-white/5 rounded-xl p-2.5">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">{SKILL_LABEL[skill]}</span>
        <span className={`text-base font-black italic ${valueTone(skill, line.value)}`}>{formatValue(skill, line.value)}</span>
      </div>
      <div className={`grid gap-1 text-center ${skill === 'attack' ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {(skill === 'attack'
          ? [['−', line.minus, 'text-danger'], ['↺', line.recycle, 'text-accent'], ['0', line.zero - line.recycle, 'text-white/70'], ['#', line.plus, 'text-success']]
          : [['−', line.minus, 'text-danger'], ['0', line.zero, 'text-white/70'], ['#', line.plus, 'text-success']] as [string, number, string][]).map(([sym, n, tone]) => (
          <div key={sym} className="bg-black/20 rounded-md py-1">
            <div className={`text-[10px] font-black leading-none ${tone}`}>{sym}</div>
            <div className="text-sm font-mono font-bold leading-tight mt-0.5">{n}</div>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-white/30 text-center mt-1">{line.total} {skill === 'set' ? 'attempts' : 'total'}</div>
    </div>
  );
}

export default function ReportView({ gameState, onExport, onReset }: ReportViewProps) {
  const [setFilter, setSetFilter] = useState<number | null>(null);
  const setNum = currentSetNumber(gameState);
  const liveScore = scoreForSet(gameState.events, setNum);
  const setsWithData = Array.from(new Set(gameState.events.map(e => e.set))).sort((a, b) => a - b);
  const stats = calculateStats(gameState, setFilter);
  const rotations = rotationTable(gameState, setFilter);

  const rows = stats.players
    .map((ps, idx) => ({ ...ps, idx: gameState.players.findIndex(p => p.id === ps.player.id) }))
    .filter(ps => ps.serve.total + ps.attack.total + ps.pass.total + ps.set.total > 0);
  const quiet = stats.players.filter(ps => ps.serve.total + ps.attack.total + ps.pass.total + ps.set.total === 0);

  return (
    <div className="p-4 sm:p-8 overflow-y-auto max-w-3xl mx-auto space-y-6 pb-32">
      <div>
        <h2 className="text-3xl sm:text-4xl font-black italic uppercase tracking-tighter">Match Report</h2>
        <p className="text-xs text-primary font-mono tracking-widest mt-1 uppercase">
          {formatMatchDate(gameState.matchDate)}{gameState.opponentName ? ` · vs ${gameState.opponentName}` : ''}
        </p>
      </div>

      {/* Score */}
      <div className="bg-surface border border-white/10 rounded-2xl p-6 text-center">
        <div className="text-[10px] uppercase tracking-widest opacity-40 mb-2">Sets</div>
        <div className="text-5xl font-black italic tracking-tighter text-primary">
          {gameState.sets.own} <span className="text-white/20">-</span> {gameState.sets.opponent}
        </div>
        {gameState.setHistory.length > 0 && (
          <div className="flex justify-center flex-wrap gap-2 mt-3">
            {gameState.setHistory.map((s, i) => (
              <span key={i} className="text-xs font-mono bg-white/5 px-3 py-1 rounded-lg">{s.own}:{s.opponent}</span>
            ))}
          </div>
        )}
        {(liveScore.own > 0 || liveScore.opponent > 0) && (
          <div className="text-xs font-mono opacity-40 mt-2">Current set: {liveScore.own}-{liveScore.opponent}</div>
        )}
      </div>

      {/* Set filter */}
      {setsWithData.length > 0 && (
        <div className="flex gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10 overflow-x-auto">
          {[null, ...setsWithData].map(s => (
            <button key={s ?? 'all'} onClick={() => setSetFilter(s)}
              className={`flex-1 min-w-14 py-2 rounded-lg font-bold uppercase text-[11px] tracking-wider transition-all ${setFilter === s ? 'bg-primary text-black' : 'text-white/40'}`}>
              {s === null ? 'Match' : `Set ${s}`}
            </button>
          ))}
        </div>
      )}

      {/* Team */}
      <div className="bg-surface border border-white/10 rounded-2xl p-4 space-y-3">
        <span className="text-[10px] uppercase font-bold tracking-widest text-primary">Team</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['serve', 'attack', 'pass', 'set'] as Skill[]).map(s => <SkillBlock key={s} skill={s} line={stats.team[s]} />)}
        </div>
        <p className="text-[10px] text-white/30">Serve, attack, pass: efficiency (# − −) / total. Recycles (↺) count as attack attempts. Assist: kills set / attack attempts set (− 0 # = how those attacks ended).</p>
      </div>

      {/* Rotations */}
      <div className="bg-surface border border-white/10 rounded-2xl p-4 space-y-3">
        <span className="text-[10px] uppercase font-bold tracking-widest text-primary">By rotation</span>
        <table className="w-full text-center text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-white/40">
              <th className="text-left font-bold py-1">Rot</th>
              <th className="font-bold">Won</th>
              <th className="font-bold">Lost</th>
              <th className="font-bold">+/−</th>
              <th className="font-bold">Side-out</th>
              <th className="font-bold">Break</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rotations.map(r => {
              const diff = r.won - r.lost;
              const played = r.won + r.lost > 0;
              return (
                <tr key={r.rotation} className={`border-t border-white/5 ${played ? '' : 'opacity-30'}`}>
                  <td className="text-left font-black py-1.5 font-sans">R{r.rotation}</td>
                  <td className="text-success">{r.won}</td>
                  <td className="text-danger">{r.lost}</td>
                  <td className={diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : ''}>{diff > 0 ? `+${diff}` : diff}</td>
                  <td>{pctOf(r.soWon, r.soTotal)} <span className="text-white/30 text-[9px]">{r.soWon}/{r.soTotal}</span></td>
                  <td>{pctOf(r.bpWon, r.bpTotal)} <span className="text-white/30 text-[9px]">{r.bpWon}/{r.bpTotal}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[10px] text-white/30">Rotation = setter's position (R1 = setter in P1). Side-out: points won when they serve. Break: points won when we serve.</p>
      </div>

      {/* Opponent */}
      <div className="bg-surface border border-white/10 rounded-2xl p-4 space-y-3">
        <span className="text-[10px] uppercase font-bold tracking-widest text-secondary">Opponent</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            ['Attack points', stats.opponent.opp_attack_point, 'text-secondary'],
            ['Aces', stats.opponent.opp_ace, 'text-secondary'],
            ['Attack mistakes', stats.opponent.opp_attack_error, 'text-primary'],
            ['Service mistakes', stats.opponent.opp_serve_error, 'text-primary'],
          ].map(([label, n, tone]) => (
            <div key={label as string} className="bg-white/5 rounded-xl p-2.5">
              <div className={`text-xl font-black italic ${tone}`}>{n as number}</div>
              <div className="text-[9px] uppercase tracking-wider text-white/40">{label as string}</div>
            </div>
          ))}
        </div>
        {(stats.opponent.other_us + stats.opponent.other_them) > 0 && (
          <p className="text-[10px] text-white/30">Other points: {stats.opponent.other_us} us, {stats.opponent.other_them} them.</p>
        )}
      </div>

      {/* Players */}
      <div className="bg-surface border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex justify-between items-center">
          <h3 className="font-black italic uppercase tracking-tight text-lg">Player Stats</h3>
          <BarChart3 className="text-primary w-5 h-5" />
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/30">No stats tracked{setFilter ? ` in set ${setFilter}` : ''} yet.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {rows.map(ps => {
              const skills = REPORT_SKILLS_BY_ROLE[ps.player.role];
              return (
                <div key={ps.player.id} className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-black italic uppercase text-base">{playerLabel(ps.player, ps.idx)}</span>
                    <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-white/10 text-white/60">{ROLE_LABEL[ps.player.role]}</span>
                  </div>
                  <div className={`grid gap-2 ${skills.length === 3 ? 'grid-cols-3' : 'grid-cols-1 max-w-[12rem]'}`}>
                    {skills.map(s => <SkillBlock key={s} skill={s} line={ps[s]} />)}
                  </div>
                  <ByPosition gameState={gameState} playerId={ps.player.id} skills={skills.filter(s => s !== 'set')} setFilter={setFilter} />
                </div>
              );
            })}
          </div>
        )}
        {quiet.length > 0 && rows.length > 0 && (
          <div className="px-4 py-3 border-t border-white/5 text-[10px] text-white/30 uppercase tracking-wider">
            No stats: {quiet.map(ps => playerLabel(ps.player, gameState.players.findIndex(p => p.id === ps.player.id))).join(', ')}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={onExport}
          className="flex-1 py-4 bg-primary text-black font-black uppercase text-xs tracking-widest rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all">
          <Download className="w-4 h-4" /> Email Stats
        </button>
        <button onClick={onReset}
          className="py-4 px-6 bg-danger/20 text-danger border border-danger/30 font-bold uppercase text-xs tracking-widest rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all">
          <RotateCcw className="w-4 h-4" /> New Match
        </button>
      </div>
    </div>
  );
}

function ByPosition({ gameState, playerId, skills, setFilter }: { gameState: GameState; playerId: string; skills: Skill[]; setFilter: number | null }) {
  const byPos = statsByPosition(gameState, playerId, setFilter);
  const positions = [1, 2, 3, 4, 5, 6].filter(p => byPos[p] && skills.some(s => byPos[p][s].total > 0));
  if (positions.length === 0) return null;
  return (
    <details className="group">
      <summary className="text-[10px] font-bold uppercase tracking-widest text-white/40 cursor-pointer select-none py-1">By position ▾</summary>
      <table className="w-full text-center text-xs mt-1">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-white/40">
            <th className="text-left font-bold py-1">Pos</th>
            {skills.map(s => <th key={s} className="font-bold">{SKILL_LABEL[s]}</th>)}
          </tr>
        </thead>
        <tbody className="font-mono">
          {positions.map(p => (
            <tr key={p} className="border-t border-white/5">
              <td className="text-left font-black py-1 font-sans">P{p}</td>
              {skills.map(s => {
                const line = byPos[p][s];
                return (
                  <td key={s} className={valueTone(s, line.value)}>
                    {line.total ? <>{formatValue(s, line.value)} <span className="text-white/30 text-[9px]">({line.total})</span></> : <span className="text-white/20">–</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
