const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db   = cloud.database()
const _    = db.command

const ROLES_ARR = ['boss', 'hunter', 'admin']
function normalizeRole(r) {
  const x = String(r == null ? '' : r).trim().toLowerCase()
  return ROLES_ARR.includes(x) ? x : 'boss'
}

function normalizeRolesArray(u) {
  if (!u) return ['boss']
  let arr = []
  if (Array.isArray(u.roles) && u.roles.length) {
    arr = u.roles.map(normalizeRole).filter(x => ROLES_ARR.includes(x))
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

/**
 * 开发用：老板模拟「已付款」。上架前务必改为 false 并重新部署 order 云函数。
 * 正式环境仅依赖微信支付回调将订单置为 paid。
 */
const ENABLE_DEV_SIMULATE_PAID = true

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = typeof event.action === 'string' ? event.action.trim() : event.action
  try {
    switch (action) {
      case 'create':       return await createOrder(OPENID, event)
      case 'list':         return await listOrders(OPENID, event)
      case 'detail':       return await getDetail(OPENID, event)
      case 'take':         return await takeOrder(OPENID, event)
      case 'devSimulatePaid': return await devSimulatePaid(OPENID, event)
      case 'updateStatus': return await updateStatus(OPENID, event)
      case 'addLog':       return await addLog(OPENID, event)
      case 'getLogs':      return await getLogs(event)
      case 'dashboard':    return await dashboard(OPENID)
      case 'todayStats':   return await todayStats()
      case 'submitSettlement': return await submitSettlement(OPENID, event)
      case 'confirmSettlement': return await confirmSettlement(OPENID, event)
      case 'rejectSettlement': return await rejectSettlement(OPENID, event)
      case 'adminRemoveOrder': return await adminRemoveOrder(OPENID, event)
      case 'clearAllOrders': return await clearAllOrders(event)
      case 'createTestOrder': return await createTestOrder(OPENID, event)
      case 'devSubmitSettlement': return await devSubmitSettlement(OPENID, event)
      case 'rejectDesignated':    return await rejectDesignated(OPENID, event)
      case 'assignCoHunter':      return await assignCoHunter(OPENID, event)
      default: return { code: -1, msg: '未知操作' }
    }
  } catch(e) {
    console.error('[order]', action, e)
    return { code: -1, msg: e.message || '服务器错误' }
  }
}

// 生成订单号
function genNo() {
  const d = new Date()
  const pad = n => String(n).padStart(2,'0')
  return `DT${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${String(Date.now()).slice(-6)}`
}

// 获取用户信息
async function getUser(openid) {
  const { data } = await db.collection('users').where({ openid }).get()
  const u = data[0]
  if (!u) return null
  const roles = normalizeRolesArray(u)
  const pref = normalizeRole(u.role)
  const role = roles.includes(pref) ? pref : pickStoredRole(roles)
  return { ...u, role, roles }
}

// 创建订单
// payment_method='balance'（默认）：扣总裁贝，直接待接单
// payment_method='wxpay'：不扣余额，状态 pending_payment，走微信支付
async function createOrder(openid, event) {
  const { service_id, quantity, form_data, remark, payment_method,
          preferred_hunter_openid, preferred_co_hunter_openid, preferred_time,
          needs_co_hunter } = event
  const useWxpay = payment_method === 'wxpay'

  const svcRes = await db.collection('services').doc(service_id).get()
  const svc = svcRes.data
  if (!svc) throw new Error('服务不存在')
  if (svc.is_active === false) throw new Error('该服务已下架')

  const catRes = await db.collection('categories').doc(svc.category_id).get()
  if (!catRes.data || catRes.data.is_active === false) throw new Error('该分类已下架')

  const qty = Math.max(1, Number(quantity) || 1)
  const total_amount = svc.price * qty

  const { data: users } = await db.collection('users').where({ openid }).get()
  const user = users[0]
  if (!user) throw new Error('用户不存在')

  if (!useWxpay) {
    // 余额支付：检查并扣款
    const balance = Number(user.balance_fen) || 0
    if (balance < total_amount) {
      const need = Math.ceil(total_amount / 100)
      const have = Math.floor(balance / 100)
      throw new Error(`总裁贝不足，当前余额 ${have} 总裁贝，需要 ${need} 总裁贝`)
    }
    await db.collection('users').where({ openid }).update({
      data: {
        balance_fen:     _.inc(-total_amount),
        total_spent_fen: _.inc(total_amount),
        updated_at: db.serverDate()
      }
    })
  }

  const order = {
    order_no: genNo(),
    boss_openid: openid,
    boss_snapshot: {
      nickname: user.nickname || '',
      contact: user.contact || ''
    },
    hunter_openid: '',
    preferred_hunter_openid:    preferred_hunter_openid    || '',
    preferred_co_hunter_openid: preferred_co_hunter_openid || '',
    preferred_time:             preferred_time             || '',
    needs_co_hunter:            !!needs_co_hunter,
    service_id,
    service_snapshot: {
      category_name: catRes.data?.name || '',
      service_name: svc.name,
      price: svc.price,
      price_unit: svc.price_unit,
      form_field_defs: (svc.form_fields || []).map(f => ({ key: f.key, label: f.label }))
    },
    form_data: form_data || {},
    remark: remark || '',
    quantity: qty,
    total_amount,
    status: useWxpay ? 'pending_payment' : 'paid',
    payment: useWxpay
      ? { method: 'wxpay' }
      : { method: 'balance', paid_at: db.serverDate() },
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  }

  const res = await db.collection('orders').add({ data: order })
  return { code: 0, data: { ...order, _id: res._id } }
}

// 列出订单
async function listOrders(openid, event) {
  const { type, status } = event
  let query = db.collection('orders')

  if (type === 'boss') {
    query = query.where({ boss_openid: openid, ...(status ? { status } : {}) })
  } else if (type === 'hunter') {
    const base = { hunter_openid: String(openid || '').trim() }
    if (status && status !== 'all') {
      query = query.where({ ...base, status })
    } else {
      query = query.where(base)
    }
  } else if (type === 'open') {
    // 接单大厅：按 service_tags 过滤，指定单无视 service_tags
    const [{ data: allPaid }, { data: hunterArr }] = await Promise.all([
      db.collection('orders').where({ status: 'paid' }).orderBy('created_at', 'desc').limit(100).get(),
      db.collection('users').where({ openid }).limit(1).get()
    ])
    const hunterTags = new Set((hunterArr[0]?.hunter_info?.service_tags || []))
    const visible = allPaid.filter(o => {
      const ph  = String(o.preferred_hunter_openid    || '').trim()
      const pco = String(o.preferred_co_hunter_openid || '').trim()
      const isDesignatedToMe = ph === openid || pco === openid
      if (isDesignatedToMe) return true                        // 指定给我：必须显示
      if (ph || pco) return false                              // 指定给别人：不显示
      // 公开单：只有 service_tags 包含此服务才显示
      return hunterTags.size === 0 || hunterTags.has(o.service_id)
    })
    return { code: 0, data: { list: visible, hasMore: false } }
  } else if (type === 'admin') {
    // 管理员查全部
    if (status) query = query.where({ status })
  }

  const limit = type === 'hunter' && status === 'all' ? 100 : 50
  const { data } = await query.orderBy('created_at', 'desc').limit(limit).get()
  return { code: 0, data: { list: data, hasMore: false } }
}

function hunterDisplayFromOrder(ord) {
  const ho = String(ord.hunter_openid || '').trim()
  if (!ho) return null
  const tail = ho.length > 6 ? ho.slice(-6) : ho
  const snap = ord.hunter_snapshot
  if (snap && (snap.nickname || snap.nick_name)) {
    const nick = String(snap.nickname || snap.nick_name || '').trim()
    return { nickname: nick || '打手', openid_tail: tail }
  }
  return null
}

async function fetchHunterDisplay(hunterOpenid) {
  const ho = String(hunterOpenid || '').trim()
  if (!ho) return null
  const tail = ho.length > 6 ? ho.slice(-6) : ho
  const { data: arr } = await db.collection('users').where({ openid: ho }).limit(1).get()
  const u = arr && arr[0]
  const nick = (u && u.nickname && String(u.nickname).trim()) || '打手'
  return { nickname: nick, openid_tail: tail }
}

// 订单详情（附带本单打手展示信息，供老板/打手/管理员详情页使用）
async function getDetail(openid, event) {
  const { orderId } = event
  const { data } = await db.collection('orders').doc(orderId).get()
  const ord = data
  if (!ord) return { code: 0, data: null }
  let hunter_display = hunterDisplayFromOrder(ord)
  if (!hunter_display && ord.hunter_openid) {
    hunter_display = await fetchHunterDisplay(ord.hunter_openid)
  }
  return { code: 0, data: { ...ord, hunter_display } }
}

// 打手接单
async function takeOrder(openid, event) {
  const { orderId } = event
  const { data: order } = await db.collection('orders').doc(orderId).get()
  if (!order) throw new Error('订单不存在')
  if (order.status !== 'paid') throw new Error('订单状态不可接单')

  const hunterOid = String(openid || '').trim()
  let hunter_snapshot = { nickname: '打手', avatar_url: '' }
  try {
    const { data: hu } = await db.collection('users').where({ openid: hunterOid }).limit(1).get()
    const u = hu && hu[0]
    if (u) {
      const hunterNick = (u.hunter_info && String(u.hunter_info.hunter_nickname || '').trim())
                      || (u.nickname && String(u.nickname).trim())
                      || '打手'
      hunter_snapshot = {
        nickname:   hunterNick,
        avatar_url: u.avatar_url || ''
      }
    }
  } catch (e) {
    console.warn('[order] takeOrder hunter_snapshot', e)
  }

  await db.collection('orders').doc(orderId).update({
    data: {
      hunter_openid: hunterOid,
      hunter_snapshot,
      status: 'in_progress',
      taken_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  // 记录日志
  await db.collection('order_logs').add({ data: {
    order_id: orderId,
    operator_openid: openid,
    operator_role: 'hunter',
    action: '接单',
    content: '打手已接单，请耐心等待',
    images: [],
    created_at: db.serverDate()
  }})

  return { code: 0, data: { status: 'in_progress' } }
}

/** 开发：当前老板将待付款订单模拟为已付款（须 ENABLE_DEV_SIMULATE_PAID） */
async function devSimulatePaid(openid, event) {
  if (!ENABLE_DEV_SIMULATE_PAID) throw new Error('模拟支付未开启')
  const { orderId } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord || ord.boss_openid !== openid) throw new Error('无权限')
  if (ord.status !== 'pending_payment') throw new Error('订单状态异常')
  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'paid',
      'payment.paid_at': db.serverDate(),
      paid_at: db.serverDate(),
      'payment.dev_simulated': true,
      updated_at: db.serverDate()
    }
  })
  await db.collection('order_logs').add({
    data: {
      order_id: orderId,
      operator_openid: openid,
      operator_role: 'boss',
      action: '模拟支付（开发）',
      content: '开发环境标记为已付款，订单进入待接单',
      images: [],
      created_at: db.serverDate()
    }
  })
  return { code: 0, data: { status: 'paid' } }
}

