import { useState } from 'react'
import type { SearchParams, StudyTypeFilter, PhaseFilter, OverallStatus, TumorTypeFilter } from '../types/trial'
import { DEFAULT_STATUSES } from '../utils/apiClient'
import { COUNTRIES, CONTINENT_COUNTRIES, CONTINENTS } from '../constants/countries'

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

  const validateAge = (val: string): number | null => {
    if (val === '') return null
    const n = parseInt(val, 10)
    if (isNaN(n) || n < 0 || n > 120) {
      setAgeError('Please enter a valid age between 0 and 120.')
      return undefined as unknown as null
    }
    setAgeError('')
    return n
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsedAge = validateAge(age)
    if (parsedAge === undefined) return
    if (statuses.length === 0) setStatuses(DEFAULT_STATUSES)
    // Map toggled study types to the filter value:
    // 0 or 2 selected = any; exactly 1 selected = that type
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
  ]

  const inputCls =
    'w-full bg-[#0a1a2e] border border-[#1a3352] text-[#e8f4fd] placeholder-[#2a5070] px-4 py-3.5 text-base focus:outline-none focus:border-[#38bdf8] transition-colors min-h-[52px] rounded-sm'

  return (
    <form onSubmit={handleSubmit} className="w-full border-b border-[#1a3352]/60">
      {/* transition-[padding] smooths the compact ↔ full height switch */}
      <div className={`px-5 sm:px-8 md:px-12 lg:px-20 max-w-7xl transition-[padding] duration-200 ${compact ? 'py-4 sm:py-5' : 'py-8 sm:py-10'}`}>

        {/* Header row: label (non-sticky) or collapse toggle (sticky) */}
        {compact ? (
          <div className={`flex items-center justify-between ${isCollapsed ? '' : 'mb-3'}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#6ba3bf]">
              Filter Trials
            </p>
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="flex items-center gap-1.5 text-xs font-medium text-[#6ba3bf] hover:text-[#8ab8d4] transition-colors cursor-pointer px-2 py-1 -mr-2"
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
          <p className="text-xs font-semibold uppercase tracking-widest text-[#6ba3bf] mb-7">
            Filter Trials
          </p>
        )}

        {/* Collapsible body — hidden when collapsed in sticky mode */}
        {(!isCollapsed || !compact) && (
        <div>

        {/* Filter grid */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 ${compact ? 'mb-3 mt-3' : 'mb-7'}`}>

          {/* Age */}
          <div className="flex flex-col gap-2.5">
            <label htmlFor="filter-age" className="text-sm font-semibold text-[#8ab8d4]">
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
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#6ba3bf]">
                  yrs
                </span>
              )}
            </div>
            {ageError && (
              <p className="text-sm text-red-400">{ageError}</p>
            )}
          </div>

          {/* Location (Region or Country) */}
          <div className="flex flex-col gap-2.5">
            <label htmlFor="filter-location" className="text-sm font-semibold text-[#8ab8d4]">
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

          {/* Study Type */}
          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-[#8ab8d4]" aria-hidden="true">
              Study Type
            </p>
            <div className="flex gap-3 h-[52px]" role="group" aria-label="Study type">
              {(['INTERVENTIONAL', 'OBSERVATIONAL'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleStudyType(type)}
                  className={`flex-1 text-sm font-medium border transition-colors duration-150 cursor-pointer ${
                    studyTypes.includes(type)
                      ? 'bg-[#38bdf8] text-[#060f1e] border-[#38bdf8]'
                      : 'bg-[#0a1a2e] text-[#6ba3bf] hover:text-[#8ab8d4] hover:bg-[#0f2240] border-[#1a3352]'
                  }`}
                >
                  {type === 'INTERVENTIONAL' ? 'Interventional' : 'Observational'}
                </button>
              ))}
            </div>
            {studyTypes.length === 0 && (
              <p className="text-xs text-[#2a5070]">All types included</p>
            )}
          </div>

          {/* Phase */}
          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-[#8ab8d4]" aria-hidden="true">
              Phase{' '}
              <span className="text-[#2a5070] font-normal normal-case">
                — select any
              </span>
            </p>
            <div className="flex border border-[#1a3352] overflow-hidden h-[52px]" role="group" aria-label="Trial phase">
              {phaseOptions.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => togglePhase(value)}
                  className={`flex-1 text-sm font-medium transition-colors duration-150 cursor-pointer ${
                    phases.includes(value)
                      ? 'bg-[#38bdf8] text-[#060f1e]'
                      : 'bg-[#0a1a2e] text-[#6ba3bf] hover:text-[#8ab8d4] hover:bg-[#0f2240]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {phases.length === 0 && (
              <p className="text-xs text-[#2a5070]">All phases included</p>
            )}
          </div>
        </div>

        {/* Status row */}
        <div className={`flex flex-wrap items-center gap-x-8 gap-y-4 ${compact ? 'mb-3' : 'mb-8'}`}>
          <span className="text-sm font-semibold text-[#8ab8d4] w-full sm:w-auto">
            Recruitment Status
          </span>
          {statusOptions.map(({ value, label, color }) => (
            <label key={value} htmlFor={`filter-status-${value.toLowerCase().replace(/_/g, '-')}`} className="flex items-center gap-3 cursor-pointer group min-h-[44px]">
              <span
                className="relative inline-flex items-center justify-center w-5 h-5 border-2 flex-shrink-0 transition-all"
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
              <span className="text-base text-[#8ab8d4] group-hover:text-[#c9dff0] transition-colors">
                {label}
              </span>
            </label>
          ))}
        </div>

        {/* Tumor Type row */}
        <div className={`flex flex-col gap-2.5 ${compact ? 'mb-3' : 'mb-8'}`}>
          <p className="text-sm font-semibold text-[#8ab8d4]" aria-hidden="true">
            Tumor Type
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tumor type filter">
            {tumorTypeOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleTumorType(value)}
                className={`px-4 py-2 text-sm font-medium border transition-colors duration-150 cursor-pointer rounded-sm ${
                  tumorType === value
                    ? 'bg-[#38bdf8] text-[#060f1e] border-[#38bdf8]'
                    : 'bg-[#0a1a2e] text-[#6ba3bf] hover:text-[#8ab8d4] hover:bg-[#0f2240] border-[#1a3352]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tumorType !== 'any' && (
            <p className="text-xs italic text-[#2a5070]">
              Adding a tumor type may limit studies shown, because some trial records do not explicitly list the primary cancer.
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center gap-3 bg-[#38bdf8] text-[#060f1e] px-8 sm:px-10 py-4 text-base font-semibold hover:bg-[#7dd3fc] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[52px]"
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
