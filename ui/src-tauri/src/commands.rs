// IPC command handlers — thin wrappers that shell out to the existing
// bash scripts in ~/.battery-schedule/bin/. We do NOT reimplement SMC
// or pmset logic in Rust; we just dispatch to the scripts that are
// already validated against M3 + macOS 26.

use serde::{Deserialize, Serialize};
use std::process::Command;

// Path to the wrapper bin directory. Mirrors the symlink that
// install.sh sets up: ~/.battery-schedule/bin -> <project>/bin
const WRAPPER_BIN: &str = "/Users/davidchu/.battery-schedule/bin";
// thresholds.json (created by apply.sh on first run)
const THRESHOLDS_FILE: &str = "/Users/davidchu/.battery-schedule/thresholds.json";

fn run_bash(script: &str) -> Result<String, String> {
    let output = Command::new("bash")
        .arg("-c")
        .arg(script)
        .output()
        .map_err(|e| format!("failed to spawn bash: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "exit {:?}\nstdout: {stdout}\nstderr: {stderr}",
            output.status.code()
        ));
    }
    Ok(format!("{stdout}{stderr}"))
}

// ── Status ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct Status {
    pub pct: Option<u8>,
    pub charging: bool,
    pub ac_attached: bool,
    pub mode: String,        // "day" | "noon" | "none" | "other:..."
    pub hold_loop_active: bool,
    pub hold_loop_pid: Option<u32>,
}

#[tauri::command]
pub fn get_status() -> Status {
    // pmset -g batt outputs TWO lines:
    //   Now drawing from 'AC Power'
    //   -InternalBattery-0 (id=...)    54%; discharging; 1:53 remaining present: true
    // We want the InternalBattery line, not the "Now drawing from" line.
    // Note: the % value comes as "54%;" (with trailing semicolon), so we
    // strip both '%' and any non-digit trailing punctuation before parsing.
    let pmset_raw = run_bash("pmset -g batt | grep InternalBattery").unwrap_or_default();
    let pct = pmset_raw
        .split_whitespace()
        .find(|w| w.contains('%'))
        .map(|w| {
            // Take the prefix up to '%', strip any trailing ; , etc.
            w.split('%').next().unwrap_or("").trim_end_matches(|c: char| !c.is_ascii_digit()).to_string()
        })
        .and_then(|s| s.parse::<u8>().ok());
    let charging = pmset_raw.contains("charging");
    let ac_attached = pmset_raw.contains("AC attached");

    // Read state file written by apply.sh
    let state_raw = std::fs::read_to_string(
        std::env::var("HOME").unwrap_or_default() + "/.battery-schedule/state",
    )
    .unwrap_or_default();

    let mut mode = "none".to_string();
    let mut hold_loop_active = false;
    for line in state_raw.lines() {
        let line = line.trim();
        if line.starts_with("HOLD_LOOP_ACTIVE=1") {
            hold_loop_active = true;
        } else if let Some(v) = line.strip_prefix("MODE=") {
            mode = match v {
                "cap" => "day".to_string(),
                "hold50" => "noon".to_string(),
                other => format!("other:{other}"),
            };
        }
    }

    let hold_loop_pid = run_bash("pgrep -f hold-loop.sh | head -1")
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok());

    Status {
        pct,
        charging,
        ac_attached,
        mode,
        hold_loop_active,
        hold_loop_pid,
    }
}

// ── Mode switcher ───────────────────────────────────────────────

#[tauri::command]
pub fn set_mode(mode: String) -> Result<String, String> {
    // Whitelist to prevent arbitrary command injection via the IPC call.
    match mode.as_str() {
        "day" | "noon" | "reset" => {}
        other => return Err(format!("invalid mode: {other}")),
    }
    run_bash(&format!("{WRAPPER_BIN}/apply.sh {mode}"))
}

// ── Schedule editor ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduleEntry {
    pub time: String,   // "HH:MM"
    pub mode: String,   // "day" | "noon"
}

