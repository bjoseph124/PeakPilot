"""Commercial storage experiments, explicitly synthetic and not investment advice.

All power is AC-side kW; stored energy is DC-side kWh. For interval t:
    grid[t] = load[t] + charge[t] - discharge[t] >= 0
    E[t+1] = E[t] + dt*(eta_c*charge[t] - discharge[t]/eta_d)
Binary z enforces charge <= P*z and discharge <= P*(1-z).
The MILP minimizes TOU energy + monthly maximum-demand + AC throughput cost.
Every midnight has a minimum energy reserve equal to the initial energy. This
prevents free depletion without crediting any leftover energy. Forecast replay
tracks planned SOC, corrects observed peaks, and preserves midnight reachability,
carrying actual energy into the next day's plan. The perfect-foresight solve has
the same midnight floors. Current-interval load feedback is idealized: there is
no sensor latency or within-interval variation model.
"""
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Dict, Optional
import time

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

DT = 0.25
SEED = 42
BUILDINGS = {
    "office": {"name": "Meridian Tower", "type": "Commercial office", "area": "125,000 sq ft", "scale": 1.0, "seed": 42},
    "retail": {"name": "Westside Commons", "type": "Retail center", "area": "92,000 sq ft", "scale": 0.82, "seed": 73},
    "warehouse": {"name": "Northline Logistics", "type": "Distribution center", "area": "180,000 sq ft", "scale": 1.18, "seed": 109},
}


@dataclass(frozen=True)
class Battery:
    capacity_kwh: float = 500.0
    power_kw: float = 200.0
    round_trip_efficiency: float = 0.9
    initial_fraction: float = 0.5
    throughput_cost: float = 0.008  # $ per AC kWh charged OR discharged

    def __post_init__(self):
        values = asdict(self)
        if not all(np.isfinite(x) for x in values.values()):
            raise ValueError("Battery parameters must be finite.")
        if self.capacity_kwh <= 0 or self.power_kw <= 0:
            raise ValueError("Battery capacity and power must be positive.")
        if not 0 < self.round_trip_efficiency <= 1 or not 0 <= self.initial_fraction <= 1:
            raise ValueError("Efficiency must be in (0, 1] and initial fraction in [0, 1].")
        if self.throughput_cost < 0:
            raise ValueError("Throughput cost cannot be negative.")

    @property
    def eta(self) -> float:
        return float(np.sqrt(self.round_trip_efficiency))

    @property
    def reserve(self) -> float:
        return self.capacity_kwh * self.initial_fraction


@dataclass(frozen=True)
class Tariff:
    energy_price: float = 0.12  # off-peak $/kWh
    demand_charge: float = 24.0  # $/kW per calendar month, NOT per day
    peak_multiplier: float = 2.5

    def __post_init__(self):
        if not all(np.isfinite(x) and x >= 0 for x in asdict(self).values()):
            raise ValueError("Tariff values must be finite and nonnegative.")
        if self.peak_multiplier < 1:
            raise ValueError("Peak multiplier must be at least one.")

    def rates(self, index: pd.DatetimeIndex) -> np.ndarray:
        peak = (index.dayofweek < 5) & (index.hour >= 14) & (index.hour < 20)
        return np.where(peak, self.energy_price * self.peak_multiplier, self.energy_price)


@dataclass
class Dispatch:
    charge: np.ndarray
    discharge: np.ndarray
    energy: np.ndarray  # n+1 interval-boundary states
    grid: np.ndarray
    solver_gap: float = 0.0
    objective: Optional[float] = None


def validate_series(load: np.ndarray, index: pd.DatetimeIndex) -> None:
    if not len(load) or len(load) != len(index) or np.ndim(load) != 1:
        raise ValueError("Load must be a nonempty 1-D array matching timestamps.")
    if not np.isfinite(load).all() or np.any(load < 0):
        raise ValueError("Load must contain finite, nonnegative kW values.")
    if index.hasnans or index.has_duplicates or not index.is_monotonic_increasing:
        raise ValueError("Timestamps must be unique, chronological, and nonmissing.")
    if index.tz is not None:
        raise ValueError("Use timezone-naive local standard time; DST is not modeled.")
    if len(index) > 1 and not np.all(np.diff(index.asi8) == 900_000_000_000):
        raise ValueError("Expected uninterrupted 15-minute intervals.")


