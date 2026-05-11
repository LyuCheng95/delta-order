const { wallet } = require('../../../utils/cloud')
const { fen2zb, fmtTime, WITHDRAW_STATUS_LABEL, ROUTES } = require('../../../utils/constants')

Page({
  data: {
    summary: { availableYuan: '0.00', earnedYuan: '0.00', pendingYuan: '0.00', paidOutYuan: '0.00' },
    records: [],
    amountYuan: '',
    amountPlaceholder: '最少 1 元',
    submitting: false,
    loading: true
  },

  onShow() {
    this._load()
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const [s, list] = await Promise.all([wallet.getSummary(), wallet.listMine()])
      const sum = s || {}
      this.setData({
        summary: {
          availableYuan: fen2zb(sum.available_fen),
          earnedYuan: fen2zb(sum.earned_fen),
          pendingYuan: fen2zb(sum.pending_withdraw_fen),
          paidOutYuan: fen2zb(sum.paid_out_fen)
        },
        records: (list || []).map(r => ({
          ...r,
          amountYuan: fen2zb(r.amount_fen),
          statusLabel: WITHDRAW_STATUS_LABEL[r.status] || r.status,
          timeStr: fmtTime(r.created_at)
        }))
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  onAmount(e) {
    this.setData({ amountYuan: e.detail.value })
  },

  onAmountFocus() {
    this.setData({ amountPlaceholder: '' })
  },

  onAmountBlur() {
    if (!this.data.amountYuan) {
      this.setData({ amountPlaceholder: '最少 1 元' })
    }
  },

  fillAll() {
    const y = this.data.summary.availableYuan
    this.setData({ amountYuan: y, amountPlaceholder: '' })
  },

  async submit() {
    const yuan = parseFloat(this.data.amountYuan)
    if (Number.isNaN(yuan) || yuan < 1) {
      wx.showToast({ title: '至少提现 1 元', icon: 'none' })
      return
    }
    const amount_fen = Math.round(yuan * 100)
    this.setData({ submitting: true })
    try {
      await wallet.requestWithdraw({ amount_fen })
      wx.showToast({ title: '申请已提交，等待管理员打款', icon: 'success' })
      this.setData({ amountYuan: '', amountPlaceholder: '最少 1 元' })
      await this._load()
    } finally {
      this.setData({ submitting: false })
    }
  },

  goTasks() {
    wx.navigateTo({ url: ROUTES.HUNTER_TASKS })
  }
})
