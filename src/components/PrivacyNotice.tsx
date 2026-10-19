import { useEffect } from 'react'
import BrandLogo from './BrandLogo'

const linkClass = 'text-[#b0d8ee] underline underline-offset-4 hover:text-white'
const sections = [
  {
    id: 'contacts', title: 'Trial contact counts',
    paragraphs: [
      'When you click or copy a trial contact email, we send the trial ID and action type to our server and update aggregate counts in Cloudflare D1. Counting is on by default and helps us understand which trial contacts are used. We do not save visitor IP addresses, IP-derived identifiers, names, email addresses, search filters, event timestamps, or message contents with these counts.',
      'Email links open a draft in your email app. We do not send or receive your message or read your clipboard. If you send an email, your provider and the trial team handle it under their own privacy practices.',
    ],
  },
  {
    id: 'search', title: 'Search requests',
    paragraphs: [
      'Age, tumor type, and continent filters stay in page memory. Your browser sends leptomeningeal search terms, country, phase, study type, recruitment status, pagination tokens, and study IDs directly to ClinicalTrials.gov. The registry receives your IP address and browser information; these requests may reveal a health-related interest. LeptoTrials does not save your search filters.',
    ],
  },
  {
    id: 'providers', title: 'Hosting and other services',
    paragraphs: [
      'Cloudflare hosts the site and processes IP addresses and standard request information to deliver and protect it. Its technical logs and backups follow its policies and settings, separately from our trial-count database. Providers may process data outside your country. External websites follow their own privacy practices.',
      'We use no application cookies, browser storage, advertising pixels, session recordings, or third-party tracking scripts. Fonts and images are hosted locally. We do not sell application data or share it for targeted advertising. Data may be disclosed where legally required or necessary to address abuse or security incidents. HTTPS protects requests in transit; no service can guarantee absolute security.',
    ],
  },
  {
    id: 'retention', title: 'Stored records',
    paragraphs: [
      'Trial totals remain until deleted by the operator; analytics access requires an administrative token. Older contact-event records and written trial suggestions remain in retired tables and are no longer used by the application. We no longer accept written submissions. The old IP-derived rate-limit table and its records have been deleted from the active database; provider recovery copies may persist under their retention settings.',
    ],
  },
  {
    id: 'choices', title: 'Your choices',
    paragraphs: [
      'Global Privacy Control or Do Not Track disables future contact counting when exposed by your browser. Requests needed to load the site and search the registry still occur. You can leave filters blank and contact us about access, correction, deletion, or other rights available under applicable law. We cannot identify your contributions to aggregate counts.',
      'This site is intended for adults, including caregivers searching for pediatric studies. We do not solicit personal information from children under 13. Please do not send medical records. We update this notice when our practices change.',
    ],
  },
]

export default function PrivacyNotice() {
  useEffect(() => {
    document.title = 'Privacy & data collection · LeptoTrials'
  }, [])

  return (
    <div className="min-h-screen bg-[#060f1e] text-[#e8f4fd]">
      <header className="border-b border-[#1a3352] px-5 sm:px-8">
        <nav aria-label="Main navigation" className="mx-auto flex min-h-[72px] max-w-[1100px] items-center justify-between gap-4">
          <a href="/" aria-label="LeptoTrials home"><BrandLogo className="text-[13px] tracking-[0.18em]" /></a>
          <a href="/" className={`${linkClass} inline-flex min-h-11 items-center text-[14px]`}>Back to trials</a>
        </nav>
      </header>
      <main className="mx-auto max-w-[800px] px-5 py-12 sm:px-8 sm:py-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ecfe8]">Your information, explained</p>
        <h1 className="mt-4 max-w-[800px] font-serif text-[clamp(36px,5vw,52px)] leading-[1.1] tracking-[-0.035em]">Privacy & data collection</h1>
        <p className="mt-5 text-[14px] text-[#8daac0]">Effective and last updated: October 7, 2026 · Applies to LeptoTrials at leptotrials.com</p>
        <p className="mt-7 max-w-[760px] text-[18px] leading-relaxed text-[#c4d8e7]">Browse without an account. Here is what the site processes and stores.</p>
        <div className="mt-10">
          <div className="min-w-0 space-y-10">
            {sections.map(section => (
              <section key={section.id} id={section.id} className="scroll-mt-8">
                <h2 className="text-[23px] font-semibold leading-snug">{section.title}</h2>
                {section.paragraphs.map(paragraph => <p key={paragraph} className="mt-4 text-[15px] leading-[1.85] text-[#b0c9dc]">{paragraph}</p>)}
              </section>
            ))}
            <section id="privacy-contact" className="border-t border-[#2a5070] pt-8 scroll-mt-8">
              <h2 className="text-[23px] font-semibold">Privacy contact</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#b0c9dc]">For privacy questions or data requests, email <a href="mailto:tejgluth@gmail.com" className={linkClass}>tejgluth@gmail.com</a>. The operator receives your address and message to respond; correspondence remains in the mailbox until deleted. If you believe a child’s information was submitted, contact us here.</p>
              <p className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-[14px]">
                <a className={linkClass} href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare privacy ↗</a>
                <a className={linkClass} href="https://clinicaltrials.gov/about-site/privacy-security" target="_blank" rel="noopener noreferrer">ClinicalTrials.gov privacy ↗</a>
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
