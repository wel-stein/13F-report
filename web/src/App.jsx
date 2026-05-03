import { Route, Routes } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import Home from './pages/Home.jsx'
import Investor from './pages/Investor.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/investor/:cik" element={<Investor />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
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
