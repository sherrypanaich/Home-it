#!/usr/bin/env bash
# Keeps Home it up to date from GitHub. A timer runs this every 10 minutes (install.sh sets it up).
# When there is a newer version on the main branch it switches to it, checks it, and restarts the app;
# the screen then reloads by itself. If the new version fails its self-check, the old one stays.
# Your data/ folder and home-it.env are never touched.
set -euo pipefail
DEST="$(cd "$(dirname "$0")" && pwd)"
cd "$DEST"
[ -d .git ] || { echo "Not a git copy, so there is nothing to update from."; exit 0; }
BRANCH="${HOME_IT_BRANCH:-main}"
git fetch --quiet origin "$BRANCH"
OLD="$(git rev-parse HEAD)"; NEW="$(git rev-parse FETCH_HEAD)"
[ "$OLD" = "$NEW" ] && exit 0
# a version that already failed here is not tried again
[ -f .git/home-it-skip ] && [ "$(cat .git/home-it-skip)" = "$NEW" ] && exit 0
if ! git merge --ff-only --quiet FETCH_HEAD; then
  echo "This copy has changes of its own, so it can't update by itself. Run: git status"; exit 1
fi
if ! node --test test/*.test.js >/dev/null 2>&1; then
  git reset --hard --quiet "$OLD"; echo "$NEW" > .git/home-it-skip
  echo "The new version ($NEW) failed its self-check. Staying on the old one."; exit 1
fi
systemctl --user restart home-it
echo "Home it updated to $(git log -1 --format='%h %s')"
