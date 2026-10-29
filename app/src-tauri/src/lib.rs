mod secrets;
mod window;

use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // вторая копия не запускается: её запуск показывает первую (она может прятаться в трее).
        // Плагин подключается первым, чтобы вторая копия успела выйти, не создавая окон.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::show_main(app)))
        // размер и положение окна запоминаются; «спрятано в трее» не запоминается: окно при запуске решает само (setup)
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() - StateFlags::VISIBLE).build())
        // настройки приложения на этом компьютере (тема, вид, фильтры, адрес сервера)
        .plugin(tauri_plugin_store::Builder::new().build())
        // запросы к серверу идут из Rust: без CORS и с любым адресом, http и https
        .plugin(tauri_plugin_http::init())
        // внешние ссылки (вики, ссылки команды) открываются в системном браузере
        .plugin(tauri_plugin_opener::init())
        // окошки Windows о новых уведомлениях (app/src/features/notifications/desktop.ts)
        .plugin(tauri_plugin_notification::init())
        // запуск вместе с Windows; по аргументу приложение понимает, что его запустила система
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![window::AUTOSTART_ARG])))
        .setup(|app| {
            secrets::init();
            window::init_tray(app.handle())?;
            // окно в настройках создаётся спрятанным; при ручном запуске показываем, при запуске системой остаётся в трее
            if !window::started_by_autostart() {
                window::show_main(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secrets::token_get,
            secrets::token_set,
            secrets::token_delete,
            window::show_main_window,
            window::hide_main_window,
            window::quit_app
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить PlexoLab");
}
