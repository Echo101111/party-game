<template>
  <div ref="containerRef" class="game-canvas">
    <canvas ref="canvasRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { fabric } from 'fabric'
import { useCanvasStore } from '@/stores/canvas'
import { useDrawGameStore } from '@/stores/drawGame'
import { useRoomStore } from '@/stores/room'
import { EMIT_INTERVAL_MS, ERASER_COLOR, ERASER_WIDTH_MULTIPLIER, STROKE_MIN_POINTS, STROKE_SIMPLIFY_TOLERANCE, CANVAS_ASPECT_RATIO, BREAKPOINT_MOBILE, CANVAS_BG_COLOR } from '@draw-and-guess/shared'
import type { Point } from '@draw-and-guess/shared'

type FabricCanvas = InstanceType<typeof fabric.Canvas>
type FabricPath = InstanceType<typeof fabric.Path>
type FabricCircle = InstanceType<typeof fabric.Circle>
type FabricObject = FabricPath | FabricCircle

const props = defineProps<{
  readonly?: boolean
}>()

const canvasStore = useCanvasStore()
const gameStore = useDrawGameStore()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let fabricCanvas: FabricCanvas | null = null
let lastEmitTime = 0
let lastEmitPointCount = 0
let resizeObserver: ResizeObserver | null = null
let currentPathObject: FabricObject | null = null
let pendingResize = false
let strokeSeq = 0
const EMIT_INTERVAL = EMIT_INTERVAL_MS
const strokePathMap = new Map<string, FabricObject>()

function getCanvasPoint(e: { e: MouseEvent | Touch }): Point {
  const pointer = fabricCanvas?.getPointer(e.e as unknown as MouseEvent)
  if (!pointer) return { x: 0, y: 0 }
  return { x: pointer.x, y: pointer.y }
}

// 原生触摸处理（绕过 Fabric.js 触摸→鼠标转换，确保移动端可靠）
function touchEventPoint(touch: Touch): Point {
  if (!canvasRef.value) return { x: 0, y: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
}

function handleTouchStart(e: TouchEvent) {
  e.preventDefault()
  if (props.readonly || !gameStore.isMyTurn) return
  if (!canvasRef.value) return
  strokeSeq++
  const point = touchEventPoint(e.touches[0])
  canvasStore.startStroke(point)
  lastEmitTime = Date.now()
  lastEmitPointCount = 0
  renderCurrentStroke()
}

function handleTouchMove(e: TouchEvent) {
  e.preventDefault()
  if (props.readonly || !gameStore.isMyTurn) return
  if (!canvasStore.isDrawing) return
  if (!canvasRef.value) return
  const point = touchEventPoint(e.touches[0])
  canvasStore.continueStroke(point)
  renderCurrentStroke()
  const now = Date.now()
  if (now - lastEmitTime >= EMIT_INTERVAL && canvasStore.currentStroke.length > 0) {
    emitStroke()
    lastEmitTime = now
  }
}

function handleTouchEnd(e: TouchEvent) {
  e.preventDefault()
  if (props.readonly || !gameStore.isMyTurn) return
  
  const hadStroke = canvasStore.currentStroke.length > 0
  if (hadStroke) {
    const thisSeq = strokeSeq
    emitStroke()
    finalizeStroke()
    const newStroke = findOwnStroke(thisSeq)
    if (newStroke) addStrokesToCanvas([newStroke])
  }
  
  if (pendingResize) { pendingResize = false; resizeCanvas() }
}

function handleMouseDown(e: { e: MouseEvent }) {
  if (props.readonly || !gameStore.isMyTurn) return
  strokeSeq++
  const point = getCanvasPoint(e)
  canvasStore.startStroke(point)
  lastEmitTime = Date.now()
  lastEmitPointCount = 0
  renderCurrentStroke()
}

function handleMouseMove(e: { e: MouseEvent }) {
  if (props.readonly || !gameStore.isMyTurn) return
  if (!canvasStore.isDrawing) return
  const point = getCanvasPoint(e)
  canvasStore.continueStroke(point)
  renderCurrentStroke()
  const now = Date.now()
  if (now - lastEmitTime >= EMIT_INTERVAL && canvasStore.currentStroke.length > 0) {
    emitStroke()
    lastEmitTime = now
  }
}

function handleMouseUp() {
  if (props.readonly || !gameStore.isMyTurn) return
  
  const hadStroke = canvasStore.currentStroke.length > 0
  if (hadStroke) {
    const thisSeq = strokeSeq
    emitStroke()
    finalizeStroke()
    const newStroke = findOwnStroke(thisSeq)
    if (newStroke) addStrokesToCanvas([newStroke])
  }
  
  if (pendingResize) { pendingResize = false; resizeCanvas() }
}

// 从末尾匹配自己刚完成的笔画：断线重连后本地 strokeSeq 重新计数，
// 与 allStrokes 同步的旧笔画 seq 冲突时取最新的，避免旧笔画被重复添加
function findOwnStroke(seq: number) {
  const myId = useRoomStore().currentPlayerId
  if (!myId) return undefined
  for (let i = gameStore.strokes.length - 1; i >= 0; i--) {
    const s = gameStore.strokes[i]
    if (s.playerId === myId && s.strokeSeq === seq) return s
  }
  return undefined
}

function simplifyPath(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points
  const [start, end] = [points[0], points[points.length - 1]]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const segLen = dx * dx + dy * dy

  let maxDist = 0
  let maxIdx = 0
  for (let i = 1; i < points.length - 1; i++) {
    const dist = segLen === 0
      ? Math.hypot(points[i].x - start.x, points[i].y - start.y)
      : Math.abs(dy * points[i].x - dx * points[i].y + end.x * start.y - end.y * start.x) / Math.sqrt(segLen)
    if (dist > maxDist) { maxDist = dist; maxIdx = i }
  }

  if (maxDist < epsilon) return [start, end]

  const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon)
  const right = simplifyPath(points.slice(maxIdx), epsilon)
  return [...left.slice(0, -1), ...right]
}

