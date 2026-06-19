import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getSocket, connectSocket, saveSession, clearSession, waitForConnection, saveNickname } from '@/composables/useSocket'
import { CLIENT_EVENTS, SERVER_EVENTS, DEFAULT_MAX_PLAYERS, DEFAULT_TOTAL_ROUNDS, DEFAULT_ROUNDS_PER_PLAYER, DEFAULT_GAME_TYPE, SOCKET_CONNECT_TIMEOUT_MS } from '@draw-and-guess/shared'
import type { GameType } from '@draw-and-guess/shared'

interface RoomPlayer {
  id: string
  nickname: string
  isOwner: boolean
  score: number
  hasGuessedCorrectly: boolean
  isGuessOnly: boolean
  avatar: number
}

interface RoomData {
  id: string
  code: string
  name: string
  state: string
  maxPlayers: number
  players: RoomPlayer[]
  currentRound: number
  totalRounds: number
  roundsPerPlayer: number
  gameType: GameType
}

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomData | null>(null)
  const currentPlayerId = ref<string | null>(null)
  const connectionState = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const error = ref<string | null>(null)
  const isSpectator = ref(false)

  const isOwner = computed(() => {
    const player = room.value?.players.find((p) => p.id === currentPlayerId.value)
    return player?.isOwner ?? false
  })

  const players = computed(() => room.value?.players ?? [])

  const roomName = computed(() => room.value?.code ?? '')

  const setupSocketListeners = () => {
    const socket = getSocket()

    socket.off(SERVER_EVENTS.ROOM_CREATED)
    socket.on(SERVER_EVENTS.ROOM_CREATED, (data) => {
      if (data.room) {
        room.value = data.room
      } else {
        room.value = {
          id: data.roomId,
          code: data.roomCode,
          name: '',
          state: 'lobby',
          maxPlayers: DEFAULT_MAX_PLAYERS,
          players: [],
          currentRound: 0,
          totalRounds: DEFAULT_TOTAL_ROUNDS,
          roundsPerPlayer: DEFAULT_ROUNDS_PER_PLAYER,
          gameType: DEFAULT_GAME_TYPE,
        }
      }
      currentPlayerId.value = data.playerId
      connectionState.value = 'connected'
      error.value = null
    })

    socket.off(SERVER_EVENTS.ROOM_JOINED)
    socket.on(SERVER_EVENTS.ROOM_JOINED, (data) => {
      room.value = data.room
      currentPlayerId.value = data.playerId
      connectionState.value = 'connected'
      error.value = null
      isSpectator.value = data.isSpectator ?? (data.room?.state === 'playing')
    })

    socket.off(SERVER_EVENTS.ROOM_ERROR)
    socket.on(SERVER_EVENTS.ROOM_ERROR, (data) => {
      error.value = data.message
    })

    socket.off(SERVER_EVENTS.ROOM_UPDATED)
    socket.on(SERVER_EVENTS.ROOM_UPDATED, (data) => {
      const prevOwner = room.value?.players.find((p) => p.isOwner)
      room.value = data.room
      const newOwner = room.value?.players.find((p) => p.isOwner)
      if (prevOwner && newOwner && prevOwner.id !== newOwner.id) {
        error.value = `房主变更为 ${newOwner.nickname}`
      }
    })

    socket.off(SERVER_EVENTS.KICKED)
    socket.on(SERVER_EVENTS.KICKED, (data) => {
      error.value = data.reason
      room.value = null
      currentPlayerId.value = null
      connectionState.value = 'disconnected'
      clearSession()
    })

    socket.off(SERVER_EVENTS.SESSION_RESTORED)
    socket.on(SERVER_EVENTS.SESSION_RESTORED, (data) => {
      room.value = data.room
      currentPlayerId.value = data.playerId
      connectionState.value = 'connected'
      error.value = null
      isSpectator.value = false

      if (data.room) {
        const targetPath = data.room.state === 'playing'
          ? `/${data.room.gameType}/game/${data.room.name}`
          : `/${data.room.gameType}/lobby/${data.room.name}`
        import('@/router').then(({ default: router }) => {
          if (router.currentRoute.value.path !== targetPath) {
            router.push(targetPath)
          }
        })
      }

      if (data.room?.state === 'playing') {
        getSocket()?.emit(CLIENT_EVENTS.REQUEST_GAME_STATE)
      }
    })

    socket.off(SERVER_EVENTS.SPECTATOR_JOINED)
    socket.on(SERVER_EVENTS.SPECTATOR_JOINED, (data) => {
      room.value = data.room
      currentPlayerId.value = `spectator-${data.room.code}`
      connectionState.value = 'connected'
      error.value = null
      isSpectator.value = true
    })

    socket.off('disconnect', onSocketDisconnect)
    socket.on('disconnect', onSocketDisconnect)
  }

  function onSocketDisconnect() {
    connectionState.value = 'disconnected'
  }

  function waitForResponse(roomEvent: string, timeoutMs = SOCKET_CONNECT_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve) => {
      const socket = getSocket()
      const timer = setTimeout(() => {
        cleanup()
        if (!room.value) {
          error.value = '服务器无响应，请稍后重试'
          connectionState.value = 'disconnected'
        }
        resolve()
      }, timeoutMs)
      const onResponse = () => { cleanup(); resolve() }
      const cleanup = () => {
        clearTimeout(timer)
        socket.off(roomEvent, onResponse)
        socket.off(SERVER_EVENTS.ROOM_ERROR, onResponse)
      }
      socket.once(roomEvent, onResponse)
      socket.once(SERVER_EVENTS.ROOM_ERROR, onResponse)
    })
  }

  const createRoom = async (
    nickname: string,
    options?: { roomName?: string; maxPlayers?: number; password?: string; gameType?: GameType; roundsPerPlayer?: number }
  ) => {
    connectionState.value = 'connecting'
    error.value = null
    const socket = connectSocket()
    setupSocketListeners()
    clearSession()
    if (!socket.connected) {
      try {
        await waitForConnection(SOCKET_CONNECT_TIMEOUT_MS)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '连接失败'
        error.value = `${msg}，请检查网络后重试`
        connectionState.value = 'disconnected'
        return
      }
    }
    socket.once(SERVER_EVENTS.ROOM_CREATED, (data) => {
      saveSession(data.roomCode, data.playerId, nickname)
      saveNickname(nickname)
    })
    socket.emit(CLIENT_EVENTS.CREATE_ROOM, {
      nickname,
      roomName: options?.roomName,
      maxPlayers: options?.maxPlayers,
      password: options?.password,
      gameType: options?.gameType ?? DEFAULT_GAME_TYPE,
      roundsPerPlayer: options?.roundsPerPlayer ?? DEFAULT_ROUNDS_PER_PLAYER,
    })
    await waitForResponse(SERVER_EVENTS.ROOM_CREATED)
  }

  const joinRoom = async (roomName: string, nickname: string, password?: string) => {
    connectionState.value = 'connecting'
    error.value = null
    const socket = connectSocket()
    setupSocketListeners()
    clearSession()
    if (!socket.connected) {
      try {
        await waitForConnection(SOCKET_CONNECT_TIMEOUT_MS)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '连接失败'
        error.value = `${msg}，请检查网络后重试`
        connectionState.value = 'disconnected'
        return
      }
    }
    socket.once(SERVER_EVENTS.ROOM_JOINED, (data) => {
      saveSession(data.room.code, data.playerId, nickname)
      saveNickname(nickname)
    })
    socket.emit(CLIENT_EVENTS.JOIN_ROOM, {
      roomName,
      nickname,
      password,
    })
    await waitForResponse(SERVER_EVENTS.ROOM_JOINED)
  }

  const joinAsSpectator = async (roomName: string, password?: string) => {
    connectionState.value = 'connecting'
    error.value = null
    const socket = connectSocket()
    setupSocketListeners()
    if (!socket.connected) {
      try {
        await waitForConnection(SOCKET_CONNECT_TIMEOUT_MS)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '连接失败'
        error.value = `${msg}，请检查网络后重试`
        connectionState.value = 'disconnected'
        return
      }
    }
    socket.emit(CLIENT_EVENTS.JOIN_AS_SPECTATOR, { roomName, password })
    await waitForResponse(SERVER_EVENTS.SPECTATOR_JOINED)
  }

  const leaveRoom = () => {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.LEAVE_ROOM)
    }
    room.value = null
    currentPlayerId.value = null
    connectionState.value = 'disconnected'
    isSpectator.value = false
    clearSession()
  }

  const kickPlayer = (playerId: string) => {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.KICK_PLAYER, { playerId })
    }
  }

  const startGame = () => {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.START_GAME, { roundsPerPlayer: room.value?.roundsPerPlayer ?? DEFAULT_ROUNDS_PER_PLAYER })
    } else {
      error.value = '连接未就绪，请等待重新连接'
    }
  }

  const clearError = () => {
    error.value = null
  }

  const updateRoundsPerPlayer = (roundsPerPlayer: number) => {
    const socket = getSocket()
    if (socket?.connected && isOwner.value) {
      socket.emit(CLIENT_EVENTS.UPDATE_ROUNDS_PER_PLAYER, { roundsPerPlayer })
    }
  }

  const setGuessOnly = (isGuessOnly: boolean) => {
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit(CLIENT_EVENTS.SET_GUESS_ONLY, { isGuessOnly })
    }
  }

  return {
    room,
    currentPlayerId,
    connectionState,
    error,
    isOwner,
    isSpectator,
    players,
    roomName,
    setupSocketListeners,
    createRoom,
    joinRoom,
    joinAsSpectator,
    leaveRoom,
    kickPlayer,
    startGame,
    clearError,
    updateRoundsPerPlayer,
    setGuessOnly,
  }
})