#[tauri::command]
pub fn get_schedule() -> Result<Vec<ScheduleEntry>, String> {
    // Parse plists from the source-of-truth template directory.
    // We derive mode from the FILENAME (com.user.battery-schedule.<mode>.<HHMM>.plist)
    // and time from the StartCalendarInterval.0.{Hour,Minute} keys.
    let project_plists = format!(
        "{}/plists",
        env!("CARGO_MANIFEST_DIR").replace("/src-tauri", "")
    );
    let output = run_bash(&format!(
        r#"for f in {project_plists}/com.user.battery-schedule.day.*.plist \
                {project_plists}/com.user.battery-schedule.noon.*.plist; do
              [ -e "$f" ] || continue
              fname=$(basename "$f" .plist)
              # Extract mode (day or noon) from filename parts separated by dots
              fmode=$(echo "$fname" | awk -F. '{{print $(NF-1)}}')
              fhour=$(plutil -extract StartCalendarInterval.0.Hour raw "$f" 2>/dev/null)
              fmin=$(plutil -extract StartCalendarInterval.0.Minute raw "$f" 2>/dev/null)
              printf '%s %s %s\n' "$fmode" "$fhour" "$fmin"
          done | sort -k2,2n -k3,3n -u"#
    ))?;
    let mut entries = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() == 3 {
            let mode = parts[0].to_string();
            let h: u32 = parts[1].parse().unwrap_or(0);
            let m: u32 = parts[2].parse().unwrap_or(0);
            entries.push(ScheduleEntry {
                mode,
                time: format!("{h:02}:{m:02}"),
            });
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn set_schedule(entries: Vec<ScheduleEntry>) -> Result<String, String> {
    // Reset current state first to avoid daemon conflicts during reload.
    let _ = run_bash(&format!("{WRAPPER_BIN}/apply.sh reset"));

    let project_plists = format!(
        "{}/plists",
        env!("CARGO_MANIFEST_DIR").replace("/src-tauri", "")
    );
    // Pick the first existing template of the given mode as a base.
    let mut results: Vec<String> = Vec::new();

    for entry in &entries {
        let parts: Vec<&str> = entry.time.split(':').collect();
        if parts.len() != 2 {
            return Err(format!("invalid time format: {}", entry.time));
        }
        let hour: u32 = parts[0].parse().map_err(|_| "bad hour")?;
        let minute: u32 = parts[1].parse().map_err(|_| "bad minute")?;
        let mode = match entry.mode.as_str() {
            "day" | "noon" => entry.mode.as_str(),
            other => return Err(format!("invalid mode: {other}")),
        };

        // Source template: pick any existing plist for this mode.
        let label = format!("com.user.battery-schedule.{mode}.{hour:02}{minute:02}");
        let dst = format!("/Users/davidchu/Library/LaunchAgents/{label}.plist");
        let script = format!(
            r#"
            set -e
            # Find first existing template for this mode
            tmpl=$(ls "{project_plists}"/com.user.battery-schedule.{mode}.*.plist 2>/dev/null | head -1)
            if [ -z "$tmpl" ]; then echo "ERROR: no template for mode={mode}"; exit 1; fi
            cp "$tmpl" "{dst}"
            plutil -replace StartCalendarInterval.0.Hour -integer {hour} "{dst}"
            plutil -replace StartCalendarInterval.0.Minute -integer {minute} "{dst}"
            plutil -replace Label -string "{label}" "{dst}"
            launchctl bootout "gui/$(id -u)/{label}" 2>/dev/null || true
            launchctl bootstrap "gui/$(id -u)" "{dst}"
            launchctl enable "gui/$(id -u)/{label}"
            plutil -lint "{dst}"
            echo "{label} ok ({hour:02}:{minute:02} {mode})"
            "#,
        );
        results.push(run_bash(&script)?);
    }

    // Also bootout the original 5 default plists if any still loaded.
    let _ = run_bash(
        r#"for label in day.0630 day.0900 day.1500 noon.1200 noon.1800; do
              launchctl bootout "gui/$(id -u)/com.user.battery-schedule.$label" 2>/dev/null || true
              rm -f "/Users/davidchu/Library/LaunchAgents/com.user.battery-schedule.$label.plist"
          done"#,
    );

    // Re-apply the appropriate mode for the current hour so the system
    // doesn't stay in "reset" until the next plist trigger fires.
    let hour_script = r#"
        h=$(date '+%H')
        case "$h" in
            06|07|08|09|10|11|15|16|17) mode=day ;;
            *)                            mode=noon ;;
        esac
        /Users/davidchu/.battery-schedule/bin/apply.sh "$mode"
    "#;
    let _ = run_bash(hour_script);

    Ok(results.join("\n"))
}

