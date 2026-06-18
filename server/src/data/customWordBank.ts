import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { WordEntry } from './words.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 从 src/data/ 向上两层得到 server/，再进 data/
const DATA_DIR = path.resolve(__dirname, '../../data')
const CUSTOM_WORDS_FILE = path.join(DATA_DIR, 'custom-words.json')

export interface CustomWordEntry {
  word: string
  category: string
  drawability: number
  addedAt: number
  synonyms?: string[]
}

let cachedEntries: CustomWordEntry[] | null = null

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadRaw(): CustomWordEntry[] {
  try {
    ensureDataDir()
    if (!fs.existsSync(CUSTOM_WORDS_FILE)) {
      fs.writeFileSync(CUSTOM_WORDS_FILE, '[]', 'utf-8')
      return []
    }
    const raw = fs.readFileSync(CUSTOM_WORDS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as CustomWordEntry[]
  } catch (err) {
    console.warn('[CustomWordBank] Failed to load custom words:', (err as Error).message)
    return []
  }
}

function saveRaw(entries: CustomWordEntry[]): void {
  try {
    ensureDataDir()
    fs.writeFileSync(CUSTOM_WORDS_FILE, JSON.stringify(entries, null, 2), 'utf-8')
    cachedEntries = entries
  } catch (err) {
    console.error('[CustomWordBank] Failed to save custom words:', (err as Error).message)
    throw err
  }
}

export function loadCustomWords(): CustomWordEntry[] {
  if (cachedEntries) return cachedEntries
  cachedEntries = loadRaw()
  return cachedEntries
}

export function getAllCustomWordEntries(): CustomWordEntry[] {
  return loadCustomWords()
}

export function getCustomWordEntries(): WordEntry[] {
  return loadCustomWords().map(e => ({
    word: e.word,
    drawability: e.drawability as WordEntry['drawability'],
    synonyms: e.synonyms,
  }))
}

export function addCustomWord(
  word: string,
  category: string,
  synonyms?: string[],
): { added: boolean; reason?: string } {
  const entries = loadCustomWords()

  const exists = entries.some(e => e.word === word)
  if (exists) return { added: false, reason: `"${word}" 已被其他用户贡献过` }

  entries.push({
    word,
    category,
    drawability: 3,
    addedAt: Date.now(),
    synonyms: synonyms && synonyms.length > 0 ? synonyms : undefined,
  })

  saveRaw(entries)
  return { added: true }
}

export function getCustomWordSet(): Set<string> {
  return new Set(loadCustomWords().map(e => e.word))
}

export function removeCustomWord(word: string): boolean {
  const entries = loadCustomWords()
  const index = entries.findIndex(e => e.word === word)
  if (index === -1) return false
  entries.splice(index, 1)
  saveRaw(entries)
  return true
}

export function updateCustomWord(
  word: string,
  updates: { category?: string; synonyms?: string[] }
): { updated: boolean; reason?: string } {
  const entries = loadCustomWords()
  const entry = entries.find(e => e.word === word)
  if (!entry) return { updated: false, reason: `未找到词语"${word}"` }
  if (updates.category !== undefined) {
    entry.category = updates.category
  }
  if (updates.synonyms !== undefined) {
    entry.synonyms = updates.synonyms.length > 0 ? updates.synonyms : undefined
  }
  saveRaw(entries)
  return { updated: true }
}

export function removeCustomWords(words: string[]): string[] {
  const entries = loadCustomWords()
  const removed: string[] = []
  const remaining: CustomWordEntry[] = []
  for (const e of entries) {
    if (words.includes(e.word)) {
      removed.push(e.word)
    } else {
      remaining.push(e)
    }
  }
  if (removed.length > 0) saveRaw(remaining)
  return removed
}
