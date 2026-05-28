use std::{fs, path::PathBuf};

use tauri::Manager;

fn recent_project_path_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
  fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
  Ok(config_dir.join("recent-project.txt"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      read_project_file,
      write_project_file,
      load_recent_project_path,
      save_recent_project_path
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