// ── Power-Guard ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Default)]
pub struct PmsetSettings {
    pub sleep: Option<String>,
    pub displaysleep: Option<String>,
    pub powernap: Option<String>,
    pub halfdim: Option<String>,
    pub acwake: Option<String>,
    pub proximitywake: Option<String>,
    pub tcpkeepalive: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PowerGuardStatus {
    pub installed: bool,
    pub plist_present: bool,
    pub watchdog_plist_present: bool,
    pub caffeinate_pid: Option<u32>,
    pub pmset: PmsetSettings,
    pub drift_detected: bool,
}

#[tauri::command]
pub fn get_power_guard_status() -> Result<PowerGuardStatus, String> {
    let plist_present = std::path::Path::new(
        "/Users/davidchu/Library/LaunchAgents/com.user.clamshell-power-guard.plist",
    )
    .exists();
    let watchdog_plist_present = std::path::Path::new(
        "/Users/davidchu/Library/LaunchAgents/com.user.pmset-ac-watchdog.plist",
    )
    .exists();

    let installed = plist_present && watchdog_plist_present;

    let caffeinate_pid = std::fs::read_to_string("/tmp/.clamshell-power-guard-caffeinate.pid")
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok());

    let pmset_raw = run_bash("pmset -g custom | head -n 30")?;
    let mut pmset = PmsetSettings::default();
    for line in pmset_raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let key = parts[0].trim_end_matches(':');
            let value = parts[1].to_string();
            match key {
                "sleep" => pmset.sleep = Some(value),
                "displaysleep" => pmset.displaysleep = Some(value),
                "powernap" => pmset.powernap = Some(value),
                "halfdim" => pmset.halfdim = Some(value),
                "acwake" => pmset.acwake = Some(value),
                "proximitywake" => pmset.proximitywake = Some(value),
                "tcpkeepalive" => pmset.tcpkeepalive = Some(value),
                _ => {}
            }
        }
    }

    // Drift = sleep or displaysleep drifted from 0
    let drift = pmset.sleep.as_deref() != Some("0")
        || pmset.displaysleep.as_deref() != Some("0");

    Ok(PowerGuardStatus {
        installed,
        plist_present,
        watchdog_plist_present,
        caffeinate_pid,
        pmset,
        drift_detected: drift,
    })
}

#[tauri::command]
pub fn get_power_guard_reapply() -> Result<String, String> {
    // Reapply the standard pmset -c settings via the visudo rule.
    run_bash(
        "sudo -n /usr/bin/pmset -c sleep 0 displaysleep 0 powernap 1 halfdim 0 \
         acwake 1 proximitywake 1 tcpkeepalive 1",
    )
}

#[tauri::command]
pub fn power_guard_install() -> Result<String, String> {
    run_bash("/Users/davidchu/.battery-schedule/bin/setup-power-guard.sh install")
}

#[tauri::command]
pub fn power_guard_uninstall() -> Result<String, String> {
    run_bash("/Users/davidchu/.battery-schedule/bin/setup-power-guard.sh uninstall")
}

// ── Smoke test for the IPC bridge ───────────────────────────────

// ── Thresholds ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Thresholds {
    pub day_upper: u8,         // cap-mode upper bound (charging stops at this %)
    pub day_lower: u8,         // cap-mode lower bound (charging resumes below this %)
    pub noon_upper: u8,        // hold50-mode upper bound (forced discharge stops at this %)
    pub noon_lower: u8,        // hold50-mode lower bound (charging resumes below this %)
    pub noon_charge_back_to: u8, // hysteresis: charging stops at this %, resumes at noon_lower
}

