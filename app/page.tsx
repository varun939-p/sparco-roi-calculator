"use client";

import React, { useState, useMemo } from "react";
import {
  calculateSolarGeneration,
  calculateSellerROI,
  calculateBuyerSavings,
  calculateMerchantArbitrage,
  BUYER_RATES,
  SELLER_RATES,
} from "../lib/calculatorMath";

type TabKey = "buyer" | "seller" | "merchant";
type CaseKey = "best" | "mid" | "worst";

interface NasaStatus {
  type: "success" | "error";
  message: string;
}

const CASES: [CaseKey, string][] = [
  ["best", "Best Case"],
  ["mid", "Mid Case"],
  ["worst", "Worst Case"],
];

// Number and currency formatters according to prototype
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr = (n: number) =>
  (n < 0 ? "−" : "") + "₹" + nf.format(Math.abs(Math.round(n)));
const rt = (n: number) => "₹" + n.toFixed(2) + "/kWh";

const cmp = (n: number) => {
  const a = Math.abs(n);
  return (
    "₹" +
    (a >= 1e7
      ? +(a / 1e7).toFixed(2) + "Cr"
      : a >= 1e5
      ? +(a / 1e5).toFixed(1) + "L"
      : a >= 1e3
      ? +(a / 1e3).toFixed(1) + "K"
      : Math.round(a))
  );
};

const niceStep = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const factors = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const found = factors.find((m) => m * p >= v);
  return (found !== undefined ? found : 10) * p;
};

