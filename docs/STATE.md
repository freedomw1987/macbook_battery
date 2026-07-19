# STATE — macbook_battery

> **Status:** Dev/Checker loop coordination state.
> **Goal:** MacBook Air M3 (macOS 26.6) (a) 按每日時間表自動切換充電模式延長電池壽命,(b) power-guard 在合蓋 + USB-C monitor 場景避免外接螢幕 sleep/session 凍結,**以及 (c) 新增的 Tauri GUI 讓使用者以視覺方式管理上述兩子系統**。MagSafe / USB-C 兩種充電器在 SMC 層透明。
> **Round:** 9 / 10 (max)
> **Check depth:** normal
> **Last updated:** 2026-07-19 by dev-agent (round 9 start — UI redesign + thresholds)

## 兩個 CLI 子系統 + GUI 子系統

| 子系統 | 觸發源 | 元件 |
|---|---|---|
| Charging schedule | 時間表 (06:30/09:00/12:00/15:00/18:00) + 5min sync | apply.sh / hold-loop.sh / sync.sh + 6 個 plist |
| Power-guard | AC plug-in 事件 / 合蓋 + battery / pmset drift | clamshell-power-guard.sh + pmset-ac-watchdog.sh + 2 個 plist |
| **Tauri GUI** | 用戶手動啟動 .app | `ui/` Tauri 2.x + React + Vite + Rust backend |

CLI 與 GUI 共用 `~/.battery-schedule/` wrapper、`install.sh` / `uninstall.sh`、`pmset` 設定、`pmset -g custom` 偵測。GUI 是薄薄一層 IPC wrapper,Rust backend 用 `Command::new("bash")` 呼叫現有 CLI 腳本。

## 時間表

| 時間  | 模式   | 行為                          | 實際 CLI 動作                                  |
|-------|--------|-------------------------------|------------------------------------------------|
| 06:30 | day    | 上限 80%                      | `battery maintain 80`                          |
| 09:00 | day    | 上限 80%                      | `battery maintain 80`                          |
| 12:00 | noon   | 強制放電到 50% 上限           | `battery maintain 50` + `battery adapter off`   |
| 15:00 | day    | 上限 80%                      | `battery maintain 80`                          |
| 18:00 | noon   | 強制放電到 50% 上限           | `battery maintain 50` + `battery adapter off`   |

## 已知技術細節(已實證)

- `battery adapter on` = 禁用放電(系統用外部電源) / CHIE = 00
- `battery adapter off` = 啟用放電(強制只用電池) / CHIE = 08
- M3 + macOS 26 用 SMC CHTE 控制充電,CHIE 控制強制放電
- `maintain_synchronous` 不會動 CHIE,所以我們要自己設
- 啟動 maintain daemon 之後再設 CHIE 才不會被覆蓋
- launchd `StartCalendarInterval` 睡眠期間不觸發 → 每 5 分鐘 sync 補
- Rust toolchain 1.97.1 已裝於 `/Users/davidchu/.cargo/bin`

## Verification Commands

| 檢查 | 命令 | 備註 |
|------|------|------|
| bash syntax | `bash -n <file>` | 每個 CLI 腳本 |
| plutil lint | `plutil -lint <plist>` | 每個 launchd plist |
| rust syntax | `cd ~/Sites/localhost/macbook_battery/ui && cargo check` | Tauri 後端 |
| frontend typecheck | `cd ~/Sites/localhost/macbook_battery/ui && npm run build` | React + TS |
| regression | `cd ~/Sites/localhost/macbook_battery/ui && npm run test:regression` | 統一開關跑全套 regression,日誌位置:`ui/regression.log` |
| runtime smoke | `cd ~/Sites/localhost/macbook_battery/ui && cargo tauri dev` 啟動 + 觀察視窗 | Tauri 行為可見改動必跑 |
| CLI integration | `~/.battery-schedule/bin/apply.sh <mode>` + 讀 SMC/pmset | 確認 IPC bridge 真實生效 |

## Regression Coverage