def synthetic_load(building: str = "office") -> pd.DataFrame:
    """91 days, 15-minute interval-average kW, local standard time.

    Original seed-controlled simulation; no measured data or external data source.
    Occupancy, cooling, weekday effects, correlated noise, and intermittent
    equipment events deliberately make next-day peaks imperfectly predictable.
    """
    if building not in BUILDINGS:
        raise ValueError("Unknown building.")
    config = BUILDINGS[building]
    rng = np.random.default_rng(config["seed"])
    index = pd.date_range("2025-04-01", "2025-07-01", freq="15min", inclusive="left")
    hour = np.asarray(index.hour + index.minute / 60)
    day = np.arange(len(index)) // 96
    weekday = np.asarray(index.dayofweek < 5)
    shift = 2 if building == "retail" else (-1 if building == "warehouse" else 0)
    occupancy = 1 / (1 + np.exp(-(hour - 7.3 - shift) * 1.8)) - 1 / (1 + np.exp(-(hour - 19 - shift) * 1.1))
    weather = 22 + 5 * np.sin(day / 5.5) + 0.06 * day + np.repeat(rng.normal(0, 1.6, 91), 96)
    cooling = np.maximum(weather - 19, 0) * 6 * np.exp(-((hour - 15.5) / 4.8) ** 2)
    daily = np.repeat(rng.normal(1, 0.035, 91), 96)
    noise = np.convolve(rng.normal(0, 5, len(index) + 4), np.ones(5) / 2.24, mode="valid")
    process_peak = (50 + 26 * np.sin(day / 3.8) ** 2) * np.exp(-((hour - 16.25) / 1.0) ** 2) * weekday
    events = np.zeros(len(index))
    for d in range(91):
        if rng.random() < 0.22:
            start = d * 96 + int(rng.integers(40, 72))
            events[start:start + 3] += rng.uniform(15, 42)
    load = (95 + 195 * occupancy * np.where(weekday, 1, 0.42) * daily + cooling + process_peak + noise + events) * config["scale"]
    return pd.DataFrame({"load_kw": np.round(np.maximum(load, 30), 3)}, index=index)


def features(load: pd.Series) -> pd.DataFrame:
    """Each day's features use only readings strictly before that day's midnight.

    lag_96 and lag_672 are yesterday and last week's matching quarter-hour.
    A trailing average of matching quarter-hours uses the preceding seven days.
    Calendar terms are known at issuance; no weather oracle or target-day lag.
    """
    idx = load.index
    slot = idx.hour + idx.minute / 60
    past = pd.concat([load.shift(96 * d) for d in range(1, 8)], axis=1)
    return pd.DataFrame({
        "previous_day": load.shift(96), "previous_week": load.shift(672),
        "trailing_week": past.mean(axis=1, skipna=False),
        "hour_sin": np.sin(2 * np.pi * slot / 24),
        "hour_cos": np.cos(2 * np.pi * slot / 24),
        "weekday": idx.dayofweek, "is_weekday": (idx.dayofweek < 5).astype(int),
    }, index=idx)


def forecast(frame: pd.DataFrame, split: str = "2025-06-01") -> dict:
    validate_series(frame.load_kw.to_numpy(), frame.index)
    split_time = pd.Timestamp(split)
    if split_time != split_time.normalize():
        raise ValueError("A day-ahead forecasting split must be at midnight.")
    x = features(frame.load_kw)
    valid = x.notna().all(axis=1)
    train = (frame.index < pd.Timestamp(split)) & valid
    test = frame.index >= pd.Timestamp(split)
    if train.sum() < 96 * 14 or not test.any() or not valid[test].all():
        raise ValueError("Forecasting requires at least 21 training days and a valid holdout.")
    model = HistGradientBoostingRegressor(max_iter=110, max_leaf_nodes=15,
        learning_rate=0.07, l2_regularization=4, random_state=SEED,
        early_stopping=False)  # Never let a larger dataset enable a random validation split.
    model.fit(x.loc[train], frame.load_kw.loc[train])
    prediction = np.maximum(model.predict(x.loc[test]), 0)
    baseline = x.loc[test, "previous_week"].to_numpy()
    actual = frame.load_kw.loc[test].to_numpy()
    return {
        "prediction": prediction, "baseline": baseline,
        "mae_kw": float(mean_absolute_error(actual, prediction)),
        "baseline_mae_kw": float(mean_absolute_error(actual, baseline)),
        "rmse_kw": float(np.sqrt(mean_squared_error(actual, prediction))),
        "train_samples": int(train.sum()), "test_samples": int(test.sum()),
        "train_end": str(frame.index[train][-1]), "test_start": str(frame.index[test][0]),
    }


