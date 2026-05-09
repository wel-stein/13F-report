import { useState } from 'react'

export default function CopyLink({ className = '', label = 'Copy link' }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    const url = window.location.href
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        // Older browsers / non-secure contexts: fall back to a hidden textarea.
        const ta = document.createElement('textarea')
        ta.value = url
        ta.setAttribute('readonly', '')
        ta.style.position = 'absolute'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      // Surface as a one-shot inline flash; we don't have a toast system.
      // eslint-disable-next-line no-alert
      alert(`Couldn't copy link automatically — ${url}`)
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 ' +
        className
      }
      aria-label={label}
      title={label}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
           className="h-3 w-3">
        <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.41 1.41" />
        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.41-1.41" />
      </svg>
      {copied ? 'Copied!' : label}
    </button>
  )
}
