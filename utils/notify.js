/**
 * 微信订阅消息工具
 *
 * 使用方式：
 *   在用户点击事件中调用 requestNotify(['TMPL_NEW_MSG', 'TMPL_ORDER_STATUS'])
 *   用户同意后，后端下次发送对应模板的消息时将出现在微信通知中心。
 *
 * 注意：每次 requestSubscribeMessage 只能发送 1 条对应模板的消息。
 *       需要再次通知时须再次调用本函数（建议在用户进入订单详情或聊天室时调用）。
 */
const { SUBSCRIBE_TEMPLATES } = require('./constants')

const VALID_TEMPLATES = Object.values(SUBSCRIBE_TEMPLATES)
  .filter(id => id && !id.startsWith('REPLACE_'))

/**
 * 请求订阅通知权限。
 * @param {'all'|string[]} which 'all' 或模板 ID 数组，默认 'all'
 * @returns {Promise<{[tmplId]: 'accept'|'reject'|'ban'}>}
 */
async function requestNotify(which = 'all') {
  if (!VALID_TEMPLATES.length) {
    console.warn('[notify] 未配置订阅消息模板 ID，跳过请求')
    return {}
  }

  const tmplIds = which === 'all'
    ? VALID_TEMPLATES
    : which.filter(id => VALID_TEMPLATES.includes(id))

  if (!tmplIds.length) return {}

  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: res => resolve(res),
      fail: err => {
        console.warn('[notify] requestSubscribeMessage fail', err)
        resolve({})
      }
    })
  })
}

module.exports = { requestNotify }
