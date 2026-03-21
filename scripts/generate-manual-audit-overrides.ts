import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REVIEW_DIR = join(process.cwd(), 'audit', 'manual-review')
const OUTPUT_FILE = join(process.cwd(), 'src', 'utils', 'manualAuditOverrides.ts')

type ReviewEntry = {
  nctId: string
  briefTitle: string
  siteEligible: boolean | null
  tumorLabels: string[]
  confidence: string
  rationale: string
}

type ReviewFile = {
  reviews: ReviewEntry[]
}

async function main() {
  const files = await Promise.all([1, 2, 3, 4].map(loadReviewFile))
  const reviews = files.flatMap((file) => file.reviews)

  const incomplete = reviews.filter(
    (review) => review.siteEligible === null || !review.confidence || !review.rationale
  )
  if (incomplete.length > 0) {
    throw new Error(`Manual audit overrides cannot be generated; ${incomplete.length} reviews are incomplete`)
  }

  const sorted = [...reviews].sort((a, b) => a.nctId.localeCompare(b.nctId))

  const lines: string[] = []
  lines.push("import type { TumorTypeFilter } from '../types/trial'")
  lines.push('')
  lines.push('export type ManualAuditOverride = {')
  lines.push('  siteEligible: boolean')
  lines.push("  tumorLabels: Array<Exclude<TumorTypeFilter, 'any'>>")
  lines.push('}')
  lines.push('')
  lines.push("export const MANUAL_AUDIT_REVIEWED_ON = '2026-03-21'")
  lines.push('')
  lines.push('export const MANUAL_AUDIT_OVERRIDES: Record<string, ManualAuditOverride> = {')

  for (const review of sorted) {
    const tumorLabels = review.tumorLabels
      .map((label) => `'${label}'`)
      .join(', ')
    lines.push(
      `  '${review.nctId}': { siteEligible: ${review.siteEligible ? 'true' : 'false'}, tumorLabels: [${tumorLabels}] },`
    )
  }

  lines.push('}')
  lines.push('')
  lines.push('export function getManualAuditOverride(nctId: string): ManualAuditOverride | undefined {')
  lines.push('  return MANUAL_AUDIT_OVERRIDES[nctId]')
  lines.push('}')
  lines.push('')

  await writeFile(OUTPUT_FILE, `${lines.join('\n')}\n`)
  console.log(`Wrote ${sorted.length} manual audit overrides to ${OUTPUT_FILE}`)
}

async function loadReviewFile(batch: number): Promise<ReviewFile> {
  const raw = await readFile(join(REVIEW_DIR, `review-batch-${batch}.json`), 'utf8')
  return JSON.parse(raw) as ReviewFile
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
