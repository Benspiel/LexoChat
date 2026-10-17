//! Native part of the LexiChat Windows app.
//!
//! - small secrets (session) in the Windows Credential Manager (DPAPI, bound to the Windows account)
//! - encrypted local cache (XChaCha20-Poly1305, key in the Credential Manager) – holds no plaintext messages
//! - screenshot protection (SetWindowDisplayAffinity / WDA_EXCLUDEFROMCAPTURE)
//! - tray icon with "Sperren", single instance, autostart, signed updates

mod cache;
mod secrets;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    secrets::get(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    secrets::delete(&key)
}

#[tauri::command]
fn cache_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    cache::read(&app, &name)
}

#[tauri::command]
fn cache_write(app: tauri::AppHandle, name: String, data: String) -> Result<(), String> {
    cache::write(&app, &name, &data)
}

#[tauri::command]
fn cache_clear(app: tauri::AppHandle) -> Result<(), String> {
    cache::clear(&app)
}

#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map(|n| format!("Windows-App · {}", n.chars().take(40).collect::<String>()))
        .unwrap_or_else(|_| "Windows-App".into())
}

/// Excludes the window from screenshots and screen sharing. Photographing the
/// screen can of course not be prevented.
#[tauri::command]
fn set_capture_protection(window: tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        };
        let raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(raw.0);
        let affinity = if enabled {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        unsafe { SetWindowDisplayAffinity(hwnd, affinity) }.map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, enabled);
        Ok(false)
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // must be the first plugin: a second start focuses the running instance
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            secret_delete,
            cache_read,
            cache_write,
            cache_clear,
            device_name,
            set_capture_protection
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "LexiChat öffnen", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "Sperren", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &lock, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("LexiChat")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "lock" => {
                        let _ = app.emit("lexichat://lock", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the window keeps LexiChat in the tray (notifications keep working)
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LexiChat");
}
