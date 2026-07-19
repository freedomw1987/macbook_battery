#!/bin/bash
# ~/.battery-schedule/bin/hold-loop.sh
# Self-written SMC controller for two battery modes.
#
# Why we don't rely on 'battery maintain' alone:
#   The battery CLI's maintain_synchronous loop ONLY manipulates the
#   charging key (CHTE). It never touches the forced-discharge key (CHIE).
#   So if CHIE=08 stays set, the battery keeps draining even when CHTE=00
#   would otherwise allow charging — and the battery drops to 0%.
#
#   Similarly, if the maintain daemon ever crashes (or never starts after
#   reboot), there is NO enforcement of the upper limit and the system
#   happily charges to 100%.
#
# This loop explicitly manages BOTH keys and adds hysteresis to prevent
# flapping between states. launchd's KeepAlive=true restarts it on crash.
#
# Modes (selected via MODE env var, default "discharge"):
#
#   MODE=cap MODE_DESC="hold at UPPER (default 80)"
#     % >= UPPER_BOUND         -> CHTE=01 (stop charging)
#     % < UPPER_BOUND          -> CHTE=00 (allow charging)
#     Used by day mode.
#
#   MODE=hold50 MODE_DESC="discharge to 50 then hold"
#     % >= LOWER_BOUND (50)    -> CHTE=01 + CHIE=08 (force discharge)
#     % < LOWER_BOUND          -> CHTE=00 + CHIE=00 (allow charging)
#     % >= CHARGE_BACK_TO (53) -> resume discharge
#     Used by noon mode.
#
# MagSafe / USB-C: irrelevant — handled identically at SMC layer.

set -u

# Read MODE/bounds from state file written by apply.sh, falling back to
# defaults if missing or unset. Holds the logic previously in
# hold-loop-wrapper.sh (deleted in OPT-1).
STATE_FILE="$HOME/.battery-schedule/state"
MODE="${MODE:-hold50}"
UPPER_BOUND="${UPPER_BOUND:-80}"
LOWER_BOUND="${LOWER_BOUND:-50}"
CHARGE_BACK_TO="${CHARGE_BACK_TO:-53}"
if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
fi

POLL="${POLL:-60}"
LOG="$HOME/.battery-schedule/logs/hold-loop.log"
BATTERY=/usr/local/bin/battery
SMC=/usr/local/co.palokaj.battery/smc

log() { printf '%s [%d] %s\n' "$(date '+%F %T')" "$$" "$*" | tee -a "$LOG"; }

# Single source of truth: read battery % via pmset (same as battery CLI).
get_percent() {
    pmset -g batt | tail -n1 | awk '{print $3}' | sed 's:%;::'
}

# State writes go through the battery CLI which has the sudo + visudo
# permissions needed to talk to SMC.

# In cap mode: stop charging (CHTE=01).
stop_charging() {
    log "Action: stop charging (CHTE=01)"
    "$BATTERY" charging off >>"$LOG" 2>&1 || true
}

# In cap mode: allow charging (CHTE=00).
allow_charging() {
    log "Action: allow charging (CHTE=00)"
    "$BATTERY" charging on >>"$LOG" 2>&1 || true
}

# In hold50 mode: force discharge (CHTE=01 + CHIE=08).
# Order matters: battery CLI's "charging off" internally calls
# disable_discharging (CHIE=00). So we call charging off FIRST, then
# adapter off LAST so the final CHIE=08 is the one that sticks.
#
# Side effect: pmset will see "Battery Power" even with charger plugged.
# Workstation override (compute_effective_mode) releases CHIE=00 when
# lid is closed + external display connected, so pmset sees AC and
# clamshell mode auto-activates.
set_discharge() {
    log "Action: ENTER discharge state (CHTE=01, CHIE=08, force discharge)"
    "$BATTERY" charging off >>"$LOG" 2>&1 || true
    "$BATTERY" adapter off >>"$LOG" 2>&1 || true
}

# In hold50 mode: release discharge and allow charging.
# Adapter on first so the final CHIE=00 sticks (charging on later).
set_charge() {
    log "Action: ENTER charge state (CHTE=00, CHIE=00)"
    "$BATTERY" adapter on >>"$LOG" 2>&1 || true
    "$BATTERY" charging on >>"$LOG" 2>&1 || true
}

# Safety net: explicitly release CHIE=00 (in case it was set to 08 by an
# external tool like `battery adapter off` run by hand or by another
# script). Called only on workstation entry; not part of normal mode
# transitions.
release_force_discharge() {
    log "Action: releasing force discharge (CHIE=00, safety net)"
    "$BATTERY" adapter on >>"$LOG" 2>&1 || true
}

