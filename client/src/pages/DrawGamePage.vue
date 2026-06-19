<template>
  <div class="game-page">
    <!-- 连接状态栏 -->
    <Transition name="slide-down">
      <div v-if="connectionState === 'disconnected'" class="connection-banner disconnected">
        🔴 连接已断开，正在重连...
      </div>
      <div v-else-if="connectionState === 'reconnecting'" class="connection-banner reconnecting">
        🔄 正在重连...（第 {{ reconnectAttempt }} 次）
      </div>
    </Transition>
    <header class="game-header">
      <div class="header-left">
        <div class="room-badge">
          <span class="badge-icon">🎮</span>
          <span class="badge-code">{{ roomName }}</span>
        </div>
        <span class="game-type-label">🎨 你画我猜</span>
      </div>
      <div class="header-center">
        <Timer v-if="gameStore.state === 'playing'" />
      </div>
      <div class="header-right">
        <button class="btn-trophy" @click.stop="showScoreboard = !showScoreboard">🏆</button>
        <button class="btn-leave" @click="handleLeave">离开</button>
      </div>
    </header>

    <main class="game-content">
      <aside class="sidebar sidebar-left">
        <Scoreboard :scores="gameStore.scores" />
      </aside>

      <div class="game-area">
        <div v-if="gameStore.state === 'idle'" class="waiting">
          <div class="waiting-icon">🎨</div>
          <p>等待游戏开始...</p>
          <button
            v-if="roomStore.isOwner"
            class="btn-start-game"
            :disabled="roomStore.players.length < DRAW_MIN_PLAYERS || drawerCount < 1"
            @click="handleStartGame"
          >
            <span>{{ roomStore.players.length < DRAW_MIN_PLAYERS ? '等待更多玩家...' : (drawerCount < 1 ? '需要非只猜不画玩家...' : '开始游戏') }}</span>
          </button>
        </div>

        <div v-else-if="gameStore.state === 'choosing'" class="playing">
          <WordSelectModal
            v-if="gameStore.myRole === 'drawer'"
            :options="gameStore.wordOptions"
            @select="handleWordSelect"
          />
          <div v-else class="waiting">
            <div class="waiting-icon">🎨</div>
            <p>{{ gameStore.drawerNickname }} 正在选词...</p>
          </div>
        </div>

        <div v-else-if="gameStore.state === 'playing'" class="playing">
          <Transition name="fade">
            <div v-if="showSpectatorNotice" class="spectator-notice">👀 你已加入观战，下一题开始自动参与</div>
          </Transition>
          <Transition name="pop">
            <div v-if="showDrawerAlert" class="drawer-alert" @click="closeDrawerAlert">
              <div class="drawer-alert-box" @click="closeDrawerAlert">
                <button class="drawer-alert-close" @click="closeDrawerAlert" title="关闭">✕</button>
                <div class="drawer-alert-icon">🎨</div>
                <div class="drawer-alert-text">轮到你了！</div>
                <div class="drawer-alert-sub">你是画师，开始画画吧</div>
              </div>
            </div>
          </Transition>
          <div class="game-info-row">
            <span v-if="gameStore.myRole === 'drawer'" class="role-badge drawer-badge">
              <span class="role-icon">🖌️</span>
              <span class="role-text">你在画画</span>
            </span>
            <span v-else-if="gameStore.myRole === 'guesser'" class="role-badge guesser-badge">
              <span class="role-icon">💡</span>
              <span class="role-text">你在猜题</span>
            </span>
            <span v-else class="role-badge spectator-badge">
              <span class="role-icon">👀</span>
              <span class="role-text">观战中</span>
            </span>

            <template v-if="gameStore.myRole === 'drawer'">
              <span class="info-word">{{ gameStore.currentWord }}</span>
            </template>
            <template v-else>
              <span class="info-hint">{{ gameStore.wordPlaceholders || '?' }}</span>
              <span class="info-drawer">· 画师：{{ gameStore.drawerNickname }}</span>
              <button
                v-if="gameStore.myRole === 'guesser'"
                class="btn-like-during"
                :class="{ liked: likedThisRound }"
                @click="handleLikeDrawer"
                :disabled="likedThisRound"
                :title="likedThisRound ? '已点赞' : '给画师点赞'"
              >{{ likedThisRound ? '❤️' : '👍' }}</button>
            </template>

            <span v-if="gameStore.showCategoryHint" class="info-category">
              🏷️{{ gameStore.wordCategory }}
            </span>
          </div>


          <GameCanvas :readonly="gameStore.myRole !== 'drawer'" />

          <div v-if="gameStore.myRole === 'drawer'" class="toolbar-container">
            <Toolbar />
          </div>

          <div class="inline-chat-wrap">
            <div class="inline-chat-body">
              <ChatPanel />
            </div>
          </div>

          <Transition name="pop">
            <div v-if="gameStore.hasGuessedCorrectly" class="guessed-notice">
              <span>🎉 猜对了！</span>
            </div>
          </Transition>

          <div v-if="gameStore.recentGuessers.length > 0 && !gameStore.hasGuessedCorrectly" class="guesser-list">
            <div
              v-for="(g, i) in gameStore.recentGuessers"
              :key="g.playerId"
              class="guesser-bubble"
              :style="{ animationDelay: `${i * GUESSER_STAGGER_DELAY_S}s` }"
            >
              ✅ {{ g.nickname }}
            </div>
          </div>

          <Transition name="fade">
            <div v-if="showScoreboard" class="scoreboard-overlay" @click.self="showScoreboard = false">
              <div class="scoreboard-modal">
                <div class="scoreboard-modal-header">
                  <span>🏆 积分榜</span>
                  <button class="scoreboard-modal-close" @click.stop="showScoreboard = false">✕</button>
                </div>
                <Scoreboard :scores="gameStore.scores" />
              </div>
            </div>
          </Transition>
        </div>

        <div v-else-if="gameStore.state === 'round_end'" class="round-transition">
          <div class="rt-content">
            <div class="rt-piece" :style="{ animationDelay: '0s' }">
              <div class="rt-round-label">第 {{ transitionRound }} / {{ transitionTotalRounds }} 轮</div>
            </div>
            <div class="rt-piece" :style="{ animationDelay: '0.25s' }">
              <div class="rt-answer-label">答案是</div>
              <div class="rt-word">{{ transitionWord }}</div>
            </div>
            <div class="rt-piece" :style="{ animationDelay: '0.6s' }">
              <div class="rt-reason-tag">{{ reasonText }}</div>
            </div>
            <div class="rt-piece rt-next-row" :style="{ animationDelay: '1.1s' }">
              <div class="rt-next-label">下一位画师</div>
              <div class="rt-next-name">{{ transitionNextDrawer }}</div>
            </div>
            <div class="rt-piece" :style="{ animationDelay: '1.8s' }">
              <div class="rt-countdown">
                <span class="rt-dot"></span>
                <span>准备中</span>
                <span class="rt-dot"></span>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="gameStore.state === 'game_over'" class="game-over">
          <div class="trophy-icon">🏆</div>
          <h2>游戏结束</h2>
          <div class="winner-section" v-if="gameStore.scores.length > 0">
            <span class="winner-label">获胜者</span>
            <span class="winner-name">{{ gameStore.scores[0].nickname }}</span>
          </div>
          <div class="final-scores">
            <h3>最终排名</h3>
            <Scoreboard :scores="gameStore.scores" />
          </div>
          <div class="game-over-actions">
            <button v-if="roomStore.isOwner" class="btn-restart" @click="handleRestartGame">重新开始</button>
            <button v-if="roomStore.isOwner" class="btn-word-config" @click="showWordConfigGameover = true">📚 词库概览</button>
            <button class="btn-leave-game" @click="handleLeave">离开游戏</button>
          </div>
        </div>

        <WordConfigModal :show="showWordConfigGameover" @close="showWordConfigGameover = false" />
      </div>

      <aside class="sidebar sidebar-right">
        <ChatPanel />
      </aside>
    </main>

    <Transition name="fade">
      <div v-if="showLeaveConfirm" class="leave-confirm-overlay" @click.self="showLeaveConfirm = false">
        <div class="leave-confirm-box">
          <div class="leave-confirm-icon">🛑</div>
          <div class="leave-confirm-text">确认离开游戏？</div>
          <div class="leave-confirm-desc">离开后需要重新加入房间</div>
          <div class="leave-confirm-actions">
            <button class="btn-confirm-cancel" @click="showLeaveConfirm = false">取消</button>
            <button class="btn-confirm-leave" @click="doLeave">确认离开</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <p v-if="toastError" class="toast toast-error">{{ toastError }}</p>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRoomStore } from '@/stores/room'