def bill(grid: np.ndarray, index: pd.DatetimeIndex, tariff: Tariff,
         charge: Optional[np.ndarray] = None, discharge: Optional[np.ndarray] = None,
         throughput_cost: float = 0) -> dict:
    validate_series(grid, index)
    if not np.isfinite(throughput_cost) or throughput_cost < 0:
        raise ValueError("Throughput cost must be finite and nonnegative.")
    if (charge is None) != (discharge is None):
        raise ValueError("Provide both charging and discharging arrays, or neither.")
    if charge is not None:
        charge, discharge = np.asarray(charge), np.asarray(discharge)
        for power in (charge, discharge):
            if power.shape != np.asarray(grid).shape or not np.isfinite(power).all() or np.any(power < 0):
                raise ValueError("Throughput arrays must match grid shape and be finite, nonnegative kW.")
    months = index.to_period("M")
    peaks = {str(m): float(np.max(grid[months == m])) for m in months.unique()}
    energy = float(np.dot(grid, tariff.rates(index)) * DT)
    demand = sum(peaks.values()) * tariff.demand_charge
    wear = 0.0 if charge is None else float(np.sum(charge + discharge) * DT * throughput_cost)
    return {"energy": energy, "demand": demand, "bill": energy + demand,
            "throughput": wear, "operating_cost": energy + demand + wear,
            "import_kwh": float(np.sum(grid) * DT), "peak_kw": float(np.max(grid)), "monthly_peaks": peaks}


def optimize(load: np.ndarray, index: pd.DatetimeIndex, battery: Battery,
             tariff: Tariff, initial_kwh: Optional[float] = None,
             prior_peaks: Optional[Dict[str, float]] = None, time_limit: float = 30) -> Dispatch:
    """HiGHS MILP with sparse constraints; never return an unchecked incumbent."""
    load = np.asarray(load, dtype=float)
    validate_series(load, index)
    initial = battery.reserve if initial_kwh is None else initial_kwh
    if not np.isfinite(initial) or not 0 <= initial <= battery.capacity_kwh:
        raise ValueError("Initial stored energy is outside battery bounds.")
    prior_peaks = prior_peaks or {}
    if any(not np.isfinite(v) or v < 0 for v in prior_peaks.values()):
        raise ValueError("Prior month peaks must be finite and nonnegative.")
    n = len(load)
    months = index.to_period("M")
    unique = months.unique()
    # [charge(n), discharge(n), energy(n+1), binary mode(n), month peaks(m)]
    e0, z0, p0 = 2 * n, 3 * n + 1, 4 * n + 1
    size = p0 + len(unique)
    objective = np.zeros(size)
    rates = tariff.rates(index)
    objective[:n] = DT * (rates + battery.throughput_cost)
    objective[n:2*n] = DT * (-rates + battery.throughput_cost)
    objective[p0:] = tariff.demand_charge
    lower, upper = np.zeros(size), np.full(size, np.inf)
    upper[:2*n] = battery.power_kw
    upper[e0:z0] = battery.capacity_kwh
    lower[e0] = upper[e0] = initial
    upper[z0:p0] = 1
    for t in range(n):
        if t == n - 1 or index[t + 1].date() != index[t].date():
            lower[e0 + t + 1] = battery.reserve
    for k, month in enumerate(unique):
        lower[p0 + k] = prior_peaks.get(str(month), 0)
    integrality = np.zeros(size)
    integrality[z0:p0] = 1
    matrix = lil_matrix((5 * n, size), dtype=float)
    lo, hi = np.full(5 * n, -np.inf), np.zeros(5 * n)
    month_ids = {m: k for k, m in enumerate(unique)}
    for t in range(n):
        row = 5 * t
        matrix[row, e0+t+1], matrix[row, e0+t] = 1, -1
        matrix[row, t], matrix[row, n+t] = -DT * battery.eta, DT / battery.eta
        lo[row] = hi[row] = 0
        matrix[row+1, t], matrix[row+1, z0+t] = 1, -battery.power_kw
        matrix[row+2, n+t], matrix[row+2, z0+t] = 1, battery.power_kw
        hi[row+2] = battery.power_kw
        matrix[row+3, t], matrix[row+3, n+t] = 1, -1
        lo[row+3], hi[row+3] = -load[t], np.inf
        matrix[row+4, t], matrix[row+4, n+t] = 1, -1
        matrix[row+4, p0+month_ids[months[t]]] = -1
        hi[row+4] = -load[t]
    result = milp(objective, integrality=integrality, bounds=Bounds(lower, upper),
        constraints=LinearConstraint(matrix.tocsc(), lo, hi),
        options={"time_limit": time_limit, "mip_rel_gap": 0.0001})
    if not result.success or result.x is None:
        raise RuntimeError(f"Dispatch solver did not certify a solution: {result.message}")
    c, d = result.x[:n].copy(), result.x[n:2*n].copy()
    c[np.abs(c) < 1e-8] = 0
    d[np.abs(d) < 1e-8] = 0
    dispatch = Dispatch(c, d, result.x[e0:z0], np.maximum(load+c-d, 0),
                        float(result.mip_gap), float(result.fun + np.dot(load, rates)*DT))
    validate_dispatch(dispatch, load, index, battery, initial)
    return dispatch


