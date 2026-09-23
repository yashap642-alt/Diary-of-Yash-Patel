#!/usr/bin/env bash
# ============================================================================
# Reel — set up the Chrome rig the browser tests need.
#
#   bash tools/rig.sh            # installs into ${REEL_RIG:-/tmp/reel-rig}
#   REEL_RIG=~/reel-rig bash tools/rig.sh
#
# It installs puppeteer + jsdom, downloads a Chrome for Testing build, and on a
# bare Debian-ish container also fetches the X/NSS libraries Chrome links
# against (no root needed). On macOS or a normal desktop the library step is
# skipped — the system Chrome works.
# ============================================================================
set -e
RIG="${REEL_RIG:-/tmp/reel-rig}"
CHROME_DIR="$RIG/pchrome"
LIBS="$RIG/libs/root/usr/lib/x86_64-linux-gnu"
mkdir -p "$RIG"

echo "— rig at $RIG"
cd "$RIG"
if [ ! -d node_modules/puppeteer ] || [ ! -d node_modules/jsdom ]; then
  echo "— installing puppeteer + jsdom"
  npm install puppeteer jsdom --silent --no-fund --no-audit
fi

CHROME=$(ls -d "$CHROME_DIR"/chrome/*/chrome-linux64/chrome 2>/dev/null | head -1 || true)
if [ -z "$CHROME" ]; then
  echo "— downloading Chrome for Testing"
  PUPPETEER_CACHE_DIR="$CHROME_DIR" npx puppeteer browsers install chrome
  CHROME=$(ls -d "$CHROME_DIR"/chrome/*/chrome-linux64/chrome 2>/dev/null | head -1)
fi

if [ "$(uname)" = "Linux" ] && ! LD_LIBRARY_PATH="$LIBS" ldd "$CHROME" 2>/dev/null | grep -q "not found"; then
  :
elif [ "$(uname)" = "Linux" ]; then
  echo "— fetching the X/NSS libraries Chrome needs"
  mkdir -p "$RIG/deb" "$RIG/libs/root" && cd "$RIG/deb"
  POOL="http://deb.debian.org/debian/pool/main"
  for u in \
    "$POOL/n/nspr/libnspr4_4.40-1_amd64.deb" \
    "$POOL/n/nss/libnss3_3.129-1_amd64.deb" \
    "$POOL/a/at-spi2-core/libatk-bridge2.0-0t64_2.62.0-1_amd64.deb" \
    "$POOL/a/at-spi2-core/libatk1.0-0t64_2.62.0-1_amd64.deb" \
    "$POOL/a/at-spi2-core/libatspi2.0-0t64_2.62.0-1_amd64.deb" \
    "$POOL/c/cups/libcups2t64_2.4.10-3+deb13u2_amd64.deb" \
    "$POOL/libx/libxkbcommon/libxkbcommon0_1.7.0-2_amd64.deb" \
    "$POOL/a/alsa-lib/libasound2t64_1.2.14-1_amd64.deb" \
    "$POOL/libx/libxdamage/libxdamage1_1.1.7-1+b1_amd64.deb" \
    "$POOL/libx/libxres/libxres1_1.2.1-2_amd64.deb" \
    "$POOL/a/avahi/libavahi-common3_0.8-18_amd64.deb" \
    "$POOL/a/avahi/libavahi-client3_0.8-18_amd64.deb" ; do
    [ -f "$(basename "$u")" ] || curl -sO "$u" || true
  done
  for f in *.deb; do
    if command -v dpkg-deb >/dev/null; then dpkg-deb -x "$f" "$RIG/libs/root/" 2>/dev/null || true
    else ar x "$f" && tar -xf data.tar.* -C "$RIG/libs/root/" && rm -f data.tar.* control.tar.* debian-binary; fi
  done
fi

echo
LD_LIBRARY_PATH="$LIBS" "$CHROME" --version 2>/dev/null || "$CHROME" --version
echo
echo "export REEL_RIG=$RIG"
echo "export REEL_CHROME=$CHROME"
echo
echo "now run:  REEL_RIG=$RIG node test/browser.js all"
