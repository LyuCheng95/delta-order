const { order } = require('../../../utils/cloud')
const { fen2yuan, fmtTime, STATUS_LABEL, ROUTES } = require('../../../utils/constants')
Page({
  data:{ tabs:[{l:'进行中',v:'in_progress'},{l:'待审核',v:'pending_settlement'},{l:'已完成',v:'completed'},{l:'全部',v:'all'}], activeTab:'in_progress', orders:[], loading:true, refreshing:false },
  onShow(){ this._load() },
  async _load(){
    this.setData({loading:true})
    try {
      const d = await order.list({ type: 'hunter', status: this.data.activeTab })
      this.setData({
        orders: (d.list || []).map(o => ({
          ...o,
          statusLabel: STATUS_LABEL[o.status] || o.status,
          totalYuan: fen2yuan(o.total_amount),
          timeStr: fmtTime(o.status === 'completed' ? (o.completed_at || o.updated_at || o.created_at) : o.created_at)
        }))
      })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },
  switchTab(e){ if(e.currentTarget.dataset.v===this.data.activeTab)return; this.setData({activeTab:e.currentTarget.dataset.v}); this._load() },
  onRefresh(){ this.setData({refreshing:true}); this._load() },
  goDetail(e){ wx.navigateTo({url:`${ROUTES.HUNTER_OD}?oid=${e.currentTarget.dataset.id}`}) }
})
