const IST = 'Asia/Kolkata'

function getIstDateParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: IST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
}

function daysInMonth(year, monthNum) {
  return new Date(year, monthNum, 0).getDate()
}

export function sumSettlementTotals(rows = []) {
  let commission = 0
  let tds = 0
  let gstTcs = 0
  let netPayouts = 0
  let gross = 0

  for (const row of rows) {
    commission += Number(row.commission_amount || 0)
    tds += Number(row.tds_amount || 0)
    gstTcs += Number(row.gst_tcs_amount || 0)
    netPayouts += Number(row.net_owner_amount || 0)
    gross += Number(row.gross_amount || 0)
  }

  return { commission, tds, gstTcs, netPayouts, gross }
}

/**
 * @param {number} monthsBack 0 = current IST month, 5 = six months ago
 */
export function getIstMonthRange(monthsBack = 0) {
  const today = getIstDateParts()
  let year = Number(today.year)
  let month = Number(today.month)

  month -= monthsBack
  while (month < 1) {
    month += 12
    year -= 1
  }

  const monthStr = String(month).padStart(2, '0')
  const from = `${year}-${monthStr}-01`
  const isCurrentMonth = monthsBack === 0
  const toDay = isCurrentMonth
    ? today.day
    : String(daysInMonth(year, month)).padStart(2, '0')
  const to = `${year}-${monthStr}-${toDay}`

  const labelDate = new Date(`${from}T12:00:00+05:30`)
  const label = labelDate.toLocaleDateString('en-IN', {
    timeZone: IST,
    month: 'short',
    year: 'numeric',
  })

  return { from, to, label, key: `${year}-${monthStr}` }
}

export function getLastSixIstMonthRanges() {
  return [5, 4, 3, 2, 1, 0].map((monthsBack) => getIstMonthRange(monthsBack))
}

function monthKeyFromIso(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: IST,
      year: 'numeric',
      month: '2-digit',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}`
}

export function aggregateCommissionByMonth(rows = []) {
  const bucket = {}

  for (const row of rows) {
    const key = monthKeyFromIso(row.created_at)
    if (!key) continue
    bucket[key] = (bucket[key] || 0) + Number(row.commission_amount || 0)
  }

  return Object.entries(bucket)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, commission]) => {
      const [year, month] = key.split('-')
      const labelDate = new Date(`${year}-${month}-01T12:00:00+05:30`)
      const monthLabel = labelDate.toLocaleDateString('en-IN', {
        timeZone: IST,
        month: 'short',
        year: 'numeric',
      })
      return { month: monthLabel, commission, key }
    })
}
