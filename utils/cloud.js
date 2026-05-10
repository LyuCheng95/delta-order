/**
 * 云函数统一调用封装
 * 对偶发 ECONNRESET / 连接中断 做有限次重试（仍失败则同上抛错）
 */
// 注意：data 里必须有顶层 action 表示云函数路由；业务参数里不要用 key「action」，否则会覆盖路由（见 reviewHunter / addLog）
const shouldRetryCall = err => {
  const msg = (err && (err.errMsg || err.message || '')).toString().toLowerCase()
  return (
    msg.includes('econnreset') ||
    msg.includes('connection reset') ||
    msg.includes('connection abort') ||
    msg.includes('socket') ||
    msg.includes('timeout')
  )
}

const callOnce = (name, action, params) =>
  new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: { ...params, action },
      success: res => {
        const r = res.result
        if (r && r.code === 0) resolve(r.data)
        else {
          const msg = (r && r.msg) || '操作失败'
          wx.showToast({ title: msg, icon: 'none' })
          reject(new Error(msg))
        }
      },
      fail: err => reject(err)
    })
  })

const call = async (name, action, params = {}) => {
  const max = 3
  let lastErr
  for (let i = 0; i < max; i++) {
    try {
      return await callOnce(name, action, params)
    } catch (err) {
      lastErr = err
      if (i < max - 1 && shouldRetryCall(err)) {
        await new Promise(r => setTimeout(r, 400 * (i + 1)))
        continue
      }
      console.error(`[cloud] ${name}.${action}`, err)
      wx.showToast({ title: '网络不稳定，请重试', icon: 'none' })
      throw err
    }
  }
  throw lastErr
}

const auth    = {
  login: p => call('auth','login',p),
  getRole: () => call('auth','getRole'),
  /** 拉取云端最新用户（含 roles），结构同 login.data */
  refreshProfile: () => call('auth', 'refreshProfile', {}),
  applyHunter: p => call('auth','applyHunter',p),
  updateBankCard:  p => call('auth','updateBankCard',p),
  listHuntersForPairing: () => call('auth','listHuntersForPairing'),
  updateNickname:  p => call('auth','updateNickname',p),
  updateAvatar:    p => call('auth','updateAvatar',p),
  updateContact:   p => call('auth','updateContact',p),
  reviewHunter: p => call('auth','reviewHunter',p),
  listApply: () => call('auth','listHunterApply'),
  listActiveHunters: () => call('auth','listActiveHunters'),
  updateHunterShare:   p  => call('auth','updateHunterShare',p),
  dismissHunter:       p  => call('auth','dismissHunter',p),
  banUser:             p  => call('auth','banUser',p),
  updateHunterProfile:   p => call('auth','updateHunterProfile',p),
  setHunterAdminHidden:  p => call('auth','setHunterAdminHidden',p),
  listHuntersForBoss:  () => call('auth','listHuntersForBoss'),
  recordHunterView:    p  => call('auth','recordHunterView',p),
  getHunterPublic:     p  => call('auth','getHunterPublic',p)
}
const dev = {
  grantTripleRoles:    () => call('auth', 'grantTripleRolesIfSoleUser', {}),
  seedMockHunters:     () => call('auth', 'devSeedMockHunters', {}),
  deleteMockHunters:   () => call('auth', 'devDeleteMockHunters', {}),
  directCredit:      p  => call('wallet','devDirectCredit', p),
  createTestOrder:   () => wx.cloud.callFunction({ name: 'order', data: { action: 'createTestOrder', secret: 'CREATE_TEST_ORDER' } }).then(r => r.result),
  submitSettlement:  p  => call('order', 'devSubmitSettlement', p),
  confirmSettlement: p  => call('order', 'confirmSettlement', p),
  clearAllOrders:    () => wx.cloud.callFunction({ name: 'order', data: { action: 'clearAllOrders', secret: 'DELETE_ALL_TEST_ORDERS' } }).then(r => r.result),
  clearAllWallet:    () => wx.cloud.callFunction({ name: 'wallet', data: { action: 'devClearAll', secret: 'DELETE_ALL_TEST_ORDERS' } }).then(r => { if (!r.result || r.result.code !== 0) throw new Error((r.result && r.result.msg) || '清空失败'); return r.result.data }),
  requestWithdraw:   p  => call('wallet','requestWithdraw', p),
  listPendingWithdraws: () => call('wallet','listPendingAdmin'),
  batchPayWithdraw:  p  => call('wallet','batchReviewWithdraw', p),
  deleteRecord:      p  => call('wallet','devDeleteRecord', p),
  requestRecharge:   p  => call('wallet','requestRecharge', p),
  listPendingRecharges: () => call('wallet','listRechargesAdmin'),
  approveRecharge:   p  => call('wallet','reviewRecharge', p),
  takeOrder:         p  => call('order', 'take', p)
}

