mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // настройки приложения на этом компьютере (тема, вид, фильтры, адрес сервера)
        .plugin(tauri_plugin_store::Builder::new().build())
        // запросы к серверу идут из Rust: без CORS и с любым адресом, http и https
        .plugin(tauri_plugin_http::init())
        .setup(|_app| {
            secrets::init();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![secrets::token_get, secrets::token_set, secrets::token_delete])
        .run(tauri::generate_context!())
        .expect("не удалось запустить PlexoLab");
}