# Workstation detection: lid closed + external display connected.
# When detected, override MODE=hold50 to MODE=cap so macOS sees AC power
# (otherwise CHIE=08 force-discharge makes pmset think there's no adapter,
# and clamshell-power-guard's caffeinate never spawns).
#
# Detection chain (try each until one confirms external display):
#   1. system_profiler Resolution: count > 1   (fast ~1s, but in clamshell
#      mode macOS may list only the active external display, returning 1)
#   2. ioreg Online: Yes count > 1             (ioreg sees all hardware,
#      including OFF built-in display)
#   3. ioreg AppleDisplay non-built-in product (last-resort: any non-built-in
#      ProductName entry indicates external display hardware)
#
# DEBUG_LOG=1: write every detection result to hold-loop.log so we can
# diagnose why is_workstation returned FALSE after the fact (chicken-and-egg
# problem: when detection fails, monitor is dark so we can't run live cmds).
is_workstation() {
    local clamshell disp_count online_count ext_disp
    clamshell=$(ioreg -r -k AppleClamshellState -d 1 2>/dev/null | grep -m1 AppleClamshellState | grep -c "Yes")
    [ "$clamshell" -eq 0 ] && return 1

    # Method 1: system_profiler Resolution count (works when lid open)
    disp_count=$(system_profiler SPDisplaysDataType 2>/dev/null | grep -c "Resolution:")
    [ "$disp_count" -ge 2 ] && return 0

    # Method 2: ioreg Online count (format varies; unreliable, kept for safety)
    online_count=$(ioreg -lw0 2>/dev/null | grep -c '"Online" = Yes')
    [ "$online_count" -ge 2 ] && return 0

    # Method 3: ioreg non-built-in ProductName (works in clamshell mode where
    # system_profiler only lists 1 active display; ioreg sees all hardware)
    ext_disp=$(ioreg -lw0 2>/dev/null | grep -E '"ProductName"' | grep -vc 'Color LCD\|Built-in')
    [ "$ext_disp" -ge 1 ] && return 0

    return 1
}

# Compute effective mode. If workstation detected AND MODE=hold50,
# override to cap. Otherwise use scheduled MODE as-is.
# CRITICAL: when transitioning hold50 → workstation, also call set_charge
# to release CHIE=00 (hold50 set CHIE=08 via set_discharge; cap mode
# itself never touches CHIE, so without explicit reset CHIE stays at 08
# and pmset continues to see "Battery Power").
prev_workstation=0
compute_effective_mode() {
    EFFECTIVE_MODE="$MODE"
    if is_workstation; then
        if [ "$MODE" = "hold50" ]; then
            EFFECTIVE_MODE="cap"
        fi
        # On workstation entry, release any external force-discharge (CHIE=08)
        # as a safety net. With the simplified hold-loop (no CHIE manipulation
        # in set_discharge), this is only needed if some external tool set
        # CHIE=08; normal hold-loop never sets it.
        if [ "$prev_workstation" -eq 0 ]; then
            log "WORKSTATION detected (clamshell + external display, scheduled MODE=$MODE) — releasing CHIE safety net"
            release_force_discharge
        fi
        prev_workstation=1
    else
        if [ "$prev_workstation" -eq 1 ]; then
            log "WORKSTATION cleared — reverting to scheduled MODE=$MODE"
        fi
        prev_workstation=0
    fi
}

# Initial SMC baseline for the mode. Called once at startup.
apply_initial() {
    compute_effective_mode
    case "$EFFECTIVE_MODE" in
        cap)
            pct=$(get_percent)
            if [[ "$pct" -ge "$UPPER_BOUND" ]]; then
                stop_charging
            else
                allow_charging
            fi
            ;;
        hold50)
            pct=$(get_percent)
            if [[ "$pct" -ge "$LOWER_BOUND" ]]; then
                set_discharge
            else
                set_charge
            fi
            ;;
        *)
            log "ERROR: unknown EFFECTIVE_MODE=$EFFECTIVE_MODE"
            exit 2
            ;;
    esac
}

log "hold-loop starting: MODE=$MODE UPPER=$UPPER_BOUND LOWER=$LOWER_BOUND CHARGE_BACK_TO=$CHARGE_BACK_TO POLL=${POLL}s"
# Only write state file if it doesn't already exist (apply.sh writes it
# first with the sourceable shell format; we just touch a marker file
# under a sibling name so sync.sh can detect "hold-loop running").
apply_initial
[[ -f "$STATE_FILE" ]] || echo "HOLD_LOOP_ACTIVE=1" > "$STATE_FILE"

# State machine differs per mode. For cap mode, single state per-direction;
# for hold50 mode, two states with hysteresis.
state=""
while true; do
    compute_effective_mode
    pct=$(get_percent)
    if [[ -z "$pct" || ! "$pct" =~ ^[0-9]+$ ]]; then
        log "WARN: could not read battery %, retrying"
        sleep "$POLL"
        continue
    fi

    case "$EFFECTIVE_MODE" in
        cap)
            # cap mode: stop when >= UPPER, allow when < UPPER
            if [[ "$state" == "stopped" && "$pct" -lt "$UPPER_BOUND" ]]; then
                allow_charging
                state="allowed"
            elif [[ "$state" != "stopped" && "$pct" -ge "$UPPER_BOUND" ]]; then
                stop_charging
                state="stopped"
            fi
            ;;
        hold50)
            case "$state" in
                "")
                    if [[ "$pct" -ge "$LOWER_BOUND" ]]; then
                        set_discharge
                        state=discharge
                    else
                        set_charge
                        state=charge
                    fi
                    log "Initial state: pct=$pct -> $state"
                    ;;
                discharge)
                    if [[ "$pct" -lt "$LOWER_BOUND" ]]; then
                        set_charge
                        state=charge
                    fi
                    ;;
                charge)
                    if [[ "$pct" -ge "$CHARGE_BACK_TO" ]]; then
                        set_discharge
                        state=discharge
                    fi
                    ;;
            esac
            ;;
    esac

    log "pct=$pct mode=$EFFECTIVE_MODE (scheduled=$MODE) state=$state"
    sleep "$POLL"
done