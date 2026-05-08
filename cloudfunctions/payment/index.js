const cloud  = require('wx-server-sdk')
const crypto = require('crypto')
const https  = require('https')
const fs     = require('fs')
const path   = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _  = db.command

// ==============================
//  微信支付 v3 配置
// ==============================
const MCH_ID     = '1110295029'
const APP_ID     = 'wx8c1e329827ca748f'
const API_V3_KEY = '7fs6Taeyv5dIF8imAAXVWKhOSL76tiDh'
// 支付回调地址：在云控制台 → 云函数 → payment → 触发管理 → 新建HTTP触发器，把生成的URL填到这里
const NOTIFY_URL = process.env.PAY_NOTIFY_URL || 'https://delta-order.example.com/pay/notify'

// 启动时加载，避免每次请求都读磁盘
const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'apiclient_key.pem'), 'utf8')
const CERT_SERIAL = (() => {
  const pem  = fs.readFileSync(path.join(__dirname, 'apiclient_cert.pem'), 'utf8')
  const cert = new crypto.X509Certificate(pem)
  return cert.serialNumber  // 大写十六进制
})()

// ==============================
//  工具函数
// ==============================
const nonceStr = () => crypto.randomBytes(16).toString('hex')

/** RSA-SHA256 签名 */
const sign = msg =>
  crypto.createSign('RSA-SHA256').update(msg).sign(PRIVATE_KEY, 'base64')

/** 生成微信支付 v3 Authorization 头 */
function buildAuth(method, urlStr, body = '') {
  const ts  = String(Math.floor(Date.now() / 1000))
  const ns  = nonceStr()
  const url = new URL(urlStr)
  const res = url.pathname + (url.search || '')
  const msg = `${method}\n${res}\n${ts}\n${ns}\n${body}\n`
  const sig = sign(msg)
  return {
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${MCH_ID}",nonce_str="${ns}",timestamp="${ts}",serial_no="${CERT_SERIAL}",signature="${sig}"`,
    timestamp: ts,
    nonceStr:  ns
  }
}

/** 发起 HTTPS 请求 */
function wxpayRequest(urlStr, method, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : ''
    const { authorization } = buildAuth(method, urlStr, bodyStr)
    const u = new URL(urlStr)
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': authorization,
        'User-Agent':    'delta-order/1.0'
      }
    }
    const req = https.request(options, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, body: raw }) }
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

/** 解密微信支付回调 resource */
function decryptResource(resource) {
  const { ciphertext, associated_data, nonce } = resource
  const buf  = Buffer.from(ciphertext, 'base64')
  const data = buf.slice(0, buf.length - 16)
  const tag  = buf.slice(buf.length - 16)
  const dc   = crypto.createDecipheriv('aes-256-gcm', Buffer.from(API_V3_KEY), nonce)
  dc.setAuthTag(tag)
  if (associated_data) dc.setAAD(Buffer.from(associated_data))
  return JSON.parse(Buffer.concat([dc.update(data), dc.final()]).toString('utf8'))
}

// ==============================
//  角色检查
// ==============================
const RLIST = ['boss', 'hunter', 'admin']
const normalizeRole = r => {
  const x = String(r == null ? '' : r).trim().toLowerCase()
  return RLIST.includes(x) ? x : 'boss'
}
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
  // HTTP 触发器：微信支付回调
  if (event.httpMethod) {
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
      return await handleNotify(body)
    } catch (e) {
      console.error('[payment] notify error', e)
      return { statusCode: 200, body: JSON.stringify({ code: 'FAIL', message: e.message }) }
    }
  }

  const { OPENID } = cloud.getWXContext()
  const action = typeof event.action === 'string' ? event.action.trim() : event.action
  try {
    switch (action) {
      case 'createPay':         return await createPay(OPENID, event)
      case 'confirmPay':        return await confirmPay(OPENID, event)
      case 'createRechargePay': return await createRechargePay(OPENID, event)
      case 'confirmRechargePay':return await confirmRechargePay(OPENID, event)
      case 'refund':            return await refund(OPENID, event)
      default:                  return { code: -1, msg: '未知操作' }
    }
  } catch (e) {
    console.error('[payment]', action, e)
    return { code: -1, msg: e.message || '支付错误' }
  }
}

