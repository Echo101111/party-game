import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRoomStore } from '@/stores/room'
import { useCanvasStore } from '@/stores/canvas'
import { getSocket } from '@/composables/useSocket'
import { CLIENT_EVENTS, SERVER_EVENTS, DEFAULT_TOTAL_ROUNDS, DEFAULT_ROUND_DURATION, CHAT_MESSAGE_LIMIT, CHAT_MESSAGE_KEEP, UNDO_ROLLBACK_MS, TIMER_RECALC_INTERVAL_MS, type ChatMessage, type Point } from '@draw-and-guess/shared'

interface DrawerInfo {
  id: string
  nickname: string
}

interface ScoreEntry {
  playerId: string
  nickname: string
  score: number
  rank: number
}

interface RoundStartPayload {
  round: number
  totalRounds: number
  timeLeft: number
  roundStartTime?: number
  drawer: DrawerInfo
  wordLength?: number
  wordCategory?: string
}

interface RoundStartToDrawerPayload {
  round: number
  totalRounds: number
  timeLeft: number
  roundStartTime?: number
  word: string
  wordLength?: number
  wordCategory?: string
}

export const useDrawGameStore = defineStore('drawGame', () => {
  const state = ref<'idle' | 'choosing' | 'playing' | 'round_end' | 'game_over'>('idle')
  const currentRound = ref(0)
  const totalRounds = ref(DEFAULT_TOTAL_ROUNDS)
  const timeLeft = ref(0)
  const totalTime = ref(DEFAULT_ROUND_DURATION)
  const myRole = ref<'drawer' | 'guesser' | 'spectator'>('spectator')
  const scores = ref<ScoreEntry[]>([])
  const chatMessages = ref<ChatMessage[]>([])
  const hasGuessedCorrectly = ref(false)
  const currentWord = ref<string | null>(null)
  const currentDrawer = ref<DrawerInfo | null>(null)
  const wordOptions = ref<Array<{ word: string; category?: string }>>([])
  const strokes = ref<Array<{ playerId: string; points: Point[]; color: string; width: number; tool: string; strokeSeq?: number }>>([])
  const wordLength = ref(0)
  const wordCategory = ref<string | undefined>(undefined)
  const recentGuessers = ref<Array<{ playerId: string; nickname: string }>>([])
  const strokeVersion = ref(0)
  const pendingFullRedraw = ref(false)
  const roundStartTime = ref<number | null>(null)

  const transitionData = ref<{
    word: string
    reason: string
    round: number
    totalRounds: number
    nextDrawer: DrawerInfo | null
  } | null>(null)

  const isMyTurn = computed(() => myRole.value === 'drawer')
  const canSubmitAnswer = computed(() => myRole.value === 'guesser' && !hasGuessedCorrectly.value && state.value === 'playing')
  const drawerNickname = computed(() => currentDrawer.value?.nickname ?? '')
  const wordPlaceholders = computed(() => {
    const len = wordLength.value
    if (len <= 0) return ''
    return `${len}个字`
  })
  const showCategoryHint = computed(() => {
    return !!wordCategory.value && state.value === 'playing'
  })

  interface GameStateSnapshot {
    currentRound: number
    totalRounds: number
    totalTime: number
    timeLeft: number
    roundStartTime?: number | null
    drawer: DrawerInfo
    strokes: Array<{ playerId: string; points: Point[]; color: string; width: number; tool: string; strokeSeq?: number }>
    scores: ScoreEntry[]
    currentWord?: string
    wordLength?: number
    wordCategory?: string
  }

  let timerInterval: ReturnType<typeof setInterval> | null = null

  function calculateTimeLeft(): number {
    if (!roundStartTime.value || totalTime.value <= 0) return timeLeft.value
    const elapsed = (Date.now() - roundStartTime.value) / 1000
    return Math.floor(Math.max(0, totalTime.value - elapsed))
  }

  function startDisplayTimer() {
    stopDisplayTimer()
    timeLeft.value = calculateTimeLeft()
    timerInterval = setInterval(() => {
      timeLeft.value = calculateTimeLeft()
    }, TIMER_RECALC_INTERVAL_MS)
  }

  function stopDisplayTimer() {
    if (timerInterval !== null) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }

  function setupSocketListeners() {
    const socket = getSocket()
    const roomStore = useRoomStore()
    if (!socket) return

    socket.off(SERVER_EVENTS.WORD_SELECTION)
    socket.on(SERVER_EVENTS.WORD_SELECTION, (data: { options: Array<{ word: string; category?: string }>; round: number; totalRounds: number; drawer: DrawerInfo; guessers: Array<{ id: string }> }) => {
      state.value = 'choosing'
      myRole.value = 'drawer'
      currentRound.value = data.round
      totalRounds.value = data.totalRounds
      currentDrawer.value = data.drawer
      wordOptions.value = data.options
      strokes.value = []
      useCanvasStore().clearCanvas()
      hasGuessedCorrectly.value = false
    })

    socket.off(SERVER_EVENTS.WORD_SELECTING)
    socket.on(SERVER_EVENTS.WORD_SELECTING, (data: { round: number; totalRounds: number; drawer: DrawerInfo; guessers: Array<{ id: string }> }) => {
      state.value = 'choosing'
      currentRound.value = data.round
      totalRounds.value = data.totalRounds
      currentDrawer.value = data.drawer
      if (data.drawer.id !== roomStore.currentPlayerId) {
        myRole.value = 'guesser'
      }
      wordOptions.value = []
      strokes.value = []
      useCanvasStore().clearCanvas()
      hasGuessedCorrectly.value = false
    })

    socket.off(SERVER_EVENTS.ROUND_START)
    socket.on(SERVER_EVENTS.ROUND_START, (data: RoundStartPayload) => {
      state.value = 'playing'
      transitionData.value = null
      currentRound.value = data.round
      totalRounds.value = data.totalRounds
      timeLeft.value = data.timeLeft
      totalTime.value = data.timeLeft
      roundStartTime.value = data.roundStartTime ?? null
      currentDrawer.value = data.drawer
      strokes.value = []
      useCanvasStore().clearCanvas()
      hasGuessedCorrectly.value = false
      wordLength.value = data.wordLength ?? 0
      wordCategory.value = data.wordCategory ?? undefined
      recentGuessers.value = []
      startDisplayTimer()

      if (data.drawer.id === roomStore.currentPlayerId) {
        myRole.value = 'drawer'
      } else {
        myRole.value = 'guesser'
      }
    })

    socket.off(SERVER_EVENTS.ROUND_START_TO_DRAWER)
    socket.on(SERVER_EVENTS.ROUND_START_TO_DRAWER, (data: RoundStartToDrawerPayload) => {
      state.value = 'playing'
      transitionData.value = null
      currentRound.value = data.round
      totalRounds.value = data.totalRounds
      timeLeft.value = data.timeLeft
      totalTime.value = data.timeLeft
      roundStartTime.value = data.roundStartTime ?? null
      currentWord.value = data.word
      wordLength.value = data.wordLength ?? data.word.length
      wordCategory.value = data.wordCategory ?? undefined
      strokes.value = []
      useCanvasStore().clearCanvas()
      hasGuessedCorrectly.value = false
      recentGuessers.value = []
      myRole.value = 'drawer'
      startDisplayTimer()
    })

    socket.off(SERVER_EVENTS.DRAW_STROKE)
    socket.on(SERVER_EVENTS.DRAW_STROKE, (data: { playerId: string; points: Point[]; color: string; width: number; tool: string; strokeSeq?: number; full?: boolean; allStrokes?: boolean; strokes?: Array<{ playerId: string; points: Point[]; color: string; width: number; tool: string; strokeSeq?: number }> }) => {
      if (data.allStrokes && data.strokes) {
        strokes.value = data.strokes
        pendingFullRedraw.value = true
        strokeVersion.value++
        return
      }
      if (data.playerId === roomStore.currentPlayerId && !data.full) return
      const existing = data.strokeSeq !== undefined
        ? strokes.value.find(s => s.playerId === data.playerId && s.strokeSeq === data.strokeSeq)
        : undefined
      if (existing) {
        if (data.full) {
          existing.points = data.points
        } else {
          existing.points.push(...data.points)
        }
        pendingFullRedraw.value = true
        strokes.value = [...strokes.value]
      } else {
        strokes.value.push(data)
        pendingFullRedraw.value = true
      }
      strokeVersion.value++
    })

    socket.off(SERVER_EVENTS.CANVAS_CLEARED)
    socket.on(SERVER_EVENTS.CANVAS_CLEARED, () => {
      strokes.value = []
      pendingFullRedraw.value = true
      strokeVersion.value++
      useCanvasStore().clearCanvas()
    })

    socket.off(SERVER_EVENTS.STROKE_UNDONE)
    socket.on(SERVER_EVENTS.STROKE_UNDONE, (data: { playerId: string; strokeSeq?: number }) => {
      if (undoRollbackTimer) { clearTimeout(undoRollbackTimer); undoRollbackTimer = null }
      undoSavedStroke = null
      const idx = strokes.value.findIndex(
        (s) => s.playerId === data.playerId && s.strokeSeq === data.strokeSeq,
      )
      if (idx !== -1) {
        strokes.value.splice(idx, 1)
        pendingFullRedraw.value = true
        strokeVersion.value++
      }
    })

    socket.off(SERVER_EVENTS.ANSWER_RESULT)
    socket.on(SERVER_EVENTS.ANSWER_RESULT, (data: { playerId: string; nickname: string; correct: boolean }) => {
      if (data.correct) {
        if (data.playerId === roomStore.currentPlayerId) {
          hasGuessedCorrectly.value = true
        }
        if (!recentGuessers.value.some((g) => g.playerId === data.playerId)) {
          recentGuessers.value.push({ playerId: data.playerId, nickname: data.nickname })
        }
        addSystemMessage(`${data.nickname} 猜对了！`)
      }
    })

    socket.off(SERVER_EVENTS.SCOREBOARD_UPDATE)
    socket.on(SERVER_EVENTS.SCOREBOARD_UPDATE, (data: { scores: ScoreEntry[] }) => {
      scores.value = data.scores
    })

    socket.off(SERVER_EVENTS.TIMER_SYNC)
    socket.on(SERVER_EVENTS.TIMER_SYNC, (data: { timeLeft: number; serverTime?: number }) => {
      timeLeft.value = data.timeLeft
      // 利用 serverTime 校准 roundStartTime，防止客户端时钟漂移
      if (data.serverTime && totalTime.value > 0) {
        const elapsed = totalTime.value - data.timeLeft
        roundStartTime.value = data.serverTime - elapsed * 1000
      }
    })

    socket.off(SERVER_EVENTS.ROUND_END)
    socket.on(SERVER_EVENTS.ROUND_END, (data: { word: string; reason: string; round?: number; totalRounds?: number; nextDrawer?: DrawerInfo | null }) => {
      state.value = 'round_end'
      stopDisplayTimer()
      strokes.value = []
      useCanvasStore().clearCanvas()
      transitionData.value = {
        word: data.word,
        reason: data.reason,
        round: data.round ?? currentRound.value,
        totalRounds: data.totalRounds ?? totalRounds.value,
        nextDrawer: data.nextDrawer ?? null,
      }
      addSystemMessage(`本轮结束，答案是：${data.word}`)
      if (data.reason === 'timeout') {
        addSystemMessage('时间到！')
      } else if (data.reason === 'all_guessed') {
        addSystemMessage('所有人都猜对了！')
      }
    })

    socket.off(SERVER_EVENTS.GAME_OVER)
    socket.on(SERVER_EVENTS.GAME_OVER, (data: { roomId: string; finalScores: ScoreEntry[]; winner: string | null }) => {
      state.value = 'game_over'
      stopDisplayTimer()
      scores.value = data.finalScores
      if (data.winner) {
        addSystemMessage(`游戏结束！获胜者：${data.winner}`)
      }
    })

    socket.off(SERVER_EVENTS.CHAT_MESSAGE)
    socket.on(SERVER_EVENTS.CHAT_MESSAGE, (data: { playerId: string; nickname: string; text: string; isSystem: boolean; isWrongGuess?: boolean; timestamp: number }) => {
      chatMessages.value.push({
        id: `${data.timestamp}-${data.playerId}`,
        playerId: data.playerId,
        nickname: data.nickname,
        text: data.text,
        isSystem: data.isSystem,
        isWrongGuess: data.isWrongGuess ?? false,
        timestamp: data.timestamp,
      })
      if (chatMessages.value.length > CHAT_MESSAGE_LIMIT) {
        chatMessages.value = chatMessages.value.slice(-CHAT_MESSAGE_KEEP)
      }
    })

    // GAME_STATE_SNAPSHOT: 接收完整游戏快照（兜底 ROUND_START 丢失）
    socket.off(SERVER_EVENTS.GAME_STATE_SNAPSHOT)
    socket.on(SERVER_EVENTS.GAME_STATE_SNAPSHOT, (data: GameStateSnapshot) => {
      const roomStore = useRoomStore()

      state.value = 'playing'
      currentRound.value = data.currentRound
      totalRounds.value = data.totalRounds
      totalTime.value = data.totalTime
      currentDrawer.value = data.drawer
      scores.value = data.scores
      strokes.value = data.strokes
      timeLeft.value = data.timeLeft
      roundStartTime.value = data.roundStartTime ?? null
      if (data.currentWord) currentWord.value = data.currentWord
      if (data.wordLength !== undefined) wordLength.value = data.wordLength
      if (data.wordCategory !== undefined) wordCategory.value = data.wordCategory
      stopDisplayTimer()
      startDisplayTimer()

      // 观战者保留 spectator 角色，等待下一轮 ROUND_START
      if (roomStore.isSpectator) return
      if (!data.drawer) return

      myRole.value = data.drawer.id === roomStore.currentPlayerId ? 'drawer' : 'guesser'
    })
  }

  let sysMsgSeq = 0
  function addSystemMessage(text: string) {
    chatMessages.value.push({
      id: `sys-${Date.now()}-${++sysMsgSeq}`,
      playerId: null,
      nickname: null,
      text,
      isSystem: true,
      timestamp: Date.now(),
    })
    if (chatMessages.value.length > CHAT_MESSAGE_LIMIT) {
      chatMessages.value = chatMessages.value.slice(-CHAT_MESSAGE_KEEP)
    }
  }

  function submitAnswer(answer: string) {
    if (!canSubmitAnswer.value) return
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.SUBMIT_ANSWER, { answer })
    }
  }

  function sendChat(text: string) {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.CHAT_MESSAGE, { text })
    }
  }

  function drawStroke(points: Point[], color: string, width: number, tool: string, strokeSeq?: number, compressed?: boolean) {
    if (!isMyTurn.value) return
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.DRAW_STROKE, { points, color, width, tool, strokeSeq, compressed })
    }
  }

  function clearCanvas() {
    if (!isMyTurn.value) return
    strokes.value = []
    pendingFullRedraw.value = true
    strokeVersion.value++
    useCanvasStore().clearCanvas()
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.CLEAR_CANVAS)
    }
  }

  let undoRollbackTimer: ReturnType<typeof setTimeout> | null = null
  let undoSavedStroke: { playerId: string; points: Point[]; color: string; width: number; tool: string; strokeSeq?: number } | null = null

  function undoStroke() {
    if (!isMyTurn.value) return
    const roomStore = useRoomStore()
    const pid = roomStore.currentPlayerId
    if (pid) {
      for (let i = strokes.value.length - 1; i >= 0; i--) {
        if (strokes.value[i].playerId === pid) {
          undoSavedStroke = { ...strokes.value[i] }
          strokes.value.splice(i, 1)
          pendingFullRedraw.value = true
          strokeVersion.value++
          break
        }
      }
    }
    if (undoRollbackTimer) clearTimeout(undoRollbackTimer)
    undoRollbackTimer = setTimeout(() => {
      if (undoSavedStroke) {
        strokes.value.push(undoSavedStroke)
        undoSavedStroke = null
        pendingFullRedraw.value = true
        strokeVersion.value++
      }
      undoRollbackTimer = null
    }, UNDO_ROLLBACK_MS)

    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.UNDO_STROKE)
    }
  }

  function addCompletedStroke(points: Point[], color: string, width: number, tool: string, seq?: number) {
    const roomStore = useRoomStore()
    if (!roomStore.currentPlayerId) return
    strokes.value.push({
      playerId: roomStore.currentPlayerId,
      points,
      color,
      width,
      tool,
      strokeSeq: seq,
    })
  }

  function selectWord(word: string) {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.SELECT_WORD, { word })
    }
  }

  function likeDrawer() {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.LIKE_DRAWER)
    }
  }

  function teardownSocketListeners(): void {
    const socket = getSocket()
    if (!socket) return
    ;[
      SERVER_EVENTS.WORD_SELECTION, SERVER_EVENTS.WORD_SELECTING,
      SERVER_EVENTS.ROUND_START, SERVER_EVENTS.ROUND_START_TO_DRAWER,
      SERVER_EVENTS.DRAW_STROKE, SERVER_EVENTS.CANVAS_CLEARED,
      SERVER_EVENTS.STROKE_UNDONE,
      SERVER_EVENTS.ANSWER_RESULT, SERVER_EVENTS.SCOREBOARD_UPDATE,
      SERVER_EVENTS.TIMER_SYNC, SERVER_EVENTS.ROUND_END,
      SERVER_EVENTS.GAME_OVER, SERVER_EVENTS.CHAT_MESSAGE,
      SERVER_EVENTS.GAME_STATE_SNAPSHOT,
    ].forEach(evt => socket.off(evt))
  }

  function resetGame() {
    stopDisplayTimer()
    state.value = 'idle'
    currentRound.value = 0
    timeLeft.value = 0
    totalTime.value = DEFAULT_ROUND_DURATION
    roundStartTime.value = null
    myRole.value = 'spectator'
    scores.value = []
    hasGuessedCorrectly.value = false
    currentWord.value = null
    currentDrawer.value = null
    strokes.value = []
    chatMessages.value = []
    transitionData.value = null
    wordOptions.value = []
    wordLength.value = 0
    wordCategory.value = undefined
    recentGuessers.value = []
    strokeVersion.value = 0
    pendingFullRedraw.value = false
    if (undoRollbackTimer) { clearTimeout(undoRollbackTimer); undoRollbackTimer = null }
    undoSavedStroke = null
  }

  return {
    state,
    currentRound,
    totalRounds,
    timeLeft,
    totalTime,
    roundStartTime,
    myRole,
    scores,
    chatMessages,
    hasGuessedCorrectly,
    currentWord,
    currentDrawer,
    wordOptions,
    strokes,
    transitionData,
    isMyTurn,
    canSubmitAnswer,
    drawerNickname,
    wordLength,
    wordCategory,
    wordPlaceholders,
    showCategoryHint,
    recentGuessers,
    strokeVersion,
    pendingFullRedraw,
    setupSocketListeners,
    teardownSocketListeners,
    submitAnswer,
    sendChat,
    drawStroke,
    clearCanvas,
    undoStroke,
    addCompletedStroke,
    selectWord,
    likeDrawer,
    resetGame,
  }
})
