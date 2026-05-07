const app = getApp()
const { order } = require('../../../utils/cloud')
const { fen2zb, fmtTime, STATUS_LABEL, ROUTES } = require('../../../utils/constants')
const { hasRole } = require('../../../utils/roles')
const { buildFormRows } = require('../../../utils/orderFormDisplay')

Page({
  data: { order: null, logs: [], isAdmin: false },

  onLoad(opt) {
    this._setAdminFlag()
    this._load(opt.oid)
  },
  onShow() {
    this._setAdminFlag()
    if (this.data.order && this.data.order._id) this._load(this.data.order._id)
  },

  _setAdminFlag() {
    const roles = app.globalData.roles || (app.globalData.userInfo && app.globalData.userInfo.roles) || []
    this.setData({ isAdmin: hasRole(roles, 'admin') })
  },

  async _load(oid) {
    const [o, logsData] = await Promise.all([order.detail(oid), order.getLogs(oid)])
    if (!o) return
    const proofUrls = (o.completion_proof && o.completion_proof.file_ids) || []
    const formRows = buildFormRows(o)
    this.setData({
      order: {
        ...o,
        statusLabel: STATUS_LABEL[o.status] || o.status,
        totalZb: fen2zb(o.total_amount),
        proofUrls,
        formRows
      },
      logs: (logsData || []).map(l => ({ ...l, timeStr: fmtTime(l.created_at), images: l.images || [] }))
    })
  },

  previewImg(e) { wx.previewImage({ urls:e.currentTarget.dataset.urls, current:e.currentTarget.dataset.urls[e.currentTarget.dataset.idx] }) },
  goPay()   { wx.navigateTo({ url:`${ROUTES.BOSS_PAYMENT}?oid=${this.data.order._id}` }) },
  onCancel() {
    wx.showModal({ title:'取消订单', content:'确定取消？', confirmColor:'#FF4D4D', success: async r => {
      if (r.confirm) {
        await order.updateStatus({ orderId:this.data.order._id, status:'cancelled' })
        this.setData({ 'order.status':'cancelled', 'order.statusLabel':'已取消' })
        wx.showToast({title:'已取消',icon:'none'})
      }
    }})
  },

  adminConfirmSettlement() {
    const id = this.data.order && this.data.order._id
    if (!id) return
    wx.showModal({
      title: '确认完成',
      content: '确认后订单完成，将按该陪玩师当前分成比例结算入账（可提现）。',
      success: async r => {
        if (!r.confirm) return
        try {
          await order.confirmSettlement({ orderId: id })
          wx.showToast({ title: '已确认', icon: 'success' })
          await this._load(id)
        } catch (_) {}
      }
    })
  },

  adminRejectSettlement() {
    const id = this.data.order && this.data.order._id
    if (!id) return
    wx.showModal({
      title: '驳回原因',
      editable: true,
      placeholderText: '请说明陪玩师需如何修改',
      success: async r => {
        if (!r.confirm) return
        try {
          await order.rejectSettlement({ orderId: id, reason: r.content || '' })
          wx.showToast({ title: '已驳回', icon: 'none' })
          await this._load(id)
        } catch (_) {}
      }
    })
  }
})
