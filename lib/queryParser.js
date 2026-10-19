// Turns a plain-language request into structured hints that complement the embedding:
//   "alternator for 2015 Civic, need 90A or higher"
//   -> { year: 2015, minAmp: 90, vehicleIds: [Civic 2015] }
export function parseQuery(q, vehicles) {
  const text = q.toLowerCase();
  const yearMatch = text.match(/\b(19[89]\d|20[0-3]\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const ampMatch = text.match(/\b(\d{2,3})\s*-?\s*a(?:mps?)?\b/);
  const minAmp = ampMatch ? Number(ampMatch[1]) : null;

  // vehicle = model word present in the query (and year, if one was given)
  const hits = vehicles.filter((v) => text.includes(v.model.toLowerCase()) && (!year || v.year === year));
  const vehicleIds = hits.map((v) => v.vehicle_id);
  return { year, minAmp, vehicleIds, vehicles: hits };
}
