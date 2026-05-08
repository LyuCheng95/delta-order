/**
 * 文案模式切换
 * REVIEW_MODE = true  → 合规文案（提审用）
 * REVIEW_MODE = false → 内部文案（日常运营）
 *
 * 切换后重新 upload 小程序代码即可，无需改其他文件。
 */
const REVIEW_MODE = true

const TERMS = REVIEW_MODE ? {
  // 角色
  hunter:         '陪玩师',
  boss:           '玩家',
  // 页面标题
  huntCenter:     '陪玩中心',
  // 申请/切换
  applyHunter:    '申请成为陪玩师',
  applyHunterNick:'陪玩师昵称',
  switchToHunter: '陪玩师登录',
  switchToBoss:   '切换到玩家模式',
  hunterWorkbench:'进入陪玩工作台，接单与收入',
  hunterMgmt:     '订单、服务、陪玩师审核等',
  // 订单
  settle:         '完单',
  settleBtn:      '确认完成',
  settleScreenshot:'上传完成截图',
  settleProof:    '完成截图',
  hunterProof:    '陪玩师完成截图',
  pendingSettle:  '待审核',
  waitHunter:     '等待陪玩师接单...',
  takeOrderHint:  '接单后请尽快联系玩家开始执行',
  orderInfoTitle: '玩家下单信息',
  thisHunter:     '本单陪玩师',
  confirmSettle:  '确认后订单完成，将按该陪玩师当前分成比例结算入账（可提现）。',
  rejectHint:     '请说明陪玩师需如何修改',
  submittedHint:  '已提交完成截图，等待管理员审核通过后入账',
  // 管理
  activeHunters:  '在职陪玩师',
  noActiveHunters:'暂无在职陪玩师',
  dismissTitle:   '移除陪玩师',
  payHunterHint:  '确认已向陪玩师银行卡完成转账？',
  rulesTitle:     '玩家须知',
  // 首页 slogan
  slogan:         '你的专属陪玩',
  sloganTag:      '🏆 全程陪玩',
  // 进度 placeholder
  progressHint:   '描述当前进度，如：已上号，开始陪玩...',
} : {
  // 角色
  hunter:         '陪玩师',
  boss:           '老板',
  // 页面标题
  huntCenter:     '陪玩师中心',
  // 申请/切换
  applyHunter:    '申请成为陪玩师',
  applyHunterNick:'陪玩师昵称',
  switchToHunter: '陪玩师登录',
  switchToBoss:   '切换到老板模式',
  hunterWorkbench:'进入陪玩师工作台，接单与收入',
  hunterMgmt:     '订单、服务、陪玩师审核等',
  // 订单
  settle:         '结单',
  settleBtn:      '确认结单',
  settleScreenshot:'结单截图',
  settleProof:    '结单截图',
  hunterProof:    '陪玩师结单截图',
  pendingSettle:  '待结单',
  waitHunter:     '等待陪玩师接单...',
  takeOrderHint:  '接单后请尽快联系老板开始执行',
  orderInfoTitle: '老板下单信息',
  thisHunter:     '本单陪玩师',
  confirmSettle:  '确认后订单完成，将按该陪玩师当前分成比例结算入账（可提现）。',
  rejectHint:     '请说明陪玩师需如何修改',
  submittedHint:  '已提交结单，等待管理员审核通过后入账',
  // 管理
  activeHunters:  '在职陪玩师',
  noActiveHunters:'暂无在职陪玩师',
  dismissTitle:   '解雇陪玩师',
  payHunterHint:  '确认已向陪玩师微信号完成转账？',
  rulesTitle:     '老板须知',
  // 首页 slogan
  slogan:         '你的金牌护航',
  sloganTag:      '🏆 全程护航',
  // 进度 placeholder
  progressHint:   '描述当前进度，如：已上号，开始代练...',
}

module.exports = TERMS
