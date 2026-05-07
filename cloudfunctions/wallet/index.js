const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==============================
//  角色工具
// ==============================
const RLIST = ['boss', 'hunter', 'admin']
function normalizeRole(r) {
  const x = String(r == null ? '' : r).trim().toLowerCase()
  return RLIST.includes(x) ? x : 'boss'
}

function normalizeRolesArray(u) {
  if (!u) return ['boss']
  let arr = []
  if (Array.isArray(u.roles) && u.roles.length) {
    arr = u.roles.map(normalizeRole).filter(x => RLIST.includes(x))
  }
  if (!arr.length && u.role) arr = [normalizeRole(u.role)]
  arr = [...new Set(arr)]
  if (!arr.length) arr = ['boss']
  return arr
}

function pickStoredRole(roles) {
  if (roles.includes('boss')) return 'boss'
  if (roles.includes('hunter')) return 'hunter'
  return 'admin'
}

function hasRole(u, want) {
  if (!u) return false
  return normalizeRolesArray(u).includes(normalizeRole(want))
}

function isHunterForWallet(u) {
  if (!u) return false
  if (hasRole(u, 'hunter')) return true
  const st = u.hunter_info && u.hunter_info.apply_status
  return st === 'approved'
}

async function getUser(openid) {
  const { data } = await db.collection('users').where({ openid }).get()
  const u = data[0]
  if (!u) return null
  const roles = normalizeRolesArray(u)
  const pref = normalizeRole(u.role)
  const role = roles.includes(pref) ? pref : pickStoredRole(roles)
  return { ...u, role, roles }
}

async function requireHunter(openid) {
  const u = await getUser(openid)
  if (!u) throw new Error('用户不存在')
  if (isHunterForWallet(u)) return
  const st = u.hunter_info && u.hunter_info.apply_status
  if (st === 'pending') throw new Error('打手审核中，通过后可查看资金')
  if (st === 'rejected') throw new Error('打手申请未通过，无法使用资金功能')
  if (st === 'dismissed') throw new Error('已解除打手身份，无法使用资金功能')
  throw new Error('仅打手可操作')
}

async function requireAdmin(openid) {
  const u = await getUser(openid)
  if (!u || !hasRole(u, 'admin')) throw new Error('无权限')
}

// ==============================
//  金额工具
// ==============================
function coerceFen(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.floor(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : Math.floor(n)
  }
  if (typeof v === 'object' && v != null && typeof v.toNumber === 'function') {
    try {
      const n = v.toNumber()
      return Number.isNaN(n) ? null : Math.floor(n)
    } catch (_) { return null }
  }
  const n = Number(v)
  return Number.isNaN(n) ? null : Math.floor(n)
}

function fenFromDoc(o) {
  if (!o) return 0
  const earn = coerceFen(o.hunter_earn_fen)
  if (earn != null && earn >= 0) return earn
  const total = coerceFen(o.total_amount)
  return total != null && total >= 0 ? total : 0
}

/**
 * 已完成订单分成累计：游标分页拉全量
 */
async function sumCompletedEarnings(openid) {
  const oid = String(openid || '').trim()
  if (!oid) return 0
  const pageSize = 100
  let lastId = null
  let sum = 0

  const runPaged = async () => {
    for (let round = 0; round < 500; round++) {
      const cond = { hunter_openid: oid, status: 'completed' }
      if (lastId) cond._id = _.gt(lastId)
      const { data } = await db.collection('orders').where(cond).orderBy('_id', 'asc').limit(pageSize).get()
      if (!data || !data.length) break
      for (const o of data) sum += fenFromDoc(o)
      lastId = data[data.length - 1]._id
      if (data.length < pageSize) break
    }
    return sum
  }

  try {
    return await runPaged()
  } catch (e) {
    console.error('[wallet] sumCompletedEarnings paged failed, fallback', e)
    const { data } = await db.collection('orders').where({ hunter_openid: oid, status: 'completed' }).limit(1000).get()
    return (data || []).reduce((s, o) => s + fenFromDoc(o), 0)
  }
}

async function sumWithdrawals(openid, statuses) {
  const { data } = await db.collection('withdrawals')
    .where({ openid, status: _.in(statuses) })
    .field({ amount_fen: true })
    .get()
  return data.reduce((s, w) => s + (w.amount_fen || 0), 0)
}

