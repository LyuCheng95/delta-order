const { service } = require('../../../utils/cloud')

Page({
  data: {
    id: '',
    name: '',
    icon: '🎮',

    is_active: true,
    saving: false
  },

  onLoad(opt) {
    const id = opt.id || ''
    this.setData({ id })
    wx.setNavigationBarTitle({ title: id ? '编辑分类' : '新增分类' })
    if (id) this._load()
  },

  async _load() {
    try {
      const cats = await service.listCatsAdmin()
      const c = (cats || []).find(x => x._id === this.data.id)
      if (!c) {
        wx.showToast({ title: '分类不存在', icon: 'none' })
        return
      }
      this.setData({
        name: c.name || '',
        icon: c.icon || '🎮',

        is_active: c.is_active !== false
      })
    } catch (_) {}
  },

  onName(e) {
    this.setData({ name: e.detail.value })
  },

  onIcon(e) {
    this.setData({ icon: e.detail.value })
  },

  onActiveChange(e) {
    this.setData({ is_active: e.detail.value })
  },

  async onSave() {
    const { id, name, icon, is_active } = this.data
    if (!name.trim()) {
      wx.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const payload = {
        name: name.trim(),
        icon: icon || '🎮',

        is_active
      }
      if (id) payload._id = id
      await service.upsertCat(payload)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } catch (_) {}
    finally {
      this.setData({ saving: false })
    }
  },

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除分类',
      content: '须先清空该分类下所有服务。确定删除？',
      confirmColor: '#FF4D4F',
      success: async r => {
        if (!r.confirm) return
        try {
          await service.deleteCat(this.data.id)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 450)
        } catch (_) {}
      }
    })
  }
})
