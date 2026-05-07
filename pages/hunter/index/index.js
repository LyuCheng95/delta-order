const { order, wallet, auth } = require('../../../utils/cloud')
const { fen2yuan, fmtTime, STATUS_LABEL, ROUTES } = require('../../../utils/constants')
const { formatBossBrief } = require('../../../utils/orderFormDisplay')
const { hasRole } = require('../../../utils/roles')
const app = getApp()

Page({
  data: {
    // ── 页面 tab ──
    tab: 0,   // 0=接单大厅  1=已接单  2=资金  (设置→右上角⚙️按钮)

    // ── 接单大厅 ──
    openOrders: [], hallLoading: true, hallRefreshing: false,

    // ── 已接单 ──
    myOrders: [], myTab: 'in_progress',
    myLoading: true, myRefreshing: false,
    mySubTabs: [
      { l: '进行中', v: 'in_progress' },
      { l: '待结单审核', v: 'pending_settlement' },
      { l: '已完成', v: 'completed' },
      { l: '全部', v: 'all' }
    ],

    // ── 资金 ──
    summary: { availableYuan: '0.00', earnedYuan: '0.00', pendingYuan: '0.00', paidOutYuan: '0.00', sharePercent: 70, bankCardDisplay: '未填写' },
    withdrawRecords: [],
    amountYuan: '',
    // 设置 tab
    nickname: '',
    nicknameInput: '',
    editingNick: false,
    savingNick: false,
    bankCardDisplay: '未填写',
    bankCardInput: '',
    editingCard: false,
    savingCard: false,
    amountPlaceholder: '最少 1 元',
    submitting: false,
    walletLoading: true,

    statusH: 0,
    profileIncomplete: false,
    avatarUrl: ''
  },

  onLoad() {
    this.setData({ statusH: wx.getSystemInfoSync().statusBarHeight })
    this._loadProfileData()
  },

  toggleEditNick() {
    this.setData({ editingNick: !this.data.editingNick })
  },

  onNicknameInput(e) {
    this.setData({ nicknameInput: e.detail.value })
  },

  async saveNickname() {
    const nickname = this.data.nicknameInput.trim()
    if (!nickname) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    this.setData({ savingNick: true })
    try {
      await auth.updateNickname({ nickname })
      if (app.globalData.userInfo) app.globalData.userInfo.nickname = nickname
      this.setData({ nickname, editingNick: false })
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } finally {
      this.setData({ savingNick: false })
    }
  },

  toggleEditCard() {
    this.setData({ editingCard: !this.data.editingCard })
  },

  onBankCardInput(e) {
    this.setData({ bankCardInput: e.detail.value })
  },

  async saveBankCard() {
    const card = this.data.bankCardInput.replace(/\s/g, '')
    if (card.length < 16) {
      wx.showToast({ title: '请填写正确的银行卡号', icon: 'none' }); return
    }
    this.setData({ savingCard: true })
    try {
      await auth.updateBankCard({ bank_card: card })
      if (app.globalData.userInfo) {
        if (!app.globalData.userInfo.hunter_info) app.globalData.userInfo.hunter_info = {}
        app.globalData.userInfo.hunter_info.bank_card = card
      }
      this.setData({
        bankCardDisplay: '**** **** **** ' + card.slice(-4),
        editingCard: false
      })
      // 同步资金 tab 的显示
      this.setData({ 'summary.bankCardDisplay': '**** **** **** ' + card.slice(-4) })
      wx.showToast({ title: '银行卡已更新', icon: 'success' })
    } finally {
      this.setData({ savingCard: false })
    }
  },

  /** 退出打手中心 → 老板端（需具备老板身份） */
  exitToBoss() {
    const roles = app.globalData.roles || (app.globalData.userInfo && app.globalData.userInfo.roles) || []
    if (!hasRole(roles, 'boss')) {
      wx.showToast({ title: '当前账号无老板身份', icon: 'none' })
      return
    }
    wx.reLaunch({ url: ROUTES.BOSS_HOME })
  },

  onShow() {
    this._loadProfileData()
    const t = this.data.tab
    if (t === 0) this._loadHall()
    else if (t === 1) this._loadMyOrders()
    else if (t === 2) this._loadWallet()
  },

  _loadProfileData() {
    const u = app.globalData.userInfo || {}
    const hi = u.hunter_info || {}
    const card = hi.bank_card
    const profileComplete = !!(u.avatar_url && u.nickname && hi.bio && (hi.service_tags || []).length > 0)
    this.setData({
      nickname: u.nickname || '打手',
      avatarUrl: u.avatar_url || '',
      nicknameInput: u.nickname || '',
      bankCardDisplay: card ? ('**** **** **** ' + String(card).slice(-4)) : '未填写',
      bankCardInput: card || '',
      profileIncomplete: !profileComplete
    })
  },

  // ────── Tab 切换 ──────
  switchTab(e) {
    const idx = +e.currentTarget.dataset.idx
    if (idx === this.data.tab) return
    this.setData({ tab: idx })
    if (idx === 0)      this._loadHall()
    else if (idx === 1) this._loadMyOrders()
    else if (idx === 2) this._loadWallet()
  },

  // ────── 接单大厅 ──────
  async _loadHall() {
    this.setData({ hallLoading: true })
    try {
      const myOpenid = (app.globalData.userInfo || {}).openid || ''
      const d = await order.list({ type: 'open' })
      this.setData({
        openOrders: (d.list || []).map(o => {
          const ph  = String(o.preferred_hunter_openid    || '').trim()
          const pco = String(o.preferred_co_hunter_openid || '').trim()
          const isDesignated = (ph && ph === myOpenid) || (pco && pco === myOpenid)
          return {
            ...o,
            totalYuan: fen2yuan(o.total_amount),
            timeStr: fmtTime(o.created_at),
            bossBrief: formatBossBrief(o),
            isDesignated,
            preferred_time: o.preferred_time || ''
          }
        })
      })
    } finally {
      this.setData({ hallLoading: false, hallRefreshing: false })
    }
  },

  onHallRefresh() { this.setData({ hallRefreshing: true }); this._loadHall() },

  async takeOrder(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认接单', content: '接单后请尽快联系老板开始执行',
      success: async r => {
        if (!r.confirm) return
        await order.take(id)
        wx.showToast({ title: '接单成功！', icon: 'success' })
        this.setData({ tab: 1 })
        this._loadMyOrders()
        this._loadHall()
      }
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: `${ROUTES.HUNTER_OD}?oid=${e.currentTarget.dataset.id}` })
  },

  goProfile() {
    wx.navigateTo({ url: ROUTES.HUNTER_PROFILE })
  },

  rejectDesignated(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝指定单',
      content: '确认拒绝？订单将对其他打手开放',
      success: async r => {
        if (!r.confirm) return
        try {
          await order.rejectDesignated({ orderId: id })
          wx.showToast({ title: '已拒绝', icon: 'success' })
          this._loadHall()
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  // ────── 已接单 ──────
  async _loadMyOrders() {
    this.setData({ myLoading: true })
    try {
      const d = await order.list({ type: 'hunter', status: this.data.myTab })
      this.setData({
        myOrders: (d.list || []).map(o => ({
          ...o,
          statusLabel: STATUS_LABEL[o.status] || o.status,
          totalYuan: fen2yuan(o.total_amount),
          timeStr: fmtTime(o.status === 'completed'
            ? (o.completed_at || o.updated_at || o.created_at)
            : o.created_at)
        }))
      })
    } finally {
      this.setData({ myLoading: false, myRefreshing: false })
    }
  },

  switchMyTab(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.myTab) return
    this.setData({ myTab: v })
    this._loadMyOrders()
  },

  onMyRefresh() { this.setData({ myRefreshing: true }); this._loadMyOrders() },

  // ────── 资金 ──────
  async _loadWallet() {
    this.setData({ walletLoading: true })
    try {
      const walletResults = await Promise.all([wallet.getSummary(), wallet.listMine()])
      const s = walletResults[0]
      const list = walletResults[1]
      const sum = s || {}
      const u = app.globalData.userInfo || {}
      const card = u.hunter_info && u.hunter_info.bank_card
      this.setData({
        summary: {
          availableYuan: fen2yuan(sum.available_fen),
          earnedYuan: fen2yuan(sum.earned_fen),
          pendingYuan: fen2yuan(sum.pending_withdraw_fen),
          paidOutYuan: fen2yuan(sum.paid_out_fen),
          sharePercent: sum.share_percent != null ? sum.share_percent : 70,
          bankCardDisplay: card ? ('**** **** **** ' + String(card).slice(-4)) : '未填写，请前往个人页面添加'
        },
        withdrawRecords: (list || []).map(r => ({
          ...r,
          amountYuan: fen2yuan(r.amount_fen),
          statusLabel:
            r.status === 'pending'  ? '待打款' :
            r.status === 'paid'     ? '✅ 已打款' : '❌ 已拒绝',
          timeStr: fmtTime(r.created_at)
        }))
      })
    } finally {
      this.setData({ walletLoading: false })
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
    this.setData({ amountYuan: this.data.summary.availableYuan, amountPlaceholder: '' })
  },

  async submitWithdraw() {
    const u = app.globalData.userInfo || {}
    if (!u.hunter_info || !u.hunter_info.bank_card) {
      wx.showModal({ title: '未填写银行卡', content: '请先前往个人页面填写收款银行卡号', showCancel: false })
      return
    }
    const yuan = parseFloat(this.data.amountYuan)
    if (Number.isNaN(yuan) || yuan < 1) {
      wx.showToast({ title: '至少提现 1 元', icon: 'none' }); return
    }
    this.setData({ submitting: true })
    try {
      await wallet.requestWithdraw({ amount_fen: Math.round(yuan * 100) })
      wx.showToast({ title: '申请已提交，等待管理员打款', icon: 'success' })
      this.setData({ amountYuan: '', amountPlaceholder: '最少 1 元' })
      this._loadWallet()
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
