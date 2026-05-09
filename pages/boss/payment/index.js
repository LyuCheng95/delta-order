const { order: orderApi, payment, wallet } = require('../../../utils/cloud')
const { fen2zb, ROUTES, STORAGE_BOSS_ORDERS_TAB } = require('../../../utils/constants')

Page({
  data: {
    order:       null,
    balanceZb:   '0',
    balanceFen:  0,
    sufficient:  false,
    paying:      false
  },

  async onLoad(opt) {
    await this._loadOrder(opt.oid)
    await this._loadBalance()
  },

  async onShow() {
    // 返回时刷新余额（用户可能刚完成充值）
    await this._loadBalance()
  },

  async _loadOrder(oid) {
    const data = await orderApi.detail(oid)
    if (data) this.setData({ order: { ...data, totalYuan: fen2zb(data.total_amount) } })
    this._checkSufficient()
  },

  async _loadBalance() {
    try {
      const data = await wallet.getBossWallet()
      const balanceFen = data.balance_fen || 0
      this.setData({ balanceFen, balanceZb: fen2zb(balanceFen) })
      this._checkSufficient()
    } catch (_) {}
  },

  _checkSufficient() {
    const { order, balanceFen } = this.data
    if (!order) return
    this.setData({ sufficient: balanceFen >= order.total_amount })
  },

  copyNo() {
    wx.setClipboardData({
      data: this.data.order.order_no,
      success: () => wx.showToast({ title: '已复制订单号', icon: 'success' })
    })
  },

  // 用总裁贝余额支付服务订单
  async onPayWithBalance() {
    const oid = this.data.order && this.data.order._id
    if (!oid || this.data.paying) return
    if (!this.data.sufficient) {
      wx.showModal({
        title: '余额不足',
        content: '总裁贝余额不足，是否立即充值？',
        confirmText: '去充值',
        success: res => { if (res.confirm) wx.navigateTo({ url: ROUTES.BOSS_RECHARGE }) }
      })
      return
    }
    this.setData({ paying: true })
    try {
      await payment.payOrderWithBalance({ orderId: oid })
      try { wx.setStorageSync(STORAGE_BOSS_ORDERS_TAB, 'paid') } catch (_) {}
      wx.showToast({ title: '支付成功', icon: 'success' })
      setTimeout(() => wx.switchTab({ url: ROUTES.BOSS_ORDERS }), 1500)
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || ''
      console.error('[payment]', e)
      // 余额不足时引导去充值
      if (msg.includes('余额不足') || msg.includes('还需充值')) {
        wx.showModal({
          title: '余额不足', content: msg,
          confirmText: '去充值',
          success: res => { if (res.confirm) wx.navigateTo({ url: ROUTES.BOSS_RECHARGE }) }
        })
      } else {
        wx.showModal({ title: '支付失败', content: msg || '未知错误', showCancel: false })
      }
    } finally {
      this.setData({ paying: false })
    }
  },

  // 余额不足时直接跳去充值
  goRecharge() {
    wx.navigateTo({ url: ROUTES.BOSS_RECHARGE })
  },

  onCancel() {
    wx.showModal({
      title: '取消订单', content: '确定取消？', confirmColor: '#FF4D4D',
      success: async res => {
        if (res.confirm) {
          await orderApi.updateStatus({ orderId: this.data.order._id, status: 'cancelled' })
          wx.showToast({ title: '已取消', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 1000)
        }
      }
    })
  }
})
