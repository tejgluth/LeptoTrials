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
  const resultsRef = useRef<HTMLDivElement>(null)
  const [isHeaderSticky, setIsHeaderSticky] = useState(false)
  const [isFiltersCollapsed, setIsFiltersCollapsed] = useState(false)
  const [lastSearchParams, setLastSearchParams] = useState<SearchParams>(DEFAULT_SEARCH_PARAMS)

  const {
    results,
    filteredCount,
    isLoading,
    error,
    hasSearched,
    search,
  } = useTrialSearch()

  // Use IntersectionObserver on a 1px sentinel placed just above the form.
  // When the sentinel scrolls past the nav (top: -64px), the form is "pinned"
  // and we activate compact mode + shadow. This runs off the main thread and
  // never triggers a reflow, so there's no scroll jank.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const isMobile = window.matchMedia('(max-width: 639px)').matches
    const navOffset = isMobile ? 56 : 64

    const observer = new IntersectionObserver(
      ([entry]) => {
        const pinned = !entry.isIntersecting
        setIsHeaderSticky(pinned)
      },
      // rootMargin top offset = nav height (64px); bottom opens to infinity
      // so we only care about the top edge crossing
      { rootMargin: `-${navOffset}px 0px 9999px 0px`, threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const handleSearch = (params: SearchParams) => {
    setLastSearchParams(params)
    setIsFiltersCollapsed(true)
    search(params)
    // Give the loading state time to mount before scrolling into view
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({
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
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between max-[350px]:items-start max-[350px]:justify-center max-[350px]:flex-col gap-3 max-[350px]:gap-1 px-4 sm:px-8 md:px-12 lg:px-20 h-14 sm:h-16 max-[350px]:h-auto max-[350px]:py-2 border-b border-[#1a3352]/60 bg-[#060f1e]/95 backdrop-blur-sm">
        <span className="min-w-0 flex-shrink text-[0.9rem] max-[430px]:text-[clamp(0.82rem,2.9vw,0.9rem)] font-bold uppercase tracking-[0.2em] max-[430px]:tracking-[0.16em] sm:tracking-[0.25em] text-[#e8f4fd] whitespace-nowrap">
          Lepto<span className="text-[#38bdf8]">Trials</span>
        </span>
        <a
          href="https://clinicaltrials.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-shrink text-[0.75rem] max-[430px]:text-[clamp(0.68rem,2.45vw,0.75rem)] uppercase tracking-[0.16em] max-[430px]:tracking-[0.1em] sm:tracking-widest text-[#8ecfe8] hover:text-[#b0d8ee] transition-colors duration-200 whitespace-nowrap max-[350px]:pl-[1px]"
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
        className={`bg-[#060f1e] z-40 transition-shadow duration-300 ${
          hasSearched ? 'sticky top-14 sm:top-16' : 'relative'
        } ${isHeaderSticky ? 'shadow-[0_1px_0_#1a3352]' : ''}`}
      >
        <SearchForm
          onSearch={handleSearch}
          isLoading={isLoading}
          compact={hasSearched && isHeaderSticky}
          isCollapsed={isFiltersCollapsed}
          onToggleCollapsed={() => setIsFiltersCollapsed((v) => !v)}
        />
      </div>

      {/* Results */}
      <div
        id="results"
        ref={resultsRef}
        className="min-h-[50vh] scroll-mt-[8.5rem] sm:scroll-mt-[9.5rem]"
      >
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
            error={error}
          />
        )}

        {!hasSearched && !isLoading && (
          <div className="px-5 sm:px-8 md:px-12 lg:px-20 py-20 sm:py-24 text-center">
            <p className="text-sm text-[#8ecfe8]">
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
            <p className="text-sm text-[#8ecfe8] leading-relaxed max-w-xs">
              A focused clinical trial finder for leptomeningeal metastasis patients.
              Data sourced live from ClinicalTrials.gov API v2.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8ecfe8] mb-3">
              Medical Disclaimer
            </p>
            <p className="text-sm text-[#8ecfe8] max-w-sm leading-relaxed">
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