/** 管理员软删除订单：标记为 deleted，保留记录，统计时排除 */
async function adminRemoveOrder(openid, event) {
  const user = await getUser(openid)
  if (!hasRole(user, 'admin')) throw new Error('无权限')
  const { orderId } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  await db.collection('orders').doc(orderId).update({
    data: { status: 'deleted', deleted_at: db.serverDate(), updated_at: db.serverDate() }
  })
  return { code: 0, data: {} }
}

// 更新订单状态
async function updateStatus(openid, event) {
  const { orderId, status } = event
  const user = await getUser(openid)
  if (status === 'completed' && hasRole(user, 'hunter')) {
    throw new Error('请上传结单截图，由管理员审核通过后入账')
  }
  if (status === 'paid') {
    throw new Error('无效操作')
  }

  // 退款：将总裁贝退回老板账户
  if (status === 'refunded') {
    const { data: ord } = await db.collection('orders').doc(orderId).get()
    // 只有余额支付的订单才归还总裁贝
    if (ord && ord.total_amount && ord.boss_openid && ord.payment?.method === 'balance') {
      await db.collection('users').where({ openid: ord.boss_openid }).update({
        data: {
          balance_fen:     _.inc(ord.total_amount),
          total_spent_fen: _.inc(-ord.total_amount),
          updated_at: db.serverDate()
        }
      })
    }
  }

  const updateData = { status, updated_at: db.serverDate() }
  if (status === 'completed') updateData.completed_at = db.serverDate()

  await db.collection('orders').doc(orderId).update({ data: updateData })

  // 记录日志
  const labelMap = {
    completed: '已完成',
    cancelled: '已取消',
    disputed: '发起争议',
    refunded: '已退款'
  }
  if (labelMap[status]) {
    await db.collection('order_logs').add({ data: {
      order_id: orderId,
      operator_openid: openid,
      operator_role: 'system',
      action: labelMap[status],
      content: labelMap[status],
      images: [],
      created_at: db.serverDate()
    }})
  }
  return { code: 0, data: { status } }
}