// ==============================
//  发起 JSAPI 支付
// ==============================
async function createPay(openid, event) {
  const { orderId } = event
  const { data: order } = await db.collection('orders').doc(orderId).get()
  if (!order)                            throw new Error('订单不存在')
  if (order.status !== 'pending_payment') throw new Error('订单状态异常，请勿重复支付')

  const ts = String(Math.floor(Date.now() / 1000))
  const ns = nonceStr()

  const urlStr  = 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi'
  const bodyObj = {
    appid:       APP_ID,
    mchid:       MCH_ID,
    description: `上总裁电竞-${order.service_snapshot?.service_name || '陪玩服务'}`,
    out_trade_no: order.order_no,
    notify_url:  NOTIFY_URL,
    amount:  { total: order.total_amount, currency: 'CNY' },
    payer:   { openid }
  }

  const { status, body } = await wxpayRequest(urlStr, 'POST', bodyObj)
  if (status !== 200 || !body.prepay_id) {
    console.error('[payment] createPay fail', status, body)
    throw new Error(body?.message || body?.err_code_des || '创建支付订单失败')
  }

  const pkg    = `prepay_id=${body.prepay_id}`
  const payMsg = `${APP_ID}\n${ts}\n${ns}\n${pkg}\n`
  const paySign = sign(payMsg)

  await db.collection('orders').doc(orderId).update({
    data: { 'payment.wx_prepay_id': body.prepay_id, updated_at: db.serverDate() }
  })

  return {
    code: 0,
    data: { timeStamp: ts, nonceStr: ns, package: pkg, signType: 'RSA', paySign }
  }
}

// ==============================
//  确认支付（轮询用）
// ==============================
async function confirmPay(openid, event) {
  const { orderId } = event
  const { data: ord } = await db.collection('orders').doc(orderId).get()
  if (!ord) throw new Error('订单不存在')
  if (ord.boss_openid !== openid) throw new Error('无权限')

  if (ord.status === 'pending_payment') {
    await db.collection('orders').doc(orderId).update({
      data: {
        status:            'paid',
        'payment.paid_at': db.serverDate(),
        paid_at:           db.serverDate(),
        updated_at:        db.serverDate()
      }
    })
    return { code: 0, data: { status: 'paid' } }
  }

  return { code: 0, data: { status: ord.status } }
}

// ==============================
//  充值：创建微信支付单
// ==============================
async function createRechargePay(openid, event) {
  const amt = Number(event.amount_fen)
  if (!amt || amt < 100) throw new Error('充值金额至少 1 元')

  const outTradeNo = 'RC' + Date.now() + Math.random().toString(36).slice(2, 7).toUpperCase()
  const now = db.serverDate()
  const { _id: rechargeId } = await db.collection('recharges').add({
    data: { openid, amount_fen: amt, out_trade_no: outTradeNo, status: 'pending_payment', created_at: now, updated_at: now }
  })

  const ts  = String(Math.floor(Date.now() / 1000))
  const ns  = nonceStr()
  const urlStr  = 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi'
  const bodyObj = {
    appid:        APP_ID,
    mchid:        MCH_ID,
    description:  `上总裁电竞-充值${Math.floor(amt / 100)}总裁贝`,
    out_trade_no: outTradeNo,
    notify_url:   NOTIFY_URL,
    amount:  { total: amt, currency: 'CNY' },
    payer:   { openid }
  }

  const { status, body } = await wxpayRequest(urlStr, 'POST', bodyObj)
  if (status !== 200 || !body.prepay_id) {
    try { await db.collection('recharges').doc(rechargeId).remove() } catch (_e) {}
    console.error('[payment] createRechargePay fail', status, body)
    throw new Error(body?.message || '创建充值订单失败')
  }

  const pkg     = `prepay_id=${body.prepay_id}`
  const paySign = sign(`${APP_ID}\n${ts}\n${ns}\n${pkg}\n`)
  await db.collection('recharges').doc(rechargeId).update({ data: { wx_prepay_id: body.prepay_id, updated_at: db.serverDate() } })

  return { code: 0, data: { rechargeId, timeStamp: ts, nonceStr: ns, package: pkg, signType: 'RSA', paySign } }
}

