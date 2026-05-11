const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ── 内容安全检测 ──

async function checkTextSecurity(openid, content, scene) {
  if (!content || !String(content).trim()) return
  try {
    const result = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: scene || 2,
      version: 2,
      content: String(content).trim()
    })
    const suggest = result && result.result && result.result.suggest
    if (suggest === 'risky' || suggest === 'review') {
      throw new Error('VIOLATION')
    }
  } catch (e) {
    if (e.message === 'VIOLATION') throw new Error('内容含有违规信息，请修改后重新提交')
    console.warn('[msgSecCheck]', e.message)
  }
}

async function checkImageSecurity(openid, fileID) {
  try {
    const { fileList } = await cloud.getTempFileURL({ fileList: [fileID] })
    const tempUrl = fileList && fileList[0] && fileList[0].tempFileURL
    if (!tempUrl) return
    const result = await cloud.openapi.security.imgSecCheck({
      openid,
      scene: 1,
      version: 2,
      imageUrl: tempUrl
    })
    const suggest = result && result.result && result.result.suggest
    if (suggest === 'risky' || suggest === 'review') {
      cloud.deleteFile({ fileList: [fileID] }).catch(() => {})
      throw new Error('VIOLATION')
    }
  } catch (e) {
    if (e.message === 'VIOLATION') throw new Error('图片含有违规内容，请更换后重试')
    console.warn('[imgSecCheck]', e.message)
  }
}

const ROLES = ['boss', 'hunter', 'admin']
function normalizeRole(r) {
  const x = String(r == null ? '' : r).trim().toLowerCase()
  return ROLES.includes(x) ? x : 'boss'
}

/** 合并 roles 数组与历史单字段 role */
function normalizeRolesArray(u) {
  if (!u) return ['boss']
  let arr = []
  if (Array.isArray(u.roles) && u.roles.length) {
    arr = u.roles.map(normalizeRole).filter(x => ROLES.includes(x))
  }
  if (!arr.length && u.role) arr = [normalizeRole(u.role)]
  arr = [...new Set(arr)]
  if (!arr.length) arr = ['boss']
  return arr
}

/** 多身份时默认「主展示角色」：老板优先，其次打手，最后管理（与登录落地页 boss 优先一致） */
function pickStoredRole(roles) {
  if (roles.includes('boss')) return 'boss'
  if (roles.includes('hunter')) return 'hunter'
  return 'admin'
}

function hasRole(u, want) {
  if (!u) return false
  return normalizeRolesArray(u).includes(normalizeRole(want))
}

function sanitizeUserDoc(u) {
  if (!u) return u
  const roles = normalizeRolesArray(u)
  const pref = normalizeRole(u.role)
  const role = roles.includes(pref) ? pref : pickStoredRole(roles)
  return { ...u, roles, role }
}

// 生成订单号
const genOrderNo = () => 'DT' + Date.now()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  try {
    switch (action) {
      case 'login':       return await login(OPENID, event)
      case 'getRole':        return await getRole(OPENID)
      case 'refreshProfile': return await refreshProfile(OPENID)
      /** 开发用：users 恰为 1 条时，写入三身份（boss+hunter+admin）。勿在生产长期保留入口。 */
      case 'grantTripleRolesIfSoleUser': return await grantTripleRolesIfSoleUser()
      case 'applyHunter':    return await applyHunter(OPENID, event)
      case 'updateBankCard':  return await updateBankCard(OPENID, event)
      case 'updateNickname':  return await updateNickname(OPENID, event)
      case 'updateContact':   return await updateContact(OPENID, event)
      case 'updateAvatar':    return await updateAvatar(OPENID, event)
      case 'switchRole':  return await switchRole(OPENID, event)
      case 'listHunterApply': return await listHunterApply(OPENID)
      case 'reviewHunter':    return await reviewHunter(OPENID, event)
      case 'banUser':         return await banUser(OPENID, event)
      case 'listActiveHunters': return await listActiveHunters(OPENID)
      case 'listHuntersForPairing': return await listHuntersForPairing(OPENID)
      case 'updateHunterShare':   return await updateHunterShare(OPENID, event)
      case 'dismissHunter':       return await dismissHunter(OPENID, event)
      case 'updateHunterProfile':    return await updateHunterProfile(OPENID, event)
      case 'setHunterAdminHidden':   return await setHunterAdminHidden(OPENID, event)
      case 'listHuntersForBoss':     return await listHuntersForBoss(OPENID)
      case 'recordHunterView':     return await recordHunterView(OPENID, event)
      case 'getHunterPublic':      return await getHunterPublic(OPENID, event)
      case 'devSeedMockHunters':    return await devSeedMockHunters()
      case 'devDeleteMockHunters':  return await devDeleteMockHunters()
      case 'searchUsersByNickname': return await searchUsersByNickname(OPENID, event)
      default: return { code: -1, msg: '未知操作' }
    }
  } catch (e) {
    console.error('[auth]', action, e)
    return { code: -1, msg: e.message || '服务器错误' }
  }
}