import { useDrawGameStore } from '@/stores/drawGame'
import { connectSocket, disconnectSocket, getSocket, connectionState, reconnectAttempt } from '@/composables/useSocket'
import { CLIENT_EVENTS, DRAW_MIN_PLAYERS, TOAST_ERROR_MS, SPECTATOR_NOTICE_MS, GUESSER_STAGGER_DELAY_S } from '@draw-and-guess/shared'

import Timer from '@/components/Timer.vue'
import Scoreboard from '@/components/Scoreboard.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import GameCanvas from '@/components/GameCanvas.vue'
import Toolbar from '@/components/Toolbar.vue'
import WordConfigModal from '@/components/WordConfigModal.vue'
import WordSelectModal from '@/components/WordSelectModal.vue'

const route = useRoute()
const router = useRouter()
const roomStore = useRoomStore()
const gameStore = useDrawGameStore()

const roomName = computed(() => route.params.roomName as string)
const drawerCount = computed(() => roomStore.players.filter(p => !p.isGuessOnly).length)
const showScoreboard = ref(false)
const showLeaveConfirm = ref(false)
const showDrawerAlert = ref(false)

// 手势事件监听引用（用于清理）
type GestureHandler = (event: Event) => void
let gestureCleanup: Array<{ el: EventTarget; type: string; fn: GestureHandler }> = []
function addGestureGuard(el: EventTarget, type: string, fn: GestureHandler) {
  el.addEventListener(type, fn, { passive: false })
  gestureCleanup.push({ el, type, fn })
}

