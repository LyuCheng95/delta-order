const { wallet } = require('../../../utils/cloud')
const { fen2yuan, fmtTime } = require('../../../utils/constants')

Page({
  data: {
    pending: [],
    loading: true,
    refreshing: false
  },

  onShow() {
    this._load()
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const list = await wallet.listPendingAdmin()
      this.setData({
        pending: (list || []).map(r => ({
          ...r,
          amountYuan: fen2yuan(r.amount_fen),
          timeStr: fmtTime(r.created_at)
        }))
      })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this._load()
  },

  onCopy(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.v,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  onPaid(e) {
    const withdrawId = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认已打款',
      content: '确认已向打手微信号完成转账？',
      success: async r => {
        if (!r.confirm) return
        try {
          await wallet.reviewWithdraw({ withdrawId, decision: 'paid' })
          wx.showToast({ title: '已处理', icon: 'success' })
          this._load()
        } catch (_) {}
      }
    })
  },

  onReject(e) {
    const withdrawId = e.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝提现',
      content: '确定拒绝该提现申请？金额将退回打手余额。',
      confirmColor: '#FF4D4F',
      success: async r => {
        if (!r.confirm) return
        try {
          await wallet.reviewWithdraw({ withdrawId, decision: 'rejected' })
          wx.showToast({ title: '已拒绝', icon: 'none' })
          this._load()
        } catch (_) {}
      }
    })
  }
})
