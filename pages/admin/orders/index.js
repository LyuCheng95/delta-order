const { order, payment } = require('../../../utils/cloud')
const { fen2yuan, fmtTime, STATUS_LABEL, ROUTES } = require('../../../utils/constants')
Page({
  data:{ tabs:[{l:'全部',v:''},{l:'待接单',v:'paid'},{l:'待付款',v:'pending_payment'},{l:'进行中',v:'in_progress'},{l:'待结单',v:'pending_settlement'},{l:'已完成',v:'completed'},{l:'已退款',v:'refunded'},{l:'已取消',v:'cancelled'}], activeTab:'', orders:[], loading:true, refreshing:false },
  onShow(){ this._load() },
  async _load(){
    this.setData({loading:true})
    try{
      const d=await order.list({type:'admin',status:this.data.activeTab})
      const orders=(d.list||[]).map(o=>{
        const tx=o.payment&&o.payment.wx_transaction_id
        const settled=o.status==='completed'
        return {
          ...o,
          statusLabel:STATUS_LABEL[o.status]||o.status,
          totalYuan:fen2yuan(o.total_amount),
          timeStr:fmtTime(o.created_at),
          canRefund:!settled&&o.status!=='refunded'&&o.status!=='cancelled',
          canDelete:true,
          hasWxRefund:!!tx
        }
      })
      this.setData({orders})
    }
    finally{ this.setData({loading:false,refreshing:false}) }
  },
  switchTab(e){ if(e.currentTarget.dataset.v===this.data.activeTab)return; this.setData({activeTab:e.currentTarget.dataset.v}); this._load() },
  onRefresh(){ this.setData({refreshing:true}); this._load() },
  goDetail(e){ wx.navigateTo({url:`${ROUTES.BOSS_ORDER_DETAIL}?oid=${e.currentTarget.dataset.id}`}) },
  onAdminRefund(e){
    const id=e.currentTarget.dataset.id
    const row=(this.data.orders||[]).find(o=>o._id===id)
    const hasWx=row&&row.hasWxRefund
    wx.showModal({
      title:'确认退款',
      content:hasWx?'将通过微信支付原路退款，是否继续？':'无微信收款流水时仅更新订单状态（未付单将取消）。是否继续？',
      success:async r=>{
        if(!r.confirm)return
        try{
          const res=await payment.refund(id)
          wx.showToast({title:res&&res.status==='cancelled'?'已关闭':'退款已处理',icon:'success'})
          this._load()
        }catch(_){}
      }
    })
  },
  onAdminDeleteOrder(e){
    const id=e.currentTarget.dataset.id
    wx.showModal({
      title:'删除订单',
      content:'删除后不可恢复，确定删除？',
      confirmColor:'#FF4D4F',
      success:async r=>{
        if(!r.confirm)return
        try{
          await order.adminRemoveOrder(id)
          wx.showToast({title:'已删除',icon:'success'})
          this.setData({orders:this.data.orders.filter(o=>o._id!==id)})
        }catch(_){}
      }
    })
  }
})