// SVG Icons matching prototype .ico exactly
function KpiIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M7 5h10M7 10h10M7 5c6 0 6 8 0 8l7 6" />
    </svg>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("buyer");
  const [activeCase, setActiveCase] = useState<CaseKey>("mid");

  // State for Buyer profile
  const [buyerInputs, setBuyerInputs] = useState({
    demand: 1000,
    tariff: 10.5,
  });

  // State for Seller profile
  const [sellerInputs, setSellerInputs] = useState({
    cap: 100,
    sun: 4.5,
    capex: 4000000,
    amc: 50000,
  });

  // State for Merchant profile
  const [merchantInputs, setMerchantInputs] = useState({
    cap: 500,
    cycles: 2,
    capex: 6000000,
    amc: 0,
  });

  // NASA POWER API dynamic pipeline state
  const [nasaLoading, setNasaLoading] = useState(false);
  const [nasaStatus, setNasaStatus] = useState<NasaStatus | null>(null);

  // ---------------------------------------------------------------------------
  // NASA API PIPELINE (SELLER TAB)
  // ---------------------------------------------------------------------------
  const handleFetchNasaIrradiance = async () => {
    setNasaLoading(true);
    setNasaStatus(null);
    const NASA_URL =
      "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=78.4867&latitude=17.3850&format=JSON";

    try {
      let annValue: number | undefined;

      // 1. Direct browser fetch to NASA API
      try {
        const response = await fetch(NASA_URL, {
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          const data = await response.json();
          annValue = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN;
        }
      } catch {
        // Fallback to Next.js API route if browser CORS/firewall interrupts direct call
      }

      // 2. If direct fetch didn't obtain value, try our server route
      if (typeof annValue !== "number" || isNaN(annValue)) {
        const apiRes = await fetch("/api/nasa-irradiance");
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          annValue = apiData.annualAverageSunHours;
        }
      }

      if (typeof annValue === "number" && !isNaN(annValue)) {
        const rounded = Number(annValue.toFixed(2));
        setSellerInputs((prev) => ({ ...prev, sun: rounded }));
        setNasaStatus({
          type: "success",
          message: `Live NASA POWER Irradiance loaded: ${rounded} hrs/day (Hyderabad)`,
        });
      } else {
        throw new Error("Could not parse valid solar irradiance data");
      }
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "Failed to fetch NASA data";
      setNasaStatus({
        type: "error",
        message: `${errMsg}. Value can be entered manually.`,
      });
    } finally {
      setNasaLoading(false);
    }
  };

  // Reset inputs handler
  const handleResetInputs = () => {
    setBuyerInputs({ demand: 1000, tariff: 10.5 });
    setSellerInputs({ cap: 100, sun: 4.5, capex: 4000000, amc: 50000 });
    setMerchantInputs({ cap: 500, cycles: 2, capex: 6000000, amc: 0 });
    setActiveCase("mid");
    setNasaStatus(null);
  };

  // ---------------------------------------------------------------------------
  // BACKEND LOGIC EVALUATION (Using lib/calculatorMath.ts)
  // ---------------------------------------------------------------------------
  // Buyer Profile Calculations
  const buyerData = useMemo(() => {
    const raw = calculateBuyerSavings(buyerInputs.demand, buyerInputs.tariff);
    const cases = {
      best: {
        r: BUYER_RATES.best.total, // 4.5
        ann: raw.annualDemandKWh,
        base: raw.currentAnnualCost,
        nw: raw.scenarios.best.newAnnualCost,
        sav: raw.scenarios.best.annualSavings,
        pct: raw.scenarios.best.savingsPercentage,
      },
      mid: {
        r: BUYER_RATES.mid.total, // 6.5
        ann: raw.annualDemandKWh,
        base: raw.currentAnnualCost,
        nw: raw.scenarios.mid.newAnnualCost,
        sav: raw.scenarios.mid.annualSavings,
        pct: raw.scenarios.mid.savingsPercentage,
      },
      worst: {
        r: BUYER_RATES.worst.total, // 8.5
        ann: raw.annualDemandKWh,
        base: raw.currentAnnualCost,
        nw: raw.scenarios.worst.newAnnualCost,
        sav: raw.scenarios.worst.annualSavings,
        pct: raw.scenarios.worst.savingsPercentage,
      },
    };

    return {
      cases,
      kpis: (c: typeof cases.best) => [
        {
          l: "Annual Energy Savings",
          v: inr(c.sav),
          sub: c.pct.toFixed(1) + "% savings vs utility grid",
        },
        {
          l: "New Annual Energy Bill",
          v: inr(c.nw),
          sub: "Down from " + inr(c.base),
        },
        {
          l: "Exchange Landing Rate",
          v: rt(c.r),
          sub: "₹" + +(c.r - 2.5).toFixed(2) + " base + ₹2.5 charges",
        },
      ],
      headers: [
        "Landed Rate",
        "Annual Demand",
        "New Annual Cost",
        "Annual Savings",
        "Savings %",
      ],
      row: (c: typeof cases.best) => [
        rt(c.r),
        nf.format(c.ann) + " kWh",
        inr(c.nw),
        inr(c.sav),
        c.pct.toFixed(1) + "%",
      ],
      chartTitle: "Baseline cost vs. annual exchange bill",
      chartSub: "Current grid against Best, Mid and Worst case",
      chartItems: [
        { k: "", n: "Current grid", v: cases.mid.base },
        { k: "best", n: "Best Case", v: cases.best.nw },
        { k: "mid", n: "Mid Case", v: cases.mid.nw },
        { k: "worst", n: "Worst Case", v: cases.worst.nw },
      ],
    };
  }, [buyerInputs]);

  // Seller Profile Calculations
  const sellerData = useMemo(() => {
    const dailyGen = calculateSolarGeneration(sellerInputs.cap, sellerInputs.sun);
    const raw = calculateSellerROI(dailyGen, sellerInputs.capex, sellerInputs.amc);

    const formatPb = (pb: number | null) => (pb !== null && pb > 0 ? `${pb.toFixed(1)} yrs` : "—");

    const cases = {
      best: {
        r: SELLER_RATES.best.net, // 8.5
        g: raw.annualGenerationKWh,
        rev: raw.scenarios.best.annualRevenue,
        net: raw.scenarios.best.annualNetProfit,
        capex: sellerInputs.capex,
        pb: formatPb(raw.scenarios.best.paybackPeriodYears),
      },
      mid: {
        r: SELLER_RATES.mid.net, // 8.0
        g: raw.annualGenerationKWh,
        rev: raw.scenarios.mid.annualRevenue,
        net: raw.scenarios.mid.annualNetProfit,
        capex: sellerInputs.capex,
        pb: formatPb(raw.scenarios.mid.paybackPeriodYears),
      },
      worst: {
        r: SELLER_RATES.worst.net, // 7.5
        g: raw.annualGenerationKWh,
        rev: raw.scenarios.worst.annualRevenue,
        net: raw.scenarios.worst.annualNetProfit,
        capex: sellerInputs.capex,
        pb: formatPb(raw.scenarios.worst.paybackPeriodYears),
      },
    };

    return {
      cases,
      kpis: (c: typeof cases.best) => [
        {
          l: "Annual Net Profit",
          v: inr(c.net),
          sub: "Revenue: " + inr(c.rev),
        },
        {
          l: "Payback Period",
          v: c.pb,
          sub: "On " + inr(c.capex) + " total CAPEX",
        },
        {
          l: "Realized Export Tariff",
          v: rt(c.r),
          sub: "₹" + +(c.r + 1.5).toFixed(2) + " peak − ₹1.5 taxes",
        },
      ],
      headers: [
        "Export Tariff",
        "Annual Generation",
        "Annual Revenue",
        "Net Profit",
        "Payback Period",
      ],
      row: (c: typeof cases.best) => [
        rt(c.r),
        nf.format(c.g) + " kWh",
        inr(c.rev),
        inr(c.net),
        c.pb,
      ],
      chartTitle: "Annual net generator profit",
      chartSub: "Best, Mid and Worst case",
      chartItems: [
        { k: "best", n: "Best Case", v: cases.best.net },
        { k: "mid", n: "Mid Case", v: cases.mid.net },
        { k: "worst", n: "Worst Case", v: cases.worst.net },
      ],
    };
  }, [sellerInputs]);

  // Merchant Profile Calculations
  const merchantData = useMemo(() => {
    const raw = calculateMerchantArbitrage(
      merchantInputs.cap,
      merchantInputs.cycles,
      merchantInputs.capex,
      merchantInputs.amc
    );

    const formatPb = (pb: number | null) => (pb !== null && pb > 0 ? `${pb.toFixed(1)} yrs` : "—");

    const SP = {
      best: "₹4.50 → ₹8.50",
      mid: "₹6.50 → ₹8.00",
      worst: "₹6.50 → ₹7.50",
    };

    const cases = {
      best: {
        m: 4.0, // Best margin ₹4.0
        t: raw.annualThroughputKWh,
        p: raw.scenarios.best.annualNetProfit,
        sp: SP.best,
        bs: "Buy @ ₹4.50 → Sell @ ₹8.50",
        capex: merchantInputs.capex,
        pb: formatPb(raw.scenarios.best.paybackPeriodYears),
      },
      mid: {
        m: 1.5, // Mid margin ₹1.5
        t: raw.annualThroughputKWh,
        p: raw.scenarios.mid.annualNetProfit,
        sp: SP.mid,
        bs: "Buy @ ₹6.50 → Sell @ ₹8.00",
        capex: merchantInputs.capex,
        pb: formatPb(raw.scenarios.mid.paybackPeriodYears),
      },
      worst: {
        m: 1.0, // Worst margin ₹1.0
        t: raw.annualThroughputKWh,
        p: raw.scenarios.worst.annualNetProfit,
        sp: SP.worst,
        bs: "Buy @ ₹6.50 → Sell @ ₹7.50",
        capex: merchantInputs.capex,
        pb: formatPb(raw.scenarios.worst.paybackPeriodYears),
      },
    };

    return {
      cases,
      kpis: (c: typeof cases.best) => [
        {
          l: "Annual Arbitrage Profit",
          v: inr(c.p),
          sub: "Spread: " + rt(c.m),
        },
        {
          l: "Payback Period",
          v: c.pb,
          sub: "On " + inr(c.capex) + " total CAPEX",
        },
        {
          l: "Net Spread Margin",
          v: rt(c.m),
          sub: c.bs,
        },
      ],
      headers: [
        "Spread (Buy → Sell)",
        "Net Margin",
        "Annual Throughput",
        "Annual Profit",
        "Payback Period",
      ],
      row: (c: typeof cases.best) => [
        c.sp,
        rt(c.m),
        nf.format(c.t) + " kWh",
        inr(c.p),
        c.pb,
      ],
      chartTitle: "Annual net arbitrage profit",
      chartSub: "Best, Mid and Worst case",
      chartItems: [
        { k: "best", n: "Best Case", v: cases.best.p },
        { k: "mid", n: "Mid Case", v: cases.mid.p },
        { k: "worst", n: "Worst Case", v: cases.worst.p },
      ],
    };
  }, [merchantInputs]);

  // Active view model
  const activeViewModel = useMemo(() => {
    if (activeTab === "buyer") return buyerData;
    if (activeTab === "seller") return sellerData;
    return merchantData;
  }, [activeTab, buyerData, sellerData, merchantData]);

  // Chart grid line calculations
  const chartMaxAndStep = useMemo(() => {
    const values = activeViewModel.chartItems.map((x) => x.v);
    const maxVal = Math.max(...values, 0);
    const step = niceStep(maxVal / 4);
    const max = step * 4;
    return { step, max };
  }, [activeViewModel]);

  return (
    <>
      <header>
        <div className="brand">
          <div className="mark">S</div>
          <div>
            <b>SPARCO</b>
            <span>Digital Twin Financial Engine</span>
          </div>
        </div>
        <button
          className="ghost"
          id="reset"
          type="button"
          onClick={handleResetInputs}
        >
          Reset inputs
        </button>
      </header>

      <main>
        {/* Segmented Controller (Tab List) */}
        <div className="seg" id="tabs" role="tablist" aria-label="Mode">
          <button
            role="tab"
            aria-selected={activeTab === "buyer"}
            data-t="buyer"
            onClick={() => setActiveTab("buyer")}
          >
            Energy Consumer (Buyer)
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "seller"}
            data-t="seller"
            onClick={() => setActiveTab("seller")}
          >
            Generator (Seller)
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "merchant"}
            data-t="merchant"
            onClick={() => setActiveTab("merchant")}
          >
            Arbitrage (Merchant)
          </button>
        </div>

        <div className="layout">
          {/* ------------------------------------------------------------- */}
          {/* INPUT PANEL (LEFT COLUMN) */}
          {/* ------------------------------------------------------------- */}
          <section className="panel" aria-label="Inputs">
            <div className="label">Inputs</div>
            <div id="fields">
              {/* BUYER INPUTS */}
              {activeTab === "buyer" && (
                <>
                  <div className="field">
                    <label htmlFor="buyer-demand">Daily Energy Demand</label>
                    <div className="box">
                      <input
                        id="buyer-demand"
                        data-k="demand"
                        inputMode="decimal"
                        autoComplete="off"
                        value={buyerInputs.demand}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setBuyerInputs((prev) => ({
                            ...prev,
                            demand: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>kWh</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="buyer-tariff">
                      Current Utility Grid Tariff
                    </label>
                    <div className="box">
                      <input
                        id="buyer-tariff"
                        data-k="tariff"
                        inputMode="decimal"
                        autoComplete="off"
                        value={buyerInputs.tariff}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setBuyerInputs((prev) => ({
                            ...prev,
                            tariff: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>₹/kWh</i>
                    </div>
                  </div>
                </>
              )}

              {/* SELLER INPUTS */}
              {activeTab === "seller" && (
                <>
                  <div className="field">
                    <label htmlFor="seller-location">Plant Location</label>
                    <div className="box">
                      <input
                        id="seller-location"
                        readOnly
                        value="Hyderabad, Telangana"
                        className="cursor-default"
                      />
                      <i>17.38°N, 78.48°E</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="seller-cap">Solar Plant Capacity</label>
                    <div className="box">
                      <input
                        id="seller-cap"
                        data-k="cap"
                        inputMode="decimal"
                        autoComplete="off"
                        value={sellerInputs.cap}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setSellerInputs((prev) => ({
                            ...prev,
                            cap: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>kW</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="seller-sun">Daily Sun Hours</label>
                    <div className="box">
                      <input
                        id="seller-sun"
                        data-k="sun"
                        inputMode="decimal"
                        autoComplete="off"
                        value={sellerInputs.sun}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setSellerInputs((prev) => ({
                            ...prev,
                            sun: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>hrs/day</i>
                    </div>

                    {/* LIVE NASA API PIPELINE BUTTON */}
                    <button
                      type="button"
                      className="fetch-btn"
                      onClick={handleFetchNasaIrradiance}
                      disabled={nasaLoading}
                      title="Fetch annual climatology irradiance for Hyderabad, India"
                    >
                      {nasaLoading ? (
                        <>
                          <svg
                            className="animate-spin"
                            style={{ width: 13, height: 13 }}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                            <path d="M12 2a10 10 0 0 1 10 10" />
                          </svg>
                          <span>Fetching NASA POWER...</span>
                        </>
                      ) : (
                        <>
                          <svg
                            style={{ width: 13, height: 13 }}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <circle cx="12" cy="12" r="5" />
                            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          </svg>
                          <span>Fetch Live Irradiance (Hyderabad)</span>
                        </>
                      )}
                    </button>

                    {nasaStatus && (
                      <div className={`fetch-status ${nasaStatus.type}`}>
                        {nasaStatus.type === "success" ? "✓ " : "✕ "}
                        {nasaStatus.message}
                      </div>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="seller-capex">Total Project CAPEX</label>
                    <div className="box">
                      <input
                        id="seller-capex"
                        data-k="capex"
                        inputMode="decimal"
                        autoComplete="off"
                        value={sellerInputs.capex}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setSellerInputs((prev) => ({
                            ...prev,
                            capex: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>₹</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="seller-amc">Annual O&M Cost</label>
                    <div className="box">
                      <input
                        id="seller-amc"
                        data-k="amc"
                        inputMode="decimal"
                        autoComplete="off"
                        value={sellerInputs.amc}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setSellerInputs((prev) => ({
                            ...prev,
                            amc: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>₹/yr</i>
                    </div>
                  </div>
                </>
              )}

              {/* MERCHANT INPUTS */}
              {activeTab === "merchant" && (
                <>
                  <div className="field">
                    <label htmlFor="merchant-cap">BESS Storage Capacity</label>
                    <div className="box">
                      <input
                        id="merchant-cap"
                        data-k="cap"
                        inputMode="decimal"
                        autoComplete="off"
                        value={merchantInputs.cap}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setMerchantInputs((prev) => ({
                            ...prev,
                            cap: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>kWh</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="merchant-cycles">
                      Charge / Discharge Cycles
                    </label>
                    <div className="box">
                      <input
                        id="merchant-cycles"
                        data-k="cycles"
                        inputMode="decimal"
                        autoComplete="off"
                        value={merchantInputs.cycles}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setMerchantInputs((prev) => ({
                            ...prev,
                            cycles: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>per day</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="merchant-capex">Total BESS CAPEX</label>
                    <div className="box">
                      <input
                        id="merchant-capex"
                        data-k="capex"
                        inputMode="decimal"
                        autoComplete="off"
                        value={merchantInputs.capex}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setMerchantInputs((prev) => ({
                            ...prev,
                            capex: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>₹</i>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="merchant-amc">
                      Annual Degradation & O&M Reserve
                    </label>
                    <div className="box">
                      <input
                        id="merchant-amc"
                        data-k="amc"
                        inputMode="decimal"
                        autoComplete="off"
                        value={merchantInputs.amc}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setMerchantInputs((prev) => ({
                            ...prev,
                            amc: parseFloat(val) || 0,
                          }));
                        }}
                      />
                      <i>₹/yr</i>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ------------------------------------------------------------- */}
          {/* RESULTS PANEL (RIGHT COLUMN) */}
          {/* ------------------------------------------------------------- */}
          <section aria-label="Results">
            {/* Scenario Segmented Controller */}
            <div className="results-top">
              <div className="label">Scenario</div>
              <div
                className="seg seg-lg"
                id="cases"
                role="group"
                aria-label="Scenario"
              >
                <button
                  type="button"
                  data-c="best"
                  aria-selected={activeCase === "best"}
                  onClick={() => setActiveCase("best")}
                >
                  Best
                </button>
                <button
                  type="button"
                  data-c="mid"
                  aria-selected={activeCase === "mid"}
                  onClick={() => setActiveCase("mid")}
                >
                  Mid
                </button>
                <button
                  type="button"
                  data-c="worst"
                  aria-selected={activeCase === "worst"}
                  onClick={() => setActiveCase("worst")}
                >
                  Worst
                </button>
              </div>
            </div>

            {/* KPI Cards Deck */}
            <div className="kpis" id="kpis">
              {activeViewModel
                .kpis(
                  activeViewModel.cases[
                    activeCase as keyof typeof activeViewModel.cases
                  ] as never
                )
                .map((kpi, idx) => (
                  <div className="kpi" key={kpi.l}>
                    <div className="khead">
                      <span className="label">{kpi.l}</span>
                      <span className="ico">
                        <KpiIcon index={idx} />
                      </span>
                    </div>
                    <div className="v">{kpi.v}</div>
                    <div className="sub">{kpi.sub}</div>
                  </div>
                ))}
            </div>

            {/* CSS-Only Pure FinTech Bar Chart */}
            <div className="chartcard">
              <div className="ctitle" id="ctitle">
                {activeViewModel.chartTitle}
              </div>
              <div className="label" id="csub">
                {activeViewModel.chartSub}
              </div>

              <div className="chart" id="chart" data-k={activeTab}>
                {/* 5 Horizontal Grid Lines */}
                <div className="gl-wrap">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="gl"
                      style={{ bottom: `${n * 25}%` }}
                    >
                      <span>
                        {n ? cmp(chartMaxAndStep.step * n) : "₹0"}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Bars Container */}
                <div className="bars">
                  {activeViewModel.chartItems.map((item) => {
                    const isSelected = item.k === activeCase;
                    const isBase = item.k === "";
                    const heightPercent =
                      chartMaxAndStep.max > 0
                        ? (Math.max(item.v, 0) / chartMaxAndStep.max) * 100
                        : 0;

                    return (
                      <div
                        key={item.n}
                        className={`col ${isSelected ? "sel" : ""} ${
                          isBase ? "base" : ""
                        }`}
                        data-c={item.k}
                        onClick={() => {
                          if (item.k) {
                            setActiveCase(item.k as CaseKey);
                          }
                        }}
                      >
                        <div
                          className="tip"
                          style={{ bottom: `calc(${heightPercent}% + 10px)` }}
                        >
                          {inr(item.v)}
                        </div>
                        <div
                          className="bar"
                          style={{ height: `${heightPercent}%` }}
                        />
                        <div className="cat">{item.n}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Scenario Breakdown Matrix Table */}
            <div className="table">
              <table>
                <thead id="thead">
                  <tr>
                    <th>Scenario</th>
                    {activeViewModel.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody id="tbody">
                  {CASES.map(([k, name]) => {
                    const rowData = activeViewModel.cases[
                      k as keyof typeof activeViewModel.cases
                    ] as never;
                    const cols = activeViewModel.row(rowData);
                    const isSelected = k === activeCase;

                    return (
                      <tr
                        key={k}
                        data-c={k}
                        className={isSelected ? "sel" : ""}
                        onClick={() => setActiveCase(k)}
                      >
                        <td>{name}</td>
                        {cols.map((colVal, colIdx) => (
                          <td key={colIdx}>{colVal}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
