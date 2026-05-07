const { order, auth } = require('../../../utils/cloud')
const { fen2zb, fmtTime, STATUS_LABEL, ROUTES } = require('../../../utils/constants')
const { buildFormRows } = require('../../../utils/orderFormDisplay')
const { compressImageForUpload } = require('../../../utils/imageCompress')
const app = getApp()

Page({
  data: {
    order: null, logs: [],
    submitting: false, taking: false,
    // partner sheet
    showTakeSheet: false,
    allHunters: [], filteredHunters: [],
    keyword: '',
    selectedPartner: null,
    partnerSplit: 50
  },

  onLoad(opt) {
    this.oid = opt.oid
    this._load()
  },

  onShow() {
    if (this.oid) this._load()
  },

  async _load() {
    const [o, logsData] = await Promise.all([order.detail(this.oid), order.getLogs(this.oid)])
    if (!o) return
    const proofIds = (o.completion_proof && o.completion_proof.file_ids) || []
    const formRows = buildFormRows(o)
    const myOpenid = (app.globalData.userInfo || {}).openid || ''
    this.setData({
      order: {
        ...o,
        statusLabel: STATUS_LABEL[o.status] || o.status,
        totalYuan: fen2zb(o.total_amount),
        proofUrls: proofIds,
        formRows,
        earnYuan: o.hunter_earn_fen != null && o.hunter_earn_fen >= 0 ? fen2zb(o.hunter_earn_fen) : '',
        isMyOrder: String(o.hunter_openid || '').trim() === myOpenid,
        needsCoHunter: !!o.needs_co_hunter,
        hasCoHunter: !!String(o.preferred_co_hunter_openid || '').trim()
      },
      logs: (logsData || []).map(l => ({ ...l, timeStr: fmtTime(l.created_at), images: l.images || [] }))
    })
  },

  // ── 接单 ──

  async takeOrder() {
    const o = this.data.order
    if (!o) return
    await this._loadHunters()
    this.setData({ showTakeSheet: true, selectedPartner: null, keyword: '' })
  },

  async _loadHunters() {
    try {
      const list = await auth.listActiveHunters()
      const myOpenid = (app.globalData.userInfo || {}).openid || ''
      const hunters = (list || []).filter(h => h.openid !== myOpenid)
      this.setData({ allHunters: hunters, filteredHunters: hunters })
    } catch (_) {}
  },

  closeTakeSheet() { this.setData({ showTakeSheet: false }) },

  onKeywordInput(e) {
    const kw = (e.detail.value || '').trim().toLowerCase()
    this.setData({
      keyword: e.detail.value,
      filteredHunters: kw
        ? this.data.allHunters.filter(h =>
            (h.nickname || '').toLowerCase().includes(kw) ||
            (h.contact  || '').toLowerCase().includes(kw))
        : this.data.allHunters
    })
  },

  selectPartner(e) {
    const h = e.currentTarget.dataset.hunter
    this.setData({
      selectedPartner: (this.data.selectedPartner && this.data.selectedPartner.openid === h.openid) ? null : h
    })
  },

  onSplitInput(e) {
    let v = parseInt(e.detail.value) || 0
    if (v < 1)  v = 1
    if (v > 99) v = 99
    this.setData({ partnerSplit: v })
  },

  async confirmTake(e) {
    const withPartner = e.currentTarget.dataset.withpartner
    this.setData({ taking: true })
    try {
      const partner = withPartner ? this.data.selectedPartner : null
      await order.take({ orderId: this.oid, co_hunter_openid: (partner && partner.openid) || '', co_split: partner ? this.data.partnerSplit : 0 })
      if (partner) {
        await order.assignCoHunter({ orderId: this.oid, coHunterOpenid: partner.openid })
      }
      wx.showToast({ title: '接单成功！', icon: 'success' })
      this.setData({ showTakeSheet: false })
      await this._load()
    } catch (err) {
      wx.showToast({ title: err.message || '接单失败', icon: 'none' })
    } finally {
      this.setData({ taking: false })
    }
  },

  // ── 进行中：邀请搭档（双打单接单后还未有搭档时）──

  async onInviteCoHunter() {
    await this._loadHunters()
    this.setData({ showTakeSheet: true, selectedPartner: null, keyword: '' })
    this._inviteMode = true
  },

  async confirmInvite(e) {
    const partner = this.data.selectedPartner
    if (!partner) { wx.showToast({ title: '请选择搭档', icon: 'none' }); return }
    this.setData({ taking: true })
    try {
      await order.assignCoHunter({ orderId: this.oid, coHunterOpenid: partner.openid })
      wx.showToast({ title: `已邀请 ${partner.nickname}`, icon: 'success' })
      this.setData({ showTakeSheet: false })
      this._inviteMode = false
      await this._load()
    } catch (err) {
      wx.showToast({ title: err.message || '邀请失败', icon: 'none' })
    } finally {
      this.setData({ taking: false })
    }
  },

  // ── 其他 ──


  goUpdate() { wx.navigateTo({ url: `${ROUTES.HUNTER_UPDATE}?oid=${this.oid}` }) },

  previewProof(e) {
    const urls = e.currentTarget.dataset.urls
    const i = Number(e.currentTarget.dataset.i) || 0
    if (!urls || !urls.length) return
    wx.previewImage({ urls, current: urls[i] })
  },

  async onSubmitSettlement() {
    if (this.data.submitting) return
    try {
      let pick
      try {
        pick = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      } catch (e) {
        const msg = (e && e.errMsg) || ''
        if (msg.includes('cancel') || msg.includes('取消')) return
        pick = await wx.chooseMedia({ count: 1, mediaType: ['image'] })
      }
      const file = pick.tempFiles && pick.tempFiles[0]
      if (!file || !file.tempFilePath) return
      this.setData({ submitting: true })
      wx.showLoading({ title: '压缩并上传…' })
      const compressed = await compressImageForUpload(file.tempFilePath)
      const ext = (compressed.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg'
      const cloudPath = `settlement/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
      wx.hideLoading()
      await order.submitSettlement({ orderId: this.oid, fileIds: [up.fileID] })
      wx.showToast({ title: '已提交，请等待审核', icon: 'success' })
      await this._load()
    } catch (err) {
      wx.hideLoading()
      if (err.errMsg && err.errMsg.includes('cancel')) return
      console.error(err)
    } finally {
      this.setData({ submitting: false })
    }
  }
})