function emitStroke() {
  const allPoints = canvasStore.currentStroke
  if (allPoints.length === 0 || !fabricCanvas) return
  let newPoints = allPoints.slice(lastEmitPointCount)
  if (newPoints.length === 0) return
  if (newPoints.length > STROKE_MIN_POINTS) {
    newPoints = simplifyPath(newPoints, STROKE_SIMPLIFY_TOLERANCE)
  }
  lastEmitPointCount = allPoints.length
  const cw = fabricCanvas.width ?? 1
  const ch = fabricCanvas.height ?? 1
  // 坐标归一化后压缩为 uint16 (0-65535)
  gameStore.drawStroke(
    newPoints.map((p) => ({
      x: Math.round((p.x / cw) * 65535),
      y: Math.round((p.y / ch) * 65535),
    })),
    canvasStore.tool === 'eraser' ? ERASER_COLOR : canvasStore.color,
    canvasStore.tool === 'eraser' ? canvasStore.width * ERASER_WIDTH_MULTIPLIER : canvasStore.width,
    canvasStore.tool,
    strokeSeq,
    true
  )
}

function finalizeStroke() {
  if (canvasStore.currentStroke.length === 0 || !fabricCanvas) return
  const cw = fabricCanvas.width ?? 1
  const ch = fabricCanvas.height ?? 1
  gameStore.addCompletedStroke(
    canvasStore.currentStroke.map((p) => ({ x: p.x / cw, y: p.y / ch })),
    canvasStore.tool === 'eraser' ? ERASER_COLOR : canvasStore.color,
    canvasStore.tool === 'eraser' ? canvasStore.width * ERASER_WIDTH_MULTIPLIER : canvasStore.width,
    canvasStore.tool,
    strokeSeq
  )
  canvasStore.currentStroke = []
  canvasStore.isDrawing = false
}

function renderAllStrokes() {
  if (!fabricCanvas) return
  const cw = fabricCanvas.width ?? 1
  const ch = fabricCanvas.height ?? 1

  fabricCanvas.clear()
  fabricCanvas.backgroundColor = CANVAS_BG_COLOR
  strokePathMap.clear()

  for (const stroke of gameStore.strokes) {
    const obj = createStrokeObject(stroke, cw, ch)
    if (obj) {
      fabricCanvas.add(obj)
      if (stroke.strokeSeq !== undefined && stroke.playerId) {
        strokePathMap.set(`${stroke.playerId}:${stroke.strokeSeq}`, obj)
      }
    }
  }

  currentPathObject = null
  renderCurrentStroke()
  fabricCanvas.renderAll()
}

