export type Scenario = {
  building: string;
  capacity_kwh: number;
  power_kw: number;
  efficiency: number;
  energy_price: number;
  demand_charge: number;
};
export type Row = {
  timestamp: string;
  load: number;
  forecast: number;
  grid: number;
  oracle: number;
  rule: number;
  soc: number;
  soc_end: number;
  charge: number;
  discharge: number;
  rate: number;
};
export type Costs = {
  energy: number;
  demand: number;
  bill: number;
  throughput: number;
  operating_cost: number;
  import_kwh: number;
  peak_kw: number;
  end_energy_kwh?: number;
};
export type Result = {
  building: { id: string; name: string; type: string; area: string };
  battery: {
    capacity_kwh: number;
    power_kw: number;
    round_trip_efficiency: number;
    throughput_cost: number;
  };
  tariff: {
    energy_price: number;
    demand_charge: number;
    peak_multiplier: number;
  };
  series: Row[];
  period: {
    start: string;
    end: string;
    days: number;
    interval_minutes: number;
    label: string;
    focus_date: string;
  };
  metrics: {
    peak_reduction_pct: number;
    peak_reduction_kw: number;
    bill_savings: number;
    net_operating_savings: number;
    demand_savings: number;
    energy_savings: number;
    optimized_peak_kw: number;
    utilization_pct: number;
    equivalent_cycles: number;
  };
  comparison: Record<"baseline" | "rule" | "forecast" | "oracle", Costs>;
  forecasting: {
    mae_kw: number;
    baseline_mae_kw: number;
    rmse_kw: number;
    train_samples: number;
    test_samples: number;
    train_end: string;
    test_start: string;
  };
  economics: {
    capital_cost: number;
    annual_om: number;
    illustrative_annual_net: number;
    simple_payback_years: number | null;
    assumption: string;
  };
  insights: { title: string; text: string }[];
  method: {
    dispatch: string;
    solver: string;
    oracle_gap: number;
    runtime_seconds: number;
    notes: string[];
    rule_threshold_kw: number;
  };
};
