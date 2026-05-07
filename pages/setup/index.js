const { auth } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    avatarUrl: '',
    avatarTempPath: '',
    avatarChosen: false,
    nickname: '',
    saving: false,
    homePath: ''
  },

  onLoad(opt) {
    this.setData({ homePath: decodeURIComponent(opt.home || '') })
    // 预填已有昵称（若不是自动生成的）
    const userInfo = app.globalData.userInfo || {}
    const auto = /^玩家.{4}$/.test(userInfo.nickname || '')
    if (!auto && userInfo.nickname) this.setData({ nickname: userInfo.nickname })
    if (userInfo.avatar_url) this.setData({ avatarUrl: userInfo.avatar_url })
  },

  onChooseAvatar(e) {
    const tempPath = e.detail.avatarUrl
    if (!tempPath) return
    this.setData({ avatarUrl: tempPath, avatarTempPath: tempPath, avatarChosen: true })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  async onDone() {
    const nickname = this.data.nickname.trim()
    if (!nickname) { wx.showToast({ title: '请填写昵称', icon: 'none' }); return }
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      // 上传头像到云存储
      if (this.data.avatarTempPath) {
        wx.showLoading({ title: '上传头像…', mask: true })
        const { tempFilePath: compressed } = await new Promise(resolve =>
          wx.compressImage({ src: this.data.avatarTempPath, quality: 60, success: resolve, fail: () => resolve({ tempFilePath: this.data.avatarTempPath }) })
        )
        const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
        const { fileID } = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
        await auth.updateAvatar({ avatar_url: fileID })
        if (app.globalData.userInfo) app.globalData.userInfo.avatar_url = fileID
        wx.hideLoading()
      }

      // 保存昵称
      await auth.updateNickname({ nickname })
      if (app.globalData.userInfo) app.globalData.userInfo.nickname = nickname

      // 标记已完成，永不再弹
      const openid = app.globalData.openid || ''
      wx.setStorageSync('profile_setup_done_' + openid, true)

      wx.showToast({ title: '设置完成', icon: 'success' })
      setTimeout(() => wx.reLaunch({ url: this.data.homePath }), 1000)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onSkip() {
    // 跳过也标记完成，不再打扰
    const openid = app.globalData.openid || ''
    wx.setStorageSync('profile_setup_done_' + openid, true)
    wx.reLaunch({ url: this.data.homePath })
  }
})
