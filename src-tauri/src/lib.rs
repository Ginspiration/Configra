use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

const DEFAULT_MCP_PORT: u16 = 37631;
const MCP_SERVER_ID: &str = "configra";
const MCP_DISPLAY_NAME: &str = "Configra";
const MCP_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_STARTUP_DIAGNOSTIC_LIMIT: usize = 8_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpSettings {
    version: u8,
    enabled: bool,
    #[serde(default)]
    full_access: bool,
    #[serde(default = "default_mcp_port")]
    port: u16,
    token: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            full_access: false,
            port: DEFAULT_MCP_PORT,
            token: Uuid::new_v4().simple().to_string(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpContext {
    version: u8,
    project_path: Option<String>,
    ui_dirty: bool,
    dirty_scope: String,
    full_access: bool,
    revision: u64,
    updated_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpEvents {
    version: u8,
    change_revision: u64,
    project_path: Option<String>,
    project_hash: Option<String>,
    changed_at: Option<String>,
    #[serde(default)]
    server_id: Option<String>,
    #[serde(default)]
    transaction_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStatus {
    server_id: String,
    source_id: String,
    display_name: String,
    supported_capabilities: Vec<String>,
    enabled: bool,
    running: bool,
    full_access: bool,
    port: u16,
    default_port: u16,
    connection_url: String,
    error: Option<String>,
}

fn default_mcp_port() -> u16 {
    DEFAULT_MCP_PORT
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpLogEntry {
    timestamp: String,
    #[serde(default)]
    source_id: Option<String>,
    level: String,
    message: String,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
}

struct ManagedMcpChild {
    process: Child,
    stderr_tail: Arc<Mutex<String>>,
}

struct McpState {
    child: Mutex<Option<ManagedMcpChild>>,
    startup_lock: Mutex<()>,
    reused_service: Mutex<bool>,
    last_error: Mutex<Option<String>>,
    config_dir: PathBuf,
    repo_dir: PathBuf,
}

impl McpState {
    fn new(config_dir: PathBuf, repo_dir: PathBuf) -> Self {
        Self {
            child: Mutex::new(None),
            startup_lock: Mutex::new(()),
            reused_service: Mutex::new(false),
            last_error: Mutex::new(None),
            config_dir,
            repo_dir,
        }
    }

    fn start(&self, settings: &McpSettings) -> Result<(), String> {
        let _startup_guard = self
            .startup_lock
            .lock()
            .map_err(|error| error.to_string())?;
        self.log(
            "info",
            format!("Starting MCP service on 127.0.0.1:{}.", settings.port),
        );

        let previous_failure = {
            let mut child_slot = self.child.lock().map_err(|error| error.to_string())?;
            if let Some(child) = child_slot.as_mut() {
                match child
                    .process
                    .try_wait()
                    .map_err(|error| error.to_string())?
                {
                    None => {
                        drop(child_slot);
                        if probe_mcp_health(settings) {
                            self.clear_error();
                            return Ok(());
                        }
                        return Err(format!(
                            "The previous MCP process is still running, but did not pass the authenticated health check at 127.0.0.1:{}. Restart the service or inspect the MCP log.",
                            settings.port
                        ));
                    }
                    Some(status) => {
                        let diagnostics = stderr_tail(&child.stderr_tail);
                        *child_slot = None;
                        Some(format_process_exit(
                            "A previous MCP process exited",
                            status,
                            &diagnostics,
                        ))
                    }
                }
            } else {
                None
            }
        };

        if let Some(message) = previous_failure {
            self.log("warning", message);
        }

        if probe_mcp_health(settings) {
            if let Ok(mut reused_service) = self.reused_service.lock() {
                *reused_service = true;
            }
            self.clear_error();
            self.log(
                "info",
                format!(
                    "A compatible MCP service is already ready on 127.0.0.1:{}. Reusing the existing service.",
                    settings.port
                ),
            );
            return Ok(());
        }

        if is_port_occupied(settings.port) {
            return Err(format!(
                "MCP could not start because 127.0.0.1:{} is occupied by another process that did not pass this editor's authenticated health check. Stop the process using that port, then restart MCP.",
                settings.port
            ));
        }

        let mut command = Command::new("node");
        command
            .current_dir(&self.repo_dir)
            .arg("--import")
            .arg("tsx")
            .arg("src/mcp/server.ts")
            .arg("--config-dir")
            .arg(&self.config_dir)
            .arg("--port")
            .arg(settings.port.to_string())
            .arg("--token")
            .arg(&settings.token)
            .arg("--repo")
            .arg(&self.repo_dir)
            .arg("--parent-pid")
            .arg(std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }

        let mut process = command.spawn().map_err(|error| {
            format!(
                "MCP could not launch Node.js. Ensure Node.js is installed and available to the desktop app. System error: {error}"
            )
        })?;
        let stderr_capture = process
            .stderr
            .take()
            .map(capture_stderr)
            .unwrap_or_else(|| Arc::new(Mutex::new(String::new())));
        let mut child_slot = self.child.lock().map_err(|error| error.to_string())?;
        *child_slot = Some(ManagedMcpChild {
            process,
            stderr_tail: stderr_capture,
        });
        if let Ok(mut reused_service) = self.reused_service.lock() {
            *reused_service = false;
        }
        drop(child_slot);

        let deadline = Instant::now() + MCP_STARTUP_TIMEOUT;
        loop {
            if probe_mcp_health(settings) {
                self.clear_error();
                self.log(
                    "info",
                    format!("MCP service is ready on 127.0.0.1:{}.", settings.port),
                );
                return Ok(());
            }

            let exited = {
                let mut slot = self.child.lock().map_err(|error| error.to_string())?;
                let Some(child) = slot.as_mut() else {
                    self.log("info", "MCP service startup was canceled.");
                    return Ok(());
                };
                if let Some(status) = child
                    .process
                    .try_wait()
                    .map_err(|error| error.to_string())?
                {
                    let diagnostics = stderr_tail(&child.stderr_tail);
                    *slot = None;
                    Some((status, diagnostics))
                } else {
                    None
                }
            };
            if let Some((status, diagnostics)) = exited {
                return Err(format_process_exit(
                    "MCP process exited during startup",
                    status,
                    &diagnostics,
                ));
            }

            if Instant::now() >= deadline {
                let diagnostics = self.current_stderr_tail();
                self.stop();
                return Err(format_startup_timeout(settings.port, &diagnostics));
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn stop(&self) {
        let mut stopped = false;
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.process.kill();
                let _ = child.process.wait();
                stopped = true;
            }
        }
        if let Ok(mut reused_service) = self.reused_service.lock() {
            *reused_service = false;
        }
        if stopped {
            self.log("info", "MCP service process stopped.");
        }
    }

    fn is_running(&self, settings: &McpSettings) -> bool {
        let process_failure = {
            let Ok(mut slot) = self.child.lock() else {
                return false;
            };
            let Some(child) = slot.as_mut() else {
                return self
                    .reused_service
                    .lock()
                    .map(|reused_service| *reused_service && probe_mcp_health(settings))
                    .unwrap_or(false);
            };
            match child.process.try_wait() {
                Ok(None) => None,
                Ok(Some(status)) => {
                    let diagnostics = stderr_tail(&child.stderr_tail);
                    *slot = None;
                    Some(format_process_exit(
                        "MCP process exited",
                        status,
                        &diagnostics,
                    ))
                }
                Err(error) => Some(format!("Could not inspect the MCP process: {error}")),
            }
        };
        if let Some(message) = process_failure {
            self.record_error(message);
            return false;
        }
        probe_mcp_health(settings)
    }

    fn current_stderr_tail(&self) -> String {
        self.child
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|child| stderr_tail(&child.stderr_tail)))
            .unwrap_or_default()
    }

    fn clear_error(&self) {
        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
    }

    fn record_error(&self, message: String) {
        self.log("error", &message);
        if let Ok(mut error) = self.last_error.lock() {
            *error = Some(message);
        }
    }

    fn log(&self, level: &str, message: impl AsRef<str>) {
        let _ = append_mcp_log(&self.config_dir, level, message.as_ref());
    }
}

fn capture_stderr(stderr: ChildStderr) -> Arc<Mutex<String>> {
    let tail = Arc::new(Mutex::new(String::new()));
    let target = Arc::clone(&tail);
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            if let Ok(mut output) = target.lock() {
                if !output.is_empty() {
                    output.push('\n');
                }
                output.push_str(&line);
                if output.chars().count() > MCP_STARTUP_DIAGNOSTIC_LIMIT {
                    *output = output
                        .chars()
                        .rev()
                        .take(MCP_STARTUP_DIAGNOSTIC_LIMIT)
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                }
            }
        }
    });
    tail
}

fn stderr_tail(tail: &Arc<Mutex<String>>) -> String {
    tail.lock()
        .map(|output| output.trim().to_string())
        .unwrap_or_default()
}

fn probe_mcp_health(settings: &McpSettings) -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), settings.port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(200)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
    let request = format!(
        "GET /health/{} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        settings.token, settings.port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 1024];
    let Ok(count) = stream.read(&mut response) else {
        return false;
    };
    let response = String::from_utf8_lossy(&response[..count]);
    response.starts_with("HTTP/1.1 200")
        && response.contains("\"ok\":true")
        && response.contains(&format!("\"service\":\"{MCP_SERVER_ID}\""))
}

