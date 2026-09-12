export type ContactAction = 'email_click' | 'email_copy'

export interface ContactEventPayload {
  action: ContactAction
  nctId: string
  eventId: string
}

export interface DailyContactActivity {
  date: string
  emailClicks: number
  emailCopies: number
  total: number
}

export interface TrialContactActivity {
  nctId: string
  emailClicks: number
  emailCopies: number
  total: number
  lastActivity: string
}

export interface RecentContactActivity {
  action: ContactAction
  nctId: string
  recordedAt: string
}

export interface ContactAnalyticsReport {
  generatedAt: string
  dataSince: string | null
  totals: {
    all: number
    emailClicks: number
    emailCopies: number
    activeTrials: number
    last7Days: number
    last30Days: number
  }
  daily: DailyContactActivity[]
  trials: TrialContactActivity[]
  recent: RecentContactActivity[]
}