async function computeWallet(openid) {
  const earned = await sumCompletedEarnings(openid)
  const pendingOut = await sumWithdrawals(openid, ['pending'])
  const paidOut = await sumWithdrawals(openid, ['paid'])
  const available = earned - pendingOut - paidOut
  return {
    earned_fen: earned,
    pending_withdraw_fen: pendingOut,
    paid_out_fen: paidOut,
    available_fen: Math.max(0, available)
  }
}

// ==============================
//  业务函数
// ==============================
async function getSummary(openid) {
  await requireHunter(openid)
  const data = await computeWallet(openid)
  return { code: 0, data }
}

async function requestWithdraw(openid, event) {
  await requireHunter(openid)
  let { amount_fen, wechat_id } = event
  amount_fen = Number(amount_fen)
  if (!amount_fen || amount_fen < 100) throw new Error('提现金额至少 1 元')

  wechat_id = String(wechat_id || '').trim()
  if (wechat_id.length < 2) throw new Error('请填写收款微信号')

  const w = await computeWallet(openid)
  if (amount_fen > w.available_fen) throw new Error('可提现余额不足')

  const now = db.serverDate()
  const res = await db.collection('withdrawals').add({
    data: {
      openid,
      amount_fen,
      wechat_id,
      status: 'pending',
      created_at: now,
      updated_at: now
    }
  })
  return { code: 0, data: { _id: res._id } }
}

async function listMine(openid) {
  await requireHunter(openid)
  const { data } = await db.collection('withdrawals')
    .where({ openid })
    .orderBy('created_at', 'desc')
    .limit(50)
    .get()
  return { code: 0, data }
}

async function listPendingAdmin(openid) {
  await requireAdmin(openid)
  const { data } = await db.collection('withdrawals')
    .where({ status: 'pending' })
    .orderBy('created_at', 'asc')
    .limit(100)
    .get()

  const openids = [...new Set(data.map(w => w.openid))]
  const nickMap = {}
  for (const oid of openids) {
    const { data: users } = await db.collection('users').where({ openid: oid }).limit(1).get()
    nickMap[oid] = users[0] ? (users[0].nickname || oid.slice(-6)) : oid.slice(-6)
  }
  const list = data.map(w => ({ ...w, hunter_nickname: nickMap[w.openid] || '' }))
  return { code: 0, data: list }
}

async function listAllAdmin(openid) {
  await requireAdmin(openid)
  const { data } = await db.collection('withdrawals')
    .orderBy('created_at', 'desc')
    .limit(200)
    .get()

  const openids = [...new Set(data.map(w => w.openid))]
  const nickMap = {}
  for (const oid of openids) {
    const { data: users } = await db.collection('users').where({ openid: oid }).limit(1).get()
    nickMap[oid] = users[0] ? (users[0].nickname || oid.slice(-6)) : oid.slice(-6)
  }
  const list = data.map(w => ({ ...w, hunter_nickname: nickMap[w.openid] || '' }))
  return { code: 0, data: list }
}

/**
 * 单笔审核：管理员手动打款后标记状态
 */
async function reviewWithdraw(openid, event) {
  await requireAdmin(openid)
  const { withdrawId, decision, reject_reason } = event
  if (decision !== 'paid' && decision !== 'rejected') throw new Error('无效操作')

  const col = db.collection('withdrawals')
  const { data: row } = await col.doc(withdrawId).get()
  if (!row || row.status !== 'pending') throw new Error('记录状态异常')

  const patch = {
    status: decision,
    updated_at: db.serverDate(),
    processed_at: db.serverDate()
  }
  if (decision === 'rejected') {
    patch.reject_reason = String(reject_reason || '').slice(0, 200)
  }

  await col.doc(withdrawId).update({ data: patch })
  return { code: 0, data: {} }
}

/**
 * 批量标记已打款 / 拒绝：管理员手动打款后批量更新状态
 */
async function batchReviewWithdraw(openid, event) {
  await requireAdmin(openid)
  const { withdrawIds, decision, reject_reason } = event
  if (!Array.isArray(withdrawIds) || !withdrawIds.length) throw new Error('请选择提现记录')
  if (decision !== 'paid' && decision !== 'rejected') throw new Error('无效操作')

  const col = db.collection('withdrawals')
  const succeeded = []
  const failed = []

  for (const withdrawId of withdrawIds) {
    try {
      const { data: row } = await col.doc(withdrawId).get()
      if (!row || row.status !== 'pending') {
        failed.push({ id: withdrawId, reason: '记录状态异常' })
        continue
      }
      const patch = {
        status: decision,
        updated_at: db.serverDate(),
        processed_at: db.serverDate()
      }
      if (decision === 'rejected') {
        patch.reject_reason = String(reject_reason || '').slice(0, 200)
      }
      await col.doc(withdrawId).update({ data: patch })
      succeeded.push({ id: withdrawId })
    } catch (e) {
      console.error('[wallet] batchReviewWithdraw item', withdrawId, e)
      failed.push({ id: withdrawId, reason: e.message || '更新失败' })
    }
  }

  return { code: 0, data: { succeeded, failed } }
}

