import { lazy, Suspense } from 'react'
import App from './App'

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'))
const isAnalyticsRoute = window.location.pathname.replace(/\/+$/, '') === '/analytics'

export default function Root() {
  if (!isAnalyticsRoute) return <App />

  return (
    <Suspense fallback={<main className="min-h-screen bg-[#060f1e]" aria-label="Loading analytics" />}>
      <AnalyticsDashboard />
    </Suspense>
  )
}
