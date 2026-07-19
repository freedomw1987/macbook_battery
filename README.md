# MacBook Power Tools

Two subsystems for MacBook Air M3 (macOS 26.6, Apple Silicon):

1. **Charging Schedule** — auto-switches charging behaviour by time of day
   to extend battery lifespan.
2. **Power-Guard** — keeps the external USB-C monitor alive in clamshell
   mode while plugged in, and warns you before the session freezes when
   you take the laptop out and close the lid on battery.

Both share the same wrapper (`~/.battery-schedule/`) and `install.sh`.

## Schedule

| Time  | Mode     | Behaviour                              | Implementation                       |
|-------|----------|----------------------------------------|--------------------------------------|
| 06:30 | day      | upper limit 80%                        | `hold-loop` (MODE=cap)                |
| 09:00 | day      | upper limit 80%                        | `hold-loop` (MODE=cap)                |
| 12:00 | noon     | forced discharge, hold at 50%          | `hold-loop` (MODE=hold50)             |
| 15:00 | day      | upper limit 80%                        | `hold-loop` (MODE=cap)                |
| 18:00 | noon     | forced discharge, hold at 50%          | `hold-loop` (MODE=hold50)             |

**day mode** keeps the battery between 0 and 80%. **noon mode** actively
drains the battery to ~50% even while plugged in (forced discharge) and
then holds there.

## Chargers

MagSafe and USB-C adapters are handled identically: the battery CLI talks
to the SMC charge IC, which does not care which connector is plugged in.

## How it works

The `battery` CLI writes two SMC keys on M3 + macOS 26:

| Key   | Value      | Meaning                |
|-------|------------|------------------------|
| CHTE  | `00 00 00 00` | charging enabled       |
| CHTE  | `01 00 00 00` | charging disabled      |
| CHIE  | `00`       | forced discharge off   |
| CHIE  | `08`       | forced discharge on    |

A custom `hold-loop.sh` daemon manages both keys explicitly. It runs under
launchd with `KeepAlive=true` so macOS restarts it automatically if it
crashes — this is critical because `battery maintain` only manipulates
CHTE and never touches CHIE. We don't want to rely on it.

### Two modes

**`day` mode (`MODE=cap`)** — Cap charging at 80%:

- `pct >= 80` → `CHTE=01` (stop charging)
- `pct < 80`  → `CHTE=00` (allow charging)

**`noon` mode (`MODE=hold50`)** — Force discharge to 50%, then hold:

- `pct >= 50` → `CHTE=01` + `CHIE=08` (force discharge)
- `pct < 50`  → `CHTE=00` + `CHIE=00` (release discharge, allow charging)
- `pct >= 53` → resume discharge (hysteresis prevents flapping)

The launchd plist launches `hold-loop-wrapper.sh`, which reads the state
file written by `apply.sh` to decide which mode to run in.

## Why our own loop instead of `battery maintain` alone?

1. `battery maintain_synchronous` only writes CHTE. CHIE would stay 08
   forever in noon mode, draining the battery past the lower bound.
2. If the maintain daemon crashes (or never starts after reboot), no
   upper limit is enforced — the system happily charges to 100%.

---

## Power-Guard

Solves the **clamshell + battery sleep** problem on MacBook Air with an
external USB-C monitor:

| Scenario | Without Power-Guard | With Power-Guard |
|---|---|---|
| Plugged in + lid closed + external monitor | Screen stays on ✓ | Screen stays on ✓ |
| On battery + lid closed | Session freezes, screen dark, re-login required | Notification warns you **before** you close |
| Plug in (any time) | — | `pmset -c sleep=0 displaysleep=0` auto-reapplied within 30s |
| `pmset -c` drifts after system update | Stays broken until manually fixed | Auto-healed within 30s |

### Components

| Component | What it does |
|---|---|
| `bin/clamshell-power-guard.sh` | Polls every 30s. Two-pronged protection: (a) lid closed + AC → spawn `caffeinate -d -i -s` in background to force no sleep (bypasses MacBook Air clamshell auto-detection, which can fail with USB-C charger); (b) lid closed + battery → fire one notification: *"plug in MagSafe/USB-C to keep session alive"* |
| `bin/pmset-ac-watchdog.sh` | Polls every 30s. When AC plugged in OR `pmset -c sleep` drifts from 0, reapplies the full `pmset -c` settings |
| `bin/setup-power-guard.sh` | CLI for status / verify / install / uninstall |
| `plists/com.user.clamshell-power-guard.plist` | launchd job for the guard |
| `plists/com.user.pmset-ac-watchdog.plist` | launchd job for the watchdog |

### Why `caffeinate` (and why pmset alone isn't enough)

