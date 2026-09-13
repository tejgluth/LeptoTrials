import { useEffect, useRef, useState } from 'react'
import { SUGGESTION_CATEGORIES, validateSuggestion, type SuggestionCategory } from '../utils/trialSuggestion'
import BrandLogo from './BrandLogo'

const inputClass = 'w-full min-w-0 rounded-md border border-[#2a5070] bg-[#0a1a2e] px-[14px] py-[12px] text-[16px] leading-normal text-[#e8f4fd] placeholder:text-[#6f9db8] focus:border-[#8ecfe8] focus:outline-none focus:ring-2 focus:ring-[#8ecfe8]/25'

export default function SuggestTrial() {
  const [trialUrl, setTrialUrl] = useState('')
  const [categories, setCategories] = useState<SuggestionCategory[]>([])
  const [relevance, setRelevance] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [received, setReceived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  const submitting = useRef(false)

  useEffect(() => {
    const title = document.title
    document.title = 'Suggest a trial · LeptoTrials'
    return () => { document.title = title }
  }, [])

  useEffect(() => {
    if (received || error) feedback.current?.focus()
  }, [received, error])

  function toggleCategory(category: SuggestionCategory) {
    setCategories((current) => category === 'UNSURE'
      ? current.includes('UNSURE') ? [] : ['UNSURE']
      : current.includes(category) ? current.filter((item) => item !== category)
        : [...current.filter((item) => item !== 'UNSURE'), category])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    setError(null)
    const payload = { trialUrl, categories, relevance }
    try {
      validateSuggestion(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form and try again.')
      return
    }
    submitting.current = true
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/trial-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25_000),
      })
      const body = await response.json() as { received?: boolean; error?: string }
      if (!response.ok || body.received !== true) throw new Error(body.error ?? 'Your suggestion could not be saved. Please try again.')
      setReceived(true)
    } catch (err) {
      setError(err instanceof Error && err.name !== 'TimeoutError' ? err.message : 'The request timed out. Please try again; duplicate suggestions are only recorded once.')
    } finally {
      submitting.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#060f1e] text-[#e8f4fd]">
      <header className="border-b border-[#1a3352] px-[20px] sm:px-[32px]">
        <nav aria-label="Main navigation" className="mx-auto flex min-h-[72px] max-w-[1100px] items-center justify-between gap-4">
          <a href="/" className="inline-block hover:opacity-85"><BrandLogo className="text-[13px] tracking-[0.18em]" /></a>
          <a href="/" className="inline-flex min-h-[44px] items-center text-[14px] text-[#8ecfe8] underline-offset-4 hover:underline">Back to trials <span className="ml-2" aria-hidden="true">↗</span></a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[800px] px-[20px] py-[clamp(28px,4vw,48px)] sm:px-[32px]">
        <div className="mb-[28px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ecfe8]">Help expand the search</p>
          <h1 className="mt-[10px] font-serif text-[clamp(36px,5vw,48px)] leading-[1.12] tracking-[-0.035em]">Suggest a trial</h1>
          <p className="mt-[12px] max-w-[620px] text-[15px] leading-relaxed text-[#b0c9dc]">Know of a study relevant to leptomeningeal disease? Share the official record and your suggested categories. We’ll review it before it appears in search.</p>
        </div>

        {received ? (
          <div ref={feedback} tabIndex={-1} role="status" className="border-t border-[#8ecfe8] py-[32px] outline-none">
            <span aria-hidden="true" className="text-4xl text-[#8ecfe8]">✓</span>
            <h2 className="mt-5 font-serif text-[clamp(26px,4vw,36px)] leading-tight">Thank you for the suggestion.</h2>
            <p className="mt-5 text-[16px] leading-relaxed text-[#b0c9dc]">The trial will be reviewed and, if it is relevant, added shortly.</p>
            <a href="/" className="mt-8 inline-flex min-h-12 items-center border-b border-[#8ecfe8] text-sm font-semibold text-[#8ecfe8]">Return to trial search <span className="ml-4" aria-hidden="true">→</span></a>
          </div>
        ) : (
          <form onSubmit={submit} className="min-w-0 border-t border-[#2a5070] pt-[24px]">
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-[24px] disabled:opacity-70">
              <div>
                <label htmlFor="trial-link" className="block text-[14px] font-semibold">ClinicalTrials.gov study link <span className="font-normal text-[#8ecfe8]">(required)</span></label>
                <p id="trial-link-help" className="mt-[6px] mb-[10px] text-[13px] leading-relaxed text-[#8daac0]">We’ll retrieve the title, status, phase, age range, and study details.</p>
                <input id="trial-link" type="url" required maxLength={2000} value={trialUrl} onChange={(event) => setTrialUrl(event.target.value)} aria-describedby="trial-link-help" placeholder="https://clinicaltrials.gov/study/NCT…" className={inputClass} />
              </div>

              <fieldset>
                <legend className="text-[14px] font-semibold">Proposed tumor categories <span className="font-normal text-[#8ecfe8]">(required)</span></legend>
                <p className="mt-[6px] text-[13px] text-[#8daac0]">Select all that apply, or choose “Not sure”.</p>
                <div className="mt-[12px] grid gap-[8px] min-[480px]:grid-cols-2">
                  {Object.entries(SUGGESTION_CATEGORIES).map(([value, label]) => (
                    <label key={value} className="flex min-h-[46px] cursor-pointer items-center gap-[10px] rounded-md border border-[#203b55] px-[12px] py-[10px] text-[14px] leading-snug text-[#c4d8e7] transition-colors hover:border-[#6f9db8] has-checked:border-[#8ecfe8] has-checked:bg-[#10283d] has-focus-visible:ring-2 has-focus-visible:ring-[#8ecfe8]">
                      <input type="checkbox" name="categories" value={value} checked={categories.includes(value as SuggestionCategory)} onChange={() => toggleCategory(value as SuggestionCategory)} className="h-[16px] w-[16px] shrink-0 accent-[#8ecfe8]" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="trial-relevance" className="block text-[14px] font-semibold">Why is this trial relevant? <span className="font-normal text-[#8ecfe8]">(required)</span></label>
                <p id="relevance-help" className="mt-[6px] mb-[10px] text-[13px] leading-relaxed text-[#8daac0]">Point to criteria or a study description that includes leptomeningeal disease. Do not include personal or patient information.</p>
                <textarea id="trial-relevance" required minLength={20} maxLength={3000} rows={4} value={relevance} onChange={(event) => setRelevance(event.target.value)} aria-describedby="relevance-help" placeholder="Describe the trial’s relevance to leptomeningeal disease…" className={`${inputClass} resize-y`} />
                <p className="mt-[4px] text-right text-[12px] text-[#8daac0]">{relevance.length.toLocaleString()} / 3,000</p>
              </div>
            </fieldset>
            {error && <div ref={feedback} tabIndex={-1} role="alert" className="mt-5 border-l-2 border-[#8ecfe8] bg-[#10243a] p-4 text-sm text-[#e8f4fd] outline-none">{error}</div>}
            <button disabled={isSubmitting} type="submit" className="mt-[20px] flex min-h-[50px] w-full items-center justify-between rounded-md bg-[#b0d8ee] px-[18px] text-[15px] font-semibold text-[#060f1e] transition-colors hover:bg-[#d3eaf7] disabled:cursor-wait disabled:opacity-60">
              {isSubmitting ? 'Verifying and submitting…' : 'Submit trial for review'}<span aria-hidden="true">→</span>
            </button>
            <p className="mt-[12px] text-[12px] leading-relaxed text-[#8daac0]">Shared with the LeptoTrials reviewer. No account or contact information required.</p>
          </form>
        )}
      </main>
    </div>
  )
}
