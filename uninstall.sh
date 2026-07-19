#!/bin/bash
# macbook_battery/uninstall.sh
# Unregister launchd jobs and remove wrapper. Project files untouched.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLED_PLISTS="$HOME/Library/LaunchAgents"
WRAPPER="$HOME/.battery-schedule"
DOMAIN="gui/$(id -u)"

echo "==> Booting out launchd jobs"
for src in "$PROJECT_DIR"/plists/*.plist; do
    name="$(basename "$src")"
    LABEL="${name%.plist}"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$INSTALLED_PLISTS/$name"
    echo "    unloaded & removed: $LABEL"
done

echo "==> Resetting battery CLI to default"
/usr/local/bin/battery maintain stop 2>&1 | tail -5 || true

echo "==> Removing Power-Guard artifacts"
sudo rm -f /etc/sudoers.d/pmset-ac-watchdog
rm -f "$HOME/bin/clamshell-power-guard.sh" \
      "$HOME/bin/pmset-ac-watchdog.sh" \
      "$HOME/bin/setup-power-guard.sh"
# Kill any caffeinate spawned by clamshell-power-guard
if [ -f /tmp/.clamshell-power-guard-caffeinate.pid ]; then
    pid=$(cat /tmp/.clamshell-power-guard-caffeinate.pid 2>/dev/null || echo "")
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
fi
rm -f /tmp/.clamshell-power-guard-warned \
      /tmp/.clamshell-power-guard-caffeinate.pid \
      /tmp/.pmset-ac-watchdog-lastpower
echo "    sudoers + ~/bin/ symlinks + state flags + caffeinate cleanup"

echo "==> Removing wrapper at $WRAPPER"
rm -rf "$WRAPPER"

echo "Done."
echo "Project files at $PROJECT_DIR are untouched."