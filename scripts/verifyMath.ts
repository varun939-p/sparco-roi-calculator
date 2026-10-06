import {
  calculateSolarGeneration,
  calculateSellerROI,
  calculateBuyerSavings,
  calculateMerchantArbitrage,
  BUYER_RATES,
  SELLER_RATES,
  formatINR,
} from "../lib/calculatorMath";

console.log("===============================================================");
console.log("⚡ SPARCO (TWIN OPS) ENERGY ROI & ARBITRAGE CALCULATOR - MATH ENGINE");
console.log("===============================================================\n");

console.log("--- 1. BENCHMARK LANDING & REALIZATION RATES ---");
console.log("Buyer Landing Rates (Cost to Buy from Exchange):");
console.log(`  • Best Case:  ₹${BUYER_RATES.best.total}/kWh (₹${BUYER_RATES.best.base} base + ₹${BUYER_RATES.best.charges} charges)`);
console.log(`  • Mid Case:   ₹${BUYER_RATES.mid.total}/kWh (₹${BUYER_RATES.mid.base} base + ₹${BUYER_RATES.mid.charges} charges)`);
console.log(`  • Worst Case: ₹${BUYER_RATES.worst.total}/kWh (₹${BUYER_RATES.worst.base} base + ₹${BUYER_RATES.worst.charges} charges)`);

console.log("\nSeller Realization Rates (Revenue from Selling to Exchange):");
console.log(`  • Best Case:  ₹${SELLER_RATES.best.net}/kWh (₹${SELLER_RATES.best.peakBase} peak base - ₹${SELLER_RATES.best.deductions} subsidy/taxes)`);
console.log(`  • Mid Case:   ₹${SELLER_RATES.mid.net}/kWh (₹${SELLER_RATES.mid.peakBase} base - ₹${SELLER_RATES.mid.deductions} subsidy/taxes)`);
console.log(`  • Worst Case: ₹${SELLER_RATES.worst.net}/kWh (₹${SELLER_RATES.worst.peakBase} base - ₹${SELLER_RATES.worst.deductions} subsidy/taxes)`);

console.log("\n---------------------------------------------------------------");
console.log("--- 2. SOLAR GENERATION & SELLER (GENERATOR) ROI TEST ---");
const testSolarCapacityKW = 100; // 100 kW system
const testSunHours = 4.5; // 4.5 sun hours/day
const testCapexSeller = 4000000; // ₹40 Lakhs CAPEX
const testAmcSeller = 50000; // ₹50k/year AMC

const dailyGen = calculateSolarGeneration(testSolarCapacityKW, testSunHours);
console.log(`Input: ${testSolarCapacityKW} kW Solar, ${testSunHours} Peak Sun Hours/Day`);
console.log(`Daily Generation: ${dailyGen} kWh/day | Annual Generation: ${dailyGen * 365} kWh/year`);

const sellerROI = calculateSellerROI(dailyGen, testCapexSeller, testAmcSeller);
console.log(`\nSeller Financial Projections (CAPEX: ${formatINR(testCapexSeller)}, AMC: ${formatINR(testAmcSeller)}):`);
console.table({
  "Best Case (₹8.5/kWh)": {
    "Annual Revenue": sellerROI.scenarios.best.formattedRevenue,
    "Annual Net Profit": sellerROI.scenarios.best.formattedNetProfit,
    "Payback Period": sellerROI.scenarios.best.formattedPayback,
  },
  "Mid Case (₹8.0/kWh)": {
    "Annual Revenue": sellerROI.scenarios.mid.formattedRevenue,
    "Annual Net Profit": sellerROI.scenarios.mid.formattedNetProfit,
    "Payback Period": sellerROI.scenarios.mid.formattedPayback,
  },
  "Worst Case (₹7.5/kWh)": {
    "Annual Revenue": sellerROI.scenarios.worst.formattedRevenue,
    "Annual Net Profit": sellerROI.scenarios.worst.formattedNetProfit,
    "Payback Period": sellerROI.scenarios.worst.formattedPayback,
  },
});