fn is_port_occupied(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        Duration::from_millis(150),
    )
    .is_ok()
}

fn format_process_exit(
    prefix: &str,
    status: std::process::ExitStatus,
    diagnostics: &str,
) -> String {
    if diagnostics.is_empty() {
        format!(
            "{prefix} with {status}. Node.js did not provide stderr output; inspect the MCP log and confirm that Node.js and the project's dependencies are available."
        )
    } else {
        format!("{prefix} with {status}. Node.js stderr:\n{diagnostics}")
    }
}

fn format_startup_timeout(port: u16, diagnostics: &str) -> String {
    let base = format!(
        "MCP did not pass its authenticated health check on 127.0.0.1:{port} within {} seconds. The service was stopped. This can be caused by a slow or blocked Node.js startup; retry MCP after checking the diagnostic output.",
        MCP_STARTUP_TIMEOUT.as_secs()
    );
    if diagnostics.is_empty() {
        format!("{base} Node.js did not provide stderr output.")
    } else {
        format!("{base} Node.js stderr:\n{diagnostics}")
    }
}

fn mcp_log_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn append_mcp_log(config_dir: &Path, level: &str, message: &str) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let entry = McpLogEntry {
        timestamp: mcp_log_timestamp(),
        source_id: Some(MCP_SERVER_ID.to_string()),
        level: level.to_string(),
        message: message.to_string(),
        request_id: None,
        tool_name: None,
        duration_ms: None,
    };
    let text = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_path(config_dir))
        .map_err(|error| error.to_string())?;
    writeln!(file, "{text}").map_err(|error| error.to_string())
}

