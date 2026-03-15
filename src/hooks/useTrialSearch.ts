import { useState, useCallback, useRef } from 'react'
import type { Study, SearchParams } from '../types/trial'
import type { FilterResult } from '../types/trial'
import { fetchStudies } from '../utils/apiClient'
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

  // Store the current search params and next page token between loads
  const currentParamsRef = useRef<SearchParams | null>(null)
  const nextPageTokenRef = useRef<string | undefined>(undefined)
  // Track if the current search has been cancelled (new search started)
  const searchIdRef = useRef(0)

  const applyFilter = useCallback(
    (study: Study, params: SearchParams): TrialWithMeta | null => {
      const result = filterTrial(study, params.age)
      if (!result.include) return null
      return { study, filterResult: result as FilterResult & { include: true } }
    },
    []
  )

  const search = useCallback(
    async (params: SearchParams) => {
      // Increment search ID so stale responses are ignored
      const thisSearchId = ++searchIdRef.current
      currentParamsRef.current = params
      nextPageTokenRef.current = undefined

      setState({
        ...INITIAL_STATE,
        isLoading: true,
        hasSearched: true,
      })

      try {
        const data = await fetchStudies(params, undefined)

        // Bail if a newer search has started
        if (searchIdRef.current !== thisSearchId) return

        const filtered: TrialWithMeta[] = []
        for (const study of data.studies ?? []) {
          const meta = applyFilter(study, params)
          if (meta) filtered.push(meta)
        }

        nextPageTokenRef.current = data.nextPageToken

        setState({
          results: filtered,
          totalApiCount: data.totalCount ?? null,
          filteredCount: filtered.length,
          pagesLoaded: 1,
          hasMore: !!data.nextPageToken,
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
    [applyFilter]
  )

  const loadMore = useCallback(async () => {
    if (!currentParamsRef.current || !nextPageTokenRef.current) return

    const params = currentParamsRef.current
    const token = nextPageTokenRef.current
    const thisSearchId = searchIdRef.current

    setState((prev) => ({ ...prev, isLoadingMore: true, error: null }))

    try {
      const data = await fetchStudies(params, token)

      if (searchIdRef.current !== thisSearchId) return

      const newFiltered: TrialWithMeta[] = []
      for (const study of data.studies ?? []) {
        const meta = applyFilter(study, params)
        if (meta) newFiltered.push(meta)
      }

      nextPageTokenRef.current = data.nextPageToken

      setState((prev) => ({
        ...prev,
        results: [...prev.results, ...newFiltered],
        filteredCount: prev.filteredCount + newFiltered.length,
        pagesLoaded: prev.pagesLoaded + 1,
        hasMore: !!data.nextPageToken,
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
  }, [applyFilter])

  const reset = useCallback(() => {
    searchIdRef.current++
    currentParamsRef.current = null
    nextPageTokenRef.current = undefined
    setState(INITIAL_STATE)
  }, [])

  return { ...state, search, loadMore, reset }
}
