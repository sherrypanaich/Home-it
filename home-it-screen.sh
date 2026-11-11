#!/usr/bin/env bash
# Opens Home it as a full-screen app on this computer's own screen: no address bar, no tabs, no browser menus.
# install.sh sets this to run when you log in. To leave the screen: Alt+F4.
set -u
DEST="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8100}"
URL="http://127.0.0.1:$PORT"

# Wait for the app to be up (it starts on boot as a service)
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "$URL/manifest.webmanifest" && break
  sleep 1
done

BROWSER=""
for b in chromium chromium-browser google-chrome google-chrome-stable brave-browser microsoft-edge; do
  command -v "$b" >/dev/null && { BROWSER="$b"; break; }
done
[ -n "$BROWSER" ] || { echo "Home it needs Chromium or Chrome for its screen. Install one (sudo apt install chromium) and run this again."; exit 1; }

# The first time, sign this screen in for good with a one-time link. After that the saved sign-in is used.
PROFILE="$HOME/.config/home-it-screen"
START="$URL"
if [ ! -d "$PROFILE" ] && [ -n "${HOME_IT_USER:-}" ]; then
  LINK="$(cd "$DEST" && node server.js kiosk-link "$HOME_IT_USER" | grep -o 'http://[^ ]*' | head -1)"
  [ -n "$LINK" ] && START="${LINK/localhost/127.0.0.1}"
fi

# Keep the screen from blanking or locking; Home it darkens itself at night
command -v xset >/dev/null && { xset s off; xset -dpms; xset s noblank; } 2>/dev/null || true

exec "$BROWSER" --kiosk --app="$START" --user-data-dir="$PROFILE" --no-first-run --noerrdialogs \
  --disable-session-crashed-bubble --disable-infobars --disable-translate --disable-pinch \
  --overscroll-history-navigation=0 --check-for-update-interval=31536000 --password-store=basic