impl Drop for McpState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn recent_project_path_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    Ok(config_dir.join("recent-project.txt"))
}

fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("mcp-settings.json")
}

fn context_path(config_dir: &Path) -> PathBuf {
    config_dir.join("mcp-context.json")
}

fn events_path(config_dir: &Path) -> PathBuf {
    config_dir.join("mcp-events.json")
}

fn logs_path(config_dir: &Path) -> PathBuf {
    config_dir.join("mcp-logs.jsonl")
}

fn clear_mcp_log_file(config_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    fs::write(logs_path(config_dir), "").map_err(|error| error.to_string())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

fn load_or_create_settings(config_dir: &Path) -> Result<McpSettings, String> {
    let path = settings_path(config_dir);
    if path.exists() {
        let mut settings: McpSettings = read_json(&path)?;
        let mut changed = false;
        if settings.token.len() < 16 {
            settings.token = Uuid::new_v4().simple().to_string();
            changed = true;
        }
        if settings.port == 0 {
            settings.port = DEFAULT_MCP_PORT;
            changed = true;
        }
        if changed {
            write_json(&path, &settings)?;
        }
        return Ok(settings);
    }
    let settings = McpSettings::default();
    write_json(&path, &settings)?;
    Ok(settings)
}

fn status_for(state: &McpState, settings: &McpSettings) -> McpStatus {
    McpStatus {
        server_id: MCP_SERVER_ID.to_string(),
        source_id: MCP_SERVER_ID.to_string(),
        display_name: MCP_DISPLAY_NAME.to_string(),
        supported_capabilities: vec!["tools".to_string()],
        enabled: settings.enabled,
        running: settings.enabled && state.is_running(settings),
        full_access: settings.full_access,
        port: settings.port,
        default_port: DEFAULT_MCP_PORT,
        connection_url: format!("http://127.0.0.1:{}/mcp/{}", settings.port, settings.token),
        error: state.last_error.lock().ok().and_then(|error| error.clone()),
    }
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_project_file(path: String, text: String) -> Result<(), String> {
    fs::write(path, text).map_err(|error| error.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}

#[tauri::command]
fn load_recent_project_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = recent_project_path_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let recent_path = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let recent_path = recent_path.trim();
    if recent_path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(recent_path.to_string()))
    }
}

