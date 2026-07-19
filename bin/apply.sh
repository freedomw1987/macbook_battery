#!/bin/bash
# ~/.battery-schedule/bin/apply.sh
# Apply a battery maintenance mode.
#
# Usage:
#   apply.sh day  [UPPER [LOWER]]     -> upper limit (default 80), lower limit (default = UPPER)
#   apply.sh noon [UPPER LOWER [CHARGE_BACK_TO]]
#                                       -> upper limit (default 80), lower limit (default 50),
#                                          charge_back_to hysteresis (default = LOWER+3)
#   apply.sh reset                     -> stop everything, restore default charging
#
# Backwards compatible: when invoked with no bounds args, falls back to
# historical defaults (80/50/53) so existing scripts (sync.sh, manual use)
# keep working.
#
# SMC keys (M3 + macOS 26):
#   CHTE controls charging (00=enable, 01=disable)
#   CHIE controls forced discharge (00=off, 08=on)
#
# MagSafe / USB-C adapters: irrelevant at SMC level — the battery CLI
# talks to the charge IC, not the connector.
#
# noon mode uses our own hold-loop.sh daemon instead of 'battery maintain'
# because the battery CLI's maintain loop only controls CHTE, never CHIE —
# so a stuck CHIE=08 flag would drain the battery past the lower bound
# down to 0%. hold-loop explicitly manages both keys.

set -euo pipefail

MODE="${1:-}"
UPPER="${2:-}"
LOWER="${3:-}"
CHARGE_BACK="${4:-}"
LOG="$HOME/.battery-schedule/logs/apply.log"
BATTERY=/usr/local/bin/battery
WRAPPER_BIN="$HOME/.battery-schedule/bin"
THRESHOLDS_FILE="$HOME/.battery-schedule/thresholds.json"

log() { printf '%s [%d] %s\n' "$(date '+%F %T')" "$$" "$*" | tee -a "$LOG"; }

if [[ -z "$MODE" ]]; then
    log "ERROR: no mode supplied (expected: day | noon | reset)"
    exit 2
fi

if [[ ! -x "$BATTERY" ]]; then
    log "ERROR: battery CLI not found at $BATTERY"
    exit 3
fi

# Step 1: stop any previous state — kill battery CLI maintain daemon AND
# our own hold-loop if it is running. Use pkill because hold-loop runs
# detached via launchd.
log "Stopping previous maintain + hold-loop"
"$BATTERY" maintain stop >>"$LOG" 2>&1 || true
"$BATTERY" disable_daemon >>"$LOG" 2>&1 || true
# Disable hold-loop launchd job AND kill any running process. pkill alone
# is not enough because KeepAlive=true makes launchd respawn it instantly.
launchctl bootout "gui/$(id -u)/com.user.battery-schedule.hold-loop" \
    >>"$LOG" 2>&1 || true
pkill -f "$WRAPPER_BIN/hold-loop.sh" 2>/dev/null || true
pkill -f "$WRAPPER_BIN/hold-loop-wrapper.sh" 2>/dev/null || true
rm -f "$HOME/.battery-schedule/state"
# Give processes a moment to exit cleanly before we set new state.
sleep 1

write_state() {
    # Write a sourceable shell file that hold-loop-wrapper.sh will read.
    cat > "$HOME/.battery-schedule/state" <<EOF
# Managed by apply.sh — do not edit by hand.
HOLD_LOOP_ACTIVE=1
MODE=$1
UPPER_BOUND=$2
LOWER_BOUND=$3
CHARGE_BACK_TO=$4
EOF
}

# Persist last-applied thresholds so the UI can read them on startup
# even after the hold-loop wrapper restarts (which rewrites state with
# just mode + bounds). We store all three bounds here.
save_thresholds() {
    local mode="$1" upper="$2" lower="$3" cb="$4"
    # Read existing file (if any) to preserve other-mode bounds.
    local existing_day_u=80 existing_day_l=80 existing_noon_u=80 existing_noon_l=50 existing_noon_cb=53
    if [[ -f "$THRESHOLDS_FILE" ]]; then
        existing_day_u=$(plutil -extract day.upper raw "$THRESHOLDS_FILE" 2>/dev/null || echo 80)
        existing_day_l=$(plutil -extract day.lower raw "$THRESHOLDS_FILE" 2>/dev/null || echo 80)
        existing_noon_u=$(plutil -extract noon.upper raw "$THRESHOLDS_FILE" 2>/dev/null || echo 80)
        existing_noon_l=$(plutil -extract noon.lower raw "$THRESHOLDS_FILE" 2>/dev/null || echo 50)
        existing_noon_cb=$(plutil -extract noon.charge_back_to raw "$THRESHOLDS_FILE" 2>/dev/null || echo 53)
    fi
    case "$mode" in
        day)
            plutil -create xml1 "$THRESHOLDS_FILE"
            plutil -insert day -dictionary "$THRESHOLDS_FILE"
            plutil -insert day.upper -integer "$upper" "$THRESHOLDS_FILE"
            plutil -insert day.lower -integer "$upper" "$THRESHOLDS_FILE"
            plutil -insert noon -dictionary "$THRESHOLDS_FILE"
            plutil -insert noon.upper -integer "$existing_noon_u" "$THRESHOLDS_FILE"
            plutil -insert noon.lower -integer "$existing_noon_l" "$THRESHOLDS_FILE"
            plutil -insert noon.charge_back_to -integer "$existing_noon_cb" "$THRESHOLDS_FILE"
            ;;
        noon)
            plutil -create xml1 "$THRESHOLDS_FILE"
            plutil -insert day -dictionary "$THRESHOLDS_FILE"
            plutil -insert day.upper -integer "$existing_day_u" "$THRESHOLDS_FILE"
            plutil -insert day.lower -integer "$existing_day_l" "$THRESHOLDS_FILE"
            plutil -insert noon -dictionary "$THRESHOLDS_FILE"
            plutil -insert noon.upper -integer "$upper" "$THRESHOLDS_FILE"
            plutil -insert noon.lower -integer "$lower" "$THRESHOLDS_FILE"
            plutil -insert noon.charge_back_to -integer "$cb" "$THRESHOLDS_FILE"
            ;;
    esac
}

