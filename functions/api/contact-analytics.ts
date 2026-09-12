import {
  getContactAnalytics,
  tokensMatch,
  type AnalyticsEnv,
} from '../_lib/contactAnalytics'

const JSON_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export const onRequest: PagesFunction<AnalyticsEnv> = async ({ request, env }) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
  if (!env.ANALYTICS_ADMIN_TOKEN) {
    console.error('ANALYTICS_ADMIN_TOKEN is not configured')
    return json({ error: 'Analytics has not been configured.' }, 503)
  }

  const authorization = request.headers.get('authorization') ?? ''
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!suppliedToken || !tokensMatch(suppliedToken, env.ANALYTICS_ADMIN_TOKEN)) {
    return json({ error: 'Invalid analytics access token.' }, 401)
  }

  try {
    return json(await getContactAnalytics(env.ANALYTICS_DB), 200)
  } catch (error) {
    console.error('Failed to load contact analytics', error)
    return json({ error: 'Analytics could not be loaded.' }, 500)
  }
}
