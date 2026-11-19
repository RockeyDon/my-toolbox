use super::config::{QuickCommand, Shell};
use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::os::unix::process::ExitStatusExt;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, watch};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub name: String,
    pub command: String,
    pub shell: Shell,
}

impl QueueItem {
    pub fn new(command: QuickCommand, shell: Shell) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: command.name,
            command: command.command,
            shell,
        }
    }
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
    pub queue: VecDeque<QueueItem>,
    pub current: Option<QueueItem>,
    pub run_id: Option<String>,
    pub interrupt_sent: bool,
    pub closing: bool,
    pub last_result: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    State {
        tab_id: String,
        state: TabState,
    },
    Output {
        tab_id: String,
        run_id: String,
        text: String,
        stream: String,
    },
    Started {
        tab_id: String,
        run_id: String,
        item: QueueItem,
        started_at: u64,
    },
    Finished {
        tab_id: String,
        run_id: String,
        result: String,
    },
}

pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;
type Reply = oneshot::Sender<Result<(), String>>;

enum Control {
    Submit(QueueItem, Reply),
    Delete(String, Reply),
    Interrupt(String, Reply),
    Close,
}

#[derive(Clone)]
struct TabHandle {
    sender: mpsc::Sender<Control>,
    state: watch::Receiver<TabState>,
    done: watch::Receiver<bool>,
}

#[derive(Clone, Default)]
pub struct Runtime {
    tabs: Arc<Mutex<HashMap<String, TabHandle>>>,
}

impl Runtime {
    #[cfg_attr(test, allow(dead_code))]
    pub fn create(&self, channel: Channel<Event>) -> Result<String, String> {
        self.create_with_sink(Arc::new(move |event| {
            let _ = channel.send(event);
        }))
    }

