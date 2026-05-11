const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

function hasRole(u, want) {
  if (!u) return false
  return normalizeRolesArray(u).includes(normalizeRole(want))
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event
  try {
    switch (action) {
      case 'listCategories':      return await listCategories()
      case 'listByCategory':      return await listByCategory(event)
      case 'listCategoriesAdmin': return await listCategoriesAdmin(OPENID)
      case 'listServicesAdmin':   return await listServicesAdmin(OPENID, event)
      case 'detail':              return await detail(event)
      case 'upsertCategory':      return await upsertCategory(OPENID, event)
      case 'upsertService':       return await upsertService(OPENID, event)
      case 'deleteCategory':      return await deleteCategory(OPENID, event)
      case 'deleteService':       return await deleteService(OPENID, event)
      case 'createTestService':   return await createTestService(event)
      case 'toggleServiceActive': return await toggleServiceActive(OPENID, event)
      case 'updateCatOrder':      return await updateCatOrder(OPENID, event)
      case 'updateSvcOrder':      return await updateSvcOrder(OPENID, event)
      case 'listCatsForUser':     return await listCategories()
      case 'listAllForBoss':      return await listAllForBoss()
      case 'getConfig':           return await getConfig(event)
      case 'setConfig':           return await setConfig(OPENID, event)
      case 'setAllCoHunter':      return await setAllCoHunter(OPENID, event)
      case 'listAllForHunter':    return await listAllForHunter(OPENID)
      default: return { code: -1, msg: '未知操作' }
    }
  } catch(e) {
    console.error('[service]', action, e)
    return { code: -1, msg: e.message || '服务器错误' }
  }
}

async function requireAdmin(openid) {
  const { data } = await db.collection('users').where({ openid }).get()
  if (!data.length || !hasRole(data[0], 'admin')) throw new Error('无权限')
}

// 获取所有上架分类
async function listCategories() {
  const { data } = await db.collection('categories')
    .where({ is_active: true })
    .orderBy('sort_order', 'asc')
    .get()
  return { code: 0, data }
}

// 按分类获取服务
async function listByCategory(event) {
  const { categoryId } = event
  const { data } = await db.collection('services')
    .where({ category_id: categoryId, is_active: true })
    .orderBy('sort_order', 'asc')
    .get()
  return { code: 0, data }
}

// 管理员：全部分类（含下架）
async function listCategoriesAdmin(openid) {
  await requireAdmin(openid)
  const { data } = await db.collection('categories').orderBy('sort_order', 'asc').limit(1000).get()
  return { code: 0, data }
}

// 管理员：全部服务（含下架）；可选按分类筛选
async function listServicesAdmin(openid, event) {
  await requireAdmin(openid)
  const { categoryId } = event || {}
  let query = db.collection('services')
  if (categoryId) query = query.where({ category_id: categoryId })
  const { data } = await query.limit(1000).get()
  const { data: cats } = await db.collection('categories').limit(500).get()
  const catOrder = {}
  ;(cats || []).forEach(c => { catOrder[c._id] = c.sort_order != null ? c.sort_order : 999 })
  data.sort((a, b) => {
    const ca = catOrder[a.category_id] ?? 999
    const cb = catOrder[b.category_id] ?? 999
    if (ca !== cb) return ca - cb
    return (a.sort_order || 99) - (b.sort_order || 99)
  })
  return { code: 0, data }
}

// 服务详情
async function detail(event) {
  const { serviceId } = event
  const { data } = await db.collection('services').doc(serviceId).get()
  return { code: 0, data }
}

