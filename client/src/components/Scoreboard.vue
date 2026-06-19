<template>
  <div class="scoreboard">
    <div class="scoreboard-header">
      <span class="trophy-icon">🏆</span>
      <span>积分榜</span>
    </div>
    <ul class="score-list">
      <li
        v-for="entry in sortedScores"
        :key="entry.playerId"
        :class="['score-item', { first: entry.rank === 1, second: entry.rank === 2, third: entry.rank === 3 }]"
      >
        <span class="rank-medal">
          <template v-if="entry.rank === 1">🥇</template>
          <template v-else-if="entry.rank === 2">🥈</template>
          <template v-else-if="entry.rank === 3">🥉</template>
          <template v-else>{{ entry.rank }}</template>
        </span>
        <span class="nickname">
          {{ entry.nickname }}
          <span v-if="entry.isGuessOnly" class="guess-only-badge" title="只猜不画">🙊</span>
        </span>
        <span class="score">{{ entry.score }}</span>
      </li>
    </ul>
    <div v-if="sortedScores.length === 0" class="empty">
      暂无积分
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerScore } from '@draw-and-guess/shared'

const props = defineProps<{
  scores: PlayerScore[]
}>()

const sortedScores = computed(() => {
  return [...props.scores].sort((a, b) => a.rank - b.rank)
})
</script>

<style scoped>
.scoreboard {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border-light);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.scoreboard-header {
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

.trophy-icon {
  font-size: 1rem;
}

.score-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 0.3rem;
}

.score-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  transition: var(--transition);
}

.score-item.first {
  background: var(--color-gold-bg);
}

.score-item.second {
  background: rgba(192, 192, 192, 0.15);
}

.score-item.third {
  background: rgba(205, 127, 50, 0.1);
}

.rank-medal {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  flex-shrink: 0;
}

.nickname {
  flex: 1;
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guess-only-badge {
  font-size: 0.7rem;
  margin-left: 0.2rem;
  vertical-align: middle;
}

.score {
  font-family: var(--font-number);
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--color-primary);
}

.empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 2rem 1rem;
  font-size: 0.85rem;
}

@media (max-width: 767px) {
  .scoreboard {
    border-radius: var(--radius-md);
    height: 100%;
  }

  .scoreboard-header {
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
  }

  .score-list {
    padding: 0.35rem;
    gap: 0.2rem;
  }

  .score-item {
    padding: 0.35rem 0.5rem;
  }

  .nickname {
    font-size: 0.8rem;
  }

  .score {
    font-size: 0.85rem;
  }
}
</style>
