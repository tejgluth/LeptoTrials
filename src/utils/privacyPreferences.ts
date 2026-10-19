// No cookies, browser storage, or visitor identifiers are used for trial counts.
export function contactAnalyticsAllowed(): boolean {
  try {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean }
    return !privacy.globalPrivacyControl && navigator.doNotTrack !== '1'
  } catch {
    return false
  }
}
