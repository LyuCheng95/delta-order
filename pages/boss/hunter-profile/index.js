const { auth, service } = require('../../../utils/cloud')
const { ROUTES } = require('../../../utils/constants')
const app = getApp()

// 今天/明天/后天
function buildDateOptions() {
  const days = ['今天', '明天', '后天']
  const now = new Date()
  return days.map((label, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    return { label, value: label }
  })
}

const TIME_SLOTS = [
  { label: '上午  10:00–12:00', value: '上午(10:00-12:00)' },
  { label: '下午  14:00–16:00', value: '下午(14:00-16:00)' },
  { label: '傍晚  17:00–19:00', value: '傍晚(17:00-19:00)' },
  { label: '晚上  19:00–21:00', value: '晚上(19:00-21:00)' },
  { label: '深夜  21:00–23:00', value: '深夜(21:00-23:00)' },
  { label: '随时有空',           value: '随时有空' }
]

Page({
  data: {
    hunter: null,
    loading: true,
    svcMap: {},
    serviceNames: [],

    // time picker sheet
    showPicker: false,
    dateOptions: buildDateOptions(),
    timeSlots: TIME_SLOTS,
    selectedDate: '',
    selectedTime: ''
  },

  async onLoad(options) {
    const openid = options.openid
    if (!openid) { wx.navigateBack(); return }
    this._openid = openid
    await Promise.all([this._loadHunter(openid), this._loadSvcMap()])
  },

  async _loadHunter(openid) {
    this.setData({ loading: true })
    try {
      await auth.recordHunterView({ hunterOpenid: openid }).catch(() => {})
      const h = await auth.getHunterPublic({ hunterOpenid: openid })
      this.setData({ hunter: h })
    } finally {
      this.setData({ loading: false })
      this._buildServiceNames()
    }
  },

  async _loadSvcMap() {
    try {
      const cats = await service.listCats()
      const results = await Promise.all((cats || []).map(c => service.listByCat(c._id)))
      const map = {}
      results.forEach(svcs => (svcs || []).forEach(s => { map[s._id] = s.name }))
      this.setData({ svcMap: map })
    } catch (_) {}
    this._buildServiceNames()
  },

  _buildServiceNames() {
    const h = this.data.hunter
    const map = this.data.svcMap
    if (!h || !Object.keys(map).length) return
    const names = (h.service_tags || []).map(id => map[id]).filter(Boolean)
    this.setData({ serviceNames: names })
  },

  previewPortfolio(e) {
    const index = e.currentTarget.dataset.index
    const urls = (this.data.hunter && this.data.hunter.portfolio) || []
    if (!urls.length) return
    wx.previewImage({ urls, current: urls[index] || urls[0] })
  },

  // ── time picker ──

  openPicker() {
    this.setData({ showPicker: true, selectedDate: '', selectedTime: '' })
  },

  closePicker() {
    this.setData({ showPicker: false })
  },

  selectDate(e) { this.setData({ selectedDate: e.currentTarget.dataset.val }) },
  selectTime(e) { this.setData({ selectedTime: e.currentTarget.dataset.val }) },

  confirmPicker() {
    const { selectedDate, selectedTime } = this.data
    if (!selectedDate || !selectedTime) {
      wx.showToast({ title: '请选择日期和时间段', icon: 'none' })
      return
    }
    this.setData({ showPicker: false })
    const h = this.data.hunter
    app.globalData.designatedHunter          = { openid: h.openid, nickname: h.nickname }
    app.globalData.designatedHunterServiceTags = h.service_tags || []
    app.globalData.designatedTimeSlot        = `${selectedDate} ${selectedTime}`
    wx.navigateTo({ url: ROUTES.BOSS_SVC_LIST })
  }
})
