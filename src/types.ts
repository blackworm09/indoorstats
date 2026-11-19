export type TeamSide = 'own' | 'opponent';
export type Role = 'outside' | 'middle' | 'opposite' | 'setter' | 'libero';
export type Skill = 'serve' | 'attack' | 'pass' | 'set'; // 'set' = setter credit on a teammate's attack
export type Grade = 'minus' | 'zero' | 'plus'; // shown as − / 0 / #

export interface Player {
  id: string;
  name: string;
  number: string;
  role: Role;
  onCourt?: boolean; // legacy (pre-rotation saves); court now comes from the set lineup
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
  code?: RatingCode; // v2 fine rating (grade is derived from it for older reports)
  recycle?: boolean; // attack kept in play on our side (counts as a 0 attempt)
  pos?: number; // player's court position (1-6) when the stat happened
  rot?: number; // team rotation (setter's position) when the stat happened
  point: TeamSide | null; // auto-awarded point, if any
  timestamp: number;
}

// v2 rating codes. Pass/serve (DataVolley): = error, / overpass, - negative, ! ok, + positive, # perfect/ace.
// Attack: err error, blk blocked (counts as error), play in play, rec recycle, kill.
export type ScaleCode = '=' | '/' | '-' | '!' | '+' | '#';
export type AttackCode = 'err' | 'blk' | 'play' | 'rec' | 'kill';
export type RatingCode = ScaleCode | AttackCode;

export type PointReason = 'opp_attack_point' | 'opp_ace' | 'opp_attack_error' | 'opp_serve_error' | 'opp_blocked' | 'own_error' | 'other';

export interface PointEvent {
  kind: 'point';
  id: string;
  rallyId?: string;
  set: number;
  team: TeamSide;
  reason?: PointReason;
  playerId?: string; // own_error: who made the unforced error
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

// Manual rotation correction (+1 = one step clockwise, like a side-out)
export interface RotateEvent {
  kind: 'rotate';
  id: string;
  rallyId?: string;
  set: number;
  delta: number;
  timestamp: number;
}

export interface TimeoutEvent {
  kind: 'timeout';
  id: string;
  rallyId?: string;
  set: number;
  team: TeamSide;
  timestamp: number;
}

export const TIMEOUTS_PER_SET = 2;

export type MatchEvent = StatEvent | PointEvent | SubEvent | RotateEvent | TimeoutEvent;

// Starting lineup for one set. positions[0] = P1 ... positions[5] = P6
export interface SetLineup {
  positions: (string | null)[];
  liberoId: string | null;        // receive libero (or the only libero)
  libero2Id?: string | null;      // defence libero: comes in when we serve. Unset = one libero all set
  liberoReplaces: string[];
  firstServe: TeamSide | null;
}

export type RallyStep = 'our_serve' | 'opp_serve' | 'our_attack' | 'opp_attack';

export interface PendingRally {
  id: string;
  set: number;
  servingTeam: TeamSide;
  step: RallyStep;
  actions: StatEvent[]; // not yet committed (e.g. a pass before the attack)
  trail?: string[]; // breadcrumb, incl. opponent actions
  lastAt?: number; // time of the last step (Undo order vs timeouts/subs)
  history: { step: RallyStep; actionCount: number; trailCount?: number }[];
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
  mode?: TrackMode; // legacy
  pending: PendingRally | null;
  lineups: Record<number, SetLineup>;
  templateLineup?: SetLineup | null; // last used lineup, prefilled for the next set/match
  teamId?: string;
}

// Buttons in quick-tap mode
export const SKILLS_BY_ROLE: Record<Role, Skill[]> = {
  outside: ['serve', 'attack', 'pass'],
  middle: ['serve', 'attack', 'pass'],
  opposite: ['serve', 'attack', 'pass'],
  setter: ['serve', 'attack'],
  libero: ['pass'],
};

// What the report shows per role (assists are recorded automatically)
export const REPORT_SKILLS_BY_ROLE: Record<Role, Skill[]> = {
  outside: ['serve', 'attack', 'pass'],
  middle: ['serve', 'attack', 'pass'],
  opposite: ['serve', 'attack', 'pass'],
  setter: ['serve', 'attack', 'set'],
  libero: ['pass'],
};

export const SKILL_LABEL: Record<Skill, string> = { serve: 'Serve', attack: 'Attack', pass: 'Pass', set: 'Assist' };
export const SKILL_SHORT: Record<Skill, string> = { serve: 'SRV', attack: 'ATK', pass: 'PAS', set: 'SET' };
export const GRADE_LABEL: Record<Grade, string> = { minus: '−', zero: '0', plus: '#' };
export const ROLE_LABEL: Record<Role, string> = { outside: 'Outside', middle: 'Middle', opposite: 'Opposite', setter: 'Setter', libero: 'Libero' };
export const ROLE_SHORT: Record<Role, string> = { outside: 'OH', middle: 'MB', opposite: 'OPP', setter: 'S', libero: 'L' };
export const ROLES: Role[] = ['outside', 'middle', 'opposite', 'setter', 'libero'];

// Court layout as seen from behind our baseline: front row P4 P3 P2, back row P5 P6 P1
export const COURT_LAYOUT: number[][] = [[4, 3, 2], [5, 6, 1]];
