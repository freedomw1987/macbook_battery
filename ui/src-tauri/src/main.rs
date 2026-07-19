// macbook_power_tools - Tauri app entry point
//
// This file is intentionally minimal — all IPC commands live in commands.rs
// and are registered via the `invoke_handler!` macro in lib.rs.

fn main() {
    macbook_power_tools_lib::run();
}