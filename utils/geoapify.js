const GEOAPIFY_REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
const GEOAPIFY_TIMEOUT_MS = Number(process.env.GEOAPIFY_TIMEOUT_MS) || 20_000;

const buildLocationLabel = ({ city, state, country } = {}) => {
  const parts = [city, state, country]
    .map((part) => String(part || "").trim())
    .filter((part, index, values) => part && values.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index);
  return parts.join(", ") || null;
};

const isGeoapifyConfigured = () => Boolean(String(process.env.GEOAPIFY_API_KEY || "").trim());

const requestReverseGeocode = async (latitude, longitude) => {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "").trim();
  if (!apiKey) return null;

  // Geoapify defaults to GeoJSON. Keep this request aligned with its documented
  // `lat`, `lon`, and `apiKey` example and parse features[0].properties below.
  const url = new URL(GEOAPIFY_REVERSE_URL);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(GEOAPIFY_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Geoapify reverse geocoding returned ${response.status}`);
  const payload = await response.json();
  const feature = payload.features?.[0] || null;
  // Retain compatibility if GEOAPIFY_FORMAT=json is introduced later.
  const properties = feature?.properties || payload.results?.[0] || null;

  return { payload, properties };
};

const normalizeGeoapifyAddress = (address) => {
  if (!address) return null;

  return {
    browser_location_address: address.formatted || null,
    browser_location_city: address.city || null,
    browser_location_state: address.state || null,
    browser_location_country: address.country || null,
    browser_location_country_code: address.country_code || null,
  };
};

const reverseGeocode = async (latitude, longitude) => {
  const result = await requestReverseGeocode(latitude, longitude);
  return normalizeGeoapifyAddress(result?.properties);
};

const reverseGeocodeWithProviderResponse = async (latitude, longitude) => {
  const result = await requestReverseGeocode(latitude, longitude);
  if (!result) return null;
  return {
    address: normalizeGeoapifyAddress(result.properties),
    providerResponse: result.payload,
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

module.exports = {
  buildLocationLabel,
  distanceInKilometers,
  isGeoapifyConfigured,
  reverseGeocode,
  reverseGeocodeWithProviderResponse,
};
