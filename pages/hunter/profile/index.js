const { auth, service } = require('../../../utils/cloud')
const { ROUTES } = require('../../../utils/constants')
const { hasRole } = require('../../../utils/roles')
const { compressImageForUpload } = require('../../../utils/imageCompress')
const app = getApp()

Page({
  data: {
    nickname: '',
    nicknameInput: '',
    editingNick: false,
    savingNick: false,
    avatarUrl: '',
    uploadingAvatar: false,

    completedCount: 0,
    sharePercent: 70,

    bio: '',
    playStyle: '',
    serviceTags: [],
    portfolio: [],
    isVisible: true,

    contact: '',
    bankCard: '',
    bankCardInput: '',
    editingCard: false,
    savingCard: false,

    allGroups: [],
    catsExpanded: {},

    saving: false,
    uploadingPortfolio: false,

    bioLen: 0,
    playStyleLen: 0,

    // completeness
    checks: { avatar: false, nickname: false, bio: false, services: false },
    profileReady: false
  },

  async onLoad() {
    await this._loadProfile()
    await this._loadServices()
  },

  async _loadProfile() {
    // Always pull fresh data so stale cache (e.g. role not updated after approval) doesn't block saves
    try {
      const fresh = await auth.refreshProfile()
      if (fresh) {
        app.globalData.userInfo = { ...(app.globalData.userInfo || {}), ...fresh }
      }
    } catch (_) {}

    const u = app.globalData.userInfo || {}
    const hi = u.hunter_info || {}
    const bio = hi.bio || ''
    const playStyle = hi.play_style || ''
    const portfolio = hi.portfolio || []
    const serviceTags = hi.service_tags || []
    const nickname = u.nickname || ''
    const avatarUrl = u.avatar_url || ''

    this.setData({
      nickname,
      nicknameInput: nickname,
      avatarUrl,
      completedCount: u.completed_count || 0,
      sharePercent: u.share_percent != null ? u.share_percent : 70,
      bio, playStyle, portfolio, serviceTags,
      isVisible: hi.is_visible !== false,
      contact: u.contact || '',
      bankCard: hi.bank_card ? ('**** **** **** ' + String(hi.bank_card).slice(-4)) : '未填写',
      bankCardInput: hi.bank_card || '',
      bioLen: bio.length,
      playStyleLen: playStyle.length
    })
    this._updateChecks()
  },

  _updateChecks() {
    const { avatarUrl, nickname, bio, serviceTags } = this.data
    const checks = {
      avatar:   !!avatarUrl,
      nickname: !!(nickname && nickname !== '陪玩师' && nickname.trim()),
      bio:      !!(bio && bio.trim()),
      services: serviceTags.length > 0
    }
    const profileReady = Object.values(checks).every(Boolean)
    this.setData({ checks, profileReady })
  },

  async _loadServices() {
    try {
      const [cats, svcsRaw] = await Promise.all([
        service.listCats(),
        service.listAllForHunter().catch(() => [])
      ])
      const selected = new Set(this.data.serviceTags)
      const allGroups = (cats || []).map(cat => {
        const services = (svcsRaw || [])
          .filter(s => s.category_id === cat._id && s.is_active !== false)
          .map(s => ({ _id: s._id, name: s.name, selected: selected.has(s._id) }))
        return {
          catId: cat._id, catName: cat.name, icon: cat.icon,
          services,
          selectedCount: services.filter(s => s.selected).length
        }
      }).filter(g => g.services.length > 0)

      const catsExpanded = {}
      allGroups.forEach(g => { catsExpanded[g.catId] = false })
      this.setData({ allGroups, catsExpanded })
    } catch (_) {}
  },

  // ── avatar ──

  async onChangeAvatar() {
    if (this.data.uploadingAvatar) return
    try {
      const pick = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      const file = pick.tempFiles && pick.tempFiles[0]
      if (!file) return
      this.setData({ uploadingAvatar: true })
      wx.showLoading({ title: '上传头像…' })
      const compressed = await compressImageForUpload(file.tempFilePath)
      const ext = (compressed.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg'
      const cloudPath = `avatars/${Date.now()}.${ext}`
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
      await auth.updateAvatar({ avatar_url: up.fileID })
      if (app.globalData.userInfo) app.globalData.userInfo.avatar_url = up.fileID
      this.setData({ avatarUrl: up.fileID })
      this._updateChecks()
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (e) {
      if (!e || !e.errMsg || !e.errMsg.includes('cancel')) wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ uploadingAvatar: false })
    }
  },

  // ── nickname ──

  toggleEditNick() { this.setData({ editingNick: !this.data.editingNick }) },
  onNicknameInput(e) { this.setData({ nicknameInput: e.detail.value }) },

  async saveNickname() {
    const nickname = this.data.nicknameInput.trim()
    if (!nickname) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    this.setData({ savingNick: true })
    try {
      await auth.updateNickname({ nickname })
      if (app.globalData.userInfo) app.globalData.userInfo.nickname = nickname
      this.setData({ nickname, editingNick: false })
      this._updateChecks()
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } finally {
      this.setData({ savingNick: false })
    }
  },

  // ── bio / style ──

  onVisibleChange(e) {
    this.setData({ isVisible: e.detail.value })
  },

  onBioInput(e) {
    const v = e.detail.value
    this.setData({ bio: v, bioLen: v.length })
    this._updateChecks()
  },

  onPlayStyleInput(e) {
    const v = e.detail.value
    this.setData({ playStyle: v, playStyleLen: v.length })
  },

  // ── service picker ──

  toggleCat(e) {
    const catId = e.currentTarget.dataset.catid
    const expanded = { ...this.data.catsExpanded }
    expanded[catId] = !expanded[catId]
    this.setData({ catsExpanded: expanded })
  },

  toggleService(e) {
    const svcId = e.currentTarget.dataset.svcid
    const allGroups = this.data.allGroups.map(g => {
      const services = g.services.map(s => s._id === svcId ? { ...s, selected: !s.selected } : s)
      return { ...g, services, selectedCount: services.filter(s => s.selected).length }
    })
    const serviceTags = []
    allGroups.forEach(g => g.services.forEach(s => { if (s.selected) serviceTags.push(s._id) }))
    this.setData({ allGroups, serviceTags })
    this._updateChecks()
  },

  // ── portfolio ──

  async onAddPortfolio() {
    if (this.data.portfolio.length >= 9) { wx.showToast({ title: '最多上传9张', icon: 'none' }); return }
    if (this.data.uploadingPortfolio) return
    try {
      const pick = await wx.chooseMedia({
        count: 9 - this.data.portfolio.length, mediaType: ['image'], sizeType: ['compressed']
      })
      const files = (pick.tempFiles || []).slice(0, 9 - this.data.portfolio.length)
      if (!files.length) return
      this.setData({ uploadingPortfolio: true })
      wx.showLoading({ title: '上传中…' })
      const fileIds = []
      for (const file of files) {
        const compressed = await compressImageForUpload(file.tempFilePath)
        const ext = (compressed.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg'
        const cloudPath = `portfolio/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const up = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
        fileIds.push(up.fileID)
      }
      wx.hideLoading()
      this.setData({ portfolio: [...this.data.portfolio, ...fileIds] })
    } catch (e) {
      wx.hideLoading()
      if (!e || !e.errMsg || !e.errMsg.includes('cancel')) wx.showToast({ title: (e && e.message) || '上传失败', icon: 'none' })
    } finally {
      this.setData({ uploadingPortfolio: false })
    }
  },

  previewPortfolio(e) {
    const i = e.currentTarget.dataset.i
    wx.previewImage({ urls: this.data.portfolio, current: this.data.portfolio[i] })
  },

  removePortfolio(e) {
    const i = e.currentTarget.dataset.i
    const toDelete = this.data.portfolio[i]
    this.setData({ portfolio: this.data.portfolio.filter((_, idx) => idx !== i) })
    wx.cloud.deleteFile({ fileList: [toDelete] }).catch(() => {})
  },

  // ── bank card ──

  toggleEditCard() { this.setData({ editingCard: !this.data.editingCard }) },
  onBankCardInput(e) { this.setData({ bankCardInput: e.detail.value }) },

  async saveBankCard() {
    const card = this.data.bankCardInput.replace(/\s/g, '')
    if (card.length < 16) { wx.showToast({ title: '请填写正确的银行卡号', icon: 'none' }); return }
    this.setData({ savingCard: true })
    try {
      await auth.updateBankCard({ bank_card: card })
      if (app.globalData.userInfo) {
        if (!app.globalData.userInfo.hunter_info) app.globalData.userInfo.hunter_info = {}
        app.globalData.userInfo.hunter_info.bank_card = card
      }
      this.setData({ bankCard: '**** **** **** ' + card.slice(-4), editingCard: false })
      wx.showToast({ title: '银行卡已更新', icon: 'success' })
    } finally {
      this.setData({ savingCard: false })
    }
  },

  // ── save ──

  async onSave() {
    if (this.data.saving) return
    if (!this.data.profileReady) {
      wx.showToast({ title: '请先完成以下必填项', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await auth.updateHunterProfile({
        bio: this.data.bio,
        play_style: this.data.playStyle,
        service_tags: this.data.serviceTags,
        portfolio: this.data.portfolio,
        is_visible: this.data.isVisible
      })
      if (app.globalData.userInfo) {
        const hi = app.globalData.userInfo.hunter_info || {}
        hi.bio = this.data.bio
        hi.play_style = this.data.playStyle
        hi.service_tags = this.data.serviceTags
        hi.portfolio = this.data.portfolio
        hi.is_visible = this.data.isVisible
        app.globalData.userInfo.hunter_info = hi
      }
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } finally {
      this.setData({ saving: false })
    }
  },

  // ── nav ──

  goTasks()  { wx.navigateTo({ url: ROUTES.HUNTER_TASKS }) },
  goWallet() { wx.navigateTo({ url: ROUTES.HUNTER_WALLET }) },

  switchBoss() {
    const roles = app.globalData.roles || (app.globalData.userInfo && app.globalData.userInfo.roles) || []
    if (!hasRole(roles, 'boss')) { wx.showToast({ title: '当前账号无老板身份', icon: 'none' }); return }
    wx.reLaunch({ url: ROUTES.BOSS_HOME })
  },

  onLogout() {
    wx.showModal({
      title: '退出', content: '确认退出？',
      success: r => { if (r.confirm) { wx.clearStorageSync(); wx.reLaunch({ url: ROUTES.LOGIN }) } }
    })
  }
})
