const { service } = require('../../../utils/cloud')
const { fen2yuan } = require('../../../utils/constants')

const FIELD_TYPES = ['单行文本', '数字', '下拉选择']
const FIELD_TYPE_KEYS = ['text', 'number', 'select']

function fieldsToUI(form_fields) {
  return (form_fields || []).map((f, i) => {
    const typeIndex = FIELD_TYPE_KEYS.indexOf(f.type)
    return {
      uid: i + '_' + Date.now(),
      key: f.key || ('field_' + i),
      label: f.label || '',
      typeIndex: typeIndex >= 0 ? typeIndex : 0,
      required: f.required !== false,
      optionsText: (f.options || []).join('\n')
    }
  })
}

function uiToFields(formFields) {
  return formFields.map((f, i) => ({
    key: f.key || ('field_' + i),
    label: f.label || '',
    type: FIELD_TYPE_KEYS[f.typeIndex] || 'text',
    required: !!f.required,
    options: f.typeIndex === 2
      ? f.optionsText.split('\n').map(s => s.trim()).filter(Boolean)
      : []
  }))
}

function labelToKey(label) {
  const map = {
    '游戏': 'game_id', 'id': 'game_id', 'ID': 'game_id',
    '段位': 'rank', '英雄': 'hero', '备注': 'remark',
    '小时': 'hours', '时长': 'hours', '性别': 'gender', '模式': 'mode'
  }
  for (const k of Object.keys(map)) {
    if (label.includes(k)) return map[k]
  }
  return 'field_' + Date.now().toString().slice(-4)
}

Page({
  data: {
    id: '',
    catIds: [],
    catLabels: [],
    catIndex: 0,
    name: '',
    description: '',
    priceYuan: '',
    price_unit: '次',

    is_active: true,
    needs_co_hunter: true,
    fieldTypes: FIELD_TYPES,
    formFields: [],
    saving: false
  },

  onLoad(opt) {
    const id = opt.id || ''
    this.preselectCategoryId = opt.cid || ''
    this.setData({ id })
    wx.setNavigationBarTitle({ title: id ? '编辑服务' : '新增服务' })
    this._init()
  },

  async _init() {
    try {
      await this._loadCats()
      if (this.data.id) await this._loadSvc()
      else {
        this.setData({
          formFields: fieldsToUI([
            { key: 'game_id', label: '游戏ID / 房间号', type: 'text', required: true, options: [] }
          ])
        })
      }
    } catch (_) {}
  },

  async _loadCats() {
    const cats = await service.listCatsAdmin()
    const catIds = (cats || []).map(c => c._id)
    const catLabels = (cats || []).map(c => `${c.icon ? c.icon + ' ' : ''}${c.name || ''}`.trim())
    let catIndex = 0
    if (this.preselectCategoryId) {
      const i = catIds.indexOf(this.preselectCategoryId)
      if (i >= 0) catIndex = i
    }
    this.setData({ catIds, catLabels, catIndex })
  },

  async _loadSvc() {
    const data = await service.detail(this.data.id)
    if (!data) { wx.showToast({ title: '服务不存在', icon: 'none' }); return }
    let catIndex = this.data.catIds.indexOf(data.category_id)
    if (catIndex < 0) catIndex = 0
    this.setData({
      catIndex,
      name: data.name || '',
      description: data.description || '',
      priceYuan: fen2yuan(data.price || 0),
      price_unit: data.price_unit || '次',

      is_active: data.is_active !== false,
      needs_co_hunter: data.needs_co_hunter !== false,
      formFields: fieldsToUI(data.form_fields || [])
    })
  },

  onPickCat(e)      { this.setData({ catIndex: parseInt(e.detail.value, 10) || 0 }) },
  onName(e)         { this.setData({ name: e.detail.value }) },
  onDesc(e)         { this.setData({ description: e.detail.value }) },
  onPrice(e)        { this.setData({ priceYuan: e.detail.value }) },
  onUnit(e)         { this.setData({ price_unit: e.detail.value }) },
  onActiveChange(e)    { this.setData({ is_active: e.detail.value }) },
  onCoHunterChange(e)  { this.setData({ needs_co_hunter: e.detail.value }) },

  // ── 表单字段编辑 ──
  addField() {
    const fields = [...this.data.formFields, {
      uid: Date.now() + '',
      key: 'field_' + Date.now().toString().slice(-4),
      label: '',
      typeIndex: 0,
      required: true,
      optionsText: ''
    }]
    this.setData({ formFields: fields })
  },

  removeField(e) {
    const idx = e.currentTarget.dataset.index
    const fields = this.data.formFields.filter((_, i) => i !== idx)
    this.setData({ formFields: fields })
  },

  onFieldLabel(e) {
    const idx = e.currentTarget.dataset.index
    const label = e.detail.value
    const key = labelToKey(label)
    this.setData({
      [`formFields[${idx}].label`]: label,
      [`formFields[${idx}].key`]: key
    })
  },

  onFieldType(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ [`formFields[${idx}].typeIndex`]: parseInt(e.detail.value, 10) })
  },

  onFieldRequired(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ [`formFields[${idx}].required`]: e.detail.value })
  },

  onFieldOptions(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ [`formFields[${idx}].optionsText`]: e.detail.value })
  },

  async onSave() {
    const { id, catIds, catIndex, name, description, priceYuan, price_unit, is_active, needs_co_hunter, formFields } = this.data
    if (!catIds.length) { wx.showToast({ title: '请先新增分类', icon: 'none' }); return }
    if (!name.trim())   { wx.showToast({ title: '请填写服务名称', icon: 'none' }); return }
    const y = parseFloat(priceYuan)
    if (Number.isNaN(y) || y < 0) { wx.showToast({ title: '价格无效', icon: 'none' }); return }
    for (const f of formFields) {
      if (!f.label.trim()) { wx.showToast({ title: '字段名称不能为空', icon: 'none' }); return }
      if (f.typeIndex === 2 && !f.optionsText.trim()) {
        wx.showToast({ title: `「${f.label}」请填写选项`, icon: 'none' }); return
      }
    }
    this.setData({ saving: true })
    try {
      const payload = {
        category_id: catIds[catIndex],
        name: name.trim(),
        description: description || '',
        price: Math.round(y * 100),
        price_unit: price_unit || '次',
        is_active,
        needs_co_hunter,
        form_fields: uiToFields(formFields)
      }
      if (id) payload._id = id
      await service.upsertSvc(payload)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除服务', content: '确定删除该服务？已关联订单不受影响。', confirmColor: '#FF4D4F',
      success: async r => {
        if (!r.confirm) return
        try {
          await service.deleteSvc(this.data.id)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 450)
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
