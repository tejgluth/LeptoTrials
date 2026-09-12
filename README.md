# LeptoTrials

Find and explore clinical trials relevant to leptomeningeal metastasis.

**[Visit LeptoTrials → leptotrials.com](https://leptotrials.com)**

LeptoTrials helps patients and caregivers navigate ClinicalTrials.gov with a search experience focused on leptomeningeal disease. It brings study details, eligibility criteria, locations, and available trial contacts together so users can prepare for a conversation with their care team.

## What you can do

- Search by age, primary tumor type, country or continent, study type, phase, and recruitment status.
- Read trial summaries and eligibility criteria, then open the original registry record.
- Find study contacts and prepare an editable email inquiry.
- Browse without creating an account.

## How search works

The app queries the ClinicalTrials.gov v2 API for both the condition “leptomeningeal metastasis” and the term “leptomeningeal.” These searches run alongside a supplemental list of manually reviewed study IDs. Results are deduplicated by NCT ID, checked against the selected filters, and screened for leptomeningeal relevance.

Age bounds are normalized from registry strings. Relevance screening uses condition, title, summary, and eligibility text, with explicit per-study review overrides maintained in `src/utils/manualAuditOverrides.ts`. Tumor-type matching also uses these reviewed classifications where available. Review records and maintenance scripts live in `audit/` and `scripts/`.

Searches display results after all pages load. A failed request, repeated page token, or page-limit overflow produces an error rather than an apparently complete result set. Each query is limited to 20 pages of 20 studies.

This is a discovery tool, not a clinical eligibility assessment. Registry records and review decisions may become outdated, and text screening cannot capture every enrollment requirement. The default statuses include **active, not recruiting** studies; a result does not mean enrollment is available. Confirm availability and eligibility with the study team and your clinician.

## Architecture

The patient app uses React, TypeScript, Vite, Tailwind CSS, and GSAP. Search requests go directly from the browser to ClinicalTrials.gov. Cloudflare Pages serves the application; Pages Functions and D1 support optional contact analytics.

| Location | Responsibility |
| --- | --- |
| `src/components/` | Patient interface and private analytics dashboard |
| `src/hooks/useTrialSearch.ts` | Search lifecycle, cancellation, and result filtering |
| `src/utils/` | Registry requests, pagination, eligibility rules, and outreach helpers |
| `functions/` | Contact-event ingestion and authenticated analytics API |
| `migrations/` | D1 schema migrations |
| `tests/` | Offline regression tests |
| `scripts/`, `audit/` | Trial review and query-validation workflow |

## Local development

Use Node.js 22.12 or newer (Node 22 is used in CI) and npm. No API key is needed for trial search.

```bash
npm ci
npm run dev
```

The standard Vite server runs the patient experience. To exercise Cloudflare Pages Functions and a local D1 database as well:

```bash
cp .dev.vars.example .dev.vars
npm run d1:migrate:local
npm run dev:cloudflare
```

Open the local URL printed by Wrangler (normally `http://localhost:8788`).

## Contact analytics

The app records two anonymous contact-intent events:

- `email_click` when a patient activates a trial's email link
- `email_copy` only after the browser confirms the address was copied

Each event is stored as an append-only row in the Cloudflare D1 database `leptotrials-analytics`. Stored data is limited to an anonymous event ID, NCT ID, action type, and server timestamp. It does not include patient details, search filters, contact email addresses, or clipboard contents.

To enable the private dashboard:

1. Generate a secret with `openssl rand -hex 32`.
2. Set it with `wrangler pages secret put ANALYTICS_ADMIN_TOKEN --project-name lm-trials`.
3. Apply the production schema with `npm run d1:migrate:remote`.
4. Deploy with `npm run deploy`.
5. Open `/analytics` on the deployed site and enter the token.

The dashboard shows all-time email/copy counts, 7- and 30-day activity, a 30-day chart, and per-trial totals. Raw data can be inspected with `wrangler d1 execute leptotrials-analytics --remote --command="SELECT * FROM contact_events ORDER BY recorded_at_epoch DESC LIMIT 20"`.

## Quality checks

```bash
npm run check
```

This runs offline tests, ESLint, TypeScript checks, and a production build. GitHub Actions runs the same command for pushes and pull requests. Preview a production build with `npm run preview`.

For registry-dependent validation across patient and filter scenarios:

```bash
npm run validate:trials -- --json
```

The validation script compares a local filter matrix and selected live queries, including regression study IDs. It may use cached registry responses and depends on upstream availability. Passing it demonstrates consistency with the maintained rules, not independent clinical validation.

## Deployment

Configure the Cloudflare project and D1 binding in `wrangler.jsonc`, authenticate Wrangler, and apply the appropriate database migrations before deploying with `npm run deploy`. Keep `.dev.vars` local; `.dev.vars.example` documents the configuration shape. Production dashboard credentials belong in Cloudflare secrets, never in frontend environment variables.

## Privacy and maintenance

Patient filters are processed in the browser; status, phase, study type, and country filters are sent to ClinicalTrials.gov as part of registry queries. The application's contact-event database stores only the fields described above. Hosting and upstream services may independently maintain request logs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and review expectations. Trial data is provided by [ClinicalTrials.gov](https://clinicaltrials.gov); LeptoTrials is an independent application.
