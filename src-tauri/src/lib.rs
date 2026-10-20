mod backup;
mod controller;
#[cfg(test)]
mod hardware_tests;
mod ir;
mod manager;
mod protocol;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, State};

use backup::Backup;
use ir::IrSettings;
use manager::{ApiError, App, Snapshot, WriteReport};
use protocol::{HomeMode, Side, StickCal};

type Shared<'a> = State<'a, Arc<App>>;
type Res<T> = Result<T, ApiError>;

/// Les commandes bloquent (elles attendent la manette) : jamais sur le fil de l'interface.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .expect("tâche interrompue")
}

#[tauri::command]
fn get_snapshot(app: Shared) -> Snapshot {
    app.snapshot()
}

#[tauri::command]
fn rescan(app: Shared) {
    app.rescan();
}

#[tauri::command]
fn set_demo(app: Shared, on: bool) {
    app.set_demo(on);
}

#[tauri::command]
async fn read_colors(app: Shared<'_>, side: Side) -> Res<(String, String)> {
    let app = app.inner().clone();
    blocking(move || app.read_colors(side)).await
}

#[tauri::command]
async fn write_colors(
    app: Shared<'_>,
    side: Side,
    body: String,
    buttons: String,
) -> Res<WriteReport> {
    let app = app.inner().clone();
    blocking(move || app.write_colors(side, &body, &buttons)).await
}

#[tauri::command]
async fn write_calibration(app: Shared<'_>, side: Side, cal: StickCal) -> Res<WriteReport> {
    let app = app.inner().clone();
    blocking(move || app.write_calibration(side, cal)).await
}

#[tauri::command]
async fn reset_calibration(app: Shared<'_>, side: Side) -> Res<WriteReport> {
    let app = app.inner().clone();
    blocking(move || app.reset_calibration(side)).await
}

#[tauri::command]
fn list_backups(app: Shared) -> Vec<Backup> {
    app.list_backups()
}

#[tauri::command]
fn delete_backup(app: Shared, id: String) -> Res<()> {
    app.delete_backup(&id)
}

#[tauri::command]
async fn restore_backup(app: Shared<'_>, id: String) -> Res<WriteReport> {
    let app = app.inner().clone();
    blocking(move || app.restore_backup(&id)).await
}

#[tauri::command]
async fn start_spi_dump(app: Shared<'_>, side: Side, path: String) -> Res<String> {
    let app = app.inner().clone();
    blocking(move || app.start_spi_dump(side, PathBuf::from(path))).await
}

/// Écrit un fichier choisi par l'utilisateur dans une boîte de dialogue (PNG ou BIN seulement).
#[tauri::command]
fn save_bytes(request: tauri::ipc::Request) -> Res<()> {
    let hex = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let path = backup::from_hex(hex)
        .and_then(|b| String::from_utf8(b).ok())
        .ok_or("invalid_path")?;
    let allowed = ["png", "bin"];
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !allowed.contains(&ext.as_str()) {
        return Err("invalid_path".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("invalid_path".into());
    };
    std::fs::write(&path, bytes).map_err(|e| ApiError {
        code: "io".into(),
        detail: e.to_string(),
    })
}

#[tauri::command]
fn cancel_task(app: Shared, id: String) {
    app.cancel_task(&id);
}

#[tauri::command]
async fn rumble(
    app: Shared<'_>,
    side: Option<Side>,
    low: f32,
    high: f32,
    amp: f32,
    ms: u64,
) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.rumble(side, low, high, amp, ms)).await
}

#[tauri::command]
async fn home_light(app: Shared<'_>, mode: HomeMode, intensity: u8) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.home_light(mode, intensity)).await
}

#[tauri::command]
async fn player_leds(app: Shared<'_>, mask: u8) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.player_leds(mask)).await
}

#[tauri::command]
async fn ir_start(app: Shared<'_>, settings: IrSettings) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.ir_start(settings)).await
}

#[tauri::command]
async fn ir_apply(app: Shared<'_>, settings: IrSettings) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.ir_apply(settings)).await
}

#[tauri::command]
async fn ir_stop(app: Shared<'_>) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.ir_stop()).await
}

#[tauri::command]
async fn ir_write_register(app: Shared<'_>, addr: u16, val: u8) -> Res<()> {
    let app = app.inner().clone();
    blocking(move || app.ir_write_register(addr, val)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|tauri_app| {
            let dir = tauri_app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("backups");
            let (app, wake_rx) = App::new(tauri_app.handle().clone(), dir);
            tauri_app.manage(app.clone());
            std::thread::Builder::new()
                .name("monitor".into())
                .spawn(move || app.monitor(wake_rx))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            rescan,
            set_demo,
            read_colors,
            write_colors,
            write_calibration,
            reset_calibration,
            list_backups,
            delete_backup,
            restore_backup,
            start_spi_dump,
            cancel_task,
            save_bytes,
            rumble,
            home_light,
            player_leds,
            ir_start,
            ir_apply,
            ir_stop,
            ir_write_register,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Joycon Studio");
}