def validate_dispatch(d: Dispatch, load: np.ndarray, index: pd.DatetimeIndex,
                      battery: Battery, initial: Optional[float] = None) -> None:
    tol = 2e-5
    initial = battery.reserve if initial is None else initial
    arrays = [d.charge, d.discharge, d.energy, d.grid]
    if any(not np.isfinite(a).all() for a in arrays):
        raise ValueError("Dispatch has nonfinite values.")
    if any(len(a) != len(load) for a in [d.charge, d.discharge, d.grid]) or len(d.energy) != len(load)+1:
        raise ValueError("Dispatch dimensions are inconsistent.")
    if abs(d.energy[0]-initial) > tol:
        raise ValueError("Incorrect initial state of charge.")
    residual = np.diff(d.energy) - DT*(battery.eta*d.charge-d.discharge/battery.eta)
    if np.max(np.abs(residual)) > tol or np.max(np.abs(d.grid-load-d.charge+d.discharge)) > tol:
        raise ValueError("Energy or grid-power conservation violated.")
    if min(d.charge.min(), d.discharge.min(), d.grid.min(), d.energy.min()) < -tol:
        raise ValueError("Negative power, stored energy, or grid export.")
    if max(d.charge.max(), d.discharge.max()) > battery.power_kw+tol or d.energy.max() > battery.capacity_kwh+tol:
        raise ValueError("Battery power or energy bound exceeded.")
    if np.any((d.charge > tol) & (d.discharge > tol)):
        raise ValueError("Simultaneous charging and discharging.")
    for t in range(len(load)):
        if t == len(load)-1 or index[t+1].date() != index[t].date():
            if d.energy[t+1] < battery.reserve-tol:
                raise ValueError("Midnight energy reserve violated.")


def replay(plan: Dispatch, actual: np.ndarray, battery: Battery, initial: float) -> Dispatch:
    """Causal safety filter. No actual future reading influences today's plan.

    Track planned SOC, but cap charging at the planned day's grid peak using the
    current observed load. This prevents forecast error from ratcheting a monthly
    peak upward during charging. A reachability guard preserves enough remaining
    charging time to meet the midnight reserve (reserve takes priority over cap).
    No future actual reading is used. Setpoints are interval averages.
    """
    c, d, e = np.zeros(len(actual)), np.zeros(len(actual)), np.zeros(len(actual)+1)
    e[0] = initial
    grid_cap = float(plan.grid.max())
    for t in range(len(actual)):
        target = plan.energy[t+1]
        if target > e[t]:
            c[t] = min(battery.power_kw, (target-e[t])/(battery.eta*DT), max(0, grid_cap-actual[t]))
        else:
            d[t] = min(battery.power_kw, (e[t]-target)*battery.eta/DT, actual[t])
        # Correct an observed peak immediately, borrowing from planned SOC.
        # Only the current interval's reading is needed; recharge follows later.
        if actual[t] > grid_cap:
            c[t] = 0
            d[t] = min(battery.power_kw, max(d[t], actual[t]-grid_cap), actual[t], e[t]*battery.eta/DT)
        remaining = len(actual)-t-1
        minimum_next = max(0, battery.reserve-remaining*battery.power_kw*battery.eta*DT)
        next_e = e[t]+DT*(battery.eta*c[t]-d[t]/battery.eta)
        if next_e < minimum_next:
            if e[t] < minimum_next:
                d[t] = 0
                c[t] = min(battery.power_kw, (minimum_next-e[t])/(battery.eta*DT))
            else:
                d[t] = min(d[t], (e[t]-minimum_next)*battery.eta/DT)
        c[t] = min(c[t], max(0, (battery.capacity_kwh-e[t])/(battery.eta*DT)))
        e[t+1] = e[t]+DT*(battery.eta*c[t]-d[t]/battery.eta)
    return Dispatch(c, d, e, np.maximum(actual+c-d, 0))