// 中途加入提示（房间已开始游戏，当前轮仅观战）
const showSpectatorNotice = ref(false)
const likedThisRound = ref(false)

const transitionWord = computed(() => gameStore.transitionData?.word ?? '')
const transitionRound = computed(() => gameStore.transitionData?.round ?? gameStore.currentRound)
const transitionTotalRounds = computed(() => gameStore.transitionData?.totalRounds ?? gameStore.totalRounds)
const transitionNextDrawer = computed(() => gameStore.transitionData?.nextDrawer?.nickname ?? '')

const reasonText = computed(() => {
  const reason = gameStore.transitionData?.reason
  if (reason === 'timeout') return '时间到'
  if (reason === 'all_guessed') return '全部猜对'
  return '本轮结束'
})

function closeDrawerAlert() {
  showDrawerAlert.value = false
  document.title = 'Oiiiii早春'
}

watch(() => gameStore.myRole, (role) => {
  if (role === 'drawer') {
    showDrawerAlert.value = true
    document.title = '🎨 轮到你了！ - Oiiiii早春'
  } else {
    closeDrawerAlert()
  }
})

// 新轮次开始时重置 alert 和点赞状态
watch(() => gameStore.currentRound, () => {
  likedThisRound.value = false
  if (gameStore.myRole === 'drawer' && gameStore.state === 'playing') {
    showDrawerAlert.value = true
    document.title = '🎨 轮到你了！ - Oiiiii早春'
  }
})


