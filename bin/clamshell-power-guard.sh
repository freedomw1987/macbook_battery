#!/bin/bash
# clamshell-power-guard.sh
#
# Two-pronged protection for the USB-C monitor + clamshell workflow:
#
#   Lid closed + AC power        →  start `caffeinate -d -i -s` in background
#                                   (forces no sleep; bypasses macOS clamshell
#                                   auto-detection which can fail on MacBook
#                                   Air with USB-C charger)
#   Lid closed + battery power   →  fire one notification warning the user
#                                   (so they plug in BEFORE the session freezes)
#   Lid opened                   →  kill caffeinate + clear warning flag
#
# Polled every 30s by launchd (com.user.clamshell-power-guard.plist).

set -u

LOG="$HOME/.battery-schedule/logs/clamshell-power-guard.log"
WARNED_FLAG="/tmp/.clamshell-power-guard-warned"
CAFFEINATE_PID_FILE="/tmp/.clamshell-power-guard-caffeinate.pid"
mkdir -p "$(dirname "$LOG")"

CLAMSHELL=$(ioreg -r -k AppleClamshellState -d 1 2>/dev/null | grep -m1 AppleClamshellState | grep -c "Yes")
POWER=$(pmset -g ps 2>/dev/null | head -1)

kill_caffeinate() {
    if [ -f "$CAFFEINATE_PID_FILE" ]; then
        local pid
        pid=$(cat "$CAFFEINATE_PID_FILE" 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            echo "$(date '+%Y-%m-%d %H:%M:%S') Stopped caffeinate (pid=$pid)" >> "$LOG"
        fi
        rm -f "$CAFFEINATE_PID_FILE"
    fi
}

# Case 1: lid open → cleanup everything
if [ "$CLAMSHELL" -eq 0 ]; then
    kill_caffeinate
    rm -f "$WARNED_FLAG"
    exit 0
fi

# Case 2: lid closed + AC → ensure caffeinate is running
if [[ "$POWER" == *"AC Power"* ]]; then
    if [ ! -f "$CAFFEINATE_PID_FILE" ]; then
        nohup caffeinate -d -i -s >/dev/null 2>&1 &
        echo $! > "$CAFFEINATE_PID_FILE"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Started caffeinate (pid=$!) — clamshell + AC" >> "$LOG"
    fi
    rm -f "$WARNED_FLAG"
    exit 0
fi

# Case 3: lid closed + battery → kill caffeinate, fire one warning
kill_caffeinate
if [ ! -f "$WARNED_FLAG" ]; then
    touch "$WARNED_FLAG"
    echo "$(date '+%Y-%m-%d %H:%M:%S') WARNING: clamshell + battery" >> "$LOG"
    osascript -e 'display notification "外接螢幕即將 sleep。插入 MagSafe 或 USB-C 充電器以保持 session 活躍。" with title "⚠️ 電池 + 合蓋" sound name "Basso"' >> "$LOG" 2>&1
fi