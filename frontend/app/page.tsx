"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BatteryCharging,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileJson,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  Menu,
  Play,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  X,
  Zap,
} from "lucide-react";
import type { Result, Row, Scenario } from "./types";

const defaults: Scenario = {
  building: "office",
  capacity_kwh: 500,
  power_kw: 200,
  efficiency: 0.9,
  energy_price: 0.12,
  demand_charge: 24,
};
const currency = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(n);
const number = (n: number, digits = 1) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
const nav = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Load Intelligence", icon: Activity },
  { label: "Battery Optimization", icon: BatteryCharging },
  { label: "Financial Analysis", icon: BarChart3 },
  { label: "Scenario Explorer", icon: SlidersHorizontal },
  { label: "Settings", icon: Settings2 },
];
const colors = { grid: "#32dab2", load: "#a1adc2", forecast: "#9691f7" };

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string;
    value?: number | string;
    color?: string;
  }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <b>{label}</b>
      {payload.map((p) => (
        <div key={p.name}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>
            {number(Number(p.value))} {p.name?.includes("SOC") ? "%" : "kW"}
          </strong>
        </div>
      ))}
    </div>
  );
}

function MiniSpark({
  values,
  color = "#32dab2",
}: {
  values: number[];
  color?: string;
}) {
  const lo = Math.min(...values),
    hi = Math.max(...values);
  const points = values
    .map(
      (v, i) =>
        `${(i * 94) / Math.max(1, values.length - 1)},${30 - ((v - lo) / (hi - lo || 1)) * 24}`,
    )
    .join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 96 34" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScenarioControls({
  scenario,
  setScenario,
  compact = false,
}: {
  scenario: Scenario;
  setScenario: React.Dispatch<React.SetStateAction<Scenario>>;
  compact?: boolean;
}) {
  const controls: {
    key: keyof Omit<Scenario, "building">;
    name: string;
    min: number;
    max: number;
    step: number;
    unit: string;
    factor?: number;
  }[] = [
    {
      key: "capacity_kwh",
      name: "Battery capacity",
      min: 50,
      max: 1500,
      step: 50,
      unit: "kWh",
    },
    {
      key: "power_kw",
      name: "Power rating",
      min: 25,
      max: 500,
      step: 25,
      unit: "kW",
    },
    {
      key: "energy_price",
      name: "Off-peak energy",
      min: 0.01,
      max: 0.5,
      step: 0.01,
      unit: "$/kWh",
    },
    {
      key: "demand_charge",
      name: "Demand charge",
      min: 0,
      max: 60,
      step: 1,
      unit: "$/kW",
    },
    {
      key: "efficiency",
      name: "Round-trip efficiency",
      min: 0.7,
      max: 0.99,
      step: 0.01,
      unit: "%",
      factor: 100,
    },
  ];
  return (
    <div className={compact ? "controls compact" : "controls"}>
      {controls.map((c) => (
        <div className="control" key={c.key}>
          <label htmlFor={c.key}>{c.name}</label>
          <input
            id={c.key}
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={scenario[c.key]}
            onChange={(e) =>
              setScenario((s) => ({ ...s, [c.key]: Number(e.target.value) }))
            }
            style={
              {
                "--fill": `${((scenario[c.key] - c.min) / (c.max - c.min)) * 100}%`,
              } as React.CSSProperties
            }
          />
          <output htmlFor={c.key}>
            {number(scenario[c.key] * (c.factor || 1), 2)} <span>{c.unit}</span>
          </output>
        </div>
      ))}
    </div>
  );
}

