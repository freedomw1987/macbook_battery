// macbook_power_tools_lib - library crate that wires IPC commands
// into Tauri. main.rs is a thin wrapper that calls run().

mod commands;

use commands::{
    get_power_guard_reapply, get_power_guard_status, get_schedule, get_status,
    get_thresholds, power_guard_install, power_guard_uninstall, set_mode,
    set_schedule, set_thresholds,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            set_mode,
            get_schedule,
            set_schedule,
            get_thresholds,
            set_thresholds,
            get_power_guard_status,
            get_power_guard_reapply,
            power_guard_install,
            power_guard_uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}