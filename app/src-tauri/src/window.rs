// Главное окно и значок в области уведомлений (трей): показать, спрятать, выйти.
// Что делает крестик и когда нужно спросить про неотправленный текст, решает клиент (app/src/lib/useCloseGuard.ts):
// настройка «Сворачивать в трей при закрытии» лежит в его локальных настройках.

use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Метка главного окна (`tauri.conf.json`)
const MAIN: &str = "main";

/// Событие «выбрали Выйти в меню трея»: клиент сначала отправит неотправленный текст, потом позовёт `quit_app`
pub const TRAY_QUIT: &str = "tray-quit";

/// Аргумент, с которым Windows запускает приложение при входе в систему (`tauri-plugin-autostart`)
pub const AUTOSTART_ARG: &str = "--autostart";

/// Показывает окно и выводит его вперёд: из трея, из свёрнутого, из-под других окон
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.hide();
    }
}

/// Значок в трее: щелчок показывает окно или прячет, если оно на виду
fn toggle_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    let on_screen = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if on_screen { hide_main(app) } else { show_main(app) }
}

/// Значок и меню трея: «Открыть PlexoLab», «Выйти»
pub fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть PlexoLab", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("PlexoLab")
        .menu(&menu)
        // левая кнопка показывает окно, меню открывается правой
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            // выходить напрямую нельзя: в окне может быть неотправленный текст
            "quit" => {
                let _ = app.emit(TRAY_QUIT, ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Приложение запущено самой Windows при входе: окно не показываем, приложение ждёт в трее
pub fn started_by_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    hide_main(&app);
}

/// Завершает приложение целиком (из трея, после проверки неотправленного текста)
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
