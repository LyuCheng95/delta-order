const { auth } = require('../../../utils/cloud')
const { fen2yuan } = require('../../../utils/constants')

const LABEL = {
  none: '未申请',
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  dismissed: '已解雇'
}

Page({
  data: {
    mainTab: 'apply',
    tabs: [
      { l: '待审核', v: 'pending' },
      { l: '已通过', v: 'approved' },
      { l: '已拒绝', v: 'rejected' }
    ],
    activeTab: 'pending',
    hunters: [],
    activeList: [],
    loading: true,
    refreshing: false
  },

  onShow() {
    this._loadOrManage()
  },

  _loadOrManage() {
    if (this.data.mainTab === 'manage') this._loadManage()
    else this._load()
  },

  switchMain(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.mainTab) return
    this.setData({ mainTab: v })
    if (v === 'manage') this._loadManage()
    else this._load()
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const d = await auth.listApply()
      const tab = this.data.activeTab
      const list = (d || []).filter(u => {
        const s = u.hunter_info?.apply_status || 'none'
        if (tab === 'rejected') return s === 'rejected' || s === 'dismissed'
        return s === tab
      })
      this.setData({
        hunters: list.map(u => ({
          ...u,
          statusLabel: LABEL[u.hunter_info?.apply_status || 'none'] || u.hunter_info?.apply_status
        }))
      })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  async _loadManage() {
    this.setData({ loading: true })
    try {
      const d = await auth.listActiveHunters()
      this.setData({
        activeList: (d || []).map(u => ({
          ...u,
          earnedYuan: fen2yuan(u.earned_fen || 0),
          share_percent: u.share_percent != null ? u.share_percent : 70,
          contact: u.contact || ''
        }))
      })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  switchTab(e) {
    if (e.currentTarget.dataset.v === this.data.activeTab) return
    this.setData({ activeTab: e.currentTarget.dataset.v })
    this._load()
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this._load()
  },

  onRefreshManage() {
    this.setData({ refreshing: true })
    this._loadManage()
  },

  async onApprove(e) {
    try {
      await auth.reviewHunter({ userId: e.currentTarget.dataset.id, decision: 'approve' })
      wx.showToast({ title: '已通过', icon: 'success' })
      this._load()
    } catch (_) {}
  },

  onReject(e) {
    wx.showModal({
      title: '拒绝原因',
      editable: true,
      success: async r => {
        if (!r.confirm) return
        try {
          await auth.reviewHunter({
            userId: e.currentTarget.dataset.id,
            decision: 'reject',
            reason: r.content || ''
          })
          wx.showToast({ title: '已拒绝', icon: 'none' })
          this._load()
        } catch (_) {}
      }
    })
  },

  onEditShare(e) {
    const id = e.currentTarget.dataset.id
    const cur = e.currentTarget.dataset.share
    wx.showModal({
      title: '分成比例 0～100（确认结单时生效）',
      editable: true,
      placeholderText: String(cur),
      success: async r => {
        if (!r.confirm) return
        const p = parseInt(r.content, 10)
        if (Number.isNaN(p) || p < 0 || p > 100) {
          wx.showToast({ title: '请输入 0～100 的整数', icon: 'none' })
          return
        }
        try {
          await auth.updateHunterShare({ userId: id, share_percent: p })
          wx.showToast({ title: '已保存', icon: 'success' })
          this._loadManage()
        } catch (_) {}
      }
    })
  },

  onCopyContact(e) {
    const contact = e.currentTarget.dataset.contact
    const phone = contact.replace(/[\s\-()]/g, '')
    const isPhone = /^1[3-9]\d{9}$/.test(phone)
    if (isPhone) {
      wx.showActionSheet({
        itemList: ['📞 拨打电话', '📋 复制号码'],
        success: r => {
          if (r.tapIndex === 0) {
            wx.makePhoneCall({ phoneNumber: phone })
          } else {
            wx.setClipboardData({ data: contact, success: () => wx.showToast({ title: '已复制', icon: 'success' }) })
          }
        }
      })
    } else {
      wx.setClipboardData({
        data: contact,
        success: () => wx.showToast({ title: '微信号已复制，去微信搜索添加', icon: 'none', duration: 2500 })
      })
    }
  },

  onDismiss(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该陪玩师'
    wx.showModal({
      title: '移除陪玩师',
      content: `确定移除「${name}」？将失去陪玩师身份，如有进行中订单请线下协调。`,
      confirmColor: '#FF4D4D',
      success: async r => {
        if (!r.confirm) return
        try {
          await auth.dismissHunter({ userId: id })
          wx.showToast({ title: '已解雇', icon: 'none' })
          this._loadManage()
        } catch (_) {}
      }
    })
  }
})
