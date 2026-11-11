#!/usr/bin/env bash
# Installs Home it on this Linux machine as a service that starts on boot.
# Run from the unpacked folder:  bash install.sh
# Safe to run again to update: your data/ folder and home-it.env are kept.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/home-it"
# A git copy runs from where it is, so it can keep itself up to date (see update.sh)
[ -d "$SRC/.git" ] && DEST="$SRC"

# 1. Node.js 22 or newer (older ones no longer get security fixes)
need_node=1
if command -v node >/dev/null; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] && need_node=0
fi
if [ $need_node = 1 ]; then
  if command -v apt-get >/dev/null; then
    echo "Installing Node.js 24..."
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "Please install Node.js 22 or newer with your package manager, then run this again."; exit 1
  fi
fi
echo "Node $(node -v)"

# 2. Copy the app, keeping any existing data and settings
mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  tar -C "$SRC" --exclude=./data --exclude=./home-it.env --exclude=./.git -cf - . | tar -C "$DEST" -xf -
fi
[ -f "$DEST/home-it.env" ] || { cp "$DEST/home-it.env.example" "$DEST/home-it.env"; chmod 600 "$DEST/home-it.env"; }
echo "App files in $DEST"
(cd "$DEST" && node --test test/*.test.js >/dev/null 2>&1 && echo "Self-check passed") || echo "Self-check had a problem (cd $DEST && node --test test/*.test.js shows it). Carrying on."

# 3. Start on boot
mkdir -p "$HOME/.config/systemd/user"
cp "$DEST/home-it.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable home-it >/dev/null
systemctl --user restart home-it
sudo loginctl enable-linger "$USER"
sleep 1
systemctl --user --no-pager status home-it | head -5 || true

# 3b. Update by itself from GitHub every 10 minutes (only when this folder is a git copy)
if [ -d "$DEST/.git" ]; then
  chmod +x "$DEST/update.sh"
  cat > "$HOME/.config/systemd/user/home-it-update.service" <<EOT
[Unit]
Description=Update Home it from GitHub
[Service]
Type=oneshot
ExecStart=$DEST/update.sh
EOT
  cat > "$HOME/.config/systemd/user/home-it-update.timer" <<EOT
[Unit]
Description=Check for a newer Home it
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOT
  systemctl --user daemon-reload
  systemctl --user enable --now home-it-update.timer >/dev/null
  echo "Home it will update itself from GitHub."
fi

# 4. Open Home it full screen, as an app, whenever this computer's desktop starts
#    Pass the person whose home it shows:  bash install.sh YOURNAME   (skip the name to leave the screen alone)
if [ -n "${1:-}" ]; then
  chmod +x "$DEST/home-it-screen.sh"
  mkdir -p "$HOME/.config/autostart" "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/home-it.desktop" <<EOT
[Desktop Entry]
Type=Application
Name=Home it
Comment=Your day, full screen
Exec=env HOME_IT_USER="$1" "$DEST/home-it-screen.sh"
Icon=$DEST/public/icon-512.png
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
EOT
  cp "$HOME/.local/share/applications/home-it.desktop" "$HOME/.config/autostart/home-it.desktop"
  echo "Home it will open full screen when the desktop starts. It is also in the apps menu."
fi

# 5. Next steps
if ! node -e "process.exit(Object.keys(require('$DEST/data/users.json').users||{}).length?0:1)" 2>/dev/null; then
  echo
  echo "Now add yourself (the first person added runs it):"
  echo "  cd $DEST && node server.js add-user YOURNAME"
fi
echo
echo "To open it full screen as an app at startup, run: bash install.sh YOURNAME (after adding yourself)."