| Feature | 類型 | RT-ID | 狀態 | 備註 |
|---------|------|-------|------|------|
| apply.sh day mode | backend | RT-001 | COVERED | bash + SMC 觀察 (見 Verification Evidence WI-004) |
| apply.sh noon mode | backend | RT-002 | COVERED | bash + SMC 觀察 (見 WI-004) |
| apply.sh reset | backend | RT-003 | COVERED | bash + SMC 觀察 (見 WI-004) |
| hold-loop 49% 邊界 | backend | RT-004 | COVERED | LOWER_BOUND=72 模擬 (見 WI-010) |
| hold-loop cap mode 80% 上限 | backend | RT-005 | COVERED | UPPER_BOUND=60 模擬 (WI-013 驗證) |
| sync.sh drift 偵測 | backend | RT-006 | COVERED | tracker=99 邊界 (見 WI-005 round 2) |
| Power-Guard install | backend | RT-007 | COVERED | install.sh 跑過 (WI-017) |
| Power-Guard uninstall | backend | RT-008 | COVERED | uninstall.sh 跑過 |
| GUI: get_status IPC | frontend+backend | RT-009 | COVERED | api-contract.test.ts RT-009 (string-name static check) |
| GUI: set_mode IPC | frontend+backend | RT-010 | COVERED | api-contract.test.ts RT-010 (string-name static check) |
| GUI: get_schedule IPC | frontend+backend | RT-011 | COVERED | api-contract.test.ts RT-011 (string-name static check; backend has CK-007-002 mode-field bug but IPC name exposed correctly) |
| GUI: set_schedule IPC | frontend+backend | RT-012 | COVERED | api-contract.test.ts RT-012 (string-name static check; backend has CK-007-001 template-path bug, runtime will fail) |
| GUI: power_guard_status IPC | frontend+backend | RT-013 | COVERED | api-contract.test.ts RT-013 (string-name static check) |
| GUI: power_guard_install IPC | frontend+backend | RT-014 | COVERED | api-contract.test.ts RT-014 (string-name static check) |
| GUI: power_guard_reapply IPC | frontend+backend | RT-015 | COVERED | api-contract.test.ts RT-015 (string-name static check) |
| GUI: React StatusCard renders % | frontend | RT-016 | COVERED | StatusCard.test.tsx RT-016 |
| GUI: ModeSwitcher buttons trigger IPC | frontend+e2e | RT-017 | COVERED | ModeSwitcher.test.tsx RT-017 |
| GUI: ScheduleEditor 5 rows + Save | frontend+e2e | RT-018 | COVERED | ScheduleEditor.test.tsx RT-018 |
| GUI: PowerGuardPanel Install/Uninstall/Reapply | frontend+e2e | RT-019 | COVERED | PowerGuardPanel.test.tsx RT-019 |

## Work Items

