import { useRef, useState, useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Hero from './components/Hero'
import SearchForm from './components/SearchForm'
import TrialsList from './components/TrialsList'
import LoadingState from './components/LoadingState'
import EmptyState from './components/EmptyState'
import { useTrialSearch } from './hooks/useTrialSearch'
import type { SearchParams } from './types/trial'
import { DEFAULT_SEARCH_PARAMS } from './utils/apiClient'

gsap.registerPlugin(ScrollTrigger)

export default function App() {
  const searchSectionRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [isHeaderSticky, setIsHeaderSticky] = useState(false)
  const [lastSearchParams, setLastSearchParams] = useState<SearchParams>(DEFAULT_SEARCH_PARAMS)

  const {
    results,
    totalApiCount,
    filteredCount,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    hasSearched,
    search,
    loadMore,
  } = useTrialSearch()

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const trigger = ScrollTrigger.create({
      trigger: searchSectionRef.current,
      start: 'top top',
      onEnter: () => {
        setIsHeaderSticky(true)
        if (!prefersReduced && headerRef.current) {
          gsap.fromTo(
            headerRef.current,
            { y: -10, opacity: 0.8 },
            { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }
          )
        }
      },
      onLeaveBack: () => setIsHeaderSticky(false),
    })

    return () => trigger.kill()
  }, [])

  const handleSearch = (params: SearchParams) => {
    setLastSearchParams(params)
    search(params)
    setTimeout(() => {
      searchSectionRef.current?.nextElementSibling?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 100)
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

      {/* Search form */}
      <div
        ref={searchSectionRef}
        className={`bg-[#060f1e] z-40 transition-[box-shadow] duration-300 ${
          isHeaderSticky ? 'sticky top-16 shadow-[0_1px_0_#1a3352]' : ''
        }`}
      >
        <div ref={headerRef}>
          <SearchForm onSearch={handleSearch} isLoading={isLoading} compact={isHeaderSticky} />
        </div>
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
            totalApiCount={totalApiCount}
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
