import { useRef, useState } from 'react'
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
  const resultsRef = useRef<HTMLDivElement>(null)
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

  const handleSearch = (params: SearchParams) => {
    setLastSearchParams(params)
    setIsFiltersCollapsed(true)
    search(params)
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const scrollToSearch = () => {
    searchSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleToggleFilters = () => {
    const isExpanding = isFiltersCollapsed
    setIsFiltersCollapsed((v) => !v)
    if (isExpanding) {
      // Scroll the form into view so the user can reach all filter fields
      requestAnimationFrame(() => {
        const navH = window.matchMedia('(max-width: 639px)').matches ? 56 : 64
        const el = searchSectionRef.current
        if (!el) return
        const top = el.getBoundingClientRect().top + window.scrollY - navH
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      })
    }
  }

  const showResults = hasSearched && !isLoading
  const showEmpty = showResults && results.length === 0

  return (
    <div className="min-h-screen bg-[#060f1e] text-[#e8f4fd]">

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between max-[350px]:items-start max-[350px]:justify-center max-[350px]:flex-col gap-3 max-[350px]:gap-1 px-4 sm:px-8 md:px-12 lg:px-20 h-14 sm:h-16 max-[350px]:h-auto max-[350px]:py-2 border-b border-[#1a3352]/60 bg-[#060f1e]/95 backdrop-blur-sm">
        <span className="min-w-0 flex-shrink text-[0.9rem] max-[430px]:text-[clamp(0.82rem,2.9vw,0.9rem)] font-bold uppercase tracking-[0.2em] max-[430px]:tracking-[0.16em] sm:tracking-[0.25em] text-[#e8f4fd] whitespace-nowrap">
          Lepto<span className="text-[#38bdf8]">Trials</span>
        </span>
        <div className="flex items-center gap-4 sm:gap-6">
          {hasSearched && (
            <button
              type="button"
              onClick={handleToggleFilters}
              className="flex items-center gap-1.5 text-xs font-medium text-[#8ecfe8] hover:text-[#b0d8ee] transition-colors cursor-pointer min-h-[44px] px-1"
              aria-label={isFiltersCollapsed ? 'Show filters' : 'Hide filters'}
            >
              {isFiltersCollapsed ? (
                <>Filters <span className="text-[10px]">▼</span></>
              ) : (
                <>Filters <span className="text-[10px]">▲</span></>
              )}
            </button>
          )}
          <a
            href="https://clinicaltrials.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-shrink text-[0.75rem] max-[430px]:text-[clamp(0.68rem,2.45vw,0.75rem)] uppercase tracking-[0.16em] max-[430px]:tracking-[0.1em] sm:tracking-widest text-[#8ecfe8] hover:text-[#b0d8ee] transition-colors duration-200 whitespace-nowrap max-[350px]:pl-[1px]"
          >
            ClinicalTrials.gov ↗
          </a>
        </div>
      </nav>

      <Hero onSearchClick={scrollToSearch} />

      <div ref={searchSectionRef} className="bg-[#060f1e] scroll-mt-14 sm:scroll-mt-16">
        <SearchForm
          onSearch={handleSearch}
          isLoading={isLoading}
          isCollapsed={isFiltersCollapsed}
          onToggleCollapsed={handleToggleFilters}
        />
      </div>

      <div
        id="results"
        ref={resultsRef}
        className="min-h-[50vh] scroll-mt-14 sm:scroll-mt-16"
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
