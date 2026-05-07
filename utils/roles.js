const { ROUTES } = require('./constants')

const RLIST = ['boss', 'hunter', 'admin']

function normalizeRole(r) {
  const x = String(r == null ? '' : r).trim().toLowerCase()
  return RLIST.includes(x) ? x : 'boss'
}

/** 登录接口返回的 data → 规范化 roles 数组 */
function buildRolesFromAuthData(data) {
  if (!data || typeof data !== 'object') return ['boss']
  let arr = []
  if (Array.isArray(data.roles) && data.roles.length) {
    arr = data.roles.map(normalizeRole).filter(x => RLIST.includes(x))
  }
  if (!arr.length && data.role) arr = [normalizeRole(data.role)]
  arr = [...new Set(arr)]
  if (!arr.length) arr = ['boss']
  return arr
}

/** 与云端 pickStoredRole 一致：启动首页优先老板 */
function pickInitialHomePath(roles) {
  const set = new Set(roles || [])
  if (set.has('boss')) return ROUTES.BOSS_HOME
  if (set.has('hunter')) return ROUTES.HUNTER_HOME
  if (set.has('admin')) return ROUTES.ADMIN_HOME
  return ROUTES.BOSS_HOME
}

function hasRole(roles, want) {
  const w = normalizeRole(want)
  const arr = Array.isArray(roles) ? roles : []
  return arr.map(normalizeRole).includes(w)
}

module.exports = {
  RLIST,
  normalizeRole,
  buildRolesFromAuthData,
  pickInitialHomePath,
  hasRole
}
