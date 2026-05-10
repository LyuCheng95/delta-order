const { service } = require('../../../utils/cloud')
const { fen2zb, ROUTES } = require('../../../utils/constants')
const app = getApp()

Page({
  data: {
    cats: [],
    allSvcs: {},
    displaySvcs: [],
    selectedCat: '',
    loading: true,
    hunterName: ''
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '选择服务' })
    this._load()
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const allowedTags = app.globalData.designatedHunterServiceTags || []
      const dh = app.globalData.designatedHunter
      if (dh) this.setData({ hunterName: dh.nickname || '' })

      const { cats, svcs } = await service.listAllForBoss()
      const allSvcs = {}
      cats.forEach(c => { allSvcs[c._id] = [] })
      svcs.forEach(s => {
        if (!allSvcs[s.category_id]) return
        if (allowedTags.length > 0 && !allowedTags.includes(s._id)) return
        allSvcs[s.category_id].push({ ...s, priceYuan: fen2zb(s.price) })
      })
      this.setData({ cats, allSvcs })
      this._filterByCat('')
    } finally {
      this.setData({ loading: false })
    }
  },

  selectCat(e) {
    const cid = e.currentTarget.dataset.cid
    this.setData({ selectedCat: cid })
    this._filterByCat(cid)
  },

  _filterByCat(cid) {
    const { cats, allSvcs } = this.data
    if (!cid) {
      // 全部：按分类分组展示
      const sections = cats
        .map(c => ({ catId: c._id, catName: c.name, svcs: allSvcs[c._id] || [] }))
        .filter(s => s.svcs.length > 0)
      this.setData({ displaySvcs: sections, selectedCat: '' })
    } else {
      const svcs = allSvcs[cid] || []
      const cat = cats.find(c => c._id === cid)
      this.setData({
        displaySvcs: [{ catId: cid, catName: (cat && cat.name) || '', svcs }],
        selectedCat: cid
      })
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: `${ROUTES.BOSS_SVC_DETAIL}?sid=${e.currentTarget.dataset.id}` })
  }
})
