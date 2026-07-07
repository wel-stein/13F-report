import { useEffect } from 'react'
import { fmtCompactUSD } from '../format.js'

// A phosphor-terminal per-stock "thesis card", rendered as a modal over the
// portal. Fundamentals come from data/fundamentals.json (SEC EDGAR XBRL); the
// card degrades gracefully when a stock hasn't been enriched yet.
//
// Deliberately single-look (dark neon terminal) regardless of the portal's
// light/dark theme — it's a focused overlay, not part of the page chrome.

const C = {
  bg: '#070c10', panel: '#0b1218', panel2: '#0e161d', line: '#16241d', line2: '#1e3128',
  green: '#34e27a', greenHi: '#8affbe', greenDim: '#3f8f65', cyan: '#5bb4ff', amber: '#ffcf6b',
  ink: '#cdd8d2', mut: '#65776f', faint: '#42514b',
  mono: 'ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace',
}

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`)

function StatTile({ label, value, sub, tone = 'green' }) {
  const color = tone === 'cyan' ? C.cyan : tone === 'hi' ? C.greenHi : tone === 'ink' ? C.ink : C.green
  return (
    <div style={{ background: C.panel, padding: '14px 15px' }}>
      <div style={{ fontFamily: C.mono, fontSize: 10.5, letterSpacing: '.13em', textTransform: 'uppercase', color: C.mut, marginBottom: 7 }}>
        {label}
      </div>
      <div style={{ fontWeight: 800, fontSize: 24, lineHeight: 1.05, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontFamily: C.mono, fontSize: 10, color: C.faint, marginTop: 6, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  )
}

function Flow({ label, from, to, note }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontFamily: C.mono, fontSize: 10.5, letterSpacing: '.13em', textTransform: 'uppercase', color: C.mut }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontWeight: 800, fontSize: 24, letterSpacing: '-.01em' }}>
        <span style={{ color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{from}</span>
        <span style={{ color: C.greenDim, fontWeight: 400, fontSize: '.7em' }}>▸▸</span>
        <span style={{ color: C.green, fontVariantNumeric: 'tabular-nums' }}>{to}</span>
        {note && <span style={{ fontFamily: C.mono, fontSize: 11, color: C.greenHi, fontWeight: 600 }}>{note}</span>}
      </div>
    </div>
  )
}

export default function ThesisCard({ row, fundamentals, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const f = fundamentals || null
  const ro40 = f?.rule_of_40
  const growth = f?.revenue_growth_pct
  const fcfMargin = f?.fcf_margin_pct
  // Rule-of-40 bar scaled to a 160 axis, with the 40% "healthy line" marker.
  const AX = 160
  const wGrowth = growth != null ? Math.max(0, Math.min(growth, AX)) / AX * 100 : 0
  const wMargin = fcfMargin != null ? Math.max(0, Math.min(fcfMargin, AX - Math.max(0, growth || 0))) / AX * 100 : 0

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(2,5,7,.72)', backdropFilter: 'blur(3px)',
               display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${row.issuer} thesis card`}
        style={{
          width: '100%', maxWidth: 900, position: 'relative', color: C.ink,
          fontFamily: '"Helvetica Neue",Inter,system-ui,sans-serif',
          background: `linear-gradient(${C.faint}00, ${C.faint}00), linear-gradient(180deg,#060b0e,#070c10)`,
          border: `1px solid ${C.line2}`, borderRadius: 14, padding: 'clamp(18px,3vw,30px)',
          boxShadow: '0 0 0 1px rgba(52,226,122,.06), 0 40px 120px -40px rgba(0,0,0,.9)',
        }}
      >
        {/* close */}
        <button
          type="button" onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 8,
                   border: `1px solid ${C.line2}`, background: C.panel, color: C.mut, cursor: 'pointer', lineHeight: 1 }}
        >✕</button>

        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', paddingRight: 34 }}>
          <div>
            <h1 style={{ margin: 0, fontWeight: 800, letterSpacing: '-.02em', fontSize: 'clamp(26px,4.5vw,40px)', color: '#f2f7f4', lineHeight: 1 }}>
              {row.issuer}{row.ticker && <span style={{ color: C.cyan }}> ({row.ticker})</span>}
            </h1>
            <div style={{ marginTop: 9, fontFamily: C.mono, fontSize: 11.5, letterSpacing: '.16em', color: C.greenDim, textTransform: 'uppercase' }}>
              {row.sector || 'Equity'} · 13F Thesis Card
            </div>
          </div>
          {ro40 != null && (
            <div style={{ fontFamily: C.mono, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: C.greenHi,
                          border: `1px solid ${C.line2}`, background: 'linear-gradient(180deg,rgba(52,226,122,.10),rgba(52,226,122,.02))',
                          padding: '8px 13px', borderRadius: 999, whiteSpace: 'nowrap' }}>
              Rule of 40 · <span style={{ color: C.green }}>{ro40}%</span>
            </div>
          )}
        </div>

        <div style={{ height: 1, background: `linear-gradient(90deg,${C.line2},transparent)`, margin: '20px 0' }} />

        {/* 13F accumulation strip — always available */}
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontFamily: C.mono, fontSize: 12, color: C.mut, marginBottom: 18 }}>
          <span>机构买家 <b style={{ color: C.green }}>{row.buyerCount}</b></span>
          {row.newCount > 0 && <span>新建仓 <b style={{ color: C.greenHi }}>{row.newCount}</b></span>}
          {row.netBuyUsd > 0 && <span>本季净买入 <b style={{ color: C.green }}>{fmtCompactUSD(row.netBuyUsd)}</b></span>}
        </div>

        {f ? (
          <>
            {/* fundamentals tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 1,
                          background: C.line, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
              <StatTile label="营收增速 YoY" value={pct(growth)} sub={`FY${f.fiscal_year}`} />
              <StatTile label="净利润率" value={pct(f.net_margin_pct)}
                        sub={f.net_margin_pct_3y != null ? `3年前 ${f.net_margin_pct_3y}%` : undefined} />
              <StatTile label="FCF 利润率" value={pct(f.fcf_margin_pct)} tone="cyan" />
              <StatTile label="自由现金流" value={fmtCompactUSD(f.fcf)} tone="hi" />
              <StatTile label="现金" value={fmtCompactUSD(f.cash)} tone="ink"
                        sub={f.total_debt != null ? `债务 ${fmtCompactUSD(f.total_debt)}` : undefined} />
              <StatTile label="营收 (FY)" value={fmtCompactUSD(f.revenue)} tone="ink" />
            </div>

            {/* Rule of 40 bar */}
            {ro40 != null && (
              <div style={{ marginTop: 18, background: `linear-gradient(180deg,${C.panel2},${C.panel})`,
                            border: `1px solid ${C.line2}`, borderRadius: 12, padding: 'clamp(14px,2vw,22px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: C.mono, fontSize: 11, color: C.mut, marginBottom: 10, letterSpacing: '.04em' }}>
                  <span>营收增速 <b style={{ color: C.green }}>{growth}%</b> + FCF利润率 <b style={{ color: C.cyan }}>{fcfMargin}%</b></span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>= {ro40}% / {AX}</span>
                </div>
                <div style={{ position: 'relative', height: 24, borderRadius: 7, background: '#0a0f13', border: `1px solid ${C.line2}`, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${wGrowth}%`, background: 'linear-gradient(90deg,#1c7d4a,#34e27a)', transition: 'width .9s cubic-bezier(.2,.7,.2,1)' }} />
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wGrowth}%`, width: `${wMargin}%`, background: 'linear-gradient(90deg,#2f7bd6,#5bb4ff)', transition: 'width .9s cubic-bezier(.2,.7,.2,1) .15s' }} />
                  <div style={{ position: 'absolute', top: -5, bottom: -5, left: `${40 / AX * 100}%`, width: 2, background: C.amber, opacity: .9 }} />
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.amber, marginTop: 6 }}>
                  ▲ 40% 健康门槛　·　{ro40 >= 40 ? `达标,行业优秀线的 ${(ro40 / 40).toFixed(1)}×` : '未达 40 法则门槛'}
                </div>
              </div>
            )}

            {/* transition rows */}
            {(f.net_margin_pct_3y != null || f.fcf_3y != null) && (
              <div style={{ marginTop: 18, display: 'flex', gap: 'clamp(20px,6vw,60px)', flexWrap: 'wrap', padding: '0 4px' }}>
                {f.net_margin_pct_3y != null && f.net_margin_pct != null && (
                  <Flow label="净利润率 · 跃迁" from={`${f.net_margin_pct_3y}%`} to={`${f.net_margin_pct}%`}
                        note={f.net_margin_pct_3y > 0 ? `${(f.net_margin_pct / f.net_margin_pct_3y).toFixed(1)}×` : undefined} />
                )}
                {f.fcf_3y != null && f.fcf != null && (
                  <Flow label={`自由现金流 · FY${f.fy_3y}→${f.fiscal_year}`} from={fmtCompactUSD(f.fcf_3y)} to={fmtCompactUSD(f.fcf)} />
                )}
              </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                          fontFamily: C.mono, fontSize: 10, letterSpacing: '.06em', color: C.faint, textTransform: 'uppercase' }}>
              <span>Source · SEC EDGAR XBRL · FY{f.fiscal_year}</span>
              <span>非投资建议</span>
            </div>
          </>
        ) : (
          <div style={{ padding: '26px 4px', fontFamily: C.mono, fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
            该股票的基本面尚未富化。下次数据刷新时,
            <span style={{ color: C.green }}> download_13f.py </span>
            会从 SEC EDGAR 拉取并计算营收增速、利润率、FCF 与 Rule of 40。
            <div style={{ marginTop: 8, color: C.faint }}>
              (仅美股、且能匹配到 SEC CIK 的标的可富化;外国私募发行/无 XBRL 报表的会留空。)
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
