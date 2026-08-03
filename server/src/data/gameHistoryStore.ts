import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import type { GameType } from '@draw-and-guess/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.resolve(__dirname, '../../data')
const GAME_HISTORY_FILE = path.join(DATA_DIR, 'game-history.json')

export interface GameHistoryPlayer {
  playerId: string
  nickname: string
  score: number
  isOwner: boolean
}

export interface GameHistoryEntry {
  id: string
  roomName: string
  gameType: GameType
  startTime: number
  endTime: number
  totalRounds: number
  players: GameHistoryPlayer[]
  winner: string
}

const MAX_ENTRIES = 500

let cachedEntries: GameHistoryEntry[] | null = null

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadRaw(): GameHistoryEntry[] {
  try {
    ensureDataDir()
    if (!fs.existsSync(GAME_HISTORY_FILE)) {
      fs.writeFileSync(GAME_HISTORY_FILE, '[]', 'utf-8')
      return []
    }
    const raw = fs.readFileSync(GAME_HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as GameHistoryEntry[]
  } catch (err) {
    console.warn('[GameHistoryStore] Failed to load history:', (err as Error).message)
    return []
  }
}

function saveRaw(entries: GameHistoryEntry[]): void {
  try {
    ensureDataDir()
    fs.writeFileSync(GAME_HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf-8')
    cachedEntries = entries
  } catch (err) {
    console.error('[GameHistoryStore] Failed to save history:', (err as Error).message)
  }
}

function loadHistory(): GameHistoryEntry[] {
  if (cachedEntries) return cachedEntries
  cachedEntries = loadRaw()
  return cachedEntries
}

export function getAllGameHistory(): GameHistoryEntry[] {
  return loadHistory()
}

export function addGameHistory(entry: Omit<GameHistoryEntry, 'id'>): void {
  const entries = loadHistory()
  entries.push({ id: randomUUID(), ...entry })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  saveRaw(entries)
}