#[tauri::command]
fn save_recent_project_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    fs::write(recent_project_path_file(&app)?, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_mcp_status(state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    let settings = load_or_create_settings(&state.config_dir)?;
    Ok(status_for(&state, &settings))
}

#[tauri::command]
fn set_mcp_enabled(state: tauri::State<'_, McpState>, enabled: bool) -> Result<McpStatus, String> {
    let mut settings = load_or_create_settings(&state.config_dir)?;
    settings.enabled = enabled;
    write_json(&settings_path(&state.config_dir), &settings)?;
    if enabled {
        if let Err(error) = state.start(&settings) {
            state.record_error(error);
        }
    } else {
        state.stop();
        state.clear_error();
    }
    Ok(status_for(&state, &settings))
}

#[tauri::command]
fn restart_mcp(state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    let settings = load_or_create_settings(&state.config_dir)?;
    if !settings.enabled {
        return Err("Enable the local MCP service before restarting it.".to_string());
    }

    state.log("info", "MCP restart requested.");
    state.stop();
    state.clear_error();
    if let Err(error) = state.start(&settings) {
        state.record_error(error);
    }
    Ok(status_for(&state, &settings))
}

fn update_mcp_port(state: &McpState, port: u16) -> Result<McpStatus, String> {
    if port == 0 {
        return Err("MCP port must be between 1 and 65535.".to_string());
    }

    let mut settings = load_or_create_settings(&state.config_dir)?;
    if settings.port == port {
        return Ok(status_for(state, &settings));
    }

    let previous_port = settings.port;
    settings.port = port;
    write_json(&settings_path(&state.config_dir), &settings)?;
    state.log(
        "info",
        format!("MCP port changed from {previous_port} to {port}."),
    );
    state.clear_error();

    if settings.enabled {
        state.stop();
        if let Err(error) = state.start(&settings) {
            state.record_error(error);
        }
    }

    Ok(status_for(state, &settings))
}

#[tauri::command]
fn set_mcp_port(state: tauri::State<'_, McpState>, port: u16) -> Result<McpStatus, String> {
    update_mcp_port(&state, port)
}

#[tauri::command]
fn reset_mcp_port(state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    update_mcp_port(&state, DEFAULT_MCP_PORT)
}

#[tauri::command]
fn set_mcp_full_access(
    state: tauri::State<'_, McpState>,
    full_access: bool,
) -> Result<McpStatus, String> {
    let mut settings = load_or_create_settings(&state.config_dir)?;
    settings.full_access = full_access;
    write_json(&settings_path(&state.config_dir), &settings)?;
    Ok(status_for(&state, &settings))
}

#[tauri::command]
fn update_mcp_context(
    state: tauri::State<'_, McpState>,
    project_path: Option<String>,
    ui_dirty: bool,
    dirty_scope: String,
    full_access: bool,
    revision: u64,
    updated_at: String,
) -> Result<(), String> {
    if !matches!(dirty_scope.as_str(), "none" | "layout" | "content") {
        return Err("Invalid MCP dirty scope.".to_string());
    }
    write_json(
        &context_path(&state.config_dir),
        &McpContext {
            version: 1,
            project_path,
            ui_dirty,
            dirty_scope,
            full_access,
            revision,
            updated_at,
        },
    )
}

#[tauri::command]
fn get_mcp_logs(state: tauri::State<'_, McpState>) -> Result<Vec<McpLogEntry>, String> {
    let path = logs_path(&state.config_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut entries = text
        .lines()
        .filter_map(|line| serde_json::from_str::<McpLogEntry>(line).ok())
        .collect::<Vec<_>>();
    const MAX_LOG_ENTRIES: usize = 300;
    if entries.len() > MAX_LOG_ENTRIES {
        entries.drain(..entries.len() - MAX_LOG_ENTRIES);
    }
    Ok(entries)
}

#[tauri::command]
fn clear_mcp_logs(state: tauri::State<'_, McpState>) -> Result<(), String> {
    clear_mcp_log_file(&state.config_dir)
}

#[tauri::command]
fn get_mcp_events(state: tauri::State<'_, McpState>) -> Result<McpEvents, String> {
    let path = events_path(&state.config_dir);
    if !path.exists() {
        return Ok(McpEvents {
            version: 1,
            ..McpEvents::default()
        });
    }
    read_json(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project_file,
            write_project_file,
            path_exists,
            load_recent_project_path,
            save_recent_project_path,
            get_mcp_status,
            set_mcp_enabled,
            restart_mcp,
            set_mcp_port,
            reset_mcp_port,
            set_mcp_full_access,
            update_mcp_context,
            get_mcp_events,
            get_mcp_logs,
            clear_mcp_logs
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let config_dir = app.path().app_config_dir()?;
            fs::create_dir_all(&config_dir)?;
            let repo_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or_else(|| std::io::Error::other("Could not locate repository root."))?
                .to_path_buf();
            let state = McpState::new(config_dir.clone(), repo_dir);
            let settings = load_or_create_settings(&config_dir).map_err(std::io::Error::other)?;

            let recent_path = load_recent_project_path(app.handle().clone()).unwrap_or(None);
            write_json(
                &context_path(&config_dir),
                &McpContext {
                    version: 1,
                    project_path: recent_path,
                    ui_dirty: false,
                    dirty_scope: "none".to_string(),
                    full_access: settings.full_access,
                    revision: 0,
                    updated_at: "1970-01-01T00:00:00.000Z".to_string(),
                },
            )
            .map_err(std::io::Error::other)?;

            app.manage(state);

            if settings.enabled {
                let app_handle = app.handle().clone();
                thread::spawn(move || {
                    let state = app_handle.state::<McpState>();
                    if let Err(error) = state.start(&settings) {
                        state.record_error(error);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_port_uses_default_when_missing() {
        let settings: McpSettings = serde_json::from_value(serde_json::json!({
            "version": 1,
            "enabled": false,
            "fullAccess": false,
            "token": "0123456789abcdef"
        }))
        .expect("settings without a port should remain compatible");

        assert_eq!(settings.port, DEFAULT_MCP_PORT);
    }

    #[test]
    fn mcp_port_change_and_reset_are_persisted() {
        let config_dir = std::env::temp_dir().join(format!(
            "configra-mcp-port-test-{}",
            Uuid::new_v4().simple()
        ));

        let result = (|| -> Result<(), String> {
            let state = McpState::new(config_dir.clone(), PathBuf::new());
            assert!(update_mcp_port(&state, 0).is_err());

            let custom_status = update_mcp_port(&state, 43123)?;
            assert_eq!(custom_status.port, 43123);
            assert_eq!(custom_status.default_port, DEFAULT_MCP_PORT);
            assert_eq!(load_or_create_settings(&config_dir)?.port, 43123);

            let reset_status = update_mcp_port(&state, DEFAULT_MCP_PORT)?;
            assert_eq!(reset_status.port, DEFAULT_MCP_PORT);
            assert_eq!(load_or_create_settings(&config_dir)?.port, DEFAULT_MCP_PORT);
            Ok(())
        })();

        let _ = fs::remove_dir_all(&config_dir);
        result.expect("custom and default MCP ports should persist in mcp-settings.json");
    }
}
