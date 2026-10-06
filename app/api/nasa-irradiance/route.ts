import { NextResponse } from "next/server";

export async function GET() {
  const NASA_URL =
    "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=78.4867&latitude=17.3850&format=JSON";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(NASA_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 86400 }, // Cache climatology for 24 hours
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`NASA API returned status ${response.status}`);
    }

    const data = await response.json();
    const annValue = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN;

    if (typeof annValue !== "number" || isNaN(annValue)) {
      throw new Error("Invalid ANN value received from NASA API");
    }

    const roundedSunHours = Number(annValue.toFixed(2));

    return NextResponse.json({
      success: true,
      annualAverageSunHours: roundedSunHours,
      rawAnn: annValue,
      parameter: "ALLSKY_SFC_SW_DWN",
      description: "All Sky Insolation Incident on a Horizontal Surface (kWh/m^2/day)",
      location: {
        city: "Hyderabad",
        latitude: 17.385,
        longitude: 78.4867,
      },
      monthly: data?.properties?.parameter?.ALLSKY_SFC_SW_DWN || {},
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch NASA API data";
    return NextResponse.json(
      {
        success: false,
        error: message,
        fallbackSunHours: 5.36,
      },
      { status: 502 }
    );
  }
}
