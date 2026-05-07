const { service } = require('../../../utils/cloud')
const { fen2zb, ROUTES } = require('../../../utils/constants')

Page({
  data: {
    cats: [],
    svcs: [],
    filteredSvcs: [],
    selectedCatId: '',
    selectedCatName: '',
    loading: true,
    refreshing: false,
    dragging: '',   // 'cat' | 'svc' | ''
    dragIdx: -1,
    ghostY: 0,
    ghostItem: null
  },

  // ── drag state (non-reactive) ──
  _drag: null,
  _dragRects: [],

  onShow() { this._load() },

  async _load() {
    this.setData({ loading: true })
    try {
      const [catList, svcList] = await Promise.all([
        service.listCatsAdmin(),
        service.listSvcsAdmin()
      ])
      const cats = catList || []
      const svcs = (svcList || []).map(x => ({ ...x, priceZb: fen2zb(x.price) }))
      let selId = this.data.selectedCatId
      if (!selId && cats.length) selId = cats[0]._id
      const selCat = cats.find(c => c._id === selId)
      this.setData({
        cats,
        svcs,
        selectedCatId: selId,
        selectedCatName: selCat ? selCat.name : '',
        filteredSvcs: svcs.filter(s => s.category_id === selId)
      })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this._load()
  },

  switchCat(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.selectedCatId) return
    const cat = this.data.cats.find(c => c._id === id)
    this.setData({
      selectedCatId: id,
      selectedCatName: cat ? cat.name : '',
      filteredSvcs: this.data.svcs.filter(s => s.category_id === id)
    })
  },

  goAdd() {
    const cid = this.data.selectedCatId
    wx.navigateTo({ url: `${ROUTES.ADMIN_SERVICE_EDIT}${cid ? '?cid=' + cid : ''}` })
  },

  goEdit(e) {
    wx.navigateTo({ url: `${ROUTES.ADMIN_SERVICE_EDIT}?id=${e.currentTarget.dataset.id}` })
  },

  goAddCat() {
    wx.navigateTo({ url: ROUTES.ADMIN_CATEGORY_EDIT })
  },

  onToggleActive(e) {
    const id = e.currentTarget.dataset.id
    const is_active = e.detail.value
    const svcs = this.data.svcs.map(s => s._id === id ? { ...s, is_active } : s)
    this.setData({
      svcs,
      filteredSvcs: svcs.filter(s => s.category_id === this.data.selectedCatId)
    })
    service.toggleActive({ serviceId: id, is_active }).catch(() => {
      const rollback = this.data.svcs.map(s => s._id === id ? { ...s, is_active: !is_active } : s)
      this.setData({
        svcs: rollback,
        filteredSvcs: rollback.filter(s => s.category_id === this.data.selectedCatId)
      })
      wx.showToast({ title: '操作失败', icon: 'none' })
    })
  },

  // ══ Drag-to-reorder ══

  onDragStart(e) {
    const { side, index } = e.currentTarget.dataset
    const idx = Number(index)
    const list = side === 'cat' ? this.data.cats : this.data.filteredSvcs
    const ghostItem = list[idx] || null
    const touchY = e.touches[0].clientY
    this._drag = { side, fromIdx: idx, curIdx: idx, touchStartY: touchY }
    this.setData({ dragging: side, dragIdx: idx, ghostItem, ghostY: touchY - 30 })
    wx.vibrateShort({ type: 'medium' })
    this._queryRects(side)
  },

  onDragMove(e) {
    if (!this._drag) return
    const y = e.touches[0].clientY
    const rects = this._dragRects
    if (!rects || !rects.length) return

    // Update ghost position
    this.setData({ ghostY: y - 30 })

    let newIdx = this._drag.curIdx
    for (let i = 0; i < rects.length; i++) {
      if (y >= rects[i].top && y < rects[i].bottom) { newIdx = i; break }
    }
    // edge clamping
    if (y < rects[0].top) newIdx = 0
    if (y >= rects[rects.length - 1].bottom) newIdx = rects.length - 1

    if (newIdx === this._drag.curIdx) return

    const key = this._drag.side === 'cat' ? 'cats' : 'filteredSvcs'
    const list = [...this.data[key]]
    const [item] = list.splice(this._drag.curIdx, 1)
    list.splice(newIdx, 0, item)
    this._drag.curIdx = newIdx
    this.setData({ [key]: list, dragIdx: newIdx })
    this._queryRects(this._drag.side)
  },

  onDragEnd(e) {
    if (!this._drag) return
    const { side, fromIdx, curIdx } = this._drag
    this._drag = null
    this._dragRects = []
    this.setData({ dragging: '', dragIdx: -1, ghostItem: null, ghostY: 0 })

    if (fromIdx === curIdx) return

    if (side === 'cat') {
      this._saveCatOrder(this.data.cats)
    } else {
      this._saveSvcOrder(this.data.filteredSvcs)
    }
  },

  _queryRects(side) {
    const sel = side === 'cat' ? '.cat-item' : '.svc-item'
    wx.createSelectorQuery().selectAll(sel).boundingClientRect(rects => {
      this._dragRects = rects || []
    }).exec()
  },

  async _saveCatOrder(cats) {
    try {
      await service.updateCatOrder({ items: cats.map((c, i) => ({ _id: c._id, sort_order: i })) })
    } catch (e) {
      wx.showToast({ title: '排序保存失败', icon: 'none' })
    }
  },

  async _saveSvcOrder(svcs) {
    try {
      await service.updateSvcOrder({ items: svcs.map((s, i) => ({ _id: s._id, sort_order: i })) })
    } catch (e) {
      wx.showToast({ title: '排序保存失败', icon: 'none' })
    }
  }
})
