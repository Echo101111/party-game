import { Router, type Request, type Response } from 'express'
import { loadCustomWords } from '../data/customWordBank.js'
import { TOTAL_WORD_COUNT } from '../data/words.js'
import { requireAdminToken, loginPage, escapeHtml } from '../middleware/auth.js'
import { config } from '../config.js'
import { feedbackStore } from './feedback.js'
import { roomManager } from '../rooms/index.js'
import { drawGameManager } from '../game/index.js'
import { spyGameManager } from '../game/SpyGameManager.js'
import { getAllGameHistory } from '../data/gameHistoryStore.js'

export const adminRouter: Router = Router()

function layout(title: string, body: string, activeTab: 'words' | 'feedback' | 'rooms' | 'history'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Draw & Guess</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Noto Sans SC', sans-serif;
    background: #FFF8F0;
    color: #4A3728;
    padding: 2rem;
  }
  h1 { font-size: 1.4rem; margin-bottom: 1rem; }
  .nav {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
    background: #F0E4D8;
    border-radius: 10px;
    padding: 3px;
  }
  .nav a {
    flex: 1;
    text-align: center;
    padding: 0.55rem 1rem;
    text-decoration: none;
    color: #8B7A6A;
    font-size: 0.88rem;
    font-weight: 500;
    border-radius: 8px;
    transition: all 0.2s;
  }
  .nav a:hover { color: #4A3728; }
  .nav a.active {
    background: #fff;
    color: #4A3728;
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .nav a .icon { margin-right: 0.25rem; }
</style>
</head>
<body>
<h1>📊 管理后台</h1>
<div class="nav">
  <a href="/admin/words" class="${activeTab === 'words' ? 'active' : ''}"><span class="icon">📖</span>词库管理</a>
  <a href="/admin/feedback" class="${activeTab === 'feedback' ? 'active' : ''}"><span class="icon">💬</span>反馈建议</a>
  <a href="/admin/rooms" class="${activeTab === 'rooms' ? 'active' : ''}"><span class="icon">🚪</span>房间状态</a>
  <a href="/admin/history" class="${activeTab === 'history' ? 'active' : ''}"><span class="icon">🕘</span>历史游玩</a>
</div>
${body}
</body>
</html>`
}

// POST /admin/login — 密码登录，成功后设置 Cookie
adminRouter.post('/login', (req: Request, res: Response) => {
  const password = req.body?.password ?? ''

  if (!config.adminToken) {
    res.status(403).send(loginPage('管理员功能未启用（未设置 ADMIN_TOKEN）'))
    return
  }

  if (password === config.adminToken) {
    res.setHeader('Set-Cookie', `admin_token=${encodeURIComponent(config.adminToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`)
    res.redirect('/admin/words')
  } else {
    res.status(403).send(loginPage('密码错误，请重试'))
  }
})

// GET /admin — 首页，已登录则跳转
adminRouter.get('/', (req: Request, res: Response) => {
  const token = (req.query.token as string) || ''
  if (token === config.adminToken) {
    // 兼容旧版 URL token → 设置 cookie 后跳转
    res.setHeader('Set-Cookie', `admin_token=${encodeURIComponent(config.adminToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`)
    return res.redirect('/admin/words')
  }
  res.send(loginPage())
})

// GET /admin/words — 词库管理
adminRouter.get('/words', requireAdminToken, (_req: Request, res: Response) => {
  const adminToken = escapeHtml(config.adminToken)
  const entries = loadCustomWords()
  const hasRows = entries.length > 0
  const rows = entries.map((e, i) => `
    <tr>
      <td><input type="checkbox" class="word-cb" value="${escapeHtml(e.word)}"></td>
      <td>${escapeHtml(e.word)}</td>
      <td>
        <span id="cat-${i}">${escapeHtml(e.category)}</span>
        <button class="btn-edit-sm" onclick="editField('${escapeHtml(e.word)}','category',${i})">✎</button>
      </td>
      <td>
        <span id="syn-${i}">${escapeHtml(e.synonyms?.join(', ') || '—')}</span>
        <button class="btn-edit-sm" onclick="editField('${escapeHtml(e.word)}','synonyms',${i})">✎</button>
      </td>
      <td>${new Date(e.addedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
      <td><button class="btn-del" onclick="delWord('${escapeHtml(e.word)}')">删除</button></td>
    </tr>
  `).join('\n')

  const body = `
<style>
  .stats { color: #8B7A6A; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
  .toolbar label { font-size: 0.85rem; color: #4A3728; display: flex; align-items: center; gap: 0.3rem; cursor: pointer; }
  .btn-batch-del {
    padding: 0.35rem 0.85rem;
    background: #D9756B;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.82rem;
  }
  .btn-batch-del:hover { background: #c0392b; }
  .btn-batch-del:disabled { opacity: 0.4; cursor: not-allowed; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(180,140,110,0.1);
  }
  th, td { padding: 0.5rem 0.75rem; text-align: left; font-size: 0.85rem; }
  th { background: #F7EFE6; font-weight: 600; }
  tr:not(:last-child) td { border-bottom: 1px solid #F0E4D8; }
  .col-cb { width: 36px; text-align: center; }
  th.col-cb { text-align: center; }
  .btn-del {
    padding: 0.25rem 0.6rem;
    background: #D9756B;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.78rem;
  }
  .btn-del:hover { background: #c0392b; }
  .btn-edit-sm {
    background: none;
    border: none;
    cursor: pointer;
    color: #B5A392;
    font-size: 0.8rem;
    padding: 0.1rem 0.2rem;
    opacity: 0.4;
    transition: opacity 0.15s;
  }
  tr:hover .btn-edit-sm { opacity: 1; }
  .btn-edit-sm:hover { color: #E8856C; }
  .toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.5rem 1rem;
    background: #7EB87A;
    color: #fff;
    border-radius: 999px;
    font-size: 0.85rem;
    display: none;
    z-index: 10;
  }
  .toast.error { background: #D9756B; }
  .empty { color: #B5A392; text-align: center; padding: 2rem; }
</style>
<div class="stats">共 ${entries.length} 个自定义词 · 内置词库 ${TOTAL_WORD_COUNT} 个</div>
${hasRows ? `
<div class="toolbar">
  <label><input type="checkbox" id="select-all"> 全选</label>
  <button class="btn-batch-del" id="btn-batch-del" disabled>🗑 批量删除</button>
</div>
<table>
<thead><tr><th class="col-cb"></th><th>词语</th><th>分类</th><th>别名</th><th>提交时间</th><th>操作</th></tr></thead>
<tbody>${rows}</tbody>
</table>` : '<div class="empty">暂无自定义词语</div>'}
<div id="toast" class="toast"></div>
<script>
const ADMIN_TOKEN = '${adminToken}'
const apiHeaders = { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN }

const checkedWords = () => Array.from(document.querySelectorAll('.word-cb:checked')).map(cb => cb.value)

document.getElementById('select-all')?.addEventListener('change', function() {
  document.querySelectorAll('.word-cb').forEach(cb => cb.checked = this.checked)
  updateBatchBtn()
})

document.querySelectorAll('.word-cb').forEach(cb => {
  cb.addEventListener('change', updateBatchBtn)
})

function updateBatchBtn() {
  const btn = document.getElementById('btn-batch-del')
  if (!btn) return
  const n = checkedWords().length
  btn.disabled = n === 0
  btn.textContent = n > 0 ? '🗑 批量删除 (' + n + ')' : '🗑 批量删除'
}

document.getElementById('btn-batch-del')?.addEventListener('click', async () => {
  const words = checkedWords()
  if (words.length === 0) return
  if (!confirm('确认删除选中的 ' + words.length + ' 个词语？')) return
  try {
    const res = await fetch('/api/words', {
      method: 'DELETE',
      headers: apiHeaders,
      body: JSON.stringify({ words })
    })
    const data = await res.json()
    showToast(data.message, data.success ? 'success' : 'error')
    if (data.success) setTimeout(() => location.reload(), 1000)
  } catch (e) { showToast('删除失败 (' + e + ')', 'error') }
})

async function delWord(word) {
  if (!confirm('确认删除 "' + word + '" ？')) return
  try {
    const res = await fetch('/api/words/' + encodeURIComponent(word), { method: 'DELETE', headers: apiHeaders })
    if (!res.ok) {
      showToast('删除失败 (HTTP ' + res.status + ')', 'error')
      return
    }
    const data = await res.json()
    showToast(data.message, data.success ? 'success' : 'error')
    if (data.success) setTimeout(() => location.reload(), 1000)
  } catch (e) { showToast('删除失败 (' + e + ')', 'error') }
}

async function editField(word, field, idx) {
  const spanId = field === 'category' ? 'cat-' + idx : 'syn-' + idx
  const current = document.getElementById(spanId).textContent
  const label = field === 'category' ? '编辑分类' : '编辑别名（多个用逗号分隔）'
  const val = prompt(label, current === '—' ? '' : current)
  if (val === null) return
  const trimmed = val.trim()
  const body = field === 'category'
    ? { category: trimmed }
    : { synonyms: trimmed ? trimmed.split(',').map(s => s.trim()).filter(Boolean) : [] }
  try {
    const res = await fetch('/api/words/' + encodeURIComponent(word), { method: 'PATCH', headers: apiHeaders, body: JSON.stringify(body) })
    const data = await res.json()
    if (data.success) location.reload()
    else showToast(data.message, 'error')
  } catch (e) { showToast('保存失败: ' + e, 'error') }
}

function showToast(msg, type) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = 'toast' + (type === 'error' ? ' error' : '')
  t.style.display = 'block'
  setTimeout(() => t.style.display = 'none', 2500)
}
</script>`

  res.send(layout('词库管理', body, 'words'))
})

// GET /admin/feedback — 反馈列表
adminRouter.get('/feedback', requireAdminToken, (_req: Request, res: Response) => {
  const sorted = [...feedbackStore].sort((a, b) => b.timestamp - a.timestamp)
  const hasRows = sorted.length > 0
  const rows = sorted.map(f => `
    <tr>
      <td class="col-time">${new Date(f.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
      <td>${escapeHtml(f.text)}</td>
    </tr>
  `).join('\n')

  const body = `
<style>
  .stats { color: #8B7A6A; font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(180,140,110,0.1); }
  th, td { padding: 0.65rem 0.75rem; text-align: left; font-size: 0.85rem; vertical-align: top; }
  th { background: #F7EFE6; font-weight: 600; white-space: nowrap; }
  tr:not(:last-child) td { border-bottom: 1px solid #F0E4D8; }
  .col-time { width: 160px; white-space: nowrap; }
  .empty { color: #B5A392; text-align: center; padding: 3rem; font-size: 0.9rem; }
</style>
<div class="stats">共 ${sorted.length} 条反馈</div>
${hasRows ? `
<table>
<thead><tr><th class="col-time">提交时间</th><th>内容</th></tr></thead>
<tbody>${rows}</tbody>
</table>` : '<div class="empty">暂无反馈</div>'}
`

  res.send(layout('反馈建议', body, 'feedback'))
})

// GET /admin/rooms — 房间状态
adminRouter.get('/rooms', requireAdminToken, (_req: Request, res: Response) => {
  const stats = roomManager.getRoomStats()
  const roomList = roomManager.getAllRooms()
  const activeTimerRoomIds = new Set([
    ...drawGameManager.getActiveTimerRoomIds(),
    ...spyGameManager.getActiveTimerRoomIds(),
  ])

  const safeToDeploy = stats.byState.playing === 0
  const deployStatus = safeToDeploy
    ? '<span style="color:#7EB87A;font-weight:700;">✅ 安全 — 无进行中的游戏，可以部署</span>'
    : `<span style="color:#D9756B;font-weight:700;">⚠️ 不安全 — ${stats.byState.playing} 个房间正在游戏中，部署将中断游戏</span>`

  const rows = roomList.map(r => {
    const players = r.players.map(p =>
      `${escapeHtml(p.nickname)}${p.isOwner ? ' 👑' : ''}${p.sessionId ? '' : ' <span style="color:#B5A392;">(离线)</span>'}`
    ).join('<br>')
    const stateLabel: Record<string, string> = { lobby: '🟢 等待中', playing: '🔴 游戏中', gameover: '🟡 已结束' }
    const timerActive = r.state === 'playing' && activeTimerRoomIds.has(r.id)

    return `<tr>
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td>${r.gameType === 'spy' ? '🕵️ 谁是卧底' : '🎨 你画我猜'}</td>
      <td>${stateLabel[r.state] ?? r.state}${timerActive ? ' ⏱️' : ''}</td>
      <td>${r.players.length}/${r.maxPlayers}</td>
      <td>${r.state === 'playing' ? `${r.currentRound}/${r.totalRounds}` : '-'}</td>
      <td style="font-size:0.82rem;line-height:1.6;">${players}</td>
      <td style="font-size:0.78rem;color:#8B7A6A;">${new Date(r.lastActivityAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
    </tr>`
  }).join('\n')

  const body = `
<style>
  .deploy-banner {
    padding: 0.85rem 1rem;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 2px 8px rgba(180,140,110,0.1);
    margin-bottom: 1.5rem;
    font-size: 0.92rem;
  }
  .stats-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }
  .stat-card {
    flex: 1;
    min-width: 100px;
    background: #fff;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    box-shadow: 0 2px 8px rgba(180,140,110,0.08);
    text-align: center;
  }
  .stat-card .num { font-size: 1.6rem; font-weight: 700; color: #4A3728; }
  .stat-card .label { font-size: 0.75rem; color: #8B7A6A; margin-top: 0.15rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(180,140,110,0.1); }
  th, td { padding: 0.5rem 0.65rem; text-align: left; font-size: 0.83rem; vertical-align: top; }
  th { background: #F7EFE6; font-weight: 600; white-space: nowrap; }
  tr:not(:last-child) td { border-bottom: 1px solid #F0E4D8; }
  .empty { color: #B5A392; text-align: center; padding: 3rem; font-size: 0.9rem; }
</style>
<div class="deploy-banner">${deployStatus}</div>
<div class="stats-row">
  <div class="stat-card"><div class="num">${stats.total}</div><div class="label">总房间</div></div>
  <div class="stat-card"><div class="num">${stats.totalPlayers}</div><div class="label">总玩家</div></div>
  <div class="stat-card"><div class="num">${stats.activePlayers}</div><div class="label">在线玩家</div></div>
  <div class="stat-card"><div class="num">${stats.byState.lobby}</div><div class="label">等待中</div></div>
  <div class="stat-card"><div class="num">${stats.byState.playing}</div><div class="label">游戏中</div></div>
  <div class="stat-card"><div class="num">${stats.byState.gameover}</div><div class="label">已结束</div></div>
</div>
${roomList.length > 0 ? `
<table>
<thead><tr><th>房间名</th><th>游戏类型</th><th>状态</th><th>人数</th><th>轮次</th><th>玩家</th><th>最后活跃</th></tr></thead>
<tbody>${rows}</tbody>
</table>` : '<div class="empty">暂无房间</div>'}
`

  res.send(layout('房间状态', body, 'rooms'))
})

// GET /admin/history — 历史游玩记录
adminRouter.get('/history', requireAdminToken, (_req: Request, res: Response) => {
  const history = [...getAllGameHistory()].sort((a, b) => b.endTime - a.endTime)
  const hasRows = history.length > 0

  const rows = history.map((h) => {
    const durationSec = Math.max(1, Math.round((h.endTime - h.startTime) / 1000))
    const durationLabel = durationSec >= 60
      ? `${Math.floor(durationSec / 60)}分${durationSec % 60}秒`
      : `${durationSec}秒`
    const winner = h.winner ? escapeHtml(h.winner) : '—'
    const detailRows = h.players.map((p, i) => `
      <tr class="detail-row" data-id="${h.id}" hidden>
        <td></td>
        <td class="detail-cell" colspan="6">
          <span class="rank">#${i + 1}</span>
          <span class="score-chip">${p.score} 分</span>
          ${escapeHtml(p.nickname)}${p.isOwner ? ' 👑' : ''}
        </td>
      </tr>
    `).join('\n')

    return `
    <tr class="history-row" data-id="${h.id}">
      <td><strong>${escapeHtml(h.roomName)}</strong></td>
      <td>🎨 你画我猜</td>
      <td class="col-time">${new Date(h.endTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
      <td>${durationLabel}</td>
      <td>${h.totalRounds} 轮</td>
      <td>${h.players.length} 人</td>
      <td>${winner}</td>
    </tr>
    ${detailRows}`
  }).join('\n')

  const body = `
<style>
  .stats-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }
  .stat-card {
    flex: 1;
    min-width: 100px;
    background: #fff;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    box-shadow: 0 2px 8px rgba(180,140,110,0.08);
    text-align: center;
  }
  .stat-card .num { font-size: 1.6rem; font-weight: 700; color: #4A3728; }
  .stat-card .label { font-size: 0.75rem; color: #8B7A6A; margin-top: 0.15rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(180,140,110,0.1); }
  th, td { padding: 0.5rem 0.65rem; text-align: left; font-size: 0.83rem; vertical-align: top; }
  th { background: #F7EFE6; font-weight: 600; white-space: nowrap; }
  tr:not(:last-child) td { border-bottom: 1px solid #F0E4D8; }
  tr.detail-row td { border-bottom: 1px dashed #F0E4D8; background: #FBF6EF; padding: 0.35rem 0.65rem; }
  .col-time { width: 150px; white-space: nowrap; }
  .history-row { cursor: pointer; transition: background 0.15s; }
  .history-row:hover { background: #FBF6EF; }
  .detail-cell { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .rank { color: #B5A392; font-size: 0.75rem; font-weight: 600; }
  .score-chip {
    background: #F0E4D8;
    color: #E8856C;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .empty { color: #B5A392; text-align: center; padding: 3rem; font-size: 0.9rem; }
</style>
<div class="stats-row">
  <div class="stat-card"><div class="num">${history.length}</div><div class="label">历史对局</div></div>
  <div class="stat-card"><div class="num">${history.reduce((sum, h) => sum + h.players.length, 0)}</div><div class="label">参与人次</div></div>
</div>
${hasRows ? `
<table>
<thead><tr><th>房间名</th><th>游戏类型</th><th>结束时间</th><th>时长</th><th>轮次</th><th>人数</th><th>赢家</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="empty" style="padding:1rem 0 0;font-size:0.8rem;">点击行查看玩家分数明细</p>` : '<div class="empty">暂无历史对局</div>'}
<script>
document.querySelectorAll('.history-row').forEach(function(row) {
  row.addEventListener('click', function() {
    var id = row.getAttribute('data-id')
    var detail = document.querySelector('tr.detail-row[data-id="' + id + '"]')
    if (detail) detail.hidden = !detail.hidden
  })
})
</script>`

  res.send(layout('历史游玩', body, 'history'))
})
