const { order } = require('../../../utils/cloud')

Page({
  data: {
    orderId: '',
    content: '',
    submitting: false
  },

  onLoad(opt) {
    this.setData({ orderId: opt.oid || '' })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  async onSubmit() {
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请填写进度说明', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await order.addLog({ orderId: this.data.orderId, content })
      wx.showToast({ title: '已提交', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