/** 打手：提交结单截图，待管理员确认后入账 */
async function submitSettlement(openid, event) {
  const { orderId, fileIds } = event
  const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : []
  if (!ids.length) throw new Error('请上传至少一张结单截图')

  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  if (String(ord.hunter_openid || '').trim() !== String(openid || '').trim()) throw new Error('无权限')
  if (ord.status !== 'in_progress') throw new Error('当前状态不可提交结单')

  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'pending_settlement',
      completion_proof: { file_ids: ids, submitted_at: db.serverDate() },
      updated_at: db.serverDate()
    }
  })

  await db.collection('order_logs').add({
    data: {
      order_id: orderId,
      operator_openid: openid,
      operator_role: 'hunter',
      action: '提交结单',
      content: '已上传结单截图，等待管理员审核',
      images: ids,
      created_at: db.serverDate()
    }
  })
  return { code: 0, data: { status: 'pending_settlement' } }
}

/** 管理员：确认结单，按打手当前分成比例写入 hunter_earn_fen 并入账钱包统计 */
async function confirmSettlement(openid, event) {
  const admin = await getUser(openid)
  if (!admin || !hasRole(admin, 'admin')) throw new Error('无权限')

  const { orderId } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  if (ord.status !== 'pending_settlement') throw new Error('订单不在待审核状态')

  const hunterOpenid = String(ord.hunter_openid || '').trim()
  if (!hunterOpenid) throw new Error('订单无打手')

  const { data: hu } = await db.collection('users').where({ openid: hunterOpenid }).limit(1).get()
  const hunter = hu[0] || {}
  let share = Number(hunter.hunter_share_percent)
  if (Number.isNaN(share) || share < 0) share = 70
  if (share > 100) share = 100
  share = Math.floor(share)

  const total = ord.total_amount || 0
  const hunter_earn_fen = Math.floor((total * share) / 100)

  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'completed',
      hunter_earn_fen,
      settlement_share_percent: share,
      completed_at: db.serverDate(),
      updated_at: db.serverDate(),
      settlement_confirmed_at: db.serverDate()
    }
  })

  await db.collection('order_logs').add({
    data: {
      order_id: orderId,
      operator_openid: openid,
      operator_role: 'admin',
      action: '结单审核通过',
      content: `管理员确认结单，打手分成 ${share}% ，入账 ${(hunter_earn_fen / 100).toFixed(2)} 元`,
      images: [],
      created_at: db.serverDate()
    }
  })
  console.log('[order] confirmSettlement ok', { orderId, hunterOpenid, hunter_earn_fen, share, total })
  return { code: 0, data: { status: 'completed', hunter_earn_fen, settlement_share_percent: share } }
}

