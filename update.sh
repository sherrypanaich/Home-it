#!/usr/bin/env bash
# Keeps Home it up to date from GitHub. A timer runs this every 10 minutes (install.sh sets it up).
# It only moves to a version that has been released (a tag like v1.1.0), never to work in progress.
# The new version is checked twice: its own tests first, then, after the restart, that the app answers.
# If either check fails, the old version comes back and the bad one is not tried again.
# Your data/ folder and home-it.env are never touched.
# To follow a branch instead (for trying things out): HOME_IT_BRANCH=main in home-it.env.
set -euo pipefail
DEST="$(cd "$(dirname "$0")" && pwd)"
cd "$DEST"
[ -d .git ] || { echo "Not a git copy, so there is nothing to update from."; exit 0; }
envval() { [ -f home-it.env ] && sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" home-it.env | tail -1 | tr -d "\"'\r" || true; }
BRANCH="${HOME_IT_BRANCH:-$(envval HOME_IT_BRANCH)}"
PORT="${PORT:-$(envval PORT)}"; PORT="${PORT:-8100}"

OLD="$(git rev-parse HEAD)"
if [ -n "$BRANCH" ]; then
  git fetch --quiet origin "$BRANCH"; NEW="$(git rev-parse FETCH_HEAD)"; NAME="$BRANCH"
else
  git fetch --quiet --tags origin
  NAME="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
  [ -n "$NAME" ] || exit 0                                   # nothing released yet
  NEW="$(git rev-parse "$NAME^{commit}")"
fi
[ "$OLD" = "$NEW" ] && exit 0
# never go backwards: this copy may already be ahead of the newest release
git merge-base --is-ancestor "$NEW" "$OLD" && exit 0
# a version that already failed here is not tried again
[ -f .git/home-it-skip ] && [ "$(cat .git/home-it-skip)" = "$NEW" ] && exit 0
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "This copy has changes of its own, so it can't update by itself. Run: git status"; exit 1
fi

goback() { git checkout --quiet --detach "$OLD"; echo "$NEW" > .git/home-it-skip; }
answers() {   # true once the app says it is up, waiting up to 30 seconds
  for _ in $(seq 1 30); do
    node -e "fetch('http://127.0.0.1:$PORT/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

git checkout --quiet --detach "$NEW"
if ! node --test test/*.test.js >/dev/null 2>&1; then
  goback; echo "The new version ($NAME) failed its self-check. Staying on the old one."; exit 1
fi
[ "${HOME_IT_NO_RESTART:-}" = 1 ] && { echo "Home it is now on $NAME (not restarted)"; exit 0; }
systemctl --user restart home-it
if ! answers; then
  goback; systemctl --user restart home-it
  echo "The new version ($NAME) didn't start properly. Went back to the old one."; exit 1
fi
echo "Home it updated to $NAME ($(git log -1 --format='%h %s'))"
