const app = getApp()
const { pickInitialHomePath, buildRolesFromAuthData } = require('../../utils/roles')

Page({
  data: {
    errMsg: '',
    retrying: false
  },

  onLoad(options) {
    // 如果 app.js 传了错误信息，显示出来
    if (options.err) {
      this.setData({ errMsg: decodeURIComponent(options.err) })
    }
  },

  onShow() {
    if (app.globalData.isLoggedIn) {
      const roles = (app.globalData.roles && app.globalData.roles.length)
        ? app.globalData.roles
        : buildRolesFromAuthData(app.globalData.userInfo)
      wx.reLaunch({ url: pickInitialHomePath(roles) })
    }
  },

  // 手动重试按钮
  onRetry() {
    this.setData({ errMsg: '', retrying: true })
    app._silentLogin()
  }
})
