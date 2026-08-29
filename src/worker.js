export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/decode") {
      return handleDecode(url, env);
    }

    if (url.pathname === "/api/recalls") {
      return handleRecalls(url, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleDecode(url, env) {
  const rawVin = (url.searchParams.get("vin") || "").trim().toUpperCase();
  const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

  if (!VIN_REGEX.test(rawVin)) {
    return jsonResponse({ error: "Invalid VIN. Must be 17 characters, no I, O or Q." }, 400);
  }

  const cached = await env.VIN_CACHE.get(rawVin);
  if (cached) {
    return jsonResponse(JSON.parse(cached), 200);
  }

  const nhtsaUrl = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${rawVin}?format=json`;
  let nhtsaData;
  try {
    const res = await fetch(nhtsaUrl);
    if (!res.ok) {
      return jsonResponse({ error: "NHTSA service unavailable, try again shortly." }, 502);
    }
    nhtsaData = await res.json();
  } catch (err) {
    return jsonResponse({ error: "Could not reach NHTSA service." }, 502);
  }

  const row = nhtsaData?.Results?.[0];
  if (!row) {
    return jsonResponse({ error: "Unexpected response from NHTSA." }, 502);
  }

  const result = {
    vin: rawVin,
    make: row.Make || null,
    model: row.Model || null,
    modelYear: row.ModelYear || null,
    vehicleType: row.VehicleType || null,
    bodyClass: row.BodyClass || null,
    driveType: row.DriveType || null,
    engineCylinders: row.EngineCylinders || null,
    displacementL: row.DisplacementL || null,
    fuelTypePrimary: row.FuelTypePrimary || null,
    doors: row.Doors || null,
    plantCity: row.PlantCity || null,
    plantState: row.PlantState || null,
    plantCountry: row.PlantCountry || null,
    errorCode: row.ErrorCode || null,
    errorText: row.ErrorText || null,
  };

  await env.VIN_CACHE.put(rawVin, JSON.stringify(result), { expirationTtl: 31536000 });

  return jsonResponse(result, 200);
}

async function handleRecalls(url, env) {
  const make = (url.searchParams.get("make") || "").trim();
  const model = (url.searchParams.get("model") || "").trim();
  const year = (url.searchParams.get("year") || "").trim();

  if (!make || !model || !/^\d{4}$/.test(year)) {
    return jsonResponse({ error: "make, model and a 4-digit year are required." }, 400);
  }

  const cacheKey = `recalls:${make.toLowerCase()}:${model.toLowerCase()}:${year}`;
  const cached = await env.VIN_CACHE.get(cacheKey);
  if (cached) {
    return jsonResponse(JSON.parse(cached), 200);
  }

  const params = new URLSearchParams({ make, model, modelYear: year });
  const recallsUrl = `https://api.nhtsa.gov/recalls/recallsByVehicle?${params}`;

  let data;
  try {
    const res = await fetch(recallsUrl);
    if (!res.ok) {
      return jsonResponse({ error: "Recalls service unavailable, try again shortly." }, 502);
    }
    data = await res.json();
  } catch (err) {
    return jsonResponse({ error: "Could not reach recalls service." }, 502);
  }

  const rows = data?.results || data?.Results || [];

  const recalls = rows.map((r) => ({
    campaignNumber: r.NHTSACampaignNumber || r.CampaignNumber || null,
    reportDate: r.ReportReceivedDate || null,
    component: r.Component || null,
    summary: r.Summary || null,
    consequence: r.Consequence || null,
    remedy: r.Remedy || null,
  }));

  const result = { make, model, year, count: recalls.length, recalls };

  // 7 días de cache: los recalls se actualizan semanalmente por mandato legal
  await env.VIN_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });

  return jsonResponse(result, 200);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
