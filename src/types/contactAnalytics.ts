export type ContactAction = 'email_click' | 'email_copy'
export interface ContactEventPayload {
  action: ContactAction
  nctId: string
}
export interface ContactAnalyticsReport {
  generatedAt: string
  totals: {
    all: number
    emailClicks: number
    emailCopies: number
    activeTrials: number
  }
  trials: {
    nctId: string
    emailClicks: number
    emailCopies: number
    total: number
  }[]
}