onMounted(() => {
  document.body.style.overflow = 'hidden'
  const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin

  roomStore.setupSocketListeners()
  gameStore.setupSocketListeners()

  connectSocket(serverUrl)

  // 兜底：请求当前游戏状态（ROUND_START 在注册前到达时恢复）
  getSocket()?.emit(CLIENT_EVENTS.REQUEST_GAME_STATE)

  // 房间已开始游戏，立即显示游戏界面，不等 GAME_STATE_SNAPSHOT
  if (roomStore.room?.state === 'playing') {
    gameStore.state = 'playing'
    if (roomStore.isSpectator) {
      gameStore.myRole = 'spectator'
      showSpectatorNotice.value = true
      setTimeout(() => { showSpectatorNotice.value = false }, SPECTATOR_NOTICE_MS)
    }
    // 非观战者不设置 myRole，由 GAME_STATE_SNAPSHOT 决定
  }

  // 阻止 iOS Safari 双指缩放和手势
  const preventPinch = (e: Event) => { if ((e as TouchEvent).touches.length > 1) e.preventDefault() }
  const preventGesture = (e: Event) => e.preventDefault()
  addGestureGuard(document, 'gesturestart', preventGesture)
  addGestureGuard(document, 'gesturechange', preventGesture)
  addGestureGuard(document, 'touchstart', preventPinch)

  // 阻止浏览器返回手势
  window.history.pushState(null, '', window.location.href)
  const onPop = () => {
    showLeaveConfirm.value = true
    window.history.replaceState(null, '', window.location.href)
  }
  window.addEventListener('popstate', onPop)
  ;(window as unknown as { __popstateHandler?: () => void }).__popstateHandler = onPop

  // 阻止页面刷新/关闭
  const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
  window.addEventListener('beforeunload', onBeforeUnload)
  ;(window as unknown as { __beforeunloadHandler?: (e: BeforeUnloadEvent) => void }).__beforeunloadHandler = onBeforeUnload
})

onUnmounted(() => {
  document.body.style.overflow = ''
  // 清理手势监听
  for (const { el, type, fn } of gestureCleanup) {
    el.removeEventListener(type, fn)
  }
  gestureCleanup = []
  // 清理 popstate
  const win = window as unknown as { __popstateHandler?: () => void; __beforeunloadHandler?: (e: BeforeUnloadEvent) => void }
  const onPop = win.__popstateHandler
  if (onPop) window.removeEventListener('popstate', onPop)
  const onBeforeUnload = win.__beforeunloadHandler
  if (onBeforeUnload) window.removeEventListener('beforeunload', onBeforeUnload)
  gameStore.teardownSocketListeners()
  gameStore.resetGame()
})

function handleLeave() {
  showLeaveConfirm.value = true
}

function doLeave() {
  showLeaveConfirm.value = false
  roomStore.leaveRoom()
  gameStore.resetGame()
  disconnectSocket()
  router.push('/')
}

function handleRestartGame() {
  gameStore.resetGame()
  roomStore.startGame()
}

function handleStartGame() {
  roomStore.startGame()
}

function handleWordSelect(word: string) {
  gameStore.selectWord(word)
}

function handleLikeDrawer() {
  if (likedThisRound.value) return
  likedThisRound.value = true
  gameStore.likeDrawer()
}

const showWordConfigGameover = ref(false)
const toastError = ref<string | null>(null)

watch(() => roomStore.error, (err) => {
  if (err) {
    toastError.value = err
    setTimeout(() => toastError.value = null, TOAST_ERROR_MS)
  }
})

</script>

<style scoped>
.game-page {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: none;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

.connection-banner {
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 100; padding: 8px 16px;
  text-align: center; font-size: 14px;
  font-weight: 500;
}
.connection-banner.disconnected {
  background: #fde8e5; color: #c0392b;
}
.connection-banner.reconnecting {
  background: #fef3d5; color: #b8860b;
}
.connection-banner.failed {
  background: #fde8e5; color: #c0392b;
}
.connection-banner.failed button {
  background: none; border: 1px solid currentColor;
  border-radius: 4px; color: inherit;
  cursor: pointer; padding: 0 8px; margin-left: 4px;
}
.slide-down-enter-active, .slide-down-leave-active {
  transition: transform 0.3s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  transform: translateY(-100%);
}

/* ─── Header ─── */
.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1.25rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-light);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
}

