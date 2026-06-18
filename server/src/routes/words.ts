import { Router, type Request, type Response } from 'express'
import { validateGlobalWord } from '../data/wordValidator.js'
import { addCustomWord, loadCustomWords, removeCustomWord, removeCustomWords, updateCustomWord } from '../data/customWordBank.js'
import { invalidateIndex } from '../data/wordIndex.js'
import { WORDS } from '../data/words.js'
import { requireAdminToken } from '../middleware/auth.js'

export const wordsRouter: Router = Router()

const systemWordCount = new Set(Object.values(WORDS).flatMap(cat => cat.map(e => e.word))).size

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX = 5

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(ip) ?? []
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
  if (recent.length >= RATE_LIMIT_MAX) return false
  recent.push(now)
  rateLimitMap.set(ip, recent)
  return true
}

interface WordSubmitBody {
  words: string[]
  category: string
  synonyms?: Record<string, string[]>
}

wordsRouter.get('/', (_req: Request, res: Response) => {
  const entries = loadCustomWords()
  const items = entries.map(e => ({
    word: e.word,
    category: e.category,
    addedAt: e.addedAt,
    synonyms: e.synonyms,
  }))
  items.reverse()
  res.json({ words: items, total: items.length, systemTotal: systemWordCount })
})

wordsRouter.post('/', (req: Request, res: Response) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(ip)) {
    res.status(429).json({ success: false, message: '提交太频繁，请稍后再试' })
    return
  }

  const { words, category, synonyms } = req.body as WordSubmitBody

  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ success: false, message: '请至少输入一个词语' })
    return
  }

  if (words.length > 20) {
    res.status(400).json({ success: false, message: '单次最多提交20个词语' })
    return
  }

  const normalizedCategory = category?.trim()
  if (!normalizedCategory) {
    res.status(400).json({ success: false, message: '请填写分类' })
    return
  }

  interface FailEntry { word: string; reason: string }
  const failedWords: FailEntry[] = []
  const addedWords: string[] = []

  for (const rawWord of words) {
    const word = rawWord.trim()
    if (!word) continue

    const validation = validateGlobalWord(word, normalizedCategory)
    if (!validation.valid) {
      failedWords.push({ word, reason: validation.error! })
      continue
    }

    const wordSynonyms = synonyms?.[word]
    const result = addCustomWord(word, normalizedCategory, wordSynonyms)
    if (result.added) {
      addedWords.push(word)
    } else {
      failedWords.push({ word, reason: result.reason ?? '未知错误' })
    }
  }

  if (addedWords.length > 0) {
    invalidateIndex()
  }

  if (addedWords.length === 0) {
    const details = failedWords.map(f => `${f.word}（${f.reason}）`).join('；')
    res.status(400).json({ success: false, message: details })
    return
  }

  if (failedWords.length > 0) {
    const details = failedWords.map(f => `${f.word}（${f.reason}）`).join('；')
    res.json({ success: true, message: `🎉 成功提交 ${addedWords.length} 个词语`, details })
    return
  }

  res.json({ success: true, message: `🎉 成功提交 ${addedWords.length} 个词语，感谢你的贡献！` })
})

wordsRouter.delete('/', requireAdminToken, (req: Request, res: Response) => {
  const { words } = req.body as { words?: string[] }
  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ success: false, message: '请指定要删除的词语列表' })
    return
  }

  const removed = removeCustomWords(words)
  if (removed.length === 0) {
    res.status(404).json({ success: false, message: '未找到任何匹配的词语' })
    return
  }

  invalidateIndex()
  res.json({ success: true, message: `已删除 ${removed.length} 个词语`, removed })
})

wordsRouter.delete('/:word', requireAdminToken, (req: Request, res: Response) => {
  const word = decodeURIComponent(req.params.word).trim()
  if (!word) {
    res.status(400).json({ success: false, message: '请指定要删除的词语' })
    return
  }

  const removed = removeCustomWord(word)
  if (!removed) {
    res.status(404).json({ success: false, message: `未找到词语"${word}"` })
    return
  }

  invalidateIndex()
  res.json({ success: true, message: `已删除"${word}"` })
})

wordsRouter.patch('/:word', requireAdminToken, (req: Request, res: Response) => {
  const word = decodeURIComponent(req.params.word).trim()
  if (!word) {
    res.status(400).json({ success: false, message: '请指定要修改的词语' })
    return
  }

  const { category, synonyms } = req.body as { category?: string; synonyms?: string[] }
  if (!category && synonyms === undefined) {
    res.status(400).json({ success: false, message: '请提供要修改的字段（category/synonyms）' })
    return
  }

  const result = updateCustomWord(word, { category, synonyms })
  if (!result.updated) {
    res.status(404).json({ success: false, message: result.reason ?? '更新失败' })
    return
  }

  invalidateIndex()
  res.json({ success: true, message: `已更新"${word}"` })
})
