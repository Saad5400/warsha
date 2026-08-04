#!/usr/bin/env bash
# Build the C# engine bundle (dotnet _framework + the module worker) and stage it
# where the app serves it. Peer of runtimes/java/fetch-compiler.sh: idempotent,
# and safe to run on every `npm run assets`.
#
#   ./build.sh [dest]        default: app/public/warsha-dotnet
#
# Requires the .NET 9 SDK + `wasm-tools` workload (see runtimes/csharp/INTEGRATION.md).
# If the SDK is absent but a previously-built bundle is already staged, the build
# is skipped with a note rather than failing — so a machine without the SDK can
# still run the app from a committed/pre-staged bundle. A content stamp skips the
# ~5 s republish when nothing under src/ or the C# project changed.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dest="${1:-$here/../../app/public/warsha-dotnet}"
proj="$here/harness/Warsha.CSharp.csproj"
worker="$here/src/dotnet.worker.js"

export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

# Content stamp over the inputs that affect the bundle.
stamp_now="$(cat "$worker" "$here/harness/Program.cs" "$here/harness/Warsha.CSharp.csproj" 2>/dev/null | sha256sum | cut -d' ' -f1)"
stamp_file="$dest/.engine-stamp"

if [ -f "$dest/_framework/dotnet.js" ] && [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$stamp_now" ]; then
  echo "csharp engine: up to date (stamp match), skipping."
  exit 0
fi

if ! command -v dotnet >/dev/null 2>&1; then
  if [ -f "$dest/_framework/dotnet.js" ]; then
    echo "csharp engine: .NET SDK not found, but a staged bundle exists — using it. Refreshing worker only."
    cp "$worker" "$dest/dotnet.worker.js"
    exit 0
  fi
  echo "ERROR: .NET SDK not found and no staged bundle at $dest." >&2
  echo "Install: https://dot.net + 'dotnet workload install wasm-tools'. See runtimes/csharp/INTEGRATION.md." >&2
  exit 1
fi

echo "csharp engine: publishing (this takes a few seconds)…"
dotnet publish "$proj" -c Release -o "$here/harness/publish" >/dev/null

mkdir -p "$dest"
rm -rf "$dest/_framework"
cp -r "$here/harness/publish/wwwroot/_framework" "$dest/_framework"
# The canonical worker is the src copy, not the harness's test-page copy.
cp "$worker" "$dest/dotnet.worker.js"
printf '%s' "$stamp_now" > "$stamp_file"

echo "csharp engine: staged to $dest ($(du -sh "$dest/_framework" | cut -f1) uncompressed)."
