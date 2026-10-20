"""Show how one tricky trial gets normalized and routed, without calling a model."""

from pathlib import Path

from leptotrials_harness.clinicaltrials_api import RegistryClient
from leptotrials_harness.config import load_config
from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.trial_normalizer import normalize

config = load_config()
registry = RegistryClient(config.registry)
pipeline = Pipeline(config, Path("output"), dry_run=True)
try:
    print(pipeline.classify(normalize(registry.study("NCT06440954"))))
    print(pipeline.finish(source={"nct_id": "NCT06440954", "example": True}))
finally:
    registry.close()
    pipeline.close()