def forecast_dispatch(actual: np.ndarray, prediction: np.ndarray, index: pd.DatetimeIndex,
                      battery: Battery, tariff: Tariff) -> Dispatch:
    charge, discharge, energy = [], [], [battery.reserve]
    peaks: Dict[str, float] = {}
    for day in index.normalize().unique():
        mask = index.normalize() == day
        idx = index[mask]
        plan = optimize(prediction[mask], idx, battery, tariff, energy[-1], peaks)
        executed = replay(plan, actual[mask], battery, energy[-1])
        validate_dispatch(executed, actual[mask], idx, battery, energy[-1])
        charge.extend(executed.charge)
        discharge.extend(executed.discharge)
        energy.extend(executed.energy[1:])
        key = str(idx[0].to_period("M"))
        peaks[key] = max(peaks.get(key, 0), float(executed.grid.max()))
    c, d = np.array(charge), np.array(discharge)
    result = Dispatch(c, d, np.array(energy), np.maximum(actual+c-d, 0))
    validate_dispatch(result, actual, index, battery)
    return result


def rule_dispatch(load: np.ndarray, index: pd.DatetimeIndex, battery: Battery,
                  threshold: float) -> Dispatch:
    """Transparent baseline: charge 00–06, shave above TRAINING-set 85th percentile.

    Retains the reserve all day. It is deliberately simple, not an optimized rule.
    """
    c, d, e = np.zeros(len(load)), np.zeros(len(load)), np.zeros(len(load)+1)
    e[0] = battery.reserve
    for t, stamp in enumerate(index):
        if stamp.hour < 6:
            c[t] = min(battery.power_kw, max(0, (battery.capacity_kwh-e[t])/(DT*battery.eta)))
        elif 12 <= stamp.hour < 21:
            d[t] = min(battery.power_kw, max(0, load[t]-threshold), max(0, (e[t]-battery.reserve)*battery.eta/DT))
        e[t+1] = e[t]+DT*(c[t]*battery.eta-d[t]/battery.eta)
    result = Dispatch(c, d, e, np.maximum(load+c-d, 0))
    validate_dispatch(result, load, index, battery)
    return result


@lru_cache(maxsize=3)
def building_forecast(building: str):
    frame = synthetic_load(building)
    result = forecast(frame)
    return frame, result


