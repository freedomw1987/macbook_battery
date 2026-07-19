#!/bin/bash
# setup-power-guard.sh
# One-shot installer for MacBook Air power management automation
# Idempotent — safe to re-run
#
# Components managed:
#   1. pmset -c settings  → 插電時合蓋不睡
#   2. clamshell-power-guard LaunchAgent  → 拔電合蓋時彈警告
#   3. pmset-ac-watchdog LaunchAgent  → 插電瞬間自動套用 pmset -c
#   4. /etc/sudoers.d/pmset-ac-watchdog  → 讓 watchdog 背景跑時不需密碼

set -euo pipefail

# ─── Paths ─────────────────────────────────────────────
SCRIPT_DIR="$HOME/bin"
PLIST_DIR="$HOME/Library/LaunchAgents"
PMSET_BIN="/usr/bin/pmset"
SUDOERS_FILE="/etc/sudoers.d/pmset-ac-watchdog"

CLAMSHELL_LABEL="com.user.clamshell-power-guard"
CLAMSHELL_SCRIPT="$SCRIPT_DIR/clamshell-power-guard.sh"
CLAMSHELL_PLIST="$PLIST_DIR/$CLAMSHELL_LABEL.plist"

WATCHDOG_LABEL="com.user.pmset-ac-watchdog"
WATCHDOG_SCRIPT="$SCRIPT_DIR/pmset-ac-watchdog.sh"
WATCHDOG_PLIST="$PLIST_DIR/$WATCHDOG_LABEL.plist"

PMSET_FLAGS="sleep 0 displaysleep 0 powernap 1 halfdim 0 acwake 1 proximitywake 1 tcpkeepalive 1"

# ─── Colors (only when TTY) ────────────────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; BLUE=''; NC=''
fi
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[i]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

# ─── Usage ─────────────────────────────────────────────
usage() {
    cat << 'USAGE'
Usage: setup-power-guard.sh [command]

Commands:
  install       Install / refresh all components (default)
  uninstall     Remove all components
  status        Show installation status
  verify        Run verification checks
  help          Show this message
USAGE
}

# ─── Pre-flight ────────────────────────────────────────
check_macos() {
    [[ "$(uname)" == "Darwin" ]] || { err "Requires macOS"; exit 1; }
    [[ "$EUID" -ne 0 ]] || { err "Do NOT run as root"; exit 1; }
    [ -x "$PMSET_BIN" ] || { err "$PMSET_BIN not found"; exit 1; }
}

# ─── Sudoers ───────────────────────────────────────────
install_sudoers() {
    info "Configuring sudoers (one-time, requires admin password)..."
    local entry="$(whoami) ALL=(ALL) NOPASSWD: $PMSET_BIN"

    if [ -f "$SUDOERS_FILE" ] && grep -qF "$entry" "$SUDOERS_FILE" 2>/dev/null; then
        info "sudoers already configured"
    else
        echo "$entry" | sudo tee "$SUDOERS_FILE" > /dev/null
        sudo chmod 0440 "$SUDOERS_FILE"
    fi

    sudo visudo -c -f "$SUDOERS_FILE" >/dev/null
    sudo -n "$PMSET_BIN" -g ps >/dev/null
    log "sudoers: $SUDOERS_FILE"
}

# ─── pmset -c ──────────────────────────────────────────
apply_pmset() {
    info "Applying pmset -c..."
    # shellcheck disable=SC2086
    sudo -n "$PMSET_BIN" -c $PMSET_FLAGS
    log "pmset -c applied"
}

