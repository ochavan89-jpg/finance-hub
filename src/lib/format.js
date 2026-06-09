export function formatInr(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount))
}

export function formatCount(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Number(n))
}

export function formatMonthLabel(monthKey) {
  if (!monthKey) return 'Month to date'
  const [year, month] = monthKey.split('-')
  if (!year || !month) return 'Month to date'
  const date = new Date(Number(year), Number(month) - 1, 1)
  return `${date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} MTD`
}
