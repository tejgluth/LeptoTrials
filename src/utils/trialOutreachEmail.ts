interface TrialOutreachEmailInput {
  recipient: string
  nctId: string
  trialTitle: string
  contactName?: string
}

const CONTACT_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export function normalizeContactEmail(value: string | undefined): string | undefined {
  if (!value) return undefined

  const email = value.trim()
  if (email.length > 254 || !CONTACT_EMAIL_PATTERN.test(email)) return undefined

  return email
}

function normalizeContactName(value: string | undefined): string | undefined {
  if (!value) return undefined

  const name = value.replace(/\s+/g, ' ').trim()
  return name && name.length <= 120 ? name : undefined
}

export function buildTrialOutreachMailto({
  recipient,
  nctId,
  trialTitle,
  contactName,
}: TrialOutreachEmailInput): string {
  const greetingName = normalizeContactName(contactName)
  const greeting = greetingName ? `Hello ${greetingName},` : 'Hello Clinical Trial Team,'
  const subject = `Question about clinical trial ${nctId}`
  const body = [
    greeting,
    '',
    `I am reaching out to learn more about the clinical trial “${trialTitle}” (${nctId}).`,
    '',
    'Could you please share whether the study is currently enrolling and how the initial eligibility review works?',
    '',
    'I am interested in participating in this trial and would appreciate guidance on the next steps, including any information you need from me.',
    '',
    'Thank you,',
    '[Your name]',
    '[Preferred phone number]',
    '[City, State/Country]',
  ].join('\r\n')

  // Keep the validated recipient readable for mail handlers such as Gmail while
  // encoding all user-visible message fields independently.
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
