use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuickCommand {
    pub id: String,
    pub name: String,
    pub command: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shell {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellSettings {
    pub selected_id: String,
    pub discovered: Vec<Shell>,
    pub manual: Vec<Shell>,
    pub last_scanned_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub version: u32,
    pub commands: Vec<QuickCommand>,
    pub shells: ShellSettings,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            commands: Vec::new(),
            shells: ShellSettings {
                selected_id: "system-default".into(),
                discovered: Vec::new(),
                manual: Vec::new(),
                last_scanned_at: None,
            },
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!("不支持的配置版本：{}", self.version));
        }
        let mut command_ids = HashSet::new();
        for command in &self.commands {
            if command.id.is_empty() || !command_ids.insert(&command.id) {
                return Err("命令 ID 为空或重复".into());
            }
            if command.name.trim().is_empty() || command.command.trim().is_empty() {
                return Err("命令名称和正文不可为空".into());
            }
            if command.command.contains('\0') {
                return Err("命令正文不可包含 NUL 字符".into());
            }
        }
        let mut shell_ids = HashSet::new();
        let mut paths = HashSet::new();
        for shell in self.shells.discovered.iter().chain(&self.shells.manual) {
            if shell.id.is_empty()
                || shell.id == "system-default"
                || !shell_ids.insert(&shell.id)
                || !paths.insert(&shell.path)
                || shell.name.trim().is_empty()
                || !Path::new(&shell.path).is_absolute()
                || !matches!(shell.kind.as_str(), "posix" | "fish")
            {
                return Err("Shell 配置包含无效字段或重复项".into());
            }
        }
        if self.shells.selected_id != "system-default"
            && !shell_ids.contains(&self.shells.selected_id)
        {
            return Err("当前选择的 Shell 不存在于配置中".into());
        }
        Ok(())
    }
}

pub struct ConfigStore {
    pub path: PathBuf,
    current: Mutex<Option<Config>>,
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            current: Mutex::new(None),
        }
    }

    fn read(&self) -> Result<Config, String> {
        match fs::read(&self.path) {
            Ok(bytes) => {
                let config: Config = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("配置解析失败（{}）：{error}", self.path.display()))?;
                config
                    .validate()
                    .map_err(|error| format!("配置无效（{}）：{error}", self.path.display()))?;
                Ok(config)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let config = Config::default();
                self.write(&config)?;
                Ok(config)
            }
            Err(error) => Err(format!("读取配置失败（{}）：{error}", self.path.display())),
        }
    }

    fn write(&self, config: &Config) -> Result<(), String> {
        config.validate()?;
        if self.path.is_dir() {
            return Err(format!("配置路径不是文件（{}）", self.path.display()));
        }
        let parent = self.path.parent().ok_or("配置目录无效")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = parent.join(format!(".quick-commands-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            file.write_all(&serde_json::to_vec_pretty(config)?)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            std::fs::File::open(parent)?.sync_all()?;
            Ok::<(), Box<dyn std::error::Error>>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|error| format!("保存配置失败（{}）：{error}", self.path.display()))
    }

    pub fn load(&self) -> Result<Config, String> {
        let mut current = self.current.lock().map_err(|error| error.to_string())?;
        if current.is_none() {
            *current = Some(self.read()?);
        }
        Ok(current.as_ref().ok_or("配置尚未加载")?.clone())
    }

    pub fn update(
        &self,
        change: impl FnOnce(&mut Config) -> Result<(), String>,
    ) -> Result<Config, String> {
        let mut current = self.current.lock().map_err(|error| error.to_string())?;
        let mut next = match current.as_ref() {
            Some(config) => config.clone(),
            None => self.read()?,
        };
        change(&mut next)?;
        self.write(&next)?;
        *current = Some(next.clone());
        Ok(next)
    }
}
