// Stage 5: teams and finished matches, saved on this device (localStorage)
import { GameState, Player } from './types';

export interface Team { id: string; name: string; players: Player[]; subLimit: number }
export interface SavedMatch { id: string; teamId: string | null; teamName: string; savedAt: number; state: GameState }

const TEAMS_KEY = 'indoorstats_teams';
const MATCHES_KEY = 'indoorstats_matches';
const CURRENT_TEAM_KEY = 'indoorstats_team';

const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};
// Returns false when the browser storage is full
const write = (key: string, value: unknown): boolean => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const loadTeams = (): Team[] => read<Team[]>(TEAMS_KEY, []);
export const saveTeams = (teams: Team[]) => write(TEAMS_KEY, teams);
export const loadCurrentTeamId = (): string | null => read<string | null>(CURRENT_TEAM_KEY, null);
export const saveCurrentTeamId = (id: string) => write(CURRENT_TEAM_KEY, id);

export const loadMatches = (): SavedMatch[] => read<SavedMatch[]>(MATCHES_KEY, []);
export const saveMatches = (m: SavedMatch[]) => write(MATCHES_KEY, m);

// A match is worth keeping once something was recorded
export const hasData = (s: GameState) => s.events.some(e => e.kind === 'stat' || e.kind === 'point');
