import type { ApiResponse, Study } from '../types/trial'
import { assertRegistryPage } from './registryResponse'

const MAX_PAGES = 20

/** Fail explicitly if the registry cannot return a complete search. */
export async function fetchAllStudies(
  fetchPage: (pageToken?: string) => Promise<ApiResponse>,
): Promise<Study[]> {
  const studies: Study[] = []
  const seenTokens = new Set<string>()
  let token: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchPage(token)
    assertRegistryPage(response)
    studies.push(...response.studies)
    token = response.nextPageToken
    if (!token) return studies
    if (seenTokens.has(token)) {
      throw new Error('ClinicalTrials.gov returned a repeated page. Please try again.')
    }
    seenTokens.add(token)
  }

  throw new Error('The search exceeded the page limit. Please narrow your filters and try again.')
}