    pub fn create_with_sink(&self, sink: Sink) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel(64);
        let (state_sender, state) = watch::channel(TabState::default());
        let (done_sender, done) = watch::channel(false);
        self.tabs.lock().map_err(|error| error.to_string())?.insert(
            id.clone(),
            TabHandle {
                sender,
                state,
                done,
            },
        );
        tokio::spawn(actor(id.clone(), receiver, state_sender, done_sender, sink));
        Ok(id)
    }

    fn handle(&self, id: &str) -> Result<TabHandle, String> {
        self.tabs
            .lock()
            .map_err(|error| error.to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| "标签已关闭或不存在".into())
    }

    async fn request(&self, id: &str, make: impl FnOnce(Reply) -> Control) -> Result<(), String> {
        let handle = self.handle(id)?;
        let (sender, reply) = oneshot::channel();
        handle
            .sender
            .send(make(sender))
            .await
            .map_err(|_| "标签已关闭")?;
        reply.await.map_err(|_| "标签已关闭")?
    }

    pub async fn submit(&self, id: &str, item: QueueItem) -> Result<(), String> {
        self.request(id, |reply| Control::Submit(item, reply)).await
    }

    pub async fn delete(&self, id: &str, item_id: String) -> Result<(), String> {
        self.request(id, |reply| Control::Delete(item_id, reply))
            .await
    }

    pub async fn interrupt(&self, id: &str, run_id: String) -> Result<(), String> {
        self.request(id, |reply| Control::Interrupt(run_id, reply))
            .await
    }

    pub fn busy(&self) -> bool {
        self.tabs
            .lock()
            .map(|tabs| {
                tabs.values().any(|tab| {
                    let state = tab.state.borrow();
                    state.current.is_some() || !state.queue.is_empty()
                })
            })
            .unwrap_or(true)
    }

    pub async fn close(&self, id: &str) -> Result<(), String> {
        let mut handle = self.handle(id)?;
        let _ = handle.sender.send(Control::Close).await;
        while !*handle.done.borrow_and_update() {
            if handle.done.changed().await.is_err() {
                break;
            }
        }
        self.tabs
            .lock()
            .map_err(|error| error.to_string())?
            .remove(id);
        Ok(())
    }

    pub async fn shutdown(&self) {
        let handles = self
            .tabs
            .lock()
            .map(|tabs| {
                tabs.iter()
                    .map(|(id, handle)| (id.clone(), handle.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for (id, _) in handles {
            let _ = self.close(&id).await;
        }
    }
}

struct Actor {
    id: String,
    state: TabState,
    state_sender: watch::Sender<TabState>,
    sink: Sink,
}

impl Actor {
    fn publish(&self) {
        self.state_sender.send_replace(self.state.clone());
        (self.sink)(Event::State {
            tab_id: self.id.clone(),
            state: self.state.clone(),
        });
    }

    fn control(&mut self, control: Control, process_id: Option<u32>) {
        match control {
            Control::Submit(item, reply) => {
                let result = if self.state.closing {
                    Err("标签正在关闭".into())
                } else {
                    self.state.queue.push_back(item);
                    Ok(())
                };
                self.publish();
                let _ = reply.send(result);
            }
            Control::Delete(id, reply) => {
                let result =
                    if let Some(index) = self.state.queue.iter().position(|item| item.id == id) {
                        self.state.queue.remove(index);
                        Ok(())
                    } else {
                        Err("该队列项已开始执行或已被删除".into())
                    };
                self.publish();
                let _ = reply.send(result);
            }
            Control::Interrupt(run_id, reply) => {
                let result = if self.state.closing {
                    Err("标签正在关闭，不再接受中断请求".into())
                } else if self.state.run_id.as_ref() != Some(&run_id) {
                    Err("任务已结束，未中断后续任务".into())
                } else if self.state.interrupt_sent {
                    Ok(())
                } else if let Some(process_id) = process_id {
                    signal(process_id, Signal::SIGINT).map(|()| self.state.interrupt_sent = true)
                } else {
                    Err("任务尚未启动或已退出".into())
                };
                self.publish();
                let _ = reply.send(result);
            }
            Control::Close => {
                self.state.closing = true;
                self.state.queue.clear();
                self.publish();
            }
        }
    }
}

fn signal(process_id: u32, value: Signal) -> Result<(), String> {
    killpg(Pid::from_raw(process_id as i32), value)
        .map_err(|error| format!("发送中断／终止信号失败：{error}"))
}

async fn actor(
    id: String,
    mut receiver: mpsc::Receiver<Control>,
    state_sender: watch::Sender<TabState>,
    done: watch::Sender<bool>,
    sink: Sink,
) {
    let mut actor = Actor {
        id,
        state: TabState::default(),
        state_sender,
        sink,
    };
    loop {
        while let Ok(control) = receiver.try_recv() {
            actor.control(control, None);
        }
        if actor.state.closing {
            break;
        }
        if let Some(item) = actor.state.queue.pop_front() {
            let run_id = uuid::Uuid::new_v4().to_string();
            actor.state.current = Some(item.clone());
            actor.state.run_id = Some(run_id.clone());
            actor.state.interrupt_sent = false;
            actor.publish();
            (actor.sink)(Event::Started {
                tab_id: actor.id.clone(),
                run_id: run_id.clone(),
                item: item.clone(),
                started_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            });
            let start = Instant::now();
            let result = execute(&mut actor, &mut receiver, &item, &run_id).await;
            let result = format!(
                "{} · {:.1} 秒{}",
                result,
                start.elapsed().as_secs_f64(),
                if actor.state.interrupt_sent {
                    " · 已发送中断"
                } else {
                    ""
                }
            );
            (actor.sink)(Event::Finished {
                tab_id: actor.id.clone(),
                run_id,
                result: result.clone(),
            });
            actor.state.current = None;
            actor.state.run_id = None;
            actor.state.last_result = Some(result);
            actor.publish();
        } else if let Some(control) = receiver.recv().await {
            actor.control(control, None);
        } else {
            break;
        }
    }
    actor.state = TabState {
        closing: true,
        ..TabState::default()
    };
    actor.publish();
    done.send_replace(true);
}

async fn read_output(
    mut reader: impl AsyncRead + Unpin,
    sender: mpsc::Sender<(String, String)>,
    stream: &str,
) {
    let mut buffer = vec![0; 8192];
    let mut pending = Vec::new();
    loop {
        let length = match reader.read(&mut buffer).await {
            Ok(length) => length,
            Err(error) => {
                let _ = sender
                    .send((format!("\n读取{stream}失败：{error}\n"), "stderr".into()))
                    .await;
                break;
            }
        };
        pending.extend_from_slice(&buffer[..length]);
        let mut text = String::new();
        while !pending.is_empty() {
            match std::str::from_utf8(&pending) {
                Ok(valid) => {
                    text.push_str(valid);
                    pending.clear();
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    text.push_str(&String::from_utf8_lossy(&pending[..valid]));
                    pending.drain(..valid);
                    if let Some(length) = error.error_len() {
                        text.push('\u{fffd}');
                        pending.drain(..length);
                    } else {
                        break;
                    }
                }
            }
        }
        if length == 0 && !pending.is_empty() {
            text.push_str(&String::from_utf8_lossy(&pending));
        }
        if !text.is_empty() && sender.send((text, stream.into())).await.is_err() {
            break;
        }
        if length == 0 {
            break;
        }
    }
}

async fn execute(
    actor: &mut Actor,
    controls: &mut mpsc::Receiver<Control>,
    item: &QueueItem,
    run_id: &str,
) -> String {
    let user = match super::shells::account() {
        Ok(user) => user,
        Err(error) => return error,
    };
    if let Err(error) = super::shells::executable(std::path::Path::new(&item.shell.path)) {
        return error;
    }
    let mut command = Command::new(&item.shell.path);
    command
        .args(["-l", "-c", &item.command])
        .current_dir(user.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return format!("启动失败：{error}"),
    };
    let process_id = child.id().expect("spawned child has an id");
    let (sender, mut output) = mpsc::channel(32);
    let (done_sender, mut output_done) = mpsc::channel(2);
    let stdout_sender = sender.clone();
    let stdout_done = done_sender.clone();
    let stdout_pipe = child.stdout.take().expect("piped stdout");
    let stderr_pipe = child.stderr.take().expect("piped stderr");
    let stdout = tokio::spawn(async move {
        read_output(stdout_pipe, stdout_sender, "stdout").await;
        let _ = stdout_done.send(()).await;
    });
    let stderr_done = done_sender;
    let stderr = tokio::spawn(async move {
        read_output(stderr_pipe, sender, "stderr").await;
        let _ = stderr_done.send(()).await;
    });
    let mut exit = None;
    let mut output_readers = 0;
    let mut closing_since = None;
    let mut exited_since = None;
    let mut timer = tokio::time::interval(Duration::from_millis(25));
    loop {
        if actor.state.closing && closing_since.is_none() {
            let _ = signal(process_id, Signal::SIGINT);
            closing_since = Some(Instant::now());
        }
        if exit.is_some() && output_readers == 2 {
            break;
        }
        tokio::select! {
            control = controls.recv() => {
                match control {
                    Some(control) => actor.control(control, if exit.is_none() { Some(process_id) } else { None }),
                    None => actor.state.closing = true,
                }
            }
            message = output.recv() => {
                match message {
                    Some((text, stream)) if !actor.state.closing => (actor.sink)(Event::Output {
                        tab_id: actor.id.clone(), run_id: run_id.into(), text, stream,
                    }),
                    Some(_) => (),
                    None => (),
                }
            }
            _ = output_done.recv(), if output_readers < 2 => output_readers += 1,
            status = child.wait(), if exit.is_none() => {
                exit = Some(status);
                exited_since = Some(Instant::now());
                let _ = signal(process_id, Signal::SIGTERM);
            }
            _ = timer.tick() => {
                if let Some(start) = closing_since {
                    if start.elapsed() >= Duration::from_secs(2) { let _ = signal(process_id, Signal::SIGTERM); }
                    if start.elapsed() >= Duration::from_secs(3) { let _ = signal(process_id, Signal::SIGKILL); }
                }
                if exited_since.is_some_and(|start| start.elapsed() >= Duration::from_secs(2)) && output_readers < 2 {
                    let _ = signal(process_id, Signal::SIGKILL);
                    stdout.abort();
                    stderr.abort();
                    output_readers = 2;
                }
            }
        }
    }
    let _ = signal(process_id, Signal::SIGKILL);
    let _ = stdout.await;
    let _ = stderr.await;
    match exit {
        Some(Ok(status)) => match status.code() {
            Some(code) => format!("退出码 {code}"),
            None => format!("信号退出 {}", status.signal().unwrap_or_default()),
        },
        Some(Err(error)) => format!("等待进程失败：{error}"),
        None => "任务结束".into(),
    }
}
