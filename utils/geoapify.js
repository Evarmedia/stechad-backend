const GEOAPIFY_REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";

const buildLocationLabel = ({ city, state, country } = {}) => {
  const parts = [city, state, country]
    .map((part) => String(part || "").trim())
    .filter((part, index, values) => part && values.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index);
  return parts.join(", ") || null;
};

const reverseGeocode = async (latitude, longitude) => {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "").trim();
  if (!apiKey) return null;

  const url = new URL(GEOAPIFY_REVERSE_URL);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", "1");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Geoapify reverse geocoding returned ${response.status}`);
  const payload = await response.json();
  const address = payload.results?.[0];
  if (!address) return null;

  return {
    browser_location_address: address.formatted || null,
    browser_location_city: address.city || null,
    browser_location_state: address.state || null,
    browser_location_country: address.country || null,
    browser_location_country_code: address.country_code || null,
  };
};

const distanceInKilometers = (firstLatitude, firstLongitude, secondLatitude, secondLongitude) => {
  const values = [firstLatitude, firstLongitude, secondLatitude, secondLongitude].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return Number.POSITIVE_INFINITY;
  const [lat1, lon1, lat2, lon2] = values.map((value) => value * Math.PI / 180);
  const latitudeDelta = lat2 - lat1;
  const longitudeDelta = lon2 - lon1;
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

module.exports = { buildLocationLabel, distanceInKilometers, reverseGeocode };
