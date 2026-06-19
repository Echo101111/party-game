import { randomUUID } from 'crypto'
import bcrypt from 'bcrypt'
import type { Player, Room, RoomState, RoomErrorPayload, GameType } from '@draw-and-guess/shared'
import { ErrorCode, SERVER_EVENTS, SPY_MIN_PLAYERS, DRAW_MIN_PLAYERS, NICKNAME_MAX_LENGTH, ROOM_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, BCRYPT_ROUNDS, AVATAR_COUNT, DEFAULT_TOTAL_ROUNDS, DEFAULT_ROUND_DURATION, DEFAULT_ROUNDS_PER_PLAYER, RECONNECT_TIMEOUT_MS, ROOM_DISMISS_TIMEOUT_MS, ROOM_IDLE_TIMEOUT_MS, ROOM_GC_INTERVAL_MS } from '@draw-and-guess/shared'

function createPlayer(nickname: string, isOwner = false): Player {
  const trimmed = nickname.trim()
  if (!trimmed || trimmed.length > NICKNAME_MAX_LENGTH) {
    throw new Error(`昵称长度需在1-${NICKNAME_MAX_LENGTH}字符之间`)
  }
  return {
    id: randomUUID(),
    nickname: trimmed,
    sessionId: '',
    isOwner,
    score: 0,
    hasGuessedCorrectly: false,
    isGuessOnly: false,
    avatar: Math.floor(Math.random() * AVATAR_COUNT),
    joinedAt: Date.now(),
    lastActiveAt: Date.now(),
  }
}

