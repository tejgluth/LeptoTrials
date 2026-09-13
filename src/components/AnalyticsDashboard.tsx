import { useEffect, useMemo, useState } from 'react'
import TrialSuggestionsReview from './TrialSuggestionsReview'
import type { ContactAnalyticsReport } from '../types/contactAnalytics'
import { fetchContactAnalytics } from '../utils/contactAnalytics'
import { getTrialUrl } from '../utils/apiClient'

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="border-l border-[#2a5070] pl-5 sm:pl-6 py-1">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8ecfe8]">{label}</p>
      <p className="mt-2 text-4xl sm:text-5xl font-semibold tracking-[-0.04em] text-[#e8f4fd]">
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-[#6f9db8]">{note}</p>
    </div>
  )
}

export default function AnalyticsDashboard() {
  const [token, setToken] = useState('')
  const [report, setReport] = useState<ContactAnalyticsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadReport = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!token.trim()) return

    setIsLoading(true)
    setError(null)
    try {
      setReport(await fetchContactAnalytics(token.trim()))
    } catch (err) {
      setReport(null)
      setError(err instanceof Error ? err.message : 'Unable to load contact analytics.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Contact analytics · LeptoTrials'
    return () => { document.title = previousTitle }
  }, [])

  const chartMax = useMemo(
    () => Math.max(1, ...(report?.daily.map((day) => day.total) ?? [])),
    [report]
  )

  if (!report) {
    return (
      <main className="min-h-screen bg-[#060f1e] text-[#e8f4fd] flex items-center justify-center px-5 py-16">
        <section className="w-full max-w-lg border-t border-[#2a5070] pt-8">
          <a href="/" className="text-xs font-semibold uppercase tracking-[0.22em] text-[#38bdf8] hover:text-[#7dd3fc]">
            LeptoTrials
          </a>
          <h1 className="mt-8 font-serif text-4xl sm:text-5xl leading-[1.05] tracking-[-0.03em]">Contact activity</h1>
          <p className="mt-4 max-w-md text-sm sm:text-base leading-relaxed text-[#8ecfe8]">
            Private reporting for trial email clicks and successful copy actions. No patient names,
            email addresses, search filters, or clipboard contents are collected.
          </p>

          <form onSubmit={loadReport} className="mt-10">
            <label htmlFor="analytics-token" className="block text-sm font-semibold text-[#b0d8ee] mb-2.5">
              Analytics access token
            </label>
            <input
              id="analytics-token"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="w-full min-h-[52px] bg-[#0a1a2e] border border-[#1a3352] px-4 text-base text-[#e8f4fd] focus:border-[#38bdf8] focus:outline-none"
              placeholder="Enter your analytics access token"
            />
            {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={isLoading || !token.trim()}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center bg-[#38bdf8] px-6 text-sm font-semibold text-[#060f1e] transition-colors hover:bg-[#7dd3fc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? 'Loading activity…' : 'Open analytics'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#060f1e] text-[#e8f4fd]">
      <header className="border-b border-[#1a3352]/70 px-5 sm:px-8 md:px-12 lg:px-20 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5">
          <div>
            <a href="/" className="text-sm font-bold uppercase tracking-[0.22em] text-[#e8f4fd]">
              Lepto<span className="text-[#38bdf8]">Trials</span>
            </a>
            <p className="mt-1 text-xs text-[#6f9db8]">Private contact analytics</p>
          </div>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={isLoading}
            className="min-h-[44px] border border-[#2a5070] px-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#b0d8ee] transition-colors hover:border-[#38bdf8] hover:text-white disabled:opacity-50"
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-12 lg:px-20 py-12 sm:py-16">
        <div className="flex flex-col gap-5 border-b border-[#1a3352] pb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#38bdf8]">Patient connection signals</p>
            <h1 className="mt-3 font-serif text-4xl sm:text-6xl tracking-[-0.04em]">Contact activity</h1>
          </div>
          <p className="text-xs text-[#6f9db8]">Updated {formatDateTime(report.generatedAt)}</p>
        </div>

        <section aria-label="Contact totals" className="grid grid-cols-2 gap-x-6 gap-y-9 py-10 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="All actions" value={report.totals.all} note="All time" />
          <Metric label="Email clicks" value={report.totals.emailClicks} note="Link activated" />
          <Metric label="Email copies" value={report.totals.emailCopies} note="Copied successfully" />
          <Metric label="Trials" value={report.totals.activeTrials} note="With activity" />
          <Metric label="7 days" value={report.totals.last7Days} note="Recent actions" />
          <Metric label="30 days" value={report.totals.last30Days} note="Recent actions" />
        </section>

        <section className="border-y border-[#1a3352] py-9 sm:py-11">
          <div className="flex items-baseline justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8ecfe8]">Last 30 days</p>
              <h2 className="mt-2 text-xl sm:text-2xl font-semibold">Daily connection intent</h2>
            </div>
            <div className="hidden sm:flex gap-4 text-xs text-[#8ecfe8]">
              <span><i className="mr-1.5 inline-block h-2 w-2 bg-[#38bdf8]" />Email</span>
              <span><i className="mr-1.5 inline-block h-2 w-2 bg-[#2a5070]" />Copy</span>
            </div>
          </div>
          <div className="mt-9 grid h-48 grid-cols-[repeat(30,minmax(5px,1fr))] items-end gap-1 sm:gap-1.5" aria-label="Daily activity chart">
            {report.daily.map((day, index) => (
              <div key={day.date} className="group relative flex h-full flex-col justify-end" title={`${formatShortDate(day.date)}: ${day.total} actions`}>
                <div className="absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap bg-[#e8f4fd] px-2 py-1 text-[10px] font-semibold text-[#060f1e] group-hover:block">
                  {formatShortDate(day.date)} · {day.total}
                </div>
                <div
                  className="flex min-h-[2px] w-full flex-col justify-end transition-opacity group-hover:opacity-80"
                  style={{ height: `${Math.max(2, (day.total / chartMax) * 100)}%` }}
                >
                  <div className="bg-[#38bdf8]" style={{ flex: day.emailClicks }} />
                  <div className="bg-[#2a5070]" style={{ flex: day.emailCopies }} />
                </div>
                {(index === 0 || index === 14 || index === 29) && (
                  <span className="absolute top-full mt-2 text-[9px] text-[#6f9db8]">{formatShortDate(day.date)}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="py-10 sm:py-14">
          <div className="flex items-end justify-between gap-5 mb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8ecfe8]">Trial performance</p>
              <h2 className="mt-2 text-xl sm:text-2xl font-semibold">Where patients connect</h2>
            </div>
            <p className="text-xs text-[#6f9db8]">Sorted by total actions</p>
          </div>

          <div className="overflow-x-auto border-t border-[#2a5070]">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#1a3352] text-xs uppercase tracking-[0.12em] text-[#6f9db8]">
                  <th className="py-3 pr-5 font-semibold">Trial</th>
                  <th className="px-5 py-3 text-right font-semibold">Email</th>
                  <th className="px-5 py-3 text-right font-semibold">Copy</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="py-3 pl-5 text-right font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {report.trials.map((trial) => (
                  <tr key={trial.nctId} className="border-b border-[#142840] text-sm text-[#b0d8ee]">
                    <td className="py-4 pr-5">
                      <a href={getTrialUrl(trial.nctId)} target="_blank" rel="noopener noreferrer" className="font-mono text-[#38bdf8] hover:text-[#7dd3fc]">
                        {trial.nctId} ↗
                      </a>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">{trial.emailClicks}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{trial.emailCopies}</td>
                    <td className="px-5 py-4 text-right font-semibold tabular-nums text-[#e8f4fd]">{trial.total}</td>
                    <td className="py-4 pl-5 text-right text-xs text-[#6f9db8]">{formatDateTime(trial.lastActivity)}</td>
                  </tr>
                ))}
                {report.trials.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-[#6f9db8]">No contact activity recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <TrialSuggestionsReview token={token} />

        <p className="border-t border-[#1a3352] pt-6 text-xs leading-relaxed text-[#6f9db8]">
          Counts represent intent signals, not confirmed messages or trial enrollments. Storage is append-only and contains only the NCT ID, action type, and event time.
        </p>
      </div>
    </main>
  )
}
