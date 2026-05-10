const { auth } = require('../../../utils/cloud')
const { ROUTES } = require('../../../utils/constants')
const app = getApp()

Page({
  data: {
    hunters: [],
    loading: true,
    keyword: '',
    filteredHunters: [],
    selectMode: false,
    excludeOpenid: ''
  },

  async onLoad() {
    await this._loadHunters()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, showHunterTab: true })
    }
    // check if returning here to pick a co-hunter
    const selectMode    = !!app.globalData.hunterSelectMode
    const excludeOpenid = app.globalData.hunterSelectExclude || ''
    this.setData({ selectMode, excludeOpenid })
    if (selectMode) this._refilterExclude(excludeOpenid)
  },

  _refilterExclude(exclude) {
    const list = exclude
      ? this.data.hunters.filter(h => h.openid !== exclude)
      : this.data.hunters
    this.setData({ filteredHunters: list, keyword: '' })
  },

  async _loadHunters() {
    this.setData({ loading: true })
    try {
      const list = await auth.listHuntersForBoss() || []
      this.setData({ hunters: list, filteredHunters: list })
    } finally {
      this.setData({ loading: false })
    }
  },

  onKeyword(e) {
    const kw = (e.detail.value || '').trim().toLowerCase()
    this.setData({
      keyword: e.detail.value,
      filteredHunters: kw
        ? this.data.hunters.filter(h =>
            (h.nickname || '').toLowerCase().includes(kw) ||
            (h.bio || '').toLowerCase().includes(kw) ||
            (h.play_style || '').toLowerCase().includes(kw))
        : this.data.hunters
    })
  },

  goHunterProfile(e) {
    const openid = e.currentTarget.dataset.openid
    const nickname = e.currentTarget.dataset.nickname
    if (!openid) return
    if (this.data.selectMode) {
      app.globalData.designatedCoHunter = { openid, nickname }
      app.globalData.hunterSelectMode = false
      app.globalData.hunterSelectExclude = ''
      this.setData({ selectMode: false, excludeOpenid: '', filteredHunters: this.data.hunters })
      wx.navigateTo({ url: ROUTES.BOSS_SVC_LIST })
      return
    }
    wx.navigateTo({ url: `${ROUTES.BOSS_HUNTER_PROFILE}?openid=${openid}` })
  }
})