.header-left,
.header-center,
.header-right {
  display: flex;
  align-items: center;
}

.header-center {
  flex: 1;
  justify-content: center;
}

.room-badge {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  background: var(--color-accent-pale);
  border-radius: var(--radius-full);
  font-size: 0.8rem;
}

.badge-icon { font-size: 0.9rem; }

.badge-code {
  font-family: var(--font-number);
  font-weight: 700;
  color: var(--color-primary);
  letter-spacing: 0.1em;
}

.game-type-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-primary-dark);
  margin-left: 0.6rem;
  white-space: nowrap;
}

.btn-leave {
  padding: 0.4rem 1rem;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: var(--transition);
}

.btn-leave:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
  background: var(--color-bg);
}

/* ─── Main layout ─── */
.game-content {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
}

.sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.sidebar :deep(*) {
  min-height: 0;
}

/* 桌面端隐藏内嵌聊天（右侧栏已包含聊天） */
.inline-chat-wrap {
  display: none;
}

.game-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.playing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}

.waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--color-text-muted);
  gap: 0.75rem;
}

.waiting-icon {
  font-size: 2.5rem;
  animation: bounce 2s ease-in-out infinite;
}

.btn-start-game {
  margin-top: 0.5rem;
  padding: 0.7rem 2rem;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
}

.btn-start-game:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(232, 133, 108, 0.3);
}

.btn-start-game:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.game-info-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  flex-shrink: 0;
}

.info-word {
  font-family: var(--font-body);
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--color-primary);
  letter-spacing: 0.12em;
  line-height: 1.2;
  flex-shrink: 0;
  padding: 0.15rem 0.6rem;
  background: linear-gradient(135deg, var(--color-accent-pale) 0%, var(--color-surface) 100%);
  border-radius: var(--radius-md);
  border: 1.5px solid var(--color-accent);
}

.info-hint {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text);
  flex-shrink: 0;
}

.info-drawer {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.info-category {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--color-accent);
  background: var(--color-gold-bg);
  padding: 0.1rem 0.5rem;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  white-space: nowrap;
}

.role-badge {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 1rem;
  border-radius: var(--radius-full);
  font-size: 0.82rem;
  font-weight: 600;
}

.role-icon { font-size: 1rem; }
.role-text { font-size: 0.82rem; }

.drawer-badge {
  background: var(--color-accent-pale);
  color: var(--color-accent);
}

.guesser-badge {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.spectator-badge {
  background: var(--color-border-light);
  color: var(--color-text-secondary);
}

.toolbar-container {
  width: 100%;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}

.guessed-notice {
  padding: 0.4rem 1.25rem;
  background: var(--color-success-bg);
  color: var(--color-success);
  border-radius: var(--radius-full);
  font-weight: 600;
  font-size: 0.85rem;
  border: 1px solid rgba(126, 184, 122, 0.3);
  flex-shrink: 0;
}

/* ─── Round Transition ─── */
.round-transition {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.rt-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.rt-piece {
  opacity: 0;
  transform: translateY(16px);
  animation: rtFadeIn 0.35s ease-out forwards;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}

@keyframes rtFadeIn {
  to { opacity: 1; transform: translateY(0); }
}

.rt-round-label {
  font-family: var(--font-number);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-primary);
}

.rt-answer-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.rt-word {
  font-family: var(--font-body);
  font-size: 2.4rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1.3;
  padding: 0.4rem 2rem;
  background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-accent-pale) 100%);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md), 0 0 0 1px rgba(244, 162, 97, 0.15);
  border: 2px solid var(--color-accent);
  animation: rtWordPulse 2.5s ease-in-out infinite;
  color: var(--color-text);
}