`pmset -c sleep 0` prevents *idle* sleep, but **lid close → sleep** is a
separate hardcoded macOS behavior. Normally, when an external display
is connected, macOS activates "clamshell mode" on lid close and uses
the external display instead of sleeping.

**MacBook Air gotcha**: with a USB-C charger (as opposed to MagSafe),
clamshell mode sometimes doesn't auto-activate, and the laptop sleeps
within seconds of lid close regardless of `pmset -c` settings.

`caffeinate -d -i -s` is the bulletproof workaround:
- `-d` prevent display sleep
- `-i` prevent system idle sleep
- `-s` prevent system sleep (when on AC power)

The guard starts it in background when clamshell + AC, kills it when
lid opens or unplugs. PID is tracked in
`/tmp/.clamshell-power-guard-caffeinate.pid` so uninstall can clean up.

### `pmset -c` settings applied

```bash
sudo pmset -c sleep 0 displaysleep 0 powernap 1 halfdim 0 \
              acwake 1 proximitywake 1 tcpkeepalive 1
```

These mean: when on AC power, **never sleep, never dim the external
display**, keep background tasks running, wake on plug-in, wake on
approach. Battery mode is untouched — closing the lid out and about
still sleeps the laptop as expected.

### Sudoers

The watchdog needs `sudo pmset` to run in the background (no TTY for a
password prompt). `install.sh` writes a **scoped** NOPASSWD entry:

```
/etc/sudoers.d/pmset-ac-watchdog
davidchu ALL=(ALL) NOPASSWD: /usr/bin/pmset
```

This grants passwordless sudo for `pmset` only — no other commands, no
privilege escalation, no file access. The `/usr/bin/pmset` binary only
modifies sleep/display settings.

---

## Layout

Source of truth lives in this project folder. A thin wrapper under
`~/.battery-schedule/` exposes the scripts via symlink and holds logs.

```
~/Sites/localhost/macbook_battery/        # this project
├── bin/
│   ├── apply.sh                     # apply mode (day | noon | reset)
│   ├── hold-loop.sh                 # self-written SMC controller (reads state file itself)
│   ├── sync.sh                      # 5-minute self-heal after wake
│   ├── clamshell-power-guard.sh     # warn on clamshell + battery
│   ├── pmset-ac-watchdog.sh         # auto-reapply pmset -c on AC
│   └── setup-power-guard.sh         # CLI: status | verify | install | uninstall
├── plists/
│   ├── com.user.battery-schedule.day.0630.plist
│   ├── com.user.battery-schedule.day.0900.plist
│   ├── com.user.battery-schedule.day.1500.plist
│   ├── com.user.battery-schedule.noon.1200.plist
│   ├── com.user.battery-schedule.noon.1800.plist
│   ├── com.user.battery-schedule.hold-loop.plist
│   ├── com.user.battery-schedule.sync.plist
│   ├── com.user.clamshell-power-guard.plist
│   └── com.user.pmset-ac-watchdog.plist
├── install.sh
├── uninstall.sh
└── README.md

~/.battery-schedule/                       # generated by install.sh
├── bin  -> /Users/davidchu/Sites/localhost/macbook_battery/bin   (symlink)
├── state                                  # sourceable: MODE=cap|hold50
└── logs/
    ├── apply.log
    ├── sync.log
    ├── sync.plist.log
    ├── hold-loop.log
    ├── hold-loop.plist.log
    ├── schedule.*.log
    ├── clamshell-power-guard.log        # 拔電合蓋事件
    ├── clamshell-power-guard.plist.log  # launchd stdout/stderr
    ├── pmset-ac-watchdog.log            # 插電瞬間 + drift 修復事件
    └── pmset-ac-watchdog.plist.log      # launchd stdout/stderr

~/Library/LaunchAgents/                    # installed (copied) plists
├── com.user.battery-schedule.day.0630.plist
├── com.user.battery-schedule.day.0900.plist
├── com.user.battery-schedule.day.1500.plist
├── com.user.battery-schedule.noon.1200.plist
├── com.user.battery-schedule.noon.1800.plist
├── com.user.battery-schedule.sync.plist
├── com.user.clamshell-power-guard.plist
└── com.user.pmset-ac-watchdog.plist

~/bin/                                     # user-facing symlinks (optional)
├── clamshell-power-guard.sh  -> ~/.battery-schedule/bin/clamshell-power-guard.sh
├── pmset-ac-watchdog.sh      -> ~/.battery-schedule/bin/pmset-ac-watchdog.sh
└── setup-power-guard.sh      -> ~/.battery-schedule/bin/setup-power-guard.sh
```

Editing a script in `bin/` takes effect immediately for all callers because
the wrapper symlinks to the project copy. Re-running `./install.sh` after
changing a plist reinstalls the launchd jobs.

## Install

```bash
cd ~/Sites/localhost/macbook_battery
./install.sh
```

