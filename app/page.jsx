"use client";

import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingDown, TrendingUp, ChevronDown, Table2, X, ArrowDown, ArrowUp, ArrowRight } from "lucide-react";

const GALLON_TO_LITER = 3.785411784;

// ---------------------------------------------------------------------------
// Datums: alles als 'YYYY-MM-DD'-kalenderdatum, met "vandaag" in Europe/Brussels —
// los van de tijdzone van de browser of van de server.
// ---------------------------------------------------------------------------
function brusselsToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const fmtIso = (iso, opts) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-BE", { ...opts, timeZone: "UTC" });

// "Vandaag" = de rij van vandaag, of anders de laatste rij ervóór (rijen zijn oplopend
// gesorteerd en uniek per datum, dus de laatste rij <= vandaag ís de rij van vandaag als
// die bestaat). "Morgen" = de rij van vandaag + 1, enkel als FOD die prijs al publiceerde.
function splitDays(history, todayIso) {
  let todayIdx = -1;
  history.forEach((row, i) => {
    if (row.date <= todayIso) todayIdx = i;
  });
  const tomorrowIso = addDays(todayIso, 1);
  const tomorrow = history.find((row) => row.date === tomorrowIso && row.max != null) ?? null;
  return { todayIdx, tomorrow };
}

// Laatste niet-lege waarde van `key` op of vóór index `upTo`, plus de waarde daarvoor
// (voor de delta). Marktdata ontbreekt op weekends/feestdagen (geen slotkoers) — dan
// tonen we de laatst bekende i.p.v. een nul.
function lastKnown(rows, upTo, key) {
  const found = [];
  for (let i = upTo; i >= 0 && found.length < 2; i--) {
    if (rows[i][key] != null) found.push(rows[i][key]);
  }
  return { value: found[0] ?? null, prev: found[1] ?? found[0] ?? null };
}

// Verschil kleiner dan een halve tiende cent per liter = "gelijk".
const SAME_THRESHOLD = 0.0005;

function tariffChange(todayVal, tomorrowVal) {
  if (todayVal == null || tomorrowVal == null) return null;
  const diff = tomorrowVal - todayVal;
  return {
    from: todayVal,
    to: tomorrowVal,
    per1000: diff * 1000,
    dir: Math.abs(diff) < SAME_THRESHOLD ? "same" : diff < 0 ? "down" : "up",
  };
}

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

function useHistory(range) {
  const [state, setState] = useState({ rows: [], loading: true, isMock: false });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    const isCustom = typeof range === "object" && range?.from && range?.to;
    const url = isCustom
      ? `/api/prices?from=${range.from}&to=${range.to}`
      : `/api/prices?days=${range}`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.rows || data.rows.length < 2) {
          // Nog geen (voldoende) historiek — val terug op voorbeelddata zodat
          // de pagina bruikbaar blijft vóór de eerste ingestie-runs, of als een
          // gekozen periode toevallig geen data bevat. Altijd een vast, geldig
          // aantal dagen gebruiken — nooit het (mogelijk niet-numerieke) range-object.
          setState({ rows: buildMockHistory(30), loading: false, isMock: true });
          return;
        }
        const rows = data.rows.map((r) => {
          // pg levert DATE als middernacht-timestamp ("2026-11-05T00:00:00.000Z") —
          // enkel de kalenderdatum gebruiken, nooit omrekenen naar een lokale tijdzone.
          const date = String(r.date).slice(0, 10);
          return {
            date,
            label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
            crude: r.market_eur_l != null ? Number(r.market_eur_l) : null,
            wti: r.wti_usd_bbl != null ? Number(r.wti_usd_bbl) : null,
            max: r.fod_max_vanaf2000_l != null ? Number(r.fod_max_vanaf2000_l) : null,
            maxOnder2000: r.fod_max_onder2000_l != null ? Number(r.fod_max_onder2000_l) : null,
          };
        });
        setState({ rows, loading: false, isMock: false });
      })
      .catch(() => {
        if (!cancelled) setState({ rows: buildMockHistory(30), loading: false, isMock: true });
      });

    return () => {
      cancelled = true;
    };
  }, [typeof range === "object" ? `${range.from}_${range.to}` : range]);

  return state;
}

