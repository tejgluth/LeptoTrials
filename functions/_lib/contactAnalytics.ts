export type ContactAction = 'email_click' | 'email_copy'

export interface AnalyticsEnv {
  ANALYTICS_DB: D1Database
  ANALYTICS_ADMIN_TOKEN?: string
}

interface TotalsRow {
  all_count: number
  email_clicks: number
  email_copies: number
  active_trials: number
  data_since: string | null
  last_7_days: number
  last_30_days: number
}

interface DailyRow {
  date: string
  email_clicks: number
  email_copies: number
  total: number
}

interface TrialRow {
  nct_id: string
  email_clicks: number
  email_copies: number
  total: number
  last_activity: string
}

interface RecentRow {
  action: ContactAction
  nct_id: string
  recorded_at: string
}

export function isContactAction(value: unknown): value is ContactAction {
  return value === 'email_click' || value === 'email_copy'
}

export function isNctId(value: unknown): value is string {
  return typeof value === 'string' && /^NCT\d{8}$/i.test(value)
}

export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function tokensMatch(actual: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  const compareLength = Math.max(actualBytes.length, expectedBytes.length)
  let mismatch = actualBytes.length ^ expectedBytes.length

  for (let index = 0; index < compareLength; index++) {
    mismatch |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }

  return mismatch === 0
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')

  try {
    if (origin && origin !== new URL(request.url).origin) {
      const requestHost = new URL(request.url).hostname
      const originHost = new URL(origin).hostname
      const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1'])
      if (!loopbackHosts.has(requestHost) || !loopbackHosts.has(originHost)) return false
    }
  } catch {
    return false
  }

  return request.headers.get('sec-fetch-site') !== 'cross-site'
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export async function saveContactEvent(
  db: D1Database,
  input: { action: ContactAction; nctId: string; eventId: string },
  now = new Date(),
): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO contact_events (id, nct_id, action, recorded_at, recorded_at_epoch)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    input.eventId.toLowerCase(),
    input.nctId.toUpperCase(),
    input.action,
    now.toISOString(),
    now.getTime(),
  ).run()
}

export async function getContactAnalytics(db: D1Database, now = new Date()) {
  const todayStart = startOfUtcDay(now)
  const sevenDayStart = todayStart - (6 * 86_400_000)
  const thirtyDayStart = todayStart - (29 * 86_400_000)

  const [totalsResult, dailyResult, trialsResult, recentResult] = await db.batch([
    db.prepare(`
      SELECT
        COUNT(*) AS all_count,
        COALESCE(SUM(CASE WHEN action = 'email_click' THEN 1 ELSE 0 END), 0) AS email_clicks,
        COALESCE(SUM(CASE WHEN action = 'email_copy' THEN 1 ELSE 0 END), 0) AS email_copies,
        COUNT(DISTINCT nct_id) AS active_trials,
        MIN(recorded_at) AS data_since,
        COALESCE(SUM(CASE WHEN recorded_at_epoch >= ? THEN 1 ELSE 0 END), 0) AS last_7_days,
        COALESCE(SUM(CASE WHEN recorded_at_epoch >= ? THEN 1 ELSE 0 END), 0) AS last_30_days
      FROM contact_events
    `).bind(sevenDayStart, thirtyDayStart),
    db.prepare(`
      SELECT
        substr(recorded_at, 1, 10) AS date,
        SUM(CASE WHEN action = 'email_click' THEN 1 ELSE 0 END) AS email_clicks,
        SUM(CASE WHEN action = 'email_copy' THEN 1 ELSE 0 END) AS email_copies,
        COUNT(*) AS total
      FROM contact_events
      WHERE recorded_at_epoch >= ?
      GROUP BY substr(recorded_at, 1, 10)
      ORDER BY date ASC
    `).bind(thirtyDayStart),
    db.prepare(`
      SELECT
        nct_id,
        SUM(CASE WHEN action = 'email_click' THEN 1 ELSE 0 END) AS email_clicks,
        SUM(CASE WHEN action = 'email_copy' THEN 1 ELSE 0 END) AS email_copies,
        COUNT(*) AS total,
        MAX(recorded_at) AS last_activity
      FROM contact_events
      GROUP BY nct_id
      ORDER BY total DESC, last_activity DESC
    `),
    db.prepare(`
      SELECT action, nct_id, recorded_at
      FROM contact_events
      ORDER BY recorded_at_epoch DESC
      LIMIT 20
    `),
  ])

  const totals = (totalsResult.results[0] ?? {
    all_count: 0,
    email_clicks: 0,
    email_copies: 0,
    active_trials: 0,
    data_since: null,
    last_7_days: 0,
    last_30_days: 0,
  }) as unknown as TotalsRow
  const dailyRows = dailyResult.results as unknown as DailyRow[]
  const trialRows = trialsResult.results as unknown as TrialRow[]
  const recentRows = recentResult.results as unknown as RecentRow[]
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]))
  const daily = []

  for (let offset = 29; offset >= 0; offset--) {
    const date = utcDate(new Date(todayStart - (offset * 86_400_000)))
    const row = dailyByDate.get(date)
    daily.push({
      date,
      emailClicks: numberValue(row?.email_clicks),
      emailCopies: numberValue(row?.email_copies),
      total: numberValue(row?.total),
    })
  }

  return {
    generatedAt: now.toISOString(),
    dataSince: totals.data_since,
    totals: {
      all: numberValue(totals.all_count),
      emailClicks: numberValue(totals.email_clicks),
      emailCopies: numberValue(totals.email_copies),
      activeTrials: numberValue(totals.active_trials),
      last7Days: numberValue(totals.last_7_days),
      last30Days: numberValue(totals.last_30_days),
    },
    daily,
    trials: trialRows.map((row) => ({
      nctId: row.nct_id,
      emailClicks: numberValue(row.email_clicks),
      emailCopies: numberValue(row.email_copies),
      total: numberValue(row.total),
      lastActivity: row.last_activity,
    })),
    recent: recentRows.map((row) => ({
      action: row.action,
      nctId: row.nct_id,
      recordedAt: row.recorded_at,
    })),
  }
}
