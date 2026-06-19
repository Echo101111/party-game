import { CLIENT_EVENTS, SERVER_EVENTS, CHAT_COOLDOWN_MS, CHAT_MESSAGE_MAX_LENGTH, GAME_TYPE_DRAW } from '@draw-and-guess/shared'
import { drawGameManager } from '../game/index.js'
import { roomManager } from '../rooms/index.js'
import { matchAnswer } from '../data/wordIndex.js'

const lastChatTime = new Map<string, number>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDrawGameHandlers(io: any, socket: any): void {
  socket.on(CLIENT_EVENTS.SUBMIT_ANSWER, ({ answer }: { answer: string }) => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return

    if (!answer || !answer.trim()) return

    try {
      const result = drawGameManager.submitAnswer(roomId, playerId, answer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(global as any).metrics.answersSubmitted++
      if (result.correct) {
        socket.emit(SERVER_EVENTS.ANSWER_RESULT, {
          playerId,
          nickname: '',
          correct: true,
          displayText: '你猜对了！',
        })
      }
    } catch (err) {
      console.error('[SubmitAnswer] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.DRAW_STROKE, ({ points, color, width, tool, strokeSeq, compressed }: { points: { x: number; y: number }[]; color: string; width: number; tool: string; strokeSeq: number; compressed?: boolean }) => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return

    try {
      const start = Date.now()
      // 解压 uint16 → normalized float64
      const decoded = compressed
        ? points.map((p: { x: number; y: number }) => ({
            x: p.x / 65535,
            y: p.y / 65535,
          }))
        : points
      drawGameManager.handleDrawStroke(roomId, playerId, socket.id, decoded, color, width, tool, strokeSeq)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (global as any).metrics
      m.strokesReceived++
      m.lastStrokeLatency = Date.now() - start
      m.avgStrokeLatency = (m.avgStrokeLatency * (m.strokesReceived - 1) + m.lastStrokeLatency) / m.strokesReceived
    } catch (err) {
      console.error('[DrawStroke] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.CLEAR_CANVAS, () => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return

    try {
      drawGameManager.clearCanvas(roomId, playerId, socket.id)
    } catch (err) {
      console.error('[ClearCanvas] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.CHAT_MESSAGE, ({ text }: { text: string }) => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return

    if (!text || !text.trim()) return

    try {
      const room = roomManager.getRoomById(roomId)
      if (!room) return

      const player = room.players.find((p) => p.id === playerId)
      const now = Date.now()

      // chat 频率限制
      const lastTime = lastChatTime.get(playerId) ?? 0
      if (now - lastTime < CHAT_COOLDOWN_MS) return
      lastChatTime.set(playerId, now)

      const nickname = player?.nickname ?? '玩家'

      // 非 draw 房间：直接广播，不做答案检查
      if (room.gameType !== GAME_TYPE_DRAW) {
        io.to(room.code).emit(SERVER_EVENTS.CHAT_MESSAGE, {
          playerId,
          nickname,
          text: text.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH),
          isSystem: false,
          isWrongGuess: false,
          timestamp: now,
        })
        return
      }

      let isWrongGuess = false

      // 游戏进行中且发送者是猜题者 → 检查是否为答案
      if (room.state === 'playing' && player && !socket.data.isSpectator && !player.isSpectator) {
        const drawerId = drawGameManager.getCurrentDrawerId(roomId)
        // 画师禁言
        if (playerId === drawerId) return
        if (player.hasGuessedCorrectly) {
          // 已猜对者输入答案词 → 静默丢弃（防止泄露）
          if (room.currentWord && matchAnswer(text, room.currentWord)) return
        } else {
          const result = drawGameManager.submitAnswer(roomId, playerId, text)
          if (result.correct) return
          isWrongGuess = true
        }
      }

      io.to(room.code).emit(SERVER_EVENTS.CHAT_MESSAGE, {
        playerId,
        nickname,
        text: text.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH),
        isSystem: false,
        isWrongGuess,
        timestamp: now,
      })
    } catch (err) {
      console.error('[ChatMessage] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.DISMISS_ROOM, () => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return

    try {
      const room = roomManager.getRoomById(roomId)
      if (!room) return

      const player = room.players.find((p) => p.id === playerId)
      if (!player?.isOwner) return

      roomManager.dismissRoom(roomId)
      io.to(room.code).emit(SERVER_EVENTS.KICKED, { reason: '房间已解散' })
    } catch (err) {
      console.error('[DismissRoom] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.UNDO_STROKE, () => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return
    try {
      drawGameManager.undoStroke(roomId, playerId)
    } catch (err) {
      console.error('[UndoStroke] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.REQUEST_GAME_STATE, () => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return
    try {
      drawGameManager.sendGameStateSnapshot(roomId, playerId)
    } catch (err) {
      console.error('[RequestGameState] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.RESYNC_STROKES, ({ strokes }: { strokes: Array<{ strokeSeq?: number; points: Array<{ x: number; y: number }>; color: string; width: number; tool: string }> }) => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return
    try {
      drawGameManager.resyncStrokes(roomId, playerId, strokes)
    } catch (err) {
      console.error('[ResyncStrokes] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.SELECT_WORD, ({ word }: { word: string }) => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return
    try {
      drawGameManager.handleWordSelection(roomId, playerId, word)
    } catch (err) {
      console.error('[SelectWord] Error:', err)
    }
  })

  socket.on(CLIENT_EVENTS.LIKE_DRAWER, () => {
    const { roomId, playerId } = socket.data
    if (!roomId || !playerId) return
    const room = roomManager.getRoomById(roomId)
    if (!room || room.gameType !== GAME_TYPE_DRAW) return
    try {
      drawGameManager.likeDrawer(roomId, playerId)
    } catch (err) {
      console.error('[LikeDrawer] Error:', err)
    }
  })
}

export { lastChatTime, CHAT_COOLDOWN_MS }

export function clearChatCooldown(playerId: string): void {
  lastChatTime.delete(playerId)
}