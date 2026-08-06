#!/usr/bin/env bash
# Build warsha-boot.jar -- the Warsha Java bootstrap (Bridge, Build, Launcher,
# Platform, Server, Traces), compiled ahead of time and deployed as a static
# asset next to ecj.jar.
#
# WHY PREBUILT, and why a JAR specifically
# ----------------------------------------
# These classes used to be compiled in the browser on a student's first visit
# and cached in IndexedDB behind a source hash. On CheerpJ's Java 17 runtime
# that cannot work: ECJ can only see the platform classes after
# warsha.Platform.prepare() has run inside the same JVM invocation (see
# Platform.java), and every cheerpjRunMain gets a FRESH classloader -- so there
# was no invocation left in which our own code could prepare anything. The
# bootstrap has to arrive already compiled.
#
# A jar, not a directory of .class files: CheerpJ's /app/ mount is the web
# server over HTTP, and HTTP has no directory listing, so a directory classpath
# entry resolves nothing (measured: ClassNotFoundException for a class that was
# definitely being served). Jars work, because CheerpJ reads them with Range
# requests -- exactly how it already reads ecj.jar.
#
# Bytecode target is 17, matching CheerpJ's runtime. Compiling with a JDK newer
# than 17 is fine; --release pins the target regardless.
#
# Usage:  ./build-bootstrap.sh [destination-dir]
#
#   no argument   -> runtimes/java/warsha-boot.jar     (the harness web root)
#   app/public    -> app/public/warsha-boot.jar        (what the app build wants)
#
# Like ecj.jar, the output must land at the DEPLOYED SITE ROOT, because /app/
# maps to the web server root and not to the page's directory.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dest_dir="${1:-$here}"
mkdir -p "$dest_dir"
DEST="$(cd "$dest_dir" && pwd)/warsha-boot.jar"

JAVAC="${JAVAC:-${JAVA_HOME:+$JAVA_HOME/bin/}javac}"
JAR="${JAR:-${JAVA_HOME:+$JAVA_HOME/bin/}jar}"

if ! command -v "$JAVAC" >/dev/null 2>&1; then
  echo "javac not found. Install a JDK 17 or newer, or set JAVA_HOME." >&2
  echo "  Debian/Ubuntu: apt-get install -y openjdk-17-jdk-headless" >&2
  exit 1
fi

# Build.java imports ECJ's BatchCompiler, so javac needs ecj.jar on -cp. Look in
# the DESTINATION first: fetch-compiler.sh takes the same argument this script
# does and puts the jar there, so on a clean checkout (CI) that is the only copy
# -- runtimes/java/ecj.jar exists only on a machine that has also run the
# harness. Getting this backwards is what broke the first Java 17 deploy.
ECJ=""
for candidate in "$(dirname "$DEST")/ecj.jar" "$here/ecj.jar"; do
  if [ -f "$candidate" ]; then ECJ="$candidate"; break; fi
done
if [ -z "$ECJ" ]; then
  echo "ecj.jar missing -- run ./fetch-compiler.sh ${1:-} first (Build imports ECJ's BatchCompiler)" >&2
  exit 1
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

echo "==> javac --release 17 -Werror  (src/bootstrap, -cp $ECJ)"
"$JAVAC" --release 17 -Xlint:all -Werror \
  -cp "$ECJ" -d "$OUT" "$here"/src/bootstrap/*.java

echo "==> jar"
"$JAR" --create --file "$DEST" -C "$OUT" .

echo "wrote : $DEST ($(stat -c%s "$DEST") bytes)"
echo
echo "Deployment: static asset at the SITE ROOT, so CheerpJ reads it as"
echo "/app/warsha-boot.jar. Apache-2.0, same as the rest of Warsha -- unlike"
echo "ecj.jar this is our own code, so it carries no third-party obligations."
