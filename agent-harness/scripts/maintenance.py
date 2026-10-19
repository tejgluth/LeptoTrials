"""One entry point for any scheduler; uses exactly the same pipeline as manual execution."""

import sys

from leptotrials_harness.cli import main

sys.argv.insert(1, "maintain")
main()
