pub mod config;
pub mod runtime;
pub mod shells;

use config::{Config, ConfigStore, QuickCommand, Shell};
use runtime::{Event, QueueItem, Runtime};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub struct QuickCommands {
    pub config: ConfigStore,
    pub runtime: Runtime,
    pub exiting: std::sync::Arc<AtomicBool>,
    pub exit_allowed: std::sync::Arc<AtomicBool>,
    scanning: tokio::sync::Mutex<()>,
}

impl QuickCommands {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self {
            config: ConfigStore::new(path),
            runtime: Runtime::default(),
            exiting: std::sync::Arc::new(AtomicBool::new(false)),
            exit_allowed: std::sync::Arc::new(AtomicBool::new(false)),
            scanning: tokio::sync::Mutex::new(()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    config: Config,
    default_shell: Option<Shell>,
    default_error: Option<String>,
    unavailable_ids: Vec<String>,
}

fn configuration(config: Config) -> Configuration {
    let mut defaults = config.clone();
    defaults.shells.selected_id = "system-default".into();
    let default = shells::selected(&defaults);
    Configuration {
        unavailable_ids: shells::availability(&config),
        config,
        default_shell: default.as_ref().ok().cloned(),
        default_error: default.err(),
    }
}

#[tauri::command]
pub fn qc_load(state: State<'_, QuickCommands>) -> Result<Configuration, String> {
    state.config.load().map(configuration)
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Change {
    SaveCommand { command: QuickCommand },
    DeleteCommand { id: String },
    Reorder { ids: Vec<String> },
    SelectShell { id: String },
    SaveShell { shell: Shell },
    RemoveShell { id: String },
}

#[tauri::command]
pub fn qc_update(state: State<'_, QuickCommands>, change: Change) -> Result<Configuration, String> {
    state
        .config
        .update(|config| {
            match change {
                Change::SaveCommand { mut command } => {
                    command.name = command.name.trim().into();
                    if let Some(existing) = config
                        .commands
                        .iter_mut()
                        .find(|item| item.id == command.id)
                    {
                        *existing = command;
                    } else {
                        config.commands.push(command);
                    }
                }
                Change::DeleteCommand { id } => {
                    let index = config
                        .commands
                        .iter()
                        .position(|item| item.id == id)
                        .ok_or("命令不存在")?;
                    config.commands.remove(index);
                }
                Change::Reorder { ids } => {
                    if ids.len() != config.commands.len() {
                        return Err("排序命令列表与配置不一致".into());
                    }
                    let mut remaining = config.commands.clone();
                    let mut reordered = Vec::new();
                    for id in ids {
                        let index = remaining
                            .iter()
                            .position(|item| item.id == id)
                            .ok_or("排序包含重复或未知命令")?;
                        reordered.push(remaining.remove(index));
                    }
                    config.commands = reordered;
                }
                Change::SelectShell { id } => config.shells.selected_id = id,
                Change::SaveShell { mut shell } => {
                    let path = shells::executable(Path::new(&shell.path))?;
                    shell.path = path.to_string_lossy().into();
                    if !matches!(shell.kind.as_str(), "posix" | "fish") {
                        return Err("Shell 兼容类型无效".into());
                    }
                    if let Ok(actual) = shells::kind(&path) {
                        if shell.kind != actual {
                            return Err("Shell 类型与可执行文件不匹配".into());
                        }
                    }
                    shell.name = shell.name.trim().to_string();
                    if shell.name.is_empty() {
                        shell.name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into();
                    }
                    if let Some(existing) = config
                        .shells
                        .manual
                        .iter_mut()
                        .find(|item| item.id == shell.id)
                    {
                        *existing = shell;
                    } else {
                        config.shells.manual.push(shell);
                    }
                }
                Change::RemoveShell { id } => {
                    let index = config
                        .shells
                        .manual
                        .iter()
                        .position(|item| item.id == id)
                        .ok_or("手动 Shell 不存在")?;
                    config.shells.manual.remove(index);
                    if config.shells.selected_id == id {
                        config.shells.selected_id = "system-default".into();
                    }
                }
            }
            Ok(())
        })
        .map(configuration)
}

#[tauri::command]
pub async fn qc_scan(state: State<'_, QuickCommands>) -> Result<Configuration, String> {
    let _guard = state.scanning.lock().await;
    let found = shells::discover().await?;
    state
        .config
        .update(|config| {
            let mut discovered = Vec::new();
            for (path, kind) in found {
                if config.shells.manual.iter().any(|shell| shell.path == path) {
                    continue;
                }
                let previous = config
                    .shells
                    .discovered
                    .iter()
                    .find(|shell| shell.path == path);
                discovered.push(Shell {
                    id: previous
                        .map(|shell| shell.id.clone())
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    name: Path::new(&path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    path,
                    kind,
                });
            }
            if let Some(missing) = config.shells.discovered.iter().find(|shell| {
                shell.id == config.shells.selected_id
                    && !discovered.iter().any(|item| item.id == shell.id)
            }) {
                discovered.push(missing.clone());
            }
            config.shells.discovered = discovered;
            config.shells.last_scanned_at = Some(
                time::OffsetDateTime::now_utc()
                    .format(&time::format_description::well_known::Rfc3339)
                    .map_err(|error| error.to_string())?,
            );
            Ok(())
        })
        .map(configuration)
}

#[tauri::command]
pub async fn qc_pick_shell(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_file()
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn qc_create_tab(
    state: State<'_, QuickCommands>,
    channel: Channel<Event>,
) -> Result<String, String> {
    if state.exiting.load(Ordering::SeqCst) {
        return Err("应用正在退出".into());
    }
    state.runtime.create(channel)
}

#[tauri::command]
pub async fn qc_submit(
    state: State<'_, QuickCommands>,
    tab_id: String,
    command_id: String,
) -> Result<(), String> {
    if state.exiting.load(Ordering::SeqCst) {
        return Err("应用正在退出".into());
    }
    let config = state.config.load()?;
    let command = config
        .commands
        .iter()
        .find(|item| item.id == command_id)
        .ok_or("命令不存在")?
        .clone();
    let shell = shells::selected(&config)?;
    state
        .runtime
        .submit(&tab_id, QueueItem::new(command, shell))
        .await
}

#[tauri::command]
pub async fn qc_delete_queue(
    state: State<'_, QuickCommands>,
    tab_id: String,
    item_id: String,
) -> Result<(), String> {
    state.runtime.delete(&tab_id, item_id).await
}

#[tauri::command]
pub async fn qc_interrupt(
    state: State<'_, QuickCommands>,
    tab_id: String,
    run_id: String,
) -> Result<(), String> {
    state.runtime.interrupt(&tab_id, run_id).await
}

#[tauri::command]
pub async fn qc_close_tab(state: State<'_, QuickCommands>, tab_id: String) -> Result<(), String> {
    state.runtime.close(&tab_id).await
}

pub fn request_exit(app: &AppHandle) {
    let state = app.state::<QuickCommands>();
    if state.exit_allowed.load(Ordering::SeqCst) {
        return;
    }
    if state.exiting.swap(true, Ordering::SeqCst) {
        return;
    }
    let runtime = state.runtime.clone();
    let exit_allowed = state.exit_allowed.clone();
    let finish = |app: AppHandle, runtime: Runtime, exit_allowed: std::sync::Arc<AtomicBool>| {
        tauri::async_runtime::spawn(async move {
            runtime.shutdown().await;
            exit_allowed.store(true, Ordering::SeqCst);
            app.exit(0);
        });
    };
    if state.runtime.busy() {
        let app = app.clone();
        app.dialog()
            .message("终止所有任务、丢弃待执行队列并退出？")
            .title("退出工具箱")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "终止并退出".into(),
                "取消".into(),
            ))
            .show(move |confirmed| {
                if confirmed {
                    finish(app, runtime, exit_allowed);
                } else {
                    app.state::<QuickCommands>()
                        .exiting
                        .store(false, Ordering::SeqCst);
                }
            });
    } else {
        finish(app.clone(), runtime, exit_allowed);
    }
}
