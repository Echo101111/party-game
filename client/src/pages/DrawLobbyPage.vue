<template>
  <div class="lobby-page">
    <div class="lobby-card">
      <div class="lobby-header">
        <div class="header-icon">🎮</div>
        <h1>🎨 你画我猜</h1>
        <div class="room-code-badge">
          <span class="code-label">房间</span>
          <span class="code-value">{{ roomName }}</span>
          <button class="code-copy" @click="copyRoomName" title="复制房间名称">📋</button>
        </div>
      </div>

      <div class="players-section">
        <div class="players-header">
          <h2>玩家</h2>
          <span class="player-count">{{ players.length }} 位玩家</span>
        </div>

        <div class="player-list">
          <TransitionGroup name="player">
            <div v-for="player in players" :key="player.id" class="player-card">
              <div class="player-avatar">
                {{ player.nickname.charAt(0) }}
              </div>
              <div class="player-info">
                <span class="player-name">{{ player.nickname }}</span>
                <div class="player-tags">
                  <span v-if="player.id === currentPlayerId" class="tag tag-you">你</span>
                  <span v-if="player.isOwner" class="tag tag-owner">房主</span>
                  <span v-if="player.isGuessOnly && player.id !== currentPlayerId" class="tag tag-guess-only">🙊 只猜不画</span>
                </div>
                <div v-if="player.id === currentPlayerId" class="guess-only-toggle">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      :checked="currentPlayerGuessOnly"
                      :disabled="gameState === 'playing'"
                      @change="toggleGuessOnly"
                    />
                    <span class="toggle-slider"></span>
                  </label>
                  <span class="toggle-label">🙊 只猜不画</span>
                </div>
              </div>
              <button
                v-if="isOwner && player.id !== currentPlayerId"
                class="btn-kick"
                @click="handleKick(player.id)"
                title="踢出"
              >
                ✕
              </button>
            </div>
          </TransitionGroup>

          <div v-if="players.length === 0" class="empty-players">
            等待玩家加入...
          </div>
        </div>
      </div>

      <div v-if="isOwner && gameState !== 'playing'" class="rounds-setting">
        <label class="rounds-label">
          <span>每人画 <strong>{{ room?.roundsPerPlayer ?? 2 }}</strong> 轮</span>
          <span class="rounds-info">共 {{ drawerCount * (room?.roundsPerPlayer ?? 2) }} 轮</span>
        </label>
        <input
          type="range"
          min="1"
          max="5"
          step="1"
          :value="room?.roundsPerPlayer ?? 2"
          @input="handleRoundsChange"
          class="rounds-slider"
        />
        <div class="rounds-labels">
          <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
        </div>
      </div>

      <div class="lobby-actions">
        <button
          v-if="isOwner"
          class="btn-start"
          :disabled="players.length < DRAW_MIN_PLAYERS || drawerCount < 1 || gameState === 'playing' || roomStore.connectionState !== 'connected'"
          @click="handleStartGame"
        >
          <span class="btn-start-icon">{{ players.length < DRAW_MIN_PLAYERS || drawerCount < 1 ? '👥' : '🎯' }}</span>
          {{ roomStore.connectionState !== 'connected' ? '连接中...' : (players.length < DRAW_MIN_PLAYERS ? '等待更多玩家...' : (drawerCount < 1 ? '需要非只猜不画玩家...' : '开始游戏')) }}
        </button>

        <div class="lobby-actions-secondary">
          <button
            v-if="isOwner && gameState !== 'playing'"
            class="btn-secondary"
            @click="toggleGameType"
          >
            <span>{{ room?.gameType === 'draw' ? '🕵️' : '🎨' }}</span>
            切换{{ room?.gameType === 'draw' ? '谁是卧底' : '你画我猜' }}
          </button>
          <button
            v-if="isOwner"
            class="btn-danger"
            @click="dismissRoom"
          >
            🗑️ 解散房间
          </button>

          <button v-if="isOwner" class="btn-secondary" @click="showWordConfig = true">
            📚 词库概览
          </button>

          <button class="btn-secondary btn-leave" @click="handleLeave">
            离开房间
          </button>
        </div>
      </div>

      <Transition name="fade">
        <WordConfigModal :show="showWordConfig" @close="showWordConfig = false" />
      </Transition>
    </div>

    <Transition name="fade">
      <p v-if="errorMessage" class="error-toast">{{ errorMessage }}</p>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRoomStore } from '@/stores/room'
import { useDrawGameStore } from '@/stores/drawGame'
import { getSocket } from '@/composables/useSocket'
import { CLIENT_EVENTS, DRAW_MIN_PLAYERS, TOAST_LOBBY_ERROR_MS } from '@draw-and-guess/shared'
import WordConfigModal from '@/components/WordConfigModal.vue'