// ==============================
//  充值：确认状态（支付后查询）
// ==============================
async function confirmRechargePay(openid, event) {
  const { rechargeId } = event
  const { data: rec } = await db.collection('recharges').doc(rechargeId).get()
  if (!rec || rec.openid !== openid) throw new Error('记录不存在')

  if (rec.status === 'pending_payment') {
    // 原子更新：只有状态还是 pending_payment 时才成功，防止与回调并发双重到账
    const result = await db.collection('recharges').where({
      _id: rechargeId, status: 'pending_payment'
    }).update({
      data: { status: 'approved', paid_at: db.serverDate(), updated_at: db.serverDate() }
    })
    if (result.stats && result.stats.updated > 0) {
      await db.collection('users').where({ openid }).update({
        data: { balance_fen: _.inc(rec.amount_fen), updated_at: db.serverDate() }
      })
    }
    return { code: 0, data: { status: 'approved' } }
  }

  return { code: 0, data: { status: rec.status } }
}

// ==============================
//  支付结果回调（HTTP 触发器）
// ==============================
async function handleNotify(body) {
  if (!body?.resource)
    return { statusCode: 200, body: JSON.stringify({ code: 'FAIL', message: 'no resource' }) }

  const payData = decryptResource(body.resource)
  if (payData.trade_state === 'SUCCESS') {
    const { out_trade_no, transaction_id } = payData

    if (String(out_trade_no).startsWith('RC')) {
      // 充值回调 → 加余额
      const { data: recs } = await db.collection('recharges').where({ out_trade_no }).limit(1).get()
      const rec = recs && recs[0]
      if (rec && rec.status === 'pending_payment') {
        // 原子更新：防止与前端 confirmRechargePay 并发双重到账
        const result = await db.collection('recharges').where({
          _id: rec._id, status: 'pending_payment'
        }).update({
          data: { status: 'approved', wx_transaction_id: transaction_id, paid_at: db.serverDate(), updated_at: db.serverDate() }
        })
        if (result.stats && result.stats.updated > 0) {
          await db.collection('users').where({ openid: rec.openid }).update({
            data: { balance_fen: _.inc(rec.amount_fen), updated_at: db.serverDate() }
          })
        }
      }
    } else {
      // 订单回调 → 标记已付款
      const { data } = await db.collection('orders').where({ order_no: out_trade_no }).limit(1).get()
      if (data.length && data[0].status !== 'paid') {
        await db.collection('orders').doc(data[0]._id).update({
          data: {
            status:                      'paid',
            'payment.wx_transaction_id': transaction_id,
            'payment.paid_at':           db.serverDate(),
            paid_at:                     db.serverDate(),
            updated_at:                  db.serverDate()
          }
        })
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ code: 'SUCCESS', message: 'OK' }) }
}

// ==============================
//  退款（管理员操作）
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
  if (st === 'completed') throw new Error('已结单入账的订单不可在线退款，请线下处理')

  const logRefund = async content => {
    try {
      await db.collection('order_logs').add({
        data: { order_id: orderId, operator_openid: openid, operator_role: 'admin',
                action: '管理员退款', content, images: [], created_at: now }
      })
    } catch (e) { console.warn('[payment] log', e) }
  }

  const tx = order.payment?.wx_transaction_id
  if (tx) {
    // 有微信流水 → 原路退款
    const { status, body } = await wxpayRequest(
      'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
      'POST',
      {
        transaction_id: tx,
        out_refund_no:  'RF' + Date.now(),
        amount: { refund: order.total_amount, total: order.total_amount, currency: 'CNY' }
      }
    )
    if (status !== 200 && status !== 201) {
      console.error('[payment] refund fail', status, body)
      throw new Error(body?.message || '退款失败')
    }
    await db.collection('orders').doc(orderId).update({
      data: { status: 'refunded', 'payment.refunded_at': now, updated_at: now }
    })
    await logRefund('微信原路退款')
    return { code: 0, data: { status: 'refunded' } }
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
    data: { status: 'refunded', 'payment.refunded_at': now,
            'payment.refund_note': method === 'balance' ? '总裁贝已退回' : '无微信流水，仅更新状态',
            updated_at: now }
  })
  await logRefund(method === 'balance' ? '总裁贝退款' : '无原路退款流水，标记为已退款')
  return { code: 0, data: { status: 'refunded' } }
}
