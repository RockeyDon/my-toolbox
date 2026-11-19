#[path = "../../../src-tauri/src/quick_commands/config.rs"]
mod config;
#[path = "../../../src-tauri/src/quick_commands/runtime.rs"]
mod runtime;
#[path = "../../../src-tauri/src/quick_commands/shells.rs"]
mod shells;

use config::{Config, ConfigStore, QuickCommand, Shell};
use runtime::{Event, QueueItem, Runtime};
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("toolbox-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn store(&self) -> ConfigStore {
        ConfigStore::new(self.0.join("quick-commands.json"))
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn command(name: &str, script: &str) -> QuickCommand {
    QuickCommand {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        command: script.into(),
    }
}

fn item(name: &str, script: &str) -> QueueItem {
    QueueItem::new(
        command(name, script),
        Shell {
            id: "test-shell".into(),
            name: "sh".into(),
            path: "/bin/sh".into(),
            kind: "posix".into(),
        },
    )
}

type Events = Arc<Mutex<Vec<Event>>>;
fn tab(runtime: &Runtime) -> (String, Events) {
    let events: Events = Arc::default();
    let sink = events.clone();
    let id = runtime
        .create_with_sink(Arc::new(move |event| sink.lock().unwrap().push(event)))
        .unwrap();
    (id, events)
}

async fn wait_for(events: &Events, predicate: impl Fn(&[Event]) -> bool) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if predicate(&events.lock().unwrap()) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("timed out waiting for runtime event");
}

