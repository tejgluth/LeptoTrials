export const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Italy',
  'Spain', 'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Sweden',
  'Denmark', 'Norway', 'Finland', 'Australia', 'Japan', 'China', 'South Korea',
  'Israel', 'Brazil', 'Mexico', 'Argentina', 'India', 'Singapore', 'Hong Kong',
  'New Zealand', 'Poland', 'Czech Republic', 'Portugal', 'Greece', 'Turkey',
  'Russia', 'Ukraine', 'South Africa',
] as const

export type Country = (typeof COUNTRIES)[number]

export const CONTINENT_COUNTRIES: Record<string, string[]> = {
  'North America': ['United States', 'Canada', 'Mexico'],
  'South America': ['Brazil', 'Argentina'],
  'Europe': [
    'United Kingdom', 'Germany', 'France', 'Italy', 'Spain',
    'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Sweden',
    'Denmark', 'Norway', 'Finland', 'Poland', 'Czech Republic',
    'Portugal', 'Greece', 'Turkey', 'Russia', 'Ukraine',
  ],
  'Asia': ['Japan', 'China', 'South Korea', 'India', 'Singapore', 'Hong Kong'],
  'Middle East': ['Israel'],
  'Oceania': ['Australia', 'New Zealand'],
  'Africa': ['South Africa'],
}

export const CONTINENTS = Object.keys(CONTINENT_COUNTRIES)