// ==============================
//  老板总裁贝
// ==============================
async function getBossWallet(openid) {
  const u = await getUser(openid)
  if (!u) throw new Error('用户不存在')
  return {
    code: 0,
    data: {
      balance_fen:     u.balance_fen     || 0,
      total_spent_fen: u.total_spent_fen || 0
    }
  }
}

async function requestRecharge(openid, event) {
  let { amount_fen, remark } = event
  amount_fen = Number(amount_fen)
  if (!amount_fen || amount_fen < 100) throw new Error('充值金额至少 1 元')
  await ensureRechargesCollection()
  const now = db.serverDate()
  const { _id } = await db.collection('recharges').add({
    data: {
      openid,
      amount_fen,
      remark: String(remark || '').slice(0, 200),
      status: 'pending',
      created_at: now,
      updated_at: now
    }
  })
  return { code: 0, data: { _id } }
}

async function listRechargesUser(openid) {
  await ensureRechargesCollection()
  const { data } = await db.collection('recharges')
    .where({ openid })
    .orderBy('created_at', 'desc')
    .limit(50)
    .get()
  return { code: 0, data }
}

async function listRechargesAdmin(openid) {
  await requireAdmin(openid)
  await ensureRechargesCollection()
  const { data } = await db.collection('recharges')
    .orderBy('created_at', 'desc')
    .limit(200)
    .get()
  const openids = [...new Set(data.map(r => r.openid))]
  const nickMap = {}
  for (const oid of openids) {
    const { data: users } = await db.collection('users').where({ openid: oid }).limit(1).get()
    nickMap[oid] = users[0] ? (users[0].nickname || oid.slice(-6)) : oid.slice(-6)
  }
  return { code: 0, data: data.map(r => ({ ...r, nickname: nickMap[r.openid] || '' })) }
}

async function reviewRecharge(openid, event) {
  await requireAdmin(openid)
  const { rechargeId, decision, reject_reason } = event
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('无效操作')
  const col = db.collection('recharges')
  const { data: row } = await col.doc(rechargeId).get()
  if (!row || row.status !== 'pending') throw new Error('记录状态异常')
  const patch = {
    status: decision,
    updated_at: db.serverDate(),
    processed_at: db.serverDate()
  }
  if (decision === 'rejected') patch.reject_reason = String(reject_reason || '').slice(0, 200)
  await col.doc(rechargeId).update({ data: patch })
  if (decision === 'approved') {
    await db.collection('users').where({ openid: row.openid }).update({
      data: { balance_fen: _.inc(row.amount_fen), updated_at: db.serverDate() }
    })
  }
  return { code: 0, data: {} }
}

async function batchReviewRecharge(openid, event) {
  await requireAdmin(openid)
  const { rechargeIds, decision, reject_reason } = event
  if (!Array.isArray(rechargeIds) || !rechargeIds.length) throw new Error('请选择充值记录')
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('无效操作')
  const col = db.collection('recharges')
  const succeeded = [], failed = []
  for (const rechargeId of rechargeIds) {
    try {
      const { data: row } = await col.doc(rechargeId).get()
      if (!row || row.status !== 'pending') { failed.push({ id: rechargeId, reason: '记录状态异常' }); continue }
      const patch = { status: decision, updated_at: db.serverDate(), processed_at: db.serverDate() }
      if (decision === 'rejected') patch.reject_reason = String(reject_reason || '').slice(0, 200)
      await col.doc(rechargeId).update({ data: patch })
      if (decision === 'approved') {
        await db.collection('users').where({ openid: row.openid }).update({
          data: { balance_fen: _.inc(row.amount_fen), updated_at: db.serverDate() }
        })
      }
      succeeded.push({ id: rechargeId })
    } catch (e) {
      console.error('[wallet] batchReviewRecharge item', rechargeId, e)
      failed.push({ id: rechargeId, reason: e.message || '更新失败' })
    }
  }
  return { code: 0, data: { succeeded, failed } }
}