// 登录 / 注册
async function login(openid, event) {
  const { nickname, avatar_url } = event
  const col = db.collection('users')
  const { data } = await col.where({ openid }).get()

  if (data.length === 0) {
    // 新用户，创建账号
    const user = {
      openid,
      nickname: nickname || '玩家' + openid.slice(-4),
      avatar_url: avatar_url || '',
      role: 'boss',
      roles: ['boss'],
      hunter_info: { apply_status: 'none' },
      is_banned: false,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
    await col.add({ data: user })
    return { code: 0, data: sanitizeUserDoc({ ...user }) }
  }

  const user = data[0]
  if (user.is_banned) return { code: -1, msg: '账号已被封禁' }

  // 老数据补全 roles
  if (!Array.isArray(user.roles) || user.roles.length === 0) {
    const computed = normalizeRolesArray(user)
    await col.doc(user._id).update({
      data: {
        roles: computed,
        role: pickStoredRole(computed),
        updated_at: db.serverDate()
      }
    })
    user.roles = computed
    user.role = pickStoredRole(computed)
  }

  // 更新昵称头像：如果传了新昵称就更新；如果存的是"微信用户"或空，自动替换成玩家编号
  const badNickname = !user.nickname || user.nickname === '微信用户'
  if (nickname) {
    await col.doc(user._id).update({ data: { nickname, avatar_url, updated_at: db.serverDate() } })
  } else if (badNickname) {
    const autoNick = '玩家' + openid.slice(-4)
    await col.doc(user._id).update({ data: { nickname: autoNick, updated_at: db.serverDate() } })
    user.nickname = autoNick
  }

  return {
    code: 0,
    data: sanitizeUserDoc({
      ...user,
      nickname: nickname || user.nickname,
      avatar_url: avatar_url || user.avatar_url
    })
  }
}

// 获取当前角色
async function getRole(openid) {
  const { data } = await db.collection('users').where({ openid }).get()
  if (!data.length) return { code: -1, msg: '用户不存在' }
  return { code: 0, data: sanitizeUserDoc(data[0]) }
}

/** 从数据库拉取最新用户信息（与登录返回结构一致）；顺带补全老数据的 roles，便于审核通过等场景后无需重新登录 */
async function refreshProfile(openid) {
  const col = db.collection('users')
  const { data } = await col.where({ openid }).get()
  if (!data.length) return { code: -1, msg: '用户不存在' }
  let user = data[0]
  if (user.is_banned) return { code: -1, msg: '账号已被封禁' }

  if (!Array.isArray(user.roles) || user.roles.length === 0) {
    const computed = normalizeRolesArray(user)
    await col.doc(user._id).update({
      data: {
        roles: computed,
        role: pickStoredRole(computed),
        updated_at: db.serverDate()
      }
    })
    user = { ...user, roles: computed, role: pickStoredRole(computed) }
  }

  return { code: 0, data: sanitizeUserDoc({ ...user }) }
}

/**
 * 仅当 users 集合恰好 1 条记录时，将该用户设为 boss+hunter+admin。
 * 在云开发控制台 → 云函数 → auth → 测试，入参：{"action":"grantTripleRolesIfSoleUser"}
 */
async function grantTripleRolesIfSoleUser() {
  const col = db.collection('users')
  const { data } = await col.limit(2).get()
  if (data.length !== 1) {
    return { code: -1, msg: `需恰好 1 个用户才可执行，当前 ${data.length} 条` }
  }
  const u = data[0]
  const roles = ['boss', 'hunter', 'admin']
  await col.doc(u._id).update({
    data: {
      roles,
      role: 'boss',
      hunter_share_percent: u.hunter_share_percent != null ? u.hunter_share_percent : 70,
      'hunter_info.apply_status': 'approved',
      'hunter_info.approved_time': db.serverDate(),
      updated_at: db.serverDate()
    }
  })
  const { data: fresh } = await col.doc(u._id).get()
  return { code: 0, data: sanitizeUserDoc(fresh), msg: '已写入三身份' }
}

// 申请成为打手
async function applyHunter(openid, event) {
  const { apply_reason, hunter_nickname, contact, bio } = event
  const { data: users } = await db.collection('users').where({ openid }).limit(1).get()
  const u = users[0]
  if (!u) throw new Error('用户不存在')
  if (u.is_banned) throw new Error('账号已被封禁')
  if (hasRole(u, 'hunter')) throw new Error('已是在职陪玩师，无需重复申请')
  await checkTextSecurity(openid, hunter_nickname, 5)
  if (bio) await checkTextSecurity(openid, bio, 2)
  await checkTextSecurity(openid, apply_reason, 2)
  const updateData = {
    'hunter_info.apply_status':    'pending',
    'hunter_info.apply_reason':    apply_reason,
    'hunter_info.hunter_nickname': String(hunter_nickname || '').trim(),
    'hunter_info.apply_time':      db.serverDate(),
    updated_at: db.serverDate()
  }
  if (contact) updateData.contact = String(contact).trim().slice(0, 50)
  if (bio) updateData['hunter_info.bio'] = String(bio).trim().slice(0, 100)
  await db.collection('users').where({ openid }).update({ data: updateData })
  return { code: 0, data: { apply_status: 'pending' } }
}

async function updateHunterProfile(openid, event) {
  const { data: users } = await db.collection('users').where({ openid }).limit(1).get()
  const u = users[0]
  if (!u || !hasRole(u, 'hunter')) throw new Error('无权限')

  const { bio, play_style, service_tags, portfolio, is_visible } = event
  if (bio !== undefined) await checkTextSecurity(openid, bio, 2)
  if (play_style !== undefined) await checkTextSecurity(openid, play_style, 2)
  const update = { updated_at: db.serverDate() }

  if (bio !== undefined)
    update['hunter_info.bio'] = String(bio || '').trim().slice(0, 100)
  if (play_style !== undefined)
    update['hunter_info.play_style'] = String(play_style || '').trim().slice(0, 50)
  if (service_tags !== undefined)
    update['hunter_info.service_tags'] = Array.isArray(service_tags) ? service_tags.slice(0, 50) : []
  if (portfolio !== undefined)
    update['hunter_info.portfolio'] = Array.isArray(portfolio) ? portfolio.slice(0, 9) : []
  if (is_visible !== undefined)
    update['hunter_info.is_visible'] = is_visible !== false

  await db.collection('users').where({ openid }).update({ data: update })
  return { code: 0, data: {} }
}

// 更新头像
async function updateAvatar(openid, event) {
  const avatar_url = String(event.avatar_url || '').trim()
  if (!avatar_url) throw new Error('头像地址不能为空')
  await checkImageSecurity(openid, avatar_url)
  await db.collection('users').where({ openid }).update({
    data: { avatar_url, updated_at: db.serverDate() }
  })
  return { code: 0, data: { avatar_url } }
}

// 更新昵称
async function updateNickname(openid, event) {
  const nickname = String(event.nickname || '').trim()
  if (!nickname) throw new Error('昵称不能为空')
  if (nickname.length > 20) throw new Error('昵称最多20个字符')
  await checkTextSecurity(openid, nickname, 5)
  await db.collection('users').where({ openid }).update({
    data: { nickname, updated_at: db.serverDate() }
  })
  return { code: 0, data: { nickname } }
}

// 更新联系方式（老板填写微信号或手机号供管理员联系）
async function updateContact(openid, event) {
  const contact = String(event.contact || '').trim().slice(0, 50)
  await db.collection('users').where({ openid }).update({
    data: { contact, updated_at: db.serverDate() }
  })
  return { code: 0, data: { contact } }
}

// 打手更新银行卡号
async function updateBankCard(openid, event) {
  const { bank_card } = event
  const card = String(bank_card || '').replace(/\s/g, '')
  if (!card || card.length < 16) throw new Error('请填写正确的银行卡号（至少16位）')
  const { data } = await db.collection('users').where({ openid }).get()
  if (!data.length) throw new Error('用户不存在')
  const u = data[0]
  const isHunter = (u.roles || []).includes('hunter') ||
    (u.hunter_info && u.hunter_info.apply_status === 'approved')
  if (!isHunter) throw new Error('仅打手可操作')
  await db.collection('users').where({ openid }).update({
    data: { 'hunter_info.bank_card': card, updated_at: db.serverDate() }
  })
  return { code: 0, data: { bank_card: card } }
}

// 切换「当前偏好身份」（仅改 role 字段，须已在 roles 内）下次 getRole/login 仍会按 roles 纠偏主身份
async function switchRole(openid, event) {
  const { role } = event
  const r = normalizeRole(role)
  if (!ROLES.includes(r)) throw new Error('无效角色')
  const { data } = await db.collection('users').where({ openid }).get()
  if (!data.length) throw new Error('用户不存在')
  const cur = normalizeRolesArray(data[0])
  if (!cur.includes(r)) throw new Error('你暂无该身份')
  await db.collection('users').where({ openid }).update({
    data: { role: r, updated_at: db.serverDate() }
  })
  return { code: 0, data: { role: r } }
}

// 管理员：列出打手申请
async function listHunterApply(openid) {
  await requireAdmin(openid)
  const { data } = await db.collection('users')
    .where({ 'hunter_info.apply_status': _.neq('none') })
    .orderBy('hunter_info.apply_time', 'desc')
    .get()
  return { code: 0, data }
}

// 管理员：审核打手
async function reviewHunter(openid, event) {
  await requireAdmin(openid)
  const { userId, decision, reason } = event
  if (decision !== 'approve' && decision !== 'reject') throw new Error('无效审核操作')
  if (decision === 'reject') {
    await db.collection('users').doc(userId).update({
      data: {
        'hunter_info.apply_status': 'rejected',
        'hunter_info.rejected_reason': reason || '',
        updated_at: db.serverDate()
      }
    })
    return { code: 0, data: { decision } }
  }

  const { data: row } = await db.collection('users').doc(userId).get()
  if (!row) throw new Error('用户不存在')
  const newRoles = [...new Set([...normalizeRolesArray(row), 'hunter'])]
  await db.collection('users').doc(userId).update({
    data: {
      'hunter_info.apply_status': 'approved',
      'hunter_info.approved_time': db.serverDate(),
      roles: newRoles,
      role: pickStoredRole(newRoles),
      hunter_share_percent: 70,
      updated_at: db.serverDate()
    }
  })
  return { code: 0, data: { decision } }
}

// 管理员：在职打手列表 + 近期业绩（已完成单数、累计分成入账分）
async function listActiveHunters(openid) {
  await requireAdmin(openid)
  const { data: all } = await db.collection('users').limit(500).get()
  const hunters = all.filter(u => hasRole(u, 'hunter'))
  if (!hunters.length) return { code: 0, data: [] }

  const { data: orders } = await db.collection('orders')
    .where({ status: 'completed' })
    .limit(800)
    .field({ hunter_openid: true, hunter_earn_fen: true, total_amount: true, preferred_co_hunter_openid: true, co_hunter_earn_fen: true })
    .get()

  const stats = {}
  for (const o of orders) {
    const h = o.hunter_openid
    if (h) {
      if (!stats[h]) stats[h] = { completed: 0, earned_fen: 0 }
      stats[h].completed++
      const fen = o.hunter_earn_fen != null && o.hunter_earn_fen >= 0 ? o.hunter_earn_fen : (o.total_amount || 0)
      stats[h].earned_fen += fen
    }
    // 协同打手收益
    const co = String(o.preferred_co_hunter_openid || '').trim()
    if (co && o.co_hunter_earn_fen > 0) {
      if (!stats[co]) stats[co] = { completed: 0, earned_fen: 0 }
      stats[co].completed++
      stats[co].earned_fen += Number(o.co_hunter_earn_fen) || 0
    }
  }

  const list = hunters.map(u => ({
    ...u,
    share_percent: u.hunter_share_percent != null ? u.hunter_share_percent : 70,
    completed_count: stats[u.openid]?.completed || 0,
    earned_fen: stats[u.openid]?.earned_fen || 0
  }))
  return { code: 0, data: list }
}

// 在职打手互相查看搭档列表（只有打手才可以调用，排除自己）
async function listHuntersForPairing(openid) {
  const { data: callerArr } = await db.collection('users').where({ openid }).limit(1).get()
  const caller = callerArr[0]
  if (!caller || !hasRole(caller, 'hunter')) throw new Error('仅陪玩师可查看搭档列表')
  const { data: all } = await db.collection('users').limit(200).get()
  const list = all
    .filter(u => hasRole(u, 'hunter') && u.openid !== openid)
    .map(u => ({
      openid: u.openid,
      nickname: u.nickname || '陪玩师',
      avatar_url: u.avatar_url || '',
      contact: u.contact || ''
    }))
  return { code: 0, data: list }
}

async function updateHunterShare(openid, event) {
  await requireAdmin(openid)
  const { userId, share_percent } = event
  let p = Number(share_percent)
  if (Number.isNaN(p) || p < 0 || p > 100) throw new Error('分成比例需在 0～100')
  p = Math.floor(p)
  const { data: u } = await db.collection('users').doc(userId).get()
  if (!u || !hasRole(u, 'hunter')) throw new Error('目标不是在职打手')
  await db.collection('users').doc(userId).update({
    data: { hunter_share_percent: p, updated_at: db.serverDate() }
  })
  return { code: 0, data: { share_percent: p } }
}

async function dismissHunter(openid, event) {
  await requireAdmin(openid)
  const { userId } = event
  const { data: u } = await db.collection('users').doc(userId).get()
  if (!u || !hasRole(u, 'hunter')) throw new Error('目标不是在职打手')
  let nextRoles = normalizeRolesArray(u).filter(r => r !== 'hunter')
  if (!nextRoles.length) nextRoles = ['boss']
  await db.collection('users').doc(userId).update({
    data: {
      roles: nextRoles,
      role: pickStoredRole(nextRoles),
      'hunter_info.apply_status': 'dismissed',
      'hunter_info.dismissed_at': db.serverDate(),
      hunter_share_percent: _.remove(),
      is_banned: true,
      updated_at: db.serverDate()
    }
  })
  return { code: 0, data: {} }
}

// 管理员：封禁用户
async function banUser(openid, event) {
  await requireAdmin(openid)
  const { userId, ban } = event
  await db.collection('users').doc(userId).update({ data: { is_banned: ban !== false, updated_at: db.serverDate() } })
  return { code: 0, data: {} }
}

async function requireAdmin(openid) {
  const { data } = await db.collection('users').where({ openid }).get()
  if (!data.length || !hasRole(data[0], 'admin')) throw new Error('无权限')
}

// 老板端：在职打手列表，按亲密度+完成单数排序
async function ensureBossHunterAffinityCol() {
  try { await db.createCollection('boss_hunter_affinity') } catch (_) {}
}

async function setHunterAdminHidden(openid, event) {
  await requireAdmin(openid)
  const { targetOpenid, hidden } = event
  if (!targetOpenid) throw new Error('缺少 targetOpenid')
  await db.collection('users').where({ openid: targetOpenid }).update({
    data: { 'hunter_info.admin_hidden': !!hidden, updated_at: db.serverDate() }
  })
  return { code: 0 }
}

async function listHuntersForBoss(bossOpenid) {
  await ensureBossHunterAffinityCol()

  const { data: all } = await db.collection('users').limit(500).get()
  const hunters = all.filter(u =>
    hasRole(u, 'hunter') &&
    u.hunter_info?.apply_status === 'approved' &&
    u.hunter_info?.admin_hidden !== true &&
    u.hunter_info?.is_visible !== false &&
    u.avatar_url &&
    u.nickname &&
    u.hunter_info?.bio &&
    (u.hunter_info?.service_tags || []).length > 0
  )
  if (!hunters.length) return { code: 0, data: [] }

  // 服务 ID → 名称映射
  const { data: svcs } = await db.collection('services').limit(500).get()
  const svcNameMap = {}
  for (const s of svcs) svcNameMap[s._id] = s.name

  // 完成单数
  const { data: orders } = await db.collection('orders')
    .where({ status: 'completed' })
    .limit(800)
    .field({ hunter_openid: true })
    .get()
  const completedMap = {}
  for (const o of orders) {
    if (o.hunter_openid) completedMap[o.hunter_openid] = (completedMap[o.hunter_openid] || 0) + 1
  }

  // 亲密度：boss 对每个打手的查看次数
  const { data: affinities } = await db.collection('boss_hunter_affinity')
    .where({ boss_openid: bossOpenid })
    .limit(200)
    .get()
  const affinityMap = {}
  for (const a of affinities) affinityMap[a.hunter_openid] = a.view_count || 0

  const list = hunters.map(u => ({
    openid:        u.openid,
    nickname:      u.nickname || '陪玩师',
    avatar_url:    u.avatar_url || '',
    bio:           u.hunter_info?.bio || '',
    play_style:    u.hunter_info?.play_style || '',
    service_tags:  (u.hunter_info?.service_tags || []).map(id => svcNameMap[id] || id).filter(Boolean),
    portfolio:     (u.hunter_info?.portfolio || []).slice(0, 3),
    completed_count: completedMap[u.openid] || 0,
    affinity:      affinityMap[u.openid] || 0
  }))

  list.sort((a, b) => b.affinity - a.affinity || b.completed_count - a.completed_count)
  return { code: 0, data: list }
}

// 老板查看打手主页时记录亲密度
async function recordHunterView(bossOpenid, event) {
  const { hunterOpenid } = event
  if (!hunterOpenid || hunterOpenid === bossOpenid) return { code: 0 }
  await ensureBossHunterAffinityCol()
  const { data: existing } = await db.collection('boss_hunter_affinity')
    .where({ boss_openid: bossOpenid, hunter_openid: hunterOpenid })
    .limit(1).get()
  if (existing.length > 0) {
    await db.collection('boss_hunter_affinity').doc(existing[0]._id).update({
      data: { view_count: _.inc(1), last_viewed_at: db.serverDate() }
    })
  } else {
    await db.collection('boss_hunter_affinity').add({
      data: { boss_openid: bossOpenid, hunter_openid: hunterOpenid, view_count: 1, last_viewed_at: db.serverDate(), created_at: db.serverDate() }
    })
  }
  return { code: 0 }
}

// 公开打手资料（老板查看详情）
async function getHunterPublic(bossOpenid, event) {
  const { hunterOpenid } = event
  const { data: users } = await db.collection('users').where({ openid: hunterOpenid }).limit(1).get()
  const u = users[0]
  if (!u || !hasRole(u, 'hunter')) throw new Error('打手不存在')
  return {
    code: 0,
    data: {
      openid:          u.openid,
      nickname:        u.nickname || '陪玩师',
      avatar_url:      u.avatar_url || '',
      bio:             u.hunter_info?.bio || '',
      play_style:      u.hunter_info?.play_style || '',
      service_tags:    u.hunter_info?.service_tags || [],
      portfolio:       u.hunter_info?.portfolio || [],
      completed_count: 0
    }
  }
}

// ── 开发工具：一键生成模拟打手 ──
const MOCK_HUNTERS = [
  {
    openid: 'mock_hunter_lena',
    nickname: '雷纳战神',
    avatar_url: 'https://api.dicebear.com/9.x/pixel-art/png?seed=lena&size=120',
    bio: '王者荣耀最强上单，段位星耀，帮你快速上分！',
    play_style: '稳健型，话少效率高',
    service_tags: ['王者荣耀', '陪玩上分'],
    share_percent: 70
  },
  {
    openid: 'mock_hunter_nova',
    nickname: '星辰Nova',
    avatar_url: 'https://api.dicebear.com/9.x/pixel-art/png?seed=nova&size=120',
    bio: '和平精英职业级射手，鸡肉飞起！活泼有趣，语音陪玩超开心。',
    play_style: '活泼开朗，话多有趣',
    service_tags: ['和平精英', '吃鸡陪玩'],
    share_percent: 65
  },
  {
    openid: 'mock_hunter_rex',
    nickname: '暗影REX',
    avatar_url: 'https://api.dicebear.com/9.x/pixel-art/png?seed=rex&size=120',
    bio: '英雄联盟钻石选手，精通中单打野，上分保障，高胜率接单。',
    play_style: '专注高效，不磨蹭',
    service_tags: ['英雄联盟', '陪玩上分'],
    share_percent: 70
  },
  {
    openid: 'mock_hunter_yuki',
    nickname: '雪绫Yuki',
    avatar_url: 'https://api.dicebear.com/9.x/pixel-art/png?seed=yuki&size=120',
    bio: '原神深渊满星大佬，剧情攻略、组队刷本都可以，温柔耐心。',
    play_style: '温柔耐心，细致讲解',
    service_tags: ['原神', '多人组队'],
    share_percent: 60
  }
]

async function devSeedMockHunters() {
  const col = db.collection('users')
  const results = []
  for (const h of MOCK_HUNTERS) {
    const { data: existing } = await col.where({ openid: h.openid }).limit(1).get()
    if (existing.length) {
      await col.doc(existing[0]._id).update({
        data: {
          nickname:   h.nickname,
          avatar_url: h.avatar_url,
          roles: ['hunter'],
          role:  'hunter',
          'hunter_info.apply_status': 'approved',
          'hunter_info.bio':          h.bio,
          'hunter_info.play_style':   h.play_style,
          'hunter_info.service_tags': h.service_tags,
          'hunter_info.share_percent': h.share_percent,
          updated_at: db.serverDate()
        }
      })
      results.push(`更新 ${h.nickname}`)
    } else {
      await col.add({
        data: {
          openid:     h.openid,
          nickname:   h.nickname,
          avatar_url: h.avatar_url,
          role:       'hunter',
          roles:      ['hunter'],
          is_banned:  false,
          hunter_info: {
            apply_status:  'approved',
            approved_time: db.serverDate(),
            bio:           h.bio,
            play_style:    h.play_style,
            service_tags:  h.service_tags,
            share_percent: h.share_percent
          },
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })
      results.push(`新建 ${h.nickname}`)
    }
  }
  return { code: 0, data: { results } }
}

async function searchUsersByNickname(adminOpenid, event) {
  await requireAdmin(adminOpenid)
  const kw = String(event.keyword || '').trim()
  if (!kw) return { code: 0, data: [] }
  const { data } = await db.collection('users')
    .where(db.command.expr(
      db.command.aggregate.regexMatch({
        input: '$nickname',
        regex: kw,
        options: 'i'
      })
    ))
    .field({ openid: true, nickname: true, avatar_url: true, contact: true })
    .limit(20)
    .get()
  return { code: 0, data }
}

async function devDeleteMockHunters() {
  const col = db.collection('users')
  const openids = MOCK_HUNTERS.map(h => h.openid)
  const deleted = []
  for (const openid of openids) {
    const { data } = await col.where({ openid }).limit(1).get()
    if (data.length) {
      await col.doc(data[0]._id).remove()
      deleted.push(openid)
    }
  }
  return { code: 0, data: { deleted: deleted.length } }
}
