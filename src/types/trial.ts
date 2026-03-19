export type OverallStatus =
  | 'RECRUITING'
  | 'NOT_YET_RECRUITING'
  | 'ACTIVE_NOT_RECRUITING'
  | 'COMPLETED'
  | 'TERMINATED'
  | 'WITHDRAWN'
  | 'SUSPENDED'
  | 'UNKNOWN'
  | 'AVAILABLE'
  | 'NO_LONGER_AVAILABLE'
  | 'TEMPORARILY_NOT_AVAILABLE'
  | 'APPROVED_FOR_MARKETING'
  | 'WITHHELD'

export type StudyType = 'INTERVENTIONAL' | 'OBSERVATIONAL' | 'EXPANDED_ACCESS'

export type Phase =
  | 'PHASE1'
  | 'PHASE2'
  | 'PHASE3'
  | 'PHASE4'
  | 'EARLY_PHASE1'
  | 'NA'

export interface DateStruct {
  date: string
  type?: 'ACTUAL' | 'ESTIMATED'
}

export interface OrgStudyIdInfo {
  id?: string
  type?: string
  link?: string
}

export interface Organization {
  fullName: string
  class: string
}

export interface IdentificationModule {
  nctId: string
  orgStudyIdInfo?: OrgStudyIdInfo
  briefTitle: string
  officialTitle?: string
  acronym?: string
  organization: Organization
}

export interface ExpandedAccessInfo {
  hasExpandedAccess: boolean
  nctId?: string
}

export interface StatusModule {
  statusVerifiedDate?: string
  overallStatus: OverallStatus
  lastKnownStatus?: OverallStatus
  expandedAccessInfo?: ExpandedAccessInfo
  startDateStruct?: DateStruct
  primaryCompletionDateStruct?: DateStruct
  completionDateStruct?: DateStruct
  studyFirstSubmitDate?: string
  studyFirstSubmitQcDate?: string
  studyFirstPostDateStruct?: DateStruct
  resultsFirstSubmitDate?: string
  lastUpdateSubmitDate?: string
  lastUpdatePostDateStruct?: DateStruct
}

export interface ResponsibleParty {
  type: string
  investigatorAffiliation?: string
  investigatorFullName?: string
  investigatorTitle?: string
}

export interface Sponsor {
  name: string
  class: string
}

export interface SponsorCollaboratorsModule {
  responsibleParty: ResponsibleParty
  leadSponsor: Sponsor
  collaborators?: Sponsor[]
}

export interface DescriptionModule {
  briefSummary?: string
  detailedDescription?: string
}

export interface ConditionsModule {
  conditions: string[]
  keywords?: string[]
}

export interface EnrollmentInfo {
  count: number
  type: 'ACTUAL' | 'ESTIMATED'
}

export interface DesignModule {
  studyType: StudyType
  phases?: Phase[]
  designInfo?: {
    allocation?: string
    interventionModel?: string
    primaryPurpose?: string
    maskingInfo?: {
      masking?: string
    }
  }
  enrollmentInfo?: EnrollmentInfo
}

export interface EligibilityModule {
  eligibilityCriteria?: string
  healthyVolunteers?: boolean
  sex?: string
  minimumAge?: string
  maximumAge?: string
  stdAges?: string[]
}

export interface Contact {
  name?: string
  role?: string
  phone?: string
  phoneExt?: string
  email?: string
}

export interface GeoPoint {
  lat: number
  lon: number
}

export interface Location {
  facility?: string
  status?: OverallStatus
  city?: string
  state?: string
  zip?: string
  country?: string
  geoPoint?: GeoPoint
  contacts?: Contact[]
}

export interface ContactsLocationsModule {
  centralContacts?: Contact[]
  overallOfficials?: Contact[]
  locations?: Location[]
}

export interface ProtocolSection {
  identificationModule: IdentificationModule
  statusModule: StatusModule
  sponsorCollaboratorsModule: SponsorCollaboratorsModule
  descriptionModule?: DescriptionModule
  conditionsModule?: ConditionsModule
  designModule: DesignModule
  eligibilityModule: EligibilityModule
  contactsLocationsModule?: ContactsLocationsModule
}

export interface Study {
  protocolSection: ProtocolSection
  derivedSection?: {
    conditionBrowseModule?: {
      meshes?: Array<{ id: string; term: string }>
    }
  }
  hasResults?: boolean
}

export interface ApiResponse {
  studies: Study[]
  nextPageToken?: string
  totalCount?: number
}

export type PhaseFilter = 'PHASE1' | 'PHASE2' | 'PHASE3'
export type StudyTypeFilter = 'any' | 'INTERVENTIONAL' | 'OBSERVATIONAL'
export type TumorTypeFilter = 'any' | 'LUNG' | 'BREAST' | 'MELANOMA' | 'GBM' | 'OTHER_SOLID'

export interface SearchParams {
  age: number | null
  studyType: StudyTypeFilter
  phases: PhaseFilter[]
  country: string | null
  continent: string | null
  statuses: OverallStatus[]
  tumorType: TumorTypeFilter
}

export type FilterResult =
  | { include: true }
  | { include: false; reason: string }
