/**
 * 将订单的 form_data（键值对）与 service_snapshot.form_fields（字段定义）
 * 合并成可直接渲染的行数组：[{ key, label, value }]
 */
function buildFormRows(order) {
  const fields = (order.service_snapshot && order.service_snapshot.form_fields) || []
  const data   = order.form_data || {}

  if (fields.length) {
    return fields.map(f => ({
      key:   f.key,
      label: f.label || f.key,
      value: data[f.key] != null ? String(data[f.key]) : '—'
    }))
  }

  // 没有字段定义时，直接把 form_data 的 key/value 铺开
  return Object.keys(data).map(k => ({
    key:   k,
    label: k,
    value: String(data[k])
  }))
}

/**
 * 短摘要：服务名 + 第一个 form_data 值，供大厅列表卡片展示
 */
function formatBossBrief(order) {
  var snap = order.service_snapshot || {}
  var name = snap.service_name || ''
  var data = order.form_data || {}
  var keys = Object.keys(data)
  var first = keys.length ? String(data[keys[0]]) : ''
  return first ? name + ' · ' + first : name
}

module.exports = { buildFormRows, formatBossBrief }