def simulate(building: str = "office", battery: Battery = Battery(), tariff: Tariff = Tariff()) -> dict:
    start = time.perf_counter()
    frame, model = building_forecast(building)
    test = frame.loc["2025-06-01":]
    actual, index = test.load_kw.to_numpy(), test.index
    threshold = float(frame.loc[frame.index < index[0], "load_kw"].quantile(0.85))
    realistic = forecast_dispatch(actual, model["prediction"], index, battery, tariff)
    oracle = optimize(actual, index, battery, tariff)
    rule = rule_dispatch(actual, index, battery, threshold)
    base = bill(actual, index, tariff)
    comparisons = {"baseline": base}
    for name, dispatch in [("rule", rule), ("forecast", realistic), ("oracle", oracle)]:
        comparisons[name] = bill(dispatch.grid, index, tariff, dispatch.charge, dispatch.discharge, battery.throughput_cost)
        comparisons[name]["end_energy_kwh"] = float(dispatch.energy[-1])
    saving = base["bill"]-comparisons["forecast"]["bill"]
    net_saving = base["bill"]-comparisons["forecast"]["operating_cost"]
    capital = battery.capacity_kwh*350 + battery.power_kw*150 + 15000
    om = capital*0.015
    # A repeated-month scenario, NOT measured annual savings or a seasonality model.
    illustrative_annual_net = net_saving*12-om
    peak_t = int(actual.argmax())
    demand_saving = base["demand"]-comparisons["forecast"]["demand"]
    energy_saving = base["energy"]-comparisons["forecast"]["energy"]
    peak_change = base["peak_kw"]-comparisons["forecast"]["peak_kw"]
    peak_effect = "reduces" if peak_change >= 0 else "increases"
    cycles = float(realistic.discharge.sum()*DT/battery.eta/battery.capacity_kwh)
    rows = []
    for t, stamp in enumerate(index):
        rows.append({"timestamp": stamp.isoformat(), "load": float(actual[t]),
            "forecast": float(model["prediction"][t]), "grid": float(realistic.grid[t]),
            "oracle": float(oracle.grid[t]), "rule": float(rule.grid[t]),
            "soc": float(realistic.energy[t]/battery.capacity_kwh*100),
            "soc_end": float(realistic.energy[t+1]/battery.capacity_kwh*100),
            "charge": float(realistic.charge[t]), "discharge": float(realistic.discharge[t]),
            "rate": float(tariff.rates(index[t:t+1])[0])})
    return {
        "building": {"id": building, **{k: v for k, v in BUILDINGS[building].items() if k != "seed" and k != "scale"}},
        "battery": asdict(battery), "tariff": asdict(tariff), "series": rows,
        "period": {"start": "2025-06-01", "end": "2025-06-30", "days": 30, "interval_minutes": 15,
                   "label": "June 2025 · full billing month", "focus_date": str(index[peak_t].date())},
        "metrics": {"peak_reduction_pct": (1-comparisons["forecast"]["peak_kw"]/base["peak_kw"])*100,
            "peak_reduction_kw": base["peak_kw"]-comparisons["forecast"]["peak_kw"],
            "bill_savings": saving, "net_operating_savings": net_saving,
            "demand_savings": demand_saving, "energy_savings": energy_saving,
            "optimized_peak_kw": comparisons["forecast"]["peak_kw"],
            "utilization_pct": float((realistic.energy.max()-realistic.energy.min())/battery.capacity_kwh*100),
            "equivalent_cycles": cycles},
        "comparison": comparisons,
        "forecasting": {k: v for k, v in model.items() if k not in ("prediction", "baseline")},
        "economics": {"capital_cost": capital, "annual_om": om,
            "illustrative_annual_net": illustrative_annual_net,
            "simple_payback_years": capital/illustrative_annual_net if illustrative_annual_net > 0 else None,
            "assumption": "Illustration only: repeat June net operating savings 12 times, less 1.5% annual capital O&M. No seasonal, financing, tax, replacement, or incentive model."},
        "insights": [
            {"title": "The afternoon is the opportunity" if peak_change >= 0 else "Charging raises the monthly peak", "text": f"The highest observed load is {actual.max():.1f} kW on {index[peak_t]:%b %d at %H:%M}. Dispatch {peak_effect} the month's grid peak by {abs(peak_change):.1f} kW."},
            {"title": "Demand charges lead" if demand_saving >= energy_saving else "Energy shifting leads", "text": f"Modeled demand savings are ${demand_saving:,.0f}; TOU energy savings are ${energy_saving:,.0f}. Charging shifts consumption toward ${tariff.energy_price:.2f}/kWh intervals."},
            {"title": "A forecast is not foresight", "text": f"Day-ahead MAE is {model['mae_kw']:.1f} kW. Unpredicted peaks can set the entire month's demand charge; the controller cannot undo them."},
        ],
        "method": {"dispatch": "Day-ahead MILP, evaluated against actual synthetic loads", "solver": "SciPy / HiGHS MILP",
            "oracle_gap": oracle.solver_gap, "rule_threshold_kw": threshold, "runtime_seconds": time.perf_counter()-start,
            "notes": ["Original synthetic profiles, not measured utility data.", "Forecast fit once on April–May; June forecasts issued daily with prior observations only.",
                "No grid export. Every midnight retains at least the 50% initial reserve; leftover energy receives no credit.",
                "TOU: weekdays 14:00–20:00 at 2.5× the off-peak rate. Demand charge: one calendar-month maximum.",
                "Utilization means observed SOC range / nameplate capacity, not a power capacity factor."]},
    }
