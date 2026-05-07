/**
 * 数据库初始化云函数
 * 触发方式：云控制台 → init 云函数 → 测试，传入 {"action":"resetServices"}
 * ⚠️  resetServices 会清空所有 categories / services 后重新写入价目表数据
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const action = (event && event.action) || ''

  if (action === 'ensureWithdrawals') {
    try {
      await db.createCollection('withdrawals')
      return { code: 0, msg: 'withdrawals 集合已创建' }
    } catch (e) {
      const t = `${e.errMsg || ''}${e.message || ''}`
      if (/already|exist|已存在|duplicate|重复/i.test(t)) {
        return { code: 0, msg: 'withdrawals 集合已存在' }
      }
      return { code: -1, msg: t || String(e) }
    }
  }

  if (action === 'resetServices') {
    try {
      await clearServices()
      const catIds = await insertCategories()
      const svcCount = await insertServices(catIds)
      return { code: 0, msg: `完成：${Object.keys(catIds).length} 个分类，${svcCount} 个服务` }
    } catch (e) {
      console.error('[resetServices]', e)
      return { code: -1, msg: e.message }
    }
  }

  return { code: -1, msg: '请传入 action: resetServices' }
}

// ── 清空分类和服务 ─────────────────────────────────────
async function clearServices() {
  async function clearCol(name) {
    let total = 0
    while (true) {
      const { data } = await db.collection(name).limit(20).get()
      if (!data.length) break
      await Promise.all(data.map(r => db.collection(name).doc(r._id).remove()))
      total += data.length
    }
    console.log(`🗑️  清空 ${name}：${total} 条`)
  }
  await clearCol('services')
  await clearCol('categories')
}

// ── 插入分类 ──────────────────────────────────────────
async function insertCategories() {
  const cats = [
    { key: 'experience', name: '首次体验单', icon: '🌟', sort_order: 1 },
    { key: 'escort',     name: '基础护航单', icon: '🛡️', sort_order: 2 },
    { key: 'special',    name: '特色单',     icon: '⭐', sort_order: 3 },
    { key: 'accompany',  name: '娱乐陪玩',   icon: '🎮', sort_order: 4 },
    { key: 'vip',        name: '专属陪玩',   icon: '👑', sort_order: 5 },
    { key: 'fun',        name: '趣味单',     icon: '🃏', sort_order: 6 },
    { key: 'rare',       name: '指定红',     icon: '💎', sort_order: 7 },
  ]
  const ids = {}
  for (const cat of cats) {
    const res = await db.collection('categories').add({
      data: {
        name: cat.name, icon: cat.icon, sort_order: cat.sort_order,
        is_active: true, created_at: db.serverDate(), updated_at: db.serverDate()
      }
    })
    ids[cat.key] = res._id
    console.log(`✅ 分类: ${cat.name}`)
  }
  return ids
}

// ── 插入服务 ──────────────────────────────────────────
async function insertServices(catIds) {
  const FIELDS_BASE = [
    { key: 'game_id',  label: '游戏ID / 房间号', type: 'text',   required: true,  options: [] },
    { key: 'platform', label: '游戏平台',         type: 'select', required: true,  options: ['端游', '手游'] }
  ]
  const FIELDS_ESCORT = [
    ...FIELDS_BASE,
    { key: 'map', label: '偏好地图', type: 'select', required: false, options: ['机密', '绝密', '随机'] }
  ]
  const FIELDS_VIP = [
    ...FIELDS_BASE,
    { key: 'hunter_name',  label: '指定打手昵称', type: 'text', required: false, options: [] },
    { key: 'appoint_time', label: '预约开始时间', type: 'text', required: true,  options: [] }
  ]

  const services = [

    // ── 首次体验单 ──────────────────────────────────────
    {
      category_id: catIds.experience,
      name: '首次体验单 · 159R',
      description: '保底888W。出非洲之心默认订单完成，不论是否撤离成功。',
      price: 15900, price_unit: '单', sort_order: 1,
      form_fields: FIELDS_BASE
    },

    // ── 基础护航单 ──────────────────────────────────────
    {
      category_id: catIds.escort,
      name: '护航单 · 188R',
      description: '保底800W，打手全程护航。',
      price: 18800, price_unit: '单', sort_order: 1,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.escort,
      name: '护航单 · 299R',
      description: '保底1300W。',
      price: 29900, price_unit: '单', sort_order: 2,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.escort,
      name: '护航单 · 499R',
      description: '保底2300W。',
      price: 49900, price_unit: '单', sort_order: 3,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.escort,
      name: '护航单 · 699R',
      description: '保底3888W。',
      price: 69900, price_unit: '单', sort_order: 4,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.escort,
      name: '护航单 · 1788R',
      description: '保底10000W，王者级护航。',
      price: 178800, price_unit: '单', sort_order: 5,
      form_fields: FIELDS_ESCORT
    },

    // ── 特色单 ──────────────────────────────────────────
    {
      category_id: catIds.special,
      name: '保单局2把AWM · 399R',
      description: '单局游戏内缴获至少2把AWM，并且清图成功撤离。否则一直打。',
      price: 39900, price_unit: '单', sort_order: 1,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.special,
      name: '保累积5把AWM · 799R',
      description: '游戏内成功撤离的对局缴获5把AWM，打够为止。',
      price: 79900, price_unit: '单', sort_order: 2,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.special,
      name: '吃空红卡 · 1699R',
      description: '保底4000w。老板开始订单前指定3张红卡，打手必须刷爆全新的满耐房卡且满足保底视为结单。',
      price: 169900, price_unit: '单', sort_order: 3,
      form_fields: [
        ...FIELDS_BASE,
        { key: 'red_cards', label: '指定红卡（3张）', type: 'text', required: true, options: [] }
      ]
    },

    // ── 娱乐陪玩 ──────────────────────────────────────
    {
      category_id: catIds.accompany,
      name: '男陪 · 机密 · 50R/h',
      description: '机密图男娱乐陪玩，不包撤离，以情绪价值为主。超时20分钟以上补半价。',
      price: 5000, price_unit: '小时', sort_order: 1,
      form_fields: [
        ...FIELDS_BASE,
        { key: 'hours', label: '预约时长', type: 'select', required: true, options: ['1小时', '2小时', '3小时', '4小时', '5小时'] }
      ]
    },
    {
      category_id: catIds.accompany,
      name: '男陪 · 绝密 · 90R/h',
      description: '绝密图男娱乐陪玩，不包撤离，以情绪价值为主。超时20分钟以上补半价。',
      price: 9000, price_unit: '小时', sort_order: 2,
      form_fields: [
        ...FIELDS_BASE,
        { key: 'hours', label: '预约时长', type: 'select', required: true, options: ['1小时', '2小时', '3小时', '4小时', '5小时'] }
      ]
    },
    {
      category_id: catIds.accompany,
      name: '女陪 · 机密 · 60R/h',
      description: '机密图女娱乐陪玩，不包撤离，以情绪价值为主。超时20分钟以上补半价。',
      price: 6000, price_unit: '小时', sort_order: 3,
      form_fields: [
        ...FIELDS_BASE,
        { key: 'hours', label: '预约时长', type: 'select', required: true, options: ['1小时', '2小时', '3小时', '4小时', '5小时'] }
      ]
    },
    {
      category_id: catIds.accompany,
      name: '女陪 · 绝密 · 100R/h',
      description: '绝密图女娱乐陪玩，不包撤离，以情绪价值为主。超时20分钟以上补半价。',
      price: 10000, price_unit: '小时', sort_order: 4,
      form_fields: [
        ...FIELDS_BASE,
        { key: 'hours', label: '预约时长', type: 'select', required: true, options: ['1小时', '2小时', '3小时', '4小时', '5小时'] }
      ]
    },

    // ── 专属陪玩 ──────────────────────────────────────
    {
      category_id: catIds.vip,
      name: '指定陪玩 · 包天 · 888R',
      description: '专属冠名单，8小时/天上限，专属期内不接其他任何订单，老板需提前2小时预约。',
      price: 88800, price_unit: '天', sort_order: 1,
      form_fields: FIELDS_VIP
    },
    {
      category_id: catIds.vip,
      name: '指定陪玩 · 包周 · 5200R',
      description: '专属冠名包周，8小时/天上限，专属期内不接其他任何订单，老板需提前2小时预约。',
      price: 520000, price_unit: '周', sort_order: 2,
      form_fields: FIELDS_VIP
    },
    {
      category_id: catIds.vip,
      name: '指定陪玩 · 包月 · 18888R',
      description: '专属冠名包月，8小时/天，可与陪玩协商休息4天，专属期内不接其他任何订单，老板需提前2小时预约。',
      price: 1888800, price_unit: '月', sort_order: 3,
      form_fields: FIELDS_VIP
    },

    // ── 趣味单 ────────────────────────────────────────
    {
      category_id: catIds.fun,
      name: '卡牌大师 · 333R',
      description: '累积保底800w。顺子+800w / 三张同牌+300w / 大小王+100w。',
      price: 33300, price_unit: '单', sort_order: 1,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.fun,
      name: '学猫叫 · 399R',
      description: '累积保底1300w。游戏内每句话说完后必须喵一声，少喵一句+50w保底。',
      price: 39900, price_unit: '单', sort_order: 2,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.fun,
      name: '学狗叫 · 399R',
      description: '累积保底1300w。双护选择干员疾风，疾风开大期间必须"汪汪汪"撕咬，忘记一次+100w保底。',
      price: 39900, price_unit: '单', sort_order: 3,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.fun,
      name: '金品胸挂 · 888R',
      description: '保底2000w。至少一局老板20格胸挂全是3格以内金色收藏品且撤离成功视为完成（一组满金蛋也算金）。',
      price: 88800, price_unit: '单', sort_order: 4,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.fun,
      name: '12分钟清图 · 1314R',
      description: '保单局880w。双护在游戏12分钟内清图且满足单局保底，飞升也不允许走人，否则一直打。',
      price: 131400, price_unit: '单', sort_order: 5,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.fun,
      name: '小巨人mini · 520R',
      description: '初始血量12HP，无血量上限。撤离失败+2HP，撤离成功且老板人头比任意打手高+2HP。单局700w-5HP / 800w-6HP / 1000w-8HP / 1200w-10HP。',
      price: 52000, price_unit: '单', sort_order: 6,
      form_fields: FIELDS_BASE
    },
    {
      category_id: catIds.fun,
      name: '牛马的春天 · 888R',
      description: '保底2000w。香槟+500w / 鱼子酱+500w / 怀表+500w / 量子储存-500w / 任意9格大红-500w。',
      price: 88800, price_unit: '单', sort_order: 7,
      form_fields: FIELDS_BASE
    },

    // ── 指定红 ────────────────────────────────────────
    {
      category_id: catIds.rare,
      name: '非洲之心 · 1288R',
      description: '保底5000w。不出心，保底+2000w。',
      price: 128800, price_unit: '单', sort_order: 1,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '非洲之心（全局） · 12888R',
      description: '保底3亿。不出一直打。',
      price: 1288800, price_unit: '单', sort_order: 2,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '海洋之泪 · 1999R',
      description: '保底8000w。不出泪，保底+2000w。',
      price: 199900, price_unit: '单', sort_order: 3,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '海洋之泪（全局） · 19999R',
      description: '保底4亿。不出一直打。',
      price: 1999900, price_unit: '单', sort_order: 4,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '卫星锅 · 399R',
      description: '保底800w。不出一直打。',
      price: 39900, price_unit: '单', sort_order: 5,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '火箭燃料 · 666R',
      description: '保底1000w。不出一直打。',
      price: 66600, price_unit: '单', sort_order: 6,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '浮力补偿设备 · 888R',
      description: '保底1000w。不出一直打。',
      price: 88800, price_unit: '单', sort_order: 7,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '雷明顿打字机 · 8888R',
      description: '保底1亿。不出一直打。',
      price: 888800, price_unit: '单', sort_order: 8,
      form_fields: FIELDS_ESCORT
    },
    {
      category_id: catIds.rare,
      name: '其他定制 · 咨询客服',
      description: '接受定制，价格面议，请联系客服。',
      price: 0, price_unit: '单', sort_order: 9,
      form_fields: [
        { key: 'game_id',   label: '游戏ID / 房间号', type: 'text', required: true,  options: [] },
        { key: 'custom_req', label: '定制需求描述',   type: 'text', required: true,  options: [] }
      ]
    }
  ]

  for (const svc of services) {
    await db.collection('services').add({
      data: { ...svc, is_active: true, created_at: db.serverDate(), updated_at: db.serverDate() }
    })
    console.log(`✅ 服务: ${svc.name}`)
  }
  return services.length
}
