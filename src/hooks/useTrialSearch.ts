import { useState, useCallback, useRef } from 'react'
import type { Study, SearchParams, ApiResponse } from '../types/trial'
import type { FilterResult } from '../types/trial'
import {
  fetchCondStudies,
  fetchSupplementalAuditedStudies,
  fetchTermStudies,
} from '../utils/apiClient'
import { filterTrial, filterByTumorType } from '../utils/trialFilter'
import { CONTINENT_COUNTRIES } from '../constants/countries'

export interface TrialWithMeta {
  study: Study
  filterResult: FilterResult & { include: true }
}

export interface SearchState {
  results: TrialWithMeta[]
  filteredCount: number
  isLoading: boolean
  error: string | null
  hasSearched: boolean
}

export interface UseTrialSearchReturn extends SearchState {
  search: (params: SearchParams) => Promise<void>
  reset: () => void
}

const INITIAL_STATE: SearchState = {
  results: [],
  filteredCount: 0,
  isLoading: false,
  error: null,
  hasSearched: false,
}

// Maximum pages to fetch per search (safety cap — 20 pages × 20/page = 400 trials max)
const MAX_PAGES = 20

function passesApiLevelFilters(study: Study, params: SearchParams): boolean {
  const proto = study.protocolSection

  if (params.statuses.length > 0) {
    const status = proto.statusModule.overallStatus
    if (!params.statuses.includes(status)) return false
  }

  if (params.studyType !== 'any' && proto.designModule.studyType !== params.studyType) {
    return false
  }

  if (params.phases.length > 0) {
    const studyPhases = proto.designModule.phases ?? []
    const hasPhaseMatch = studyPhases.some((phase) => params.phases.includes(phase as typeof params.phases[number]))
    if (!hasPhaseMatch) return false
  }

  if (params.country) {
    const locations = proto.contactsLocationsModule?.locations ?? []
    if (!locations.some((loc) => loc.country === params.country)) return false
  }

  return true
}

export function useTrialSearch(): UseTrialSearchReturn {
  const [state, setState] = useState<SearchState>(INITIAL_STATE)

  const seenIdsRef = useRef<Set<string>>(new Set())
  const searchIdRef = useRef(0)

  const applyFilter = useCallback(
    (study: Study, params: SearchParams): TrialWithMeta | null => {
      if (!passesApiLevelFilters(study, params)) {
        return null
      }

      // Continent client-side filter: check if the study has at least one
      // location in the requested continent's country list.
      if (params.continent) {
        const allowed = CONTINENT_COUNTRIES[params.continent] ?? []
        const locations = study.protocolSection.contactsLocationsModule?.locations ?? []
        const hasMatch = locations.some((loc) => loc.country && allowed.includes(loc.country))
        if (!hasMatch) return null
      }

      const result = filterTrial(study, params.age)
      if (!result.include) return null
      if (!filterByTumorType(study, params.tumorType)) return null
      return { study, filterResult: result as FilterResult & { include: true } }
    },
    []
  )

  /**
   * Merges studies from two API responses, deduplicating by NCT ID against
   * the global seenIds set, then runs the eligibility filter on each new study.
   */
  const mergeAndFilter = useCallback(
    (studyGroups: Study[][], params: SearchParams): TrialWithMeta[] => {
      const filtered: TrialWithMeta[] = []
      for (const study of studyGroups.flat()) {
        const id = study.protocolSection.identificationModule.nctId
        if (seenIdsRef.current.has(id)) continue
        seenIdsRef.current.add(id)
        const meta = applyFilter(study, params)
        if (meta) filtered.push(meta)
      }
      return filtered
    },
    [applyFilter]
  )

  const search = useCallback(
    async (params: SearchParams) => {
      const thisSearchId = ++searchIdRef.current
      seenIdsRef.current = new Set()

      setState({ ...INITIAL_STATE, isLoading: true, hasSearched: true })

      try {
        const allFiltered: TrialWithMeta[] = []
        let condToken: string | undefined = undefined
        let termToken: string | undefined = undefined

        // Page 1: fire both queries in parallel
        const [condData, termData, supplementalStudies] = await Promise.all([
          fetchCondStudies(params, undefined),
          fetchTermStudies(params, undefined),
          fetchSupplementalAuditedStudies(),
        ])
        if (searchIdRef.current !== thisSearchId) return

        condToken = condData.nextPageToken
        termToken = termData.nextPageToken
        allFiltered.push(
          ...mergeAndFilter(
            [condData.studies ?? [], termData.studies ?? [], supplementalStudies],
            params
          )
        )

        // Remaining pages: keep fetching in parallel until both queries are exhausted
        for (let page = 1; page < MAX_PAGES; page++) {
          if (!condToken && !termToken) break

          const fetches: Promise<ApiResponse>[] = []
          const pending: Array<'cond' | 'term'> = []
          if (condToken) { pending.push('cond'); fetches.push(fetchCondStudies(params, condToken)) }
          if (termToken) { pending.push('term'); fetches.push(fetchTermStudies(params, termToken)) }

          const settled = await Promise.allSettled(fetches)
          if (searchIdRef.current !== thisSearchId) return

          let condStudies: Study[] = []
          let termStudies: Study[] = []
          settled.forEach((r, i) => {
            if (r.status !== 'fulfilled') return
            if (pending[i] === 'cond') { condToken = r.value.nextPageToken; condStudies = r.value.studies ?? [] }
            else { termToken = r.value.nextPageToken; termStudies = r.value.studies ?? [] }
          })

          allFiltered.push(...mergeAndFilter([condStudies, termStudies], params))
        }

        setState({
          results: allFiltered,
          filteredCount: allFiltered.length,
          isLoading: false,
          error: null,
          hasSearched: true,
        })
      } catch (err) {
        if (searchIdRef.current !== thisSearchId) return
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch trials. Please try again.',
        }))
      }
    },
    [mergeAndFilter]
  )

  const reset = useCallback(() => {
    searchIdRef.current++
    seenIdsRef.current = new Set()
    setState(INITIAL_STATE)
  }, [])

  return { ...state, search, reset }
}
