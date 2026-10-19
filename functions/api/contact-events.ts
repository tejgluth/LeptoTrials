import { readJsonBody } from '../_lib/readJsonBody'
import {
  isContactAction,
  isNctId,
  isSameOriginRequest,
  saveContactEvent,
  type AnalyticsEnv,
} from '../_lib/contactAnalytics'

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export const onRequest: PagesFunction<AnalyticsEnv> = async ({ request, env }) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!isSameOriginRequest(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Content-Type must be application/json.' }, 415)
  }

  let body: unknown
  try {
    body = await readJsonBody(request, 2_048)
  } catch (error) {
    return error instanceof RangeError
      ? json({ error: 'Request body is too large.' }, 413)
      : json({ error: 'Invalid JSON body.' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid event.' }, 400)

  const { action, nctId } = body as Record<string, unknown>
  if (!isContactAction(action) || !isNctId(nctId)) {
    return json({ error: 'Invalid event.' }, 400)
  }

  if (Object.keys(body).some(key => key !== 'action' && key !== 'nctId')) return json({ error: 'Only trial ID and action are accepted.' }, 400)
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return json({ recorded: false }, 202)

  try {
    await saveContactEvent(env.ANALYTICS_DB, { action, nctId })
    return json({ recorded: true }, 202)
  } catch {
    console.error('Failed to update trial totals')
    return json({ error: 'Event could not be recorded.' }, 500)
  }
}
