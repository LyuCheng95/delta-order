const { ENTERPRISE_WECHAT_CUSTOMER_SERVICE } = require('./constants')

/**
 * 拉起已绑定的企业微信客服会话（需配置 ENTERPRISE_WECHAT_CUSTOMER_SERVICE）
 * @param {() => void} [onDone] 打开结束或无法打开时回调（成功、失败或未配置都会调用，便于后续弹窗）
 */
function openEnterpriseCustomerService(onDone) {
  const done = typeof onDone === 'function' ? onDone : () => {}
  const { corpId, url } = ENTERPRISE_WECHAT_CUSTOMER_SERVICE
  if (!corpId || !url) {
    wx.showToast({
      title: '请在 utils/constants 填写企业微信 corpId 与客服链接',
      icon: 'none',
      duration: 3500
    })
    done()
    return
  }
  if (typeof wx.openCustomerServiceChat !== 'function') {
    wx.showToast({ title: '请升级微信后再试', icon: 'none' })
    done()
    return
  }
  wx.openCustomerServiceChat({
    extInfo: { url },
    corpId,
    success() { done() },
    fail(err) {
      console.error('[customerService]', err)
      wx.showToast({ title: err.errMsg || '打开客服失败', icon: 'none' })
      done()
    }
  })
}

module.exports = { openEnterpriseCustomerService }