const order   = {
  create: p => call('order','create',p),
  list: p => call('order','list',p),
  detail: id => call('order','detail',{orderId:id}),
  take: p => typeof p === 'string' ? call('order','take',{orderId:p}) : call('order','take',p),
  updateStatus: p => call('order','updateStatus',p),
  submitSettlement: p => call('order','submitSettlement',p),
  confirmSettlement: p => call('order','confirmSettlement',p),
  rejectSettlement: p => call('order','rejectSettlement',p),
  assignCoHunter: p => call('order','assignCoHunter',p),
  addLog: p => call('order','addLog',p),
  getLogs: id => call('order','getLogs',{orderId:id}),
  dashboard: () => call('order','dashboard'),
  todayStats: () => call('order','todayStats'),
  adminRemoveOrder:   id => call('order', 'adminRemoveOrder', { orderId: id }),
  rejectDesignated:   p  => call('order', 'rejectDesignated', p),
  assignCoHunter:     p  => call('order', 'assignCoHunter', p)
}
const service = {
  listCats: () => call('service', 'listCategories'),
  listCatsForUser: () => call('service', 'listCatsForUser'),
  listAllForBoss:  () => call('service', 'listAllForBoss'),
  listCatsAdmin: () => call('service', 'listCategoriesAdmin'),
  listByCat: id => call('service', 'listByCategory', { categoryId: id }),
  listSvcsAdmin: p => call('service', 'listServicesAdmin', p || {}),
  detail: id => call('service', 'detail', { serviceId: id }),
  upsertCat: p => call('service', 'upsertCategory', p),
  upsertSvc: p => call('service', 'upsertService', p),
  deleteCat: id => call('service', 'deleteCategory', { categoryId: id }),
  createTestService: p => call('service', 'createTestService', p),
  deleteSvc: id => call('service', 'deleteService', { serviceId: id }),
  toggleActive: p => call('service', 'toggleServiceActive', p),
  updateCatOrder: p => call('service', 'updateCatOrder', p),
  updateSvcOrder:   p => call('service', 'updateSvcOrder', p),
  setAllCoHunter:   p => call('service', 'setAllCoHunter', p)
}
const config = {
  get: key => call('service', 'getConfig', { key }),
  set: (key, value) => call('service', 'setConfig', { key, value })
}
const payment = {
  // 虚拟支付配置（offerId 等）
  getVirtualPayConfig:  ()  => call('payment', 'getVirtualPayConfig', {}),
  // 充值：创建待支付记录 → 拿 outTradeNo 传给 wx.requestVirtualPayment attachInfo
  createRechargeOrder:  p   => call('payment', 'createRechargeOrder', p),
  // 充值：支付成功后直接入账（前端调用）
  confirmRecharge:      p   => call('payment', 'confirmRecharge', p),
  // 充值：查询到账状态（备用）
  queryRecharge:        p   => call('payment', 'queryRecharge', p),
  // 订单支付：用总裁贝余额扣款
  payOrderWithBalance:  p   => call('payment', 'payOrderWithBalance', p),
  // 退款（管理员）
  refund:               id  => call('payment', 'refund', { orderId: id })
}
const wallet = {
  // 陪玩师钱包
  getSummary:          () => call('wallet', 'getSummary'),
  requestWithdraw:     p  => call('wallet', 'requestWithdraw', p),
  listMine:            () => call('wallet', 'listMine'),
  listPendingAdmin:    () => call('wallet', 'listPendingAdmin'),
  listAllAdmin:        () => call('wallet', 'listAllAdmin'),
  reviewWithdraw:      p  => call('wallet', 'reviewWithdraw', p),
  batchReviewWithdraw: p  => call('wallet', 'batchReviewWithdraw', p),
  // 老板总裁贝
  getBossWallet:       () => call('wallet', 'getBossWallet'),
  requestRecharge:     p  => call('wallet', 'requestRecharge', p),
  listRechargesUser:   () => call('wallet', 'listRechargesUser'),
  listRechargesAdmin:  () => call('wallet', 'listRechargesAdmin'),
  reviewRecharge:      p  => call('wallet', 'reviewRecharge', p),
  batchReviewRecharge: p  => call('wallet', 'batchReviewRecharge', p)
}

const chat = {
  listConversations: () => call('chat', 'listConversations'),
  listConvs:         () => call('chat', 'listConversations'),   // compat alias
  listMessages:      p  => call('chat', 'listMessages', p),
  getMessages:       p  => call('chat', 'listMessages', p),     // compat alias
  sendMessage:       p  => call('chat', 'sendMessage', p),
  getOrCreateOrder:  p  => call('chat', 'getOrCreateOrderChat', p),
  getOrCreateCs:     p  => call('chat', 'getOrCreateCsChat', p)
}

module.exports = { auth, order, service, payment, wallet, chat, dev, config }
