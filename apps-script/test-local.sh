#!/usr/bin/env bash
# Runs the pure-function tests under Node. Usage: ./test-local.sh
set -eu
cd "$(dirname "$0")"
(cat Config.gs Dates.gs Reconcile.gs Digest.gs Tests.gs 2>/dev/null || true; printf '\nprocess.exit(runTests() === 0 ? 0 : 1);\n') | node
