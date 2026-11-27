#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec sh ./run-checks.sh tlc "$@"