function indexed(history, keys) {
  if (history.length === 0) return [];
  // Per reeks apart de eerste dag mét een geldige waarde als 100%-basis nemen,
  // i.p.v. blind history[0] — die dag kan voor een specifieke kolom nog leeg zijn
  // (bv. markt/WTI-data die pas later is aangevuld).
  const bases = {};
  keys.forEach((k) => {
    const firstValid = history.find((row) => row[k] != null && !Number.isNaN(row[k]));
    bases[k] = firstValid ? firstValid[k] : null;
  });
  return history.map((row) => {
    const out = { label: row.label };
    keys.forEach((k) => {
      const base = bases[k];
      const val = row[k];
      out[k] = base && val != null ? +((val / base) * 100).toFixed(2) : null;
    });
    return out;
  });
}

const fmt = (v) => (v == null ? "—" : `€ ${v.toFixed(4)} / L`);
// Zelfde tekst als fmt, maar met niet-afbrekende spaties: bedrag en eenheid blijven samen.
const fmtNoBreak = (v) => fmt(v).replace(/ /g, " ");
const fmtShort = (v) => `€${v.toFixed(2)}`;
const fmtEuro2 = (v) => v.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEuro4 = (v) => v.toLocaleString("nl-BE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function Delta({ value, onLight }) {
  if (value == null || Number.isNaN(value)) return null;
  const down = value <= 0;
  const cls = onLight ? (down ? "delta-down-light" : "delta-up-light") : (down ? "delta-down" : "delta-up");
  return (
    <span className={`delta ${cls}`}>
      {down ? <TrendingDown size={14} strokeWidth={2.5} /> : <TrendingUp size={14} strokeWidth={2.5} />}
      {down ? "" : "+"}
      {value.toFixed(4)} €/L
    </span>
  );
}

const TOMORROW_TITLES = {
  down: "De mazoutprijs daalt morgen!",
  up: "De mazoutprijs stijgt morgen!",
  same: "De mazoutprijs blijft morgen gelijk.",
  mixed: "De mazoutprijs verandert morgen",
};
const DIR_ICONS = { down: ArrowDown, up: ArrowUp, same: ArrowRight };

// Geen +/− teken: "meer"/"minder" geeft de richting al aan.
function ChangeLine({ change, label }) {
  const rounded = Math.round(Math.abs(change.per1000) * 100) / 100;
  if (rounded === 0) {
    return (
      <span><strong>geen verschil</strong> voor 1000 liter ({label}), {fmtEuro4(change.to)} €/l</span>
    );
  }
  return (
    <span>
      <strong>{fmtEuro2(rounded)} € {change.per1000 < 0 ? "minder" : "meer"}</strong> voor 1000 liter ({label}),
      van {fmtEuro4(change.from)} naar {fmtEuro4(change.to)} €/l
    </span>
  );
}