## Uninstall

```bash
cd ~/Sites/localhost/macbook_battery
./uninstall.sh
```

This unregisters launchd jobs, removes `~/.battery-schedule/`, and resets
the battery CLI to default charging. Project files are left untouched.

## Manual control

```bash
# Charging schedule
~/.battery-schedule/bin/apply.sh day     # upper limit 80
~/.battery-schedule/bin/apply.sh noon    # force discharge, hold at 50
~/.battery-schedule/bin/apply.sh reset   # stop maintain, back to default
/usr/local/bin/battery status            # show current maintain state
tail -f ~/.battery-schedule/logs/sync.log

# Power-guard
~/bin/setup-power-guard.sh status        # show current state
~/bin/setup-power-guard.sh verify        # run all checks
tail -f ~/.battery-schedule/logs/pmset-ac-watchdog.log
tail -f ~/.battery-schedule/logs/clamshell-power-guard.log
```

## Why a sync daemon?

macOS `launchd` does **not** fire `StartCalendarInterval` jobs while the
MacBook is asleep. To survive overnight sleep + morning wake, a 5-minute
sync loop (`sync.plist`) detects the correct mode for the current hour
and reapplies it if it drifted.

## Logs

- `~/.battery-schedule/logs/apply.log` — every mode switch
- `~/.battery-schedule/logs/hold-loop.log` — every % poll (cap/hold50 actions)
- `~/.battery-schedule/logs/sync.log` — every 5-minute check
- `~/.battery-schedule/logs/schedule.*.log` — per-plist output
- `~/.battery-schedule/logs/hold-loop.plist.log` — hold-loop launchd output
- `~/.battery-schedule/logs/sync.plist.log` — sync launchd output
- `~/.battery-schedule/logs/clamshell-power-guard.log` — every clamshell + battery event
- `~/.battery-schedule/logs/clamshell-power-guard.plist.log` — launchd stdout/stderr
- `~/.battery-schedule/logs/pmset-ac-watchdog.log` — every plug-in event + drift fix
- `~/.battery-schedule/logs/pmset-ac-watchdog.plist.log` — launchd stdout/stderr

---

## GUI (planned — Tauri app)

A native macOS GUI for managing both subsystems without touching the CLI.
**Status: designed, not yet implemented** (Tauri scaffold + Rust toolchain
not yet installed on this machine).

### What it will do

| Tab / panel | Capability |
|---|---|
| **Status card** | Live read of battery %, charging/discharging, current mode (auto-refresh every 5s) |
| **Quick mode buttons** | One-click `day` / `noon` / `reset` — invokes `apply.sh` underneath |
| **Schedule editor** | 5 time-slot rows; each row has `<input type="time">` + day/noon dropdown. Save → regenerates 5 plists + reloads launchd |
| **Power-Guard panel** | Shows pmset -c settings (with drift detection); Install / Uninstall / Reapply buttons |

### Architecture

```
+-----------------------------+
|  React + Vite frontend      |  TypeScript, no extra UI lib
|  (~/Sites/.../ui/src/)      |
+--------------+--------------+
               | Tauri IPC (invoke)
+-----------------------------+
|  Rust backend               |  Thin wrapper over CLI:
|  (~/Sites/.../ui/src-tauri) |  Command::new("bash").arg(apply.sh ...)
+-----------------------------+
               |
               v
   ~/Sites/localhost/macbook_battery/bin/  (existing scripts)
```

Each Rust Tauri command is a thin shell wrapper around an existing script:

| Rust command | Calls |
|---|---|
| `get_status()` | `pmset -g batt` + `battery status` + read state file |
| `set_mode(mode)` | `apply.sh <mode>` |
| `get_schedule()` | parses 5 plists (label + StartCalendarInterval) |
| `set_schedule(entries)` | regenerates 5 plists + `launchctl bootout/bootstrap` |
| `power_guard_status()` | `setup-power-guard.sh status` + `pmset -g` |
| `power_guard_install/uninstall()` | `setup-power-guard.sh install/uninstall` |
| `power_guard_reapply()` | `sudo pmset -c sleep 0 ...` (via scoped visudo rule) |

### Why Tauri (not Electron / native Swift)

- Smaller binary than Electron (no bundled Chromium)
- Rust backend can `Command::new("bash")` directly — no IPC bridging
- Native macOS `.app` bundle via `cargo tauri build`
- Reuses all existing bash scripts; UI is a thin layer

### Prerequisites not yet met

- Rust toolchain (`rustup` + `cargo` + `cargo-tauri` CLI) — needs install
- Node.js + npm ✅ already installed
- Xcode CLT ✅ already installed

### Implementation plan

See `~/.claude/plans/typed-tickling-moore.md` for the full plan including
file list, IPC contract, and verification steps.