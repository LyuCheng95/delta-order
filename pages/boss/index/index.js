const { service, order, config } = require('../../../utils/cloud')
const { fen2zb, fmtTime, ROUTES } = require('../../../utils/constants')
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
      const results = await Promise.all([
        service.listAllForBoss(),
        order.list({ type: 'boss', status: 'in_progress' }),
        config.get('cs_qr').catch(() => null)
      ])
      const svcData   = results[0] || {}
      const ordersRes = results[1]
      const cfgRes    = results[2]

      const catList = svcData.cats || []
      const svcList = svcData.svcs || []

      const svcByCat = {}
      svcList.forEach(function(s) { (svcByCat[s.category_id] = svcByCat[s.category_id] || []).push(s) })

      const groups = catList.map(function(cat) {
        return {
          catId:    cat._id,
          catName:  cat.name,
          icon:     cat.icon,
          services: (svcByCat[cat._id] || []).map(function(s) {
            return Object.assign({}, s, { priceYuan: fen2zb(s.price) })
          })
        }
      }).filter(function(g) { return g.services.length > 0 })

      const active = ((ordersRes && ordersRes.list) || []).slice(0, 5).map(function(o) {
        return Object.assign({}, o, { totalYuan: fen2zb(o.total_amount), timeStr: fmtTime(o.created_at) })
      })

      let csQrUrl = (cfgRes && cfgRes.value) || ''
      if (csQrUrl && csQrUrl.startsWith('cloud://')) {
        try {
          const tmpRes = await wx.cloud.getTempFileURL({ fileList: [csQrUrl] })
          csQrUrl = (tmpRes.fileList[0] && tmpRes.fileList[0].tempFileURL) || csQrUrl
        } catch (_) {}
      }
      this.setData({ groups: groups, activeOrders: active, activeCatIndex: -1, scrollInto: '', csQrUrl: csQrUrl })
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
