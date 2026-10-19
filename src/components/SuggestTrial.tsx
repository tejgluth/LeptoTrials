import BrandLogo from './BrandLogo'

export default function SuggestTrial() {
  return (
    <main className="mx-auto min-h-screen max-w-[800px] px-5 py-16 text-[#e8f4fd] sm:px-8">
      <a href="/" aria-label="LeptoTrials home"><BrandLogo className="text-[13px] tracking-[0.18em]" /></a>
      <h1 className="mt-12 font-serif text-[clamp(32px,5vw,48px)] leading-tight">Trial suggestions are closed</h1>
      <p className="mt-6 text-[16px] leading-relaxed text-[#b0c9dc]">To minimize data collection, LeptoTrials no longer accepts written submissions or personal information. You can still explore studies without an account.</p>
      <a href="/" className="mt-8 inline-flex min-h-11 items-center text-[#b0d8ee] underline underline-offset-4">Return to trial search</a>
      <p className="mt-6"><a href="/privacy" className="inline-flex min-h-11 items-center text-[14px] text-[#b0d8ee] underline underline-offset-4">Privacy & data collection</a></p>
    </main>
  )
}
