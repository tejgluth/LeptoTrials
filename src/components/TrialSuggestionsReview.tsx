import { useState } from 'react'
import { SUGGESTION_CATEGORIES, type ReviewedSuggestion } from '../utils/trialSuggestion'
import { getTrialUrl } from '../utils/apiClient'

export default function TrialSuggestionsReview({ token }: { token: string }) {
  const [suggestions, setSuggestions] = useState<ReviewedSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/trial-suggestions', {
        headers: { Authorization: `Bearer ${token.trim()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error('Suggestions could not be loaded. Please try again.')
      const body = await response.json() as { suggestions: ReviewedSuggestion[] }
      setSuggestions(body.suggestions)
    } catch (err) {
      setSuggestions(null)
      setError(err instanceof Error ? err.message : 'Unable to load suggestions.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="border-t border-[#2a5070] py-10" aria-labelledby="suggestions-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="suggestions-heading" className="text-2xl font-semibold">Suggested trials</h2>
        <button onClick={() => void load()} disabled={loading} className="min-h-11 border border-[#2a5070] px-4 text-sm text-[#b0d8ee] hover:border-[#8ecfe8] disabled:opacity-50">{loading ? 'Loading…' : suggestions ? 'Refresh suggestions' : 'Load suggestions'}</button>
      </div>
      <p className="mt-3 text-sm text-[#8daac0]">Latest 200 submissions. Proposed classifications need manual review before updating trial search.</p>
      {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
      {suggestions?.length === 0 && <p role="status" className="mt-6 text-sm text-[#8daac0]">No trial suggestions yet.</p>}
      {suggestions?.map((suggestion) => (
        <article key={suggestion.nctId} className="mt-7 border-t border-[#1a3352] pt-6">
          <p className="text-xs text-[#8daac0]">{new Date(suggestion.submittedAt).toLocaleDateString()}</p>
          <h3 className="mt-2 text-lg font-semibold">{suggestion.title}</h3>
          <a className="text-sm text-[#8ecfe8] underline" href={getTrialUrl(suggestion.nctId)} target="_blank" rel="noopener noreferrer">{suggestion.nctId} ↗</a>
          <p className="mt-3 text-sm text-[#b0c9dc]">Proposed: {suggestion.categories.map((category) => SUGGESTION_CATEGORIES[category]).join(', ')}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{suggestion.relevance}</p>
          <details className="mt-4 text-sm text-[#8daac0]">
            <summary className="cursor-pointer py-2 text-[#8ecfe8]">Official study details at submission</summary>
            <p className="mt-2">{[suggestion.study.status, suggestion.study.studyType, ...(suggestion.study.phases ?? [])].filter(Boolean).join(' · ')}</p>
            <p className="mt-2">Ages: {suggestion.study.minimumAge ?? 'Not specified'} – {suggestion.study.maximumAge ?? 'Not specified'}</p>
            <p className="mt-2">Locations: {suggestion.study.countries.join(', ') || 'Not specified'}</p>
            <p className="mt-3 whitespace-pre-wrap">{suggestion.study.summary}</p>
          </details>
        </article>
      ))}
    </section>
  )
}
