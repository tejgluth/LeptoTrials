# One harness, optional schedulers

## Recurring live-registry maintenance

This section is the operating guide for **new/changed registry trials**, not the
one-shot historical verification jobs below. The examples are opt-in; no recurring
job has been installed or enabled by adding this documentation.

### What actually detects a new trial

The timer runs `maintain` repeatedly. Each cycle fetches every configured broad query
in `config/default.yaml` with the configured statuses (or explicit `--all-statuses`),
follows pagination, deduplicates NCT IDs and stores a full candidate capture. It does
not use only a title/condition query, and it does not trust a result count as proof
that the membership is unchanged: one trial can replace another at the same count.

Every returned record reaches the strict rules. Records not resolved there use a
cache key including NCT/substantive content, provider/model settings, prompts,
schema, rules and implementation. New or materially changed records therefore reach
the model; unchanged successful model results are reused. Failed generations can be
retried on a later cycle; valid ambiguous outputs remain queued for expert review.
The pipeline is not triggered only by an increase in the number of results.

Disappearing candidates remain visible in earlier captures; this implementation does
not generate a separate added/removed-ID report or automatically delete published
trials. Status-filter changes can also remove a record from the next search. Compare
the exact capture IDs and have an expert review any proposed production withdrawal.
An incomplete/failed API search exits nonzero and produces a failure artifact; it
must not be treated as an empty successful poll or proof that trials were removed.

### 1. Prepare and run locally

Follow the virtual-environment setup in the harness README, then from `agent-harness/`:

```bash
mkdir -p output/maintenance

# Retrieval/routing inspection only: no model calls, no model cache populated
.venv/bin/leptotrials-harness --config config/ollama.yaml \
  --output-root output/maintenance maintain --dry-run --workers 1

# Actual cycle using already installed Ollama/Gemma; no paid model API calls
.venv/bin/leptotrials-harness --config config/ollama.yaml \
  --output-root output/maintenance maintain --workers 1
```

Ollama must be running and its configured model must already be installed. Live
registry discovery needs internet even with a local model. For Gemini, omit the
`--config config/ollama.yaml` option and configure `GEMINI_API_KEY` locally; for OpenAI
use `--config config/openai.yaml` and its local key. These alternatives can incur API
charges. Never put keys in a crontab, plist, command argument or committed file.
The command reads `.env` from its working directory, so the scheduled working
directory must be the harness folder. Environment provider/model overrides still apply.

Use the **same persistent output root** each time. A different root loses cache reuse.
The first real poll may need to classify thousands of existing candidates and take
hours or days with a local model. Establish and inspect that baseline before expecting
quick incremental polls. Do not use `--no-cache` in routine scheduled maintenance.
Changing code/model/prompt/schema can intentionally invalidate existing cache entries.
The timer and a fast provider do not remove the expert-review requirement.

### 2. macOS: opt-in LaunchAgent every fifteen minutes

On this Mac, `launchd` is the native alternative to cron. Save the template below as
`~/Library/LaunchAgents/com.leptotrials.maintenance.plist`, replacing **every**
`/ABSOLUTE/PATH/Leptomeningeal/agent-harness` with your actual harness directory.
Paths must be absolute: plist arguments do not expand `~`, `$HOME` or shell commands.
Create the `output/maintenance` directory first so log destinations exist.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.leptotrials.maintenance</string>
  <key>WorkingDirectory</key>
  <string>/ABSOLUTE/PATH/Leptomeningeal/agent-harness</string>
  <key>ProgramArguments</key>
  <array>
    <string>/ABSOLUTE/PATH/Leptomeningeal/agent-harness/.venv/bin/python</string>
    <string>-m</string><string>leptotrials_harness</string>
    <string>--config</string><string>config/ollama.yaml</string>
    <string>--output-root</string><string>output/maintenance</string>
    <string>maintain</string><string>--workers</string><string>1</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key>
  <string>/ABSOLUTE/PATH/Leptomeningeal/agent-harness/output/maintenance/scheduler.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/ABSOLUTE/PATH/Leptomeningeal/agent-harness/output/maintenance/scheduler.stderr.log</string>
</dict>
</plist>
```

Only after reviewing provider/cost settings, opt in with:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.leptotrials.maintenance.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.leptotrials.maintenance.plist"
# Optional first cycle now, rather than waiting for the interval
launchctl kickstart "gui/$(id -u)/com.leptotrials.maintenance"

# Inspect state/last exit code
launchctl print "gui/$(id -u)/com.leptotrials.maintenance"

# Disable the recurring job; saved inputs/decisions/cache are not deleted
launchctl bootout "gui/$(id -u)/com.leptotrials.maintenance"
```