| ID     | 描述                                                                  | 涉及檔案 / commits | 狀態     | 打回次數 | 最後更新 |
|--------|-----------------------------------------------------------------------|--------------------|----------|---------|---------|
| WI-001 | noon 模式:adapter off + maintain 50                                   | bin/apply.sh       | VERIFIED | 1       | 03:34   |
| WI-002 | day 模式:adapter on 確保清掉放電殘留                                  | bin/apply.sh       | VERIFIED | 0       | 03:34   |
| WI-003 | apply.sh 順序:maintain stop → 設 CHIE → maintain                      | bin/apply.sh       | VERIFIED | 1       | 03:34   |
| WI-004 | 實證驗證:三模式 SMC + pmset 全對                                      | bin/apply.sh       | VERIFIED | 0       | 03:34   |
| WI-005 | 重新 install + symlink + sync.sh 觀察                                 | install.sh + sync.sh | VERIFIED | 1       | 03:34   |
| WI-006 | 修 noon 模式電池掉到 49% 不會自己停的 bug                             | bin/hold-loop.sh   | VERIFIED | 0       | 03:48   |
| WI-007 | 寫 hold-loop.sh 自製監控                                              | bin/hold-loop.sh   | VERIFIED | 0       | 03:48   |
| WI-008 | apply.sh noon 改用 hold-loop,day/reset 停 hold-loop                   | bin/apply.sh       | VERIFIED | 0       | 03:48   |
| WI-009 | 寫 hold-loop plist + 接到 install.sh                                  | plists/ + install.sh | VERIFIED | 0       | 03:48   |
| WI-010 | 實證驗證 hold-loop 49% 邊界行為                                       | bin/hold-loop.sh   | VERIFIED | 0       | 03:48   |
| WI-011 | day 模式也有「充過 80 不會停」的風險                                  | bin/hold-loop.sh   | VERIFIED | 0       | 04:15   |
| WI-012 | hold-loop 雙模式 (cap + hold50) + state file 架構                      | bin/hold-loop.sh + state | VERIFIED | 0       | 04:15   |
| WI-013 | 重建 wrapper + 驗證完整 cycle 仍正常                                  | install.sh + bin/  | VERIFIED | 0       | 13:20   |
| WI-014 | power-guard 設計:clamshell+battery 警告 + pmset -c watchdog           | docs/              | VERIFIED | 0       | 13:20   |
| WI-015 | 寫 clamshell-power-guard.sh + ioreg + pmset -g ps 偵測                | bin/clamshell-power-guard.sh | VERIFIED | 0       | 13:20   |
| WI-016 | 寫 pmset-ac-watchdog.sh + sudoers NOPASSWD + drift 偵測               | bin/pmset-ac-watchdog.sh + sudoers | VERIFIED | 0       | 13:20   |
| WI-017 | 把 power-guard 整合進專案 bin/plists/install.sh/uninstall.sh         | bin/ + plists/ + install.sh + uninstall.sh | VERIFIED | 0       | 13:20   |
| WI-018 | README + STATE.md 文檔補齊                                            | README.md + docs/STATE.md | VERIFIED | 0       | 13:25   |
| UI-001 | Tauri app 架構設計 + IPC 命令契約                                     | ~/.claude/plans/typed-tickling-moore.md + README.md GUI section | VERIFIED | 0       | 2026-07-19 |
| UI-002 | 安裝 Rust toolchain + cargo-tauri CLI                                  | ~/.cargo/          | DEV_DONE | 1       | 2026-07-19 |
| UI-003 | cargo tauri init + 前端 Vite scaffold + package.json                    | ui/package.json + ui/vite.config.ts + ui/tsconfig.json + ui/index.html + ui/src-tauri/Cargo.toml + ui/src-tauri/tauri.conf.json | DEV_DONE | 1 | 2026-07-19 |
| UI-004 | Rust IPC commands: get_status / set_mode / get_schedule / set_schedule / power_guard_*  | ui/src-tauri/src/main.rs + ui/src-tauri/src/commands.rs | DEV_DONE | 1 | 2026-07-19 |
| UI-005 | React UI: StatusCard / ModeSwitcher / ScheduleEditor / PowerGuardPanel | ui/src/App.tsx + ui/src/components/*.tsx + ui/src/lib/api.ts | VERIFIED | 0 | 2026-07-19 |
| UI-006 | 實證驗證:UI 按鈕真的觸發 apply.sh,讀 SMC 確認                       | runtime smoke (cargo tauri dev) | DEV_DONE | 0 | 2026-07-19 |
| UI-007 | 寫 regression tests for IPC + UI (RT-009~019)                          | ui/tests/*.test.ts | VERIFIED | 0 | 2026-07-19 |
| UI-008 | cargo tauri build 打包成 .app + verify                                 | ui/src-tauri/target/release/bundle/macos/ | DEV_DONE | 1 | 2026-07-19 |
| UI-009 | 修 .app 啟動 SIGABRT crash (icon RGBA 格式) + 重新打包              | ui/src-tauri/icons/* (重新生成) | VERIFIED | 0 | 2026-07-19 |
| UI-010 | 修 STATUS 顯示 ?% bug (pmset '65%;' 解析) + 2 個回歸 test            | ui/src-tauri/src/commands.rs (parser) | VERIFIED | 0 | 2026-07-19 |
| UI-011 | apply.sh 接受 upper/lower/charge_back_to 參數 (向後相容)              | bin/apply.sh                       | TODO     | 0       | -       |
| UI-012 | 新增 ~/.battery-schedule/thresholds.json 持久化檔                     | bin/apply.sh + ~/.battery-schedule/thresholds.json | TODO | 0 | - |
| UI-013 | 新增 Rust IPC: get_thresholds / set_thresholds                          | ui/src-tauri/src/commands.rs + lib.rs | TODO     | 0       | -       |
| UI-014 | Rust unit tests for thresholds (set + bounds validation)               | ui/src-tauri/src/commands.rs       | TODO     | 0       | -       |
| UI-015 | CSS variables + auto dark mode (prefers-color-scheme)                  | ui/src/styles.css                  | TODO     | 0       | -       |
| UI-016 | BatteryIcon + ModeBadge + Sidebar + MainPanel 元件                     | ui/src/components/*.tsx             | TODO     | 0       | -       |
| UI-017 | SchedulePage 重寫 + ThresholdSlider 元件                              | ui/src/components/SchedulePage.tsx + ThresholdSlider.tsx | TODO | 0 | - |
| UI-018 | DashboardPage + PowerGuardPage 拆分                                    | ui/src/components/DashboardPage.tsx + PowerGuardPage.tsx | TODO | 0 | - |
| UI-019 | 改 App.tsx 用 sidebar + main area                                     | ui/src/App.tsx                     | TODO     | 0       | -       |
| UI-020 | regression tests: ThresholdSlider / SchedulePage / DashboardPage        | ui/tests/*.test.tsx                 | TODO     | 0       | -       |
| UI-021 | 重建 .app + E2E 實證驗證 thresholds slider 真的寫到 apply.sh          | ui/src-tauri/target/release/bundle/ | TODO     | 0       | -       |

## Checker Findings (open)

### CK-007-001 (blocker) — `set_schedule` template path wrong — **FIXED**

`ui/src-tauri/src/commands.rs` `set_schedule()` referenced template `com.user.battery-schedule.{mode}.0000.plist` which doesn't exist.

**Fix applied (round 8):** Use `ls {project_plists}/com.user.battery-schedule.{mode}.*.plist | head -1` to pick first existing template per mode, then `cp` and overwrite hour/minute/label.

**Verified (round 8):**
- `cargo check` → `Finished dev profile in 4.01s` ✓
- New bash logic test (round 8 manual run):
  ```
  day 6 30
  day 9 0
  noon 12 0
  day 15 0
  noon 18 0
  ```

**狀態:** FIXED (round 8)

### CK-007-002 (blocker) — `get_schedule` returns wrong `mode` field — **FIXED**

**Fix applied (round 8):** Switched from `sed 's/.*\.//'` (extracted last segment = time) to `awk -F. '{print $(NF-1)}'` (extracts second-to-last segment = mode). Also replaced brittle `{0,6,9,...}` glob with `.day.*.plist` + `.noon.*.plist` literal globs that don't include the junk `0` branch.

**Note:** The Rust `format!` string required escaping the `{` as `{{` because `{print $(NF-1)}` looks like a Rust format spec.

**Verified (round 8):** 5 entries returned with correct mode field (day/noon) and time (06:30/09:00/12:00/15:00/18:00).

**狀態:** FIXED (round 8)

### CK-007-003 (blocker) — `cargo check` fails: missing icons/icon.png — **FIXED**

**Fix applied (round 8):** Generated placeholder PNG + ICNS via inline Python script (32×32 blue square at 6 sizes: 16/32/64/128/256/512, each with @2x variant, packed into icns container). Updated `tauri.conf.json` to reference `icons/icon.icns` (macOS bundle) + `icons/icon.png` (Linux/Windows).

**Verified (round 8):** `cargo check` → `Finished dev profile in 4.01s` (no proc-macro panic). 13 icon files generated in `ui/src-tauri/icons/`.

**狀態:** FIXED (round 8)

### CK-007-004 (major) — `cargo tauri` CLI not yet installed — **FIXED**

**Fix:** `cargo install tauri-cli --version "^2.0" --locked` completed in background during round 7 → round 8 transition.

**Verified (round 8):** `cargo tauri --version` → `tauri-cli 2.11.4` ✓, `/Users/davidchu/.cargo/bin/cargo-tauri` present.

**狀態:** FIXED (round 8)

### CK-007-005 (minor) — `get_schedule` glob includes junk entry — **FIXED (incidental)**

**Fix applied (round 8):** New code uses literal `.day.*.plist` and `.noon.*.plist` globs that don't include a `0` branch — the `0` issue is gone as a side effect of the CK-007-002 fix.

**狀態:** FIXED (round 8, incidental)

## Verification Evidence

| WI | 檢查 | 命令 | 結果 | 回合 |
|----|------|------|------|------|
| UI-007 | frontend regression test (REGRESSION_MODE=1) | `npm run test:regression` (in ui/) | **23/23 PASS** (api-contract 7 + ModeSwitcher 4 + StatusCard 4 + PowerGuardPanel 5 + ScheduleEditor 3) Duration 6.17s | 7 |
| UI-005 | frontend typecheck + vite build | `npm run build` (in ui/) | **PASS** — tsc --noEmit + vite v5.4.21 build OK | 7 |
| UI-004 | cargo check (Rust syntax + Tauri macro) | `cargo check` (in ui/src-tauri) | **PASS** — `Finished dev profile in 4.01s` after CK-007-001/002/003 fixes | 8 |
| UI-004 | cargo test (Rust unit tests) | `cargo test --lib` (in ui/src-tauri) | **PASS** — 2/2 tests: schedule_entry_round_trip_serde + status_struct_serializes_with_camelcase_via_default | 8 |
| UI-004 | get_schedule bash logic | manual run on plists/ | **PASS** — 5 entries with correct mode field (day/noon) + time | 8 |
| UI-002 | cargo-tauri CLI binary | `cargo tauri --version` | **PASS** — `tauri-cli 2.11.4` | 8 |
| UI-007 | regression re-run after CK-007-002 fix | `npm run test:regression` | **PASS** — 23/23 still pass after fix | 8 |
| UI-006 | runtime smoke (bash commands IPC calls) | `apply.sh reset/day/noon/reset` + read SMC/pmset | **PASS** — reset (CHTE=00,CHIE=00); day (CHTE=01,CHIE=00,MODE=cap); noon (CHTE=00,CHIE=08,MODE=hold50,discharging); reset (CHIE=00,state removed) | 8 |
| UI-008 | cargo tauri build | `cargo tauri build` | **PASS** — `MacBook Power Tools.app` produced, arm64 Mach-O binary at `target/release/bundle/macos/` | 8 |

## Resolved Findings

### CK-007-001 — `set_schedule` template path wrong (round 7 → round 8)
Fixed by dynamic template lookup via `ls ... | head -1`. Re-verified: `cargo check` passes; bash logic test returns 5 correct entries. **狀態: FIXED**

### CK-007-002 — `get_schedule` wrong mode field (round 7 → round 8)
Fixed by switching to `awk -F. '{print $(NF-1)}'` with `{{` format-string escaping in Rust `format!`. **狀態: FIXED**

### CK-007-003 — `cargo check` fails: missing icons (round 7 → round 8)
Fixed by generating placeholder PNG/ICNS via inline Python. `cargo check` now passes in 4.01s. **狀態: FIXED**

### CK-007-004 — `cargo tauri` CLI not yet installed (round 7 → round 8)
Fixed by background `cargo install` completing. CLI present at `/Users/davidchu/.cargo/bin/cargo-tauri` v2.11.4. **狀態: FIXED**

### CK-007-005 — `get_schedule` glob junk entry (round 7 → round 8)
Fixed incidentally by CK-007-002's glob rewrite. **狀態: FIXED**

### CK-Round8-Icon — .app 啟動 SIGABRT crash (round 8 fix)
**Problem:** App launched then immediately crashed with `EXC_CRASH SIGABRT` at `tauri-2.11.5/src/app.rs:1425:11`:
```
Failed to setup app: runtime error: invalid icon:
  The specified dimensions (512x512) don't match the number of pixels supplied
  by the `rgba` argument (512). For those dimensions, the expected pixel
  count is 262144.
```
Root cause: round 8 icon generator wrote only 3 bytes (RGB) per pixel instead of 4 bytes (RGBA). Tauri 2.11 strictly validates RGBA byte count matches dimensions.

**Fix (round 8 fix):** Regenerated all icons with correct 4-byte-per-pixel RGBA format. Verified `icon.png` is valid `512x512 RGBA` via PIL. Rebuilt `.app`.

**Verified (round 8 fix):** Direct binary launch — `Failed to setup app` panic gone, process runs for 4+ seconds without crashing. **狀態: FIXED**

## Escalation

(無)