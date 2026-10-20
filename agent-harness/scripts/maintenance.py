"""Entry point for scheduled runs (same pipeline as running it by hand)."""

import sys

from leptotrials_harness.cli import main

sys.argv.insert(1, "maintain")
main()
