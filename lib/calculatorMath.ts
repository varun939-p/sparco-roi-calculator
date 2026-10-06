/**
 * Sparco (Twin Ops) Energy ROI & Arbitrage Calculator
 * Core Deterministic Financial Engine
 */

export interface ScenarioBreakdown {
  ratePerKWh: number;
  annualRevenue: number;
  annualNetProfit: number;
  paybackPeriodYears: number | null; // null if non-positive net profit
  formattedRevenue: string;
  formattedNetProfit: string;
  formattedPayback: string;
}

export interface SellerROIResult {
  dailyGenerationKWh: number;
  annualGenerationKWh: number;
  capex: number;
  amc: number;
  scenarios: {
    best: ScenarioBreakdown;
    mid: ScenarioBreakdown;
    worst: ScenarioBreakdown;
  };
}

export interface BuyerScenarioSavings {
  exchangeRatePerKWh: number;
  baseRatePerKWh: number;
  chargesPerKWh: number;
  newAnnualCost: number;
  annualSavings: number;
  savingsPercentage: number;
  formattedAnnualCost: string;
  formattedAnnualSavings: string;
  formattedSavingsPercentage: string;
}

export interface BuyerSavingsResult {
  dailyDemandKWh: number;
  annualDemandKWh: number;
  currentGridRate: number;
  currentAnnualCost: number;
  formattedCurrentAnnualCost: string;
  scenarios: {
    best: BuyerScenarioSavings;
    mid: BuyerScenarioSavings;
    worst: BuyerScenarioSavings;
  };
}

export interface MerchantScenarioArbitrage {
  buyRatePerKWh: number;
  sellRatePerKWh: number;
  marginPerKWh: number;
  annualChargingCost: number;
  annualDischargeRevenue: number;
  annualGrossProfit: number;
  annualNetProfit: number;
  paybackPeriodYears: number | null;
  formattedMargin: string;
  formattedGrossProfit: string;
  formattedNetProfit: string;
  formattedPayback: string;
}

export interface MerchantArbitrageResult {
  bessCapacityKWh: number;
  cyclesPerDay: number;
  dailyThroughputKWh: number;
  annualThroughputKWh: number;
  capex: number;
  amc: number;
  scenarios: {
    best: MerchantScenarioArbitrage;
    mid: MerchantScenarioArbitrage;
    worst: MerchantScenarioArbitrage;
  };
}

// ---------------------------------------------------------------------------
// HARDCODED BENCHMARK RATES
// ---------------------------------------------------------------------------

/**
 * Buyer (Energy Consumer) Landing Rates
 * Cost to purchase power from the power exchange
 */
export const BUYER_RATES = {
  best: {
    base: 2.0,
    charges: 2.5,
    total: 4.5,
    description: "₹4.5/kWh (₹2.0 base + ₹2.5 charges)",
  },
  mid: {
    base: 4.0,
    charges: 2.5,
    total: 6.5,
    description: "₹6.5/kWh (₹4.0 base + ₹2.5 charges)",
  },
  worst: {
    base: 6.0,
    charges: 2.5,
    total: 8.5,
    description: "₹8.5/kWh (₹6.0 base + ₹2.5 charges)",
  },
} as const;

/**
 * Seller (Energy Generator - e.g. Solar) Realization Rates
 * Revenue received from selling power to the exchange
 */
export const SELLER_RATES = {
  best: {
    peakBase: 10.0,
    deductions: 1.5,
    net: 8.5,
    description: "₹8.5/kWh (₹10.0 peak base - ₹1.5 subsidy/taxes)",
  },
  mid: {
    peakBase: 9.5,
    deductions: 1.5,
    net: 8.0,
    description: "₹8.0/kWh (₹9.5 base - ₹1.5 subsidy/taxes)",
  },
  worst: {
    peakBase: 9.0,
    deductions: 1.5,
    net: 7.5,
    description: "₹7.5/kWh (₹9.0 base - ₹1.5 subsidy/taxes)",
  },
} as const;

// Helper to format currency in Indian numbering system (INR)
export function formatINR(val: number): string {
  if (isNaN(val)) return "₹0";
  const absVal = Math.abs(val);
  const sign = val < 0 ? "-" : "";

  // Indian Rupee notation: e.g. 1,00,000 for 1 Lakh, 1,00,00,000 for 1 Crore
  const formatted = absVal.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "INR",
  });
  return `${sign}${formatted}`;
}

// Helper to format years
export function formatYears(years: number | null): string {
  if (years === null || !isFinite(years) || years <= 0) return "N/A";
  if (years > 50) return "> 50 yrs";
  return `${years.toFixed(1)} yrs`;
}

