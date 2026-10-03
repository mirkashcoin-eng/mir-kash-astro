// ISD/dial codes for the phone field on the Try at Home and Private Viewing
// booking wizards (src/components/BookDemo.astro, src/components/PrivateViewing.astro).
//
// Flags are derived at render time from the ISO 3166-1 alpha-2 code rather than
// stored as emoji literals — each flag emoji is just two "regional indicator
// symbol" code points offset from the ASCII letters, so this file stays a small,
// accurate table instead of ~195 hand-typed emoji. (src/lib/markets.ts already
// uses emoji flags for its currency/market selector — this is the same convention,
// just generated instead of typed, so it scales to "anywhere in the world" rather
// than the ~50 countries markets.ts covers for storefront pricing.)

export interface CountryDial {
  iso2: string;
  name: string;
  dial: string;
}

export function flagEmoji(iso2: string): string {
  const cc = iso2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  const A = 0x1f1e6; // Regional Indicator Symbol Letter A
  return String.fromCodePoint(...[...cc].map((c) => A + (c.charCodeAt(0) - 65)));
}

// India first (the storefront's home market), then alphabetical by country name.
export const COUNTRIES: CountryDial[] = [
  { iso2: 'IN', name: 'India', dial: '+91' },
  { iso2: 'AF', name: 'Afghanistan', dial: '+93' },
  { iso2: 'AL', name: 'Albania', dial: '+355' },
  { iso2: 'DZ', name: 'Algeria', dial: '+213' },
  { iso2: 'AR', name: 'Argentina', dial: '+54' },
  { iso2: 'AM', name: 'Armenia', dial: '+374' },
  { iso2: 'AU', name: 'Australia', dial: '+61' },
  { iso2: 'AT', name: 'Austria', dial: '+43' },
  { iso2: 'AZ', name: 'Azerbaijan', dial: '+994' },
  { iso2: 'BH', name: 'Bahrain', dial: '+973' },
  { iso2: 'BD', name: 'Bangladesh', dial: '+880' },
  { iso2: 'BY', name: 'Belarus', dial: '+375' },
  { iso2: 'BE', name: 'Belgium', dial: '+32' },
  { iso2: 'BT', name: 'Bhutan', dial: '+975' },
  { iso2: 'BO', name: 'Bolivia', dial: '+591' },
  { iso2: 'BA', name: 'Bosnia and Herzegovina', dial: '+387' },
  { iso2: 'BR', name: 'Brazil', dial: '+55' },
  { iso2: 'BN', name: 'Brunei', dial: '+673' },
  { iso2: 'BG', name: 'Bulgaria', dial: '+359' },
  { iso2: 'KH', name: 'Cambodia', dial: '+855' },
  { iso2: 'CA', name: 'Canada', dial: '+1' },
  { iso2: 'CL', name: 'Chile', dial: '+56' },
  { iso2: 'CN', name: 'China', dial: '+86' },
  { iso2: 'CO', name: 'Colombia', dial: '+57' },
  { iso2: 'CR', name: 'Costa Rica', dial: '+506' },
  { iso2: 'HR', name: 'Croatia', dial: '+385' },
  { iso2: 'CY', name: 'Cyprus', dial: '+357' },
  { iso2: 'CZ', name: 'Czechia', dial: '+420' },
  { iso2: 'DK', name: 'Denmark', dial: '+45' },
  { iso2: 'EC', name: 'Ecuador', dial: '+593' },
  { iso2: 'EG', name: 'Egypt', dial: '+20' },
  { iso2: 'EE', name: 'Estonia', dial: '+372' },
  { iso2: 'ET', name: 'Ethiopia', dial: '+251' },
  { iso2: 'FI', name: 'Finland', dial: '+358' },
  { iso2: 'FR', name: 'France', dial: '+33' },
  { iso2: 'GE', name: 'Georgia', dial: '+995' },
  { iso2: 'DE', name: 'Germany', dial: '+49' },
  { iso2: 'GH', name: 'Ghana', dial: '+233' },
  { iso2: 'GR', name: 'Greece', dial: '+30' },
  { iso2: 'HK', name: 'Hong Kong', dial: '+852' },
  { iso2: 'HU', name: 'Hungary', dial: '+36' },
  { iso2: 'IS', name: 'Iceland', dial: '+354' },
  { iso2: 'ID', name: 'Indonesia', dial: '+62' },
  { iso2: 'IQ', name: 'Iraq', dial: '+964' },
  { iso2: 'IE', name: 'Ireland', dial: '+353' },
  { iso2: 'IL', name: 'Israel', dial: '+972' },
  { iso2: 'IT', name: 'Italy', dial: '+39' },
  { iso2: 'JP', name: 'Japan', dial: '+81' },
  { iso2: 'JO', name: 'Jordan', dial: '+962' },
  { iso2: 'KZ', name: 'Kazakhstan', dial: '+7' },
  { iso2: 'KE', name: 'Kenya', dial: '+254' },
  { iso2: 'KW', name: 'Kuwait', dial: '+965' },
  { iso2: 'KG', name: 'Kyrgyzstan', dial: '+996' },
  { iso2: 'LA', name: 'Laos', dial: '+856' },
  { iso2: 'LV', name: 'Latvia', dial: '+371' },
  { iso2: 'LB', name: 'Lebanon', dial: '+961' },
  { iso2: 'LT', name: 'Lithuania', dial: '+370' },
  { iso2: 'LU', name: 'Luxembourg', dial: '+352' },
  { iso2: 'MO', name: 'Macau', dial: '+853' },
  { iso2: 'MY', name: 'Malaysia', dial: '+60' },
  { iso2: 'MV', name: 'Maldives', dial: '+960' },
  { iso2: 'MT', name: 'Malta', dial: '+356' },
  { iso2: 'MU', name: 'Mauritius', dial: '+230' },
  { iso2: 'MX', name: 'Mexico', dial: '+52' },
  { iso2: 'MD', name: 'Moldova', dial: '+373' },
  { iso2: 'MC', name: 'Monaco', dial: '+377' },
  { iso2: 'MN', name: 'Mongolia', dial: '+976' },
  { iso2: 'ME', name: 'Montenegro', dial: '+382' },
  { iso2: 'MA', name: 'Morocco', dial: '+212' },
  { iso2: 'MM', name: 'Myanmar', dial: '+95' },
  { iso2: 'NP', name: 'Nepal', dial: '+977' },
  { iso2: 'NL', name: 'Netherlands', dial: '+31' },
  { iso2: 'NZ', name: 'New Zealand', dial: '+64' },
  { iso2: 'NG', name: 'Nigeria', dial: '+234' },
  { iso2: 'MK', name: 'North Macedonia', dial: '+389' },
  { iso2: 'NO', name: 'Norway', dial: '+47' },
  { iso2: 'OM', name: 'Oman', dial: '+968' },
  { iso2: 'PK', name: 'Pakistan', dial: '+92' },
  { iso2: 'PA', name: 'Panama', dial: '+507' },
  { iso2: 'PY', name: 'Paraguay', dial: '+595' },
  { iso2: 'PE', name: 'Peru', dial: '+51' },
  { iso2: 'PH', name: 'Philippines', dial: '+63' },
  { iso2: 'PL', name: 'Poland', dial: '+48' },
  { iso2: 'PT', name: 'Portugal', dial: '+351' },
  { iso2: 'QA', name: 'Qatar', dial: '+974' },
  { iso2: 'RO', name: 'Romania', dial: '+40' },
  { iso2: 'RU', name: 'Russia', dial: '+7' },
  { iso2: 'RW', name: 'Rwanda', dial: '+250' },
  { iso2: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { iso2: 'RS', name: 'Serbia', dial: '+381' },
  { iso2: 'SG', name: 'Singapore', dial: '+65' },
  { iso2: 'SK', name: 'Slovakia', dial: '+421' },
  { iso2: 'SI', name: 'Slovenia', dial: '+386' },
  { iso2: 'ZA', name: 'South Africa', dial: '+27' },
  { iso2: 'KR', name: 'South Korea', dial: '+82' },
  { iso2: 'ES', name: 'Spain', dial: '+34' },
  { iso2: 'LK', name: 'Sri Lanka', dial: '+94' },
  { iso2: 'SE', name: 'Sweden', dial: '+46' },
  { iso2: 'CH', name: 'Switzerland', dial: '+41' },
  { iso2: 'TW', name: 'Taiwan', dial: '+886' },
  { iso2: 'TJ', name: 'Tajikistan', dial: '+992' },
  { iso2: 'TZ', name: 'Tanzania', dial: '+255' },
  { iso2: 'TH', name: 'Thailand', dial: '+66' },
  { iso2: 'TR', name: 'Turkey', dial: '+90' },
  { iso2: 'TM', name: 'Turkmenistan', dial: '+993' },
  { iso2: 'UG', name: 'Uganda', dial: '+256' },
  { iso2: 'UA', name: 'Ukraine', dial: '+380' },
  { iso2: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { iso2: 'GB', name: 'United Kingdom', dial: '+44' },
  { iso2: 'US', name: 'United States', dial: '+1' },
  { iso2: 'UY', name: 'Uruguay', dial: '+598' },
  { iso2: 'UZ', name: 'Uzbekistan', dial: '+998' },
  { iso2: 'VE', name: 'Venezuela', dial: '+58' },
  { iso2: 'VN', name: 'Vietnam', dial: '+84' },
  { iso2: 'YE', name: 'Yemen', dial: '+967' },
];

export function findCountry(iso2: string): CountryDial | undefined {
  return COUNTRIES.find((c) => c.iso2 === iso2.toUpperCase());
}
