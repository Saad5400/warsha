#!/usr/bin/env bash
# Fetch the in-browser Java compiler. NEVER committed (*.jar is gitignored
# repo-wide) -- this script is the provenance record, and it is what CI runs.
#
# ECJ = Eclipse Compiler for Java, the batch compiler from Eclipse JDT.
#   licence : EPL-2.0 (redistributable; see about.html inside the jar)
#   origin  : Maven Central, org.eclipse.jdt:ecj
#   version : 3.46.0 -- PINNED, and not only for reproducibility. On a modular
#             runtime ECJ cannot find the platform classes by itself under
#             CheerpJ, and warsha.Platform works around that by seeding
#             JRTUtil.JRT_FILE_SYSTEMS, a private static field that exists in
#             the 3.4x series but NOT in, say, 3.33. Moving this pin means
#             re-reading Platform.java and re-running tools/qa's java suite.
#   size    : 3.4 MB, vs 18.3 MB for a JDK tools.jar
#
# Deliberately NOT used: javac. CheerpJ ships a JRE, not a JDK -- there is no
# jdk.compiler module in the image at all (com.sun.tools.javac.Main is absent
# and ToolProvider.getSystemJavaCompiler() returns null), so an in-browser
# javac is not an option on any runtime version.
#
# Usage:  ./fetch-compiler.sh [destination-dir]
#
#   no argument   -> runtimes/java/ecj.jar          (the harness web root)
#   app/public    -> app/public/ecj.jar             (what the app build wants)
#
# The jar must end up at the DEPLOYED SITE ROOT, because CheerpJ's /app/ mount
# maps to the web server root, not to the page's directory. See INTEGRATION.md.
set -euo pipefail

VERSION="3.46.0"
# Verified digest of the artifact this runtime was tested against.
# Maven Central also publishes ecj-3.46.0.jar.sha1 = e962128cf16c864b61633b5a1c75709b0ba2f017
SHA256="d0d43f8e2d7003e5efed612e2cbb5f01870043397d8f1bbe536fd9128f4fcbf7"
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
