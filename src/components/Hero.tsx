import { useEffect, useRef } from 'react'
import gsap from 'gsap'

interface HeroProps {
  onSearchClick: () => void
}

export default function Hero({ onSearchClick }: HeroProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      tl.from('[data-hero-label]', { opacity: 0, y: 12, duration: 0.6 })
        .from('[data-hero-line]', { scaleX: 0, duration: 0.8, transformOrigin: 'left center' }, '-=0.3')
        .from('[data-hero-title-1]', { opacity: 0, y: 40, duration: 0.9 }, '-=0.5')
        .from('[data-hero-title-2]', { opacity: 0, y: 40, duration: 0.9 }, '-=0.7')
        .from('[data-hero-sub]', { opacity: 0, y: 20, duration: 0.7 }, '-=0.5')
        .from('[data-hero-meta]', { opacity: 0, y: 16, duration: 0.6, stagger: 0.1 }, '-=0.4')
        .from('[data-hero-cta]', { opacity: 0, y: 16, duration: 0.6 }, '-=0.3')
        .from('[data-hero-disclaimer]', { opacity: 0, duration: 0.5 }, '-=0.2')
    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex flex-col justify-center overflow-hidden px-5 sm:px-8 md:px-12 lg:px-20 pt-24 pb-28 sm:pb-20"
    >
      {/* Deep navy radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 75% 65% at 15% 55%, #0d2648 0%, transparent 68%)',
        }}
      />

      {/* Top-left corner accents */}
      <div className="absolute top-0 left-0 w-px h-32 sm:h-44 bg-gradient-to-b from-transparent via-[#1e5f8c] to-transparent" />
      <div className="absolute top-0 left-0 w-32 sm:w-52 h-px bg-gradient-to-r from-transparent via-[#1e5f8c] to-transparent" />

      <div className="relative max-w-5xl">

        {/* Label */}
        <p
          data-hero-label
          className="text-sm font-medium text-[#6ba3bf] mb-8 sm:mb-10 flex items-center gap-4"
        >
          <span className="inline-block w-8 h-px bg-[#1a3352]" />
          Clinical Trial Finder · Leptomeningeal Metastasis
        </p>

        {/* Horizontal rule */}
        <div
          data-hero-line
          ref={lineRef}
          className="w-full h-px bg-[#1a3352] mb-10 sm:mb-12"
        />

        {/* Main headline — Fraunces italic */}
        <h1 className="font-serif italic leading-[0.9] tracking-tight mb-10 sm:mb-12">
          <span
            data-hero-title-1
            className="block text-[clamp(3rem,8vw,7.5rem)] font-bold text-[#e8f4fd]"
          >
            Find your trial.
          </span>
          <span
            data-hero-title-2
            className="block text-[clamp(3rem,8vw,7.5rem)] font-bold text-[#38bdf8]"
          >
            Skip the complexity.
          </span>
        </h1>

        {/* Subheading */}
        <p
          data-hero-sub
          className="text-lg sm:text-xl text-[#8ab8d4] leading-relaxed max-w-2xl mb-12 sm:mb-14 font-light"
        >
          A focused search tool for leptomeningeal cancer patients. We filter
          ClinicalTrials.gov so you only see trials that can include you —
          eligibility pre-checked, no medical jargon required.
        </p>

        {/* Stats row */}
        <div className="flex flex-wrap gap-10 sm:gap-16 mb-14 sm:mb-16">
          {[
            { value: '179+', label: 'Active trials indexed' },
            { value: '3-step', label: 'Eligibility filter' },
            { value: 'Live', label: 'Real-time data' },
          ].map((stat) => (
            <div key={stat.label} data-hero-meta className="flex flex-col gap-2">
              <span className="font-serif italic text-[2rem] sm:text-[2.5rem] leading-none font-bold text-[#38bdf8]">
                {stat.value}
              </span>
              <span className="text-sm text-[#6ba3bf] font-medium">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          data-hero-cta
          onClick={onSearchClick}
          className="group inline-flex items-center gap-4 bg-[#38bdf8] text-[#060f1e] px-8 sm:px-10 py-4 text-base font-semibold hover:bg-[#7dd3fc] transition-colors duration-200 cursor-pointer min-h-[52px]"
        >
          Search Clinical Trials
          <span className="inline-block transition-transform duration-200 group-hover:translate-x-1.5 text-lg leading-none">→</span>
        </button>
      </div>

      {/* Disclaimer */}
      <p
        data-hero-disclaimer
        className="absolute bottom-7 sm:bottom-8 left-5 sm:left-8 md:left-12 lg:left-20 right-5 sm:right-8 text-sm text-[#2a5070] leading-relaxed max-w-2xl"
      >
        For informational purposes only. Always consult your oncologist or medical
        team before enrolling in any clinical trial. This tool does not provide medical advice.
      </p>

      {/* Bottom line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#1a3352] to-transparent" />
    </section>
  )
}
