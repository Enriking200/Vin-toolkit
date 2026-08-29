export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/decode") {
      return handleDecode(url, env);
    }

    // Cualquier otra ruta: servir el sitio estático normal
    return env.ASSETS.fetch(request);
  },
};

async function handleDecode(url, env) {
  const rawVin = (url.searchParams.get("vin") || "").trim().toUpperCase();
  const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

  if (!VIN_REGEX.test(rawVin)) {
    return jsonResponse({ error: "Invalid VIN. Must be 17 characters, no I, O or Q." }, 400);
  }

  // 1. Buscar en cache
  const cached = await env.VIN_CACHE.get(rawVin);
  if (cached) {
    return jsonResponse(JSON.parse(cached), 200);
  }

  // 2. Llamar a NHTSA vPIC
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

  // 3. Guardar en cache (1 año — el decode de un VIN concreto no cambia)
  await env.VIN_CACHE.put(rawVin, JSON.stringify(result), { expirationTtl: 31536000 });

  return jsonResponse(result, 200);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
