<template>
  <div class="chat-panel">
    <div class="chat-header">
      <span class="chat-icon">💬</span>
      <span>聊天</span>
    </div>

    <div ref="messagesRef" class="messages">
      <div
        v-for="msg in gameStore.chatMessages"
        :key="msg.id"
        :class="['message', {
          'is-system': msg.isSystem,
          'is-wrong-guess': msg.isWrongGuess,
        }]"
      >
        <template v-if="msg.isSystem">
          <span class="sys-text">{{ msg.text }}</span>
        </template>
        <template v-else-if="msg.isWrongGuess">
          <span class="msg-icon">🔍</span>
          <span class="msg-nickname">{{ msg.nickname }}</span>
          <span class="msg-text">{{ msg.text }}</span>
        </template>
        <template v-else>
          <span class="msg-nickname">{{ msg.nickname }}</span>
          <span class="msg-text">{{ msg.text }}</span>
        </template>
        <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
      </div>
    </div>

    <div class="reactions-row" v-if="!inputDisabled">
      <button
        v-for="emoji in REACTIONS"
        :key="emoji"
        class="reaction-btn"
        @click="sendReaction(emoji)"
        :title="emoji"
      >{{ emoji }}</button>
    </div>

    <div class="input-row">
      <div class="input-wrap">
        <input
          v-model="inputText"
          type="text"
          :placeholder="inputPlaceholder"
          :disabled="inputDisabled"
          :maxlength="CHAT_MESSAGE_MAX_LENGTH"
          @keyup.enter="handleSend"
        />
      </div>
      <button @click="handleSend" :disabled="inputDisabled">发送</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { CHAT_MESSAGE_MAX_LENGTH } from '@draw-and-guess/shared'
import { useDrawGameStore } from '@/stores/drawGame'

const REACTIONS = ['😂', '🔥', '👏', '😭', '💀', '🎨']

const gameStore = useDrawGameStore()
const inputText = ref('')
const messagesRef = ref<HTMLElement | null>(null)
let intersectionObserver: IntersectionObserver | null = null

const inputPlaceholder = computed(() => {
  if (gameStore.myRole === 'drawer') return '🎨 画师专注创作中...'
  if (gameStore.myRole === 'spectator') return '👀 观战中...'
  if (gameStore.myRole === 'guesser' && !gameStore.hasGuessedCorrectly) return '输入答案或发送消息...'
  return '发送消息...'
})

const inputDisabled = computed(() => {
  return gameStore.myRole === 'drawer' || gameStore.myRole === 'spectator' || gameStore.hasGuessedCorrectly
})

function handleSend() {
  if (!inputText.value.trim() || inputDisabled.value) return
  gameStore.sendChat(inputText.value.trim())
  inputText.value = ''
}

function sendReaction(emoji: string) {
  if (inputDisabled.value) return
  gameStore.sendChat(emoji)
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

function scrollToBottom() {
  if (!messagesRef.value) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  })
}

onMounted(() => {
  nextTick(scrollToBottom)

  if (messagesRef.value) {
    intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          scrollToBottom()
        }
      }
    })
    intersectionObserver.observe(messagesRef.value)
  }
})

onUnmounted(() => {
  intersectionObserver?.disconnect()
  intersectionObserver = null
})

watch(() => gameStore.chatMessages.length, () => {
  scrollToBottom()
})
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border-light);
  height: 100%;
  min-height: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border-light);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text);
  flex-shrink: 0;
}

.chat-icon {
  font-size: 1rem;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow-anchor: auto;
}

.messages::-webkit-scrollbar {
  width: 6px;
}
.messages::-webkit-scrollbar-track {
  background: transparent;
}
.messages::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.message {
  padding: 0.4rem 0.65rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  line-height: 1.4;
  background: var(--color-bg);
  flex-shrink: 0;
}

.message.is-system {
  background: transparent;
  text-align: center;
  padding: 0.3rem 0.5rem;
}

.message.is-wrong-guess {
  background: var(--color-bg-warm, #f8f2ec);
  border-left: 3px solid var(--color-text-muted);
}

.sys-text {
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-style: italic;
}

.sys-text::before {
  content: '📢 ';
}

.msg-icon {
  margin-right: 0.25rem;
  font-size: 0.8rem;
}

.msg-nickname {
  font-weight: 600;
  color: var(--color-primary);
  margin-right: 0.4rem;
}

.msg-text {
  color: var(--color-text);
}

.msg-time {
  display: block;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  margin-top: 0.15rem;
  font-family: var(--font-number);
}

.reactions-row {
  display: flex;
  gap: 0.25rem;
  padding: 0.3rem 0.75rem 0;
  flex-shrink: 0;
}

.reaction-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 1.1rem;
  transition: var(--transition);
  line-height: 1;
  padding: 0;
}

.reaction-btn:hover {
  transform: scale(1.2);
  background: var(--color-bg-warm);
  border-color: var(--color-accent);
}

.reaction-btn:active {
  transform: scale(0.9);
}

.input-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-top: 1px solid var(--color-border-light);
  flex-shrink: 0;
}

.input-wrap {
  flex: 1;
}

.input-row input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: var(--color-bg);
  color: var(--color-text);
  transition: var(--transition);
}

.input-row input:focus {
  outline: none;
  border-color: var(--color-primary);
  background: var(--color-surface);
  box-shadow: var(--shadow-glow);
}

.input-row input::placeholder {
  color: var(--color-text-muted);
}

.input-row input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--color-border-light);
}

.input-row button {
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  transition: var(--transition);
  white-space: nowrap;
}

.input-row button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(232, 133, 108, 0.3);
}

.input-row button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 767px) {
  .chat-panel {
    min-height: 200px;
    height: 100%;
    max-height: calc(100vh - 2rem);
    border-radius: var(--radius-md);
  }

  .chat-header {
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
  }

  .messages {
    padding: 0.5rem;
  }

  .message {
    font-size: 0.8rem;
    padding: 0.35rem 0.5rem;
  }

  .reactions-row {
    padding: 0.2rem 0.6rem 0;
    gap: 0.2rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .reactions-row::-webkit-scrollbar {
    display: none;
  }

  .reaction-btn {
    width: 30px;
    height: 30px;
    font-size: 0.95rem;
    flex-shrink: 0;
  }

  .input-row {
    padding: 0.5rem 0.6rem;
  }

  .input-row input {
    font-size: 0.8rem;
    padding: 0.4rem 0.6rem;
  }

  .input-row button {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
  }
}
</style>