# ─── clamshell-power-guard ─────────────────────────────
install_clamshell_guard() {
    info "Installing $CLAMSHELL_LABEL..."
    mkdir -p "$SCRIPT_DIR" "$PLIST_DIR"

    cat > "$CLAMSHELL_SCRIPT" << 'CLAM_EOF'
#!/bin/bash
# Warns once when MacBook enters clamshell mode on battery power
set -u

LOG="/tmp/clamshell-power-guard.log"
WARNED_FLAG="/tmp/.clamshell-power-guard-warned"

CLAMSHELL=$(ioreg -r -k AppleClamshellState -d 1 2>/dev/null | grep -m1 AppleClamshellState | grep -c "Yes")
POWER=$(pmset -g ps 2>/dev/null | head -1)

if [ "$CLAMSHELL" -eq 0 ] || [[ "$POWER" != *"Battery"* ]]; then
    rm -f "$WARNED_FLAG"
    exit 0
fi

if [ -f "$WARNED_FLAG" ]; then
    exit 0
fi

touch "$WARNED_FLAG"
echo "$(date '+%Y-%m-%d %H:%M:%S') WARNING: clamshell + battery detected" >> "$LOG"
osascript -e 'display notification "外接螢幕即將 sleep。插入 MagSafe 或 USB-C 充電器以保持 session 活躍。" with title "⚠️ 電池 + 合蓋" sound name "Basso"' >> "$LOG" 2>&1
CLAM_EOF
    chmod +x "$CLAMSHELL_SCRIPT"

    cat > "$CLAMSHELL_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$CLAMSHELL_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$CLAMSHELL_SCRIPT</string>
    </array>
    <key>StartInterval</key>
    <integer>30</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/clamshell-power-guard.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/clamshell-power-guard.err</string>
</dict>
</plist>
EOF

    if launchctl list | grep -q "$CLAMSHELL_LABEL"; then
        launchctl unload "$CLAMSHELL_PLIST" 2>/dev/null || true
    fi
    launchctl load "$CLAMSHELL_PLIST"
    log "$CLAMSHELL_LABEL loaded"
}

# ─── pmset-ac-watchdog ────────────────────────────────
install_watchdog() {
    info "Installing $WATCHDOG_LABEL..."
    mkdir -p "$SCRIPT_DIR" "$PLIST_DIR"

    cat > "$WATCHDOG_SCRIPT" << 'DOG_EOF'
#!/bin/bash
# Auto-reapplies pmset -c when AC plugged in or settings drift
set -u

LOG="/tmp/pmset-ac-watchdog.log"
LAST_POWER_FILE="/tmp/.pmset-ac-watchdog-lastpower"
PMSET_CMD="/usr/bin/pmset"
EXPECTED_AC_SLEEP=0
PMSET_FLAGS="sleep 0 displaysleep 0 powernap 1 halfdim 0 acwake 1 proximitywake 1 tcpkeepalive 1"

CURRENT_POWER=$(pmset -g ps 2>/dev/null | head -1)
CURRENT_AC_SLEEP=$(pmset -g c 2>/dev/null | awk '/^ sleep/ {print $2}')

LAST_POWER=""
[ -f "$LAST_POWER_FILE" ] && LAST_POWER=$(cat "$LAST_POWER_FILE")

echo "$CURRENT_POWER" > "$LAST_POWER_FILE"

if [[ "$CURRENT_POWER" != *"AC Power"* ]]; then
    exit 0
fi

JUST_PLUGGED=0
DRIFTED=0

if [[ "$LAST_POWER" == *"Battery"* ]] || [ -z "$LAST_POWER" ]; then
    JUST_PLUGGED=1
fi

if [ "$CURRENT_AC_SLEEP" != "$EXPECTED_AC_SLEEP" ]; then
    DRIFTED=1
fi

if [ "$JUST_PLUGGED" = "1" ] || [ "$DRIFTED" = "1" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') TRIGGER just_plugged=$JUST_PLUGGED drifted=$DRIFTED sleep_was=$CURRENT_AC_SLEEP" >> "$LOG"

    # shellcheck disable=SC2086
    if sudo -n "$PMSET_CMD" -c $PMSET_FLAGS >> "$LOG" 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') ✓ pmset -c applied" >> "$LOG"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') ✗ sudo failed — check /etc/sudoers.d/pmset-ac-watchdog" >> "$LOG"
        osascript -e 'display notification "pmset-ac-watchdog 需要 sudo 設定，請見 /tmp/pmset-ac-watchdog.log" with title "⚠️ Watchdog" sound name "Basso"' 2>> "$LOG"
    fi
fi
DOG_EOF
    chmod +x "$WATCHDOG_SCRIPT"

    cat > "$WATCHDOG_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$WATCHDOG_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$WATCHDOG_SCRIPT</string>
    </array>
    <key>StartInterval</key>
    <integer>30</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/pmset-ac-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pmset-ac-watchdog.err</string>
</dict>
</plist>
EOF

    if launchctl list | grep -q "$WATCHDOG_LABEL"; then
        launchctl unload "$WATCHDOG_PLIST" 2>/dev/null || true
    fi
    launchctl load "$WATCHDOG_PLIST"
    log "$WATCHDOG_LABEL loaded"
}

