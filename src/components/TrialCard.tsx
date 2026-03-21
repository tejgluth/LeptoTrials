import { useState, useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { Study, OverallStatus } from '../types/trial'
import { getTrialUrl } from '../utils/apiClient'

gsap.registerPlugin(ScrollTrigger)

interface TrialCardProps {
  study: Study
  index: number
}

const STATUS_CONFIG: Record<OverallStatus, { label: string; color: string; bg: string }> = {
  RECRUITING:                { label: 'Recruiting',              color: '#34d399', bg: '#34d39918' },
  NOT_YET_RECRUITING:        { label: 'Not Yet Recruiting',      color: '#fbbf24', bg: '#fbbf2418' },
  ACTIVE_NOT_RECRUITING:     { label: 'Active, Not Recruiting',  color: '#60a5fa', bg: '#60a5fa18' },
  COMPLETED:                 { label: 'Completed',               color: '#6b8ca4', bg: '#6b8ca418' },
  TERMINATED:                { label: 'Terminated',              color: '#f87171', bg: '#f8717118' },
  WITHDRAWN:                 { label: 'Withdrawn',               color: '#6b8ca4', bg: '#6b8ca418' },
  SUSPENDED:                 { label: 'Suspended',               color: '#fbbf24', bg: '#fbbf2418' },
  UNKNOWN:                   { label: 'Unknown',                 color: '#6b8ca4', bg: '#6b8ca418' },
  AVAILABLE:                 { label: 'Available',               color: '#60a5fa', bg: '#60a5fa18' },
  NO_LONGER_AVAILABLE:       { label: 'No Longer Available',     color: '#6b8ca4', bg: '#6b8ca418' },
  TEMPORARILY_NOT_AVAILABLE: { label: 'Temporarily Unavailable', color: '#fbbf24', bg: '#fbbf2418' },
  APPROVED_FOR_MARKETING:    { label: 'Approved for Marketing',  color: '#34d399', bg: '#34d39918' },
  WITHHELD:                  { label: 'Withheld',                color: '#6b8ca4', bg: '#6b8ca418' },
}

function formatPhase(phases: string[] | undefined): string {
  if (!phases || phases.length === 0) return ''
  return phases.map((p) => {
    switch (p) {
      case 'PHASE1':       return 'Phase 1'
      case 'PHASE2':       return 'Phase 2'
      case 'PHASE3':       return 'Phase 3'
      case 'PHASE4':       return 'Phase 4'
      case 'EARLY_PHASE1': return 'Early Phase 1'
      case 'NA':           return 'N/A'
      default:             return p
    }
  }).join(' / ')
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length >= 2) {
    const date = new Date(dateStr + (parts.length === 2 ? '-01' : ''))
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    }
  }
  return dateStr
}

function formatResponsibleParty(study: Study): string {
  const rp = study.protocolSection?.sponsorCollaboratorsModule?.responsibleParty
  if (!rp) return '—'
  if (rp.investigatorFullName) {
    const parts = [rp.investigatorFullName]
    if (rp.investigatorTitle) parts.push(rp.investigatorTitle)
    if (rp.investigatorAffiliation) parts.push(rp.investigatorAffiliation)
    return parts.join(' · ')
  }
  switch (rp.type) {
    case 'SPONSOR':               return study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name ?? 'Sponsor'
    case 'PRINCIPAL_INVESTIGATOR':return 'Principal Investigator'
    case 'SPONSOR_INVESTIGATOR':  return 'Sponsor-Investigator'
    default:                      return rp.type ?? '—'
  }
}

