const STATUS_LABEL = {
  pending_payment: '待付款',
  paid:            '待接单',
  in_progress:     '进行中',
  pending_settlement: '待结单审核',
  completed:       '已完成',
  disputed:        '争议中',
  refunded:        '已退款',
  cancelled:       '已取消',
  deleted:         '已删除'
}

const WITHDRAW_STATUS_LABEL = {
  pending: '审核中',
  paid: '已打款',
  rejected: '已拒绝'
}

/** 支付成功后写入，订单 tab 页 onShow 读取并切换到对应状态（如 paid=待接单） */
const STORAGE_BOSS_ORDERS_TAB = 'boss_orders_initial_tab'

const ROUTES = {
  LOGIN:            '/pages/login/login',
  BOSS_HOME:        '/pages/boss/index/index',
  BOSS_SVC_LIST:    '/pages/boss/service-list/index',
  BOSS_SVC_DETAIL:  '/pages/boss/service-detail/index',
  BOSS_PAYMENT:     '/pages/boss/payment/index',
  BOSS_RECHARGE:    '/pages/boss/recharge/index',
  BOSS_ORDERS:      '/pages/boss/orders/index',
  BOSS_ORDER_DETAIL:'/pages/boss/order-detail/index',
  BOSS_PROFILE:         '/pages/boss/profile/index',
  BOSS_HUNTERS:         '/pages/boss/hunters/index',
  BOSS_HUNTER_PROFILE:  '/pages/boss/hunter-profile/index',
  HUNTER_HOME:      '/pages/hunter/index/index',
  HUNTER_OD:        '/pages/hunter/order-detail/index',
  HUNTER_TASKS:     '/pages/hunter/my-tasks/index',
  HUNTER_WALLET:    '/pages/hunter/wallet/index',
  HUNTER_UPDATE:    '/pages/hunter/update-progress/index',
  HUNTER_PROFILE:   '/pages/hunter/profile/index',
  ADMIN_HOME:       '/pages/admin/index/index',
  ADMIN_ORDERS:     '/pages/admin/orders/index',
  ADMIN_CATS:       '/pages/admin/categories/index',
  ADMIN_SVCS:       '/pages/admin/services/index',
  ADMIN_HUNTERS:    '/pages/admin/hunters/index',
  ADMIN_WITHDRAWALS:'/pages/admin/withdrawals/index',
  ADMIN_CATEGORY_EDIT: '/pages/admin/category-edit/index',
  ADMIN_SERVICE_EDIT:  '/pages/admin/service-edit/index',
}

/**
 * 微信订阅消息模板 ID
 * 配置方法：微信公众平台 → 小程序 → 功能 → 订阅消息 → 选择模板 → 复制模板 ID
 *
 * TMPL_NEW_MSG   —— 新消息通知，字段：thing1(群聊名) thing2(消息内容) time3(时间)
 * TMPL_ORDER_STATUS —— 订单状态变更，字段：thing1(服务名) phrase2(状态) time3(时间) thing4(备注)
 *
 * ⚠️  填写真实模板 ID 后重新部署 chat 和 order 云函数，通知才会生效。
 */
const SUBSCRIBE_TEMPLATES = {
  TMPL_NEW_MSG:      'REPLACE_WITH_YOUR_NEW_MSG_TEMPLATE_ID',
  TMPL_ORDER_STATUS: 'REPLACE_WITH_YOUR_ORDER_STATUS_TEMPLATE_ID'
}

/**
 * 固定企业微信客服（用于 wx.openCustomerServiceChat）
 * 路径：微信公众平台 → 小程序 → 客服 → 企业微信客服，完成绑定后，
 * 到企业微信管理后台「客户与上下游 - 微信客服」获取企业 ID 与对应客服帐号的客服链接。
 */
const ENTERPRISE_WECHAT_CUSTOMER_SERVICE = {
  corpId: 'wwc4962f13ba61b73a',
  url: 'https://work.weixin.qq.com/kfid/kfcafe037b8e3fcdae7' //一一
}

// 分 → 元（人民币，用于提现等场景）
const fen2yuan = (fen) => {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

// 分 → 总裁贝（1总裁贝=1元=100分，有小数时保留一位）
const fen2zb = (fen) => {
  const val = (Number(fen) || 0) / 100
  const str = val % 1 === 0 ? String(Math.floor(val)) : val.toFixed(1)
  return str.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 时间格式化
const fmtTime = (date) => {
  if (!date) return ''
  const d = new Date(date)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

module.exports = {
  STATUS_LABEL,
  WITHDRAW_STATUS_LABEL,
  STORAGE_BOSS_ORDERS_TAB,
  ROUTES,
  ENTERPRISE_WECHAT_CUSTOMER_SERVICE,
  SUBSCRIBE_TEMPLATES,
  fen2yuan,
  fen2zb,
  fmtTime
}
