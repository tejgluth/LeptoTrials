interface EmptyStateProps {
  hasSearched: boolean
  error: string | null
  onRetry?: () => void
}

export default function EmptyState({ hasSearched, error, onRetry }: EmptyStateProps) {
  if (error) {
    return (
      <section className="px-4 sm:px-8 md:px-12 lg:px-20 py-14 sm:py-20">
        <div className="max-w-lg">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400 mb-4">
            Error
          </p>
          <p className="text-base text-[#b0d8ee] leading-relaxed mb-8">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-sm font-medium text-[#b0d8ee] hover:text-[#e8f4fd] border border-[#1a3352] hover:border-[#38bdf8] px-6 py-3 transition-colors cursor-pointer min-h-[44px]"
            >
              Try again
            </button>
          )}
        </div>
      </section>
    )
  }

  if (!hasSearched) return null

  return (
    <section className="px-4 sm:px-8 md:px-12 lg:px-20 py-14 sm:py-20">
      <div className="max-w-lg">
        <div className="w-16 h-px bg-[#1a3352] mb-10" />

        <p className="text-sm font-semibold uppercase tracking-wider text-[#8ecfe8] mb-4">
          No trials found
        </p>
        <p className="text-base text-[#b0d8ee] leading-relaxed mb-8">
          No trials matched your filters after eligibility checking. Try broadening your search:
        </p>

        <ul className="space-y-3.5 mb-10">
          {[
            'Remove the age filter',
            'Select "Any" for study type',
            'Deselect specific phases to show all',
            'Change country to "Any Country"',
            'Include all recruitment statuses',
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-3 text-base text-[#8ecfe8]">
              <span className="text-[#38bdf8] flex-shrink-0 font-medium leading-6">→</span>
              {tip}
            </li>
          ))}
        </ul>

        <p className="text-sm text-[#8ecfe8] leading-relaxed border-l-2 border-[#1a3352] pl-4">
          Some trials are removed because their exclusion criteria explicitly
          exclude leptomeningeal patients — these are not appropriate for your condition
          and are not shown.
        </p>
      </div>
    </section>
  )
}
