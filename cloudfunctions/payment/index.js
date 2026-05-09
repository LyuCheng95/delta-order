const cloud = require('wx-server-sdk')
const https  = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _  = db.command

// ==============================
//  配置（需在云开发控制台→云函数→payment→环境变量中设置）
//  VP_OFFER_ID: 虚拟支付商品ID，在微信公众平台→小程序→虚拟支付→商品管理中创建后获取
//  APP_SECRET:  小程序 AppSecret，用于获取 access_token 以调用 ConfirmBillDelivery
// ==============================
const APP_ID      = 'wx8c1e329827ca748f'
const VP_OFFER_ID = process.env.VP_OFFER_ID || 'REPLACE_WITH_VP_OFFER_ID'
const APP_SECRET  = process.env.APP_SECRET  || ''

// ==============================
//  角色检查
// ==============================
const RLIST = ['boss', 'hunter', 'admin']
const normalizeRole = r => { const x = String(r == null ? '' : r).trim().toLowerCase(); return RLIST.includes(x) ? x : 'boss' }
function hasRoleDoc(doc, want) {
  if (!doc) return false
  const arr = []
  if (Array.isArray(doc.roles) && doc.roles.length)
    arr.push(...doc.roles.map(normalizeRole).filter(x => RLIST.includes(x)))
  if (!arr.length && doc.role) arr.push(normalizeRole(doc.role))
  return [...new Set(arr)].includes(normalizeRole(want))
}

// ==============================
//  主入口
// ==============================
exports.main = async (event, context) => {
  // HTTP 触发器：接收微信虚拟支付「商品发货通知」回调
  if (event.httpMethod) {
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
      if (body && body.Event === 'xpay_goods_deliver_notify') {
        return await handleVirtualPayCallback(body)
      }
      return { statusCode: 200, body: JSON.stringify({ errcode: 0, errmsg: 'ok' }) }
    } catch (e) {
      console.error('[payment] callback error', e)
      return { statusCode: 200, body: JSON.stringify({ errcode: -1, errmsg: e.message }) }
    }
  }

  const { OPENID } = cloud.getWXContext()
  const action = typeof event.action === 'string' ? event.action.trim() : event.action
  try {
    switch (action) {
      case 'getVirtualPayConfig':    return getVirtualPayConfig()
      case 'createRechargeOrder':    return await createRechargeOrder(OPENID, event)
      case 'queryRecharge':          return await queryRecharge(OPENID, event)
      case 'payOrderWithBalance':    return await payOrderWithBalance(OPENID, event)
      case 'refund':                 return await refund(OPENID, event)
      default:                       return { code: -1, msg: '未知操作' }
    }
  } catch (e) {
    console.error('[payment]', action, e)
    return { code: -1, msg: e.message || '支付错误' }
  }
}

// ==============================
//  返回虚拟支付前端配置（offerId 等）
// ==============================
function getVirtualPayConfig() {
  return {
    code: 0,
    data: {
      offerId:      VP_OFFER_ID,
      currencyType: 'CNY',
      env:          0   // 0=生产，1=沙箱
    }
  }
}

// ==============================
//  创建充值订单（虚拟支付前调用，生成 out_trade_no 作为 attachInfo 传给 wx.requestVirtualPayment）
// ==============================
async function createRechargeOrder(openid, event) {
  const amount_zb = Number(event.amount_zb)   // 单位：总裁贝（= 元）
  if (!amount_zb || amount_zb < 1) throw new Error('充值金额至少 1 总裁贝')

  const outTradeNo = 'RC' + Date.now() + Math.random().toString(36).slice(2, 7).toUpperCase()
  const now = db.serverDate()
  const { _id: rechargeId } = await db.collection('recharges').add({
    data: {
      openid,
      amount_fen:   amount_zb * 100,   // 存为分
      amount_zb,
      out_trade_no: outTradeNo,
      status:       'pending_payment',
      source:       'virtual_pay',
      created_at:   now,
      updated_at:   now
    }
  })

  return { code: 0, data: { rechargeId, outTradeNo } }
}

// ==============================
//  前端轮询充值状态（wx.requestVirtualPayment 回调后使用）
// ==============================
async function queryRecharge(openid, event) {
  const { rechargeId } = event
  const { data: rec } = await db.collection('recharges').doc(rechargeId).get()
  if (!rec || rec.openid !== openid) throw new Error('记录不存在')
  return { code: 0, data: { status: rec.status, amount_zb: rec.amount_zb } }
}

