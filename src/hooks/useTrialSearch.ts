import { useState, useCallback, useRef } from 'react'
import type { Study, SearchParams } from '../types/trial'
import type { FilterResult } from '../types/trial'
import { fetchCondStudies, fetchTermStudies } from '../utils/apiClient'
import { filterTrial } from '../utils/trialFilter'

export interface TrialWithMeta {
  study: Study
  filterResult: FilterResult & { include: true }
}

export interface SearchState {
  results: TrialWithMeta[]
  totalApiCount: number | null
  filteredCount: number
  pagesLoaded: number
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  hasSearched: boolean
}

export interface UseTrialSearchReturn extends SearchState {
  search: (params: SearchParams) => Promise<void>
  loadMore: () => Promise<void>
  reset: () => void
}

const INITIAL_STATE: SearchState = {
  results: [],
  totalApiCount: null,
  filteredCount: 0,
  pagesLoaded: 0,
  hasMore: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasSearched: false,
}

export function useTrialSearch(): UseTrialSearchReturn {
  const [state, setState] = useState<SearchState>(INITIAL_STATE)

  const currentParamsRef = useRef<SearchParams | null>(null)
  // Track page tokens for both queries independently
  const condTokenRef = useRef<string | undefined>(undefined)
  const termTokenRef = useRef<string | undefined>(undefined)
  // Deduplicate across both queries and across paginated loads
  const seenIdsRef = useRef<Set<string>>(new Set())
  const searchIdRef = useRef(0)

  const applyFilter = useCallback(
    (study: Study, params: SearchParams): TrialWithMeta | null => {
      const result = filterTrial(study, params.age)
      if (!result.include) return null
      return { study, filterResult: result as FilterResult & { include: true } }
    },
    []
  )

  /**
   * Merges studies from two API responses, deduplicating by NCT ID against
   * the global seenIds set, then runs the eligibility filter on each new study.
   */
  const mergeAndFilter = useCallback(
    (
      condStudies: Study[],
      termStudies: Study[],
      params: SearchParams
    ): TrialWithMeta[] => {
      const filtered: TrialWithMeta[] = []
      for (const study of [...condStudies, ...termStudies]) {
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
      currentParamsRef.current = params
      condTokenRef.current = undefined
      termTokenRef.current = undefined
      seenIdsRef.current = new Set()

      setState({ ...INITIAL_STATE, isLoading: true, hasSearched: true })

      try {
        // Fire both queries in parallel — cond catches synonym-matched condition
        // terms; term catches any trial mentioning "leptomeningeal" in any field
        // (eligibility criteria, summaries, titles, etc.)
        const [condData, termData] = await Promise.all([
          fetchCondStudies(params, undefined),
          fetchTermStudies(params, undefined),
        ])

        if (searchIdRef.current !== thisSearchId) return

        condTokenRef.current = condData.nextPageToken
        termTokenRef.current = termData.nextPageToken

        const filtered = mergeAndFilter(
          condData.studies ?? [],
          termData.studies ?? [],
          params
        )

        setState({
          results: filtered,
          totalApiCount: null, // Not meaningful across two deduplicated queries
          filteredCount: filtered.length,
          pagesLoaded: 1,
          hasMore: !!(condData.nextPageToken || termData.nextPageToken),
          isLoading: false,
          isLoadingMore: false,
          error: null,
          hasSearched: true,
        })
      } catch (err) {
        if (searchIdRef.current !== thisSearchId) return
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to fetch trials. Please try again.',
        }))
      }
    },
    [mergeAndFilter]
  )

  const loadMore = useCallback(async () => {
    if (!currentParamsRef.current) return
    if (!condTokenRef.current && !termTokenRef.current) return

    const params = currentParamsRef.current
    const thisSearchId = searchIdRef.current

    setState((prev) => ({ ...prev, isLoadingMore: true, error: null }))

    try {
      // Only fetch from queries that still have more pages
      const pending: Array<'cond' | 'term'> = []
      const fetches: Promise<import('../types/trial').ApiResponse>[] = []

      if (condTokenRef.current) {
        pending.push('cond')
        fetches.push(fetchCondStudies(params, condTokenRef.current))
      }
      if (termTokenRef.current) {
        pending.push('term')
        fetches.push(fetchTermStudies(params, termTokenRef.current))
      }

      // allSettled so a single query failure doesn't block the other
      const settled = await Promise.allSettled(fetches)
      if (searchIdRef.current !== thisSearchId) return

      let condStudies: Study[] = []
      let termStudies: Study[] = []

      settled.forEach((result, i) => {
        if (result.status !== 'fulfilled') return
        const data = result.value
        if (pending[i] === 'cond') {
          condTokenRef.current = data.nextPageToken
          condStudies = data.studies ?? []
        } else {
          termTokenRef.current = data.nextPageToken
          termStudies = data.studies ?? []
        }
      })

      const newFiltered = mergeAndFilter(condStudies, termStudies, params)

      setState((prev) => ({
        ...prev,
        results: [...prev.results, ...newFiltered],
        filteredCount: prev.filteredCount + newFiltered.length,
        pagesLoaded: prev.pagesLoaded + 1,
        hasMore: !!(condTokenRef.current || termTokenRef.current),
        isLoadingMore: false,
      }))
    } catch (err) {
      if (searchIdRef.current !== thisSearchId) return
      setState((prev) => ({
        ...prev,
        isLoadingMore: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to load more trials. Please try again.',
      }))
    }
  }, [mergeAndFilter])

  const reset = useCallback(() => {
    searchIdRef.current++
    currentParamsRef.current = null
    condTokenRef.current = undefined
    termTokenRef.current = undefined
    seenIdsRef.current = new Set()
    setState(INITIAL_STATE)
  }, [])

  return { ...state, search, loadMore, reset }
}
