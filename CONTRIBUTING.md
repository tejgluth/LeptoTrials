# Contributing

Use Node.js 22.12 or newer and install the locked dependencies with `npm ci`.
Run `npm run dev` for the patient app.

Keep changes focused. Prefer small functions, explicit types at API boundaries, and the existing React and TypeScript conventions. Avoid adding dependencies or abstractions for behavior that can be expressed clearly with the platform APIs.

Before submitting a change:

1. Run `npm run check`.
2. Add regression coverage when changing search, eligibility, pagination, or request handling. Tests should describe observable behavior and include failure cases.
3. Run `npm run validate:trials -- --json` for query or classification changes. Record any upstream failures or stale-data limitations.
4. For interface changes, check desktop and mobile layouts, keyboard navigation, loading and error states, and reduced-motion behavior.
5. Explain the problem, the resulting behavior, and the checks performed in the pull request.

Keep clinical classification changes separate from formatting or structural refactors. Preserve the evidence behind manual review overrides and inspect generated diffs before committing them. Never claim that a matching study establishes patient eligibility.

Do not commit credentials, patient information, local database files, or private dashboard tokens. Report suspected security issues privately to the repository owner rather than posting secrets or patient information in a public issue.
