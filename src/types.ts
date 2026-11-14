export type TeamSide = 'own' | 'opponent';
export type Role = 'hitter' | 'setter' | 'libero';
export type Skill = 'serve' | 'attack' | 'pass';
export type Grade = 'minus' | 'zero' | 'plus'; // shown as − / 0 / #

export interface Player {
  id: string;
  name: string;
  number: string;
  role: Role;
  onCourt: boolean;
  slot?: number; // stable placeholder number for unnamed players
}

export interface StatEvent {
  kind: 'stat';
  id: string;
  rallyId?: string;
  set: number;
  playerId: string;
  skill: Skill;
  grade: Grade;
  point: TeamSide | null; // auto-awarded point, if any
  timestamp: number;
}

export type PointReason = 'opp_attack_point' | 'opp_ace' | 'opp_attack_error' | 'opp_serve_error' | 'other';

export interface PointEvent {
  kind: 'point';
  id: string;
  rallyId?: string;
  set: number;
  team: TeamSide;
  reason?: PointReason;
  timestamp: number;
}

export const POINT_REASONS: { reason: Exclude<PointReason, 'other'>; team: TeamSide; label: string }[] = [
  { reason: 'opp_attack_point', team: 'opponent', label: 'Attack point opponent' },
  { reason: 'opp_ace', team: 'opponent', label: 'Ace opponent' },
  { reason: 'opp_attack_error', team: 'own', label: 'Attack mistake opponent' },
  { reason: 'opp_serve_error', team: 'own', label: 'Service mistake opponent' },
];

export interface SubEvent {
  kind: 'sub';
  id: string;
  rallyId?: string;
  set: number;
  inId: string;
  outId: string;
  counts: boolean; // libero swaps don't count toward the sub limit
  timestamp: number;
}

export type MatchEvent = StatEvent | PointEvent | SubEvent;

export type RallyStep = 'our_serve' | 'opp_serve' | 'our_attack' | 'opp_attack';

export interface PendingRally {
  id: string;
  set: number;
  servingTeam: TeamSide;
  step: RallyStep;
  actions: StatEvent[]; // not yet committed (e.g. a pass before the attack)
  history: { step: RallyStep; actionCount: number }[];
}

export type TrackMode = 'rally' | 'quick';

export interface GameState {
  players: Player[];
  events: MatchEvent[];
  setHistory: { own: number; opponent: number }[];
  sets: { own: number; opponent: number };
  matchDate: string;
  opponentName: string;
  autoScore: boolean;
  subLimit: number;
  mode: TrackMode;
  pending: PendingRally | null;
}

export const SKILLS_BY_ROLE: Record<Role, Skill[]> = {
  hitter: ['serve', 'attack', 'pass'],
  setter: ['serve'],
  libero: ['pass'],
};

export const SKILL_LABEL: Record<Skill, string> = { serve: 'Serve', attack: 'Attack', pass: 'Pass' };
export const SKILL_SHORT: Record<Skill, string> = { serve: 'SRV', attack: 'ATK', pass: 'PAS' };
export const GRADE_LABEL: Record<Grade, string> = { minus: '−', zero: '0', plus: '#' };
export const ROLE_LABEL: Record<Role, string> = { hitter: 'Hitter', setter: 'Setter', libero: 'Libero' };
