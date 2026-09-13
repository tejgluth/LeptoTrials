export const SUGGESTION_CATEGORIES = {
  LUNG: 'Lung cancer',
  BREAST: 'Breast cancer',
  MELANOMA: 'Melanoma',
  GBM: 'Glioblastoma / high-grade glioma',
  OTHER_SOLID: 'Other solid tumors',
  UNSURE: 'Not sure / another category',
} as const

export type SuggestionCategory = keyof typeof SUGGESTION_CATEGORIES

export interface TrialSuggestion {
  nctId: string
  categories: SuggestionCategory[]
  relevance: string
}

export interface ReviewedSuggestion extends TrialSuggestion {
  title: string
  submittedAt: string
  study: {
    status?: string
    studyType?: string
    phases?: string[]
    summary?: string
    minimumAge?: string
    maximumAge?: string
    countries: string[]
  }
}

/** Accept registry study links, never arbitrary URLs for a server-side fetch. */
export function parseTrialLink(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || !['clinicaltrials.gov', 'www.clinicaltrials.gov'].includes(url.hostname)) return null
    if (url.username || url.password || url.port) return null
    return url.pathname.match(/^\/(?:study|ct2\/show)\/(NCT\d{8})\/?$/i)?.[1].toUpperCase() ?? null
  } catch {
    return null
  }
}

export function validateSuggestion(body: unknown): TrialSuggestion {
  if (!body || typeof body !== 'object') throw new Error('Please complete the suggestion form.')
  const { trialUrl, categories, relevance } = body as Record<string, unknown>
  const nctId = typeof trialUrl === 'string' && trialUrl.length <= 2_000 ? parseTrialLink(trialUrl) : null
  if (!nctId) throw new Error('Enter an official https://clinicaltrials.gov/study/NCT… link.')
  if (!Array.isArray(categories) || categories.length === 0 || categories.length > 6 ||
    categories.some((category) => typeof category !== 'string' || !Object.hasOwn(SUGGESTION_CATEGORIES, category))) {
    throw new Error('Select at least one tumor category, or choose “Not sure”.')
  }
  if (categories.includes('UNSURE') && categories.length > 1) {
    throw new Error('Choose specific categories or “Not sure”, not both.')
  }
  if (typeof relevance !== 'string' || relevance.trim().length < 20 || relevance.trim().length > 3_000) {
    throw new Error('Explain the trial’s relevance in 20–3,000 characters.')
  }
  return { nctId, categories: [...new Set(categories)] as SuggestionCategory[], relevance: relevance.trim() }
}