The same LaunchAgent does not start a second instance if its interval fires while
it is still running; that tick is missed. This is not a backlog of queued polls.
Do not launch an additional manual process against the same output root; use this
job's `kickstart` instead. A `StartInterval` firing during sleep is also missed.
Keep the user logged in, Mac awake/online and Ollama available. There is no `KeepAlive`
or hidden cloud fallback. Stopping a running job can leave an interrupted run;
preserve its artifacts and inspect/recover them before any approved export.

### 3. Linux: cron plus a non-overlap lock

On a Linux host with `/usr/bin/flock`, use `crontab -e` to add this **single line**
after replacing the absolute paths and preparing the virtual environment/output directory:

```cron
*/15 * * * * cd /ABSOLUTE/PATH/Leptomeningeal/agent-harness && /usr/bin/flock -n /ABSOLUTE/PATH/Leptomeningeal/agent-harness/output/maintenance/poll.lock /ABSOLUTE/PATH/Leptomeningeal/agent-harness/.venv/bin/python -m leptotrials_harness --config config/ollama.yaml --output-root output/maintenance maintain --workers 1 >> /ABSOLUTE/PATH/Leptomeningeal/agent-harness/output/maintenance/cron.log 2>&1
```

Quote paths containing spaces. `flock -n` prevents overlapping cron instances;
a busy tick does not launch another model batch. Manual invocations must use the
same lock or wait for the scheduled process to finish. macOS does not ship this
Linux `flock` command; use the LaunchAgent above there. Cron has a minimal environment:
use absolute executables, the correct working directory and local `.env`, not an
interactive shell's activation or exported secrets. Remove the line with `crontab -e`
to stop future polls; it does not cancel an already running process or delete results.

### 4. Inspect decisions and promote a newly found trial

```bash
# Includes active/interrupted runs; choose a new output filename each time
.venv/bin/leptotrials-harness execution-report output/maintenance \
  --output output/maintenance-inspection-YYYYMMDDTHHMMSS.json

# Replace RUN with the real run ID printed by a successful cycle
.venv/bin/leptotrials-harness review output/maintenance/runs/RUN \
  --output output/review-RUN.md

# Expert creates source-checked, revision-bound JSON adjudications; never fabricated
.venv/bin/leptotrials-harness --output-root output/maintenance adjudicate \
  output/maintenance/runs/RUN expert-decisions.json
.venv/bin/leptotrials-harness export-approved \
  --run output/maintenance/runs/RUN --adjudications expert-decisions.json \
  --format typescript --output ../src/generated/agentClassifications.ts
```

Per-cycle `manifest.json` records candidate count, Stage-1/Stage-2 counts, model calls,
cache hits, failures and timing. Inputs, exact model payloads, raw JSON, decisions and
`review.md` are saved under `output/maintenance/runs/RUN/`; full candidate captures
are under `output/maintenance/candidates/`. Scheduler stdout/stderr are operational
logs, not replacements for immutable run artifacts. Retain provenance; monitor disk
space and arrange operational log rotation when enabling frequent polls.

After expert approval, a maintainer reviews the generated diff/provenance, integrates
the exported classifications with the application's existing override/filter code,
tests and explicitly releases it. **The generated TypeScript file is not automatically
imported by the app.** The scheduled job does not approve, commit, publish or deploy.
The patient site continues using its existing registry search and audited overrides.
An unambiguous new study may already appear via that search; this background harness
is a separate review/maintenance pathway, not a new live request dependency.

### Latency: what “real time” means here

This implementation polls; it is not an event subscription. Detection latency includes
registry publication/availability, waiting for a successful poll, API pagination and
classification/backlog. Website incorporation additionally needs expert review and a
maintainer release. Fifteen minutes is an example cadence, **not** an SLA or a claim
that records publish that frequently. No less-than-one-minute benchmark is asserted.
Long baseline runs, sleep, network outages and model failures delay discovery. Choose
a cadence based on measured run duration, API load, local resources and provider cost.
For continuous operation use an always-on runner with persistent storage/secrets;
it runs the same harness, not a different classification policy.

## Optional scheduled ChatGPT invocation

Manual researchers, scheduled ChatGPT tasks and operating-system jobs all invoke the
same CLI. The scheduler supplies time and execution context; classification policy,
providers, versioning, caching and review remain in the harness.

From the repository root:

```bash
cd agent-harness
.venv/bin/leptotrials-harness --config config/openai.yaml maintain
```

Switch to the default Gemini settings by omitting `--config config/openai.yaml`
after configuring `GEMINI_API_KEY`. First test with `--dry-run`.

For local models, replace the provider argument with `--config config/ollama.yaml`
and use `--workers 1`. The same scheduled task then calls local Ollama rather than
a paid model endpoint. Keep Ollama and the computer running.

Suggested scheduled-task prompt, after choosing the cadence in ChatGPT:

