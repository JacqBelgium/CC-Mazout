"use client";

import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingDown, TrendingUp, ChevronDown, Table2, X } from "lucide-react";

const GALLON_TO_LITER = 3.785411784;

// ---------------------------------------------------------------------------
// Fallback mock data — enkel gebruikt zolang de GitHub Actions-job nog geen
// historiek heeft opgebouwd in Postgres (bv. net na het opzetten van de repo).
// ---------------------------------------------------------------------------
function buildMockHistory(days) {
  const out = [];
  let max = 1.67;
  let crude = 0.9;
  let wti = 70;
  let fx = 1.08;
  let prevCrudeForLag = crude;
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    fx = Math.max(0.9, Math.min(1.2, fx + (Math.random() - 0.5) * 0.006));
    wti = Math.max(30, wti + (Math.random() - 0.5) * 1.6 + Math.sin(i / 7) * 0.3);
    const crackSpread = 0.14 + Math.sin(i / 11) * 0.015;
    const crudeTarget = (wti / fx) * 0.0092 + crackSpread;
    crude = Math.max(0.4, crude + (crudeTarget - crude) * 0.25 + (Math.random() - 0.5) * 0.0035);
    max = (prevCrudeForLag + 0.48) * 1.21 + (Math.random() - 0.5) * 0.002;
    prevCrudeForLag = crude;
    out.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit" }),
      crude: +crude.toFixed(4),
      wti: +wti.toFixed(2),
      max: +max.toFixed(4),
      maxOnder2000: +(max + 0.0405).toFixed(4), // benadering: <2000L ligt doorgaans iets hoger
    });
  }
  return out;
}