function FinancialPanel({
  data,
  expanded = false,
}: {
  data: Result;
  expanded?: boolean;
}) {
  const base = data.comparison.baseline,
    optimized = data.comparison.forecast;
  const max = Math.max(base.bill, optimized.bill);
  return (
    <section className="panel finance-panel">
      <div className="panel-heading">
        <div>
          <h2>Electricity cost breakdown</h2>
          <p>
            June billing period <span className="dot-separator">·</span> USD
          </p>
        </div>
        <BarChart3 size={17} className="muted" />
      </div>
      <div className="cost-bars">
        {[
          { label: "No battery", cost: base, dim: true },
          { label: "With PeakPilot", cost: optimized, dim: false },
        ].map((item) => (
          <div className="cost-row" key={item.label}>
            <div className="cost-label">
              <span>{item.label}</span>
              <strong>{currency(item.cost.bill)}</strong>
            </div>
            <div className={`cost-track ${item.dim ? "baseline" : ""}`}>
              <div
                className="energy-segment"
                style={{ width: `${(item.cost.energy / max) * 100}%` }}
              />
              <div
                className="demand-segment"
                style={{ width: `${(item.cost.demand / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="cost-legend">
        <span>
          <i className="legend-square energy" /> Energy charges
        </span>
        <span>
          <i className="legend-square demand" /> Demand charges
        </span>
      </div>
      <div className="savings-row">
        <span>
          Demand savings{" "}
          <strong>{currency(data.metrics.demand_savings)}</strong>
        </span>
        <span>
          Energy savings{" "}
          <strong>{currency(data.metrics.energy_savings)}</strong>
        </span>
        <span className={data.metrics.bill_savings < 0 ? "loss" : "green"}>
          Bill savings <strong>{currency(data.metrics.bill_savings)}</strong>
        </span>
      </div>
      {expanded && (
        <div className="finance-details">
          <p>
            Throughput allowance: <b>{currency(optimized.throughput, 2)}</b> at
            $0.008 per AC kWh charged or discharged.
          </p>
          <p>
            Net operating savings after throughput:{" "}
            <b>{currency(data.metrics.net_operating_savings, 2)}</b>.
          </p>
          <p>
            All strategies are billed against actual holdout demand, including
            all charging losses.
          </p>
        </div>
      )}
    </section>
  );
}

function Comparison({ data }: { data: Result }) {
  const labels = {
    baseline: "No battery",
    rule: "Rule-based",
    forecast: "Forecast-driven",
    oracle: "Perfect foresight",
  };
  return (
    <section className="panel comparison">
      <div className="panel-heading">
        <div>
          <h2>Four strategies. One actual load profile.</h2>
          <p>
            Theoretical optimization has access to future loads; the forecast
            controller does not.
          </p>
        </div>
        <ShieldCheck size={19} className="green" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dispatch strategy</th>
              <th>Peak demand</th>
              <th>Energy charges</th>
              <th>Demand charges</th>
              <th>Throughput cost</th>
              <th>Net savings</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => {
              const c = data.comparison[key];
              return (
                <tr
                  key={key}
                  className={key === "forecast" ? "selected-row" : ""}
                >
                  <td>
                    {labels[key]}
                    {key === "oracle" && (
                      <small>Theoretical upper bound on net savings</small>
                    )}
                  </td>
                  <td>{number(c.peak_kw)} kW</td>
                  <td>{currency(c.energy)}</td>
                  <td>{currency(c.demand)}</td>
                  <td>{currency(c.throughput)}</td>
                  <td
                    className={
                      data.comparison.baseline.bill < c.operating_cost
                        ? "loss"
                        : "green"
                    }
                  >
                    {currency(data.comparison.baseline.bill - c.operating_cost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="panel-footnote">
        Same initial energy and midnight reserve. Final stored energy receives
        no salvage credit. MILP optimality tolerance: 0.01%.
      </p>
    </section>
  );
}

export default function Dashboard() {
  const [scenario, setScenario] = useState<Scenario>(defaults);
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("Overview");
  const [day, setDay] = useState("");
  const [showForecast, setShowForecast] = useState(true);
  const [showMethod, setShowMethod] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [rerun, setRerun] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (s: Scenario) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
        signal: abort.signal,
      });
      if (!response.ok) {
        const issue = await response.json().catch(() => ({}));
        throw new Error(
          typeof issue.detail === "string"
            ? issue.detail
            : "The simulation could not finish. Check that the Python API is running and try again.",
        );
      }
      const result: Result = await response.json();
      if (!abort.signal.aborted) {
        setData(result);
        setDay((d) => d || result.period.focus_date);
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Unable to connect to the simulation engine.",
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    controller.current?.abort();
    setBusy(true);
    const timer = setTimeout(() => run(scenario), 450);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [scenario, rerun, run]);
  useEffect(() => {
    if (!showMethod) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMethod(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [showMethod]);

  const rows = useMemo(
    () =>
      data?.series
        .filter((r) => r.timestamp.startsWith(day))
        .map((r) => ({
          ...r,
          time: r.timestamp.slice(11, 16),
          net: r.discharge - r.charge,
        })) || [],
    [data, day],
  );
  const days = useMemo(
    () =>
      Array.from(
        new Set(data?.series.map((r) => r.timestamp.slice(0, 10)) || []),
      ),
    [data],
  );
  const dailyPeaks = useMemo(
    () =>
      days.map((date) =>
        Math.max(
          ...(data?.series
            .filter((r) => r.timestamp.startsWith(date))
            .map((r) => r.grid) || [0]),
        ),
      ),
    [data, days],
  );
  const changeDay = (offset: number) => {
    const i = days.indexOf(day);
    setDay(days[Math.max(0, Math.min(days.length - 1, i + offset))]);
  };
  const exportJSON = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `peakpilot-${data.building.id}-june-2025.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadChart = (
    <section
      className={`panel load-panel ${fullscreen ? "expanded-chart" : ""}`}
    >
      <div className="panel-heading">
        <div>
          <h2>
            Demand, intelligently reshaped{" "}
            <span className="unit-badge">kW</span>
          </h2>
          <p>Actual building demand vs. forecast-driven battery dispatch</p>
        </div>
        <div className="chart-tools">
          <div className="day-picker">
            <button
              onClick={() => changeDay(-1)}
              disabled={day === days[0]}
              aria-label="Previous day"
            >
              <ChevronLeft size={14} />
            </button>
            <select
              aria-label="Chart date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </option>
              ))}
            </select>
            <button
              onClick={() => changeDay(1)}
              disabled={day === days[days.length - 1]}
              aria-label="Next day"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <button
            className="icon-button expand-button"
            onClick={() => setFullscreen(!fullscreen)}
            aria-label={fullscreen ? "Close expanded chart" : "Expand chart"}
          >
            {fullscreen ? <X size={16} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>
      <div className="chart-legend">
        <span>
          <i style={{ background: colors.load }} /> Building load
        </span>
        <span>
          <i style={{ background: colors.grid }} /> Optimized grid import
        </span>
        <button
          aria-pressed={showForecast}
          onClick={() => setShowForecast(!showForecast)}
          className={!showForecast ? "dimmed" : ""}
        >
          <i className="dashed" /> Day-ahead forecast
        </button>
        <span className="peak-legend">
          <i /> On-peak tariff
        </span>
      </div>
      <div className="main-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 20, right: 20, left: -18, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gridFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.grid} stopOpacity={0.17} />
                <stop
                  offset="100%"
                  stopColor={colors.grid}
                  stopOpacity={0.005}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="#243043"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="time"
              ticks={[
                "00:00",
                "04:00",
                "08:00",
                "12:00",
                "16:00",
                "20:00",
                "23:45",
              ]}
              tick={{ fill: "#8795aa", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              dy={9}
            />
            <YAxis
              tick={{ fill: "#8795aa", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              domain={[0, (max: number) => Math.ceil(max / 50) * 50]}
              tickCount={5}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "#56637b", strokeDasharray: "3 3" }}
            />
            {rows.some((r) => r.rate > (data?.tariff.energy_price || 0)) && (
              <ReferenceArea
                x1="14:00"
                x2="20:00"
                fill="#a297ff"
                fillOpacity={0.045}
                strokeOpacity={0}
              />
            )}
            <Area
              type="monotone"
              dataKey="grid"
              name="Grid import"
              tooltipType="none"
              fill="url(#gridFill)"
              stroke="none"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="load"
              name="Building load"
              stroke={colors.load}
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
            {showForecast && (
              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke={colors.forecast}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="grid"
              name="Optimized grid"
              stroke={colors.grid}
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 4, stroke: "#0c1622", strokeWidth: 3 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-footer">
        <span>
          <span className="status-dot" /> Simulated dispatch. Actual-load
          evaluation.
        </span>
        <span>
          15-minute intervals <span className="dot-separator">·</span> Local
          standard time
        </span>
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setView("Overview");
          }}
        >
          <span className="brand-icon">
            <Zap size={22} fill="currentColor" />
          </span>
          PeakPilot<span className="brand-period">.</span>
        </a>
        <div className="workspace-label">INTELLIGENCE WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.label}
              className={view === item.label ? "active" : ""}
              onClick={() => {
                setView(item.label);
                setMobileNav(false);
              }}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.label === "Overview" && <span className="nav-key">01</span>}
            </button>
          ))}
        </nav>
        <div className="simulation-card">
          <span className="eyebrow">CURRENT SIMULATION</span>
          <div>
            <span
              className={`status-dot ${busy ? "working" : error ? "failed" : ""}`}
            />
            {busy
              ? "Computing scenario"
              : error
                ? "Needs attention"
                : "Simulation complete"}
          </div>
          <p>
            {data?.building.name || "Meridian Tower"}
            <br />
            June 2025 · 30 days
          </p>
          <span className="scenario-tag">
            <FlaskConical size={12} /> Synthetic demo
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="engine-note">
            <ShieldCheck size={17} />
            <div>
              Grounded in physics<span>Powered by SciPy / HiGHS</span>
            </div>
          </div>
          <button onClick={() => setShowMethod(true)}>
            <CircleHelp size={16} /> Methodology & assumptions
          </button>
          <div className="workspace-person">
            <div className="avatar">PP</div>
            <div>
              Research workspace<span>Open-source edition</span>
            </div>
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>

      <main>
        <div className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={12} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span className="synthetic-badge">
              <FlaskConical size={12} /> Synthetic Demo Data
            </span>
            <span className="top-divider" />
            <button onClick={exportJSON} disabled={!data || busy}>
              <Download size={14} /> Export results
            </button>
            <button
              className="avatar top-avatar"
              onClick={() => setShowMethod(true)}
              aria-label="About this research workspace"
            >
              PP
            </button>
          </div>
        </div>
        <div className="main-content">
          <header className="page-header">
            <div>
              <div className="eyebrow page-eyebrow">
                STORAGE INTELLIGENCE, IN FOCUS
              </div>
              <h1>
                {view === "Overview" ? "Energy Intelligence Overview" : view}
              </h1>
              <p>Forecast demand. Optimize storage. Unlock grid value.</p>
            </div>
            <div className="header-actions">
              <label className="property-select">
                <Building2 size={16} />
                <select
                  aria-label="Commercial property"
                  value={scenario.building}
                  onChange={(e) => {
                    setDay("");
                    setScenario((s) => ({ ...s, building: e.target.value }));
                  }}
                >
                  <option value="office">Meridian Tower</option>
                  <option value="retail">Westside Commons</option>
                  <option value="warehouse">Northline Logistics</option>
                </select>
                <ChevronDown size={13} />
              </label>
              <div className="date-range">
                <CalendarDays size={15} />
                <span>Jun 1 – 30, 2025</span>
              </div>
              <button
                className="run-button"
                disabled={busy}
                onClick={() => setRerun((n) => n + 1)}
              >
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {busy ? "Optimizing…" : "Run Optimization"}
              </button>
            </div>
          </header>
          {error && (
            <div role="alert" className="error-banner">
              <span>
                {error}{" "}
                {data
                  ? "Displayed results are from the last successful simulation."
                  : ""}
              </span>
              <button onClick={() => setRerun((n) => n + 1)}>Retry</button>
            </div>
          )}
          {!data ? (
            <div className="initial-state">
              <div className="initial-mark">
                <Zap size={30} />
              </div>
              <h2>
                {error
                  ? "The engine is not connected yet"
                  : "Finding a smarter energy profile"}
              </h2>
              <p>
                {error
                  ? "Start the FastAPI service on port 8000, then retry."
                  : "Training the demand model and solving the battery dispatch problem."}
              </p>
              {!error && <div className="loading-line" />}
            </div>
          ) : (
            <div
              aria-busy={busy}
              className={busy ? "results updating" : "results"}
            >
              <div className="summary-line">
                <span>
                  <Building2 size={13} /> {data.building.type} <i />{" "}
                  {data.building.area} <i /> {data.period.label}
                </span>
                <span className="model-label">
                  <span className="status-dot" />
                  {busy ? "Updating results…" : "Forecast-driven dispatch"}
                  <span className="muted"> / actual-load evaluation</span>
                </span>
              </div>
              <section className="kpi-grid" aria-label="Simulation metrics">
                <article className="kpi">
                  <div className="kpi-top">
                    {data.metrics.peak_reduction_kw < -0.00001
                      ? "Peak Demand Increase"
                      : "Peak Demand Reduction"}
                    <TrendingDown size={16} />
                  </div>
                  <div className="metric-line">
                    <strong>
                      {number(Math.abs(data.metrics.peak_reduction_pct))}
                      <em>%</em>
                    </strong>
                    <MiniSpark values={dailyPeaks} />
                  </div>
                  <div className="kpi-bottom">
                    <span
                      className={
                        data.metrics.peak_reduction_kw < -0.00001
                          ? "metric-tag loss"
                          : "metric-tag"
                      }
                    >
                      {data.metrics.peak_reduction_kw < -0.00001 ? (
                        <ArrowUpRight size={12} />
                      ) : (
                        <ArrowDownRight size={12} />
                      )}
                      {number(Math.abs(data.metrics.peak_reduction_kw))} kW
                    </span>
                    <span>
                      {data.metrics.peak_reduction_kw < -0.00001
                        ? "above baseline peak"
                        : "below baseline peak"}
                    </span>
                  </div>
                </article>
                <article className="kpi">
                  <div className="kpi-top">
                    Modeled Bill Savings
                    <BarChart3 size={16} />
                  </div>
                  <div className="metric-line">
                    <strong>{currency(data.metrics.bill_savings)}</strong>
                    <span className="metric-period">/ month</span>
                  </div>
                  <div className="kpi-bottom">
                    <span
                      className={
                        data.metrics.bill_savings < 0
                          ? "metric-tag loss"
                          : "metric-tag"
                      }
                    >
                      {number(
                        (Math.abs(data.metrics.bill_savings) /
                          data.comparison.baseline.bill) *
                          100,
                      )}
                      {data.metrics.bill_savings < 0
                        ? "% cost increase"
                        : "% savings"}
                    </span>
                    <span>energy + demand</span>
                  </div>
                </article>
                <article className="kpi">
                  <div className="kpi-top">
                    Battery Utilization
                    <BatteryCharging size={16} />
                  </div>
                  <div className="metric-line">
                    <strong>
                      {number(data.metrics.utilization_pct, 0)}
                      <em>%</em>
                    </strong>
                    <div className="util-bars">
                      {Array.from({ length: 16 }, (_, i) => (
                        <i
                          key={i}
                          style={{
                            opacity:
                              (i / 16) * 100 < data.metrics.utilization_pct
                                ? 1
                                : 0.15,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="kpi-bottom">
                    <span className="tiny-green-dot" />
                    <span>SOC range / capacity</span>
                    <span className="subtle">
                      {number(data.metrics.equivalent_cycles)} cycles
                    </span>
                  </div>
                </article>
                <article className="kpi">
                  <div className="kpi-top">
                    Optimized Peak Demand
                    <Gauge size={16} />
                  </div>
                  <div className="metric-line">
                    <strong>
                      {number(data.metrics.optimized_peak_kw)}
                      <em>kW</em>
                    </strong>
                    <MiniSpark values={dailyPeaks} color="#928bf1" />
                  </div>
                  <div className="kpi-bottom">
                    <span className="subtle">Baseline</span>
                    <span>{number(data.comparison.baseline.peak_kw)} kW</span>
                    <span className="metric-tag violet">Monthly max</span>
                  </div>
                </article>
              </section>

              {(view === "Overview" ||
                view === "Load Intelligence" ||
                view === "Battery Optimization") && (
                <div className="chart-grid">
                  {loadChart}
                  <section className="panel battery-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Battery intelligence</h2>
                        <p>Stored energy & dispatch</p>
                      </div>
                      <BatteryCharging size={18} className="green" />
                    </div>
                    <div className="battery-top">
                      <div className="battery-glyph">
                        <div
                          style={{
                            width: `${rows[rows.length - 1]?.soc_end || 0}%`,
                          }}
                        />
                        <Zap size={20} />
                      </div>
                      <div>
                        <strong>
                          {number(rows[rows.length - 1]?.soc_end || 0, 0)}
                          <span>%</span>
                        </strong>
                        <p>End-of-day charge</p>
                      </div>
                      <span className="reserve-badge">50% reserve</span>
                    </div>
                    <div className="soc-label">
                      <span>STATE OF CHARGE</span>
                      <span>0 – 100%</span>
                    </div>
                    <div className="soc-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={[
                            ...rows.map((r) => ({ ...r, boundarySoc: r.soc })),
                            ...(rows.length
                              ? [
                                  {
                                    ...rows[rows.length - 1],
                                    time: "24:00",
                                    boundarySoc: rows[rows.length - 1].soc_end,
                                  },
                                ]
                              : []),
                          ]}
                          margin={{ top: 5, right: 0, bottom: 0, left: 0 }}
                        >
                          <defs>
                            <linearGradient
                              id="socFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="#39d9bf"
                                stopOpacity={0.16}
                              />
                              <stop
                                offset="100%"
                                stopColor="#39d9bf"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <YAxis domain={[0, 100]} hide />
                          <XAxis
                            dataKey="time"
                            ticks={["00:00", "08:00", "16:00", "24:00"]}
                            tick={{ fill: "#8795aa", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <ReferenceLine
                            y={50}
                            stroke="#384553"
                            strokeDasharray="3 4"
                          />
                          <Tooltip content={<ChartTooltip />} />
                          <Area
                            type="linear"
                            dataKey="boundarySoc"
                            name="SOC"
                            stroke="#32dab2"
                            strokeWidth={1.8}
                            fill="url(#socFill)"
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div
                      className="dispatch-strip"
                      aria-label="Quarter-hour charging and discharging timeline"
                    >
                      {rows.map((r: Row) => (
                        <i
                          key={r.timestamp}
                          title={`${r.timestamp.slice(11, 16)}: ${r.charge > 0.01 ? `charging ${number(r.charge)} kW` : r.discharge > 0.01 ? `discharging ${number(r.discharge)} kW` : "idle"}`}
                          className={
                            r.charge > 0.01
                              ? "charging"
                              : r.discharge > 0.01
                                ? "discharging"
                                : "idle"
                          }
                        />
                      ))}
                    </div>
                    <div className="timeline-legend">
                      <span>
                        <i className="charging" /> Charging
                      </span>
                      <span>
                        <i className="discharging" /> Discharging
                      </span>
                      <span>
                        <i className="idle" /> Idle
                      </span>
                    </div>
                    <div className="battery-specs">
                      <div>
                        <span>Capacity</span>
                        <strong>
                          {data.battery.capacity_kwh} <small>kWh</small>
                        </strong>
                      </div>
                      <div>
                        <span>Power</span>
                        <strong>
                          {data.battery.power_kw} <small>kW</small>
                        </strong>
                      </div>
                      <div>
                        <span>Round-trip η</span>
                        <strong>
                          {number(data.battery.round_trip_efficiency * 100, 0)}
                          <small>%</small>
                        </strong>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {view === "Overview" && (
                <div className="bottom-grid">
                  <FinancialPanel data={data} />
                  <section className="panel insights-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          <Sparkles size={16} className="violet-text" /> Storage
                          Opportunity Analysis
                        </h2>
                        <p>Computed findings. Clear decisions.</p>
                      </div>
                      <span className="logic-badge">DETERMINISTIC</span>
                    </div>
                    <div className="insights">
                      {data.insights.map((insight, i) => (
                        <div className="insight" key={insight.title}>
                          <span className={`insight-number insight-${i}`}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <h3>{insight.title}</h3>
                            <p>{insight.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="panel scenario-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Shape your scenario</h2>
                        <p>Adjust inputs. Explore the impact.</p>
                      </div>
                      <SlidersHorizontal size={17} className="muted" />
                    </div>
                    <ScenarioControls
                      scenario={scenario}
                      setScenario={setScenario}
                      compact
                    />
                    <div className="control-foot">
                      <span>
                        <span className="status-dot" /> Inputs recalculate
                        automatically
                      </span>
                      <button
                        onClick={() => {
                          setDay("");
                          setScenario({ ...defaults });
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {view === "Load Intelligence" && (
                <section className="panel detail-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Forecasts with an honest holdout</h2>
                      <p>
                        Histogram gradient boosting · fixed hyperparameters · no
                        random train/test split
                      </p>
                    </div>
                    <Activity size={18} />
                  </div>
                  <div className="detail-metrics">
                    <div>
                      <span>Model MAE</span>
                      <strong>
                        {number(data.forecasting.mae_kw, 2)} <small>kW</small>
                      </strong>
                    </div>
                    <div>
                      <span>Same-time-last-week MAE</span>
                      <strong>
                        {number(data.forecasting.baseline_mae_kw, 2)}{" "}
                        <small>kW</small>
                      </strong>
                    </div>
                    <div>
                      <span>Model RMSE</span>
                      <strong>
                        {number(data.forecasting.rmse_kw, 2)} <small>kW</small>
                      </strong>
                    </div>
                    <div>
                      <span>Evaluated intervals</span>
                      <strong>
                        {number(data.forecasting.test_samples, 0)}
                      </strong>
                    </div>
                  </div>
                  <p>
                    Fit on April–May 2025. June predictions are issued one day
                    at a time using yesterday, the same weekday last week, a
                    trailing seven-day profile, and calendar features. Prior
                    holdout days become observations at subsequent forecast
                    origins; target-day loads never enter the features.
                  </p>
                  <p className="muted">
                    Synthetic out-of-sample accuracy does not establish accuracy
                    on real commercial properties.
                  </p>
                </section>
              )}
              {(view === "Battery Optimization" ||
                view === "Scenario Explorer") && <Comparison data={data} />}
              {view === "Financial Analysis" && (
                <>
                  <div className="detail-columns">
                    <FinancialPanel data={data} expanded />
                    <section className="panel detail-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Investment sensitivity</h2>
                          <p>Illustrative capital assumptions, not a quote</p>
                        </div>
                      </div>
                      <dl className="economics-list">
                        <div>
                          <dt>Installed capital</dt>
                          <dd>{currency(data.economics.capital_cost)}</dd>
                        </div>
                        <div>
                          <dt>Annual O&M assumption</dt>
                          <dd>{currency(data.economics.annual_om)}</dd>
                        </div>
                        <div>
                          <dt>Repeated-June annual net</dt>
                          <dd>
                            {currency(data.economics.illustrative_annual_net)}
                          </dd>
                        </div>
                        <div>
                          <dt>Illustrative simple payback</dt>
                          <dd>
                            {data.economics.simple_payback_years
                              ? `${number(data.economics.simple_payback_years)} years`
                              : "No positive payback"}
                          </dd>
                        </div>
                      </dl>
                      <p className="assumption-note">
                        {data.economics.assumption}
                      </p>
                      <p className="muted">
                        Capital = $350/kWh + $150/kW + $15,000 fixed
                        installation. A full year of utility data is needed
                        before investment screening.
                      </p>
                    </section>
                  </div>
                  <Comparison data={data} />
                </>
              )}
              {view === "Scenario Explorer" && (
                <section className="panel detail-panel scenario-explorer">
                  <div className="panel-heading">
                    <div>
                      <h2>Test the tradeoffs</h2>
                      <p>
                        Each adjustment reruns the same load profile through the
                        numerical engine.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setDay("");
                        setScenario({ ...defaults });
                      }}
                    >
                      Restore defaults
                    </button>
                  </div>
                  <ScenarioControls
                    scenario={scenario}
                    setScenario={setScenario}
                  />
                  <p className="muted">
                    More power is not always more valuable. Energy capacity,
                    demand timing, tariff spread, and forecast error jointly
                    determine savings.
                  </p>
                </section>
              )}
              {view === "Settings" && (
                <section className="panel detail-panel settings-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Transparent by design</h2>
                      <p>
                        No account, API key, or external AI service required.
                      </p>
                    </div>
                    <ShieldCheck size={21} className="green" />
                  </div>
                  <dl className="economics-list">
                    <div>
                      <dt>Simulation engine</dt>
                      <dd>SciPy / HiGHS mixed-integer solver</dd>
                    </div>
                    <div>
                      <dt>Data provenance</dt>
                      <dd>Original synthetic generation · fixed seeds</dd>
                    </div>
                    <div>
                      <dt>Time convention</dt>
                      <dd>Local standard time · DST excluded</dd>
                    </div>
                    <div>
                      <dt>Data persistence</dt>
                      <dd>In-memory demo cache; no saved personal data</dd>
                    </div>
                    <div>
                      <dt>Solver tolerance</dt>
                      <dd>0.01% relative optimality gap</dd>
                    </div>
                  </dl>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      onClick={() => setShowMethod(true)}
                    >
                      Read methodology
                    </button>
                    <button className="secondary-button" onClick={exportJSON}>
                      <FileJson size={16} /> Download full calculation
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => window.print()}
                    >
                      <Download size={16} /> Print / save PDF
                    </button>
                  </div>
                </section>
              )}
              <footer className="dashboard-footer">
                <span>
                  <ShieldCheck size={13} /> Physically constrained dispatch{" "}
                  <i /> No grid export <i /> {number(data.forecasting.mae_kw)}{" "}
                  kW forecast MAE
                </span>
                <div>
                  <button onClick={() => setShowMethod(true)}>
                    Assumptions & methodology <ArrowUpRight size={12} />
                  </button>
                  <span className="footer-divider" />
                  <button onClick={() => window.print()} disabled={busy}>
                    <Download size={12} /> Save PDF
                  </button>
                </div>
              </footer>
            </div>
          )}
        </div>
      </main>
      {showMethod && (
        <div className="modal-backdrop" onClick={() => setShowMethod(false)}>
          <section
            className="method-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="method-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="modal-close icon-button"
              aria-label="Close methodology"
              onClick={() => setShowMethod(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow green">THE NUMBERS, EXPLAINED</span>
            <h2 id="method-title">Intelligence you can inspect.</h2>
            <p>
              This is a reproducible research demo. Every metric comes from
              Python calculations, and every load profile is synthetic.
            </p>
            <ul>
              {(
                data?.method.notes || ["The simulation engine is starting."]
              ).map((note) => (
                <li key={note}>
                  <Check size={16} />
                  {note}
                </li>
              ))}
            </ul>
            <h3>What is optimized?</h3>
            <p>
              Minimize TOU energy charges + monthly maximum-demand charges +
              battery throughput cost, subject to energy conservation, power and
              energy limits, binary charge/discharge exclusivity, and no export.
            </p>
            <h3>What is not modeled?</h3>
            <p>
              Export revenue, ancillary services, tariff ratchets, holidays,
              seasonal rates, detailed degradation, financing, taxes, and
              warranties. Insights are deterministic templates, not an LLM
              assessment.
            </p>
            <button className="run-button" onClick={() => setShowMethod(false)}>
              Back to dashboard
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
