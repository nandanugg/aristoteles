#!/bin/sh
set -eu
cd "$(dirname "$0")"
case "${1:-}" in
  ''|--check) exec sh ./run-checks.sh sim ;;
  *) echo "usage: spec.sh [--check]" >&2; exit 2 ;;
esac
