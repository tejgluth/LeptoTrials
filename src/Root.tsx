import { lazy, Suspense } from 'react'
import App from './App'

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'))
const SuggestTrial = lazy(() => import('./components/SuggestTrial'))
const pathname = window.location.pathname.replace(/\/+$/, '')

export default function Root() {
  if (pathname !== '/analytics' && pathname !== '/suggest-trial') return <App />

  return (
    <Suspense fallback={<main className="min-h-screen bg-[#060f1e] p-8" role="status">Loading…</main>}>
      {pathname === '/suggest-trial' ? <SuggestTrial /> : <AnalyticsDashboard />}
    </Suspense>
  )
}
