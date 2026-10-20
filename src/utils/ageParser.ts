// "18 Years", "6 Months", "28 Days" -> age in years. null means no limit.
export function parseAgeToYears(ageStr: string | undefined | null): number | null {
  if (!ageStr || ageStr.trim() === '' || ageStr.trim().toLowerCase() === 'n/a') {
    return null
  }

  const cleaned = ageStr.trim()
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(year|month|week|day)/i)

  if (!match) {
    return null
  }

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  if (unit.startsWith('year')) return value
  if (unit.startsWith('month')) return value / 12
  if (unit.startsWith('week')) return value / 52.1775
  if (unit.startsWith('day')) return value / 365.25

  return null
}

export function isAgeEligible(
  patientAge: number,
  minimumAgeStr: string | undefined | null,
  maximumAgeStr: string | undefined | null
): boolean {
  const minAge = parseAgeToYears(minimumAgeStr)
  const maxAge = parseAgeToYears(maximumAgeStr)

  if (minAge !== null && patientAge < minAge) return false
  if (maxAge !== null && patientAge > maxAge) return false

  return true
}
