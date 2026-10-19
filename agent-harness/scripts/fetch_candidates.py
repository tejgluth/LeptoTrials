import sys

from leptotrials_harness.cli import main

sys.argv.insert(1, "fetch-candidates")
main()
