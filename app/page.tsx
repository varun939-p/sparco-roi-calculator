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

// Clean decimal input: allow digits and at most one decimal point
const cleanDecimalInput = (val: string): string => {
  let clean = val.replace(/[^\d.]/g, "");
  const parts = clean.split(".");
  if (parts.length > 2) {
    clean = parts[0] + "." + parts.slice(1).join("");
  }
  return clean;
};

// Safe numerical parser for calculations: converts valid strings or returns 0
const parseNumber = (val: string): number => {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
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

  // ---------------------------------------------------------------------------
  // ZERO-STATE INITIALIZATION: String state for precision decimal typing
  // ---------------------------------------------------------------------------
  const [buyerInputs, setBuyerInputs] = useState({
    demand: "",
    tariff: "",
  });

  const [sellerInputs, setSellerInputs] = useState({
    cap: "",
    sun: "",
    capex: "",
    amc: "",
  });

  const [merchantInputs, setMerchantInputs] = useState({
    cap: "",
    cycles: "",
    capex: "",
    amc: "",
  });

  // NASA POWER API dynamic pipeline state
  const [nasaLoading, setNasaLoading] = useState(false);
  const [nasaStatus, setNasaStatus] = useState<NasaStatus | null>(null);

  // ---------------------------------------------------------------------------
  // LIVE NASA API PIPELINE (SELLER TAB)
  // ---------------------------------------------------------------------------
  const handleFetchNasaIrradiance = async () => {
    setNasaLoading(true);
    setNasaStatus(null);
    const NASA_URL =
      "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=78.4867&latitude=17.3850&format=JSON";

    try {
      let annValue: number | undefined;

      // 1. Direct browser fetch to live NASA API without stale caching
      try {
        const response = await fetch(NASA_URL, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          const data = await response.json();
          annValue = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN;
        }
      } catch {
        // Fallback to Next.js API route if browser CORS or ad-blocker interferes
      }

      // 2. If direct fetch didn't return, call our internal Next.js live proxy route
      if (typeof annValue !== "number" || isNaN(annValue)) {
        const apiRes = await fetch("/api/nasa-irradiance", { cache: "no-store" });
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          annValue = apiData.annualAverageSunHours;
        }
      }

      if (typeof annValue === "number" && !isNaN(annValue)) {
        const rounded = Number(annValue.toFixed(2));
        setSellerInputs((prev) => ({ ...prev, sun: String(rounded) }));
        setNasaStatus({
          type: "success",
          message: "✓ NASA POWER Satellite Climatology (ANN Average)",
        });
      } else {
        throw new Error("Could not parse solar irradiance from NASA satellite feed");
      }
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "Failed to fetch NASA satellite data";
      setNasaStatus({
        type: "error",
        message: `${errMsg}. Value can be entered manually.`,
      });
    } finally {
      setNasaLoading(false);
    }
  };

  // Reset inputs handler: cleanly resets back to 0 zero-state
  const handleResetInputs = () => {
    setBuyerInputs({ demand: "", tariff: "" });
    setSellerInputs({ cap: "", sun: "", capex: "", amc: "" });
    setMerchantInputs({ cap: "", cycles: "", capex: "", amc: "" });
    setActiveCase("mid");
    setNasaStatus(null);
  };

  // ---------------------------------------------------------------------------
  // ZERO-SAFE BACKEND LOGIC EVALUATION (Using lib/calculatorMath.ts)
  // ---------------------------------------------------------------------------
  // Buyer Profile Calculations
  const buyerData = useMemo(() => {
    const demandNum = parseNumber(buyerInputs.demand);
    const tariffNum = parseNumber(buyerInputs.tariff);
    const raw = calculateBuyerSavings(demandNum, tariffNum);
    const hasData = demandNum > 0 && tariffNum > 0;

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
          v: hasData ? inr(c.sav) : "—",
          sub: hasData ? c.pct.toFixed(1) + "% savings vs utility grid" : "0.0% savings vs utility grid",
        },
        {
          l: "New Annual Energy Bill",
          v: hasData ? inr(c.nw) : "—",
          sub: hasData ? "Down from " + inr(c.base) : "Down from —",
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
        hasData ? nf.format(c.ann) + " kWh" : "—",
        hasData ? inr(c.nw) : "—",
        hasData ? inr(c.sav) : "—",
        hasData ? c.pct.toFixed(1) + "%" : "0.0%",
      ],
      chartTitle: "Baseline cost vs. annual exchange bill",
      chartSub: "Current grid against Best, Mid and Worst case",
      chartItems: [
        { k: "", n: "Current grid", v: hasData ? cases.mid.base : 0 },
        { k: "best", n: "Best Case", v: hasData ? cases.best.nw : 0 },
        { k: "mid", n: "Mid Case", v: hasData ? cases.mid.nw : 0 },
        { k: "worst", n: "Worst Case", v: hasData ? cases.worst.nw : 0 },
      ],
    };
  }, [buyerInputs]);

  // Seller Profile Calculations
  const sellerData = useMemo(() => {
    const capNum = parseNumber(sellerInputs.cap);
    const sunNum = parseNumber(sellerInputs.sun);
    const capexNum = parseNumber(sellerInputs.capex);
    const amcNum = parseNumber(sellerInputs.amc);

    const dailyGen = calculateSolarGeneration(capNum, sunNum);
    const raw = calculateSellerROI(dailyGen, capexNum, amcNum);
    const hasData = capNum > 0 && sunNum > 0;

    const formatPb = (pb: number | null) =>
      pb !== null && pb > 0 ? `${pb.toFixed(1)} yrs` : "—";

    const cases = {
      best: {
        r: SELLER_RATES.best.net, // 8.5
        g: raw.annualGenerationKWh,
        rev: raw.scenarios.best.annualRevenue,
        net: raw.scenarios.best.annualNetProfit,
        capex: capexNum,
        pb: formatPb(raw.scenarios.best.paybackPeriodYears),
      },
      mid: {
        r: SELLER_RATES.mid.net, // 8.0
        g: raw.annualGenerationKWh,
        rev: raw.scenarios.mid.annualRevenue,
        net: raw.scenarios.mid.annualNetProfit,
        capex: capexNum,
        pb: formatPb(raw.scenarios.mid.paybackPeriodYears),
      },
      worst: {
        r: SELLER_RATES.worst.net, // 7.5
        g: raw.annualGenerationKWh,
        rev: raw.scenarios.worst.annualRevenue,
        net: raw.scenarios.worst.annualNetProfit,
        capex: capexNum,
        pb: formatPb(raw.scenarios.worst.paybackPeriodYears),
      },
    };

    return {
      cases,
      kpis: (c: typeof cases.best) => [
        {
          l: "Annual Net Profit",
          v: hasData ? inr(c.net) : "—",
          sub: hasData ? "Revenue: " + inr(c.rev) : "Revenue: —",
        },
        {
          l: "Payback Period",
          v: hasData ? c.pb : "—",
          sub: capexNum > 0 ? "On " + inr(c.capex) + " total CAPEX" : "On — total CAPEX",
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
        hasData ? nf.format(c.g) + " kWh" : "—",
        hasData ? inr(c.rev) : "—",
        hasData ? inr(c.net) : "—",
        hasData ? c.pb : "—",
      ],
      chartTitle: "Annual net generator profit",
      chartSub: "Best, Mid and Worst case",
      chartItems: [
        { k: "best", n: "Best Case", v: hasData ? Math.max(0, cases.best.net) : 0 },
        { k: "mid", n: "Mid Case", v: hasData ? Math.max(0, cases.mid.net) : 0 },
        { k: "worst", n: "Worst Case", v: hasData ? Math.max(0, cases.worst.net) : 0 },
      ],
    };
  }, [sellerInputs]);

  // Merchant Profile Calculations
  const merchantData = useMemo(() => {
    const capNum = parseNumber(merchantInputs.cap);
    const cyclesNum = parseNumber(merchantInputs.cycles);
    const capexNum = parseNumber(merchantInputs.capex);
    const amcNum = parseNumber(merchantInputs.amc);

    const raw = calculateMerchantArbitrage(
      capNum,
      cyclesNum,
      capexNum,
      amcNum
    );
    const hasData = capNum > 0 && cyclesNum > 0;

    const formatPb = (pb: number | null) =>
      pb !== null && pb > 0 ? `${pb.toFixed(1)} yrs` : "—";

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
        capex: capexNum,
        pb: formatPb(raw.scenarios.best.paybackPeriodYears),
      },
      mid: {
        m: 1.5, // Mid margin ₹1.5
        t: raw.annualThroughputKWh,
        p: raw.scenarios.mid.annualNetProfit,
        sp: SP.mid,
        bs: "Buy @ ₹6.50 → Sell @ ₹8.00",
        capex: capexNum,
        pb: formatPb(raw.scenarios.mid.paybackPeriodYears),
      },
      worst: {
        m: 1.0, // Worst margin ₹1.0
        t: raw.annualThroughputKWh,
        p: raw.scenarios.worst.annualNetProfit,
        sp: SP.worst,
        bs: "Buy @ ₹6.50 → Sell @ ₹7.50",
        capex: capexNum,
        pb: formatPb(raw.scenarios.worst.paybackPeriodYears),
      },
    };

    return {
      cases,
      kpis: (c: typeof cases.best) => [
        {
          l: "Annual Arbitrage Profit",
          v: hasData ? inr(c.p) : "—",
          sub: "Spread: " + rt(c.m),
        },
        {
          l: "Payback Period",
          v: hasData ? c.pb : "—",
          sub: capexNum > 0 ? "On " + inr(c.capex) + " total CAPEX" : "On — total CAPEX",
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
        hasData ? nf.format(c.t) + " kWh" : "—",
        hasData ? inr(c.p) : "—",
        hasData ? c.pb : "—",
      ],
      chartTitle: "Annual net arbitrage profit",
      chartSub: "Best, Mid and Worst case",
      chartItems: [
        { k: "best", n: "Best Case", v: hasData ? Math.max(0, cases.best.p) : 0 },
        { k: "mid", n: "Mid Case", v: hasData ? Math.max(0, cases.mid.p) : 0 },
        { k: "worst", n: "Worst Case", v: hasData ? Math.max(0, cases.worst.p) : 0 },
      ],
    };
  }, [merchantInputs]);

  // Active view model
  const activeViewModel = useMemo(() => {
    if (activeTab === "buyer") return buyerData;
    if (activeTab === "seller") return sellerData;
    return merchantData;
  }, [activeTab, buyerData, sellerData, merchantData]);

  // Chart grid line calculations with zero-flat line protection
  const chartMaxAndStep = useMemo(() => {
    const values = activeViewModel.chartItems.map((x) => x.v);
    const maxVal = Math.max(...values, 0);
    if (maxVal <= 0) {
      return { step: 0, max: 0, isZero: true };
    }
    const step = niceStep(maxVal / 4);
    const max = step * 4;
    return { step, max, isZero: false };
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
          {/* INPUT PANEL (LEFT COLUMN - EXPANDED 360px) */}
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
                        placeholder="1000"
                        value={buyerInputs.demand}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setBuyerInputs((prev) => ({
                            ...prev,
                            demand: val,
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
                        placeholder="10.5"
                        value={buyerInputs.tariff}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setBuyerInputs((prev) => ({
                            ...prev,
                            tariff: val,
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
                        placeholder="100"
                        value={sellerInputs.cap}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setSellerInputs((prev) => ({
                            ...prev,
                            cap: val,
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
                        placeholder="4.5"
                        value={sellerInputs.sun}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setSellerInputs((prev) => ({
                            ...prev,
                            sun: val,
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
                      title="Fetch live satellite climatology irradiance for Hyderabad from NASA POWER"
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
                            <circle cx="12" cy="10" r="10" strokeOpacity="0.25" />
                            <path d="M12 2a10 10 0 0 1 10 10" />
                          </svg>
                          <span>Fetching NASA POWER Satellite Data...</span>
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

                    {/* NASA DATA TRANSPARENCY SUCCESS BADGE */}
                    {nasaStatus?.type === "success" && (
                      <div className="nasa-badge" title="Live satellite feed verified: 5.36 hrs/day annual climatology for Hyderabad">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>✓ NASA POWER Satellite Climatology (ANN Average)</span>
                      </div>
                    )}

                    {nasaStatus?.type === "error" && (
                      <div className="fetch-status error">
                        ✕ {nasaStatus.message}
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
                        placeholder="4000000"
                        value={sellerInputs.capex}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setSellerInputs((prev) => ({
                            ...prev,
                            capex: val,
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
                        placeholder="50000"
                        value={sellerInputs.amc}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setSellerInputs((prev) => ({
                            ...prev,
                            amc: val,
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
                        placeholder="500"
                        value={merchantInputs.cap}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setMerchantInputs((prev) => ({
                            ...prev,
                            cap: val,
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
                        placeholder="2"
                        value={merchantInputs.cycles}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setMerchantInputs((prev) => ({
                            ...prev,
                            cycles: val,
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
                        placeholder="6000000"
                        value={merchantInputs.capex}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setMerchantInputs((prev) => ({
                            ...prev,
                            capex: val,
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
                        placeholder="0"
                        value={merchantInputs.amc}
                        onChange={(e) => {
                          const val = cleanDecimalInput(e.target.value);
                          setMerchantInputs((prev) => ({
                            ...prev,
                            amc: val,
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
                        {chartMaxAndStep.isZero
                          ? n === 0
                            ? "₹0"
                            : "—"
                          : n
                          ? cmp(chartMaxAndStep.step * n)
                          : "₹0"}
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
                          {item.v > 0 ? inr(item.v) : "—"}
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
