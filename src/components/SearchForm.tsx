import { useState } from 'react'
import type { SearchParams, StudyTypeFilter, PhaseFilter, OverallStatus, TumorTypeFilter } from '../types/trial'
import { DEFAULT_STATUSES } from '../utils/apiClient'
import { COUNTRIES, CONTINENTS } from '../constants/countries'

interface SearchFormProps {
  onSearch: (params: SearchParams) => void
  isLoading: boolean
  compact?: boolean
  isCollapsed?: boolean
  onToggleCollapsed?: () => void
}

export default function SearchForm({
  onSearch,
  isLoading,
  compact = false,
  isCollapsed = false,
  onToggleCollapsed,
}: SearchFormProps) {
  const [age, setAge] = useState<string>('')
  const [ageError, setAgeError] = useState<string>('')
  const [studyTypes, setStudyTypes] = useState<Array<'INTERVENTIONAL' | 'OBSERVATIONAL'>>([])
  const [phases, setPhases] = useState<PhaseFilter[]>([])
  const [locationFilter, setLocationFilter] = useState<string>('')
  const [statuses, setStatuses] = useState<OverallStatus[]>(DEFAULT_STATUSES)
  const [tumorType, setTumorType] = useState<TumorTypeFilter>('any')

  const toggleStudyType = (type: 'INTERVENTIONAL' | 'OBSERVATIONAL') => {
    setStudyTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  const togglePhase = (phase: PhaseFilter) => {
    setPhases((prev) =>
      prev.includes(phase) ? prev.filter((p) => p !== phase) : [...prev, phase]
    )
  }

  const toggleTumorType = (type: TumorTypeFilter) => {
    setTumorType((prev) => (prev === type ? 'any' : type))
  }

  const toggleStatus = (status: OverallStatus) => {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    )
  }

  // Returns null (no age), a number (valid age), or undefined (invalid — abort submit).
  const validateAge = (val: string): number | null | undefined => {
    if (val === '') {
      setAgeError('')
      return null
    }
    const n = parseInt(val, 10)
    if (isNaN(n) || n < 0 || n > 120) {
      setAgeError('Please enter a valid age between 0 and 120.')
      return undefined
    }
    setAgeError('')
    return n
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsedAge = validateAge(age)
    if (parsedAge === undefined) return
    if (statuses.length === 0) setStatuses(DEFAULT_STATUSES)
    // 0 or 2 selected → 'any'; exactly 1 selected → that type
    const studyType: StudyTypeFilter =
      studyTypes.length === 1 ? studyTypes[0] : 'any'

    const isContinent = locationFilter !== '' && CONTINENTS.includes(locationFilter)
    onSearch({
      age: parsedAge,
      studyType,
      phases,
      country: !isContinent && locationFilter ? locationFilter : null,
      continent: isContinent ? locationFilter : null,
      statuses: statuses.length > 0 ? statuses : DEFAULT_STATUSES,
      tumorType,
    })
  }

  const phaseOptions: { value: PhaseFilter; label: string }[] = [
    { value: 'PHASE1', label: 'Phase 1' },
    { value: 'PHASE2', label: 'Phase 2' },
    { value: 'PHASE3', label: 'Phase 3' },
  ]

  const tumorTypeOptions: { value: TumorTypeFilter; label: string }[] = [
    { value: 'any',         label: 'Any tumor type' },
    { value: 'LUNG',        label: 'Lung' },
    { value: 'BREAST',      label: 'Breast' },
    { value: 'MELANOMA',    label: 'Melanoma' },
    { value: 'GBM',         label: 'GBM' },
    { value: 'OTHER_SOLID', label: 'Other / Solid tumor' },
  ]

  const statusOptions: { value: OverallStatus; label: string; color: string }[] = [
    { value: 'RECRUITING',            label: 'Recruiting',             color: '#34d399' },
    { value: 'NOT_YET_RECRUITING',    label: 'Not Yet Recruiting',     color: '#fbbf24' },
    { value: 'ACTIVE_NOT_RECRUITING', label: 'Active, Not Recruiting', color: '#60a5fa' },
    { value: 'ENROLLING_BY_INVITATION', label: 'Enrolling by Invitation', color: '#a78bfa' },
    { value: 'COMPLETED',             label: 'Completed',              color: '#6b8ca4' },
    { value: 'TERMINATED',            label: 'Terminated',             color: '#f87171' },
    { value: 'WITHDRAWN',             label: 'Withdrawn',              color: '#94a3b8' },
    { value: 'SUSPENDED',             label: 'Suspended',              color: '#f59e0b' },
    { value: 'UNKNOWN',               label: 'Unknown',                color: '#94a3b8' },
  ]

  const inputCls =
    'w-full bg-[#0a1a2e] border border-[#1a3352] text-[#e8f4fd] placeholder-[#4a7896] px-4 py-3 text-base focus:outline-none focus:border-[#38bdf8] transition-colors min-h-[48px] sm:min-h-[52px] rounded-sm'

  return (
    <form onSubmit={handleSubmit} className="w-full border-b border-[#1a3352]/60">
      {/* transition-[padding] animates the compact/full height switch without layout shift */}
      <div className={`px-4 sm:px-8 md:px-12 lg:px-20 max-w-7xl transition-[padding] duration-200 ${compact ? 'py-3.5 sm:py-5' : 'py-6 sm:py-10'}`}>

        {compact ? (
          <div className={`flex items-center justify-between gap-3 ${isCollapsed ? '' : 'mb-3'}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#8ecfe8]">
              Filter Trials
            </p>
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="flex items-center gap-1.5 text-xs font-medium text-[#8ecfe8] hover:text-[#b0d8ee] transition-colors cursor-pointer px-3 py-2 -mr-2 min-h-[44px]"
                aria-label={isCollapsed ? 'Expand filters' : 'Collapse filters'}
              >
                {isCollapsed ? (
                  <>Show filters <span className="text-[10px]">▼</span></>
                ) : (
                  <>Hide filters <span className="text-[10px]">▲</span></>
                )}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8ecfe8] mb-6 sm:mb-7">
            Filter Trials
          </p>
        )}

        {(!isCollapsed || !compact) && (
        <div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 ${compact ? 'mb-3 mt-3' : 'mb-6 sm:mb-7'}`}>

          <div className="flex flex-col gap-2.5">
            <label htmlFor="filter-age" className="text-sm font-semibold text-[#b0d8ee]">
              Your Age
            </label>
            <div className="relative">
              <input
                id="filter-age"
                name="age"
                type="number"
                autoComplete="off"
                min={0}
                max={120}
                value={age}
                onChange={(e) => {
                  setAge(e.target.value)
                  if (ageError) validateAge(e.target.value)
                }}
                placeholder="Any age"
                className={inputCls}
              />
              {age && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#8ecfe8]">
                  yrs
                </span>
              )}
            </div>
            {ageError && (
              <p className="text-sm text-red-400">{ageError}</p>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <label htmlFor="filter-location" className="text-sm font-semibold text-[#b0d8ee]">
              Location
            </label>
            <select
              id="filter-location"
              name="location"
              autoComplete="off"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className={`${inputCls} appearance-none cursor-pointer`}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath fill='%234a7896' d='M7 9.5L2 4h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 14px center',
                paddingRight: '40px',
              }}
            >
              <option value="">Anywhere</option>
              <optgroup label="By Region">
                {CONTINENTS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </optgroup>
              <optgroup label="By Country">
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-[#b0d8ee]" aria-hidden="true">
              Study Type
            </p>
            <div className="flex gap-2 sm:gap-3" role="group" aria-label="Study type">
              {(['INTERVENTIONAL', 'OBSERVATIONAL'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleStudyType(type)}
                  className={`flex-1 text-xs sm:text-sm font-medium border transition-colors duration-150 cursor-pointer min-h-[48px] sm:min-h-[52px] px-1.5 sm:px-2 ${
                    studyTypes.includes(type)
                      ? 'bg-[#38bdf8] text-[#060f1e] border-[#38bdf8]'
                      : 'bg-[#0a1a2e] text-[#8ecfe8] hover:text-[#b0d8ee] hover:bg-[#0f2240] border-[#1a3352]'
                  }`}
                >
                  {type === 'INTERVENTIONAL' ? 'Interventional' : 'Observational'}
                </button>
              ))}
            </div>
            {studyTypes.length === 0 && (
              <p className="text-xs text-[#8ecfe8]">All types included</p>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-[#b0d8ee]" aria-hidden="true">
              Phase{' '}
              <span className="text-[#8ecfe8] font-normal normal-case">
                — select any
              </span>
            </p>
            <div className="grid grid-cols-3 border border-[#1a3352] overflow-hidden min-h-[48px] sm:min-h-[52px]" role="group" aria-label="Trial phase">
              {phaseOptions.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => togglePhase(value)}
                  className={`text-xs sm:text-sm font-medium transition-colors duration-150 cursor-pointer px-1 ${
                    phases.includes(value)
                      ? 'bg-[#38bdf8] text-[#060f1e]'
                      : 'bg-[#0a1a2e] text-[#8ecfe8] hover:text-[#b0d8ee] hover:bg-[#0f2240]'
                  }`}
                >
                  <span className="sm:hidden">{label.replace('Phase ', 'P')}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            {phases.length === 0 && (
              <p className="text-xs text-[#8ecfe8]">All phases included</p>
            )}
          </div>
        </div>

        <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 sm:gap-y-4 ${compact ? 'mb-3' : 'mb-6 sm:mb-8'}`}>
          <span className="text-sm font-semibold text-[#b0d8ee] w-full sm:w-auto mb-0.5 sm:mb-0">
            Recruitment Status
          </span>
          {statusOptions.map(({ value, label, color }) => (
            <label key={value} htmlFor={`filter-status-${value.toLowerCase().replace(/_/g, '-')}`} className="flex items-center gap-2.5 cursor-pointer group min-h-[44px]">
              <span
                className="relative inline-flex items-center justify-center w-6 h-6 border-2 flex-shrink-0 transition-all"
                style={{
                  borderColor: statuses.includes(value) ? color : '#1a3352',
                  backgroundColor: statuses.includes(value) ? color + '20' : 'transparent',
                }}
              >
                {statuses.includes(value) && (
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path
                      d="M1.5 5.5L4.5 8.5L9.5 2.5"
                      stroke={color}
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                <input
                  id={`filter-status-${value.toLowerCase().replace(/_/g, '-')}`}
                  name={`status-${value}`}
                  type="checkbox"
                  checked={statuses.includes(value)}
                  onChange={() => toggleStatus(value)}
                  className="sr-only"
                />
              </span>
              <span className="text-sm sm:text-base text-[#b0d8ee] group-hover:text-[#c9dff0] transition-colors">
                {label}
              </span>
            </label>
          ))}
        </div>

        <div className={`flex flex-col gap-2.5 ${compact ? 'mb-3' : 'mb-6 sm:mb-8'}`}>
          <p className="text-sm font-semibold text-[#b0d8ee]" aria-hidden="true">
            Tumor Type
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tumor type filter">
            {tumorTypeOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleTumorType(value)}
                className={`px-3.5 py-2.5 text-sm font-medium border transition-colors duration-150 cursor-pointer rounded-sm min-h-[44px] ${
                  tumorType === value
                    ? 'bg-[#38bdf8] text-[#060f1e] border-[#38bdf8]'
                    : 'bg-[#0a1a2e] text-[#8ecfe8] hover:text-[#b0d8ee] hover:bg-[#0f2240] border-[#1a3352]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tumorType !== 'any' && (
            <p className="text-xs italic text-[#8ecfe8]">
              Adding a tumor type may limit studies shown, because some trial records do not explicitly list the primary cancer.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-3 bg-[#38bdf8] text-[#060f1e] w-full sm:w-auto px-6 sm:px-10 py-3.5 sm:py-4 text-base font-semibold hover:bg-[#7dd3fc] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[48px] sm:min-h-[52px]"
        >
          {isLoading ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-[#060f1e] border-t-transparent rounded-full animate-spin" />
              Searching…
            </>
          ) : (
            <>
              Search Trials
              <span className="text-lg leading-none">→</span>
            </>
          )}
        </button>
        </div>
        )}
      </div>
    </form>
  )
}
