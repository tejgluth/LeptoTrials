export const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Italy',
  'Spain', 'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Sweden',
  'Denmark', 'Norway', 'Finland', 'Australia', 'Japan', 'China', 'South Korea',
  'Israel', 'Brazil', 'Mexico', 'Argentina', 'India', 'Singapore', 'Hong Kong',
  'New Zealand', 'Poland', 'Czech Republic', 'Portugal', 'Greece', 'Turkey',
  'Russia', 'Ukraine', 'South Africa',
] as const

export type Country = (typeof COUNTRIES)[number]