// ---------------------------------------------------------------------------
// 1. SOLAR GENERATION CALCULATION
// ---------------------------------------------------------------------------
/**
 * Calculates estimated daily solar energy generation in kWh.
 * Note: Future phase hooks this to NASA POWER Solar API.
 *
 * @param capacityKW - Installed solar panel capacity in kW
 * @param dailySunHours - Peak sun hours per day (typically 4.0 to 5.5 in India)
 * @returns Estimated daily generation in kWh
 */
export function calculateSolarGeneration(
  capacityKW: number,
  dailySunHours: number
): number {
  if (capacityKW < 0 || dailySunHours < 0) return 0;
  return capacityKW * dailySunHours;
}

// ---------------------------------------------------------------------------
// 2. SELLER ROI CALCULATION
// ---------------------------------------------------------------------------
/**
 * Calculates Seller (Energy Generator) ROI across Best, Mid, and Worst scenarios.
 *
 * @param dailyGenerationKWh - Daily energy generation in kWh
 * @param capex - Total Capital Expenditure (CAPEX) in ₹
 * @param amc - Annual Maintenance & Operational Contract cost in ₹
 * @returns SellerROIResult containing revenue, net profit, and payback period
 */
export function calculateSellerROI(
  dailyGenerationKWh: number,
  capex: number,
  amc: number
): SellerROIResult {
  const safeDailyKWh = Math.max(0, dailyGenerationKWh);
  const safeCapex = Math.max(0, capex);
  const safeAmc = Math.max(0, amc);

  const annualGenerationKWh = safeDailyKWh * 365;

  const buildScenario = (rate: number): ScenarioBreakdown => {
    const annualRevenue = annualGenerationKWh * rate;
    const annualNetProfit = annualRevenue - safeAmc;
    const paybackPeriodYears =
      safeCapex > 0 && annualNetProfit > 0
        ? Number((safeCapex / annualNetProfit).toFixed(2))
        : null;

    return {
      ratePerKWh: rate,
      annualRevenue,
      annualNetProfit,
      paybackPeriodYears,
      formattedRevenue: formatINR(annualRevenue),
      formattedNetProfit: formatINR(annualNetProfit),
      formattedPayback: formatYears(paybackPeriodYears),
    };
  };

  return {
    dailyGenerationKWh: safeDailyKWh,
    annualGenerationKWh,
    capex: safeCapex,
    amc: safeAmc,
    scenarios: {
      best: buildScenario(SELLER_RATES.best.net),
      mid: buildScenario(SELLER_RATES.mid.net),
      worst: buildScenario(SELLER_RATES.worst.net),
    },
  };
}

// ---------------------------------------------------------------------------
// 3. BUYER SAVINGS CALCULATION
// ---------------------------------------------------------------------------
/**
 * Calculates energy consumer (Buyer) annual savings compared to current grid tariff.
 *
 * @param dailyDemandKWh - Daily electricity consumption demand in kWh
 * @param currentGridRate - Current utility/DISCOM grid tariff in ₹/kWh
 * @returns BuyerSavingsResult comparing grid rate against 3 exchange buyer cases
 */
export function calculateBuyerSavings(
  dailyDemandKWh: number,
  currentGridRate: number
): BuyerSavingsResult {
  const safeDailyDemand = Math.max(0, dailyDemandKWh);
  const safeGridRate = Math.max(0, currentGridRate);

  const annualDemandKWh = safeDailyDemand * 365;
  const currentAnnualCost = annualDemandKWh * safeGridRate;

  const buildScenario = (rateConfig: {
    base: number;
    charges: number;
    total: number;
  }): BuyerScenarioSavings => {
    const exchangeRate = rateConfig.total;
    const newAnnualCost = annualDemandKWh * exchangeRate;
    const annualSavings = currentAnnualCost - newAnnualCost;
    const savingsPercentage =
      safeGridRate > 0
        ? ((safeGridRate - exchangeRate) / safeGridRate) * 100
        : 0;

    return {
      exchangeRatePerKWh: exchangeRate,
      baseRatePerKWh: rateConfig.base,
      chargesPerKWh: rateConfig.charges,
      newAnnualCost,
      annualSavings,
      savingsPercentage,
      formattedAnnualCost: formatINR(newAnnualCost),
      formattedAnnualSavings: formatINR(annualSavings),
      formattedSavingsPercentage: `${savingsPercentage.toFixed(1)}%`,
    };
  };

  return {
    dailyDemandKWh: safeDailyDemand,
    annualDemandKWh,
    currentGridRate: safeGridRate,
    currentAnnualCost,
    formattedCurrentAnnualCost: formatINR(currentAnnualCost),
    scenarios: {
      best: buildScenario(BUYER_RATES.best),
      mid: buildScenario(BUYER_RATES.mid),
      worst: buildScenario(BUYER_RATES.worst),
    },
  };
}

