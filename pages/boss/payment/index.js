const { order: orderApi, payment } = require('../../../utils/cloud')
const { fen2zb, ROUTES, STORAGE_BOSS_ORDERS_TAB } = require('../../../utils/constants')

Page({
  data: { order: null, paying: false },

  onLoad(opt) {
    this._load(opt.oid)
  },

  async _load(oid) {
    const data = await orderApi.detail(oid)
    if (data) this.setData({ order: { ...data, totalYuan: fen2zb(data.total_amount) } })
  },

  copyNo() {
    wx.setClipboardData({
      data: this.data.order.order_no,
      success: () => wx.showToast({ title: '已复制订单号', icon: 'success' })
    })
  },

  async onWxPay() {
    const oid = this.data.order && this.data.order._id
    if (!oid || this.data.paying) return
    this.setData({ paying: true })
    try {
      const payParams = await payment.createPay(oid)
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: payParams.timeStamp,
          nonceStr: payParams.nonceStr,
          package: payParams.package,
          signType: payParams.signType || 'RSA',
          paySign: payParams.paySign,
          success: resolve,
          fail: reject
        })
      })
      await payment.confirmPay(oid)
      try { wx.setStorageSync(STORAGE_BOSS_ORDERS_TAB, 'paid') } catch (e) {}
      wx.showToast({ title: '支付成功', icon: 'success' })
      setTimeout(() => wx.switchTab({ url: ROUTES.BOSS_ORDERS }), 1500)
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || ''
      if (msg.includes('cancel')) return
      console.error('[payment]', e)
      wx.showModal({ title: '支付失败', content: msg || '未知错误', showCancel: false })
    } finally {
      this.setData({ paying: false })
    }
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
