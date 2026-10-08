"""Independent physics/billing checks, analytic cases, leakage and API regressions."""
import asyncio
import httpx
import numpy as np
import pandas as pd
import pytest
from peakpilot.api import app
from peakpilot.engine import (Battery, Tariff, Dispatch, DT, bill, features, forecast,
    optimize, replay, simulate, synthetic_load, validate_dispatch, validate_series)


def timestamps(n=96, start="2025-06-02"):
    return pd.date_range(start, periods=n, freq="15min")


def test_kw_to_kwh_and_energy_price_units():
    cost = bill(np.full(4, 100.0), timestamps(4), Tariff(0.20, 0))
    assert cost["import_kwh"] == pytest.approx(100)
    assert cost["energy"] == pytest.approx(20)


def test_demand_charge_once_per_month_not_per_day():
    cost = bill(np.full(96*30, 100.0), timestamps(96*30, "2025-06-01"), Tariff(0, 24))
    assert cost["demand"] == pytest.approx(2400)
    assert cost["bill"] == pytest.approx(2400)


def test_month_boundary_billed_separately():
    idx = timestamps(4, "2025-06-30 23:30")
    cost = bill(np.array([10., 20., 30., 25.]), idx, Tariff(0, 5))
    assert cost["monthly_peaks"] == {"2025-06": 20., "2025-07": 30.}
    assert cost["demand"] == 250


def test_tou_boundaries_and_weekend():
    idx = pd.DatetimeIndex(["2025-06-02 13:45", "2025-06-02 14:00", "2025-06-02 19:45", "2025-06-02 20:00", "2025-06-07 15:00"])
    np.testing.assert_allclose(Tariff(.1, 0).rates(idx), [.1, .25, .25, .1, .1])


def test_analytic_peak_shaving_optimum():
    # Four quarter-hours, 10 kWh total load. Shift 5 kWh at eta=1;
    # 10 kW power caps make a 10 kW peak the best possible outcome.
    load, idx = np.array([0., 20., 0., 20.]), timestamps(4)
    b, t = Battery(10, 10, 1), Tariff(.2, 10)
    d = optimize(load, idx, b, t)
    cost = bill(d.grid, idx, t, d.charge, d.discharge, b.throughput_cost)
    assert d.grid.max() == pytest.approx(10)
    assert d.energy[-1] >= b.reserve-1e-6
    assert cost["energy"] == pytest.approx(2)
    assert cost["demand"] == pytest.approx(100)
    assert cost["throughput"] == pytest.approx(10*b.throughput_cost)
    assert d.objective == pytest.approx(cost["operating_cost"])


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_random_dispatch_physics_and_objective(seed):
    rng = np.random.default_rng(seed)
    load, idx = rng.uniform(25, 150, 96), timestamps()
    b, tariff = Battery(90, 45, .81), Tariff(.12, 24)
    d = optimize(load, idx, b, tariff)
    np.testing.assert_allclose(d.grid, load+d.charge-d.discharge, atol=1e-6)
    np.testing.assert_allclose(np.diff(d.energy), .25*(.9*d.charge-d.discharge/.9), atol=1e-6)
    assert np.all(d.charge >= -1e-7) and np.all(d.discharge >= -1e-7)
    assert max(d.charge.max(), d.discharge.max()) <= b.power_kw+1e-6
    assert d.energy.min() >= -1e-6 and d.energy.max() <= b.capacity_kwh+1e-6
    assert d.grid.min() >= -1e-6
    assert not np.any((d.charge > 1e-6) & (d.discharge > 1e-6))
    assert d.energy[0] == pytest.approx(b.reserve)
    assert d.energy[-1] >= b.reserve-1e-6
    # Independent round-trip loss accounting, including any retained energy.
    charge_kwh, discharge_kwh = d.charge.sum()*DT, d.discharge.sum()*DT
    stored_change = d.energy[-1]-d.energy[0]
    assert discharge_kwh == pytest.approx(b.eta*(b.eta*charge_kwh-stored_change), abs=1e-5)
    cost = bill(d.grid, idx, tariff, d.charge, d.discharge, b.throughput_cost)
    assert d.objective == pytest.approx(cost["operating_cost"], abs=1e-5)
    assert cost["operating_cost"] <= bill(load, idx, tariff)["bill"]+1e-5


def test_prior_peak_is_a_floor_in_the_objective():
    load, idx = np.full(4, 10.), timestamps(4)
    battery, tariff = Battery(), Tariff(.1, 10)
    d = optimize(load, idx, battery, tariff, prior_peaks={"2025-06": 200})
    assert d.objective == pytest.approx(1+2000)
    assert d.charge.sum()+d.discharge.sum() == pytest.approx(0)


def test_flat_tariff_and_no_demand_charge_does_not_cycle():
    load, idx = np.full(96, 100.), timestamps(96, "2025-06-07")
    d = optimize(load, idx, Battery(), Tariff(.1, 0))
    assert np.sum(d.charge+d.discharge) == pytest.approx(0, abs=1e-6)


def test_zero_load_never_exports_or_manufactures_savings():
    load, idx = np.zeros(96), timestamps()
    d = optimize(load, idx, Battery(), Tariff())
    assert d.grid.sum() == pytest.approx(0)
    assert d.energy[-1] == pytest.approx(Battery().reserve)


def test_impossible_terminal_reserve_is_rejected():
    with pytest.raises(RuntimeError, match="solver"):
        optimize(np.zeros(1), timestamps(1), Battery(100, 1), Tariff(), initial_kwh=0)


