#!/bin/bash
# ~/.battery-schedule/bin/sync.sh
# Self-healing sync: figure out which mode *should* be active right now
# and re-apply if it differs from what is actually set.
#
# Why this exists: macOS launchd does NOT fire StartCalendarInterval
# events while the MacBook is asleep. After waking up, this loop catches
# any missed transitions.
#
# Schedule (24h, China local TZ):
#   06:30 - 08:59  day
#   09:00 - 11:59  day
#   12:00 - 14:59  noon   (lunch, 2hr+)
#   15:00 - 17:59  day
#   18:00 - 06:29  noon   (night)
#
# MagSafe / USB-C: irrelevant — handled identically at SMC layer.

set -euo pipefail

LOG="$HOME/.battery-schedule/logs/sync.log"
APPLY="$HOME/.battery-schedule/bin/apply.sh"
STATE_FILE="$HOME/.battery-schedule/state"

log() { printf '%s [%d] %s\n' "$(date '+%F %T')" "$$" "$*" | tee -a "$LOG"; }

if [[ ! -x "$APPLY" ]]; then
    log "ERROR: apply.sh not found at $APPLY"
    exit 3
fi

# Hour → desired mode.
HOUR=$(date '+%H')
case "$HOUR" in
    06|07|08|09|10|11|15|16|17) DESIRED=day ;;
    *)                          DESIRED=noon ;;  # 12-14 lunch, 18-05 night
esac

# Actual mode: read MODE= line from state file. The file is written by
# apply.sh and contains `MODE=cap` (day) or `MODE=hold50` (noon), plus
# `HOLD_LOOP_ACTIVE=1` so we know apply.sh wrote it intentionally.
ACTUAL="none"
if [[ -f "$STATE_FILE" ]] && grep -q "^HOLD_LOOP_ACTIVE=1" "$STATE_FILE" 2>/dev/null; then
    mode=$(grep "^MODE=" "$STATE_FILE" | head -1 | cut -d= -f2)
    case "$mode" in
        cap)   ACTUAL=day ;;
        hold50) ACTUAL=noon ;;
        *)     ACTUAL="other:$mode" ;;
    esac
fi

if [[ "$ACTUAL" == "other:"* ]]; then
    log "Desired=$DESIRED actual=$ACTUAL (unrecognised MODE); applying to be safe"
    "$APPLY" "$DESIRED"
elif [[ "$DESIRED" != "$ACTUAL" ]]; then
    log "Mode drift detected: desired=$DESIRED actual=$ACTUAL — reapplying"
    "$APPLY" "$DESIRED"
else
    log "Mode in sync: $DESIRED (hour=$HOUR)"
fi

exit 0