/** 管理员：驳回结单打回进行中 */
async function rejectSettlement(openid, event) {
  const admin = await getUser(openid)
  if (!admin || !hasRole(admin, 'admin')) throw new Error('无权限')

  const { orderId, reason } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  if (ord.status !== 'pending_settlement') throw new Error('订单不在待审核状态')

  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'in_progress',
      settlement_reject_reason: String(reason || '请按要求重新上传截图').slice(0, 200),
      completion_proof: _.remove(),
      updated_at: db.serverDate()
    }
  })

  await db.collection('order_logs').add({
    data: {
      order_id: orderId,
      operator_openid: openid,
      operator_role: 'admin',
      action: '结单驳回',
      content: String(reason || '请重新提交结单材料').slice(0, 200),
      images: [],
      created_at: db.serverDate()
    }
  })
  return { code: 0, data: { status: 'in_progress' } }
}

// 添加进度日志
async function addLog(openid, event) {
  const { orderId, logAction, content, images } = event
  const user = await getUser(openid)
  const opRole = hasRole(user, 'admin') ? 'admin' : hasRole(user, 'hunter') ? 'hunter' : 'boss'
  const log = {
    order_id: orderId,
    operator_openid: openid,
    operator_role: opRole,
    action: logAction || '进度更新',
    content,
    images: images || [],
    created_at: db.serverDate()
  }
  const res = await db.collection('order_logs').add({ data: log })
  return { code: 0, data: { ...log, _id: res._id } }
}

