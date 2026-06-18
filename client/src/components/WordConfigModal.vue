<template>
  <Transition name="fade">
    <div v-if="show" class="word-config-overlay" @click.self="$emit('close')">
      <div class="word-config-modal">
        <div class="word-config-modal-header">
          <span>📚 词库</span>
          <button class="word-config-modal-close" @click="$emit('close')">✕</button>
        </div>
        <div class="word-config-modal-body">
          <div class="info-row">
            <span class="info-icon">📦</span>
            <span>系统词汇: <strong>{{ systemCount.toLocaleString() }}</strong> 个</span>
          </div>
          <div class="info-row">
            <span class="info-icon">✏️</span>
            <span>玩家贡献: <strong>{{ contributedCount }}</strong> 个</span>
          </div>
          <div class="info-divider" />
          <div class="info-merged">
            <span class="merged-icon">✅</span>
            <span>已自动合并打乱，共 <strong>{{ totalCount }}</strong> 个词汇候选项</span>
          </div>
          <div class="info-hint">每轮随机从中抽取 5 个词供画师选择</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  show: boolean
}>()

defineEmits<{
  close: []
}>()

const systemCount = ref(0)
const contributedCount = ref(0)

const totalCount = computed(() => systemCount.value + contributedCount.value)

watch(() => props.show, async (val) => {
  if (val) {
    await fetchCounts()
  }
})

async function fetchCounts() {
  try {
    const res = await fetch('/api/words')
    const data = await res.json()
    systemCount.value = data?.systemTotal ?? 1000
    contributedCount.value = data?.words?.length ?? 0
  } catch {
    systemCount.value = 1000
    contributedCount.value = 0
  }
}
</script>

<style scoped>
.word-config-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.word-config-modal {
  background: #fff;
  border-radius: 14px;
  width: min(380px, 90vw);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
}

.word-config-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--color-border-light);
  font-weight: 600;
  font-size: 0.95rem;
}

.word-config-modal-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.2rem;
}

.word-config-modal-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: var(--color-text);
}

.info-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.info-divider {
  height: 1px;
  background: var(--color-border-light);
  margin: 0.15rem 0;
}

.info-merged {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: var(--color-text);
  padding: 0.5rem 0.6rem;
  background: var(--color-accent-pale);
  border-radius: 8px;
}

.merged-icon {
  font-size: 0.9rem;
  flex-shrink: 0;
}

.info-hint {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  text-align: center;
  padding-top: 0.15rem;
}
</style>
