#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quick_commands;
use tauri::Manager;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("quick-commands.json");
            app.manage(quick_commands::QuickCommands::new(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quick_commands::qc_load,
            quick_commands::qc_update,
            quick_commands::qc_scan,
            quick_commands::qc_pick_shell,
            quick_commands::qc_create_tab,
            quick_commands::qc_submit,
            quick_commands::qc_delete_queue,
            quick_commands::qc_interrupt,
            quick_commands::qc_close_tab,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                quick_commands::request_exit(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("工具箱启动失败");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. }
            if !app
                .state::<quick_commands::QuickCommands>()
                .exit_allowed
                .load(std::sync::atomic::Ordering::SeqCst) =>
        {
            api.prevent_exit();
            quick_commands::request_exit(app);
        }
        tauri::RunEvent::Exit => {
            tauri::async_runtime::block_on(
                app.state::<quick_commands::QuickCommands>()
                    .runtime
                    .shutdown(),
            );
        }
        _ => (),
    });
}