@keyframes rtWordPulse {
  0%, 100% {
    box-shadow: var(--shadow-md), 0 0 0 1px rgba(244, 162, 97, 0.15);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(244, 162, 97, 0.12), 0 6px 24px rgba(244, 162, 97, 0.18);
    transform: scale(1.02);
  }
}

.rt-reason-tag {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  padding: 0.2rem 1rem;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-light);
}

.rt-next-row {
  gap: 0.15rem;
}

.rt-next-label {
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.rt-next-name {
  font-family: var(--font-title);
  font-size: 1.4rem;
  color: var(--color-primary-dark);
  font-weight: 600;
}

.rt-countdown {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  animation: rtPulse 1.2s ease-in-out infinite;
}

.btn-like-during {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  transition: var(--transition);
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
}

.btn-like-during:hover:not(:disabled) {
  background: var(--color-accent-pale);
  transform: scale(1.2);
}

.btn-like-during.liked {
  cursor: default;
  opacity: 1;
  animation: likePop 0.3s ease-out;
}

.btn-like-during:disabled {
  cursor: default;
}

@keyframes likePop {
  0% { transform: scale(1); }
  50% { transform: scale(1.4); }
  100% { transform: scale(1); }
}

.rt-dot {
  display: inline-block;
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 50%;
  background: var(--color-text-muted);
}

@keyframes rtPulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.game-over {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem 1.5rem;
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border-light);
  width: 100%;
  max-width: 400px;
  animation: popIn 0.4s ease-out;
}

.trophy-icon { font-size: 3rem; }

.game-over h2 {
  font-family: var(--font-title);
  font-size: 1.6rem;
  color: var(--color-text);
}

.winner-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.5rem 1.5rem;
  background: var(--color-gold-bg);
  border-radius: var(--radius-md);
}

.winner-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.winner-name {
  font-family: var(--font-title);
  font-size: 1.3rem;
  color: var(--color-gold);
}

.final-scores { width: 100%; }

.final-scores h3 {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.5rem;
  text-align: center;
}

.game-over-actions {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.btn-restart {
  flex: 1;
  padding: 0.6rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-gold));
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
}

.btn-restart:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(244, 162, 97, 0.3);
}

.btn-leave-game {
  padding: 0.6rem 1.25rem;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: var(--transition);
}

.btn-leave-game:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

/* ─── Drawer Alert ─── */
.drawer-alert {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 55, 40, 0.25);
  backdrop-filter: blur(3px);
}

.drawer-alert-box {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1.5rem 2.5rem;
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  border: 2px solid var(--color-accent);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

.drawer-alert-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  transition: var(--transition);
  line-height: 1;
}

.drawer-alert-close:hover {
  background: var(--color-border-light);
  color: var(--color-text);
}

.drawer-alert-icon {
  font-size: 2.5rem;
  animation: bounce 1s ease-in-out infinite alternate;
}

.drawer-alert-text {
  font-family: var(--font-title);
  font-size: 1.4rem;
  color: var(--color-accent);
  font-weight: 700;
}

.drawer-alert-sub {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* ─── Scoreboard Overlay ─── */
.scoreboard-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
}

.scoreboard-modal {
  width: 85%;
  max-width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  animation: popIn 0.3s ease-out;
  position: relative;
}

.scoreboard-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border-light);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text);
  flex-shrink: 0;
}

.scoreboard-modal-close {
  background: transparent;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  line-height: 1;
}

.scoreboard-modal-close:hover {
  background: var(--color-border-light);
  color: var(--color-text);
}

.scoreboard-modal :deep(.scoreboard-header) {
  display: none;
}

.scoreboard-modal :deep(.scoreboard) {
  border: none;
  box-shadow: none;
  border-radius: 0;
}

.btn-trophy {
  display: none;
  background: transparent;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem 0.4rem;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  line-height: 1;
}

