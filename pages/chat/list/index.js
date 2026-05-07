const app = getApp()
const { chat } = require('../../../utils/cloud')
const { fmtTime, ROUTES } = require('../../../utils/constants')

Page({
  data: {
    convs: [],
    loading: true,
    refreshing: false
  },

  onShow() {
    this._load()
    // Clear unread dot when on this tab
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ selected: 2, hasUnread: false })
  },

  async _load() {
    try {
      const list = await chat.listConversations()
      const readMap = this._getReadMap()
      this.setData({
        convs: (list || []).map(c => ({
          ...c,
          lastTimeStr: fmtTime(c.last_msg_time),
          hasUnread: this._isUnread(c, readMap)
        })),
        loading: false,
        refreshing: false
      })
    } catch (e) {
      this.setData({ loading: false, refreshing: false })
    }
  },

  /** 本地存储最近已读时间戳 map: { convId: timestamp } */
  _getReadMap() {
    try { return wx.getStorageSync('chat_read_map') || {} } catch { return {} }
  },

  _isUnread(conv, readMap) {
    if (!conv.last_msg_time || !conv.last_msg) return false
    const lastTime = new Date(conv.last_msg_time).getTime()
    const readTime = readMap[conv._id] || 0
    // Only show unread if last message is not mine
    return lastTime > readTime && conv.last_sender_openid !== (app.globalData.openid || '')
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this._load()
  },

  goRoom(e) {
    const { id, name } = e.currentTarget.dataset
    // Mark as read
    try {
      const map = this._getReadMap()
      map[id] = Date.now()
      wx.setStorageSync('chat_read_map', map)
    } catch (_) {}
    wx.navigateTo({ url: `${ROUTES.CHAT_ROOM}?convId=${id}&title=${encodeURIComponent(name || '群聊')}` })
  }
})
