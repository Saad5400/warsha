#!/usr/bin/env bash
# Offline gate for the Java bootstrap sources. No browser, no CheerpJ.
#
#   1. Compiles src/bootstrap with --release 17 and -Werror -- the same
#      invocation build-bootstrap.sh ships, so a source that fails here is a
#      source that would fail the build.
#   2. Runs test/BootstrapSelfTest, which exercises the logic that does not need
#      Bridge's natives: entry-point naming, stack-trace filtering, and the ECJ
#      behaviour Build relies on.
#
# What this cannot cover: anything going through Bridge's natives (stdout/stdin
# and phaseDone are unlinkable outside CheerpJ) and CheerpJ's own filesystem
# quirks. Those belong to the browser harness.
set -euo pipefail

cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/warsha-java-validate.$$"
trap 'rm -rf "$OUT"' EXIT
mkdir -p "$OUT/classes"

if [ ! -f ecj.jar ]; then
  echo "ecj.jar missing — run ./fetch-compiler.sh first" >&2
  exit 1
fi

echo "==> javac --release 17 -Werror  (src/bootstrap)"
javac --release 17 -Xlint:all -Werror -cp ecj.jar -d "$OUT/classes" src/bootstrap/*.java

echo "==> javac (test/BootstrapSelfTest)"
javac --release 17 -Xlint:all -cp "ecj.jar:$OUT/classes" -d "$OUT/classes" test/BootstrapSelfTest.java

echo "==> run BootstrapSelfTest"
java -cp "ecj.jar:$OUT/classes" warsha.BootstrapSelfTest

echo
echo "bootstrap validation passed"