// ==============================
//  余额支付服务订单（总裁贝扣款）
// ==============================
async function payOrderWithBalance(openid, event) {
  const { orderId } = event
  const [{ data: order }, { data: users }] = await Promise.all([
    db.collection('orders').doc(orderId).get(),
    db.collection('users').where({ openid }).limit(1).get()
  ])
  if (!order)                              throw new Error('订单不存在')
  if (order.boss_openid !== openid)        throw new Error('无权限')
  if (order.status !== 'pending_payment')  throw new Error('订单状态异常，请勿重复支付')

  const user = users[0]
  if (!user) throw new Error('用户不存在')

  const balance = user.balance_fen || 0
  const need    = order.total_amount
  if (balance < need) {
    const shortZb = Math.ceil((need - balance) / 100)
    throw new Error(`总裁贝余额不足，还需充值 ${shortZb} 总裁贝`)
  }

  // 原子扣款：只有余额 >= need 时才成功，防止并发超扣
  const deductResult = await db.collection('users')
    .where({ openid, balance_fen: _.gte(need) })
    .update({
      data: {
        balance_fen:     _.inc(-need),
        total_spent_fen: _.inc(need),
        updated_at:      db.serverDate()
      }
    })

  if (!deductResult.stats || deductResult.stats.updated === 0) {
    throw new Error('扣款失败，请刷新后重试')
  }

  // 标记订单已付款
  await db.collection('orders').doc(orderId).update({
    data: {
      status:            'paid',
      'payment.method':  'balance',
      'payment.paid_at': db.serverDate(),
      paid_at:           db.serverDate(),
      updated_at:        db.serverDate()
    }
  })

  return { code: 0, data: { status: 'paid' } }
}

// ==============================
//  微信虚拟支付「商品发货通知」回调
//  文档：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
//
//  字段说明：
//    FromUserName  - 用户 openid
//    OrderId       - 微信侧订单号
//    BillNo        - 微信侧账单号（幂等 key）
//    PaidCoin      - 用户实际支付虚拟货币数量（= 总裁贝数量）
//    Attach        - 透传字段（我们写入 outTradeNo）
//    TransErrCode  - 0 表示成功
// ==============================
async function handleVirtualPayCallback(body) {
  const {
    FromUserName: openid,
    OrderId:      orderId,
    BillNo:       billNo,
    PaidCoin:     paidCoin,
    TransErrCode: errCode,
    Attach:       outTradeNo
  } = body

  console.log('[payment] vp callback', { openid, orderId, billNo, paidCoin, errCode, outTradeNo })

  // 交易失败不处理，但要回复 OK 避免 WeChat 重试
  if (errCode !== 0) {
    if (outTradeNo) {
      await db.collection('recharges').where({ out_trade_no: outTradeNo }).update({
        data: { status: 'rejected', trans_err_code: errCode, updated_at: db.serverDate() }
      }).catch(() => {})
    }
    return { statusCode: 200, body: JSON.stringify({ errcode: 0, errmsg: 'ok' }) }
  }

  // 幂等：同一 billNo 只处理一次
  const { data: existing } = await db.collection('recharges')
    .where({ bill_no: billNo })
    .limit(1)
    .get()

  if (!existing.length) {
    const amountFen = Number(paidCoin) * 100   // 1 总裁贝 = 100 分

    if (outTradeNo) {
      // 更新已有的充值记录
      const updated = await db.collection('recharges')
        .where({ out_trade_no: outTradeNo, status: 'pending_payment' })
        .update({
          data: {
            status:    'approved',
            bill_no:   billNo,
            order_id:  orderId,
            paid_at:   db.serverDate(),
            updated_at: db.serverDate()
          }
        })
      if (!updated.stats || updated.stats.updated === 0) {
        // 已被处理过，直接确认发货即可
        await confirmVirtualDelivery(openid, orderId, billNo)
        return { statusCode: 200, body: JSON.stringify({ errcode: 0, errmsg: 'ok' }) }
      }
    } else {
      // 无 outTradeNo（异常情况）：新建一条记录
      await db.collection('recharges').add({
        data: {
          openid,
          amount_fen:   amountFen,
          amount_zb:    Number(paidCoin),
          out_trade_no: null,
          bill_no:      billNo,
          order_id:     orderId,
          status:       'approved',
          source:       'virtual_pay',
          paid_at:      db.serverDate(),
          created_at:   db.serverDate(),
          updated_at:   db.serverDate()
        }
      })
    }

    // 增加余额
    await db.collection('users').where({ openid }).update({
      data: { balance_fen: _.inc(amountFen), updated_at: db.serverDate() }
    })
  }

  // 通知微信完成发货
  await confirmVirtualDelivery(openid, orderId, billNo)

  return { statusCode: 200, body: JSON.stringify({ errcode: 0, errmsg: 'ok' }) }
}