const route = useRoute()
const router = useRouter()
const roomStore = useRoomStore()

const roomName = computed(() => route.params.roomName as string)

const room = computed(() => roomStore.room)
const players = computed(() => roomStore.players)
const currentPlayerId = computed(() => roomStore.currentPlayerId)
const isOwner = computed(() => roomStore.isOwner)
const gameState = computed(() => room.value?.state)

const currentPlayerGuessOnly = computed(() => {
  const p = players.value.find(p => p.id === currentPlayerId.value)
  return p?.isGuessOnly ?? false
})

const drawerCount = computed(() => players.value.filter(p => !p.isGuessOnly).length)

const errorMessage = ref<string | null>(null)
const showWordConfig = ref(false)

// If room name in URL doesn't match stored room, redirect
watch(() => roomStore.room?.code, (code) => {
  if (code && code !== roomName.value) {
    router.replace(`/lobby/${code}`)
  }
})

watch(() => roomStore.error, (newError) => {
  errorMessage.value = newError
  if (newError) {
    setTimeout(() => { errorMessage.value = null }, TOAST_LOBBY_ERROR_MS)
  }
})

watch(room, (newRoom) => {
  if (newRoom?.state === 'playing') {
    useDrawGameStore().setupSocketListeners()
    router.push(`/draw/game/${roomName.value}`)
  }
}, { immediate: true })

// 游戏类型切换 — 切为 spy 时重定向
watch(() => room.value?.gameType, (gameType) => {
  if (gameType === 'spy' && room.value) {
    router.push(`/spy/lobby/${roomName.value}`)
  }
})

function toggleGameType() {
  const socket = getSocket()
  if (!socket?.connected) return
  const newType = room.value?.gameType === 'draw' ? 'spy' : 'draw'
  socket.emit(CLIENT_EVENTS.UPDATE_GAME_TYPE, { gameType: newType })
}

onMounted(() => {
  document.title = '🎨 你画我猜 - Oiiiii早春'
  roomStore.setupSocketListeners()
  // 不注册 gameStore 监听器 — 游戏事件在 GamePage 渲染后才绑定
  // 这样避免路由跳转（Lobby → Game）时 socket.off/on 重注册导致事件丢失
})

onUnmounted(() => {
  document.title = 'Oiiiii早春 - 派对游戏'
})

function copyRoomName() {
  const text = roomName.value
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {})
  } else {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

function handleKick(playerId: string) {
  roomStore.kickPlayer(playerId)
}

function handleStartGame() {
  roomStore.startGame()
}

function handleRoundsChange(e: Event) {
  const target = e.target as HTMLInputElement
  const val = parseInt(target.value, 10)
  roomStore.updateRoundsPerPlayer(val)
}

function toggleGuessOnly(e: Event) {
  const target = e.target as HTMLInputElement
  roomStore.setGuessOnly(target.checked)
}

function dismissRoom() {
  const socket = getSocket()
  if (socket?.connected) {
    socket.emit(CLIENT_EVENTS.DISMISS_ROOM)
  }
}

function handleLeave() {
  roomStore.leaveRoom()
  router.push('/')
}
</script>

<style scoped>
.lobby-page {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  overflow: hidden;
  padding: 2rem 1rem;
}

.lobby-card {
  width: 100%;
  max-width: 480px;
  max-height: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border-light);
  display: flex;
  flex-direction: column;
  animation: slideUp 0.5s ease-out;
}

.lobby-header {
  flex-shrink: 0;
  text-align: center;
  padding: 2rem 2rem 1.5rem;
  background: linear-gradient(180deg, var(--color-accent-pale) 0%, var(--color-surface) 100%);
  border-bottom: 1px solid var(--color-border-light);
}

.header-icon {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.lobby-header h1 {
  font-family: var(--font-title);
  font-size: 1.8rem;
  color: var(--color-text);
  margin-bottom: 0.75rem;
}

.room-code-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--color-surface);
  padding: 0.5rem 1rem;
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
}

.code-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.code-value {
  font-family: var(--font-number);
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--color-primary);
  letter-spacing: 0.15em;
}

.code-copy {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.2rem;
  border-radius: 4px;
  transition: var(--transition);
  line-height: 1;
}

.code-copy:hover {
  background: var(--color-border-light);
}

.players-section {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 1.5rem 2rem;
  -webkit-overflow-scrolling: touch;
}

.players-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.players-header h2 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text);
}

.player-count {
  font-family: var(--font-number);
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.player-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.player-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  background: var(--color-bg);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-light);
  transition: var(--transition);
}

.player-card:hover {
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.player-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-accent-pale), var(--color-bg-warm));
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  overflow: hidden;
}

.player-avatar svg {
  width: 60%;
  height: 60%;
}

.player-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.player-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text);
}

.player-tags {
  display: flex;
  gap: 0.3rem;
}