validate_bounds() {
    # All four bounds must be integers 1..100 and (noon) lower < upper,
    # (noon) charge_back_to >= lower.
    local upper="$1" lower="$2" cb="$3"
    if ! [[ "$upper" =~ ^[0-9]+$ ]] || (( upper < 1 || upper > 100 )); then
        log "ERROR: upper must be 1..100, got '$upper'"
        exit 4
    fi
    if ! [[ "$lower" =~ ^[0-9]+$ ]] || (( lower < 1 || lower > 100 )); then
        log "ERROR: lower must be 1..100, got '$lower'"
        exit 4
    fi
    if (( lower > upper )); then
        log "ERROR: lower ($lower) must be <= upper ($upper)"
        exit 4
    fi
    if [[ -n "$cb" ]]; then
        if ! [[ "$cb" =~ ^[0-9]+$ ]] || (( cb < lower || cb > upper )); then
            log "ERROR: charge_back_to ($cb) must be lower..upper ($lower..$upper)"
            exit 4
        fi
    fi
}

case "$MODE" in
    day)
        # Default: 80/80 (cap mode uses one bound).
        [[ -z "$UPPER" ]] && UPPER=80
        [[ -z "$LOWER" ]] && LOWER="$UPPER"
        validate_bounds "$UPPER" "$LOWER" ""
        log "Clearing forced discharge (CHIE -> 00)"
        "$BATTERY" adapter on >>"$LOG" 2>&1 || true
        write_state cap "$UPPER" "$LOWER" "$LOWER"
        save_thresholds day "$UPPER" "$LOWER" 0
        log "Re-enabling hold-loop launchd job (cap mode UPPER=$UPPER)"
        launchctl bootstrap "gui/$(id -u)" \
            "$HOME/Library/LaunchAgents/com.user.battery-schedule.hold-loop.plist" \
            >>"$LOG" 2>&1 || true
        launchctl kickstart -k "gui/$(id -u)/com.user.battery-schedule.hold-loop" \
            >>"$LOG" 2>&1 || true
        if ! pgrep -f "$WRAPPER_BIN/hold-loop-wrapper.sh\|$WRAPPER_BIN/hold-loop.sh" >/dev/null 2>&1; then
            log "launchd kickstart didn't start it; launching detached in cap mode"
            nohup "$WRAPPER_BIN/hold-loop-wrapper.sh" \
                >>"$HOME/.battery-schedule/logs/hold-loop-fallback.log" 2>&1 &
            disown || true
        fi
        log "Applying DAY mode: hold-loop cap at $UPPER%"
        ;;
    noon)
        # Default: 80 / 50 / 53.
        [[ -z "$UPPER" ]] && UPPER=80
        [[ -z "$LOWER" ]] && LOWER=50
        [[ -z "$CHARGE_BACK" ]] && CHARGE_BACK=$(( LOWER + 3 ))
        validate_bounds "$UPPER" "$LOWER" "$CHARGE_BACK"
        write_state hold50 "$UPPER" "$LOWER" "$CHARGE_BACK"
        save_thresholds noon "$UPPER" "$LOWER" "$CHARGE_BACK"
        log "Re-enabling hold-loop launchd job (hold50 mode UPPER=$UPPER LOWER=$LOWER CB=$CHARGE_BACK)"
        launchctl bootstrap "gui/$(id -u)" \
            "$HOME/Library/LaunchAgents/com.user.battery-schedule.hold-loop.plist" \
            >>"$LOG" 2>&1 || true
        launchctl kickstart -k "gui/$(id -u)/com.user.battery-schedule.hold-loop" \
            >>"$LOG" 2>&1 || true
        if ! pgrep -f "$WRAPPER_BIN/hold-loop-wrapper.sh\|$WRAPPER_BIN/hold-loop.sh" >/dev/null 2>&1; then
            log "launchd kickstart didn't start it; launching detached in hold50 mode"
            nohup "$WRAPPER_BIN/hold-loop-wrapper.sh" \
                >>"$HOME/.battery-schedule/logs/hold-loop-fallback.log" 2>&1 &
            disown || true
        fi
        ;;
    reset)
        # Restore defaults: clear force-discharge, leave charging enabled.
        log "Clearing forced discharge (CHIE -> 00)"
        "$BATTERY" adapter on >>"$LOG" 2>&1 || true
        log "Reset mode: everything stopped, charging back to default"
        ;;
    *)
        log "ERROR: unknown mode '$MODE' (expected: day | noon | reset)"
        exit 2
        ;;
esac

# Emit current status for verification.
log "Current status: $($BATTERY status 2>&1 | tail -n1)"
exit 0