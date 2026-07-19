#!/bin/bash
set -u
LOG="$HOME/.battery-schedule/logs/pmset-ac-watchdog.log"
mkdir -p "$(dirname "$LOG")"
LAST_POWER_FILE="/tmp/.pmset-ac-watchdog-lastpower"
PMSET_CMD="/usr/bin/pmset"
EXPECTED_AC_SLEEP=0
PMSET_FLAGS="sleep 0 displaysleep 0 powernap 1 halfdim 0 acwake 1 proximitywake 1 tcpkeepalive 1"
CURRENT_POWER=$(pmset -g ps 2>/dev/null | head -1)
CURRENT_AC_SLEEP=$(pmset -g custom 2>/dev/null | awk '/^AC Power:/{flag=1; next} flag && /^ sleep/{print $2; exit}')
LAST_POWER=""
[ -f "$LAST_POWER_FILE" ] && LAST_POWER=$(cat "$LAST_POWER_FILE")
echo "$CURRENT_POWER" > "$LAST_POWER_FILE"
if [[ "$CURRENT_POWER" != *"AC Power"* ]]; then exit 0; fi
JUST_PLUGGED=0; DRIFTED=0
if [[ "$LAST_POWER" == *"Battery"* ]] || [ -z "$LAST_POWER" ]; then JUST_PLUGGED=1; fi
if [ "$CURRENT_AC_SLEEP" != "$EXPECTED_AC_SLEEP" ]; then DRIFTED=1; fi
if [ "$JUST_PLUGGED" = "1" ] || [ "$DRIFTED" = "1" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') TRIGGER just_plugged=$JUST_PLUGGED drifted=$DRIFTED sleep_was=$CURRENT_AC_SLEEP" >> "$LOG"
    # shellcheck disable=SC2086
    if sudo -n "$PMSET_CMD" -c $PMSET_FLAGS >> "$LOG" 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') OK" >> "$LOG"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') FAIL" >> "$LOG"
    fi
fi
