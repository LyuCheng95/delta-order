const { auth, order, service, payment, wallet, config } = require('../../../utils/cloud')
const { fen2yuan, fen2zb, fmtTime, STATUS_LABEL, ROUTES } = require('../../../utils/constants')

const H_LABEL = {
  none: '未申请',
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  dismissed: '已解雇'
}

const W_STATUS_MAP = {
  pending: { label: '待打款', cls: 'badge-paid' },
  paid: { label: '✅ 已打款', cls: 'badge-completed' },
  rejected: { label: '❌ 已拒绝', cls: 'badge-cancelled' }
}

function fmtWithdraw(r) {
  const s = W_STATUS_MAP[r.status] || { label: r.status, cls: '' }
  return {
    ...r,
    amountYuan: fen2zb(r.amount_fen),
    timeStr: fmtTime(r.created_at),
    statusLabel: s.label,
    statusCls: s.cls,
    bankCardDisplay: r.bank_card || '—'
  }
}

Page({
  data: {
    adminTab: 'orders',
    iosMarkupEnabled: true,   // 默认 true，onShow 后会刷新
    adminNav: [
      { k: 'orders', l: '订单' },
      { k: 'withdrawals', l: '发工资' },
      { k: 'recharges', l: '充值流水' },
      { k: 'services', l: '服务' },
      { k: 'hunters', l: '陪玩师' },
      { k: 'settings', l: '⚙️设置' },
    ],
    // 代充 tab
    proxyNickname:  '',
    proxyResults:   [],
    proxySelected:  null,
    proxyAmount:    '',
    proxying:       false,

    orderFilter: '',
    orderTabs: [
      { l: '全部', v: '' },
      { l: '待接单', v: 'paid' },
      { l: '待付款', v: 'pending_payment' },
      { l: '进行中', v: 'in_progress' },
      { l: '待审核', v: 'pending_settlement' },
      { l: '已完成', v: 'completed' },
      { l: '已退款', v: 'refunded' },
      { l: '已取消', v: 'cancelled' },
      { l: '已删除', v: 'deleted' }
    ],
    orders: [],
    ordersLoading: false,
    menuOpenId: '',

    // 指定协同 sheet
    showCoSheet: false,
    coSheetOrderId: '',
    coSheetHasCo: false,
    coAllHunters: [],
    coFilteredHunters: [],
    coKeyword: '',
    coSelectedHunter: null,
    coSplitVal: 50,

    wTab: 0,
    wPending: [],
    wAll: [],
    wLoading: false,
    wSelected: [],
    wSelectedMap: {},
    wSelectAll: false,
    wSelectedTotal: '0.00',
    wBatchLoading: false,
    wGroups: [],

    rList: [],
    rLoading: false,

    svcSub: 'cats',
    cats: [],
    svcs: [],
    filteredSvcs: [],
    selectedCatId: '',
    selectedCatName: '',
    svcLoading: false,

    hMain: 'manage',
    hApplyTabs: [
      { l: '待审核', v: 'pending' },
      { l: '已通过', v: 'approved' },
      { l: '已拒绝', v: 'rejected' }
    ],
    hApplyTab: 'pending',
    hunters: [],
    activeHunters: [],
    filteredHunters: [],
    hKeyword: '',
    hLoading: false,
    hRefreshing: false,

    csQrUrl: '',
    csQrUploading: false
  },

  onShow() {
    this._loadIosMarkupConfig()
    this._refreshCurrent()
    this._checkUnread()
  },

  // 加载 iOS 加价开关，同时动态更新导航 tab
  async _loadIosMarkupConfig() {
    try {
      const res = await config.get('ios_markup_enabled')
      const enabled = !!(res && res.value === true)
      this.setData({ iosMarkupEnabled: enabled, adminNav: this._buildAdminNav(enabled) })
    } catch (_) {}
  },

  _buildAdminNav(iosMarkupEnabled) {
    const nav = [
      { k: 'orders',      l: '订单' },
      { k: 'withdrawals', l: '发工资' },
      { k: 'recharges',   l: '充值流水' },
      { k: 'services',    l: '服务' },
      { k: 'hunters',     l: '陪玩师' },
    ]
    if (!iosMarkupEnabled) nav.push({ k: 'proxy_recharge', l: '代充' })
    nav.push({ k: 'settings', l: '⚙️设置' })
    return nav
  },

  onAdminNav(e) {
    const k = e.currentTarget.dataset.k
    if (!k) return
    if (k === 'services') {
      wx.navigateTo({ url: ROUTES.ADMIN_SVCS })
      return
    }

    if (k === this.data.adminTab) return
    this.setData({ adminTab: k })
    this._refreshCurrent()
  },

  _refreshCurrent() {
    const t = this.data.adminTab
    if (t === 'orders') this._loadOrders()
    else if (t === 'withdrawals') this._loadWithdrawals()
    else if (t === 'recharges') this._loadRecharges()
    else if (t === 'services') this._loadServices()
    else if (t === 'hunters') this._loadHuntersBlock()
    else if (t === 'settings') this._loadSettings()
    // proxy_recharge: user-driven search, no auto-load needed
  },

  async onMsgHunter(e) {
    // chat removed
  },

  switchOrderFilter(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.orderFilter) return
    this.setData({ orderFilter: v })
    this._loadOrders()
  },

  async _loadOrders() {
    this.setData({ ordersLoading: true })
    try {
      const d = await order.list({ type: 'admin', status: this.data.orderFilter })
      const list = (d.list || []).map(o => {
        const tx = o.payment && o.payment.wx_transaction_id
        const settled = o.status === 'completed'
        const canRefund =
          !settled && o.status !== 'refunded' && o.status !== 'cancelled' && o.status !== 'pending_payment'
        const canDelete = true
        return {
          ...o,
          statusLabel: STATUS_LABEL[o.status] || o.status,
          totalZb: fen2zb(o.total_amount),
          timeStr: fmtTime(o.created_at),
          canRefund,
          canDelete,
          hasWxRefund: !!tx,
          bossName: (o.boss_snapshot && o.boss_snapshot.nickname) || '',
          bossContact: (o.boss_snapshot && o.boss_snapshot.contact) || '',
          hunterName: (o.hunter_snapshot && o.hunter_snapshot.nickname) || '',
          hunterContact: (o.hunter_snapshot && o.hunter_snapshot.contact) || '',
          coHunterName: (o.co_hunter_snapshot && o.co_hunter_snapshot.nickname) || '',
          coHunterContact: (o.co_hunter_snapshot && o.co_hunter_snapshot.contact) || '',
          coHunterSplit: o.co_hunter_split != null ? o.co_hunter_split : 50,
          canAssignCo: ['in_progress', 'pending_settlement'].includes(o.status)
        }
      })
      this.setData({ orders: list })
    } finally {
      this.setData({ ordersLoading: false })
    }
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({ menuOpenId: '' })
    wx.navigateTo({ url: `${ROUTES.BOSS_ORDER_DETAIL}?oid=${id}` })
  },

  toggleMenu(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ menuOpenId: this.data.menuOpenId === id ? '' : id })
  },

  onAdminRefund(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.orders || []).find(o => o._id === id)
    const hasWx = row && row.hasWxRefund
    wx.showModal({
      title: '确认退款',
      content: hasWx
        ? '将通过微信支付原路退款，是否继续？'
        : '无微信收款流水时仅更新订单状态（未付单将取消）。是否继续？',
      success: async r => {
        if (!r.confirm) return
        try {
          const res = await payment.refund(id)
          const st = res && res.status
          wx.showToast({
            title: st === 'cancelled' ? '已关闭' : '退款已处理',
            icon: 'success'
          })
          this._loadOrders()
        } catch (_) {}
      }
    })
  },

  onAdminDeleteOrder(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ menuOpenId: '' })
    wx.showModal({
      title: '删除订单',
      content: '订单将标记为已删除，不计入统计，仍可在「已删除」tab查看。确定？',
      confirmColor: '#FF4D4F',
      success: async r => {
        if (!r.confirm) return
        try {
          await order.adminRemoveOrder(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          this._loadOrders()
        } catch (_) {}
      }
    })
  },

  onWalletTab(e) {
    const idx = +e.currentTarget.dataset.idx
    if (idx === this.data.wTab) return
    this.setData({ wTab: idx })
    this._loadWithdrawals()
  },

  async _loadWithdrawals() {
    this.setData({ wLoading: true, wSelected: [], wSelectedMap: {}, wSelectAll: false, wSelectedTotal: '0.00', wGroups: [] })
    try {
      if (this.data.wTab === 0) {
        const raw = await wallet.listPendingAdmin()
        const pending = (raw || []).map(fmtWithdraw)
        this.setData({ wPending: pending, wGroups: this._buildGroups(pending, {}) })
      } else {
        const raw = await wallet.listAllAdmin()
        this.setData({ wAll: (raw || []).map(fmtWithdraw) })
      }
    } finally {
      this.setData({ wLoading: false })
    }
  },

  _buildGroups(items, selectedMap) {
    const groupMap = {}
    const order = []
    for (const item of (items || [])) {
      const key = item.openid || item._id
      if (!groupMap[key]) {
        groupMap[key] = {
          openid: key,
          nickname: item.hunter_nickname || '陪玩师',
          bankCardDisplay: item.bankCardDisplay || '—',
          items: [],
          totalFen: 0
        }
        order.push(key)
      }
      groupMap[key].items.push(item)
      groupMap[key].totalFen += (item.amount_fen || 0)
    }
    return order.map(key => {
      const g = groupMap[key]
      const selCount = g.items.filter(i => selectedMap && selectedMap[i._id]).length
      return {
        ...g,
        totalYuan: fen2zb(g.totalFen),
        allSelected: selCount === g.items.length && g.items.length > 0,
        partialSelected: selCount > 0 && selCount < g.items.length
      }
    })
  },

  _computeWGroups(selected) {
    const map = {}
    let totalFen = 0
    for (const id of selected) {
      map[id] = true
      const item = (this.data.wPending || []).find(w => w._id === id)
      if (item) totalFen += (item.amount_fen || 0)
    }
    const yuan = fen2zb(totalFen)
    const all = this.data.wPending.length > 0 && selected.length === this.data.wPending.length
    const groups = this._buildGroups(this.data.wPending, map)
    this.setData({ wSelected: selected, wSelectedMap: map, wSelectAll: all, wSelectedTotal: yuan, wGroups: groups })
  },

  toggleWGroup(e) {
    const openid = e.currentTarget.dataset.openid
    const group = (this.data.wGroups || []).find(g => g.openid === openid)
    if (!group) return
    const cur = [...this.data.wSelected]
    const groupIds = group.items.map(i => i._id)
    if (group.allSelected) {
      this._computeWGroups(cur.filter(id => !groupIds.includes(id)))
    } else {
      const extra = groupIds.filter(id => !cur.includes(id))
      this._computeWGroups([...cur, ...extra])
    }
  },

  wToggleSelectAll() {
    if (this.data.wSelectAll) {
      this._computeWGroups([])
    } else {
      this._computeWGroups((this.data.wPending || []).map(w => w._id))
    }
  },

  async wBatchPay() {
    const ids = this.data.wSelected
    if (!ids.length) { wx.showToast({ title: '请先勾选记录', icon: 'none' }); return }
    wx.showModal({
      title: '确认已打款',
      content: `请确认已手动微信转账给 ${ids.length} 位陪玩师，共 ${this.data.wSelectedTotal} 总裁贝，标记后不可撤销。`,
      success: async r => {
        if (!r.confirm) return
        this.setData({ wBatchLoading: true })
        try {
          const res = await wallet.batchReviewWithdraw({ withdrawIds: ids, decision: 'paid' })
          this._loadWithdrawals()
          const ok = (res.succeeded || []).length
          const fail = (res.failed || []).length
          if (fail === 0) {
            wx.showToast({ title: `已标记 ${ok} 笔打款`, icon: 'success' })
          } else {
            wx.showModal({
              title: `${ok} 笔成功，${fail} 笔失败`,
              content: `失败原因：${(res.failed[0] && res.failed[0].reason) || '未知'}`,
              showCancel: false
            })
          }
        } catch (err) {
          wx.showModal({ title: '操作失败', content: err.message || '请稍后重试', showCancel: false })
        } finally {
          this.setData({ wBatchLoading: false })
        }
      }
    })
  },

  wBatchReject() {
    const ids = this.data.wSelected
    if (!ids.length) { wx.showToast({ title: '请先勾选记录', icon: 'none' }); return }
    wx.showModal({
      title: '批量拒绝',
      editable: true,
      placeholderText: '拒绝原因（选填）',
      success: async r => {
        if (!r.confirm) return
        try {
          await wallet.batchReviewWithdraw({ withdrawIds: ids, decision: 'rejected', reject_reason: r.content || '' })
          wx.showToast({ title: '已拒绝', icon: 'none' })
          this._loadWithdrawals()
        } catch (_) {}
      }
    })
  },

  async _loadRecharges() {
    this.setData({ rLoading: true })
    try {
      const raw = await wallet.listRechargesAdmin()
      const R_LABEL = { pending_payment: '待支付', approved: '✅ 已到账', rejected: '❌ 已失败' }
      const R_CLS = { pending_payment: 'badge-paid', approved: 'badge-completed', rejected: 'badge-cancelled' }
      const rList = (raw || []).map(r => ({
        ...r,
        amountZb: fen2zb(r.amount_fen),
        timeStr: fmtTime(r.created_at),
        statusLabel: R_LABEL[r.status] || r.status,
        statusCls: R_CLS[r.status] || ''
      }))
      this.setData({ rList })
    } finally {
      this.setData({ rLoading: false })
    }
  },

  onApproveRecharge(e) {
    const id = e.currentTarget.dataset.id
    const zb = e.currentTarget.dataset.zb
    wx.showModal({
      title: '确认到账',
      content: `确认已收到 ${zb} 总裁贝对应款项，并为玩家充值？`,
      success: async r => {
        if (!r.confirm) return
        try {
          await wallet.reviewRecharge({ rechargeId: id, decision: 'approved' })
          wx.showToast({ title: '充值已到账', icon: 'success' })
          this._loadRecharges()
        } catch (_) {}
      }
    })
  },

  onRejectRecharge(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝原因',
      editable: true,
      placeholderText: '请填写拒绝原因（选填）',
      success: async r => {
        if (!r.confirm) return
        try {
          await wallet.reviewRecharge({ rechargeId: id, decision: 'rejected', admin_note: r.content || '' })
          wx.showToast({ title: '已拒绝', icon: 'none' })
          this._loadRecharges()
        } catch (_) {}
      }
    })
  },

  switchSvcSub(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.svcSub) return
    this.setData({ svcSub: v })
    this._loadServices()
  },

  async _loadServices() {
    this.setData({ svcLoading: true })
    try {
      const [catList, svcList] = await Promise.all([
        service.listCatsAdmin(),
        service.listSvcsAdmin()
      ])
      const svcs = (svcList || []).map(x => ({
        ...x,
        priceZb: fen2zb(x.price),
      }))
      const cats = catList || []
      // 保持已选中分类，若无则默认选第一个
      let selId = this.data.selectedCatId
      if (!selId && cats.length) selId = cats[0]._id
      const selCat = cats.find(c => c._id === selId) || cats[0] || null
      this.setData({
        cats,
        svcs,
        selectedCatId: selCat ? selCat._id : '',
        selectedCatName: selCat ? selCat.name : '',
        filteredSvcs: selCat ? svcs.filter(s => s.category_id === selCat._id) : []
      })
    } finally {
      this.setData({ svcLoading: false })
    }
  },

  onSelectCat(e) {
    const id = e.currentTarget.dataset.id
    const cat = (this.data.cats || []).find(c => c._id === id)
    if (!cat) return
    this.setData({
      selectedCatId: id,
      selectedCatName: cat.name,
      filteredSvcs: this.data.svcs.filter(s => s.category_id === id)
    })
  },

  onEditSelectedCat() {
    const id = this.data.selectedCatId
    if (!id) return
    wx.navigateTo({ url: `${ROUTES.ADMIN_CATEGORY_EDIT}?id=${id}` })
  },

  async onToggleSvc(e) {
    const id = e.currentTarget.dataset.id
    const is_active = e.detail.value
    // 乐观更新 UI
    const svcs = this.data.svcs.map(s => s._id === id ? { ...s, is_active } : s)
    const filteredSvcs = svcs.filter(s => s.category_id === this.data.selectedCatId)
    this.setData({ svcs, filteredSvcs })
    try {
      await service.toggleActive({ serviceId: id, is_active })
    } catch (err) {
      // 失败则回滚
      const rollback = this.data.svcs.map(s => s._id === id ? { ...s, is_active: !is_active } : s)
      this.setData({
        svcs: rollback,
        filteredSvcs: rollback.filter(s => s.category_id === this.data.selectedCatId)
      })
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  onTapCategory(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `${ROUTES.ADMIN_CATEGORY_EDIT}?id=${id}` })
  },

  onTapService(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `${ROUTES.ADMIN_SERVICE_EDIT}?id=${id}` })
  },

  onSvcAddCategory() {
    wx.navigateTo({ url: ROUTES.ADMIN_CATEGORY_EDIT })
  },

  onSvcAddService() {
    const catId = this.data.selectedCatId
    const url = catId
      ? `${ROUTES.ADMIN_SERVICE_EDIT}?catId=${catId}`
      : ROUTES.ADMIN_SERVICE_EDIT
    wx.navigateTo({ url })
  },

  switchHMain(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.hMain) return
    this.setData({ hMain: v })
    this._loadHuntersBlock()
  },

  switchHApply(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.hApplyTab) return
    this.setData({ hApplyTab: v })
    this._loadHuntersApply()
  },

  _loadHuntersBlock() {
    if (this.data.hMain === 'manage') this._loadHuntersManage()
    else this._loadHuntersApply()
  },

  async _loadHuntersApply() {
    this.setData({ hLoading: true })
    try {
      const d = await auth.listApply()
      const tab = this.data.hApplyTab
      const list = (d || []).filter(u => {
        const s = (u.hunter_info && u.hunter_info.apply_status) || 'none'
        if (tab === 'rejected') return s === 'rejected' || s === 'dismissed'
        return s === tab
      })
      this.setData({
        hunters: list.map(u => ({
          ...u,
          statusLabel: H_LABEL[(u.hunter_info && u.hunter_info.apply_status) || 'none'] || (u.hunter_info && u.hunter_info.apply_status)
        }))
      })
    } finally {
      this.setData({ hLoading: false, hRefreshing: false })
    }
  },

  async _loadHuntersManage() {
    this.setData({ hLoading: true })
    try {
      const d = await auth.listActiveHunters()
      const list = (d || []).map(u => ({
        ...u,
        earnedYuan: fen2zb(u.earned_fen || 0),
        share_percent: u.share_percent != null ? u.share_percent : 70
      }))
      const kw = this.data.hKeyword.trim().toLowerCase()
      this.setData({
        activeHunters: list,
        filteredHunters: kw ? list.filter(u => (u.nickname || '').toLowerCase().includes(kw)) : list
      })
    } finally {
      this.setData({ hLoading: false, hRefreshing: false })
    }
  },

  onHKeyword(e) {
    const kw = (e.detail.value || '').trim().toLowerCase()
    this.setData({
      hKeyword: kw,
      filteredHunters: kw
        ? this.data.activeHunters.filter(u => (u.nickname || '').toLowerCase().includes(kw))
        : this.data.activeHunters
    })
  },

  onHClearKeyword() {
    this.setData({ hKeyword: '', filteredHunters: this.data.activeHunters })
  },

  onHRefresh() {
    this.setData({ hRefreshing: true })
    this._loadHuntersApply()
  },

  onHRefreshManage() {
    this.setData({ hRefreshing: true })
    this._loadHuntersManage()
  },

  async onHApprove(e) {
    try {
      await auth.reviewHunter({ userId: e.currentTarget.dataset.id, decision: 'approve' })
      wx.showToast({ title: '已通过', icon: 'success' })
      this._loadHuntersApply()
    } catch (_) {}
  },

  onHReject(e) {
    wx.showModal({
      title: '拒绝原因',
      editable: true,
      success: async r => {
        if (!r.confirm) return
        try {
          await auth.reviewHunter({ userId: e.currentTarget.dataset.id, decision: 'reject', reason: r.content || '' })
          wx.showToast({ title: '已拒绝', icon: 'none' })
          this._loadHuntersApply()
        } catch (_) {}
      }
    })
  },

  onHEditShare(e) {
    const id = e.currentTarget.dataset.id
    const cur = e.currentTarget.dataset.share
    wx.showModal({
      title: '分成比例 0～100',
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
          this._loadHuntersManage()
        } catch (_) {}
      }
    })
  },

  async onAssignCoHunter(e) {
    const id = e.currentTarget.dataset.id
    const hasCo = !!e.currentTarget.dataset.co
    const curSplit = Number(e.currentTarget.dataset.split) || 50
    this.setData({
      menuOpenId: '',
      showCoSheet: true,
      coSheetOrderId: id,
      coSheetHasCo: hasCo,
      coKeyword: '',
      coSelectedHunter: null,
      coSplitVal: curSplit,
      coAllHunters: [],
      coFilteredHunters: []
    })
    try {
      const list = await auth.listHuntersForPairing()
      this.setData({ coAllHunters: list || [], coFilteredHunters: list || [] })
    } catch (_) {}
  },

  closeCoSheet() {
    this.setData({ showCoSheet: false })
  },

  onCoKeywordInput(e) {
    const kw = (e.detail.value || '').trim().toLowerCase()
    this.setData({
      coKeyword: e.detail.value,
      coFilteredHunters: kw
        ? this.data.coAllHunters.filter(h =>
            (h.nickname || '').toLowerCase().includes(kw) ||
            (h.contact  || '').toLowerCase().includes(kw))
        : this.data.coAllHunters
    })
  },

  selectCoHunter(e) {
    this.setData({ coSelectedHunter: e.currentTarget.dataset.hunter })
  },

  onCoSplitInput(e) {
    const v = parseInt(e.detail.value, 10)
    this.setData({ coSplitVal: isNaN(v) ? 50 : Math.min(100, Math.max(0, v)) })
  },

  async confirmAssignCo() {
    const { coSheetOrderId, coSelectedHunter, coSplitVal } = this.data
    if (!coSelectedHunter) return
    try {
      await order.assignCoHunter({
        orderId: coSheetOrderId,
        coHunterOpenid: coSelectedHunter.openid,
        coSplit: coSplitVal
      })
      wx.showToast({ title: '已指定', icon: 'success' })
      this.setData({ showCoSheet: false })
      this._loadOrders()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async removeCoHunter() {
    const { coSheetOrderId } = this.data
    try {
      await order.assignCoHunter({ orderId: coSheetOrderId, coHunterOpenid: '', coSplit: 0 })
      wx.showToast({ title: '已移除协同陪玩', icon: 'success' })
      this.setData({ showCoSheet: false })
      this._loadOrders()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onTapContact(e) {
    const contact = e.currentTarget.dataset.contact
    if (!contact) return
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

  onHDismiss(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该陪玩师'
    wx.showModal({
      title: '移除陪玩师',
      content: `确定移除「${name}」？`,
      confirmColor: '#FF4D4F',
      success: async r => {
        if (!r.confirm) return
        try {
          await auth.dismissHunter({ userId: id })
          wx.showToast({ title: '已解雇', icon: 'none' })
          this._loadHuntersManage()
        } catch (_) {}
      }
    })
  },

  async _loadSettings() {
    try {
      const res = await config.get('cs_qr')
      this.setData({ csQrUrl: (res && res.value) || '' })
    } catch (_) {}
  },

  async onUploadCsQr() {
    if (this.data.csQrUploading) return
    try {
      const pick = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      const file = pick.tempFiles && pick.tempFiles[0]
      if (!file || !file.tempFilePath) return
      this.setData({ csQrUploading: true })
      wx.showLoading({ title: '上传中…' })
      const ext = (file.tempFilePath.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg'
      const cloudPath = `cs_qr/${Date.now()}.${ext}`
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath })
      await config.set('cs_qr', up.fileID)
      wx.hideLoading()
      this.setData({ csQrUrl: up.fileID })
      wx.showToast({ title: '二维码已更新', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      if (e.errMsg && e.errMsg.includes('cancel')) return
      wx.showToast({ title: e.message || '上传失败', icon: 'none' })
    } finally {
      this.setData({ csQrUploading: false })
    }
  },

  previewCsQr() {
    const url = this.data.csQrUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  async onToggleIosMarkup(e) {
    const enabled = e.detail.value
    try {
      await config.set('ios_markup_enabled', enabled)
      this.setData({ iosMarkupEnabled: enabled, adminNav: this._buildAdminNav(enabled) })
      wx.showToast({ title: enabled ? 'iOS +12% 已开启' : 'iOS +12% 已关闭', icon: 'success' })
    } catch (_) {
      this.setData({ iosMarkupEnabled: !enabled })
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  onProxyNicknameInput(e) {
    this.setData({ proxyNickname: e.detail.value })
  },

  async onProxySearch() {
    const kw = this.data.proxyNickname.trim()
    if (!kw) { wx.showToast({ title: '请输入昵称', icon: 'none' }); return }
    try {
      wx.showLoading({ title: '搜索中…' })
      const raw = await auth.searchUsersByNickname({ keyword: kw })
      const results = (raw || []).map(u => ({ ...u, balanceZb: fen2zb(u.balance_fen || 0) }))
      this.setData({ proxyResults: results, proxySelected: null, proxyAmount: '' })
      if (!results.length) wx.showToast({ title: '未找到用户', icon: 'none' })
    } catch (_) {} finally {
      wx.hideLoading()
    }
  },

  selectProxyUser(e) {
    this.setData({ proxySelected: e.currentTarget.dataset.user, proxyAmount: '' })
  },

  onProxyAmountInput(e) {
    this.setData({ proxyAmount: e.detail.value.replace(/[^\d]/g, '') })
  },

  async onProxyConfirm() {
    const { proxySelected, proxyAmount, proxying } = this.data
    if (!proxySelected) { wx.showToast({ title: '请先选择用户', icon: 'none' }); return }
    const amt = Number(proxyAmount)
    if (!amt || amt < 1) { wx.showToast({ title: '充值金额至少 1 总裁贝', icon: 'none' }); return }
    if (proxying) return
    wx.showModal({
      title: '确认代充',
      content: `为「${proxySelected.nickname}」充值 ${amt} 总裁贝？`,
      success: async r => {
        if (!r.confirm) return
        this.setData({ proxying: true })
        try {
          await wallet.adminCreditUser({ targetOpenid: proxySelected.openid, amount_zb: amt })
          wx.showToast({ title: '代充成功', icon: 'success' })
          this.setData({ proxyNickname: '', proxyResults: [], proxySelected: null, proxyAmount: '' })
        } catch (_) {} finally {
          this.setData({ proxying: false })
        }
      }
    })
  }
})