function addStrokesToCanvas(strokes: Array<{ playerId: string; points: Point[]; color: string; width: number; tool: string; strokeSeq?: number }>) {
  if (!fabricCanvas) return
  const cw = fabricCanvas.width ?? 1
  const ch = fabricCanvas.height ?? 1

  if (currentPathObject) {
    fabricCanvas.remove(currentPathObject)
    currentPathObject = null
  }

  for (const stroke of strokes) {
    const obj = createStrokeObject(stroke, cw, ch)
    if (obj) {
      fabricCanvas.add(obj)
      if (stroke.strokeSeq !== undefined && stroke.playerId) {
        strokePathMap.set(`${stroke.playerId}:${stroke.strokeSeq}`, obj)
      }
    }
  }

  renderCurrentStroke()
  fabricCanvas.renderAll()
}

function createStrokeObject(stroke: { points: Point[]; color: string; width: number; playerId?: string; strokeSeq?: number; tool?: string }, cw: number, ch: number): FabricObject | null {
  if (stroke.points.length === 0) return null
  if (stroke.points.length === 1) {
    const p = stroke.points[0]
    const radius = stroke.width / 2
    return new fabric.Circle({
      left: p.x * cw - radius,
      top: p.y * ch - radius,
      radius,
      fill: stroke.color,
      selectable: false,
      evented: false,
    })
  }
  const pathData = stroke.points
    .map((p: Point, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x * cw} ${p.y * ch}`)
    .join(' ')
  return new fabric.Path(pathData, {
    stroke: stroke.color,
    strokeWidth: stroke.width,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: false,
    evented: false,
  })
}

function renderCurrentStroke() {
  if (!fabricCanvas) return

  const points = canvasStore.currentStroke

  // 获取 Fabric.js 的上层 canvas（用户看到的层）
  const upperCanvas = fabricCanvas.upperCanvasEl
  if (!upperCanvas) return
  const ctx = upperCanvas.getContext('2d')
  if (!ctx) return

  // 清除上层 canvas（直接清除整个画布，因为这只是临时绘制层）
  ctx.clearRect(0, 0, upperCanvas.width, upperCanvas.height)

  if (points.length === 0) {
    // 无进行中的笔画：同步移除临时对象，防止抬笔后上层残留导致双重渲染
    if (currentPathObject) {
      fabricCanvas.remove(currentPathObject)
      currentPathObject = null
    }
    return
  }

  const currentColor = canvasStore.tool === 'eraser' ? ERASER_COLOR : canvasStore.color
  const currentWidth = canvasStore.tool === 'eraser' ? canvasStore.width * ERASER_WIDTH_MULTIPLIER : canvasStore.width

  if (points.length === 1) {
    // 单点用圆形
    const p = points[0]
    const radius = currentWidth / 2
    ctx.fillStyle = currentColor
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fill()
  } else if (points.length >= 2) {
    // 多点用线条
    ctx.strokeStyle = currentColor
    ctx.lineWidth = currentWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.stroke()
  }

  // 创建 Fabric.js 对象用于后续管理（添加到对象列表但不立即渲染）
  if (currentPathObject) {
    fabricCanvas.remove(currentPathObject)
    currentPathObject = null
  }

  if (points.length === 1) {
    const p = points[0]
    const radius = currentWidth / 2
    currentPathObject = new fabric.Circle({
      left: p.x - radius,
      top: p.y - radius,
      radius,
      fill: currentColor,
      selectable: false,
      evented: false,
    })
  } else {
    const pathData = points
      .map((p: Point, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ')
    currentPathObject = new fabric.Path(pathData, {
      stroke: currentColor,
      strokeWidth: currentWidth,
      fill: null,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: false,
      evented: false,
    })
  }

  if (currentPathObject) {
    fabricCanvas.add(currentPathObject)
  }
}

function resizeCanvas() {
  if (!fabricCanvas || !containerRef.value) return

  const containerWidth = containerRef.value.clientWidth
  const containerHeight = containerRef.value.clientHeight

  if (containerWidth <= 0 || containerHeight <= 0) return

  const ratio = CANVAS_ASPECT_RATIO
  let w: number, h: number

  // 移动端（<768px）：宽度占满屏幕，高度按4:3比例计算
  if (window.innerWidth < BREAKPOINT_MOBILE) {
    w = Math.floor(containerWidth)
    h = Math.floor(w / ratio)
  } else {
    // 桌面端：保持 4:3 比例，适应容器
    if (containerWidth / containerHeight > ratio) {
      h = Math.floor(containerHeight)
      w = Math.floor(h * ratio)
    } else {
      w = Math.floor(containerWidth)
      h = Math.floor(w / ratio)
    }
  }

  if (fabricCanvas.width === w && fabricCanvas.height === h) return

  fabricCanvas.setWidth(w)
  fabricCanvas.setHeight(h)
  renderAllStrokes()
}

let prevStrokeCount = -1

watch(() => gameStore.strokeVersion, () => {
  if (!fabricCanvas) return
  if (gameStore.pendingFullRedraw) {
    const currentCount = gameStore.strokes.length
    const isFirstRender = strokePathMap.size === 0 || prevStrokeCount < 0

    if (currentCount === prevStrokeCount + 1 && !isFirstRender) {
      const lastStroke = gameStore.strokes[currentCount - 1]
      if (lastStroke) addStrokesToCanvas([lastStroke])
    } else {
      renderAllStrokes()
    }
    prevStrokeCount = currentCount
    gameStore.pendingFullRedraw = false
  }
})

watch(() => gameStore.currentWord, () => {
  if (gameStore.currentWord !== null && gameStore.isMyTurn) {
    canvasStore.clearCanvas()
    if (fabricCanvas) renderAllStrokes()
  }
})

// 在 canvas 初始化前可能已有笔画到达 gameStore.strokes（路由跳转窗口期），
// 初始化后同步一次确保不丢失
function syncExistingStrokes() {
  if (gameStore.strokes.length > 0) {
    renderAllStrokes()
  }
}

function handleUndoKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !props.readonly && gameStore.isMyTurn) {
    e.preventDefault()
    gameStore.undoStroke()
  }
}

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return

  fabricCanvas = new fabric.Canvas(canvasRef.value, {
    width: 1,
    height: 1,
    backgroundColor: CANVAS_BG_COLOR,
    isDrawingMode: false,
    selection: false,
  })

  resizeCanvas()

  fabricCanvas.on('mouse:down', handleMouseDown)
  fabricCanvas.on('mouse:move', handleMouseMove)
  fabricCanvas.on('mouse:up', handleMouseUp)

  // 原生触摸事件绕过 Fabric.js 的 touch→mouse 转换
  canvasRef.value.addEventListener('touchstart', handleTouchStart, { passive: false })
  canvasRef.value.addEventListener('touchmove', handleTouchMove, { passive: false })
  canvasRef.value.addEventListener('touchend', handleTouchEnd, { passive: false })

  resizeObserver = new ResizeObserver(() => {
    if (canvasStore.isDrawing) {
      pendingResize = true
    } else {
      resizeCanvas()
    }
  })
  resizeObserver.observe(containerRef.value)

  window.addEventListener('keydown', handleUndoKey)

  renderAllStrokes()
  syncExistingStrokes()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleUndoKey)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (fabricCanvas) {
    fabricCanvas.off('mouse:down')
    fabricCanvas.off('mouse:move')
    fabricCanvas.off('mouse:up')
    fabricCanvas.dispose()
    fabricCanvas = null
  }
  strokePathMap.clear()
  currentPathObject = null

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('touchstart', handleTouchStart)
    canvasRef.value.removeEventListener('touchmove', handleTouchMove)
    canvasRef.value.removeEventListener('touchend', handleTouchEnd)
  }
})
</script>

<style scoped>
.game-canvas {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.game-canvas canvas {
  display: block;
  cursor: crosshair;
  touch-action: none;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  background: #f7f0e6;
  overflow: hidden;
  max-width: 100%;
  max-height: 100%;
}

@media (max-width: 768px) {
  .game-canvas {
    flex: none;
    width: 100%;
  }

  .game-canvas canvas {
    border-radius: 0;
    border-width: 1px 0;
    max-width: none;
  }
}
</style>
