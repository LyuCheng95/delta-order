const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event
  try {
    switch (action) {
      case 'getOrCreateOrderChat': return await getOrCreateOrderChat(OPENID, event)
      case 'getOrCreateCsChat':    return await getOrCreateCsChat(OPENID)
      case 'sendMessage':          return await sendMessage(OPENID, event)
      case 'listConversations':    return await listConversations(OPENID)
      case 'listMessages':         return await listMessages(OPENID, event)
      default: return { code: -1, msg: '未知操作' }
    }
  } catch (e) {
    console.error('[chat]', action, e)
    return { code: -1, msg: e.message || '服务器错误' }
  }
}

/* ── helpers ─────────────────────────────────────────────────── */

async function getUserDoc(openid) {
  const { data } = await db.collection('users').where({ openid }).limit(1).get()
  return data[0] || null
}

async function checkConvAccess(openid, conv) {
  if ((conv.members || []).includes(openid)) return true
  if (conv.has_admin_access) {
    const u = await getUserDoc(openid)
    return !!(u && (u.roles || []).includes('admin'))
  }
  return false
}

/* ── actions ─────────────────────────────────────────────────── */

/**
 * 幂等：按 order_id 查找或新建订单群聊。
 * 成员 = boss + hunter(s)；管理员通过 has_admin_access:true 动态接入。
 */
async function getOrCreateOrderChat(openid, event) {
  const { orderId } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')

  const u = await getUserDoc(openid)
  if (!u) throw new Error('用户不存在')

  const isAdmin  = (u.roles || []).includes('admin')
  const isBoss   = ord.boss_openid === openid
  const isHunter = ord.hunter_openid === openid || ord.co_hunter_openid === openid
  if (!isAdmin && !isBoss && !isHunter) throw new Error('无权限')

  // Return existing conv
  const { data: existing } = await db.collection('conversations')
    .where({ order_id: orderId }).limit(1).get()
  if (existing.length > 0) return { code: 0, data: existing[0] }

  // Build member list (boss + hunters only; admins via flag)
  const memberOids = [String(ord.boss_openid)]
  if (ord.hunter_openid)    memberOids.push(String(ord.hunter_openid))
  if (ord.co_hunter_openid) memberOids.push(String(ord.co_hunter_openid))

  const { data: memberUsers } = await db.collection('users')
    .where({ openid: _.in(memberOids) }).limit(10).get()

  const member_snapshots = memberUsers.map(mu => ({
    openid:     mu.openid,
    nickname:   mu.nickname || '用户',
    avatar_url: mu.avatar_url || '',
    role: (mu.roles || []).includes('hunter') ? 'hunter' : 'boss'
  }))

  const serviceName = (ord.service_snapshot && ord.service_snapshot.service_name) || ''
  const conv = {
    type:               'order_group',
    order_id:           orderId,
    order_no:           ord.order_no || '',
    service_name:       serviceName,
    members:            memberOids,
    member_snapshots,
    has_admin_access:   true,
    last_msg:           '群聊已创建',
    last_msg_time:      db.serverDate(),
    last_sender_openid: '',
    created_at:         db.serverDate()
  }

  const res = await db.collection('conversations').add({ data: conv })
  const convId = res._id

  // System welcome message
  await db.collection('messages').add({
    data: {
      conv_id:         convId,
      sender_openid:   '',
      sender_snapshot: { nickname: '系统', avatar_url: '', role: 'system' },
      type:            'system',
      content:         `订单群聊已创建 — ${serviceName || ord.order_no}`,
      created_at:      db.serverDate()
    }
  })

  return { code: 0, data: { ...conv, _id: convId } }
}

/**
 * 幂等：为当前 boss 创建或返回已有的客服会话。
 * admin 通过 has_admin_access:true 动态接入，不占 members 槽位。
 */
async function getOrCreateCsChat(openid) {
  const { data: existing } = await db.collection('conversations')
    .where({ type: 'customer_service', boss_openid: openid })
    .limit(1).get()
  if (existing.length > 0) return { code: 0, data: existing[0] }

  const u = await getUserDoc(openid)
  const member_snapshots = [{
    openid,
    nickname:   (u && u.nickname)   || '用户',
    avatar_url: (u && u.avatar_url) || '',
    role: 'boss'
  }]

  const conv = {
    type:               'customer_service',
    boss_openid:        openid,
    members:            [openid],
    member_snapshots,
    has_admin_access:   true,
    last_msg:           '客服会话已创建',
    last_msg_time:      db.serverDate(),
    last_sender_openid: '',
    created_at:         db.serverDate()
  }

  const res = await db.collection('conversations').add({ data: conv })
  const convId = res._id

  await db.collection('messages').add({
    data: {
      conv_id:         convId,
      sender_openid:   '',
      sender_snapshot: { nickname: '系统', avatar_url: '', role: 'system' },
      type:            'system',
      content:         '客服会话已开始，请描述您的问题，客服将尽快回复 😊',
      created_at:      db.serverDate()
    }
  })

  return { code: 0, data: { ...conv, _id: convId } }
}

async function sendMessage(openid, event) {
  const { convId, type, content } = event
  if (!convId)  throw new Error('convId 不能为空')
  if (!content) throw new Error('消息内容不能为空')

  const { data: conv } = await db.collection('conversations').doc(convId).get()
  if (!conv) throw new Error('会话不存在')
  if (!(await checkConvAccess(openid, conv))) throw new Error('无权限')

  const u = await getUserDoc(openid)
  const roleStr = u
    ? ((u.roles || []).includes('admin')  ? 'admin'
     : (u.roles || []).includes('hunter') ? 'hunter' : 'boss')
    : 'boss'

  const sender_snapshot = {
    openid,
    nickname:   (u && u.nickname)   || '用户',
    avatar_url: (u && u.avatar_url) || '',
    role:       roleStr
  }

  const msgType = type === 'image' ? 'image' : 'text'
  const msg = {
    conv_id:         convId,
    sender_openid:   openid,
    sender_snapshot,
    type:            msgType,
    content:         String(content || ''),
    created_at:      db.serverDate()
  }

  const res = await db.collection('messages').add({ data: msg })

  await db.collection('conversations').doc(convId).update({
    data: {
      last_msg:           msgType === 'image' ? '[图片]' : String(content).slice(0, 40),
      last_msg_time:      db.serverDate(),
      last_sender_openid: openid
    }
  })

  return { code: 0, data: { ...msg, _id: res._id } }
}

async function listConversations(openid) {
  const u = await getUserDoc(openid)
  const isAdmin = u && (u.roles || []).includes('admin')

  let convs = []
  if (isAdmin) {
    const { data } = await db.collection('conversations')
      .where({ has_admin_access: true })
      .orderBy('last_msg_time', 'desc')
      .limit(100).get()
    convs = data
  } else {
    const { data } = await db.collection('conversations')
      .where({ members: openid })
      .orderBy('last_msg_time', 'desc')
      .limit(50).get()
    convs = data
  }
  return { code: 0, data: convs }
}

async function listMessages(openid, event) {
  const { convId, skip = 0 } = event
  if (!convId) throw new Error('convId 不能为空')

  const { data: conv } = await db.collection('conversations').doc(convId).get()
  if (!conv) throw new Error('会话不存在')
  if (!(await checkConvAccess(openid, conv))) throw new Error('无权限')

  const { data } = await db.collection('messages')
    .where({ conv_id: convId })
    .orderBy('created_at', 'asc')
    .skip(skip)
    .limit(50)
    .get()
  return { code: 0, data }
}
