const { dev, order } = require('../../../utils/cloud')

function idle() { return { status: 'idle', result: '' } }

Page({
  data: {
    testOrderId: '',
    withdrawId: '',
    rechargeId: '',
    clearing: false,
    logs: [],
    s_seedHunters:       idle(),
    s_clearWallet:       idle(),
    s_setCoHunter:       idle(),
    s_deleteHunters:     idle(),
    s_grantRoles:        idle(),
    s_injectBalance:     idle(),
    s_createOrder:       idle(),
    s_takeOrder:         idle(),
    s_submitSettlement:  idle(),
    s_confirmSettlement: idle(),
    s_requestWithdraw:   idle(),
    s_payWithdraw:       idle(),
    s_requestRecharge:   idle(),
    s_approveRecharge:   idle()
  },

  // ── logging ──

  _ts() {
    const n = new Date()
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`
  },

  _log(msg, type = 'info') {
    const entry = { id: Date.now() + '_' + Math.random(), time: this._ts(), msg: String(msg), type }
    const logs = [entry, ...this.data.logs].slice(0, 200)
    this.setData({ logs })
    console.log(`[devtest][${type}] ${msg}`)
  },

  clearLog() {
    this.setData({ logs: [] })
  },

  // ── step runner ──

  _setStep(key, status, result) {
    this.setData({ [`s_${key}`]: { status, result: result || '' } })
  },

  async _run(key, label, fn) {
    this._log(`▶ ${label} — 开始`, 'info')
    this._setStep(key, 'running', '')
    try {
      const result = await fn()
      this._setStep(key, 'ok', result)
      this._log(`✓ ${label} — ${result}`, 'ok')
    } catch (err) {
      const msg = err.message || String(err) || '操作失败'
      this._setStep(key, 'err', msg)
      this._log(`✗ ${label} — ${msg}`, 'err')
    }
  },

  // ── step handlers ──

  async runSeedHunters() {
    await this._run('seedHunters', '生成模拟打手', async () => {
      const d = await dev.seedMockHunters()
      return (d.results || []).join(' · ')
    })
  },

  async runDeleteHunters() {
    wx.showModal({
      title: '删除模拟打手',
      content: '确认删除这 4 个假打手账号？',
      confirmColor: '#FF4D4D',
      success: async r => {
        if (!r.confirm) return
        await this._run('deleteHunters', '删除模拟打手', async () => {
          const d = await dev.deleteMockHunters()
          return `已删除 ${d.deleted} 条`
        })
      }
    })
  },

  async runGrantRoles() {
    await this._run('grantRoles', '三身份授权', async () => {
      const d = await dev.grantTripleRoles()
      return `已写入 boss + hunter + admin`
    })
  },

  async runInjectBalance() {
    await this._run('injectBalance', '注入测试余额', async () => {
      const d = await dev.directCredit({ amount_fen: 50000 })
      return `balance_fen = ${d.balance_fen}（${(d.balance_fen / 100).toFixed(0)} 总裁贝）`
    })
  },

  async runCreateOrder() {
    await this._run('createOrder', '创建测试订单', async () => {
      const res = await dev.createTestOrder()
      if (!res || res.code !== 0) throw new Error(res?.msg || '云函数返回错误')
      const { _id, order_no } = res.data
      this._log(`  orderId = ${_id}`, 'detail')
      this.setData({ testOrderId: _id })
      return `${order_no}（ID: ${_id.slice(-8)}）`
    })
  },

  async runTakeOrder() {
    const orderId = this.data.testOrderId
    if (!orderId) { this._log('✗ 打手接单 — 未找到 testOrderId，请先执行步骤③', 'err'); return }
    await this._run('takeOrder', '打手接单', async () => {
      await dev.takeOrder({ orderId })
      return `status → in_progress（orderId: ${orderId.slice(-8)}）`
    })
  },

  async runSubmitSettlement() {
    const orderId = this.data.testOrderId
    if (!orderId) { this._log('✗ 提交结单 — 未找到 testOrderId，请先执行步骤③', 'err'); return }
    await this._run('submitSettlement', '提交结单', async () => {
      await dev.submitSettlement({ orderId })
      return `status → pending_settlement`
    })
  },

  async runConfirmSettlement() {
    const orderId = this.data.testOrderId
    if (!orderId) { this._log('✗ 确认结单 — 未找到 testOrderId，请先执行步骤③', 'err'); return }
    await this._run('confirmSettlement', '管理员确认结单', async () => {
      const d = await dev.confirmSettlement({ orderId })
      const earn = d.hunter_earn_fen != null
        ? `hunter_earn_fen = ${d.hunter_earn_fen}（${(d.hunter_earn_fen / 100).toFixed(2)} 元，${d.settlement_share_percent}%）`
        : 'completed'
      return earn
    })
  },

  async runRequestWithdraw() {
    await this._run('requestWithdraw', '申请提现', async () => {
      const d = await dev.requestWithdraw({ amount_fen: 100, wechat_id: 'devtest_wechat' })
      const id = d && d._id
      if (id) {
        this.setData({ withdrawId: id })
        this._log(`  withdrawId = ${id}`, 'detail')
      }
      return `提现 100 分 / 1 元，ID: ${id ? id.slice(-8) : '?'}`
    })
  },

  async runPayWithdraw() {
    await this._run('payWithdraw', '管理员标记已打款', async () => {
      const list = await dev.listPendingWithdraws()
      const pending = (list || []).filter(w => w.status === 'pending')
      if (!pending.length) return '暂无待打款申请'
      this._log(`  待打款 ${pending.length} 笔: ${pending.map(w => w._id.slice(-6)).join(', ')}`, 'detail')
      const ids = pending.map(w => w._id)
      await dev.batchPayWithdraw({ withdrawIds: ids, decision: 'paid' })
      return `已标记 ${ids.length} 笔已打款`
    })
  },

  async runRequestRecharge() {
    await this._run('requestRecharge', '申请充值', async () => {
      const d = await dev.requestRecharge({ amount_fen: 1000 })
      const id = d && d._id
      if (id) {
        this.setData({ rechargeId: id })
        this._log(`  rechargeId = ${id}`, 'detail')
      }
      return `充值申请 1000 分（10 总裁贝），ID: ${id ? id.slice(-8) : '?'}`
    })
  },

  async runApproveRecharge() {
    const rechargeId = this.data.rechargeId
    if (!rechargeId) { this._log('✗ 审核充值 — 未找到 rechargeId，请先执行步骤⑨', 'err'); return }
    await this._run('approveRecharge', '管理员审核充值', async () => {
      await dev.approveRecharge({ rechargeId, decision: 'approved' })
      return '充值已批准，余额 +10 总裁贝'
    })
  },

  // ── session cleanup (only delete records created this run) ──

  async runCleanup() {
    const { testOrderId, withdrawId, rechargeId } = this.data
    if (!testOrderId && !withdrawId && !rechargeId) {
      wx.showToast({ title: '本次测试无数据可清理', icon: 'none' })
      return
    }
    const items = [
      testOrderId && `测试订单 …${testOrderId.slice(-6)}`,
      withdrawId  && `提现记录 …${withdrawId.slice(-6)}`,
      rechargeId  && `充值申请 …${rechargeId.slice(-6)}`
    ].filter(Boolean).join('、')

    wx.showModal({
      title: '清理本次测试数据',
      content: `将删除：${items}`,
      confirmColor: '#FF4D4D',
      success: async r => {
        if (!r.confirm) return
        this.setData({ clearing: true })
        this._log('▶ 开始清理本次测试数据', 'info')
        let cleaned = 0
        const errs = []

        if (testOrderId) {
          try {
            await order.adminRemoveOrder(testOrderId)
            this._log(`✓ 订单 ${testOrderId.slice(-8)} 已软删除`, 'ok')
            cleaned++
          } catch (e) { errs.push(`订单: ${e.message}`); this._log(`✗ 订单删除失败: ${e.message}`, 'err') }
        }
        if (withdrawId) {
          try {
            await dev.deleteRecord({ id: withdrawId, collection: 'withdrawals' })
            this._log(`✓ 提现记录 ${withdrawId.slice(-8)} 已删除`, 'ok')
            cleaned++
          } catch (e) { errs.push(`提现: ${e.message}`); this._log(`✗ 提现删除失败: ${e.message}`, 'err') }
        }
        if (rechargeId) {
          try {
            await dev.deleteRecord({ id: rechargeId, collection: 'recharges' })
            this._log(`✓ 充值记录 ${rechargeId.slice(-8)} 已删除`, 'ok')
            cleaned++
          } catch (e) { errs.push(`充值: ${e.message}`); this._log(`✗ 充值删除失败: ${e.message}`, 'err') }
        }

        this.setData({ clearing: false, testOrderId: '', withdrawId: '', rechargeId: '' })
        const msg = errs.length ? `完成 ${cleaned} 项，失败: ${errs.join('; ')}` : `已清理 ${cleaned} 项`
        this._log(msg, errs.length ? 'err' : 'ok')
        wx.showToast({ title: msg, icon: errs.length ? 'none' : 'success', duration: 2500 })
      }
    })
  },

  async runClearWallet() {
    wx.showModal({
      title: '清零所有流水',
      content: '将删除全部充值/提现记录，并把所有用户余额归零，不可恢复！',
      confirmText: '确认清零',
      confirmColor: '#FF4D4D',
      success: async r => {
        if (!r.confirm) return
        await this._run('clearWallet', '清零所有流水', async () => {
          const d = await dev.clearAllWallet()
          return `充值 ${d.recharges} 条，提现 ${d.withdrawals} 条，用户 ${d.usersReset} 个余额归零`
        })
      }
    })
  },

  async runSetAllCoHunter(e) {
    const value = e.currentTarget.dataset.value
    const label = value ? '双打' : '单打'
    wx.showModal({
      title: `全部设为${label}`,
      content: `确定将所有服务 needs_co_hunter 设为 ${value ? 'true' : 'false'}？`,
      success: async r => {
        if (!r.confirm) return
        await this._run('setCoHunter', `批量设为${label}`, async () => {
          const { service } = require('../../../utils/cloud')
          const d = await service.setAllCoHunter({ value })
          return `已更新 ${d.updated} 个服务`
        })
      }
    })
  },

  async runNukeAll() {
    wx.showModal({
      title: '⚠️ 清空全部测试数据',
      content: '将删除所有订单、order_logs、充值、提现记录，不可恢复！',
      confirmText: '确认清空',
      confirmColor: '#FF4D4D',
      success: async r => {
        if (!r.confirm) return
        this.setData({ clearing: true })
        this._log('▶ 开始清空所有测试数据…', 'info')
        wx.showLoading({ title: '清空中…' })
        try {
          const [o, w] = await Promise.all([
            dev.clearAllOrders(),
            dev.clearAllWallet()
          ])
          wx.hideLoading()
          const msg = `订单 ${o.deleted}条 + logs ${o.logDeleted}条，充值 ${w.recharges}条，提现 ${w.withdrawals}条`
          this._log(`✓ 清空完成：${msg}`, 'ok')
          this.setData({ testOrderId: '', withdrawId: '', rechargeId: '' })
          wx.showToast({ title: '清空完成', icon: 'success' })
        } catch (e) {
          wx.hideLoading()
          this._log(`✗ 清空失败: ${e.message}`, 'err')
          wx.showToast({ title: e.message || '清空失败', icon: 'none' })
        } finally {
          this.setData({ clearing: false })
        }
      }
    })
  }
})
