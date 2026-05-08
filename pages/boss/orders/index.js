const { order } = require('../../../utils/cloud')
const { fen2zb, fmtTime, STATUS_LABEL, ROUTES, STORAGE_BOSS_ORDERS_TAB } = require('../../../utils/constants')
const app = getApp()

Page({
  data: {
    tabs:[{l:'待接单',v:'paid'},{l:'待付款',v:'pending_payment'},{l:'进行中',v:'in_progress'},{l:'已完成',v:'completed'},{l:'已取消',v:'cancelled'},{l:'全部',v:''}],
    activeTab:'', orders:[], loading:true, refreshing:false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, showHunterTab: !!app.globalData.hasActiveHunters })
    }
    let pending = ''
    try {
      pending = wx.getStorageSync(STORAGE_BOSS_ORDERS_TAB) || ''
      if (pending) wx.removeStorageSync(STORAGE_BOSS_ORDERS_TAB)
    } catch (e) {}
    if (pending) {
      this.setData({ activeTab: pending }, () => this._load())
      return
    }
    this._load()
  },

  async _load() {
    this.setData({ loading:true })
    try {
      const data = await order.list({ type:'boss', status:this.data.activeTab })
      const list = (data.list||[]).map(o => ({...o, statusLabel:STATUS_LABEL[o.status]||o.status, totalYuan:fen2zb(o.total_amount), timeStr:fmtTime(o.created_at)}))
      this.setData({ orders:list })
    } finally {
      this.setData({ loading:false, refreshing:false })
    }
  },

  switchTab(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.activeTab) return
    this.setData({ activeTab:v })
    this._load()
  },

  onRefresh() { this.setData({ refreshing:true }); this._load() },
  goDetail(e) { wx.navigateTo({ url:`${ROUTES.BOSS_ORDER_DETAIL}?oid=${e.currentTarget.dataset.id}` }) }
})