> In the local LeptoTrials project, read agent-harness/README.md. Run
> `cd agent-harness && .venv/bin/leptotrials-harness --config config/openai.yaml maintain`.
> Use the existing local .env without displaying credentials. Do not replace the
> harness with ad hoc classifications. Report run ID, candidate count, Stage 1 count,
> model calls, cache hits, expert-review count, failures and review.md path. If discovery
> fails, report the incomplete run. Preserve the raw decisions and expert queue. Do
> not approve decisions on behalf of an expert, mutate patient-facing overrides,
> commit or deploy. Serialize runs against the same output directory. If requested
> to report current website counts or export a live spreadsheet, follow the production
> membership rules in AGENTS.md rather than substituting this candidate universe.

Local-file tasks need an execution environment that can access this project, Python,
network and local credentials. In supported desktop scheduled tasks, keep the computer
and app available when local execution is required. A cloud task needs its own checkout,
dependencies, secrets and persistent output/cache; it cannot assume access to this Mac.
See [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations).

## Bounded offline verification on this Mac

An optional one-shot macOS LaunchAgent can run independently of this conversation:

```bash
cd agent-harness
.venv/bin/python scripts/offline_verify.py schedule --hours 8
# Or request an explicit, timezone-qualified stop time:
.venv/bin/python scripts/offline_verify.py schedule --until 2026-10-18T11:00:00-07:00

# Explicitly selected frozen development rounds, inference only (not the legacy sweep)
.venv/bin/python scripts/offline_verify.py schedule --hours 3 \
  --manifests output/aact-reconciled-20261018-v1/development/manifests \
  --classification-only

# Also publish execution integrity checks and any explicit production-baseline comparison
# (Use a new output collection; do not launch a duplicate of an active job.)
.venv/bin/python scripts/offline_verify.py schedule --hours 10 \
  --manifests output/review-cycle-20261018-v1/manifests \
  --classification-only --post-inspection
```

This is **verification, not production maintenance**. It snapshots the harness,
prompts, schemas, tests and frozen registry inputs, excluding `.env` and private
outputs. No registry retrieval, model download, dependency installation or paid
provider call is part of the job. All model classification uses installed local
`gemma4:latest` through loopback Ollama, one worker at a time. Installed dependencies,
the local Ollama server/model and the frozen archive must already be available.

The job runs Python tests/lint/schema checks, an offline wheel build, existing app
tests/lint/build, ten-round dry-run checks, a synthetic smoke batch and the frozen
ten-round local-model classification. It stops early if finished and has an absolute
deadline (up to ten hours via `--hours`, or an explicit `--until` within 24 hours).
Shutdown time is reserved before the deadline to interrupt/reap the active process.
It records per-phase failures and continues independent checks. Completed decisions
are saved individually; a deadline interruption is not reported as a completed round.

Results live under `output/offline-jobs/<timestamp>/`:

- `job.json`: deadline, local paths and LaunchAgent label.
- `snapshot-hashes.json`: exact frozen file checksums; no credentials.
- `status.json`: heartbeat, active phase, progress and failures.
- `summary.json`: final result, written when finished/stopped.
- `*.log`: each check's output.
- `harness-output/runs/`: raw decisions, evidence, provenance and round reports.
- `harness-output/cache/`: reusable successful classifications.

With `--post-inspection`, a final **offline, no-model-call** phase also writes
`execution-inspection.json`/`.md` and `post-inspection-summary.json`. If a supplied
round has role `current_api_compatibility_development` and a frozen public baseline,
it writes `production-comparison-ROUND.json` too. Missing/pending records, model
failures, current-policy warnings and accepted-membership differences fail this
automated check. It never forces equality, creates expert approvals or deploys data.
The exact live baseline and current candidate inputs must have been captured before
going offline; neither is refreshed by a frozen verification job.

Keep the Mac plugged in with its lid open and Ollama running. `caffeinate` prevents
idle sleep during the bounded run; it cannot override shutdown, logout, a closed
lid or battery exhaustion. Internet loss and closing the chat/terminal do not stop
the LaunchAgent. There is no repeating calendar schedule or `KeepAlive`; a later
login cannot restart expired/completed work. To stop a particular job, use its exact
label from `job.json` with `launchctl kill SIGTERM gui/$(id -u)/<label>`. This requests
graceful cancellation and preserves already-written results. Do not remove output
while a job is active. Old one-shot LaunchAgents can be unloaded after completion.

These are retrospective unchanged-record subsets, not complete historical snapshots.
That statement describes the default legacy verification sweep. When explicit
`--manifests` are supplied, the job copies and verifies those exact frozen inputs
instead. `--classification-only` requires that explicit selection and skips the
legacy smoke/tests/sweep; it does not expand a small sample into full-population
classification. See the [AACT development design](historical-aact.md#reconciled-collection-and-bounded-development-execution).
Model output is not independent expert ground truth: the job cannot establish
clinical accuracy, false-positive/negative rates or the manuscript's historical claims.

Periodic expert audit can export all
recent decisions with `create-audit-batch --since YYYY-MM-DD --output audit.csv`.
CSV is a review aid; ingest adjudications through the typed JSON contract.
