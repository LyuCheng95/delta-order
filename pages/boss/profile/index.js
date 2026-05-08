const { auth, wallet } = require('../../../utils/cloud')
const { ROUTES, fen2zb } = require('../../../utils/constants')
const { hasRole } = require('../../../utils/roles')
const app = getApp()

// VIP thresholds in fen
const VIP_THRESHOLDS = [0, 500000, 1000000, 5000000] // VIP0,1,2,3

function computeVip(total_spent_fen) {
  const s = Number(total_spent_fen) || 0
  let level = 0
  if (s >= VIP_THRESHOLDS[3]) level = 3
  else if (s >= VIP_THRESHOLDS[2]) level = 2
  else if (s >= VIP_THRESHOLDS[1]) level = 1
  const nextThreshold = VIP_THRESHOLDS[level + 1]
  let progress = 0, tip = ''
  if (level < 3) {
    const from = VIP_THRESHOLDS[level]
    progress = Math.min(100, Math.round((s - from) / (nextThreshold - from) * 100))
    const need = Math.ceil((nextThreshold - s) / 100)
    tip = `再消费 ${need.toLocaleString()} 总裁贝升级 VIP${level + 1}`
  }
  return { vipLevel: level, vipProgress: progress, vipTip: tip }
}

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    isAdmin: false,
    isHunter: false,
    hunterTitle: '申请成为陪玩师',
    hunterDesc: '接单赚钱，展示你的实力',
    applyStatus: 'none',
    showApply: false,
    applyReason: '',
    applyBio: '',
    hunterNickname: '',
    hunterWechat: '',
    applying: false,
    contact: '',
    editingContact: false,
    contactDraft: '',
    savingContact: false,
    editingNickname: false,
    nicknameDraft: '',
    savingNickname: false,
    balanceZb: '0',
    spentZb: '0',
    vipLevel: 0,
    vipProgress: 0,
    vipTip: '消费 5,000 总裁贝升级 VIP1'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, showHunterTab: !!app.globalData.hasActiveHunters })
    }
    const u = app.globalData.userInfo
    if (!u) return
    const roles = app.globalData.roles || u.roles || []
    const isAdmin = hasRole(roles, 'admin')
    const isHunter = hasRole(roles, 'hunter')
    this.setData({ nickname: u.nickname || '玩家', avatarUrl: u.avatar_url || '', isAdmin, isHunter, contact: u.contact || '' })
    if (!isHunter) {
      this._updateHunterUI((u.hunter_info && u.hunter_info.apply_status) || 'none')
    }
    this._loadWallet()
  },

  async _loadWallet() {
    try {
      const data = await wallet.getBossWallet()
      const { balance_fen = 0, total_spent_fen = 0 } = data
      const { vipLevel, vipProgress, vipTip } = computeVip(total_spent_fen)
      this.setData({
        balanceZb: fen2zb(balance_fen),
        spentZb: fen2zb(total_spent_fen),
        vipLevel, vipProgress, vipTip
      })
    } catch (_) {}
  },

  goRecharge() {
    wx.navigateTo({ url: ROUTES.BOSS_RECHARGE })
  },

  goRechargeHistory() {
    wx.navigateTo({ url: ROUTES.BOSS_RECHARGE + '?tab=history' })
  },

  goAdmin() {
    wx.navigateTo({ url: ROUTES.ADMIN_HOME })
  },

  goHunterLogin() {
    wx.reLaunch({ url: ROUTES.HUNTER_HOME })
  },

  _updateHunterUI(s) {
    const map = {
      none: ['申请成为陪玩师', '接单赚钱，展示你的实力'],
      pending: ['审核中', '管理员正在审核，请耐心等待'],
      approved: ['切换到陪玩师模式', '你的陪玩师资格已通过，点击切换'],
      rejected: ['重新申请', '申请未通过，可重新提交']
    }
    const pair = map[s] || map.none
    this.setData({ applyStatus: s, hunterTitle: pair[0], hunterDesc: pair[1] })
  },

  onHunterEntry() {
    if (this.data.isHunter) {
      this.goHunterLogin()
      return
    }
    const s = this.data.applyStatus
    if (s === 'approved') {
      this.goHunterLogin()
      return
    }
    if (s === 'pending') {
      wx.showToast({ title: '审核中，请耐心等待', icon: 'none' })
      return
    }
    this.setData({ showApply: true, applyReason: '', applyBio: '', hunterNickname: '', hunterWechat: '' })
  },

  closeApply() { this.setData({ showApply: false }) },
  onApplyInput(e) { this.setData({ applyReason: e.detail.value }) },
  onApplyBioInput(e) { this.setData({ applyBio: e.detail.value }) },
  onNickInput(e) { this.setData({ hunterNickname: e.detail.value }) },
  onWechatInput(e) { this.setData({ hunterWechat: e.detail.value }) },

  async submitApply() {
    if (!this.data.hunterNickname.trim()) { wx.showToast({ title: '请填写陪玩师昵称', icon: 'none' }); return }
    if (!this.data.hunterWechat.trim()) { wx.showToast({ title: '请填写微信号，管理员通过后会联系你', icon: 'none' }); return }
    if (!this.data.applyReason.trim()) { wx.showToast({ title: '请填写申请说明', icon: 'none' }); return }
    this.setData({ applying: true })
    try {
      await auth.applyHunter({
        apply_reason:    this.data.applyReason.trim(),
        hunter_nickname: this.data.hunterNickname.trim(),
        bio:             this.data.applyBio.trim() || undefined,
        contact:         this.data.hunterWechat.trim()
      })
      if (app.globalData.userInfo) {
        app.globalData.userInfo.hunter_info = { apply_status: 'pending' }
        if (this.data.hunterWechat.trim()) app.globalData.userInfo.contact = this.data.hunterWechat.trim()
      }
      this.setData({ showApply: false, contact: this.data.hunterWechat.trim() })
      this._updateHunterUI('pending')
      wx.showToast({ title: '申请已提交', icon: 'success' })
    } finally {
      this.setData({ applying: false })
    }
  },

  async onEditAvatar() {
    try {
      const res = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject
        })
      )
      const tempUrl = res.tempFiles[0].tempFilePath
      wx.showLoading({ title: '上传中…', mask: true })
      const { tempFilePath: compressed } = await new Promise((resolve, reject) =>
        wx.compressImage({ src: tempUrl, quality: 60, success: resolve, fail: () => resolve({ tempFilePath: tempUrl }) })
      )
      const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const { fileID } = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
      await auth.updateAvatar({ avatar_url: fileID })
      if (app.globalData.userInfo) app.globalData.userInfo.avatar_url = fileID
      this.setData({ avatarUrl: fileID })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (e) {
      if (e && e.errMsg && e.errMsg.includes('cancel')) return
      wx.showToast({ title: '更新失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  openEditNickname() {
    this.setData({ editingNickname: true, nicknameDraft: this.data.nickname })
  },
  closeEditNickname() { this.setData({ editingNickname: false }) },
  onNicknameInput(e) { this.setData({ nicknameDraft: e.detail.value }) },

  async saveNickname() {
    const nickname = this.data.nicknameDraft.trim()
    if (!nickname) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    this.setData({ savingNickname: true })
    try {
      await auth.updateNickname({ nickname })
      if (app.globalData.userInfo) app.globalData.userInfo.nickname = nickname
      this.setData({ nickname, editingNickname: false })
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ savingNickname: false })
    }
  },

  openEditContact() {
    this.setData({ editingContact: true, contactDraft: this.data.contact })
  },
  closeEditContact() { this.setData({ editingContact: false }) },
  onContactInput(e) { this.setData({ contactDraft: e.detail.value }) },

  async saveContact() {
    const contact = this.data.contactDraft.trim()
    this.setData({ savingContact: true })
    try {
      await auth.updateContact({ contact })
      const u = app.globalData.userInfo
      if (u) u.contact = contact
      this.setData({ contact, editingContact: false })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ savingContact: false })
    }
  },

  onAbout() { wx.showModal({ title: '上总裁电竞', content: '上总裁电竞平台 v1.0', showCancel: false }) }
})
