import { useRef, useState, useEffect } from 'react'
import Hero from './components/Hero'
import SearchForm from './components/SearchForm'
import TrialsList from './components/TrialsList'
import LoadingState from './components/LoadingState'
import EmptyState from './components/EmptyState'
import { useTrialSearch } from './hooks/useTrialSearch'
import type { SearchParams } from './types/trial'
import { DEFAULT_SEARCH_PARAMS } from './utils/apiClient'

export default function App() {
  const searchSectionRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [isHeaderSticky, setIsHeaderSticky] = useState(false)
  const [isFiltersCollapsed, setIsFiltersCollapsed] = useState(false)
  const [lastSearchParams, setLastSearchParams] = useState<SearchParams>(DEFAULT_SEARCH_PARAMS)

  const {
    results,
    filteredCount,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    hasSearched,
    search,
    loadMore,
  } = useTrialSearch()

  // Use IntersectionObserver on a 1px sentinel placed just above the form.
  // When the sentinel scrolls past the nav (top: -64px), the form is "pinned"
  // and we activate compact mode + shadow. This runs off the main thread and
  // never triggers a reflow, so there's no scroll jank.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const pinned = !entry.isIntersecting
        setIsHeaderSticky(pinned)
        // Auto-expand filters when user scrolls back to the top
        if (!pinned) setIsFiltersCollapsed(false)
      },
      // rootMargin top offset = nav height (64px); bottom opens to infinity
      // so we only care about the top edge crossing
      { rootMargin: '-64px 0px 9999px 0px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const handleSearch = (params: SearchParams) => {
    setLastSearchParams(params)
    search(params)
    // Give the loading state time to mount before scrolling into view
    requestAnimationFrame(() => {
      searchSectionRef.current?.nextElementSibling?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const scrollToSearch = () => {
    searchSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const showResults = hasSearched && !isLoading
  const showEmpty = showResults && results.length === 0

  return (
    <div className="min-h-screen bg-[#060f1e] text-[#e8f4fd]">

      {/* Fixed nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 sm:px-8 md:px-12 lg:px-20 h-16 border-b border-[#1a3352]/60 bg-[#060f1e]/95 backdrop-blur-sm">
        <span className="text-sm font-bold uppercase tracking-[0.25em] text-[#e8f4fd]">
          Lepto<span className="text-[#38bdf8]">Trials</span>
        </span>
        <a
          href="https://clinicaltrials.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs uppercase tracking-widest text-[#4a7896] hover:text-[#8ab8d4] transition-colors duration-200"
        >
          ClinicalTrials.gov ↗
        </a>
      </nav>

      {/* Hero */}
      <Hero onSearchClick={scrollToSearch} />

      {/* Sentinel — 1px element the IntersectionObserver watches.
          Placed immediately before the form so when it exits the viewport
          (past the nav), we know the form has become "pinned". */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

      {/* Search form — always sticky so the browser compositor handles it
          natively. The compact prop switches to a tighter layout once pinned. */}
      <div
        ref={searchSectionRef}
        className={`sticky top-16 bg-[#060f1e] z-40 transition-shadow duration-300 ${
          isHeaderSticky ? 'shadow-[0_1px_0_#1a3352]' : ''
        }`}
      >
        <SearchForm
          onSearch={handleSearch}
          isLoading={isLoading}
          compact={isHeaderSticky}
          isCollapsed={isFiltersCollapsed}
          onToggleCollapsed={() => setIsFiltersCollapsed((v) => !v)}
        />
      </div>

      {/* Results */}
      <div id="results" className="min-h-[50vh]">
        {isLoading && <LoadingState />}

        {showEmpty && (
          <EmptyState
            hasSearched={hasSearched}
            error={error}
            onRetry={() => handleSearch(lastSearchParams)}
          />
        )}

        {showResults && results.length > 0 && (
          <TrialsList
            results={results}
            filteredCount={filteredCount}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            error={error}
          />
        )}

        {!hasSearched && !isLoading && (
          <div className="px-5 sm:px-8 md:px-12 lg:px-20 py-24 text-center">
            <p className="text-sm text-[#2a5070]">
              Set your filters above and press Search to find eligible trials
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-24 border-t border-[#1a3352]/60 px-5 sm:px-8 md:px-12 lg:px-20 py-12">
        <div className="flex flex-col sm:flex-row flex-wrap justify-between gap-10 max-w-7xl">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#38bdf8] mb-3">
              LeptoTrials
            </p>
            <p className="text-sm text-[#4a7896] leading-relaxed max-w-xs">
              A focused clinical trial finder for leptomeningeal metastasis patients.
              Data sourced live from ClinicalTrials.gov API v2.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#2a5070] mb-3">
              Medical Disclaimer
            </p>
            <p className="text-sm text-[#4a7896] max-w-sm leading-relaxed">
              This tool is for informational purposes only and does not constitute medical advice.
              Always consult your oncologist or qualified medical professional before enrolling
              in any clinical trial.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