fn output(events: &[Event]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            Event::Output { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn config_round_trip_and_permissions() {
    let directory = Directory::new();
    let store = directory.store();
    assert_eq!(store.load().unwrap(), Config::default());
    let saved = store
        .update(|config| {
            config
                .commands
                .push(command("多行", "printf '中文'\nprintf done"));
            Ok(())
        })
        .unwrap();
    assert_eq!(directory.store().load().unwrap(), saved);
    assert_eq!(
        std::fs::metadata(&store.path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let json = std::fs::read_to_string(&store.path).unwrap();
    assert!(!json.contains("queue"));
    assert!(!json.contains("openInNewTab"));
    assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
}

#[test]
fn corrupt_and_unknown_configuration_are_not_overwritten() {
    let directory = Directory::new();
    let path = directory.store().path;
    for text in [
        "broken",
        r#"{"version":99,"commands":[],"shells":{"selectedId":"system-default","discovered":[],"manual":[],"lastScannedAt":null}}"#,
    ] {
        std::fs::write(&path, text).unwrap();
        assert!(directory.store().load().is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    }
}

#[test]
fn failed_updates_preserve_configuration() {
    let directory = Directory::new();
    let store = directory.store();
    let original = store.load().unwrap();
    assert!(store
        .update(|config| {
            config.commands.push(command("", "echo ignored"));
            Ok(())
        })
        .is_err());
    assert_eq!(store.load().unwrap(), original);
    std::fs::rename(&store.path, directory.0.join("backup")).unwrap();
    std::fs::create_dir(&store.path).unwrap();
    assert!(store
        .update(|config| {
            config.commands.push(command("test", "echo test"));
            Ok(())
        })
        .is_err());
    assert_eq!(store.load().unwrap(), original);
    assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 2);
}

#[test]
fn shell_validation_checks_file_and_permissions() {
    let directory = Directory::new();
    let path = directory.0.join("shell");
    std::fs::write(&path, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(shells::executable(&path).is_err());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(shells::executable(&path).is_ok());
    assert!(shells::executable(&directory.0).is_err());
    assert!(shells::kind(std::path::Path::new("/bin/python")).is_err());
    assert!(shells::selected(&Config::default()).is_ok());
    assert!(shells::availability(&Config::default()).is_empty());
}

#[test]
fn manual_shell_selection_requires_a_real_shell_and_removal_resets_selection() {
    let directory = Directory::new();
    let store = directory.store();
    let path = std::path::Path::new("/bin/sh").canonicalize().unwrap();
    let shell = Shell {
        id: "manual-sh".into(),
        name: "包装 Shell".into(),
        path: path.to_string_lossy().into(),
        kind: "posix".into(),
    };
    store
        .update(|config| {
            config.shells.manual.push(shell.clone());
            config.shells.selected_id = shell.id.clone();
            Ok(())
        })
        .unwrap();
    assert_eq!(
        shells::selected(&store.load().unwrap()).unwrap().id,
        shell.id
    );
    store
        .update(|config| {
            config.shells.manual.retain(|item| item.id != shell.id);
            config.shells.selected_id = "system-default".into();
            Ok(())
        })
        .unwrap();
    assert_eq!(store.load().unwrap().shells.selected_id, "system-default");
}

#[tokio::test]
async fn fifo_delete_failure_and_snapshot() {
    let runtime = Runtime::default();
    let (id, events) = tab(&runtime);
    runtime
        .submit(&id, item("first", "printf first; sleep 0.3"))
        .await
        .unwrap();
    wait_for(&events, |events| output(events).contains("first")).await;
    let deleted = item("deleted", "printf SHOULD_NOT_RUN");
    runtime.submit(&id, deleted.clone()).await.unwrap();
    let mut snapshot = item("second", "printf second; exit 7");
    runtime.submit(&id, snapshot.clone()).await.unwrap();
    snapshot.command = "printf CHANGED".into();
    runtime
        .submit(&id, item("third", "printf third >&2"))
        .await
        .unwrap();
    runtime.delete(&id, deleted.id).await.unwrap();
    wait_for(&events, |events| {
        events
            .iter()
            .filter(|event| matches!(event, Event::Finished { .. }))
            .count()
            == 3
    })
    .await;
    let captured = events.lock().unwrap().clone();
    assert_eq!(output(&captured), "firstsecondthird");
    assert!(captured.iter().any(
        |event| matches!(event, Event::Finished { result, .. } if result.contains("退出码 7"))
    ));
    runtime.close(&id).await.unwrap();
    assert!(!runtime.busy());
    assert!(runtime.submit(&id, item("late", "true")).await.is_err());
}

#[tokio::test]
async fn spawn_failure_does_not_block_queue() {
    let runtime = Runtime::default();
    let (id, events) = tab(&runtime);
    let mut invalid = item("missing", "true");
    invalid.shell.path = "/no/such/toolbox-shell".into();
    runtime.submit(&id, invalid).await.unwrap();
    runtime
        .submit(&id, item("next", "printf NEXT"))
        .await
        .unwrap();
    wait_for(&events, |events| output(events).contains("NEXT")).await;
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn independent_tabs_and_utf8_streams() {
    let runtime = Runtime::default();
    let (first, first_events) = tab(&runtime);
    let (second, second_events) = tab(&runtime);
    runtime
        .submit(&first, item("slow", "sleep 0.4; printf slow"))
        .await
        .unwrap();
    runtime
        .submit(
            &second,
            item(
                "fast",
                r"printf '\344'; sleep 0.05; printf '\270\255'; printf err >&2",
            ),
        )
        .await
        .unwrap();
    wait_for(&second_events, |events| {
        events
            .iter()
            .any(|event| matches!(event, Event::Finished { .. }))
    })
    .await;
    assert!(!first_events
        .lock()
        .unwrap()
        .iter()
        .any(|event| matches!(event, Event::Finished { .. })));
    let text = output(&second_events.lock().unwrap());
    assert!(text.contains('中'));
    assert!(text.contains("err"));
    assert!(!text.contains('\u{fffd}'));
    runtime.shutdown().await;
}

#[tokio::test]
async fn sigint_waits_for_exit_then_continues_queue() {
    let runtime = Runtime::default();
    let (id, events) = tab(&runtime);
    runtime
        .submit(
            &id,
            item(
                "interrupt",
                "trap 'printf HANDLED; exit 0' INT; printf READY; while :; do sleep 0.1; done",
            ),
        )
        .await
        .unwrap();
    wait_for(&events, |events| output(events).contains("READY")).await;
    runtime
        .submit(&id, item("after", "printf AFTER"))
        .await
        .unwrap();
    let run_id = events
        .lock()
        .unwrap()
        .iter()
        .find_map(|event| match event {
            Event::Started { run_id, .. } => Some(run_id.clone()),
            _ => None,
        })
        .unwrap();
    runtime.interrupt(&id, run_id).await.unwrap();
    wait_for(&events, |events| output(events).contains("AFTER")).await;
    assert_eq!(output(&events.lock().unwrap()), "READYHANDLEDAFTER");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn ignored_sigint_does_not_start_next_and_close_discards_queue() {
    let runtime = Runtime::default();
    let (id, events) = tab(&runtime);
    runtime
        .submit(
            &id,
            item(
                "ignore",
                "trap '' INT TERM; printf READY; while :; do sleep 0.1; done",
            ),
        )
        .await
        .unwrap();
    wait_for(&events, |events| output(events).contains("READY")).await;
    runtime
        .submit(&id, item("discarded", "printf SHOULD_NOT_RUN"))
        .await
        .unwrap();
    let run_id = events
        .lock()
        .unwrap()
        .iter()
        .find_map(|event| match event {
            Event::Started { run_id, .. } => Some(run_id.clone()),
            _ => None,
        })
        .unwrap();
    runtime.interrupt(&id, run_id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(runtime.busy());
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, Event::Started { .. }))
            .count(),
        1
    );
    runtime.close(&id).await.unwrap();
    assert!(!output(&events.lock().unwrap()).contains("SHOULD_NOT_RUN"));
    assert!(!runtime.busy());
}

#[tokio::test]
async fn repeated_create_close_releases_tabs() {
    let runtime = Runtime::default();
    for _ in 0..30 {
        let (id, _) = tab(&runtime);
        runtime.close(&id).await.unwrap();
        assert!(runtime.close(&id).await.is_err());
    }
    assert!(!runtime.busy());
}
