// Two-bar prior-vs-current spark for a single holding row. Inline SVG keeps
// it tiny and themeable via Tailwind's fill-* utilities.
export default function SharesSparkline({ prior = 0, current = 0 }) {
  const max = Math.max(prior, current, 1)
  const w = 32
  const h = 12
  const gap = 2
  const barW = (w - gap) / 2
  const priorH = (prior / max) * h
  const currH = (current / max) * h
  const trend = current > prior ? 'up' : current < prior ? 'down' : 'flat'
  const currClass = trend === 'up'
    ? 'fill-emerald-500 dark:fill-emerald-400'
    : trend === 'down'
      ? 'fill-rose-500 dark:fill-rose-400'
      : 'fill-slate-400 dark:fill-slate-500'
  const label = `${prior.toLocaleString()} → ${current.toLocaleString()} shares`
  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label={label}
      className="inline-block align-middle"
    >
      <title>{label}</title>
      <rect
        x={0}
        y={h - priorH}
        width={barW}
        height={priorH || 0.5}
        className="fill-slate-300 dark:fill-slate-600"
      />
      <rect
        x={barW + gap}
        y={h - currH}
        width={barW}
        height={currH || 0.5}
        className={currClass}
      />
    </svg>
  )
}
