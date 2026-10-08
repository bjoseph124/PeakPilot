"""Small stateless API; domain calculations live in engine.py."""
from functools import lru_cache
from threading import Lock
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from .engine import Battery, Tariff, BUILDINGS, simulate

app = FastAPI(title="PeakPilot", version="1.0.0")
simulation_lock = Lock()  # bound CPU work; run one worker for this small demo


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)
    building: str = "office"
    capacity_kwh: float = Field(500, ge=50, le=1500)
    power_kw: float = Field(200, ge=25, le=500)
    efficiency: float = Field(0.9, ge=0.7, le=0.99)
    energy_price: float = Field(0.12, ge=0.01, le=0.5)
    demand_charge: float = Field(24, ge=0, le=60)


@lru_cache(maxsize=12)
def calculate(s: Scenario):
    with simulation_lock:
        return simulate(s.building, Battery(s.capacity_kwh, s.power_kw, s.efficiency), Tariff(s.energy_price, s.demand_charge))


@app.get("/health")
def health():
    return {"status": "ok", "engine": "scipy-highs"}


@app.post("/simulate")
def simulation(scenario: Scenario):
    if scenario.building not in BUILDINGS:
        raise HTTPException(422, "Choose office, retail, or warehouse.")
    try:
        return calculate(scenario)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(422, str(exc)) from exc
