const { service } = require('../../../utils/cloud')
const { ROUTES } = require('../../../utils/constants')

Page({
  data: {
    cats: [],
    loading: true,
    refreshing: false
  },

  onShow() {
    this._load()
  },

  onReady() {
    wx.setNavigationBarTitle({ title: '分类管理' })
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const list = await service.listCatsAdmin()
      this.setData({ cats: list || [] })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this._load()
  },

  goAdd() {
    wx.navigateTo({ url: ROUTES.ADMIN_CATEGORY_EDIT })
  },

  goEdit(e) {
    wx.navigateTo({ url: `${ROUTES.ADMIN_CATEGORY_EDIT}?id=${e.currentTarget.dataset.id}` })
  },

  onToggleActive(e) {
    const id = e.currentTarget.dataset.id
    const is_active = e.detail.value
    const cats = this.data.cats.map(c => c._id === id ? { ...c, is_active } : c)
    this.setData({ cats })
    service.upsertCat({ _id: id, is_active }).catch(() => {
      const rollback = this.data.cats.map(c => c._id === id ? { ...c, is_active: !is_active } : c)
      this.setData({ cats: rollback })
      wx.showToast({ title: '操作失败', icon: 'none' })
    })
  }
})