# ─── install / uninstall ──────────────────────────────
install_all() {
    check_macos
    echo ""
    info "Installing power-guard automation..."
    echo ""
    install_sudoers
    apply_pmset
    install_clamshell_guard
    install_watchdog
    echo ""
    verify_all
    echo ""
    log "Installation complete!"
    echo ""
    info "Logs:"
    info "  /tmp/clamshell-power-guard.log"
    info "  /tmp/pmset-ac-watchdog.log"
    echo ""
    info "Run '$0 status' anytime to inspect; '$0 uninstall' to remove."
}

uninstall_all() {
    info "Uninstalling..."
    for label in "$CLAMSHELL_LABEL" "$WATCHDOG_LABEL"; do
        if launchctl list | grep -q "$label"; then
            local plist="$PLIST_DIR/$label.plist"
            [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null || true
        fi
    done

    rm -f "$CLAMSHELL_PLIST" "$WATCHDOG_PLIST"
    rm -f "$CLAMSHELL_SCRIPT" "$WATCHDOG_SCRIPT"

    if [ -f "$SUDOERS_FILE" ]; then
        sudo rm -f "$SUDOERS_FILE"
    fi

    rm -f /tmp/.clamshell-power-guard-warned /tmp/clamshell-power-guard.log /tmp/clamshell-power-guard.err
    rm -f /tmp/.pmset-ac-watchdog-lastpower /tmp/pmset-ac-watchdog.log /tmp/pmset-ac-watchdog.err

    log "Uninstalled"
    info "pmset -c settings left untouched. To reset to Apple defaults:"
    info "  sudo pmset -c sleep 0 displaysleep 10 halfdim 1 powernap 1"
}

# ─── status / verify ───────────────────────────────────
show_status() {
    echo ""
    info "=== Power-Guard Status ==="
    echo ""
    echo "LaunchAgents:"
    for label in "$CLAMSHELL_LABEL" "$WATCHDOG_LABEL"; do
        if launchctl list | grep -q "$label"; then
            log "  $label: loaded"
        else
            warn "  $label: not loaded"
        fi
    done
    echo ""
    echo "Scripts:"
    for s in "$CLAMSHELL_SCRIPT" "$WATCHDOG_SCRIPT"; do
        if [ -x "$s" ]; then
            log "  $s"
        else
            warn "  $s: missing"
        fi
    done
    echo ""
    echo "sudoers:"
    [ -f "$SUDOERS_FILE" ] && log "  $SUDOERS_FILE" || warn "  $SUDOERS_FILE: missing"
    echo ""
    echo "pmset -c (current):"
    pmset -g custom | sed -n '/^AC Power:/,/^$/p' | grep -E "^ (sleep|displaysleep|halfdim|powernap|acwake)" | sed 's/^/  /'
    echo ""
    echo "Power state: $(pmset -g ps | head -1 | sed 's/^Now drawing from //')"
}

verify_all() {
    info "Verifying..."
    local failed=0

    if ! launchctl list | grep -q "$CLAMSHELL_LABEL"; then
        err "$CLAMSHELL_LABEL not loaded"; failed=1
    fi
    if ! launchctl list | grep -q "$WATCHDOG_LABEL"; then
        err "$WATCHDOG_LABEL not loaded"; failed=1
    fi
    if ! sudo -n "$PMSET_BIN" -g ps >/dev/null 2>&1; then
        err "sudoers NOPASSWD not effective"; failed=1
    fi
    local sleep_val
    sleep_val=$(pmset -g custom 2>/dev/null | awk '/^AC Power:/{flag=1; next} flag && /^ sleep/{print $2; exit}')
    if [ "$sleep_val" != "0" ]; then
        err "pmset -c sleep = $sleep_val (expected 0)"; failed=1
    fi

    [ "$failed" -eq 0 ] && log "All checks passed" || { err "Some checks failed"; return 1; }
}

# ─── Main ──────────────────────────────────────────────
case "${1:-install}" in
    install)    install_all ;;
    uninstall)  uninstall_all ;;
    status)     show_status ;;
    verify)     verify_all ;;
    help|-h|--help) usage ;;
    *) err "Unknown command: $1"; usage; exit 1 ;;
esac