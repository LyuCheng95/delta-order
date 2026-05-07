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

module.exports = { buildFormRows }