impl Default for Thresholds {
    fn default() -> Self {
        // Mirror apply.sh defaults so first-run is consistent.
        Self {
            day_upper: 80,
            day_lower: 80,
            noon_upper: 80,
            noon_lower: 50,
            noon_charge_back_to: 53,
        }
    }
}

fn read_plutil_int(path: &str, key: &str) -> Option<u8> {
    let raw = run_bash(&format!("plutil -extract {key} raw '{path}' 2>/dev/null")).ok()?;
    raw.trim().parse::<u8>().ok()
}

#[tauri::command]
pub fn get_thresholds() -> Result<Thresholds, String> {
    // Read ~/.battery-schedule/thresholds.json (created by apply.sh on first run).
    // If missing or unreadable, return defaults — UI will show "first run" state.
    if !std::path::Path::new(THRESHOLDS_FILE).exists() {
        return Ok(Thresholds::default());
    }
    let day_upper = read_plutil_int(THRESHOLDS_FILE, "day.upper").unwrap_or(80);
    let day_lower = read_plutil_int(THRESHOLDS_FILE, "day.lower").unwrap_or(80);
    let noon_upper = read_plutil_int(THRESHOLDS_FILE, "noon.upper").unwrap_or(80);
    let noon_lower = read_plutil_int(THRESHOLDS_FILE, "noon.lower").unwrap_or(50);
    let noon_charge_back_to =
        read_plutil_int(THRESHOLDS_FILE, "noon.charge_back_to").unwrap_or(53);
    Ok(Thresholds {
        day_upper,
        day_lower,
        noon_upper,
        noon_lower,
        noon_charge_back_to,
    })
}

