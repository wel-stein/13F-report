import { Link } from 'react-router-dom'
import { site } from '../site.js'

export default function NavBar() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-900">{site.title}</span>
          <span className="hidden text-xs text-slate-500 sm:inline">
            · {site.source}
          </span>
        </Link>
        <a
          href={site.repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          About 13F filings ↗
        </a>
      </div>
    </header>
  )
}
