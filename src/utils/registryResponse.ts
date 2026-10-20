import type { ApiResponse, Study } from '../types/trial'

const INVALID_RESPONSE = 'ClinicalTrials.gov returned an incomplete or invalid response. Please try again.'

// only checks the fields we actually need to filter and render a study
export function assertRegistryStudy(value: unknown): asserts value is Study {
  if (!value || typeof value !== 'object') throw new Error(INVALID_RESPONSE)
  const study = value as Partial<Study>
  const protocol = study.protocolSection
  if (!protocol || !/^NCT\d{8}$/.test(protocol.identificationModule?.nctId ?? '') ||
      typeof protocol.identificationModule?.briefTitle !== 'string' ||
      typeof protocol.statusModule?.overallStatus !== 'string' ||
      typeof protocol.designModule?.studyType !== 'string') {
    throw new Error(INVALID_RESPONSE)
  }
}

// a missing studies array is an error, not an empty result
export function assertRegistryPage(value: unknown): asserts value is ApiResponse {
  if (!value || typeof value !== 'object') throw new Error(INVALID_RESPONSE)
  const page = value as Partial<ApiResponse>
  if (!Array.isArray(page.studies) ||
      (page.nextPageToken !== undefined &&
       (typeof page.nextPageToken !== 'string' || page.nextPageToken.length === 0))) {
    throw new Error(INVALID_RESPONSE)
  }
  page.studies.forEach(assertRegistryStudy)
}