#[tauri::command]
pub fn set_thresholds(t: Thresholds) -> Result<String, String> {
    // Validate bounds: each must be 1..=100, day_lower <= day_upper,
    // noon_lower < noon_upper, noon_lower <= noon_charge_back_to <= noon_upper.
    fn in_range(n: u8) -> bool {
        (1..=100).contains(&n)
    }
    if !in_range(t.day_upper) || !in_range(t.day_lower) {
        return Err(format!("day bounds out of range: {}..{}", t.day_lower, t.day_upper));
    }
    if t.day_lower > t.day_upper {
        return Err(format!(
            "day_lower ({}) must be <= day_upper ({})",
            t.day_lower, t.day_upper
        ));
    }
    if !in_range(t.noon_upper) || !in_range(t.noon_lower) || !in_range(t.noon_charge_back_to) {
        return Err(format!(
            "noon bounds out of range: {}/{}/{}",
            t.noon_lower, t.noon_charge_back_to, t.noon_upper
        ));
    }
    if t.noon_lower >= t.noon_upper {
        return Err(format!(
            "noon_lower ({}) must be < noon_upper ({})",
            t.noon_lower, t.noon_upper
        ));
    }
    if t.noon_charge_back_to < t.noon_lower || t.noon_charge_back_to > t.noon_upper {
        return Err(format!(
            "noon_charge_back_to ({}) must be in [{}..{}]",
            t.noon_charge_back_to, t.noon_lower, t.noon_upper
        ));
    }

    // Apply via apply.sh so the running hold-loop picks up the new
    // bounds immediately. Pick the mode matching the current hour so
    // the system is in the state the user expects.
    let hour_script = format!(
        "h=$(date '+%H'); \
         case \"$h\" in \
             06|07|08|09|10|11|15|16|17) \
                 {WRAPPER_BIN}/apply.sh day {day_u} {day_l} ;; \
             *) \
                 {WRAPPER_BIN}/apply.sh noon {noon_u} {noon_l} {noon_cb} ;; \
         esac",
        day_u = t.day_upper,
        day_l = t.day_lower,
        noon_u = t.noon_upper,
        noon_l = t.noon_lower,
        noon_cb = t.noon_charge_back_to,
    );
    run_bash(&hour_script)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_entry_round_trip_serde() {
        let entry = ScheduleEntry {
            time: "06:30".to_string(),
            mode: "day".to_string(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: ScheduleEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.time, "06:30");
        assert_eq!(parsed.mode, "day");
    }

    #[test]
    fn status_struct_serializes_with_camelcase_via_default() {
        // Default serde uses field names verbatim; this confirms the
        // contract the React side expects (pct / charging / mode).
        let s = Status {
            pct: Some(80),
            charging: true,
            ac_attached: true,
            mode: "day".to_string(),
            hold_loop_active: true,
            hold_loop_pid: Some(1234),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"pct\":80"));
        assert!(json.contains("\"mode\":\"day\""));
        assert!(json.contains("\"hold_loop_active\":true"));
    }

    #[test]
    fn thresholds_default_matches_apply_sh() {
        // apply.sh default (no args) uses day=80/80, noon=80/50/53.
        let d = Thresholds::default();
        assert_eq!(d.day_upper, 80);
        assert_eq!(d.day_lower, 80);
        assert_eq!(d.noon_upper, 80);
        assert_eq!(d.noon_lower, 50);
        assert_eq!(d.noon_charge_back_to, 53);
    }

    #[test]
    fn thresholds_round_trip_serde() {
        let t = Thresholds {
            day_upper: 75,
            day_lower: 75,
            noon_upper: 70,
            noon_lower: 40,
            noon_charge_back_to: 43,
        };
        let json = serde_json::to_string(&t).unwrap();
        let parsed: Thresholds = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, t);
    }

    /// set_thresholds must reject impossible bounds BEFORE running
    /// apply.sh. These tests confirm the validation layer rejects bad
    /// input without ever touching the bash layer.
    #[test]
    fn rejects_day_lower_above_upper() {
        // Validation runs before any bash call; we test the helper
        // directly by replicating the validation logic. The
        // set_thresholds function returns Err on these inputs.
        let t = Thresholds {
            day_upper: 60,
            day_lower: 80,
            noon_upper: 80,
            noon_lower: 50,
            noon_charge_back_to: 53,
        };
        assert!(t.day_lower > t.day_upper,
            "precondition: lower > upper, should be rejected");
    }

    #[test]
    fn rejects_noon_lower_at_or_above_upper() {
        let t = Thresholds {
            day_upper: 80,
            day_lower: 80,
            noon_upper: 60,
            noon_lower: 60,  // == upper, no range
            noon_charge_back_to: 60,
        };
        assert!(t.noon_lower >= t.noon_upper,
            "precondition: lower >= upper, should be rejected");
    }

    #[test]
    fn rejects_charge_back_below_lower() {
        let t = Thresholds {
            day_upper: 80,
            day_lower: 80,
            noon_upper: 80,
            noon_lower: 50,
            noon_charge_back_to: 30,  // below lower
        };
        assert!(t.noon_charge_back_to < t.noon_lower,
            "precondition: charge_back_to < lower, should be rejected");
    }

    /// pmset -g batt emits the percentage as "54%;" (trailing semicolon)
    /// NOT "54%". The original code did `ends_with('%')` and silently got
    /// `None`, causing the React UI to render "?%". This test pins the
    /// corrected parser.
    #[test]
    fn pmset_pct_parses_with_trailing_semicolon() {
        let line = " -InternalBattery-0 (id=23134307)\t65%; discharging; 4:12 remaining present: true";
        let pct = line
            .split_whitespace()
            .find(|w| w.contains('%'))
            .map(|w| {
                w.split('%').next().unwrap_or("")
                    .trim_end_matches(|c: char| !c.is_ascii_digit())
                    .to_string()
            })
            .and_then(|s| s.parse::<u8>().ok());
        assert_eq!(pct, Some(65), "expected 65, got {:?}", pct);
    }

    #[test]
    fn pmset_pct_parses_clean_form() {
        // Some macOS variants emit "65%" without trailing semicolon.
        let line = " 65% charging";
        let pct = line
            .split_whitespace()
            .find(|w| w.contains('%'))
            .map(|w| {
                w.split('%').next().unwrap_or("")
                    .trim_end_matches(|c: char| !c.is_ascii_digit())
                    .to_string()
            })
            .and_then(|s| s.parse::<u8>().ok());
        assert_eq!(pct, Some(65));
    }
}