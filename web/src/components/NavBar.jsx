import { Link, NavLink } from 'react-router-dom'
import { site } from '../site.js'

export default function NavBar() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-900">{site.title}</span>
          <span className="hidden text-xs text-slate-500 sm:inline">
            · {site.source}
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavItem to="/" end>Overview</NavItem>
          <NavItem to="/consensus">Consensus</NavItem>
        </nav>
        <a
          href={site.repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="hidden text-xs text-slate-500 hover:text-slate-700 sm:inline"
        >
          About 13F filings ↗
        </a>
      </div>
    </header>
  )
}

function NavItem({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'rounded px-2.5 py-1 transition ' +
        (isActive
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
      }
    >
      {children}
    </NavLink>
  )
}