// 获取订单日志
async function getLogs(event) {
  const { orderId } = event
  const { data } = await db.collection('order_logs')
    .where({ order_id: orderId })
    .orderBy('created_at', 'desc')
    .get()
  return { code: 0, data }
}

// 公开：今日出单数（首页展示用）
async function todayStats() {
  const today = new Date(); today.setHours(0,0,0,0)
  const res = await db.collection('orders')
    .where({ status: _.in(['completed', 'in_progress', 'pending_settlement']), created_at: _.gte(today) })
    .count()
  return { code: 0, today_count: res.total }
}

// 管理员数据概览
async function dashboard(openid) {
  const user = await getUser(openid)
  if (!user || !hasRole(user, 'admin')) throw new Error('无权限')

  const [total, pending, inProgress, pendingSettlement] = await Promise.all([
    db.collection('orders').where({ status: _.neq('deleted') }).count(),
    db.collection('orders').where({ status: 'paid' }).count(),
    db.collection('orders').where({ status: 'in_progress' }).count(),
    db.collection('orders').where({ status: 'pending_settlement' }).count()
  ])

  // 今日流水 + 今日出单数
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: todayOrders } = await db.collection('orders')
    .where({ status: 'completed', completed_at: _.gte(today) })
    .field({ total_amount: true })
    .get()
  const todayAmount = todayOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
  const todayCount  = todayOrders.length

  return {
    code: 0,
    data: {
      total: total.total,
      pending: pending.total,
      in_progress: inProgress.total,
      pending_settlement: pendingSettlement.total,
      today_amount: todayAmount,
      today_count: todayCount
    }
  }
}

/** 创建演示用测试单（1.5 总裁贝，内容真实，跳过余额检查） */
async function createTestOrder(openid, event) {
  if (event.secret !== 'CREATE_TEST_ORDER') throw new Error('secret 错误')
  const { data: users } = await db.collection('users').where({ openid }).limit(1).get()
  const user = users[0] || {}
  const now = db.serverDate()
  const order = {
    order_no: 'DT' + Date.now(),
    boss_openid: openid,
    boss_snapshot: { nickname: user.nickname || '测试老板', contact: user.contact || '' },
    hunter_openid: '',
    service_id: 'demo',
    service_snapshot: {
      category_name: '荣耀护航',
      service_name: '王者荣耀-黄金段位护航',
      price: 150,
      price_unit: '局',
      form_field_defs: [
        { key: 'game_id', label: '游戏ID / 房间号' },
        { key: 'rank', label: '当前段位' },
        { key: 'hero', label: '擅长英雄' }
      ]
    },
    form_data: {
      game_id: '测试玩家#8888',
      rank: '黄金三星',
      hero: '后羿、蒙犽'
    },
    remark: '演示用测试订单，请打手协助完成接单流程',
    quantity: 1,
    total_amount: 150,
    status: 'paid',
    payment: { method: 'balance', paid_at: now },
    created_at: now,
    updated_at: now
  }
  const res = await db.collection('orders').add({ data: order })
  return { code: 0, data: { _id: res._id, order_no: order.order_no } }
}