@pytest.mark.parametrize("value", [-1., np.nan, np.inf])
def test_invalid_load_rejected(value):
    with pytest.raises(ValueError):
        optimize(np.array([value]), timestamps(1), Battery(), Tariff())


def test_irregular_duplicate_and_timezone_timestamps_rejected():
    for idx in [pd.DatetimeIndex(["2025-06-01", "2025-06-01"]),
                pd.DatetimeIndex(["2025-06-01", "2025-06-01 00:30"]),
                timestamps(2).tz_localize("UTC")]:
        with pytest.raises(ValueError):
            validate_series(np.ones(2), idx)


def test_invalid_battery_and_tariff_rejected():
    for kwargs in [{"capacity_kwh": 0}, {"power_kw": -1}, {"round_trip_efficiency": 1.1}, {"throughput_cost": -1}, {"initial_fraction": 1.1}]:
        with pytest.raises(ValueError):
            Battery(**kwargs)
    with pytest.raises(ValueError):
        Tariff(demand_charge=-1)


def test_validation_catches_broken_energy_conservation():
    load, idx, b = np.full(4, 100.), timestamps(4), Battery()
    d = Dispatch(np.zeros(4), np.zeros(4), np.array([250., 251., 250., 250., 250.]), load)
    with pytest.raises(ValueError, match="conservation"):
        validate_dispatch(d, load, idx, b)


@pytest.mark.parametrize("actual_level", [0., 10., 250., 700.])
def test_forecast_replay_safety_even_for_extreme_forecast_errors(actual_level):
    idx, b = timestamps(), Battery(100, 30, .85)
    predicted = 100+70*np.sin(np.arange(96)/96*np.pi)**2
    plan = optimize(predicted, idx, b, Tariff())
    actual = np.full(96, actual_level)
    executed = replay(plan, actual, b, b.reserve)
    validate_dispatch(executed, actual, idx, b)


def test_causal_controller_does_not_read_future_actuals():
    idx, b = timestamps(), Battery()
    predicted = np.full(96, 100.)
    plan = optimize(predicted, idx, b, Tariff())
    changed = predicted.copy(); changed[48:] = 2000
    original = replay(plan, predicted, b, b.reserve)
    alternate = replay(plan, changed, b, b.reserve)
    np.testing.assert_allclose(original.charge[:48], alternate.charge[:48])
    np.testing.assert_allclose(original.discharge[:48], alternate.discharge[:48])


def test_forecast_features_cannot_see_the_issuance_day():
    frame = synthetic_load()
    original = features(frame.load_kw)
    modified = frame.load_kw.copy()
    modified.loc["2025-06-10":] *= 10
    changed = features(modified)
    pd.testing.assert_frame_equal(original.loc["2025-06-10"], changed.loc["2025-06-10"])
    assert original.loc["2025-06-10 23:45", "previous_day"] == frame.loc["2025-06-09 23:45", "load_kw"]


def test_fitting_and_first_day_forecast_do_not_use_holdout_targets():
    frame = synthetic_load()
    first = forecast(frame)
    changed = frame.copy(); changed.loc["2025-06-01":, "load_kw"] *= 1.5
    second = forecast(changed)
    np.testing.assert_allclose(first["prediction"][:96], second["prediction"][:96])
    assert pd.Timestamp(first["train_end"]) < pd.Timestamp(first["test_start"])
    assert first["test_samples"] == 30*96
    assert first["train_samples"] == 54*96


def test_synthetic_data_reproducible():
    pd.testing.assert_frame_equal(synthetic_load(), synthetic_load())
    assert len(synthetic_load()) == 91*96
    assert not synthetic_load("retail").equals(synthetic_load("office"))


def test_full_month_integration_and_oracle_bound():
    result = simulate()
    costs = result["comparison"]
    # Forecast and rule trajectories satisfy the oracle's feasible set.
    for key in ["baseline", "rule", "forecast"]:
        assert costs["oracle"]["operating_cost"] <= costs[key]["operating_cost"]+1
    assert result["metrics"]["bill_savings"] == pytest.approx(costs["baseline"]["bill"]-costs["forecast"]["bill"])
    assert result["metrics"]["net_operating_savings"] == pytest.approx(result["metrics"]["bill_savings"]-costs["forecast"]["throughput"])
    assert len(result["series"]) == 2880
    assert costs["forecast"]["end_energy_kwh"] >= 250-1e-5


def test_api_validation_and_health():
    async def check_endpoints():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/health")).json()["engine"] == "scipy-highs"
            for payload in [{"capacity_kwh": -1}, {"building": "not-a-building"}, {"efficiency": 0}, {"unknown": 1}]:
                assert (await client.post("/simulate", json=payload)).status_code == 422
    asyncio.run(check_endpoints())


@pytest.mark.parametrize("charge, discharge, cost", [
    (np.ones(4), None, .01),
    (None, np.ones(4), .01),
    (np.ones(3), np.ones(4), .01),
    (-np.ones(4), np.zeros(4), .01),
    (np.full(4, np.nan), np.zeros(4), .01),
    (np.zeros(4), np.zeros(4), -1),
])
def test_bill_rejects_malformed_throughput(charge, discharge, cost):
    with pytest.raises(ValueError):
        bill(np.ones(4), timestamps(4), Tariff(), charge, discharge, cost)


def test_forecast_rejects_gaps_and_non_midnight_split():
    frame = synthetic_load()
    with pytest.raises(ValueError, match="15-minute"):
        forecast(frame.drop(frame.index[800]))
    with pytest.raises(ValueError, match="midnight"):
        forecast(frame, split="2025-06-01 12:00")
