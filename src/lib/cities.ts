// Which booking a typed city belongs to. The city field is free text in both
// forms, so these are the only city names the site knows.

// The Mumbai Metropolitan Region — where Try at Home visits. /api/geo uses the
// same list to decide who sees Try at Home in the first place. Matching is by
// substring, so "Navi Mumbai", "Thane West" and "Mira Road" all count.
export const MUMBAI_AREA = [
  'mumbai', 'bombay', 'navi mumbai', 'thane', 'kalyan', 'dombivli', 'mira', 'bhayandar',
  'vasai', 'virar', 'ulhasnagar', 'panvel', 'badlapur', 'ambernath', 'ambarnath',
];

// Neighbourhoods people give as their "city". Matched as whole words, not
// substrings — "Khar" mustn't catch Kharagpur.
export const MUMBAI_LOCALITIES = [
  'Andheri', 'Bandra', 'Borivali', 'Juhu', 'Powai', 'Colaba', 'Worli', 'Malad', 'Goregaon',
  'Kandivali', 'Dadar', 'Chembur', 'Ghatkopar', 'Mulund', 'Vile Parle', 'Santacruz', 'Khar',
  'Lower Parel', 'Parel', 'Kurla', 'Vikhroli', 'Bhandup', 'Dahisar', 'Versova', 'Lokhandwala',
  'Jogeshwari', 'Sion', 'Matunga', 'Mahim', 'Prabhadevi', 'Byculla', 'Wadala', 'Malabar Hill',
  'Breach Candy', 'Cuffe Parade', 'Nariman Point', 'Churchgate', 'Tardeo', 'Marine Lines',
  'Grant Road', 'Kemps Corner', 'Peddar Road', 'Kharghar', 'Vashi', 'Nerul', 'Belapur', 'Airoli',
  'Ghansoli', 'Sanpada', 'Seawoods', 'Ulwe',
];
const LOCALITY_RE = new RegExp(`\\b(${MUMBAI_LOCALITIES.map((l) => l.toLowerCase()).join('|')})\\b`);

// PIN codes Try at Home visits, as inclusive ranges → the city to fill in. Kept to
// ranges we're sure of: a PIN that isn't here is never refused, the form just asks
// whether it's in or near Mumbai, the same as for a city it doesn't know.
const MUMBAI_AREA_PINS: Array<[number, number, string]> = [
  [400001, 400104, 'Mumbai'],
  [400601, 400613, 'Thane'],
  [400614, 400614, 'Navi Mumbai'], // CBD Belapur
  [400615, 400615, 'Thane'],
  [400701, 400710, 'Navi Mumbai'],
  [410206, 410206, 'Panvel'],
  [410210, 410210, 'Navi Mumbai'], // Kharghar
  [401101, 401107, 'Mira-Bhayandar'],
  [401201, 401209, 'Vasai-Virar'],
  [401301, 401305, 'Vasai-Virar'],
  [421001, 421005, 'Ulhasnagar'],
  [421201, 421204, 'Dombivli'],
  [421301, 421301, 'Kalyan'],
  [421304, 421304, 'Kalyan'],
  [421306, 421306, 'Kalyan'],
  [421501, 421501, 'Ambernath'],
  [421503, 421503, 'Badlapur'],
  [421505, 421505, 'Ambernath'],
];

// The city a Mumbai-area PIN belongs to, or null for any other PIN (or not a PIN).
export function cityForPin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin.trim())) return null;
  const n = Number(pin.trim());
  return MUMBAI_AREA_PINS.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null;
}

export function isMumbaiArea(city: string): boolean {
  const c = city.trim().toLowerCase();
  return c !== '' && (MUMBAI_AREA.some((m) => c.includes(m)) || LOCALITY_RE.test(c));
}


// Private Viewing offers the switch to Try at Home only for these two names — a
// prompt there should be unmistakably right, so no suburbs or neighbouring cities.
export function isMumbaiCity(city: string): boolean {
  return /mumbai|bombay/i.test(city);
}
