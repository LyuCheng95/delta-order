Component({
  data: {
    selected: '/pages/boss/index/index',
    isHunter: false,
    hasUnread: false,
    tabs: [
      { label: '首页',   path: '/pages/boss/index/index' },
      { label: '陪玩师', path: '/pages/boss/hunters/index', hunterOnly: true },
      { label: '订单',   path: '/pages/boss/orders/index' },
      { label: '我的',   path: '/pages/boss/profile/index' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path } = e.currentTarget.dataset
      this.setData({ selected: path })
      wx.switchTab({ url: path })
    },
    setUnread(val) {
      this.setData({ hasUnread: !!val })
    }
  }
})