export default function TrialCard({ study, index }: TrialCardProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const proto    = study.protocolSection
  const id       = proto.identificationModule
  const status   = proto.statusModule
  const design   = proto.designModule
  const contacts = proto.contactsLocationsModule

  const nctId             = id.nctId
  const briefTitle        = id.briefTitle
  const officialTitle     = id.officialTitle
  const orgFullName       = id.organization?.fullName
  const overallStatus     = status.overallStatus
  const startDate         = status.startDateStruct?.date
  const hasExpandedAccess = status.expandedAccessInfo?.hasExpandedAccess ?? false
  const studyType         = design.studyType
  const phases            = design.phases
  const enrollment        = design.enrollmentInfo
  const briefSummary      = proto.descriptionModule?.briefSummary ?? ''
  const conditions        = proto.conditionsModule?.conditions ?? []
  const centralContacts   = contacts?.centralContacts ?? []
  const contactEmail      = centralContacts.find((c) => c.email)?.email

  const statusCfg        = STATUS_CONFIG[overallStatus] ?? { label: overallStatus, color: '#6b8ca4', bg: '#6b8ca418' }
  const phaseLabel       = formatPhase(phases)
  const trialUrl         = getTrialUrl(nctId)
  const responsibleParty = formatResponsibleParty(study)

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced || !cardRef.current) return
    const el = cardRef.current
    gsap.fromTo(
      el,
      { opacity: 0, y: 24 },
      {
        opacity: 1, y: 0, duration: 0.6,
        delay: Math.min(index * 0.04, 0.3),
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 90%' },
      }
    )
  }, [index])

  const copyEmail = async () => {
    if (!contactEmail) return
    try {
      await navigator.clipboard.writeText(contactEmail)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (non-HTTPS or unsupported browser)
    }
  }

  const SUMMARY_LIMIT = 280

  return (
    <div
      ref={cardRef}
      className="relative bg-[#0c1e34] border border-[#1a3352] hover:border-[#2a5070] transition-colors duration-300"
    >
      {/* Left status accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: statusCfg.color + '80' }}
      />

      <div className="px-6 sm:px-8 py-6 sm:py-7 pl-8 sm:pl-10">

        {/* Badge row */}
        <div className="flex flex-wrap items-center gap-2 mb-5">

          {/* Status */}
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 text-base font-semibold"
            style={{ color: statusCfg.color, backgroundColor: statusCfg.bg }}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: statusCfg.color }} />
            {statusCfg.label}
          </span>

          {/* Phase */}
          {phaseLabel && phaseLabel !== 'N/A' && (
            <span className="px-3 py-1.5 text-base font-medium text-[#b0d8ee] bg-[#0a1a2e] border border-[#1a3352]">
              {phaseLabel}
            </span>
          )}

          {/* Study type */}
          <span className="px-3 py-1.5 text-base font-medium text-[#b0d8ee] bg-[#0a1a2e] border border-[#1a3352]">
            {studyType === 'INTERVENTIONAL' ? 'Interventional'
              : studyType === 'OBSERVATIONAL' ? 'Observational'
              : studyType}
          </span>

          {/* NCT ID */}
          <span className="ml-auto text-xs text-[#8ecfe8] font-mono tracking-wide hidden sm:inline">
            {nctId}
          </span>
        </div>

        {/* Title block */}
        <div className="mb-5">
          <h2 className="text-[#e8f4fd] font-semibold text-xl sm:text-2xl leading-snug mb-2">
            {briefTitle}
          </h2>
          {officialTitle && officialTitle !== briefTitle && (
            <p className="text-[#8ecfe8] text-base leading-relaxed">
              {officialTitle}
            </p>
          )}
          {/* NCT ID mobile */}
          <p className="text-xs text-[#8ecfe8] font-mono mt-2 sm:hidden">{nctId}</p>
        </div>

        {/* Condition tags */}
        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {conditions.slice(0, 5).map((cond) => (
              <span
                key={cond}
                className="text-sm px-2.5 py-1 text-[#8ecfe8] bg-[#0a1a2e] border border-[#1a3352] leading-none"
              >
                {cond}
              </span>
            ))}
            {conditions.length > 5 && (
              <span className="text-xs px-2 py-1 text-[#8ecfe8]">
                +{conditions.length - 5} more
              </span>
            )}
          </div>
        )}

        <div className="h-px bg-[#142840] mb-5" />

        {/* Brief summary */}
        {briefSummary && (
          <div className="mb-5">
            <p className="text-base text-[#b0d8ee] leading-relaxed">
              {summaryExpanded || briefSummary.length <= SUMMARY_LIMIT
                ? briefSummary
                : briefSummary.substring(0, SUMMARY_LIMIT) + '…'}
            </p>
            {briefSummary.length > SUMMARY_LIMIT && (
              <button
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="text-sm text-[#8ecfe8] hover:text-[#38bdf8] mt-2 transition-colors cursor-pointer"
              >
                {summaryExpanded ? '↑ Show less' : '↓ Read more'}
              </button>
            )}
          </div>
        )}

        <div className="h-px bg-[#142840] mb-5" />

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-5">
          <div>
            <p className="text-sm font-medium text-[#8ecfe8] mb-1.5 uppercase tracking-wider">Organization</p>
            <p className="text-base text-[#b0d8ee] leading-snug">{orgFullName ?? '—'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#8ecfe8] mb-1.5 uppercase tracking-wider">Responsible Party</p>
            <p className="text-base text-[#b0d8ee] leading-snug">{responsibleParty}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#8ecfe8] mb-1.5 uppercase tracking-wider">Start Date</p>
            <p className="text-base text-[#b0d8ee]">
              {formatDate(startDate)}
              {status.startDateStruct?.type === 'ESTIMATED' && (
                <span className="text-[#8ecfe8] ml-1.5">(est.)</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#8ecfe8] mb-1.5 uppercase tracking-wider">Enrollment</p>
            <p className="text-base text-[#b0d8ee]">
              {enrollment ? (
                <>
                  {enrollment.count.toLocaleString()}
                  <span className="text-[#8ecfe8] ml-1.5">
                    {enrollment.type === 'ESTIMATED' ? '(est.)' : '(actual)'}
                  </span>
                </>
              ) : '—'}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#8ecfe8] mb-1.5 uppercase tracking-wider">Expanded Access</p>
            <p className="text-base text-[#b0d8ee]">
              {hasExpandedAccess ? <span style={{ color: '#34d399' }}>Yes</span> : 'No'}
            </p>
          </div>
          {status.studyFirstSubmitDate && (
            <div>
              <p className="text-sm font-medium text-[#8ecfe8] mb-1.5 uppercase tracking-wider">First Submitted</p>
              <p className="text-base text-[#b0d8ee]">{formatDate(status.studyFirstSubmitDate)}</p>
            </div>
          )}
        </div>

        <div className="h-px bg-[#142840] mb-5" />

        {/* Contact + CTA */}
        <div className="flex flex-wrap items-center gap-4">
          {contactEmail ? (
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-base font-medium text-[#8ecfe8] flex-shrink-0">Contact:</span>
              <span className="text-base text-[#38bdf8] font-mono truncate">{contactEmail}</span>
              <button
                onClick={copyEmail}
                title="Copy email"
                className="text-[#8ecfe8] hover:text-[#38bdf8] transition-colors cursor-pointer flex-shrink-0"
              >
                {copied ? (
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M2.5 7.5L6 11L12.5 3.5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <rect x="5" y="2" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M2 5H4V13H11.5V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            </div>
          ) : (
            <span className="text-base text-[#8ecfe8]">Contact via ClinicalTrials.gov</span>
          )}

          <a
            href={trialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-2.5 border border-[#1a3352] text-[#b0d8ee] hover:text-[#e8f4fd] hover:border-[#38bdf8] px-5 py-2.5 text-base font-medium transition-colors duration-200 min-h-[40px]"
          >
            View Trial
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 9.5L9.5 1.5M9.5 1.5H3.5M9.5 1.5V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  )
}