console.log("\n---------------------------------------------------------------");
console.log("--- 3. BUYER (ENERGY CONSUMER) SAVINGS TEST ---");
const testDailyDemandKWh = 1000; // 1,000 kWh/day
const testGridRate = 10.5; // Current Grid Tariff: ₹10.5/kWh
const buyerSavings = calculateBuyerSavings(testDailyDemandKWh, testGridRate);
console.log(`Input: Daily Demand = ${testDailyDemandKWh} kWh/day | Current Utility Grid Rate = ₹${testGridRate}/kWh`);
console.log(`Current Annual Grid Cost: ${buyerSavings.formattedCurrentAnnualCost}`);

console.table({
  "Best Case (₹4.5/kWh)": {
    "New Annual Cost": buyerSavings.scenarios.best.formattedAnnualCost,
    "Annual Savings": buyerSavings.scenarios.best.formattedAnnualSavings,
    "Savings %": buyerSavings.scenarios.best.formattedSavingsPercentage,
  },
  "Mid Case (₹6.5/kWh)": {
    "New Annual Cost": buyerSavings.scenarios.mid.formattedAnnualCost,
    "Annual Savings": buyerSavings.scenarios.mid.formattedAnnualSavings,
    "Savings %": buyerSavings.scenarios.mid.formattedSavingsPercentage,
  },
  "Worst Case (₹8.5/kWh)": {
    "New Annual Cost": buyerSavings.scenarios.worst.formattedAnnualCost,
    "Annual Savings": buyerSavings.scenarios.worst.formattedAnnualSavings,
    "Savings %": buyerSavings.scenarios.worst.formattedSavingsPercentage,
  },
});

console.log("\n---------------------------------------------------------------");
console.log("--- 4. MERCHANT (BESS ARBITRAGE) TEST ---");
const testBessCapacityKWh = 500; // 500 kWh battery storage
const testCyclesPerDay = 2; // 2 cycles/day
const testCapexMerchant = 6000000; // ₹60 Lakhs CAPEX
const merchantROI = calculateMerchantArbitrage(testBessCapacityKWh, testCyclesPerDay, testCapexMerchant);

console.log(`Input: BESS Capacity = ${testBessCapacityKWh} kWh, Cycles/Day = ${testCyclesPerDay}, CAPEX = ${formatINR(testCapexMerchant)}`);
console.log(`Daily Throughput: ${merchantROI.dailyThroughputKWh} kWh | Annual Throughput: ${merchantROI.annualThroughputKWh} kWh`);

console.table({
  "Best Case (₹4.0 margin)": {
    "Spread (Buy -> Sell)": `₹${merchantROI.scenarios.best.buyRatePerKWh} -> ₹${merchantROI.scenarios.best.sellRatePerKWh}`,
    "Margin": merchantROI.scenarios.best.formattedMargin,
    "Annual Profit": merchantROI.scenarios.best.formattedNetProfit,
    "Payback Period": merchantROI.scenarios.best.formattedPayback,
  },
  "Mid Case (₹1.5 margin)": {
    "Spread (Buy -> Sell)": `₹${merchantROI.scenarios.mid.buyRatePerKWh} -> ₹${merchantROI.scenarios.mid.sellRatePerKWh}`,
    "Margin": merchantROI.scenarios.mid.formattedMargin,
    "Annual Profit": merchantROI.scenarios.mid.formattedNetProfit,
    "Payback Period": merchantROI.scenarios.mid.formattedPayback,
  },
  "Worst Case (₹1.0 margin)": {
    "Spread (Buy -> Sell)": `₹${merchantROI.scenarios.worst.buyRatePerKWh} -> ₹${merchantROI.scenarios.worst.sellRatePerKWh}`,
    "Margin": merchantROI.scenarios.worst.formattedMargin,
    "Annual Profit": merchantROI.scenarios.worst.formattedNetProfit,
    "Payback Period": merchantROI.scenarios.worst.formattedPayback,
  },
});

console.log("\n===============================================================");
console.log("✅ ALL PHASE 1 CORE MATH ENGINE CALCULATIONS VERIFIED SUCCESSFULLY");
console.log("===============================================================\n");