async function ensureRechargesCollection() {
  if (global._rechargesCollectionReady) return
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('recharges')
    global._rechargesCollectionReady = true
  } catch (e) {
    const t = `${e.errMsg || ''}${e.message || ''}`
    if (/already|exist|已存在|duplicate|重复/i.test(t)) { global._rechargesCollectionReady = true; return }
    throw new Error('数据库缺少 recharges 集合，请在云开发控制台手动创建。')
  }
}

/**
 * 云控制台若未创建 withdrawals 会报 -502005；云函数内有权限时可自动建表。
 */
async function ensureWithdrawalsCollection() {
  if (global._withdrawalsCollectionReady) return
  if (typeof db.createCollection !== 'function') {
    console.warn('[wallet] db.createCollection 不可用，请在云开发控制台手动创建集合 withdrawals')
    return
  }
  try {
    await db.createCollection('withdrawals')
    global._withdrawalsCollectionReady = true
  } catch (e) {
    const t = `${e.errMsg || ''}${e.message || ''}`
    if (/already|exist|已存在|duplicate|重复/i.test(t)) {
      global._withdrawalsCollectionReady = true
      return
    }
    console.error('[wallet] createCollection withdrawals', e)
    throw new Error('数据库缺少 withdrawals 集合，请在云开发控制台手动创建。')
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event
  try {
    await ensureWithdrawalsCollection()
    switch (action) {
      case 'getSummary':          return await getSummary(OPENID)
      case 'requestWithdraw':     return await requestWithdraw(OPENID, event)
      case 'listMine':            return await listMine(OPENID)
      case 'listPendingAdmin':    return await listPendingAdmin(OPENID)
      case 'listAllAdmin':        return await listAllAdmin(OPENID)
      case 'reviewWithdraw':      return await reviewWithdraw(OPENID, event)
      case 'batchReviewWithdraw': return await batchReviewWithdraw(OPENID, event)
      case 'getBossWallet':       return await getBossWallet(OPENID)
      case 'requestRecharge':     return await requestRecharge(OPENID, event)
      case 'listRechargesUser':   return await listRechargesUser(OPENID)
      case 'listRechargesAdmin':  return await listRechargesAdmin(OPENID)
      case 'reviewRecharge':      return await reviewRecharge(OPENID, event)
      case 'batchReviewRecharge': return await batchReviewRecharge(OPENID, event)
      case 'devDirectCredit':     return await devDirectCredit(OPENID, event)
      case 'devDeleteRecord':     return await devDeleteRecord(OPENID, event)
      case 'devClearAll':         return await devClearAll(event)
      default:                    return { code: -1, msg: '未知操作' }
    }
  } catch (e) {
    console.error('[wallet]', action, e)
    return { code: -1, msg: e.message || '服务器错误' }
  }
}

// 开发测试：直接写入余额（不走充值审批流程）
async function devDirectCredit(openid, event) {
  const amount_fen = Number(event.amount_fen) || 50000
  await db.collection('users').where({ openid }).update({
    data: { balance_fen: amount_fen, updated_at: db.serverDate() }
  })
  return { code: 0, data: { balance_fen: amount_fen } }
}

// 开发测试：删除指定的提现或充值记录（仅用于清理测试数据）
async function devDeleteRecord(openid, event) {
  const { id, collection } = event
  const col = collection === 'recharges' ? 'recharges' : 'withdrawals'
  if (!id) throw new Error('缺少 id')
  await db.collection(col).doc(id).remove()
  return { code: 0, data: { deleted: id } }
}

// 开发测试：清空所有提现、充值记录
async function devClearAll(event) {
  if (event.secret !== 'DELETE_ALL_TEST_ORDERS') throw new Error('secret 错误')

  // 清空 recharges / withdrawals 集合
  const cols = ['recharges', 'withdrawals']
  const counts = {}
  for (const col of cols) {
    let deleted = 0
    for (let i = 0; i < 100; i++) {
      const { data } = await db.collection(col).limit(20).get()
      if (!data || data.length === 0) break
      await Promise.all(data.map(r => db.collection(col).doc(r._id).remove()))
      deleted += data.length
    }
    counts[col] = deleted
  }

  // 重置所有用户的 balance_fen / total_spent_fen
  let usersReset = 0
  for (let i = 0; i < 20; i++) {
    const { data: users } = await db.collection('users').limit(20).skip(i * 20).get()
    if (!users || !users.length) break
    await Promise.all(users.map(u =>
      db.collection('users').doc(u._id).update({
        data: { balance_fen: 0, total_spent_fen: 0, updated_at: db.serverDate() }
      })
    ))
    usersReset += users.length
    if (users.length < 20) break
  }
  counts.usersReset = usersReset

  return { code: 0, data: counts }
}
