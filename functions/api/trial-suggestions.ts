import { isSameOriginRequest, tokensMatch, type AnalyticsEnv } from '../_lib/contactAnalytics'
import { validateSuggestion, type ReviewedSuggestion, type TrialSuggestion } from '../../src/utils/trialSuggestion'
import type { Study } from '../../src/types/trial'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Empty request')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16_384) {
        await reader.cancel()
        throw new RangeError('Request too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export const onRequest: PagesFunction<AnalyticsEnv> = async ({ request, env }) => {
  if (request.method === 'GET') {
    const authorization = request.headers.get('authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!env.ANALYTICS_ADMIN_TOKEN || !token || !tokensMatch(token, env.ANALYTICS_ADMIN_TOKEN)) {
      return json({ error: 'Unauthorized.' }, 401)
    }
    try {
      const { results } = await env.ANALYTICS_DB.prepare(`
        SELECT nct_id, categories, relevance, title, study_json, submitted_at
        FROM trial_suggestions ORDER BY submitted_at DESC LIMIT 200
      `).all<{
        nct_id: string; categories: string; relevance: string; title: string;
        study_json: string; submitted_at: string
      }>()
      return json({ suggestions: results.map((row) => ({
        nctId: row.nct_id,
        categories: JSON.parse(row.categories),
        relevance: row.relevance,
        title: row.title,
        study: JSON.parse(row.study_json),
        submittedAt: row.submitted_at,
      })) }, 200)
    } catch {
      return json({ error: 'Suggestions could not be loaded.' }, 500)
    }
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!isSameOriginRequest(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Content-Type must be application/json.' }, 415)
  }

  let body: unknown
  try {
    body = await readBody(request)
  } catch (error) {
    return json({ error: error instanceof RangeError ? 'Suggestion is too large.' : 'Invalid request body.' }, error instanceof RangeError ? 413 : 400)
  }
  let suggestion: TrialSuggestion
  try {
    suggestion = validateSuggestion(body)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid suggestion.' }, 400)
  }

  try {
    // Cloudflare supplies this header. Store only a secret-salted digest, never the IP.
    const clientIp = request.headers.get('cf-connecting-ip')
    if (clientIp) {
      if (!env.ANALYTICS_ADMIN_TOKEN) return json({ error: 'Suggestions are temporarily unavailable.' }, 503)
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.ANALYTICS_ADMIN_TOKEN}:${clientIp}`))
      const clientKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const hour = Math.floor(Date.now() / 3_600_000)
      const allowance = await env.ANALYTICS_DB.prepare(`
        INSERT INTO suggestion_rate_limits (client_key, hour, count) VALUES (?, ?, 1)
        ON CONFLICT(client_key) DO UPDATE SET
          hour = excluded.hour,
          count = CASE WHEN suggestion_rate_limits.hour = excluded.hour THEN suggestion_rate_limits.count + 1 ELSE 1 END
        WHERE suggestion_rate_limits.hour != excluded.hour OR suggestion_rate_limits.count < 5
        RETURNING count
      `).bind(clientKey, hour).first()
      if (!allowance) return json({ error: 'Too many suggestions. Please try again in an hour.' }, 429)
      await env.ANALYTICS_DB.prepare('DELETE FROM suggestion_rate_limits WHERE hour < ?').bind(hour - 24).run()
    }
    // The ID is validated above; the submitted URL is never fetched directly.
    const response = await fetch(`https://clinicaltrials.gov/api/v2/studies/${suggestion.nctId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
    })
    if (response.status === 404) return json({ error: 'This study was not found on ClinicalTrials.gov. Check the link and try again.' }, 400)
    if (!response.ok) return json({ error: 'ClinicalTrials.gov is temporarily unavailable. Please try again shortly.' }, 503)
    const { protocolSection: study } = await response.json() as Study
    if (study?.identificationModule?.nctId !== suggestion.nctId || !study.identificationModule.briefTitle) {
      return json({ error: 'The study could not be verified. Please try again shortly.' }, 503)
    }
    const details: ReviewedSuggestion['study'] = {
      status: study.statusModule?.overallStatus,
      studyType: study.designModule?.studyType,
      phases: study.designModule?.phases,
      summary: study.descriptionModule?.briefSummary,
      minimumAge: study.eligibilityModule?.minimumAge,
      maximumAge: study.eligibilityModule?.maximumAge,
      countries: [...new Set(study.contactsLocationsModule?.locations?.flatMap((location) => location.country ? [location.country] : []) ?? [])],
    }
    // One review entry per registry study also makes repeated submissions idempotent.
    await env.ANALYTICS_DB.prepare(`
      INSERT INTO trial_suggestions (nct_id, categories, relevance, title, study_json, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(nct_id) DO NOTHING
    `).bind(suggestion.nctId, JSON.stringify(suggestion.categories), suggestion.relevance,
      study.identificationModule.briefTitle, JSON.stringify(details), new Date().toISOString()).run()
    return json({ received: true }, 202)
  } catch (error) {
    console.error('Trial suggestion submission failed', error instanceof Error ? error.message : 'Unknown error')
    return json({ error: 'Your suggestion could not be saved. Please try again shortly.' }, 503)
  }
}