.btn-trophy:hover {
  background: var(--color-border-light);
}

.btn-trophy:active {
  transform: scale(0.9);
}

/* ─── Leave Confirm ─── */
.leave-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(3px);
}

.leave-confirm-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 2rem;
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border-light);
  animation: popIn 0.3s ease-out;
  max-width: 320px;
  width: 85%;
}

.leave-confirm-icon {
  font-size: 2rem;
}

.leave-confirm-text {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-text);
}

.leave-confirm-desc {
  font-size: 0.82rem;
  color: var(--color-text-muted);
  text-align: center;
}

.leave-confirm-actions {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.3rem;
  width: 100%;
}

.btn-confirm-cancel,
.btn-confirm-leave {
  flex: 1;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  border: none;
}

.btn-confirm-cancel {
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 2px solid var(--color-border);
}

.btn-confirm-cancel:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn-confirm-leave {
  background: #e74c3c;
  color: #fff;
}

.btn-confirm-leave:hover {
  background: #c0392b;
  box-shadow: 0 2px 12px rgba(231, 76, 60, 0.3);
}

/* ─── Toasts ─── */
.toast {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.6rem 1.25rem;
  border-radius: var(--radius-full);
  font-size: 0.85rem;
  font-weight: 500;
  z-index: 200;
  white-space: nowrap;
  box-shadow: var(--shadow-md);
}

.toast-success {
  background: var(--color-success-bg);
  color: var(--color-success);
  border: 1px solid rgba(126, 184, 122, 0.3);
}

.toast-error {
  background: var(--color-danger-light);
  color: var(--color-danger);
  border: 1px solid rgba(217, 117, 107, 0.2);
}

/* ─── Animations ─── */
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: var(--shadow-lg); }
  50% { box-shadow: 0 0 0 4px rgba(244, 162, 97, 0.15), 0 8px 32px rgba(244, 162, 97, 0.2); }
}

@keyframes popIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

.pop-enter-active { animation: popIn 0.3s ease-out; }
.pop-leave-active { animation: popIn 0.3s ease-in reverse; }



/* ─── Spectator Notice ─── */
.spectator-notice {
  padding: 0.35rem 1.25rem;
  background: var(--color-accent-pale);
  color: var(--color-accent);
  border-radius: var(--radius-full);
  font-size: 0.82rem;
  font-weight: 600;
  border: 1px solid rgba(244, 162, 97, 0.2);
  text-align: center;
  flex-shrink: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.guesser-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
  flex-shrink: 0;
}

.guesser-bubble {
  padding: 0.15rem 0.7rem;
  background: var(--color-success-bg);
  border: 1px solid rgba(126, 184, 122, 0.3);
  border-radius: var(--radius-full);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-success);
  animation: popIn 0.35s ease-out both;
  white-space: nowrap;
}

/* ─── Tablet (768px–1024px) ─── */
@media (max-width: 1024px) {
  .game-content {
    padding: 0.5rem;
    gap: 0.5rem;
  }

  .sidebar {
    width: 200px;
  }
}

