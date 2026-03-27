export default function LoadingState() {
  return (
    <section className="px-4 sm:px-8 md:px-12 lg:px-20 py-8 sm:py-12 max-w-7xl">
      <div className="flex items-center gap-3 mb-8">
        <span className="inline-block w-5 h-5 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
        <span className="text-base text-[#8ecfe8]">Searching ClinicalTrials.gov…</span>
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} delay={i * 0.08} />
        ))}
      </div>
    </section>
  )
}

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div
      className="bg-[#0c1e34] border border-[#1a3352] px-4 sm:px-8 py-5 sm:py-7"
      style={{ animationDelay: `${delay}s` }}
    >
      {/* Badge row */}
      <div className="flex gap-2 mb-5">
        <div className="h-7 w-24 bg-[#0f2240] animate-pulse rounded-sm" />
        <div className="h-7 w-16 bg-[#0d1f38] animate-pulse rounded-sm" />
        <div className="h-7 w-28 bg-[#0d1f38] animate-pulse rounded-sm" />
      </div>
      {/* Title */}
      <div className="mb-5 space-y-2.5">
        <div className="h-5 bg-[#102540] animate-pulse w-3/4" />
        <div className="h-4 bg-[#0d1f38] animate-pulse w-1/2" />
      </div>
      {/* Tags */}
      <div className="flex gap-2 mb-5">
        {[80, 100, 65, 90].map((w, i) => (
          <div key={i} className="h-6 bg-[#0d1f38] animate-pulse rounded-sm" style={{ width: `${w}px` }} />
        ))}
      </div>
      <div className="h-px bg-[#142840] mb-5" />
      {/* Summary */}
      <div className="space-y-2 mb-5">
        <div className="h-4 bg-[#0d1f38] animate-pulse w-full" />
        <div className="h-4 bg-[#0c1c36] animate-pulse w-5/6" />
        <div className="h-4 bg-[#0c1c36] animate-pulse w-4/6" />
      </div>
      <div className="h-px bg-[#142840] mb-5" />
      {/* Meta grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 bg-[#0d1f38] animate-pulse w-16" />
            <div className="h-4 bg-[#0f2240] animate-pulse w-28" />
          </div>
        ))}
      </div>
    </div>
  )
}