// 新增/更新分类
async function upsertCategory(openid, event) {
  await requireAdmin(openid)
  const { _id, name, icon, sort_order, is_active } = event

  if (_id) {
    const { data: existing } = await db.collection('categories').doc(_id).get()
    if (!existing) throw new Error('分类不存在')
    const payload = {
      name: name !== undefined ? name : existing.name,
      icon: icon !== undefined ? (icon || '🎮') : existing.icon,
      sort_order: sort_order !== undefined ? (Number(sort_order) || 99) : (existing.sort_order || 99),
      is_active: is_active !== undefined ? (is_active !== false) : (existing.is_active !== false),
      updated_at: db.serverDate()
    }
    await db.collection('categories').doc(_id).update({ data: payload })
    return { code: 0, data: { _id } }
  }
  if (!name || !String(name).trim()) throw new Error('请填写分类名称')
  const payload = {
    name: String(name).trim(),
    icon: icon || '🎮',
    sort_order: Number(sort_order) || 99,
    is_active: is_active !== false,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  }
  const res = await db.collection('categories').add({ data: payload })
  return { code: 0, data: { _id: res._id } }
}

// 新增/更新服务
async function upsertService(openid, event) {
  await requireAdmin(openid)
  const { _id, category_id, name, description, price, price_unit, form_fields, sort_order, is_active, price_modifiers, needs_co_hunter } = event

  if (_id) {
    const { data: existing } = await db.collection('services').doc(_id).get()
    if (!existing) throw new Error('服务不存在')
    const nextCat = category_id !== undefined ? category_id : existing.category_id
    if (nextCat) {
      const catSnap = await db.collection('categories').doc(nextCat).get()
      if (!catSnap.data) throw new Error('所选分类不存在')
    }
    const payload = {
      category_id: nextCat,
      name: name !== undefined ? name : existing.name,
      description: description !== undefined ? description : (existing.description || ''),
      price: price !== undefined ? (Number(price) || 0) : existing.price,
      price_unit: price_unit !== undefined ? price_unit : (existing.price_unit || '次'),
      form_fields: form_fields !== undefined ? form_fields : (existing.form_fields || []),
      sort_order: sort_order !== undefined ? (Number(sort_order) || 99) : (existing.sort_order || 99),
      is_active: is_active !== undefined ? (is_active !== false) : (existing.is_active !== false),
      needs_co_hunter: needs_co_hunter !== undefined ? !!needs_co_hunter : (existing.needs_co_hunter || false),
      updated_at: db.serverDate()
    }
    if (price_modifiers !== undefined) payload.price_modifiers = price_modifiers
    await db.collection('services').doc(_id).update({ data: payload })
    return { code: 0, data: { _id } }
  }

  if (!category_id) throw new Error('请选择分类')
  const catSnap = await db.collection('categories').doc(category_id).get()
  if (!catSnap.data) throw new Error('所选分类不存在')
  if (!name || !String(name).trim()) throw new Error('请填写服务名称')
  const payload = {
    category_id,
    name: String(name).trim(),
    description: description || '',
    price: Number(price) || 0,
    price_unit: price_unit || '次',
    form_fields: Array.isArray(form_fields) ? form_fields : [],
    sort_order: Number(sort_order) || 99,
    is_active: is_active !== false,
    needs_co_hunter: !!needs_co_hunter,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  }
  if (price_modifiers !== undefined) payload.price_modifiers = price_modifiers
  const res = await db.collection('services').add({ data: payload })
  return { code: 0, data: { _id: res._id } }
}

// 删除分类
async function deleteCategory(openid, event) {
  await requireAdmin(openid)
  const { categoryId } = event
  const cnt = await db.collection('services').where({ category_id: categoryId }).count()
  if (cnt.total > 0) throw new Error('请先删除或移出该分类下的服务')
  await db.collection('categories').doc(categoryId).remove()
  return { code: 0, data: {} }
}

// 删除服务
async function deleteService(openid, event) {
  await requireAdmin(openid)
  await db.collection('services').doc(event.serviceId).remove()
  return { code: 0, data: {} }
}

async function toggleServiceActive(openid, event) {
  await requireAdmin(openid)
  const { serviceId, is_active } = event
  await db.collection('services').doc(serviceId).update({
    data: { is_active: !!is_active, updated_at: db.serverDate() }
  })
  return { code: 0, data: {} }
}