// ==============================
//  通知微信完成虚拟商品发货
//  接口：POST /xpay/ConfirmBillDelivery
//  需要 access_token；在云控制台→云函数 openapi 权限中开启 xpay.confirmBillDelivery
// ==============================
async function confirmVirtualDelivery(openid, orderid, billNo) {
  try {
    // 优先使用 cloud.openapi（云开发自动管理 token）
    await cloud.openapi.xpay.confirmBillDelivery({ openid, orderid, bill_no: billNo })
    return
  } catch (e) {
    console.warn('[payment] cloud.openapi.xpay.confirmBillDelivery not available:', e.message)
  }

  // 回退：手动获取 access_token 并调用
  if (!APP_SECRET) {
    console.error('[payment] APP_SECRET 未配置，无法调用 ConfirmBillDelivery')
    return
  }
  try {
    const token = await getAccessToken()
    await httpsPost(
      `https://api.weixin.qq.com/xpay/ConfirmBillDelivery?access_token=${token}`,
      { openid, orderid, bill_no: billNo }
    )
  } catch (e) {
    console.error('[payment] confirmVirtualDelivery HTTP fallback failed', e)
  }
}

// ==============================
//  获取 access_token（用于发货确认，需配置 APP_SECRET 环境变量）
// ==============================
async function getAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APP_ID}&secret=${APP_SECRET}`
  const res = await httpsGet(url)
  if (!res.access_token) throw new Error('获取 access_token 失败: ' + JSON.stringify(res))
  return res.access_token
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve(raw) } })
    }).on('error', reject)
  })
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname, port: 443,
      path:     u.pathname + (u.search || ''),
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    }, res => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve(raw) } })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

// ==============================
//  退款（管理员操作：余额退回总裁贝 / 标记已退）
// ==============================
async function refund(openid, event) {
  const { orderId } = event
  const { data: admin } = await db.collection('users').where({ openid }).get()
  if (!admin.length || !hasRoleDoc(admin[0], 'admin')) throw new Error('无权限')

  const { data: order } = await db.collection('orders').doc(orderId).get()
  if (!order) throw new Error('订单不存在')

  const st  = order.status
  const now = db.serverDate()
  if (st === 'refunded' || st === 'cancelled') throw new Error('订单已关闭')
  if (st === 'completed') throw new Error('已结单的订单不可在线退款，请线下处理')

  const logRefund = async content => {
    try {
      await db.collection('order_logs').add({
        data: { order_id: orderId, operator_openid: openid, operator_role: 'admin',
                action: '管理员退款', content, images: [], created_at: now }
      })
    } catch (e) { console.warn('[payment] log', e) }
  }

  if (st === 'pending_payment') {
    await db.collection('orders').doc(orderId).update({
      data: { status: 'cancelled', 'payment.admin_closed_at': now, updated_at: now }
    })
    await logRefund('未支付订单，管理员关闭')
    return { code: 0, data: { status: 'cancelled' } }
  }

  // 余额支付订单 → 退回总裁贝
  const method = order.payment && order.payment.method
  if (method === 'balance' && order.total_amount && order.boss_openid) {
    await db.collection('users').where({ openid: order.boss_openid }).update({
      data: {
        balance_fen:     _.inc(order.total_amount),
        total_spent_fen: _.inc(-order.total_amount),
        updated_at:      now
      }
    })
  }

  await db.collection('orders').doc(orderId).update({
    data: {
      status:               'refunded',
      'payment.refunded_at': now,
      'payment.refund_note': method === 'balance' ? '总裁贝已退回' : '无支付流水，仅更新状态',
      updated_at:            now
    }
  })
  await logRefund(method === 'balance' ? '总裁贝退款' : '标记为已退款')
  return { code: 0, data: { status: 'refunded' } }
}