/** 一次性清空所有订单和日志（仅测试环境使用，需传正确 secret） */
async function clearAllOrders(event) {
  if (event.secret !== 'DELETE_ALL_TEST_ORDERS') throw new Error('secret 错误')
  let deleted = 0
  // 分批删除，每次最多 20 条（云函数限制）
  for (let i = 0; i < 100; i++) {
    const { data } = await db.collection('orders').limit(20).get()
    if (!data || data.length === 0) break
    await Promise.all(data.map(o => db.collection('orders').doc(o._id).remove()))
    deleted += data.length
  }
  // 同步清空 order_logs
  let logDeleted = 0
  for (let i = 0; i < 100; i++) {
    const { data } = await db.collection('order_logs').limit(20).get()
    if (!data || data.length === 0) break
    await Promise.all(data.map(l => db.collection('order_logs').doc(l._id).remove()))
    logDeleted += data.length
  }
  return { code: 0, data: { deleted, logDeleted } }
}

// 开发测试：模拟截图提交结单，跳过真实文件上传
async function devSubmitSettlement(openid, event) {
  const { orderId } = event
  return await submitSettlement(openid, {
    orderId,
    fileIds: ['dev-mock-screenshot-placeholder']
  })
}

// 打手拒绝指定单（清除自己的 preferred 字段，订单保持 paid 等待别人接）
async function rejectDesignated(openid, event) {
  const { orderId } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  if (ord.status !== 'paid') throw new Error('订单已被接单或关闭')

  const isPrimary = String(ord.preferred_hunter_openid    || '').trim() === openid
  const isCo      = String(ord.preferred_co_hunter_openid || '').trim() === openid
  if (!isPrimary && !isCo) throw new Error('你不是该指定单的打手')

  const update = { updated_at: db.serverDate() }
  if (isPrimary) update.preferred_hunter_openid    = ''
  if (isCo)      update.preferred_co_hunter_openid = ''

  await db.collection('orders').doc(orderId).update({ data: update })

  // 记录日志
  await db.collection('order_logs').add({
    data: {
      order_id:   orderId,
      action:     '拒绝指定',
      content:    '打手拒绝了指定，订单重新开放接单',
      operator:   openid,
      created_at: db.serverDate()
    }
  })
  return { code: 0, data: {} }
}

// 主打手邀请搭档（双打单接单后，主打手指定搭档）
async function assignCoHunter(openid, event) {
  const { orderId, coHunterOpenid } = event
  if (!orderId || !coHunterOpenid) throw new Error('参数缺失')
  if (coHunterOpenid === openid) throw new Error('不能邀请自己')

  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  if (String(ord.hunter_openid || '').trim() !== openid) throw new Error('只有接单打手可以邀请搭档')
  if (!ord.needs_co_hunter) throw new Error('此单不是双打单')
  if (ord.preferred_co_hunter_openid) throw new Error('已有搭档，如需更换请联系管理员')

  // 验证搭档是合法打手
  const { data: coArr } = await db.collection('users').where({ openid: coHunterOpenid }).limit(1).get()
  const coUser = coArr[0]
  if (!coUser || !(coUser.roles || []).includes('hunter')) throw new Error('对方不是打手')

  await db.collection('orders').doc(orderId).update({
    data: { preferred_co_hunter_openid: coHunterOpenid, updated_at: db.serverDate() }
  })
  await db.collection('order_logs').add({
    data: {
      order_id:   orderId,
      action:     '邀请搭档',
      content:    `主打手邀请了搭档`,
      operator:   openid,
      created_at: db.serverDate()
    }
  })
  return { code: 0, data: {} }
}
