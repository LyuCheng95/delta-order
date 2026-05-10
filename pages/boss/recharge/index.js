const { wallet, payment, config } = require('../../../utils/cloud')
const { fen2zb } = require('../../../utils/constants')
const { openEnterpriseCustomerService } = require('../../../utils/customerService')

const PRESETS = [100, 300, 500, 1000, 2000, 5000]
const STATUS_LABEL = { pending_payment: '处理中', approved: '✅ 已到账', rejected: '❌ 已失败' }

Page({
  data: {
    tab: 'recharge',
    balanceZb: '0',
    presets: PRESETS,
    amount: 0,
    customAmount: '',
    displayAmount: '0',
    paying: false,
    records: [],
    platform: '',
    iosMarkupEnabled: false,
    showIosNotice: false
  },

  onLoad(opts) {
    if (opts.tab === 'history') this.setData({ tab: 'history' })
    const platform = wx.getSystemInfoSync().platform || ''
    this.setData({ platform })
    if (platform === 'ios') this._loadIosConfig()
    this._loadBalance()
    if (this.data.tab === 'history') this._loadHistory()
  },

  async _loadIosConfig() {
    try {
      const res = await config.get('ios_markup_enabled')
      const enabled = !!(res && res.value === true)
      this.setData({ iosMarkupEnabled: enabled, showIosNotice: enabled })
    } catch (_) {}
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
        amount_zb: r.amount_zb != null ? r.amount_zb : fen2zb(r.amount_fen),
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
    if (!amt || amt < 1) { wx.showToast({ title: '最少充值 1 总裁贝', icon: 'none' }); return }

    // iOS + toggle OFF → direct to customer service for proxy recharge
    if (this.data.platform === 'ios' && !this.data.iosMarkupEnabled) {
      wx.showModal({
        title: 'iOS 暂不支持直接充值',
        content: '请联系客服，由客服为您代充总裁贝',
        confirmText: '联系客服',
        cancelText: '取消',
        success: r => { if (r.confirm) openEnterpriseCustomerService() }
      })
      return
    }

    if (this.data.paying) return
    this.setData({ paying: true })

    try {
      // Create recharge order: server generates pf/pfKey and adjusts buyQuantity for iOS markup
      const { rechargeId, outTradeNo, buyQuantity, pf, pfKey, offerId, env } =
        await payment.createRechargeOrder({ amount_zb: amt, platform: this.data.platform || 'android' })

      await new Promise((resolve, reject) => {
        wx.requestVirtualPayment({
          offerId,
          buyQuantity,
          env,
          currencyType: 'CNY',
          scene:        0,
          pf,
          pfKey,
          attachInfo:   outTradeNo,
          success:      resolve,
          fail:         reject
        })
      })

      wx.showLoading({ title: '正在确认到账…', mask: true })
      let credited = false
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500))
        try {
          const { status } = await payment.queryRecharge({ rechargeId })
          if (status === 'approved') { credited = true; break }
          if (status === 'rejected') break
        } catch (_) {}
      }
      wx.hideLoading()

      if (credited) {
        wx.showToast({ title: '充值成功！', icon: 'success' })
        this.setData({ tab: 'history', amount: 0, customAmount: '', displayAmount: '0' })
        await this._loadBalance()
        this._loadHistory()
      } else {
        wx.showModal({
          title: '充值处理中',
          content: '支付已完成，总裁贝正在到账，请稍后刷新余额查看。如长时间未到账请联系客服。',
          showCancel: false
        })
        this._loadHistory()
      }
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || ''
      if (msg.includes('cancel')) return
      console.error('[recharge]', e)
      wx.showModal({ title: '充值失败', content: msg || '未知错误', showCancel: false })
    } finally {
      wx.hideLoading()
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
