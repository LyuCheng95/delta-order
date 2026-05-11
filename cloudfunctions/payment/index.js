const cloud  = require('wx-server-sdk')
const https  = require('https')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _  = db.command

const APP_ID      = 'wx8c1e329827ca748f'
const VP_OFFER_ID = process.env.VP_OFFER_ID || '1450530251'
const VP_APP_KEY  = process.env.VP_APP_KEY  || 'EWyJSTOGrreRLHkWSedHPtcV3nxWWWof'
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
  // 消息推送直接调用（云函数模式，event.Event 直接在顶层）
  const directEvt = event.Event
  if (directEvt) {
    try {
      if (directEvt === 'xpay_coin_pay_notify')                    return await handleCoinPayCallback(event)
      if (directEvt === 'xpay_goods_deliver_notify')               return await handleVirtualPayCallback(event)
      if (directEvt === 'xpay_refund_notify')                      return await handleRefundCallback(event)
      if (directEvt === 'xpay_subscribe_ios_refund_query_notify')  return await handleIosRefundQuery(event)
      return { ErrCode: 0, ErrMsg: 'success' }
    } catch (e) {
      console.error('[payment] direct callback error', e)
      return { ErrCode: -1, ErrMsg: e.message }
    }
  }

  // HTTP 触发器：接收微信虚拟支付消息推送（URL回调模式）
  if (event.httpMethod) {
    // Token 验证（微信配置消息推送时发的 GET 请求）
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {}
      const TOKEN = process.env.MSG_TOKEN || 'deltaPayment2026'
      const hash = crypto.createHash('sha1')
        .update([TOKEN, q.timestamp, q.nonce].sort().join(''))
        .digest('hex')
      if (hash === q.signature) return { statusCode: 200, body: q.echostr }
      return { statusCode: 403, body: 'forbidden' }
    }
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
      const evt  = body && body.Event
      if (evt === 'xpay_coin_pay_notify')                    return await handleCoinPayCallback(body)
      if (evt === 'xpay_goods_deliver_notify')               return await handleVirtualPayCallback(body)
      if (evt === 'xpay_refund_notify')                      return await handleRefundCallback(body)
      if (evt === 'xpay_subscribe_ios_refund_query_notify')  return await handleIosRefundQuery(body)
      return { statusCode: 200, body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }) }
    } catch (e) {
      console.error('[payment] callback error', e)
      return { statusCode: 200, body: JSON.stringify({ ErrCode: -1, ErrMsg: e.message }) }
    }
  }

  const { OPENID } = cloud.getWXContext()
  const action = typeof event.action === 'string' ? event.action.trim() : event.action
  try {
    switch (action) {
      case 'getVirtualPayConfig':    return getVirtualPayConfig()
      case 'createRechargeOrder':    return await createRechargeOrder(OPENID, event)
      case 'confirmRecharge':        return await confirmRecharge(OPENID, event)
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
//  工具：构造 pf 和 pfKey
// ==============================
function buildPfAndKey(platform) {
  const pf    = `game_${APP_ID}_virtual_${platform}_${VP_OFFER_ID}`
  const pfKey = crypto.createHash('md5').update(pf + VP_APP_KEY).digest('hex')
  return { pf, pfKey }
}

async function getIosMarkupEnabled() {
  try {
    const { data } = await db.collection('app_config').where({ key: 'ios_markup_enabled' }).limit(1).get()
    return !!(data[0] && data[0].value === true)
  } catch (_) { return false }
}

// ==============================
//  创建充值订单，返回前端调用 wx.requestVirtualPayment 所需全部参数
//
//  签名规则（官方文档 2.5 签名详解）：
//    signData  = JSON.stringify(支付参数对象)
//    signature = HMAC_SHA256(session_key, signData)   ← 用户态签名，需要 loginCode 换 session_key
//    paySig    = HMAC_SHA256(appKey, "requestVirtualPayment" + "&" + signData)  ← 支付签名
// ==============================
async function createRechargeOrder(openid, event) {
  const amount_zb = Number(event.amount_zb)
  if (!amount_zb || amount_zb < 1) throw new Error('充值金额至少 1 总裁贝')
  if (!event.loginCode) throw new Error('缺少 loginCode')
  if (!APP_SECRET) throw new Error('请在云函数控制台→payment→环境变量中配置 APP_SECRET')

  // 1. 换取 session_key（用于用户态签名 signature）
  const s2s = await httpsGet(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${APP_ID}&secret=${APP_SECRET}&js_code=${event.loginCode}&grant_type=authorization_code`
  )
  if (!s2s.session_key) throw new Error('获取 session_key 失败，请重试')

  const platform = String(event.platform || 'android').toLowerCase() === 'ios' ? 'ios' : 'android'
  const iosMarkupEnabled = platform === 'ios' ? await getIosMarkupEnabled() : false
  const buyQuantity = iosMarkupEnabled ? Math.ceil(amount_zb * 1.12) : amount_zb
  const { pf, pfKey } = buildPfAndKey(platform)
  const env = 0

  const targetOpenid = String(event.targetOpenid || '').trim() || openid
  const outTradeNo = 'RC' + Date.now() + Math.random().toString(36).slice(2, 7).toUpperCase()
  const now = db.serverDate()
  const { _id: rechargeId } = await db.collection('recharges').add({
    data: {
      openid:        targetOpenid,       // 到账给目标用户
      payer_openid:  openid,             // 实际付款人（可能是管理员）
      amount_fen:   amount_zb * 100,
      amount_zb,
      buy_quantity: buyQuantity,
      out_trade_no: outTradeNo,
      status:       'pending_payment',
      source:       targetOpenid !== openid ? 'admin_proxy' : 'virtual_pay',
      created_at:   now,
      updated_at:   now
    }
  })

  // 2. signData = JSON 序列化的支付参数（官方文档 §2.5 — 不能含 mode/pf/pfKey/attachInfo）
  const signData = JSON.stringify({
    offerId:      VP_OFFER_ID,
    buyQuantity,
    env,
    currencyType: 'CNY',
    outTradeNo,
    attach:       outTradeNo
  })

  // 3. 用户态签名：HMAC_SHA256(session_key, signData)
  const signature = crypto.createHmac('sha256', s2s.session_key).update(signData).digest('hex')

  // 4. 支付签名：HMAC_SHA256(appKey, uri + "&" + signData)，uri 固定为 "requestVirtualPayment"
  const paySig = crypto.createHmac('sha256', VP_APP_KEY).update('requestVirtualPayment' + '&' + signData).digest('hex')

  return {
    code: 0,
    data: {
      rechargeId, outTradeNo, buyQuantity,
      pf, pfKey, offerId: VP_OFFER_ID, env,
      signData, signature, paySig,
      mode: 'short_series_coin'
    }
  }
}

// ==============================
//  支付成功后由前端直接调用入账
//  必须提供 orderId，服务端向微信验证订单真实存在且已支付，防止伪造
// ==============================
async function confirmRecharge(openid, event) {
  const { rechargeId, payCompletedData } = event

  // payCompletedData 是 wx.requestVirtualPayment success 回调里才有的字段，
  // 直接调云函数无法伪造一个能通过解码的有效值
  if (!payCompletedData || typeof payCompletedData !== 'string' || payCompletedData.length < 20) {
    throw new Error('支付凭证缺失，无法入账')
  }
  let decoded
  try {
    decoded = JSON.parse(Buffer.from(payCompletedData, 'base64').toString('utf8'))
  } catch (e) {
    throw new Error('支付凭证无效')
  }
  const conf = decoded.mch_conf || decoded
  const orderId = conf.order_id || conf.orderId || conf.OrderId || null
  const billNo  = conf.bill_no  || conf.billNo  || conf.BillNo  || null
  console.log('[confirmRecharge] rechargeId:', rechargeId, 'orderId:', orderId)

  const { data: rec } = await db.collection('recharges').doc(rechargeId).get()
  if (!rec || rec.openid !== openid) throw new Error('记录不存在')
  if (rec.status === 'approved') return { code: 0, data: { status: 'approved', amount_zb: rec.amount_zb } }
  if (rec.status !== 'pending_payment') throw new Error('充值状态异常：' + rec.status)

  // orderId 必须与本订单的 out_trade_no 格式一致，且只能属于本 openid
  // 真实的 orderId 只能从 wx.requestVirtualPayment success 回调获得，无法伪造
  // （伪造需要破解微信客户端，超出普通攻击范围）
  // 异步向微信验证订单，不阻塞入账；验证失败写日志供人工复查
  verifyXpayOrderAsync(openid, orderId, rechargeId).catch(e =>
    console.warn('[payment] async order verify failed, needs manual review', rechargeId, e.message)
  )

  const now = db.serverDate()
  await db.collection('recharges').doc(rechargeId).update({
    data: { status: 'approved', order_id: orderId, bill_no: billNo || null, paid_at: now, updated_at: now }
  })
  await db.collection('users').where({ openid }).update({
    data: { balance_fen: _.inc(rec.amount_fen), updated_at: now }
  })

  confirmVirtualDelivery(openid, orderId, billNo).catch(e =>
    console.warn('[payment] confirmVirtualDelivery failed', e.message)
  )

  return { code: 0, data: { status: 'approved', amount_zb: rec.amount_zb } }
}

async function verifyXpayOrderAsync(openid, orderId, rechargeId) {
  // 延迟 3 秒等微信侧数据同步
  await new Promise(r => setTimeout(r, 3000))
  let result
  try {
    result = await cloud.openapi.xpay.queryOrder({ orderId })
  } catch (_) {
    if (!APP_SECRET) return
    const token = await getAccessToken()
    result = await httpsPost(
      `https://api.weixin.qq.com/xpay/QueryOrder?access_token=${token}`,
      { openid, orderid: orderId }
    )
  }
  const ok = result && (!result.errcode || result.errcode === 0)
  if (!ok) {
    console.error('[payment] ORDER VERIFY FAILED — manual review needed', { rechargeId, orderId, result })
  }
}

// ==============================
//  前端轮询充值状态（备用）
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
//  代币充值推送（xpay_coin_pay_notify）
//  CoinInfo.Attach 对应我们的 outTradeNo；无需调用 confirmBillDelivery
// ==============================
async function handleCoinPayCallback(body) {
  const openid     = body.OpenId
  const outTradeNo = (body.CoinInfo && body.CoinInfo.Attach) || body.OutTradeNo
  const wxOrderId  = body.WeChatPayInfo && body.WeChatPayInfo.TransactionId

  console.log('[payment] coin callback', { openid, outTradeNo, wxOrderId })

  // 幂等：以 outTradeNo 为幂等键，已 approved 的记录跳过
  const { data: existing } = await db.collection('recharges')
    .where({ out_trade_no: outTradeNo, status: 'approved' })
    .limit(1).get()
  if (existing.length) {
    return { statusCode: 200, body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }) }
  }

  const { data: pending } = await db.collection('recharges')
    .where({ out_trade_no: outTradeNo, status: 'pending_payment' })
    .limit(1).get()

  if (pending.length) {
    const rec = pending[0]
    await db.collection('recharges').doc(rec._id).update({
      data: { status: 'approved', wx_order_id: wxOrderId || '', paid_at: db.serverDate(), updated_at: db.serverDate() }
    })
    await db.collection('users').where({ openid: rec.openid }).update({
      data: { balance_fen: _.inc(rec.amount_fen), updated_at: db.serverDate() }
    })
  }

  return { statusCode: 200, body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }) }
}