// Blok "morgen": vergelijkt het FOD-tarief van morgen met dat van vandaag, per tarief.
function TomorrowBlock({ todayMax, todayOnder2000, tomorrow }) {
  const changes = tomorrow
    ? [
        { label: "≥ 2000 l", change: tariffChange(todayMax, tomorrow.max) },
        { label: "< 2000 l", change: tariffChange(todayOnder2000, tomorrow.maxOnder2000) },
      ].filter((c) => c.change)
    : [];

  if (changes.length === 0) {
    return (
      <div className="tomorrow t-neutral">
        <p className="tomorrow-unknown">De prijs van morgen is nog niet bekend.</p>
      </div>
    );
  }

  const dirs = new Set(changes.map((c) => c.change.dir));
  const overall = dirs.size === 1 ? [...dirs][0] : "mixed";
  const MainIcon = DIR_ICONS[overall];

  return (
    <div className={`tomorrow t-${overall}`}>
      {MainIcon && (
        <div className="tomorrow-icon" aria-hidden="true">
          <MainIcon size={30} strokeWidth={2.75} />
        </div>
      )}
      <div className="tomorrow-body">
        <p className="tomorrow-title">{TOMORROW_TITLES[overall]}</p>
        <p className="tomorrow-when">
          {overall === "same" ? "Het tarief van morgen" : "De wijziging"} geldt vanaf morgen,{" "}
          {fmtIso(tomorrow.date, { day: "numeric", month: "long", year: "numeric" })}.
        </p>
        <ul className="tomorrow-lines">
          {changes.map(({ label, change }) => {
            // Bij tarieven met een verschillende richting krijgt elke regel een eigen pijl.
            const LineIcon = overall === "mixed" ? DIR_ICONS[change.dir] : null;
            return (
              <li key={label} className={overall === "mixed" ? `t-${change.dir}` : undefined}>
                {LineIcon && <LineIcon size={16} strokeWidth={2.75} className="tomorrow-line-icon" aria-hidden="true" />}
                <ChangeLine change={change} label={label} />
              </li>
            );
          })}
        </ul>
        <p className="tomorrow-source">Prijzen van de FOD Financiën. Bedragen incl. BTW.</p>
      </div>
    </div>
  );
}

