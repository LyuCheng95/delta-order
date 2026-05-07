const { buildRolesFromAuthData, pickInitialHomePath, normalizeRole } = require('./utils/roles')

App({
  globalData: {
    userInfo: null,
    openid: '',
    role: '',
    roles: [],
    isLoggedIn: false,
    loginCallbacks: []   // 供页面等待登录完成
  },

  onLaunch() {
    console.log('[App] onLaunch')
    if (!wx.cloud) { console.error('[App] 请升级基础库到 2.2.3+'); return }
    wx.cloud.init({ env: 'cloud1-7gpc53pt3feac82a', traceUser: true })
    // 每次启动都重新走云端登录，保证角色/昵称最新，不依赖本地缓存
    this._silentLogin()
  },

  // 供页面注册"登录完成"回调
  waitForLogin(cb) {
    if (this.globalData.isLoggedIn) { cb(this.globalData); return }
    this.globalData.loginCallbacks.push(cb)
  },

  _silentLogin() {
    console.log('[App] _silentLogin: 开始 wx.login...')
    wx.login({
      success: res => {
        console.log('[App] wx.login OK, code长度:', res.code ? res.code.length : 0)
        if (!res.code) {
          this._loginFailed('wx.login 未返回 code')
          return
        }
        wx.cloud.callFunction({
          name: 'auth',
          data: { action: 'login', code: res.code, nickname: '', avatar_url: '' },
          success: r => {
            console.log('[App] auth 返回:', JSON.stringify(r.result))
            const result = r.result || {}
            if (result.code !== 0 || !result.data) {
              this._loginFailed('auth异常: ' + (result.msg || '无data'))
              return
            }
            const data = result.data
            const roles = buildRolesFromAuthData(data)
            const pref = normalizeRole(data.role)
            const role = roles.includes(pref) ? pref : roles[0]
            console.log('[App] 登录成功 | openid末4位:', data.openid ? data.openid.slice(-4) : '????',
              '| roles:', roles, '| role:', role, '| nickname:', data.nickname)
            this.globalData.userInfo   = { ...data, roles, role }
            this.globalData.openid     = data.openid
            this.globalData.roles      = roles
            this.globalData.role       = role
            this.globalData.isLoggedIn = true
            wx.setStorageSync('openid', data.openid)
            wx.setStorageSync('role',   this.globalData.role)
            try { wx.setStorageSync('roles', roles) } catch (e) {}
            // 通知等待的页面
            const cbs = this.globalData.loginCallbacks
            this.globalData.loginCallbacks = []
            cbs.forEach(cb => cb(this.globalData))
            // 多身份时优先进老板端（与云端一致）
            const url = pickInitialHomePath(roles)
            console.log('[App] reLaunch ->', url)
            wx.reLaunch({ url })
          },
          fail: err => {
            console.error('[App] auth 云函数调用失败:', JSON.stringify(err))
            this._loginFailed('云函数调用失败: ' + (err.errMsg || ''))
          }
        })
      },
      fail: err => {
        console.error('[App] wx.login 失败:', JSON.stringify(err))
        this._loginFailed('wx.login 失败: ' + (err.errMsg || ''))
      }
    })
  },

  _loginFailed(reason) {
    console.error('[App] 登录失败:', reason)
    wx.reLaunch({ url: '/pages/login/login?err=' + encodeURIComponent(reason) })
  }
})
