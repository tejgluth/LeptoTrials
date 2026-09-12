import {
  isContactAction,
  isEventId,
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
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Content-Type must be application/json.' }, 415)
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  if (new TextEncoder().encode(rawBody).byteLength > 2_048) {
    return json({ error: 'Request body is too large.' }, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid event.' }, 400)

  const { action, nctId, eventId } = body as Record<string, unknown>
  if (!isContactAction(action) || !isNctId(nctId) || !isEventId(eventId)) {
    return json({ error: 'Invalid event.' }, 400)
  }

  try {
    await saveContactEvent(env.ANALYTICS_DB, { action, nctId, eventId })
    return json({ recorded: true }, 202)
  } catch (error) {
    console.error('Failed to save contact event', error)
    return json({ error: 'Event could not be recorded.' }, 500)
  }
}