// ---------------------------------------------------------------------------
// 4. MERCHANT BESS ARBITRAGE CALCULATION
// ---------------------------------------------------------------------------
/**
 * Calculates Battery Energy Storage System (BESS) arbitrage profit and payback period.
 * Strategy: Charge during off-peak low-cost hours (Buyer rates) and discharge during peak hours (Seller rates).
 * Margin = (Seller Rate) - (Buyer Rate).
 *
 * Scenario Pairings:
 * - Best Case: Off-peak charge @ ₹4.5 (Best Buyer) -> Peak discharge @ ₹8.5 (Best Seller) => Margin ₹4.0/kWh
 * - Mid Case: Off-peak charge @ ₹6.5 (Mid Buyer) -> Peak discharge @ ₹8.0 (Mid Seller) => Margin ₹1.5/kWh
 * - Worst Case: Off-peak charge @ ₹6.5 (Mid Buyer) -> Peak discharge @ ₹7.5 (Worst Seller) => Margin ₹1.0/kWh
 *   (or worst-case buy @ ₹8.5 / sell @ ₹7.5 = -₹1.0/kWh stress case)
 *
 * @param bessCapacityKWh - Battery storage usable capacity in kWh
 * @param cyclesPerDay - Charge/discharge cycles executed daily (typically 1 to 2)
 * @param capex - Total BESS installation CAPEX in ₹
 * @param amc - Optional annual battery O&M / degradation reserve in ₹ (default: 0)
 * @returns MerchantArbitrageResult with margin, annual profit, and payback period
 */
export function calculateMerchantArbitrage(
  bessCapacityKWh: number,
  cyclesPerDay: number,
  capex: number,
  amc: number = 0
): MerchantArbitrageResult {
  const safeCapacity = Math.max(0, bessCapacityKWh);
  const safeCycles = Math.max(0, cyclesPerDay);
  const safeCapex = Math.max(0, capex);
  const safeAmc = Math.max(0, amc);

  const dailyThroughputKWh = safeCapacity * safeCycles;
  const annualThroughputKWh = dailyThroughputKWh * 365;

  const buildArbitrageScenario = (
    buyRate: number,
    sellRate: number
  ): MerchantScenarioArbitrage => {
    const marginPerKWh = sellRate - buyRate;
    const annualChargingCost = annualThroughputKWh * buyRate;
    const annualDischargeRevenue = annualThroughputKWh * sellRate;
    const annualGrossProfit = annualThroughputKWh * marginPerKWh;
    const annualNetProfit = annualGrossProfit - safeAmc;

    const paybackPeriodYears =
      safeCapex > 0 && annualNetProfit > 0
        ? Number((safeCapex / annualNetProfit).toFixed(2))
        : null;

    return {
      buyRatePerKWh: buyRate,
      sellRatePerKWh: sellRate,
      marginPerKWh,
      annualChargingCost,
      annualDischargeRevenue,
      annualGrossProfit,
      annualNetProfit,
      paybackPeriodYears,
      formattedMargin: `₹${marginPerKWh.toFixed(2)}/kWh`,
      formattedGrossProfit: formatINR(annualGrossProfit),
      formattedNetProfit: formatINR(annualNetProfit),
      formattedPayback: formatYears(paybackPeriodYears),
    };
  };

  return {
    bessCapacityKWh: safeCapacity,
    cyclesPerDay: safeCycles,
    dailyThroughputKWh,
    annualThroughputKWh,
    capex: safeCapex,
    amc: safeAmc,
    scenarios: {
      // Best: Charge @ 4.5, Discharge @ 8.5 (Margin: ₹4.0/kWh)
      best: buildArbitrageScenario(BUYER_RATES.best.total, SELLER_RATES.best.net),
      // Mid: Charge @ 6.5, Discharge @ 8.0 (Margin: ₹1.5/kWh)
      mid: buildArbitrageScenario(BUYER_RATES.mid.total, SELLER_RATES.mid.net),
      // Worst / Conservative: Charge @ 6.5, Discharge @ 7.5 (Margin: ₹1.0/kWh)
      // Note: If charged at extreme worst 8.5 and discharged at 7.5, margin is -1.0;
      // We implement the conservative positive arbitrage floor (buy mid, sell worst)
      // while also supporting transparent inspection of rates.
      worst: buildArbitrageScenario(BUYER_RATES.mid.total, SELLER_RATES.worst.net),
    },
  };
}
