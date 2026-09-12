import { useState, useCallback, useRef, useEffect } from 'react'
import type { Study, SearchParams, FilterResult } from '../types/trial'
import { fetchAllStudies } from '../utils/fetchAllStudies'
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

  const controllerRef = useRef<AbortController | null>(null)
  const searchIdRef = useRef(0)

  useEffect(() => () => {
    searchIdRef.current++
    controllerRef.current?.abort()
  }, [])

  const applyFilter = useCallback(
    (study: Study, params: SearchParams): TrialWithMeta | null => {
      if (!passesApiLevelFilters(study, params)) {
        return null
      }

      if (params.continent) {
        const allowed = CONTINENT_COUNTRIES[params.continent] ?? []
        const locations = study.protocolSection.contactsLocationsModule?.locations ?? []
        const hasMatch = locations.some((loc) => loc.country && allowed.includes(loc.country))
        if (!hasMatch) return null
      }

      const result = filterTrial(study, params.age)
      if (!result.include) return null
      if (!filterByTumorType(study, params.tumorType)) return null
      return { study, filterResult: result }
    },
    []
  )

  const mergeAndFilter = useCallback(
    (studyGroups: Study[][], params: SearchParams): TrialWithMeta[] => {
      const filtered: TrialWithMeta[] = []
      const seenIds = new Set<string>()
      for (const study of studyGroups.flat()) {
        const id = study.protocolSection.identificationModule.nctId
        if (seenIds.has(id)) continue
        seenIds.add(id)
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
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller

      setState({ ...INITIAL_STATE, isLoading: true, hasSearched: true })

      try {
        const studyGroups = await Promise.all([
          fetchAllStudies((token) => fetchCondStudies(params, token, controller.signal)),
          fetchAllStudies((token) => fetchTermStudies(params, token, controller.signal)),
          fetchSupplementalAuditedStudies(controller.signal),
        ])
        if (searchIdRef.current !== thisSearchId) return
        const allFiltered = mergeAndFilter(studyGroups, params)

        setState({
          results: allFiltered,
          filteredCount: allFiltered.length,
          isLoading: false,
          error: null,
          hasSearched: true,
        })
      } catch (err) {
        controller.abort()
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
    controllerRef.current?.abort()
    setState(INITIAL_STATE)
  }, [])

  return { ...state, search, reset }
}
