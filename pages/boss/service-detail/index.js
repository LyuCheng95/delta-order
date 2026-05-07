const { service, order, wallet } = require('../../../utils/cloud')
const { fen2zb, ROUTES, STORAGE_BOSS_ORDERS_TAB } = require('../../../utils/constants')
const app = getApp()

Page({
  data: {
    svc: null, formData: {}, formSelects: {}, remark: '', totalZb: '0', submitting: false, rulesOpen: false,
    designatedHunter: null,
    designatedTimeSlot: ''
  },

  onLoad(opt) {
    this._load(opt.sid)
  },

  onShow() {
    const dh = app.globalData.designatedHunter  || null
    const ts = app.globalData.designatedTimeSlot || ''
    this.setData({ designatedHunter: dh, designatedTimeSlot: ts })
  },

  async _load(sid) {
    const data = await service.detail(sid)
    if (!data) return
    const fields = (data.form_fields || []).map(f =>
      f.key === 'game_id' ? { ...f, label: '游戏ID / 房间号' } : f
    )
    const fd = {}, fs = {}
    fields.forEach(f => { fd[f.key] = ''; if (f.type === 'select') fs[f.key] = '' })
    this.setData({ svc: { ...data, form_fields: fields, priceZb: fen2zb(data.price) }, formData: fd, formSelects: fs })
    this._calcTotal()
  },

  _calcTotal() {
    const svc = this.data.svc
    if (!svc) return
    let basePrice = svc.price
    let hours = 1
    const hoursVal = this.data.formSelects['hours']
    if (hoursVal) {
      const m = hoursVal.match(/^(\d+)/)
      if (m) hours = parseInt(m[1])
    }
    let addon = 0
    const genderVal = this.data.formSelects['gender']
    if (genderVal && svc.price_modifiers && svc.price_modifiers.gender) {
      addon = svc.price_modifiers.gender[genderVal] || 0
    }
    const total = (basePrice + addon) * hours
    this.setData({ totalZb: fen2zb(total) })
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    const fd = { ...this.data.formData, [key]: e.detail.value }
    this.setData({ formData: fd })
  },

  onSelect(e) {
    const { field, val } = e.currentTarget.dataset
    this.setData({ [`formSelects.${field}`]: val }, () => this._calcTotal())
  },

  onRemark(e) { this.setData({ remark: e.detail.value }) },
  toggleRules() { this.setData({ rulesOpen: !this.data.rulesOpen }) },

  clearHunter() {
    app.globalData.designatedHunter  = null
    app.globalData.designatedTimeSlot = ''
    this.setData({ designatedHunter: null, designatedTimeSlot: '' })
  },

  async submit() {
    const fields = (this.data.svc && this.data.svc.form_fields) || []
    for (const f of fields) {
      const v = f.type === 'select' ? this.data.formSelects[f.key] : this.data.formData[f.key]
      if (f.required && !v) { wx.showToast({ title: `请填写${f.label}`, icon: 'none' }); return }
    }
    this.setData({ submitting: true })
    try {
      const formData = { ...this.data.formData, ...this.data.formSelects }

      let useWxpay = false
      try {
        const w = await wallet.getBossWallet()
        const balance = Number(w.balance_fen) || 0
        useWxpay = balance < this.data.svc.price
      } catch (_) {}

      const dh = this.data.designatedHunter

      const res = await order.create({
        service_id: this.data.svc._id,
        quantity: 1,
        form_data: formData,
        remark: this.data.remark,
        payment_method: useWxpay ? 'wxpay' : 'balance',
        preferred_hunter_openid: dh ? dh.openid : '',
        preferred_time:          this.data.designatedTimeSlot || ''
      })

      app.globalData.designatedHunter   = null
      app.globalData.designatedTimeSlot = ''

      if (useWxpay) {
        wx.navigateTo({ url: `${ROUTES.BOSS_PAYMENT}?oid=${res._id}` })
      } else {
        wx.showToast({ title: '下单成功', icon: 'success' })
        wx.setStorageSync(STORAGE_BOSS_ORDERS_TAB, 'paid')
        setTimeout(() => wx.navigateBack(), 1500)
      }
    } finally {
      this.setData({ submitting: false })
    }
  }
})
