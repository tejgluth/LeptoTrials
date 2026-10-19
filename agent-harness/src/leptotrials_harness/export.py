"""Review-only export compatible with ManualAuditOverride; no deployment or source mutation."""

import json
import os
from pathlib import Path

from .audit import check_adjudication, load_adjudications, load_decisions
from .logging_utils import digest, now, write_json
from .models import UNRESOLVED


def application_root(output: Path, explicit: Path | None = None) -> Path:
    """Locate the real app, including when the harness is installed from a wheel."""
    if explicit is not None:
        root = explicit.resolve()
        if not (root / "src/utils/manualAuditOverrides.ts").is_file():
            raise ValueError("--app-root must contain src/utils/manualAuditOverrides.ts")
        return root
    for parent in (*output.resolve().parents, Path.cwd(), *Path.cwd().parents):
        if (parent / "src/utils/manualAuditOverrides.ts").is_file():
            return parent
    raise ValueError("Cannot locate the application override type; provide --app-root")


def export_approved(
    run_dir: Path, adjudications: Path, output: Path, fmt: str, app_root: Path | None = None
) -> dict:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    if (
        manifest["dry_run"]
        or manifest["state"] not in ("completed", "failed")
        or manifest.get("error")
    ):
        raise ValueError("Only a fully processed, non-dry-run classification run can be exported")
    if fmt not in ("json", "typescript"):
        raise ValueError("Unsupported export format")
    records = {r["nct_id"]: r for r in load_decisions(run_dir)}
    overrides, provenance = {}, []
    for expert in load_adjudications(adjudications):
        if expert.run_id != manifest["run_id"]:
            continue
        record = records[expert.nct_id]
        check_adjudication(record, expert)
        if expert.disposition == "reject" or expert.expert_classification in UNRESOLVED:
            continue
        overrides[expert.nct_id] = {
            "siteEligible": expert.is_lm_inclusive,
            "tumorLabels": expert.tumor_labels,
        }
        provenance.append(
            {
                "nct_id": expert.nct_id,
                "model_decision": record["result"],
                "model_outcome": record["status"],
                "model_error": record.get("error"),
                "decision_hash": record["decision_hash"],
                "expert_decision": expert.model_dump(mode="json", exclude={"notes"}),
                "final_decision": expert.expert_classification.value,
                "input_hash": record["input_hash"],
            }
        )
    if not overrides:
        raise ValueError("No source-checked, resolved expert-approved classifications to export")
    # Existing files must be merged deliberately by a maintainer, never replaced here.
    artifact = {
        "kind": "reviewed_candidate_export_not_deployed",
        "created_at": now(),
        "run_id": manifest["run_id"],
        "count": len(overrides),
        "overrides": dict(sorted(overrides.items())),
        "provenance": provenance,
    }
    if fmt == "json":
        write_json(output, artifact)
    else:
        root = application_root(output, app_root)
        if output.exists() or output.with_suffix(".provenance.json").exists():
            raise FileExistsError("Choose unused TypeScript and provenance paths")
        module = os.path.relpath(root / "src/utils/manualAuditOverrides", output.resolve().parent)
        module = module if module.startswith(".") else "./" + module
        lines = [
            "// GENERATED REVIEW CANDIDATE. Not automatically consumed or deployed.",
            f"// Run {manifest['run_id']}; artifact hash {digest(artifact)}",
            f"import type {{ ManualAuditOverride }} from {json.dumps(module)}",
            "",
            "export const AGENT_CLASSIFICATIONS: Record<string, ManualAuditOverride> = "
            + json.dumps(artifact["overrides"], indent=2)
            + "\n",
        ]
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x") as file:
            file.write("\n".join(lines))
        write_json(output.with_suffix(".provenance.json"), artifact)
    return artifact