export default function MazoutDashboard() {
  const [range, setRange] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [chartMode, setChartMode] = useState("index");

  const isCustomMode = typeof range === "object";
  // Grafiek + ruwe data volgen de gekozen periode...
  const { rows: history, loading: historyLoading, isMock: historyIsMock } = useHistory(range);
  // ...maar het pijlblok, het bord, de kaarten en de prijsopbouw gebruiken altijd een vaste,
  // recente dataset — anders verdwijnt "morgen" zodra de gekozen periode vóór morgen eindigt.
  // 7 dagen volstaat om over weekend/feestdag heen de laatst bekende marktkoers te vinden.
  const { rows: recent, loading: recentLoading, isMock: recentIsMock } = useHistory(7);
  const loading = historyLoading || recentLoading;
  const isMock = historyIsMock || recentIsMock;
  const indexedHistory = useMemo(() => indexed(history, ["wti", "crude", "max"]), [history]);

  function applyCustomRange() {
    if (customFrom && customTo) setRange({ from: customFrom, to: customTo });
  }

  // De rij van morgen (enkel FOD-tarief, nog geen marktdata) zit wel in de data voor de
  // grafiek, maar het bord, de prijsopbouw en de kaarten gebruiken de rij van vandaag.
  const { todayIdx, tomorrow } = splitDays(recent, brusselsToday());
  const today = todayIdx >= 0 ? recent[todayIdx] : null;
  const fodMax = lastKnown(recent, todayIdx, "max");
  const fodOnder2000 = lastKnown(recent, todayIdx, "maxOnder2000");
  const crude = lastKnown(recent, todayIdx, "crude");
  const wti = lastKnown(recent, todayIdx, "wti");

  if (loading || !today || fodMax.value == null) {
    return <div className="wrap"><p style={{ padding: 24 }}>Prijzen laden…</p></div>;
  }

  // Prijsopbouw wordt nu afgeleid van de échte cijfers van vandaag i.p.v. vaste,
  // verouderde bedragen — het totaal moet altijd exact gelijk zijn aan het bord bovenaan.
  // Markt-component komt rechtstreeks uit de live HO=F-omrekening (laatst bekende slotkoers).
  // Marge/accijnzen behouden hun onderlinge verhouding (bevestigd, zie opdrachtdocument §2.2),
  // maar worden herschaald zodat (markt + marge + accijnzen) * 1.21 exact de FOD-prijs oplevert.
  const total = fodMax.value;
  const productMarkt = crude.value;
  const subtotaalExclBtw = total / 1.21;
  const margeEnAccijnzenTotaal = Math.max(subtotaalExclBtw - (productMarkt ?? 0), 0);
  const MARGE_RATIO = 0.2 / (0.2 + 0.28); // oorspronkelijke verhouding: 0,20 marge / 0,28 accijnzen
  const distributieMarge = margeEnAccijnzenTotaal * MARGE_RATIO;
  const accijnzen = margeEnAccijnzenTotaal * (1 - MARGE_RATIO);
  const btw = total - subtotaalExclBtw;
  const breakdown = [
    { label: "Productprijs/markt", value: productMarkt, color: "#8C6A3F" },
    { label: "Distributiemarge", value: distributieMarge, color: "#6E5A8C" },
    { label: "Accijnzen/energieheffing (incl. overige bijdragen)", value: accijnzen, color: "#B4472B" },
    { label: "BTW (21%)", value: btw, color: "#5B6E63" },
  ];

  const deltaMax = fodMax.value - fodMax.prev;
  const deltaCrude = crude.value != null ? crude.value - crude.prev : null;

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
          letter-spacing: -0.01em; margin: 0 0 8px; text-align: center; text-wrap: balance; }
        h1 .quote { color: var(--amber-dim); }
        .lead-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 17px; line-height: 1.35;
          color: var(--ink); text-align: center; text-wrap: balance; max-width: 560px; margin: 4px auto 6px; }
        .subtitle { font-size: 14px; font-weight: 400; color: var(--ink-soft); line-height: 1.6; max-width: 560px;
          text-align: center; text-wrap: balance; margin: 0 auto 20px; }
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
        .board-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; flex-wrap: wrap; gap: 10px; font-size: 13px; }
        .delta { font-family: 'IBM Plex Mono', monospace; font-size: 13px; display: inline-flex; align-items: center;
          gap: 4px; padding: 3px 8px; border-radius: 20px; }
        .delta-down { color: #9BD6AE; background: rgba(75,123,91,0.18); }
        .delta-up { color: #E8A48C; background: rgba(180,71,43,0.2); }
        .delta-down-light { color: #2F6B45; background: rgba(75,123,91,0.14); }
        .delta-up-light { color: #93331A; background: rgba(180,71,43,0.14); }
        .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 26px; }
        @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
        .card { background: var(--paper-2); border: 1px solid var(--hair); border-radius: 8px; padding: 16px 16px 14px; }
        .card-num { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
        .card-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; margin: 4px 0 10px; }
        .card-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 22px; font-variant-numeric: tabular-nums; margin-bottom: 6px; }
        .card-note { font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
        .wti-link { display: inline-block; margin-top: 6px; font-size: 12px; font-family: 'IBM Plex Mono', monospace;
          color: var(--amber-dim); text-decoration: none; border-bottom: 1px dashed var(--amber-dim); }
        .wti-link:hover { color: var(--ink); border-bottom-color: var(--ink); }
        .section { margin-bottom: 30px; }
        .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px;
          border-bottom: 1px solid var(--hair); padding-bottom: 8px; flex-wrap: wrap; gap: 8px; }
        .section-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 17px; }
        .stackbar { display: flex; width: 100%; height: 28px; border-radius: 5px; overflow: hidden; margin-bottom: 16px; border: 1px solid var(--hair); }
        .breakdown-list { display: flex; flex-direction: column; gap: 8px; }
        .breakdown-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; padding: 7px 0; border-bottom: 1px dashed var(--hair); }
        .breakdown-row:last-child { border-bottom: none; font-weight: 700; }
        /* Enkel de omschrijving mag afbreken; het bedrag + eenheid blijft samen rechts staan. */
        .breakdown-label { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
        .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
        .breakdown-value { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums;
          white-space: nowrap; flex-shrink: 0; text-align: right; margin-left: auto; }
        .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .seg { display: flex; border: 1px solid var(--hair); border-radius: 6px; overflow: hidden; }
        .seg button { font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 6px 12px; background: transparent; border: none; cursor: pointer; color: var(--ink-soft); }
        .seg button + button { border-left: 1px solid var(--hair); }
        .seg button.active { background: var(--board); color: var(--amber); }
        .raw-btn { display: inline-flex; align-items: center; gap: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
          background: transparent; border: 1px solid var(--hair); border-radius: 6px; padding: 6px 12px; cursor: pointer; color: var(--ink); }
        .raw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .date-input { font-family: 'IBM Plex Mono', monospace; font-size: 12px; border: 1px solid var(--hair);
          border-radius: 6px; padding: 5px 8px; background: var(--paper); color: var(--ink); }
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
        .footer-link { color: var(--ink-soft); text-decoration: underline; }
        .footer-link:hover { color: var(--ink); }
        /* Blok "morgen": tekstkleuren donker genoeg voor de lichte achtergrond (≥ 4.5:1). */
        .tomorrow { --t-accent: #57544A; display: flex; gap: 16px; align-items: flex-start; background: #F4F1E8;
          border: 1px solid var(--hair); border-left: 6px solid var(--t-accent); border-radius: 10px;
          padding: 18px 20px; margin-bottom: 22px; }
        .t-down { --t-accent: #2F6B45; }
        .t-up { --t-accent: #93331A; }
        .t-same, .t-mixed, .t-neutral { --t-accent: #57544A; }
        .tomorrow-icon { flex-shrink: 0; width: 52px; height: 52px; border-radius: 50%; display: flex;
          align-items: center; justify-content: center; background: var(--t-accent); color: #FFFFFF; }
        .tomorrow-body { flex: 1; min-width: 0; }
        .tomorrow-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: clamp(19px, 3.4vw, 24px);
          line-height: 1.2; color: var(--t-accent); margin: 2px 0 6px; }
        .tomorrow-when { font-size: 14px; color: var(--ink); margin: 0 0 10px; }
        .tomorrow-lines { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px;
          font-size: 14px; line-height: 1.45; color: var(--ink); }
        .tomorrow-lines li { display: flex; align-items: flex-start; gap: 6px; }
        .tomorrow-lines strong { font-family: 'IBM Plex Mono', monospace; font-weight: 500; font-variant-numeric: tabular-nums; }
        .tomorrow-lines li[class] strong, .tomorrow-line-icon { color: var(--t-accent); }
        .tomorrow-line-icon { flex-shrink: 0; margin-top: 2px; }
        .tomorrow-source { font-size: 11.5px; color: var(--ink-soft); margin: 0; }
        .tomorrow-unknown { font-size: 14px; color: var(--ink); margin: 0; }
        @media (max-width: 480px) {
          .tomorrow { padding: 14px; gap: 12px; }
          .tomorrow-icon { width: 40px; height: 40px; }
          .tomorrow-icon svg { width: 24px; height: 24px; }
        }
      `}</style>

      <div className="container">
        <div className="eyebrow">
          <span>FOD/SPF Finance · dagelijkse maximumprijs</span>
          <span>{fmtIso(today.date, { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
        </div>

        <h1>Belgische <span className="quote">"mazout"</span> prijzen &amp; trends</h1>
        <h2 className="lead-title">Zie vandaag al waar de mazoutprijs van morgen naartoe gaat.</h2>
        <p className="subtitle">
          De FOD Financiën publiceert de maximumprijs voor morgen al vandaag. Hier zie je meteen
          of hij stijgt of daalt, samen met de beweging van de stookoliemarkt.
        </p>

        <TomorrowBlock todayMax={fodMax.value} todayOnder2000={fodOnder2000.value} tomorrow={tomorrow} />

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
            <span>€ {fodMax.value.toFixed(4)}</span>
            <span className="unit">/ liter</span>
          </div>
          <div className="board-bottom">
            <span>t.o.v. vorige dag</span>
            <Delta value={deltaMax} />
          </div>
          {fodOnder2000.value != null && (
            <div className="board-bottom" style={{ marginTop: 4 }}>
              <span style={{ opacity: 0.8 }}>Tarief &lt; 2000 L</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 13 }}>€ {fodOnder2000.value.toFixed(4)} / L</span>
            </div>
          )}
        </div>

        <div className="cards">
          <div className="card">
            <div className="card-num">01 — markt</div>
            <div className="card-title">Marktprijs (HO=F, omgerekend)</div>
            <div className="card-value">{fmt(crude.value)}</div>
            <Delta value={deltaCrude} onLight />
          </div>
          <div className="card">
            <div className="card-num">02 — officieel</div>
            <div className="card-title">Maximumprijs (FOD/SPF Finance)</div>
            <div className="card-value">{fmt(fodMax.value)}</div>
            <Delta value={deltaMax} onLight />
          </div>
          <div className="card">
            <div className="card-num">03 — WTI</div>
            <div className="card-title">Ruwe olie (WTI)</div>
            <div className="card-value">€{wti.value != null ? wti.value.toFixed(2) : "—"}<span style={{fontSize:12}}> USD/vat</span></div>
            <a
              href="https://www.usmarkets.nl/koersen/wti-olie"
              target="_blank"
              rel="noopener noreferrer"
              className="wti-link"
            >
              Volg de WTI-koers →
            </a>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="section-title">Prijsopbouw &amp; specificatie</span>
            <span>per liter</span>
          </div>
          <div className="stackbar">
            {breakdown.filter((b) => b.value != null).map((b) => (
              <div key={b.label} style={{ width: `${(b.value / total) * 100}%`, background: b.color }} title={`${b.label}: ${fmt(b.value)}`} />
            ))}
          </div>
          <div className="breakdown-list">
            {breakdown.map((b) => (
              <div className="breakdown-row" key={b.label}>
                <span className="breakdown-label"><span className="swatch" style={{ background: b.color }} />{b.label}</span>
                <span className="breakdown-value">{fmtNoBreak(b.value)}</span>
              </div>
            ))}
            <div className="breakdown-row">
              <span className="breakdown-label">Officiële FOD maximumprijs</span>
              <span className="breakdown-value">{fmtNoBreak(total)}</span>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="section-title">Prijstrend</span>
            <div className="controls">
              <div className="seg">
                <button className={range === 30 ? "active" : ""} onClick={() => { setShowCustomPicker(false); setRange(30); }}>30D</button>
                <button className={range === 90 ? "active" : ""} onClick={() => { setShowCustomPicker(false); setRange(90); }}>90D</button>
                <button className={isCustomMode || showCustomPicker ? "active" : ""} onClick={() => setShowCustomPicker(true)}>Van–tot</button>
              </div>
              <button className="raw-btn" onClick={() => setShowRaw(true)}><Table2 size={13} /> Ruwe data <ChevronDown size={12} /></button>
            </div>
          </div>
          {showCustomPicker && (
            <div className="controls" style={{ marginBottom: 10 }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="date-input"
              />
              <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>tot</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="date-input"
              />
              <button className="raw-btn" onClick={applyCustomRange} disabled={!customFrom || !customTo}>
                Toepassen
              </button>
            </div>
          )}
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
                <Tooltip formatter={(v, name) => [v == null ? "—" : chartMode === "level" ? fmt(v) : `${v} (basis 100)`, name]} contentStyle={{ background: "#1C1A16", border: "none", borderRadius: 6 }} itemStyle={{ fontSize: 12, color: "#E9E4D6" }} />
                <Line type="monotone" dataKey="max" name="FOD maximumprijs" stroke="#B4472B" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="crude" name="HO=F (markt)" stroke="#5B6E63" strokeWidth={1.5} dot={false} connectNulls />
                {chartMode === "index" && <Line type="monotone" dataKey="wti" name="Ruwe olie (WTI)" stroke="#F0A93B" strokeWidth={1.5} dot={false} strokeDasharray="4 3" connectNulls />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <footer>
          "Mazout" is het Belgische woord voor stookolie. Data ververst dagelijks via een
          GitHub Actions-job (yfinance + FOD Economie).
          <br /><br />
          Website is ontwikkeld en wordt ter beschikking gesteld door{" "}
          <a href="https://vandersteen.be" target="_blank" rel="noopener noreferrer" className="footer-link">
            vandersteen.be
          </a>
          . Contact:{" "}
          <a href="mailto:jacq@vandersteen.be" className="footer-link">jacq@vandersteen.be</a>
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
                    <tr key={row.date}><td>{row.label}</td><td>{row.wti?.toFixed(2) ?? "—"}</td><td>{row.crude?.toFixed(4) ?? "—"}</td><td>{row.max?.toFixed(4) ?? "—"}</td></tr>
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
