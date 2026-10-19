export type ContactAction = 'email_click' | 'email_copy'

export interface AnalyticsEnv {
  ANALYTICS_DB: D1Database
  ANALYTICS_ADMIN_TOKEN?: string
}

export function isContactAction(value: unknown): value is ContactAction {
  return value === 'email_click' || value === 'email_copy'
}

export function isNctId(value: unknown): value is string {
  return typeof value === 'string' && /^NCT\d{8}$/i.test(value)
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

export async function saveContactEvent(
  db: D1Database,
  input: { action: ContactAction; nctId: string },
): Promise<void> {
  await db.prepare(`
    INSERT INTO trial_contact_counts (nct_id, email_clicks, email_copies)
    VALUES (?, ?, ?)
    ON CONFLICT(nct_id) DO UPDATE SET
      email_clicks = trial_contact_counts.email_clicks + excluded.email_clicks,
      email_copies = trial_contact_counts.email_copies + excluded.email_copies
  `).bind(input.nctId.toUpperCase(), input.action === 'email_click' ? 1 : 0, input.action === 'email_copy' ? 1 : 0).run()
}

export async function getContactAnalytics(db: D1Database, now = new Date()) {
  const { results } = await db.prepare(`
    SELECT nct_id, email_clicks, email_copies FROM trial_contact_counts
    ORDER BY (email_clicks + email_copies) DESC, nct_id ASC
  `).all<{ nct_id: string; email_clicks: number; email_copies: number }>()
  const trials = results.map(row => ({
    nctId: row.nct_id,
    emailClicks: Number(row.email_clicks),
    emailCopies: Number(row.email_copies),
    total: Number(row.email_clicks) + Number(row.email_copies),
  }))
  return {
    generatedAt: now.toISOString(),
    totals: {
      all: trials.reduce((sum, trial) => sum + trial.total, 0),
      emailClicks: trials.reduce((sum, trial) => sum + trial.emailClicks, 0),
      emailCopies: trials.reduce((sum, trial) => sum + trial.emailCopies, 0),
      activeTrials: trials.length,
    },
    trials,
  }
}
