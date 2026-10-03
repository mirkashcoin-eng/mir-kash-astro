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

export function isMumbaiArea(city: string): boolean {
  const c = city.trim().toLowerCase();
  return c !== '' && (MUMBAI_AREA.some((m) => c.includes(m)) || LOCALITY_RE.test(c));
}


// Private Viewing offers the switch to Try at Home only for these two names — a
// prompt there should be unmistakably right, so no suburbs or neighbouring cities.
export function isMumbaiCity(city: string): boolean {
  return /mumbai|bombay/i.test(city);
}
