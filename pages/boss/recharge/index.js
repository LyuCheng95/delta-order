const { wallet, payment } = require('../../../utils/cloud')
const { fen2zb } = require('../../../utils/constants')

const PRESETS = [100, 300, 500, 1000, 2000, 5000]
const STATUS_LABEL = { pending_payment: '待支付', approved: '✅ 已到账', rejected: '❌ 已失败' }

Page({
  data: {
    tab: 'recharge',
    balanceZb: '0',
    presets: PRESETS,
    amount: 0,
    customAmount: '',
    displayAmount: '0',
    paying: false,
    records: []
  },

  onLoad(opts) {
    if (opts.tab === 'history') this.setData({ tab: 'history' })
    this._loadBalance()
    if (this.data.tab === 'history') this._loadHistory()
  },

  onShow() {
    this._loadBalance()
    if (this.data.tab === 'history') this._loadHistory()
  },

  async _loadBalance() {
    try {
      const data = await wallet.getBossWallet()
      this.setData({ balanceZb: fen2zb(data.balance_fen || 0) })
    } catch (_) {}
  },

  async _loadHistory() {
    try {
      const list = await wallet.listRechargesUser()
      const records = list.map(r => ({
        ...r,
        amount_zb: fen2zb(r.amount_fen),
        statusLabel: STATUS_LABEL[r.status] || r.status,
        timeStr: _fmt(r.created_at)
      }))
      this.setData({ records })
    } catch (_) {}
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (tab === 'history') this._loadHistory()
  },

  selectPreset(e) {
    const val = e.currentTarget.dataset.val
    this.setData({ amount: val, customAmount: String(val), displayAmount: String(val) })
  },

  onCustomInput(e) {
    const v = e.detail.value.replace(/[^\d]/g, '')
    const n = Number(v) || 0
    this.setData({ customAmount: v, amount: n, displayAmount: v || '0' })
  },

  async doRecharge() {
    const amt = Number(this.data.amount)
    if (!amt || amt < 100) { wx.showToast({ title: '最少充值 100 总裁贝', icon: 'none' }); return }
    if (this.data.paying) return
    this.setData({ paying: true })
    try {
      // 1. 创建充值支付订单
      const payParams = await payment.createRechargePay({ amount_fen: amt * 100 })
      // 2. 调起微信支付
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: payParams.timeStamp,
          nonceStr:  payParams.nonceStr,
          package:   payParams.package,
          signType:  payParams.signType || 'RSA',
          paySign:   payParams.paySign,
          success: resolve,
          fail: reject
        })
      })
      // 3. 确认到账
      await payment.confirmRechargePay({ rechargeId: payParams.rechargeId })
      wx.showToast({ title: '充值成功！', icon: 'success' })
      this.setData({ tab: 'history', amount: 0, customAmount: '', displayAmount: '0' })
      await this._loadBalance()
      this._loadHistory()
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || ''
      if (msg.includes('cancel')) return
      console.error('[recharge]', e)
      wx.showModal({ title: '充值失败', content: msg || '未知错误', showCancel: false })
    } finally {
      this.setData({ paying: false })
    }
  }
})

function _fmt(date) {
  if (!date) return ''
  const d = new Date(date)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
