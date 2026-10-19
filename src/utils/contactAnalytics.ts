import { contactAnalyticsAllowed } from './privacyPreferences'
import type {
  ContactAction,
  ContactAnalyticsReport,
  ContactEventPayload,
} from '../types/contactAnalytics'

const CONTACT_EVENTS_ENDPOINT = '/api/contact-events'
const CONTACT_ANALYTICS_ENDPOINT = '/api/contact-analytics'

export function trackContactAction(nctId: string, action: ContactAction): void {
  if (!contactAnalyticsAllowed()) return

  const payload: ContactEventPayload = {
    action,
    nctId,
  }

  void fetch(CONTACT_EVENTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }).catch(() => {
    // Analytics must never interrupt a patient contacting a trial.
  })
}

export async function fetchContactAnalytics(token: string): Promise<ContactAnalyticsReport> {
  const response = await fetch(CONTACT_ANALYTICS_ENDPOINT, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    credentials: 'same-origin',
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? 'Unable to load contact analytics.')
  }

  return response.json() as Promise<ContactAnalyticsReport>
}
