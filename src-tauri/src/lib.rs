use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

const MCP_PORT: u16 = 37631;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpSettings {
    version: u8,
    enabled: bool,
    #[serde(default)]
    full_access: bool,
    port: u16,
    token: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            full_access: false,
            port: MCP_PORT,
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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStatus {
    enabled: bool,
    running: bool,
    full_access: bool,
    port: u16,
    connection_url: String,
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpLogEntry {
    timestamp: String,
    level: String,
    message: String,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
}

struct McpState {
    child: Mutex<Option<Child>>,
    last_error: Mutex<Option<String>>,
    config_dir: PathBuf,
    repo_dir: PathBuf,
}

impl McpState {
    fn new(config_dir: PathBuf, repo_dir: PathBuf) -> Self {
        Self {
            child: Mutex::new(None),
            last_error: Mutex::new(None),
            config_dir,
            repo_dir,
        }
    }

    fn start(&self, settings: &McpSettings) -> Result<(), String> {
        let mut child_slot = self.child.lock().map_err(|error| error.to_string())?;
        if let Some(child) = child_slot.as_mut() {
            match child.try_wait().map_err(|error| error.to_string())? {
                None => return Ok(()),
                Some(_) => {
                    *child_slot = None;
                }
            }
        }

        if TcpStream::connect_timeout(
            &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), settings.port),
            Duration::from_millis(150),
        )
        .is_ok()
        {
            return Err(format!("Port {} is already in use.", settings.port));
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
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }

        let child = command
            .spawn()
            .map_err(|error| format!("Could not start MCP: {error}"))?;
        *child_slot = Some(child);
        drop(child_slot);

        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if TcpStream::connect_timeout(
                &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), settings.port),
                Duration::from_millis(100),
            )
            .is_ok()
            {
                if let Ok(mut error) = self.last_error.lock() {
                    *error = None;
                }
                return Ok(());
            }

            {
                let mut slot = self.child.lock().map_err(|error| error.to_string())?;
                if let Some(child) = slot.as_mut() {
                    if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                        *slot = None;
                        return Err(format!("MCP process exited during startup with {status}."));
                    }
                }
            }

            if Instant::now() >= deadline {
                self.stop();
                return Err("MCP did not become ready within 8 seconds.".to_string());
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn stop(&self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn is_running(&self) -> bool {
        let Ok(mut slot) = self.child.lock() else {
            return false;
        };
        let Some(child) = slot.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(status)) => {
                *slot = None;
                if let Ok(mut error) = self.last_error.lock() {
                    *error = Some(format!("MCP process exited with {status}."));
                }
                false
            }
            Err(error) => {
                if let Ok(mut last_error) = self.last_error.lock() {
                    *last_error = Some(error.to_string());
                }
                false
            }
        }
    }
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
        if settings.token.len() < 16 {
            settings.token = Uuid::new_v4().simple().to_string();
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
        enabled: settings.enabled,
        running: state.is_running(),
        full_access: settings.full_access,
        port: settings.port,
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
            if let Ok(mut last_error) = state.last_error.lock() {
                *last_error = Some(error);
            }
        }
    } else {
        state.stop();
        if let Ok(mut last_error) = state.last_error.lock() {
            *last_error = None;
        }
    }
    Ok(status_for(&state, &settings))
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
            clear_mcp_log_file(&config_dir).map_err(std::io::Error::other)?;
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

            if settings.enabled {
                if let Err(error) = state.start(&settings) {
                    if let Ok(mut last_error) = state.last_error.lock() {
                        *last_error = Some(error);
                    }
                }
            }
            app.manage(state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
