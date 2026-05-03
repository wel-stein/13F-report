import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import Home from './pages/Home.jsx'
import Investor from './pages/Investor.jsx'

// WhaleCheck pulls in Recharts (~95 KB gz). Lazy-load it so the home and
// investor pages stay lean — Recharts only ships to users who actually
// click through to the strategy chart.
const WhaleCheck = lazy(() => import('./pages/WhaleCheck.jsx'))

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/investor/:cik" element={<Investor />} />
          <Route path="/investor/:cik/whalecheck" element={<WhaleCheck />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  )
}

function RouteFallback() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 text-sm text-slate-500">
      Loading…
    </main>
  )
}

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">
        Try the <a href="#/" className="text-indigo-600 hover:underline">homepage</a>.
      </p>
    </main>
  )
}