function createRoom(name: string, maxPlayers: number, password: string, owner: Player, gameType: GameType, roundsPerPlayer?: number): Room {
  const now = Date.now()
  return {
    id: randomUUID(),
    code: name,
    name,
    password,
    state: 'lobby',
    maxPlayers,
    players: [owner],
    currentWord: null,
    currentWordCategory: undefined,
    currentRound: 0,
    totalRounds: DEFAULT_TOTAL_ROUNDS,
    roundStartTime: null,
    roundDuration: DEFAULT_ROUND_DURATION,
    roundsPerPlayer: roundsPerPlayer ?? DEFAULT_ROUNDS_PER_PLAYER,
    gameType,
    lastActivityAt: now,
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private nameToRoomId = new Map<string, string>()
  private dismissTimers = new Map<string, NodeJS.Timeout>()
  private disconnectTimers = new Map<string, NodeJS.Timeout>()
  private playerToRoomId = new Map<string, string>()
  private playerSocketMap = new Map<string, string>()
  private onDismissCallbacks: Array<(roomId: string) => void> = []
  private onPlayerRemovedCallbacks: Array<(playerId: string, roomId: string) => void> = []
  private RECONNECT_TIMEOUT = RECONNECT_TIMEOUT_MS
  private gcTimer?: NodeJS.Timeout

  constructor() {
    this.gcTimer = setInterval(() => this.sweepStaleRooms(), ROOM_GC_INTERVAL_MS)
  }

  onDismissed(callback: (roomId: string) => void): void {
    this.onDismissCallbacks.push(callback)
  }

  onPlayerRemoved(callback: (playerId: string, roomId: string) => void): void {
    this.onPlayerRemovedCallbacks.push(callback)
  }

  async createRoom(
    nickname: string,
    roomName: string,
    maxPlayers: number,
    password: string,
    gameType: GameType = 'draw',
    roundsPerPlayer?: number
  ): Promise<{ room: Room; player: Player }> {
    const trimmedName = roomName.trim()
    if (!trimmedName) {
      throw new Error('Room name is required')
    }

    if (trimmedName.length > ROOM_NAME_MAX_LENGTH) {
      throw new Error(`房间名称不能超过${ROOM_NAME_MAX_LENGTH}个字符`)
    }

    if (password && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
      throw new Error(`密码长度需在${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}字符之间`)
    }

    // Check name uniqueness (case-insensitive)
    const normalizedName = trimmedName.toLowerCase()
    if (this.nameToRoomId.has(normalizedName)) {
      throw new Error('该房间名称已被使用，请换一个名字')
    }

    const owner = createPlayer(nickname, true)
    const hashedPassword = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : ''
    const room = createRoom(trimmedName, maxPlayers, hashedPassword, owner, gameType, roundsPerPlayer)

    this.rooms.set(room.id, room)
    this.nameToRoomId.set(normalizedName, room.id)
    this.playerToRoomId.set(owner.id, room.id)
    return { room, player: owner }
  }

  async joinRoom(
    roomName: string,
    password: string,
    nickname: string
  ): Promise<{ room: Room; player: Player } | { error: RoomErrorPayload }> {
    const roomId = this.nameToRoomId.get(roomName.trim().toLowerCase())
    if (!roomId) {
      return { error: { code: ErrorCode.ROOM_NOT_FOUND, message: '房间不存在或已结束' } }
    }

    const room = this.rooms.get(roomId)!
    if (room.players.length >= room.maxPlayers) {
      return { error: { code: ErrorCode.ROOM_FULL, message: '房间人数已满' } }
    }

    if (room.password && !(await bcrypt.compare(password, room.password))) {
      return { error: { code: ErrorCode.ROOM_PASSWORD_WRONG, message: '密码错误' } }
    }

    // 检查昵称是否已被占用，若原玩家的 socket 已断线则自动清理
    const existing = room.players.find(
      (p) => p.nickname.toLowerCase() === nickname.toLowerCase(),
    )
    if (existing) {
      const socketId = this.playerSocketMap.get(existing.id)
      let isActive = false
      if (socketId) {
        const io = this.getIO()
        const sock = io?.sockets.sockets.get(socketId)
        isActive = sock?.connected ?? false
      }
      if (isActive) {
        return { error: { code: ErrorCode.NICKNAME_TAKEN, message: '该昵称已被使用，请换一个名字' } }
      }
      // 旧玩家已断线 → 移除旧记录，新玩家可正常加入
      const wasOwner = existing.isOwner
      room.players.splice(room.players.indexOf(existing), 1)
      this.cleanupPlayer(existing.id)
      // 断线房主被移除后，转移房主给剩余玩家中最早的
      if (wasOwner && room.players.length > 0) {
        room.players[0].isOwner = true
      }
    }

    const player = createPlayer(nickname, false)
    room.players.push(player)
    this.playerToRoomId.set(player.id, room.id)

    room.lastActivityAt = Date.now()
    this.cancelDismissTimer(room.id)
    return { room, player }
  }

  leaveRoom(roomId: string, playerId: string): { removed: boolean; ownerChanged: boolean } {
    const room = this.rooms.get(roomId)
    if (!room) return { removed: false, ownerChanged: false }

    const playerIndex = room.players.findIndex((p) => p.id === playerId)
    if (playerIndex === -1) return { removed: false, ownerChanged: false }

    const player = room.players[playerIndex]
    const wasOwner = player.isOwner
    room.players.splice(playerIndex, 1)
    this.cleanupPlayer(player.id)

    // 如果剩余玩家全部断线，立即清扫，不等 60s 重连超时
    if (room.players.length > 0 && room.players.every(p => !p.sessionId)) {
      for (const p of room.players) {
        this.cancelDisconnectTimer(p.id)
        this.playerToRoomId.delete(p.id)
        this.playerSocketMap.delete(p.id)
        this.onPlayerRemovedCallbacks.forEach((cb) => cb(p.id, roomId))
      }
      room.players = []
    }

    let ownerChanged = false
    if (wasOwner && room.players.length > 0) {
      room.players[0].isOwner = true
      ownerChanged = true
    }

    if (room.players.length === 0) {
      this.startDismissTimer(room.id)
    }

    this.onPlayerRemovedCallbacks.forEach((cb) => cb(playerId, roomId))
    return { removed: true, ownerChanged }
  }

  kickPlayer(roomId: string, hostId: string, targetId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

    const host = room.players.find((p) => p.id === hostId)
    if (!host?.isOwner) return false

    if (hostId === targetId) return false

    const targetIndex = room.players.findIndex((p) => p.id === targetId)
    if (targetIndex === -1) return false

    room.players.splice(targetIndex, 1)
    this.cleanupPlayer(targetId)

    if (room.players.length === 0) {
      this.startDismissTimer(room.id)
    }

    this.onPlayerRemovedCallbacks.forEach((cb) => cb(targetId, roomId))
    return true
  }

  startGame(roomId: string, hostId: string): { success: boolean; error?: RoomErrorPayload } {
    const room = this.rooms.get(roomId)
    if (!room) {
      return { success: false, error: { code: ErrorCode.ROOM_NOT_FOUND, message: '房间不存在' } }
    }

    const host = room.players.find((p) => p.id === hostId)
    if (!host?.isOwner) {
      return { success: false, error: { code: ErrorCode.NOT_ROOM_OWNER, message: '只有房主可以开始游戏' } }
    }

    if (room.state !== 'lobby' && room.state !== 'gameover') {
      return { success: false, error: { code: ErrorCode.GAME_NOT_IN_LOBBY, message: '游戏已在进行中' } }
    }

    const minPlayers = room.gameType === 'spy' ? SPY_MIN_PLAYERS : DRAW_MIN_PLAYERS
    if (room.players.length < minPlayers) {
      return { success: false, error: { code: ErrorCode.GAME_NOT_IN_LOBBY, message: `至少需要${minPlayers}名玩家才能开始游戏` } }
    }
    const drawerCount = room.players.filter(p => !p.isGuessOnly).length
    if (room.gameType !== 'spy' && drawerCount < 1) {
      return { success: false, error: { code: ErrorCode.GAME_NOT_IN_LOBBY, message: '至少需要1位不开启"只猜不画"的玩家来画画' } }
    }

    room.totalRounds = (room.gameType === 'spy' ? room.players.length : drawerCount) * room.roundsPerPlayer
    room.state = 'playing'
    room.currentRound = 1
    room.players.forEach((p) => {
      p.score = 0
      p.hasGuessedCorrectly = false
    })
    return { success: true }
  }

  updatePlayerSession(roomId: string, playerId: string, sessionId: string): void {
    this.cancelDisconnectTimer(playerId)

    const room = this.rooms.get(roomId)
    if (!room) return

    const player = room.players.find((p) => p.id === playerId)
    if (player) {
      player.sessionId = sessionId
    }
  }

  updatePlayerSocket(playerId: string, socketId: string): void {
    this.playerSocketMap.set(playerId, socketId)
  }

  isPlayerSocketActive(playerId: string, socketId: string): boolean {
    return this.playerSocketMap.get(playerId) === socketId
  }

  private cleanupPlayer(playerId: string): void {
    this.playerToRoomId.delete(playerId)
    this.playerSocketMap.delete(playerId)
    this.cancelDisconnectTimer(playerId)
  }

  getPlayerSocketId(playerId: string): string | undefined {
    return this.playerSocketMap.get(playerId)
  }

  markPlayerDisconnected(playerId: string): void {
    const roomId = this.playerToRoomId.get(playerId)
    if (!roomId) return
    const room = this.rooms.get(roomId)
    if (!room) return
    const player = room.players.find(p => p.id === playerId)
    if (player) player.sessionId = ''
  }

  startDisconnectTimer(playerId: string): void {
    this.cancelDisconnectTimer(playerId)
    const timer = setTimeout(() => {
      this.handleDisconnectTimeout(playerId)
    }, this.RECONNECT_TIMEOUT)
    this.disconnectTimers.set(playerId, timer)
  }

  cancelDisconnectTimer(playerId: string): void {
    const timer = this.disconnectTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      this.disconnectTimers.delete(playerId)
    }
  }

  private handleDisconnectTimeout(playerId: string): void {
    this.disconnectTimers.delete(playerId)
    const roomId = this.playerToRoomId.get(playerId)
    if (!roomId) return

    const room = this.rooms.get(roomId)
    if (!room) return

    // 如果玩家已经重连（有活跃 socket），不踢出玩家
    const activeSocketId = this.playerSocketMap.get(playerId)
    if (activeSocketId) {
      const io = this.getIO()
      const activeSocket = io?.sockets.sockets.get(activeSocketId)
      if (activeSocket?.connected) {
        console.log(`[Room] Disconnect timer expired for ${playerId}, but player reconnected. Keeping.`)
        return
      }
    }

    const idx = room.players.findIndex((p) => p.id === playerId)
    if (idx === -1) return

    room.players.splice(idx, 1)
    this.cleanupPlayer(playerId)
    if (room.players.length > 0 && !room.players.some((p) => p.isOwner)) {
      room.players[0].isOwner = true
    }

    const io = this.getIO()
    if (io && room.players.length > 0) {
      io.to(room.code).emit(SERVER_EVENTS.ROOM_UPDATED, { room: this.sanitizeRoom(room) })
    }

    if (room.players.length === 0) {
      this.startDismissTimer(room.id)
    }

    this.onPlayerRemovedCallbacks.forEach((cb) => cb(playerId, roomId))
  }

  findPlayerBySession(sessionId: string): { room: Room; player: Player } | null {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.sessionId === sessionId)
      if (player) {
        return { room, player }
      }
    }
    return null
  }

  getRoomByName(name: string): Room | null {
    const roomId = this.nameToRoomId.get(name.trim().toLowerCase())
    return roomId ? this.rooms.get(roomId) ?? null : null
  }

  getRoomByCode(code: string): Room | null {
    return this.getRoomByName(code)
  }

  getRoomById(id: string): Room | null {
    return this.rooms.get(id) ?? null
  }

  updateRoomActivity(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.lastActivityAt = Date.now()
    }
  }

  private sweepStaleRooms(): void {
    const now = Date.now()
    for (const [roomId, room] of this.rooms) {
      if (now - room.lastActivityAt > ROOM_IDLE_TIMEOUT_MS) {
        console.log(`[Room] GC sweeping stale room "${room.name}" (${roomId})`)
        this.dismissRoom(roomId)
      }
    }
  }

  stopRoomGC(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = undefined
    }
  }

  getAllRooms(gameType?: GameType): Room[] {
    const rooms = Array.from(this.rooms.values())
    return gameType ? rooms.filter(r => r.gameType === gameType) : rooms
  }

  getRoomStats(): { total: number; byState: Record<RoomState, number>; totalPlayers: number; activePlayers: number } {
    const byState: Record<RoomState, number> = { lobby: 0, playing: 0, gameover: 0 }
    let totalPlayers = 0
    let activePlayers = 0
    for (const room of this.rooms.values()) {
      byState[room.state]++
      totalPlayers += room.players.length
      activePlayers += room.players.filter(p => p.sessionId).length
    }
    return { total: this.rooms.size, byState, totalPlayers, activePlayers }
  }

  updatePlayerState(roomId: string, playerId: string, updates: Partial<Pick<Player, 'score' | 'hasGuessedCorrectly'>>): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    const player = room.players.find((p) => p.id === playerId)
    if (player) {
      Object.assign(player, updates)
    }
  }

  private startDismissTimer(roomId: string): void {
    this.cancelDismissTimer(roomId)
    const timer = setTimeout(() => {
      this.dismissRoom(roomId)
    }, ROOM_DISMISS_TIMEOUT_MS)
    this.dismissTimers.set(roomId, timer)
  }

  private cancelDismissTimer(roomId: string): void {
    const timer = this.dismissTimers.get(roomId)
    if (timer) {
      clearTimeout(timer)
      this.dismissTimers.delete(roomId)
    }
  }

  dismissRoom(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    this.cancelDismissTimer(roomId)
    for (const p of room.players) {
      this.playerToRoomId.delete(p.id)
      this.playerSocketMap.delete(p.id)
      this.cancelDisconnectTimer(p.id)
    }
    this.nameToRoomId.delete(room.code.toLowerCase())
    this.rooms.delete(roomId)
    this.onDismissCallbacks.forEach((cb) => cb(roomId))
  }

  resetGameState(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.state = 'lobby'
    room.currentRound = 0
    const drawerCount = room.players.filter(p => !p.isGuessOnly).length
    room.totalRounds = drawerCount > 0 ? drawerCount * room.roundsPerPlayer : DEFAULT_TOTAL_ROUNDS
    room.currentWord = null
    room.currentWordCategory = undefined
    room.roundStartTime = null
    room.players.forEach((p) => {
      p.score = 0
      p.hasGuessedCorrectly = false
    })
  }

  private sanitizeRoom(room: Room) {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      state: room.state,
      maxPlayers: room.maxPlayers,
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        isOwner: p.isOwner,
        score: p.score,
        hasGuessedCorrectly: p.hasGuessedCorrectly,
        isGuessOnly: p.isGuessOnly ?? false,
        avatar: p.avatar,
      })),
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      roundsPerPlayer: room.roundsPerPlayer,
      gameType: room.gameType,
    }
  }

  private getIO() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (global as any).io
  }
}

export const roomManager = new RoomManager()
