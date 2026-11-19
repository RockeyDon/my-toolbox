use super::config::{Config, Shell};
use nix::unistd::{Uid, User};
use std::collections::HashSet;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub fn account() -> Result<User, String> {
    User::from_uid(Uid::current())
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法读取当前用户的登录账户".into())
}

pub fn executable(path: &Path) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("Shell 不可用（{}）：{error}", path.display()))?;
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return Err(format!("请选择具有执行权限的普通文件：{}", path.display()));
    }
    Ok(path)
}

pub fn kind(path: &Path) -> Result<String, String> {
    match path.file_name().and_then(|name| name.to_str()) {
        Some("fish") => Ok("fish".into()),
        Some("sh" | "zsh" | "bash" | "dash" | "ksh") => Ok("posix".into()),
        _ => Err("仅支持 sh、zsh、bash、dash、ksh、fish；包装程序需明确选择兼容类型".into()),
    }
}

pub fn selected(config: &Config) -> Result<Shell, String> {
    if config.shells.selected_id == "system-default" {
        let path = account()?.shell;
        let shell_kind = kind(&path)?;
        let path = executable(&path)?;
        return Ok(Shell {
            id: "system-default".into(),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            path: path.to_string_lossy().into(),
            kind: shell_kind,
        });
    }
    let shell = config
        .shells
        .discovered
        .iter()
        .chain(&config.shells.manual)
        .find(|shell| shell.id == config.shells.selected_id)
        .ok_or("当前选择的 Shell 不存在")?
        .clone();
    executable(Path::new(&shell.path))?;
    Ok(shell)
}

pub fn availability(config: &Config) -> Vec<String> {
    config
        .shells
        .discovered
        .iter()
        .chain(&config.shells.manual)
        .filter(|shell| executable(Path::new(&shell.path)).is_err())
        .map(|shell| shell.id.clone())
        .collect()
}

#[cfg_attr(test, allow(dead_code))]
pub async fn discover() -> Result<Vec<(String, String)>, String> {
    let user = account()?;
    kind(&user.shell)?;
    let mut command = Command::new(&user.shell);
    command
        .args([
            "-l",
            "-c",
            "printf '\\036TOOLBOX_PATH\\037%s\\036' \"$PATH\"",
        ])
        .current_dir(&user.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let process_id = child.id().ok_or("无法读取 Shell 进程 ID")?;
    let mut stdout = child.stdout.take().ok_or("无法读取登录环境")?;
    let discovery = async {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take(1024 * 1024)
            .read_to_end(&mut bytes)
            .await
            .map_err(|error| error.to_string())?;
        let status = child.wait().await.map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("登录 Shell 读取环境失败".into());
        }
        Ok::<_, String>(bytes)
    };
    let result = tokio::time::timeout(Duration::from_secs(5), discovery).await;
    let _ = nix::sys::signal::killpg(
        nix::unistd::Pid::from_raw(process_id as i32),
        nix::sys::signal::Signal::SIGKILL,
    );
    let _ = child.wait().await;
    let bytes = result.map_err(|_| "扫描 Shell 超时（5 秒）".to_string())??;
    let text = String::from_utf8_lossy(&bytes);
    let login_path = text
        .split("\x1eTOOLBOX_PATH\x1f")
        .nth(1)
        .and_then(|tail| tail.split('\x1e').next())
        .ok_or("登录 Shell 未返回有效 PATH")?;
    let list = std::fs::read_to_string("/etc/shells")
        .map_err(|error| format!("读取系统 Shell 清单失败：{error}"))?;
    let mut candidates: Vec<PathBuf> = list
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(PathBuf::from)
        .collect();
    candidates.push(user.shell);
    for directory in std::env::split_paths(login_path) {
        for name in ["zsh", "bash", "fish", "sh", "dash", "ksh"] {
            candidates.push(directory.join(name));
        }
    }
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for candidate in candidates {
        if let (Ok(shell_kind), Ok(path)) = (kind(&candidate), executable(&candidate)) {
            let path = path.to_string_lossy().to_string();
            if seen.insert(path.clone()) {
                found.push((path, shell_kind));
            }
        }
    }
    Ok(found)
}
