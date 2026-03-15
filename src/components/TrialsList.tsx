import type { TrialWithMeta } from '../hooks/useTrialSearch'
import TrialCard from './TrialCard'

interface TrialsListProps {
  results: TrialWithMeta[]
  totalApiCount: number | null
  filteredCount: number
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  error: string | null
}

export default function TrialsList({
  results,
  totalApiCount,
  filteredCount,
  hasMore,
  isLoadingMore,
  onLoadMore,
  error,
}: TrialsListProps) {
  return (
    <section className="px-5 sm:px-8 md:px-12 lg:px-20 py-10 sm:py-12 max-w-7xl">

      {/* Results header */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 mb-3">
        <h2 className="text-2xl sm:text-3xl font-semibold text-[#e8f4fd]">
          {filteredCount} trial{filteredCount !== 1 ? 's' : ''} found
        </h2>
        {totalApiCount !== null && (
          <span className="text-sm text-[#4a7896]">
            from {totalApiCount.toLocaleString()} total in API
          </span>
        )}
      </div>

      {/* Sub-note */}
      <p className="text-sm text-[#4a7896] mb-8 sm:mb-10 leading-relaxed max-w-2xl">
        Results are filtered: exclusion criteria checked for leptomeningeal/leptomeninges,
        age eligibility applied, and inclusion terms verified.
        Trials marked{' '}
        <span className="text-[#fbbf24] font-medium">⚠ Verify eligibility</span>
        {' '}have eligibility text that wasn't structured clearly enough for our filter to read —
        they were included just in case, but open the trial on ClinicalTrials.gov to confirm you qualify before contacting them.
      </p>

      {/* Trial cards */}
      <div className="flex flex-col gap-4">
        {results.map(({ study, filterResult }, i) => (
          <TrialCard
            key={study.protocolSection.identificationModule.nctId}
            study={study}
            filterResult={filterResult}
            index={i}
          />
        ))}
      </div>

      {/* Inline error */}
      {error && (
        <div className="mt-6 border border-red-800/40 bg-red-950/20 px-5 py-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="mt-10 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-3 border border-[#1a3352] text-[#8ab8d4] hover:text-[#e8f4fd] hover:border-[#38bdf8] px-8 sm:px-10 py-4 text-base font-medium transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[52px]"
          >
            {isLoadingMore ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-[#8ab8d4] border-t-transparent rounded-full animate-spin" />
                Loading more…
              </>
            ) : (
              'Load More Trials'
            )}
          </button>
        </div>
      )}

      {/* End of results */}
      {!hasMore && results.length > 0 && (
        <p className="text-center text-sm text-[#2a5070] mt-12">
          End of results · {filteredCount} total
        </p>
      )}
    </section>
  )
}