.tag {
  font-size: 0.7rem;
  padding: 0.1rem 0.5rem;
  border-radius: var(--radius-full);
  font-weight: 600;
}

.tag-you {
  background: var(--color-accent-pale);
  color: var(--color-accent);
}

.tag-owner {
  background: var(--color-gold-bg);
  color: var(--color-gold);
}

.tag-guess-only {
  background: var(--color-border-light);
  color: var(--color-text-muted);
  font-size: 0.65rem;
}

.guess-only-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.2rem;
}

.toggle-label {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  user-select: none;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 18px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--color-border);
  border-radius: 18px;
  transition: var(--transition);
}

.toggle-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: var(--transition);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(12px);
}

.toggle-switch input:disabled + .toggle-slider {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-kick {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--color-danger-light);
  color: var(--color-danger);
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  transition: var(--transition);
  opacity: 0;
}

.player-card:hover .btn-kick {
  opacity: 1;
}

.btn-kick:hover {
  background: var(--color-danger);
  color: #fff;
}

.empty-players {
  text-align: center;
  color: var(--color-text-muted);
  padding: 2rem;
  font-size: 0.95rem;
}

.rounds-setting {
  flex-shrink: 0;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border-light);
}

.rounds-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.rounds-label strong {
  font-family: var(--font-number);
  font-size: 1.1rem;
  color: var(--color-primary);
}

.rounds-info {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.rounds-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-border-light);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.rounds-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(232, 133, 108, 0.3);
  transition: var(--transition);
}

.rounds-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.rounds-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: none;
}

.rounds-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  padding: 0.15rem 0.1rem 0;
}

.lobby-actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.25rem 1.5rem 1.5rem;
  border-top: 1px solid var(--color-border-light);
}

.lobby-actions-secondary {
  display: flex;
  gap: 0.5rem;
}

.lobby-actions-secondary .btn-secondary {
  flex: 1;
}

.btn-start {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.75rem;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  letter-spacing: 0.03em;
}

.btn-start:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(232, 133, 108, 0.35);
}

.btn-start:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-start-icon {
  font-size: 1.1rem;
}

.btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.55rem 0.75rem;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition);
  white-space: nowrap;
}

.btn-secondary:hover {
  border-color: var(--color-accent);
  background: var(--color-bg-warm);
}

.btn-danger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.55rem 0.75rem;
  background: var(--color-surface);
  color: #e74c3c;
  border: 1.5px solid var(--color-danger-light);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition);
  white-space: nowrap;
}

.btn-danger:hover {
  background: #fef2f2;
  border-color: #e74c3c;
}

.btn-secondary.btn-leave:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: var(--color-danger-light);
}

.error-toast {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-danger-light);
  color: var(--color-danger);
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-full);
  font-size: 0.9rem;
  font-weight: 500;
  box-shadow: var(--shadow-md);
  border: 1px solid rgba(217, 117, 107, 0.2);
  z-index: 100;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.player-enter-active,
.player-leave-active {
  transition: all 0.3s ease;
}

.player-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.player-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.btn-save-custom {
  margin-top: 0.35rem;
  padding: 0.3rem 0.8rem;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.72rem;
  cursor: pointer;
}

/* ─── Mobile ─── */
@media (max-width: 767px) {
  .lobby-card {
    max-width: 100%;
    border-radius: 0;
    box-shadow: none;
    border: none;
  }

  .lobby-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    text-align: left;
    gap: 0.5rem;
  }

  .header-icon {
    font-size: 1.3rem;
    margin: 0;
  }

  .lobby-header h1 {
    font-size: 1.1rem;
    margin: 0;
    white-space: nowrap;
  }

  .room-code-badge {
    padding: 0.3rem 0.6rem;
    flex-shrink: 0;
  }

  .code-value {
    font-size: 0.95rem;
  }

  .code-copy {
    font-size: 0.85rem;
  }

  .players-section {
    padding: 0.75rem 1rem;
  }

  .player-card {
    padding: 0.45rem 0.6rem;
    gap: 0.5rem;
  }

  .player-avatar {
    width: 30px;
    height: 30px;
    font-size: 0.8rem;
  }

  .player-name {
    font-size: 0.85rem;
  }

  .rounds-setting {
    padding: 0.4rem 1rem;
  }

  .rounds-label {
    font-size: 0.8rem;
    margin-bottom: 0.25rem;
  }

  .lobby-actions {
    padding: 0.5rem 1rem 1rem;
    gap: 0.4rem;
  }

  .lobby-actions-secondary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .btn-start {
    padding: 0.6rem;
    font-size: 0.9rem;
  }

  .btn-secondary,
  .btn-danger {
    padding: 0.45rem 0.5rem;
    font-size: 0.75rem;
  }
}
</style>