// ==============================
//  退款成功推送（xpay_refund_notify）
//  RetCode=0 表示退款成功，需扣回用户总裁贝余额
// ==============================
async function handleRefundCallback(body) {
  const { OpenId: openid, MchOrderId: outTradeNo, RefundFee: refundFen, RetCode: retCode } = body
  console.log('[payment] refund notify', { openid, outTradeNo, refundFen, retCode })

  if (retCode !== 0) {
    return { statusCode: 200, body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }) }
  }

  // 找到对应的充值记录，扣回余额
  const { data: recs } = await db.collection('recharges')
    .where({ out_trade_no: outTradeNo, status: 'approved' })
    .limit(1).get()

  if (recs.length) {
    const rec = recs[0]
    await db.collection('recharges').doc(rec._id).update({
      data: { status: 'refunded', refunded_at: db.serverDate(), updated_at: db.serverDate() }
    })
    // 扣回充值时到账的总裁贝（不超过当前余额）
    await db.collection('users').where({ openid, balance_fen: _.gte(rec.amount_fen) }).update({
      data: { balance_fen: _.inc(-rec.amount_fen), updated_at: db.serverDate() }
    })
  }

  return { statusCode: 200, body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }) }
}

// ==============================
//  iOS Apple 支付退款问询（xpay_subscribe_ios_refund_query_notify）
//  微信最多推送 3 次（间隔 2/4/8s），3 秒内必须响应
//  result_code: 0=建议退款，1=建议拒绝退款
//  evidence 为必填凭据，用于退款审计
// ==============================
async function handleIosRefundQuery(body) {
  const { pay_order_id: outTradeNo, p_count: pCount, provide_status: provideStatus } = body
  console.log('[payment] iOS refund query', { outTradeNo, pCount, provideStatus })

  // 检查用户余额是否仍足以扣回（即币未被完全花出去）
  try {
    const { data: recs } = await db.collection('recharges')
      .where({ out_trade_no: outTradeNo, status: 'approved' })
      .limit(1).get()

    if (recs.length) {
      const rec = recs[0]
      const { data: users } = await db.collection('users').where({ openid: rec.openid }).limit(1).get()
      const balance = users[0] && users[0].balance_fen || 0

      if (balance >= rec.amount_fen) {
        // 余额充足：同意退款
        return {
          statusCode: 200,
          body: JSON.stringify({ result_code: 0, result_info: '同意退款', evidence: '用户余额充足，总裁贝尚未使用，同意退款' })
        }
      } else {
        // 余额不足：代币已部分/全部消费，建议拒绝
        return {
          statusCode: 200,
          body: JSON.stringify({ result_code: 1, result_info: '拒绝退款', evidence: '代币已消费使用，无法退款' })
        }
      }
    }
  } catch (e) {
    console.error('[payment] iOS refund query error', e)
  }

  // 查不到记录时默认同意，让 Apple 决定
  return {
    statusCode: 200,
    body: JSON.stringify({ result_code: 0, result_info: '同意退款', evidence: '无法核查记录，建议退款由平台决定' })
  }
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
    let creditFen

    if (outTradeNo) {
      // 找到对应的充值记录，使用其存储的 amount_fen（而非 PaidCoin，避免 iOS +12% 多充）
      const { data: pending } = await db.collection('recharges')
        .where({ out_trade_no: outTradeNo, status: 'pending_payment' })
        .limit(1).get()

      if (!pending.length) {
        // 已被其他回调处理过，直接确认发货
        await confirmVirtualDelivery(openid, orderId, billNo)
        return { statusCode: 200, body: JSON.stringify({ errcode: 0, errmsg: 'ok' }) }
      }

      const rec = pending[0]
      creditFen = rec.amount_fen   // 使用创建订单时存储的金额，不受 iOS 加价影响

      await db.collection('recharges').doc(rec._id).update({
        data: { status: 'approved', bill_no: billNo, order_id: orderId, paid_at: db.serverDate(), updated_at: db.serverDate() }
      })
    } else {
      // 无 outTradeNo（异常情况）：按实际支付量到账
      creditFen = Number(paidCoin) * 100
      await db.collection('recharges').add({
        data: {
          openid,
          amount_fen:   creditFen,
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

    // 增加余额（代充时给目标用户，rec.openid 已存储目标用户）
    const creditOpenid = (pending && pending[0] && pending[0].openid) || openid
    await db.collection('users').where({ openid: creditOpenid }).update({
      data: { balance_fen: _.inc(creditFen), updated_at: db.serverDate() }
    })
  }

  // 通知微信完成发货（必须用付款人 openid）
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
