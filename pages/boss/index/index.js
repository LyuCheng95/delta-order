const { service, order, config } = require('../../../utils/cloud')
const { fen2yuan, fmtTime, ROUTES } = require('../../../utils/constants')
const app = getApp()

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    groups: [],
    activeOrders: [],
    loading: true,
    statusH: 0,
    scrollInto: '',
    activeCatIndex: -1,
    csQrUrl: ''
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    this.setData({ statusH: info.statusBarHeight })
    const u = app.globalData.userInfo
    if (u) this.setData({ nickname: u.nickname || '玩家', avatarUrl: u.avatar_url || '' })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this._load()
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const [cats, ordersRes, cfgRes] = await Promise.all([
        service.listCats(),
        order.list({ type: 'boss', status: 'in_progress' }),
        config.get('cs_qr').catch(() => null)
      ])

      const catList = cats || []
      const svcRequests = catList.map(c => service.listByCat(c._id))
      const svcResults  = await Promise.all(svcRequests)

      const groups = catList.map((cat, i) => ({
        catId:    cat._id,
        catName:  cat.name,
        icon:     cat.icon,
        services: (svcResults[i] || []).map(s => ({
          ...s,
          priceYuan: fen2yuan(s.price)
        }))
      })).filter(g => g.services.length > 0)

      const active = (ordersRes.list || []).slice(0, 5).map(o => ({
        ...o, totalYuan: fen2yuan(o.total_amount), timeStr: fmtTime(o.created_at)
      }))

      let csQrUrl = (cfgRes && cfgRes.value) || ''
      if (csQrUrl && csQrUrl.startsWith('cloud://')) {
        try {
          const { fileList } = await wx.cloud.getTempFileURL({ fileList: [csQrUrl] })
          csQrUrl = fileList[0]?.tempFileURL || csQrUrl
        } catch (_) {}
      }
      this.setData({ groups, activeOrders: active, activeCatIndex: -1, scrollInto: '', csQrUrl })
    } finally {
      this.setData({ loading: false })
    }
  },

  goSvcDetail(e) {
    const sid = e.currentTarget.dataset.id
    if (!sid) return
    wx.navigateTo({ url: `${ROUTES.BOSS_SVC_DETAIL}?sid=${sid}` })
  },

  goOrderDetail(e) {
    const oid = e.currentTarget.dataset.id
    if (!oid) return
    wx.navigateTo({ url: `${ROUTES.BOSS_ORDER_DETAIL}?oid=${oid}` })
  },

  onCatIndexTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (Number.isNaN(index) || index < 0) return
    const into = `cat-sec-${index}`
    this.setData({ scrollInto: '' })
    setTimeout(() => {
      this.setData({ scrollInto: into, activeCatIndex: index })
      setTimeout(() => this.setData({ scrollInto: '' }), 450)
    }, 50)
  },

  goOrders()  { wx.switchTab({ url: ROUTES.BOSS_ORDERS }) },
  goProfile() { wx.switchTab({ url: ROUTES.BOSS_PROFILE }) },

  previewCsQr() {
    const url = this.data.csQrUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  }
})
