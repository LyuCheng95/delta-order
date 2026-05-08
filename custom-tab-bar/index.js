Component({
  data: {
    selected: 0,
    hasUnread: false,
    tabs: [
      { label: '首页', path: '/pages/boss/index/index' },
      { label: '陪玩师', path: '/pages/boss/hunters/index' },
      { label: '订单', path: '/pages/boss/orders/index' },
      { label: '我的', path: '/pages/boss/profile/index' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      this.setData({ selected: index })
      wx.switchTab({ url: path })
    },
    setUnread(val) {
      this.setData({ hasUnread: !!val })
    }
  }
})
