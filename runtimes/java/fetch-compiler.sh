#!/usr/bin/env bash
# Fetch the in-browser Java compiler. NEVER committed (*.jar is gitignored
# repo-wide) -- this script is the provenance record, and it is what CI runs.
#
# ECJ = Eclipse Compiler for Java, the batch compiler from Eclipse JDT.
#   licence : EPL-2.0 (redistributable; see about.html inside the jar)
#   origin  : Maven Central, org.eclipse.jdt:ecj
#   version : 3.26.0 -- the LAST release whose own class files are Java 8
#             (major 52). 3.27.0+ are Java 11 (major 55) and cannot run on
#             CheerpJ's Java 8 runtime.
#   size    : 3.1 MB, vs 18.3 MB for a JDK tools.jar
#
# Deliberately NOT used: a JDK tools.jar. Oracle JDK builds are not
# redistributable (the one the spike started with had
# "Created-By: 1.8.0_131 (Oracle Corporation)" in its manifest). An
# OpenJDK/Temurin 8 tools.jar would be legally fine under GPLv2+Classpath
# Exception, but it is 6x larger and drags GPL obligations along.
#
# Usage:  ./fetch-compiler.sh [destination-dir]
#
#   no argument   -> runtimes/java/ecj.jar          (the harness web root)
#   app/public    -> app/public/ecj.jar             (what the app build wants)
#
# The jar must end up at the DEPLOYED SITE ROOT, because CheerpJ's /app/ mount
# maps to the web server root, not to the page's directory. See INTEGRATION.md.
set -euo pipefail

VERSION="3.26.0"
# Verified digest of the artifact this runtime was tested against.
# Maven Central also publishes ecj-3.26.0.jar.sha1 = 4837be609a3368a0f7e7cf0dc1bdbc7fe94993de
SHA256="ac0ba5876eaf7ebb47749a0d1be179c51f194b9dd0b875d1c09e1b530f5a2db5"
URL="https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/${VERSION}/ecj-${VERSION}.jar"

here="$(cd "$(dirname "$0")" && pwd)"
dest_dir="${1:-$here}"
mkdir -p "$dest_dir"
DEST="$(cd "$dest_dir" && pwd)/ecj.jar"

if [ -f "$DEST" ] && [ "$(sha256sum "$DEST" | cut -d' ' -f1)" = "$SHA256" ]; then
  echo "ecj.jar already present and verified: $DEST"
  exit 0
fi

echo "fetching ECJ ${VERSION} (EPL-2.0) from Maven Central"
curl -fsSL --max-time 300 "$URL" -o "$DEST"

got="$(sha256sum "$DEST" | cut -d' ' -f1)"
if [ "$got" != "$SHA256" ]; then
  echo "CHECKSUM MISMATCH" >&2
  echo "  expected $SHA256" >&2
  echo "  got      $got" >&2
  rm -f "$DEST"
  exit 1
fi
echo "sha256 : $got (verified)"
echo "wrote  : $DEST ($(stat -c%s "$DEST") bytes)"
echo
echo "Deployment: this jar is fetched at BUILD time and deployed as a static"
echo "asset at the SITE ROOT, so CheerpJ can read it as /app/ecj.jar."
echo "EPL-2.0 obligations: keep the licence notice, state that the file is"
echo "unmodified ECJ, and link to ecj-${VERSION}-sources.jar at the same"
echo "Maven coordinates. See docs/legal/THIRD-PARTY.md."