/* ─── Mobile (< 768px) ─── */
@media (max-width: 767px) {
  .game-page {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    height: auto;
  }

  .game-header {
    padding: 0.5rem 0.6rem 0.5rem 0.6rem;
    min-height: 2.8rem;
  }

  .room-badge {
    font-size: 0.7rem;
    padding: 0.25rem 0.5rem;
  }

  .badge-code {
    font-size: 0.75rem;
  }

  .btn-leave {
    padding: 0.3rem 0.75rem;
    font-size: 0.75rem;
  }

  .game-content {
    flex-direction: column;
    padding: 0.4rem;
    gap: 0.4rem;
    overflow: hidden;
  }

  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    width: 85vw;
    max-width: 300px;
    z-index: 50;
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    padding: env(safe-area-inset-top) 0.5rem env(safe-area-inset-bottom);
    display: flex;
    flex-direction: column;
  }

  .sidebar-left {
    left: 0;
    transform: translateX(-110%);
  }

  .sidebar-left.open {
    transform: translateX(0);
  }

  .sidebar-right {
    display: none;
  }

  .sidebar-right.open {
    gap: 0;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    justify-content: flex-start;
    padding-bottom: 0;
  }

  .game-area {
    justify-content: flex-start;
    align-items: stretch;
  }

  .btn-trophy {
    display: block;
  }

  .toolbar-container {
    max-width: 100%;
    flex-shrink: 0;
  }

  .word-card {
    padding: 0.15rem 0.8rem;
    flex-shrink: 0;
    flex-direction: row;
    gap: 0.4rem;
    border-radius: var(--radius-full);
  }

  .guesser-bubble {
    font-size: 0.7rem;
    padding: 0.1rem 0.5rem;
  }

  .role-badge {
    padding: 0.15rem 0.35rem;
  }

  .role-icon { font-size: 0.8rem; }
  .role-text { font-size: 0.7rem; }

  .btn-like-during {
    width: 24px;
    height: 24px;
    font-size: 0.85rem;
  }

  .game-info-row {
    gap: 0.3rem;
    padding: 0.3rem 0.5rem;
    flex-wrap: nowrap;
    overflow-x: auto;
  }

  .info-word {
    font-size: 1rem;
  }

  .info-hint {
    font-size: 0.78rem;
  }

  .info-drawer {
    font-size: 0.7rem;
  }

  .info-category {
    font-size: 0.72rem;
    padding: 0.15rem 0.55rem;
  }

  .game-over {
    padding: 1rem;
    margin: 0 auto;
  }

  .game-over h2 {
    font-size: 1.3rem;
  }

  /* ─── Round transition mobile ─── */
  .rt-round-label { font-size: 1.1rem; }
  .rt-word { font-size: 1.4rem; padding: 0.2rem 1rem; }
  .rt-next-name { font-size: 1.1rem; }
  .rt-reason-tag { font-size: 0.75rem; }
  .rt-countdown { font-size: 0.78rem; }
  .inline-chat-wrap {
    width: 100%;
    flex: 1;
    min-height: 120px;
    touch-action: pan-y;
    display: flex;
    flex-direction: column;
    border-top: 2px solid var(--color-border-light);
    background: var(--color-surface);
    box-shadow: 0 -2px 12px rgba(74, 55, 40, 0.06);
    position: relative;
  }

  .inline-chat-wrap::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--color-accent-pale), var(--color-accent), var(--color-primary));
    opacity: 0.5;
    pointer-events: none;
  }

  .inline-chat-wrap.collapsed {
    flex: 0 0 auto;
    max-height: none;
    border-top: none;
  }

  .inline-chat-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    flex-shrink: 0;
    min-height: 1.6rem;
    border-top: 1px solid var(--color-border-light);
  }

  .inline-chat-title {
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .inline-chat-preview {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inline-chat-preview-text {
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .inline-chat-arrow {
    font-size: 0.55rem;
    color: var(--color-text-muted);
    transition: transform 0.2s;
    flex-shrink: 0;
  }

  .inline-chat-arrow.open {
    transform: rotate(180deg);
  }

  .inline-chat-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .inline-chat-body :deep(.chat-panel) {
    border: none;
    border-radius: 0;
    box-shadow: none;
    flex: 1;
    min-height: 0;
    height: auto;
  }

  .inline-chat-body :deep(.chat-header) {
    display: none;
  }

  .inline-chat-body :deep(.messages) {
    flex: 1;
    min-height: 0;
    padding: 0.25rem 0.5rem;
  }

  .inline-chat-body :deep(.input-row) {
    padding: 0.35rem 0.5rem;
    border-top: 1px solid var(--color-border-light);
  }
}

.btn-word-config {
  padding: 0.6rem 1rem;
  background: var(--color-bg-warm);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.82rem;
  cursor: pointer;
  transition: var(--transition);
  white-space: nowrap;
}

.btn-word-config:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
