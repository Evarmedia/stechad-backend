// helpers to coerce multipart values
const toInt = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

const toBool = (v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string")
    return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return Boolean(v);
};

const toTextArray = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (Array.isArray(v)) return v.map(String); // e.g. repeated form-data keys
  if (typeof v === "string") {
    // try JSON first: '["read","write"]'
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    // fallback: comma-separated 'read,write'
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // final fallback
  return [String(v)];
};

module.export = { toInt, toBool,toTextArray }