function useHistory(days) {
  const [state, setState] = useState({ rows: [], loading: true, isMock: false });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    fetch(`/api/prices?days=${days}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.rows || data.rows.length < 2) {
          // Nog geen (voldoende) historiek — val terug op voorbeelddata zodat
          // de pagina bruikbaar blijft vóór de eerste ingestie-runs.
          setState({ rows: buildMockHistory(days), loading: false, isMock: true });
          return;
        }
        const rows = data.rows.map((r) => ({
          date: r.date,
          label: new Date(r.date).toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit" }),
          crude: Number(r.market_eur_l),
          wti: Number(r.wti_usd_bbl),
          max: Number(r.fod_max_vanaf2000_l),
          maxOnder2000: r.fod_max_onder2000_l != null ? Number(r.fod_max_onder2000_l) : null,
        }));
        setState({ rows, loading: false, isMock: false });
      })
      .catch(() => {
        if (!cancelled) setState({ rows: buildMockHistory(days), loading: false, isMock: true });
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  return state;
}

function indexed(history, keys) {
  if (history.length === 0) return [];
  const base = history[0];
  return history.map((row) => {
    const out = { label: row.label };
    keys.forEach((k) => {
      out[k] = base[k] ? +((row[k] / base[k]) * 100).toFixed(2) : null;
    });
    return out;
  });
}

const fmt = (v) => `€ ${v.toFixed(4)} / L`;
const fmtShort = (v) => `€${v.toFixed(2)}`;

function Delta({ value }) {
  const down = value <= 0;
  return (
    <span className={`delta ${down ? "delta-down" : "delta-up"}`}>
      {down ? <TrendingDown size={14} strokeWidth={2.5} /> : <TrendingUp size={14} strokeWidth={2.5} />}
      {down ? "" : "+"}
      {value.toFixed(4)} €/L
    </span>
  );
}

export default function MazoutDashboard() {
  const [range, setRange] = useState(30);
  const [showRaw, setShowRaw] = useState(false);
  const [chartMode, setChartMode] = useState("index");

  const { rows: history, loading, isMock } = useHistory(range === "custom" ? 90 : range);
  const indexedHistory = useMemo(() => indexed(history, ["wti", "crude", "max"]), [history]);

  const today = history[history.length - 1];
  const yesterday = history[history.length - 2] ?? today;

  // Vaste, bevestigde prijsopbouw (zie opdrachtdocument, §2.2)
  const productMarkt = 0.9;
  const distributieMarge = 0.2;
  const accijnzen = 0.28;
  const subtotaal = productMarkt + distributieMarge + accijnzen;
  const btw = subtotaal * 0.21;
  const breakdown = [
    { label: "Productprijs/markt", value: productMarkt, color: "#8C6A3F" },
    { label: "Distributiemarge", value: distributieMarge, color: "#6E5A8C" },
    { label: "Accijnzen/energieheffing (incl. overige bijdragen)", value: accijnzen, color: "#B4472B" },
    { label: "BTW (21%)", value: btw, color: "#5B6E63" },
  ];
  const total = breakdown.reduce((s, b) => s + b.value, 0);

  if (loading || !today) {
    return <div className="wrap"><p style={{ padding: 24 }}>Prijzen laden…</p></div>;
  }

  const deltaMax = today.max - yesterday.max;
  const deltaCrude = today.crude - yesterday.crude;

  return (
    <div className="wrap">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .wrap {
          --paper: #E4DFCF; --paper-2: #DAD4C0; --ink: #24231D; --ink-soft: #57544A;
          --board: #1C1A16; --board-2: #26221C; --amber: #F0A93B; --amber-dim: #8A6221;
          --hair: #C9C2AC;
          background: var(--paper); color: var(--ink); font-family: 'Inter', sans-serif;
          padding: 28px 20px 60px; min-height: 100vh;
        }
        .wrap * { box-sizing: border-box; }
        .container { max-width: 880px; margin: 0 auto; }
        .eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.14em;
          text-transform: uppercase; color: var(--ink-soft); border-bottom: 1px solid var(--hair);
          padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
        h1 { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: clamp(28px, 4.2vw, 40px);
          letter-spacing: -0.01em; margin: 0 0 8px; }
        h1 .quote { color: var(--amber-dim); }
        .subtitle { font-size: 14px; color: var(--ink-soft); line-height: 1.6; max-width: 560px; margin: 0 0 20px; }
        .mock-banner { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; background: #EAD9A0;
          border: 1px solid #C9A94A; color: #5A4419; padding: 8px 12px; border-radius: 6px; margin-bottom: 20px; }
        .board { background: linear-gradient(180deg, var(--board), var(--board-2)); border-radius: 10px;
          padding: 26px 28px; color: #E9E4D6; margin-bottom: 22px; }
        .board-top { display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace;
          font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #A69C86; margin-bottom: 6px; flex-wrap: wrap; gap: 6px; }
        .board-digits { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: clamp(46px, 8vw, 76px);
          color: var(--amber); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; line-height: 1;
          display: flex; align-items: baseline; gap: 8px; }
        .board-digits .unit { font-size: 0.32em; color: #B99A55; font-weight: 500; }
        .board-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; flex-wrap: wrap; gap: 10px; }
        .delta { font-family: 'IBM Plex Mono', monospace; font-size: 13px; display: inline-flex; align-items: center;
          gap: 4px; padding: 3px 8px; border-radius: 20px; }
        .delta-down { color: #9BD6AE; background: rgba(75,123,91,0.18); }
        .delta-up { color: #E8A48C; background: rgba(180,71,43,0.2); }
        .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 26px; }
        @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
        .card { background: var(--paper-2); border: 1px solid var(--hair); border-radius: 8px; padding: 16px 16px 14px; }
        .card-num { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
        .card-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; margin: 4px 0 10px; }
        .card-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 22px; font-variant-numeric: tabular-nums; margin-bottom: 6px; }
        .card-note { font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
        .section { margin-bottom: 30px; }
        .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px;
          border-bottom: 1px solid var(--hair); padding-bottom: 8px; flex-wrap: wrap; gap: 8px; }
        .section-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 17px; }
        .stackbar { display: flex; width: 100%; height: 28px; border-radius: 5px; overflow: hidden; margin-bottom: 16px; border: 1px solid var(--hair); }
        .breakdown-list { display: flex; flex-direction: column; gap: 8px; }
        .breakdown-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 7px 0; border-bottom: 1px dashed var(--hair); }
        .breakdown-row:last-child { border-bottom: none; font-weight: 700; }
        .breakdown-label { display: flex; align-items: center; gap: 8px; }
        .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
        .breakdown-value { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .seg { display: flex; border: 1px solid var(--hair); border-radius: 6px; overflow: hidden; }
        .seg button { font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 6px 12px; background: transparent; border: none; cursor: pointer; color: var(--ink-soft); }
        .seg button + button { border-left: 1px solid var(--hair); }
        .seg button.active { background: var(--board); color: var(--amber); }
        .raw-btn { display: inline-flex; align-items: center; gap: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
          background: transparent; border: 1px solid var(--hair); border-radius: 6px; padding: 6px 12px; cursor: pointer; color: var(--ink); }
        .chart-box { background: var(--paper-2); border: 1px solid var(--hair); border-radius: 8px; padding: 14px 8px 6px; }
        table.raw { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
        table.raw th, table.raw td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--hair); }
        table.raw th:first-child, table.raw td:first-child { text-align: left; }
        .raw-scroll { max-height: 260px; overflow-y: auto; border: 1px solid var(--hair); border-radius: 8px; }
        .modal-back { position: fixed; inset: 0; background: rgba(28,26,22,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
        .modal { background: var(--paper); border-radius: 10px; padding: 18px; max-width: 500px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; }
        .modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .modal-close { background: none; border: none; cursor: pointer; color: var(--ink-soft); }
        footer { font-size: 11.5px; color: var(--ink-soft); border-top: 1px solid var(--hair); padding-top: 14px; line-height: 1.6; }
      `}</style>

      <div className="container">
        <div className="eyebrow">
          <span>FOD/SPF Finance · dagelijkse maximumprijs</span>
          <span>{new Date(today.date).toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
        </div>

        <h1>Belgische <span className="quote">"mazout"</span>prijzen &amp; trends</h1>
        <p className="subtitle">
          Officiële maximumprijs per dag volgens FOD Financiën, met een onafhankelijke
          inschatting op basis van de internationale stookoliemarkt.
        </p>

        {isMock && (
          <div className="mock-banner">
            ⚠ Nog geen historiek in de database — dit zijn voorbeeldcijfers. Zodra de dagelijkse
            GitHub Actions-job één of meerdere keren gedraaid heeft, toont deze pagina de echte data.
          </div>
        )}

        <div className="board">
          <div className="board-top">
            <span>Officiële maximumprijs (≥ 2000 L) — laatst bekend</span>
            <span>bron: FOD Economie</span>
          </div>
          <div className="board-digits">
            <span>€ {today.max.toFixed(4)}</span>
            <span className="unit">/ liter</span>
          </div>
          <div className="board-bottom">
            <span>t.o.v. vorige dag</span>
            <Delta value={deltaMax} />
          </div>
          {today.maxOnder2000 != null && (
            <div className="board-bottom" style={{ marginTop: 4 }}>
              <span style={{ opacity: 0.8 }}>Tarief &lt; 2000 L</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 13 }}>€ {today.maxOnder2000.toFixed(4)} / L</span>
            </div>
          )}
        </div>

        <div className="cards">
          <div className="card">
            <div className="card-num">01 — markt</div>
            <div className="card-title">Marktprijs (HO=F, omgerekend)</div>
            <div className="card-value">{fmt(today.crude)}</div>
            <Delta value={deltaCrude} />
          </div>
          <div className="card">
            <div className="card-num">02 — officieel</div>
            <div className="card-title">Maximumprijs (FOD/SPF Finance)</div>
            <div className="card-value">{fmt(today.max)}</div>
            <Delta value={deltaMax} />
          </div>
          <div className="card">
            <div className="card-num">03 — WTI</div>
            <div className="card-title">Ruwe olie (WTI)</div>
            <div className="card-value">€{today.wti ? today.wti.toFixed(2) : "—"}<span style={{fontSize:12}}> USD/vat</span></div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="section-title">Prijsopbouw &amp; specificatie</span>
            <span>per liter</span>
          </div>
          <div className="stackbar">
            {breakdown.map((b) => (
              <div key={b.label} style={{ width: `${(b.value / total) * 100}%`, background: b.color }} title={`${b.label}: ${fmt(b.value)}`} />
            ))}
          </div>
          <div className="breakdown-list">
            {breakdown.map((b) => (
              <div className="breakdown-row" key={b.label}>
                <span className="breakdown-label"><span className="swatch" style={{ background: b.color }} />{b.label}</span>
                <span className="breakdown-value">{fmt(b.value)}</span>
              </div>
            ))}
            <div className="breakdown-row">
              <span>Officiële FOD maximumprijs</span>
              <span className="breakdown-value">{fmt(total)}</span>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="section-title">Prijstrend</span>
            <div className="controls">
              <div className="seg">
                <button className={range === 30 ? "active" : ""} onClick={() => setRange(30)}>30D</button>
                <button className={range === 90 ? "active" : ""} onClick={() => setRange(90)}>90D</button>
              </div>
              <button className="raw-btn" onClick={() => setShowRaw(true)}><Table2 size={13} /> Ruwe data <ChevronDown size={12} /></button>
            </div>
          </div>
          <div className="controls" style={{ marginBottom: 10 }}>
            <div className="seg">
              <button className={chartMode === "index" ? "active" : ""} onClick={() => setChartMode("index")}>Beweging t.o.v. elkaar (%)</button>
              <button className={chartMode === "level" ? "active" : ""} onClick={() => setChartMode("level")}>Prijsniveau (€/L)</button>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartMode === "level" ? history : indexedHistory} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#C9C2AC" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#57544A" }} interval={Math.floor(history.length / 6)} axisLine={{ stroke: "#C9C2AC" }} tickLine={false} />
                <YAxis tickFormatter={chartMode === "level" ? fmtShort : (v) => `${v}`} tick={{ fontSize: 11, fill: "#57544A" }} axisLine={false} tickLine={false} width={50} />
                <Tooltip formatter={(v, name) => [chartMode === "level" ? fmt(v) : `${v} (basis 100)`, name]} contentStyle={{ background: "#1C1A16", border: "none", borderRadius: 6 }} itemStyle={{ fontSize: 12, color: "#E9E4D6" }} />
                <Line type="monotone" dataKey="max" name="FOD maximumprijs" stroke="#B4472B" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="crude" name="HO=F (markt)" stroke="#5B6E63" strokeWidth={1.5} dot={false} />
                {chartMode === "index" && <Line type="monotone" dataKey="wti" name="Ruwe olie (WTI)" stroke="#F0A93B" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <footer>
          "Mazout" is het Belgische woord voor stookolie. Data ververst dagelijks via een
          GitHub Actions-job (yfinance + FOD Economie).
        </footer>
      </div>

      {showRaw && (
        <div className="modal-back" onClick={() => setShowRaw(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Ruwe historische data</h3><button className="modal-close" onClick={() => setShowRaw(false)}><X size={18} /></button></div>
            <div className="raw-scroll">
              <table className="raw">
                <thead><tr><th>Datum</th><th>WTI</th><th>HO=F markt</th><th>FOD max</th></tr></thead>
                <tbody>
                  {[...history].reverse().map((row) => (
                    <tr key={row.label}><td>{row.label}</td><td>{row.wti?.toFixed(2)}</td><td>{row.crude.toFixed(4)}</td><td>{row.max.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