async function updateCatOrder(openid, event) {
  await requireAdmin(openid)
  const { items } = event
  if (!Array.isArray(items)) throw new Error('参数错误')
  for (const { _id, sort_order } of items) {
    await db.collection('categories').doc(_id).update({ data: { sort_order } })
  }
  return { code: 0, data: {} }
}

async function updateSvcOrder(openid, event) {
  await requireAdmin(openid)
  const { items } = event
  if (!Array.isArray(items)) throw new Error('参数错误')
  for (const { _id, sort_order } of items) {
    await db.collection('services').doc(_id).update({ data: { sort_order } })
  }
  return { code: 0, data: {} }
}

// 创建审核演示服务（1.5 总裁贝），自动挂到第一个分类下
async function createTestService(event) {
  if (event.secret !== 'CREATE_TEST_SERVICE') throw new Error('secret 错误')
  const { data: cats } = await db.collection('categories').orderBy('sort_order', 'asc').limit(1).get()
  if (!cats.length) throw new Error('请先创建至少一个服务分类')
  const category_id = cats[0]._id
  const res = await db.collection('services').add({
    data: {
      category_id,
      name: '王者荣耀陪玩体验单',
      description: '审核演示用体验单，1.5总裁贝，含完整下单→接单→完成流程',
      price: 150,
      price_unit: '次',
      form_fields: [
        { key: 'game_id', label: '游戏ID / 房间号', type: 'text', required: true, options: [] },
        { key: 'rank',    label: '当前段位',         type: 'select', required: true,
          options: ['白银', '黄金', '铂金', '钻石'] },
        { key: 'hero',    label: '擅长英雄',         type: 'text', required: false, options: [] }
      ],
      sort_order: 1,
      is_active: true,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })
  return { code: 0, data: { _id: res._id } }
}

async function ensureAppConfigCol() {
  try { await db.createCollection('app_config') } catch (_) {}
}

// 一次返回全部上架分类 + 服务，供老板端服务列表使用
async function listAllForBoss() {
  const [{ data: cats }, { data: svcs }] = await Promise.all([
    db.collection('categories').where({ is_active: true }).orderBy('sort_order', 'asc').limit(200).get(),
    db.collection('services').where({ is_active: true }).orderBy('sort_order', 'asc').limit(500).get()
  ])
  return { code: 0, data: { cats: cats || [], svcs: svcs || [] } }
}

async function getConfig(event) {
  const { key } = event
  if (!key) throw new Error('缺少 key')
  await ensureAppConfigCol()
  const { data } = await db.collection('app_config').where({ key }).limit(1).get()
  return { code: 0, data: data[0] || null }
}

async function listAllForHunter(openid) {
  const { data: svcs } = await db.collection('services').where({ is_active: true }).limit(1000).get()
  return { code: 0, data: svcs }
}

async function setAllCoHunter(openid, event) {
  await requireAdmin(openid)
  const value = event.value !== false
  const { data: svcs } = await db.collection('services').limit(100).get()
  let updated = 0
  for (const svc of svcs) {
    await db.collection('services').doc(svc._id).update({
      data: { needs_co_hunter: value, updated_at: db.serverDate() }
    })
    updated++
  }
  return { code: 0, data: { updated } }
}

async function setConfig(openid, event) {
  const { key, value } = event
  if (!key) throw new Error('缺少 key')
  const u = await db.collection('users').where({ openid }).limit(1).get()
  const user = u.data[0]
  if (!user || !(user.roles || []).includes('admin')) throw new Error('无权限')
  await ensureAppConfigCol()
  const { data: existing } = await db.collection('app_config').where({ key }).limit(1).get()
  if (existing.length > 0) {
    await db.collection('app_config').doc(existing[0]._id).update({ data: { value, updated_at: db.serverDate() } })
    return { code: 0, data: { _id: existing[0]._id } }
  }
  const res = await db.collection('app_config').add({ data: { key, value, created_at: db.serverDate(), updated_at: db.serverDate() } })
  return { code: 0, data: { _id: res._id } }
}
