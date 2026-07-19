#!/bin/bash
# macbook_battery/install.sh
#
# Install / re-install the charging schedule.
#
# Strategy:
#   * Source of truth lives in this project folder.
#   * ~/.battery-schedule/ is just a thin wrapper with:
#       - bin/  -> this project's bin/  (symlink)
#       - logs/ (real dir, owned by user)
#   * Plists live in this project (plists/) AND are installed into
#     ~/Library/LaunchAgents/. They call scripts through the
#     ~/.battery-schedule/bin/ symlink path so launchd resolves to
#     this project's copy.
#   * MagSafe / USB-C adapters are handled identically at SMC level.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$HOME/.battery-schedule"
WRAPPER_BIN="$WRAPPER/bin"
WRAPPER_LOGS="$WRAPPER/logs"
INSTALLED_PLISTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

echo "==> Project dir: $PROJECT_DIR"

# Build wrapper skeleton.
echo "==> Creating wrapper at $WRAPPER"
mkdir -p "$WRAPPER_LOGS"

# bin/ is a symlink into the project.
if [[ -e "$WRAPPER_BIN" && ! -L "$WRAPPER_BIN" ]]; then
    echo "    removing existing non-symlink $WRAPPER_BIN"
    rm -rf "$WRAPPER_BIN"
fi
if [[ ! -L "$WRAPPER_BIN" ]]; then
    ln -s "$PROJECT_DIR/bin" "$WRAPPER_BIN"
fi
echo "    $WRAPPER_BIN -> $(readlink "$WRAPPER_BIN")"

# Verify symlink works.
for s in apply.sh sync.sh; do
    if [[ ! -x "$WRAPPER_BIN/$s" ]]; then
        echo "ERROR: $WRAPPER_BIN/$s missing or not executable"
        exit 3
    fi
done

# Install (copy) plists from project to LaunchAgents.
echo "==> Installing plists into $INSTALLED_PLISTS"
for src in "$PROJECT_DIR"/plists/*.plist; do
    name="$(basename "$src")"
    dst="$INSTALLED_PLISTS/$name"
    cp "$src" "$dst"
    plutil -lint "$dst"
    LABEL="${name%.plist}"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$dst"
    launchctl enable "$DOMAIN/$LABEL"
    echo "    loaded: $LABEL"
done

echo
echo "Done. Verify with:"
echo "    launchctl list | grep battery-schedule"
echo "    $WRAPPER_BIN/apply.sh day"
echo "    /usr/local/bin/battery status"

# ─── Power-Guard: 插電時禁用 sleep + 拔電合蓋警告 ───
echo
echo "==> Power-Guard setup (clamshell + pmset automation)"
PMSET_BIN="/usr/bin/pmset"
SUDOERS_FILE="/etc/sudoers.d/pmset-ac-watchdog"
USER_NAME="$(whoami)"
SUDOERS_ENTRY="$USER_NAME ALL=(ALL) NOPASSWD: $PMSET_BIN"

# 1. sudoers — skip if already configured
if [ -f "$SUDOERS_FILE" ] && grep -qF "$SUDOERS_ENTRY" "$SUDOERS_FILE" 2>/dev/null; then
    echo "    sudoers already configured"
else
    echo "    Configuring sudoers (one-time, requires admin password)..."
    echo "$SUDOERS_ENTRY" | sudo tee "$SUDOERS_FILE" >/dev/null
    sudo chmod 0440 "$SUDOERS_FILE"
    sudo /usr/sbin/visudo -c -f "$SUDOERS_FILE" >/dev/null
    echo "    ✓ sudoers: $SUDOERS_FILE"
fi

# 2. pmset -c — apply on AC (idempotent: same value if already 0)
echo "    Applying pmset -c settings..."
sudo -n "$PMSET_BIN" -c sleep 0 displaysleep 0 powernap 1 halfdim 0 acwake 1 proximitywake 1 tcpkeepalive 1
echo "    ✓ pmset -c applied"

# 3. ~/bin/ symlinks for direct user access
for s in clamshell-power-guard.sh pmset-ac-watchdog.sh setup-power-guard.sh; do
    if [ -f "$PROJECT_DIR/bin/$s" ] && [ ! -e "$HOME/bin/$s" ]; then
        ln -s "$WRAPPER_BIN/$s" "$HOME/bin/$s"
        echo "    ✓ ~/bin/$s -> $WRAPPER_BIN/$s"
    fi
done

echo
echo "Power-Guard components installed:"
echo "  Clamshell guard:  warns on clamshell + battery"
echo "  pmset watchdog:   auto-reapplies pmset -c on AC plug-in"
echo "  Verify:           $WRAPPER_BIN/setup-power-guard.sh status"