import type { TrialWithMeta } from '../hooks/useTrialSearch'
import TrialCard from './TrialCard'

interface TrialsListProps {
  results: TrialWithMeta[]
  filteredCount: number
  error: string | null
}

export default function TrialsList({ results, filteredCount, error }: TrialsListProps) {
  return (
    <section className="px-5 sm:px-8 md:px-12 lg:px-20 py-10 sm:py-12 max-w-7xl">

      {/* Results header */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 mb-3">
        <h2 className="text-2xl sm:text-3xl font-semibold text-[#e8f4fd]">
          {filteredCount.toLocaleString()} trial{filteredCount !== 1 ? 's' : ''} found
        </h2>
      </div>

      {/* Sub-note */}
      <p className="text-sm text-[#4a7896] mb-8 sm:mb-10 leading-relaxed max-w-2xl">
        Searched by condition and across all trial text. Exclusion criteria checked against
        leptomeningeal terms, age eligibility applied. All shown trials passed eligibility filtering.
      </p>

      {/* Trial cards */}
      <div className="flex flex-col gap-4">
        {results.map(({ study }, i) => (
          <TrialCard
            key={study.protocolSection.identificationModule.nctId}
            study={study}
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

      {/* End of results */}
      {results.length > 0 && (
        <p className="text-center text-sm text-[#2a5070] mt-12">
          End of results · {filteredCount} total
        </p>
      )}
    </section>
  )
}
