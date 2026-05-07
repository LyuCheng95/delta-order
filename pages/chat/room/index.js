const app = getApp()
const { chat } = require('../../../utils/cloud')
const { fmtTime } = require('../../../utils/constants')

const EMOJIS = [
  '😀','😂','😍','🥺','😎','😤','🫡','💪',
  '🔥','⚡','🎮','🏆','🎯','🎲','👾','🕹️',
  '👍','👋','✅','💯','❤️','🤝','🙏','😊'
]

Page({
  data: {
    conv: null,
    messages: [],
    inputVal: '',
    showEmoji: false,
    emojis: EMOJIS,
    sending: false,
    loading: true,
    myOpenid: '',
    scrollIntoId: ''
  },

  convId: '',
  _watcher: null,

  onLoad(opt) {
    this.convId = opt.convId || ''
    const title = decodeURIComponent(opt.title || '群聊')
    wx.setNavigationBarTitle({ title })
    this.setData({ myOpenid: app.globalData.openid || '' })
    this._loadHistory()
    this._watch()
  },

  onShow() {
    // Mark as read
    this._markRead()
  },

  onUnload() {
    if (this._watcher) { this._watcher.close(); this._watcher = null }
  },

  async _loadHistory() {
    try {
      const msgs = await chat.listMessages({ convId: this.convId })
      this.setData({
        messages: this._fmt(msgs || []),
        loading: false
      }, () => this._scrollBottom())
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  _fmt(msgs) {
    const mine = this.data.myOpenid
    return msgs.map((m, i) => {
      const prev = i > 0 ? msgs[i - 1] : null
      const showTime = !prev || (new Date(m.created_at) - new Date(prev.created_at)) > 5 * 60 * 1000
      return {
        ...m,
        isMine:   m.sender_openid === mine,
        isSystem: m.type === 'system',
        timeStr:  showTime ? fmtTime(m.created_at) : ''
      }
    })
  },

  _watch() {
    try {
      const db = wx.cloud.database()
      this._watcher = db.collection('messages')
        .where({ conv_id: this.convId })
        .watch({
          onChange: snapshot => {
            const added = (snapshot.docChanges || [])
              .filter(c => c.dataType === 'add')
              .map(c => c.doc)
            if (!added.length) return
            const existingIds = new Set(this.data.messages.map(m => m._id))
            const mine = this.data.myOpenid
            const newMsgs = added
              .filter(d => !existingIds.has(d._id))
              .map(d => ({
                ...d,
                isMine:   d.sender_openid === mine,
                isSystem: d.type === 'system',
                timeStr:  fmtTime(d.created_at)
              }))
            if (!newMsgs.length) return
            this.setData(
              { messages: [...this.data.messages, ...newMsgs] },
              () => this._scrollBottom()
            )
            this._markRead()
          },
          onError: err => console.error('[chat] watch error', err)
        })
    } catch (e) {
      console.warn('[chat] watch not available', e)
    }
  },

  _scrollBottom() {
    const msgs = this.data.messages
    if (!msgs.length) return
    const lastId = msgs[msgs.length - 1]._id
    this.setData({ scrollIntoId: 'msg-' + lastId })
  },

  _markRead() {
    try {
      const map = wx.getStorageSync('chat_read_map') || {}
      map[this.convId] = Date.now()
      wx.setStorageSync('chat_read_map', map)
    } catch (_) {}
  },

  onInput(e) {
    this.setData({ inputVal: e.detail.value })
  },

  toggleEmoji() {
    this.setData({ showEmoji: !this.data.showEmoji })
  },

  tapEmoji(e) {
    this.setData({
      inputVal: this.data.inputVal + e.currentTarget.dataset.emoji,
      showEmoji: false
    })
  },

  async sendText() {
    const content = this.data.inputVal.trim()
    if (!content || this.data.sending) return
    this.setData({ sending: true, inputVal: '', showEmoji: false })
    try {
      await chat.sendMessage({ convId: this.convId, type: 'text', content })
    } catch (e) {
      this.setData({ inputVal: content })
    } finally {
      this.setData({ sending: false })
    }
  },

  async sendImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async res => {
        const tmp = res.tempFiles[0].tempFilePath
        wx.showLoading({ title: '发送中...' })
        try {
          const compressed = await new Promise((resolve, reject) =>
            wx.compressImage({
              src: tmp, quality: 60,
              success: r => resolve(r.tempFilePath),
              fail: reject
            })
          )
          const cloudPath = `chat/${this.convId}/${Date.now()}.jpg`
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
          await chat.sendMessage({ convId: this.convId, type: 'image', content: up.fileID })
        } catch (e) {
          wx.showToast({ title: '发送失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  previewImg(e) {
    const src = e.currentTarget.dataset.src
    wx.previewImage({ urls: [src], current: src })
  }
})
