// === Player ===
export interface Player {
  id: string;
  nickname: string;
  sessionId: string;
  isOwner: boolean;
  score: number;
  hasGuessedCorrectly: boolean;
  isGuessOnly?: boolean;
  isSpectator?: boolean;
  avatar: number;
  joinedAt: number;
  lastActiveAt: number;
}

// === Game Type ===
export type GameType = 'draw' | 'spy';

// === Room ===
export type RoomState = 'lobby' | 'playing' | 'gameover';

export type WordCategory =
  | 'animals'
  | 'food'
  | 'daily'
  | 'nature'
  | 'vehicles'
  | 'sports'
  | 'celebrities'
  | 'professions'
  | 'instruments'
  | 'tools'
  | 'furniture'
  | 'treasures'
  | 'clothing'
  | 'buildings'
  | 'appliances'
  | 'tableware'
  | 'plants'
  | 'astronomy'
  | 'mythology'
  | 'body'
  | 'games'
  | 'festivals';

export interface Room {
  id: string;
  code: string;
  name: string;
  password: string;
  state: RoomState;
  maxPlayers: number;
  players: Player[];
  currentWord: string | null;
  currentWordCategory?: string;
  currentRound: number;
  totalRounds: number;
  roundStartTime: number | null;
  roundDuration: number;
  roundsPerPlayer: number;
  gameType: GameType;
  lastActivityAt: number;
  gameStartTime: number | null;
}

// === Drawing ===
export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  playerId: string;
  points: Point[];
  color: string;
  width: number;
  tool: 'brush' | 'eraser';
  strokeSeq?: number;
}

// === Chat ===
export interface ChatMessage {
  id: string;
  playerId: string | null;
  nickname: string | null;
  text: string;
  isSystem: boolean;
  isWrongGuess?: boolean;
  timestamp: number;
}

// === Game ===
export interface PlayerScore {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
  isGuessOnly?: boolean;
  likes?: number;
}

// === Error ===
export enum ErrorCode {
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  ROOM_PASSWORD_REQUIRED = 'ROOM_PASSWORD_REQUIRED',
  ROOM_PASSWORD_WRONG = 'ROOM_PASSWORD_WRONG',
  NICKNAME_TAKEN = 'NICKNAME_TAKEN',
  NOT_ROOM_OWNER = 'NOT_ROOM_OWNER',
  GAME_NOT_IN_LOBBY = 'GAME_NOT_IN_LOBBY',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_WORD_CONFIG = 'INVALID_WORD_CONFIG',
}

export interface RoomErrorPayload {
  code: ErrorCode;
  message: string;
}

// === Spy Game ===
export type SpyPhase =
  | 'idle'
  | 'word_distribution'
  | 'describing'
  | 'discussion'
  | 'voting'
  | 'reveal'
  | 'round_end'
  | 'game_over'
  | 'tie_break';

export type SpyRole = 'civilian' | 'spy' | 'blank';

export interface SpyPlayer {
  id: string;
  nickname: string;
  isOwner: boolean;
  isAlive: boolean;
  isSpy: boolean;
  role: SpyRole;
  word: string;
  description: string;
  voteTarget: string | null;
  voteCount: number;
  score: number;
  sessionId: string;
  avatar: number;
}

export interface SpyGameConfig {
  totalRounds: number;
  descriptionTime: number;
  voteTime: number;
  blankCount: number;
}

export interface SpyDescription {
  playerId: string;
  nickname: string;
  text: string;
  round: number;
  timestamp: number;
}

export interface SpyVoteResult {
  round: number;
  votes: Array<{ voterId: string; targetId: string | null }>;
  eliminated: string | null;
  civilianWord?: string;
  spyWord?: string;
  isTie?: boolean;
  tiePlayers?: string[];
  tieBreakCount?: number;
}

export interface SpyGameState {
  phase: SpyPhase;
  round: number;
  totalRounds: number;
  currentSpeakerIndex: number;
  players: SpyPlayer[];
  civilianWord: string;
  spyWord: string;
  descriptionTimeLeft: number;
  voteTimeLeft: number;
  totalTime?: number;
  winner: 'civilian' | 'spy' | 'blank' | null;
  describeCycle?: number;
  phaseStartTime?: number;
  tieBreakCount?: number;
  tieBreakPlayers?: string[];
}
