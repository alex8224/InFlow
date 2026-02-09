use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::Manager;

mod commands;
mod capability_catalog;
mod config;
mod deeplink;
mod genai_client;
mod llm_tools;
mod mcp;
mod share_server;
mod state;
mod types;
mod windowing;

use commands::*;
use deeplink::handle_deep_link;
use state::AppState;
use windowing::show_main_window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            invocations_by_label: Mutex::new(HashMap::new()),
            pet_queue_by_label: Mutex::new(HashMap::new()),
            last_active_by_type: Mutex::new(HashMap::new()),
            chat_sessions: Mutex::new(HashMap::new()),
            chat_cancel_flags: Mutex::new(HashMap::new()),
            chat_cancel_notifiers: Mutex::new(HashMap::new()),
            translate_cancel_flags: Mutex::new(HashMap::new()),
            translate_cancel_notifiers: Mutex::new(HashMap::new()),
            mcp_services: Mutex::new(HashMap::new()),
            mcp_tools_cache: Mutex::new(HashMap::new()),
            mcp_sessions: Mutex::new(HashMap::new()),
            is_quitting: AtomicBool::new(false),
            #[cfg(desktop)]
            tray: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.len() > 1 {
                handle_deep_link(app, args[1].clone());
            }
        }))
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                if state.is_quitting.load(Ordering::SeqCst) {
                    return;
                }

                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            #[cfg(all(desktop, not(test)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("inflow");
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    for url in urls {
                        handle_deep_link(&handle, url.to_string());
                    }
                });
            }

            #[cfg(desktop)]
            {
                use tauri::menu::MenuBuilder;
                use tauri::tray::TrayIconBuilder;

                let handle = app.handle();
                let menu = MenuBuilder::new(handle)
                    .text("settings", "设置")
                    .separator()
                    .text("quit", "退出")
                    .build()?;

                let tray = TrayIconBuilder::with_id("main_tray")
                    .menu(&menu)
                    .icon(tauri::include_image!("icons/32x32.png"))
                    .tooltip("inFlow")
                    .on_menu_event(|app, event| match event.id.0.as_str() {
                        "settings" => {
                            let _ = show_main_window(app);
                        }
                        "quit" => {
                            let state = app.state::<AppState>();
                            state.is_quitting.store(true, Ordering::SeqCst);
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(handle)?;

                app.state::<AppState>().tray.lock().unwrap().replace(tray);

                // Ensure the main window is only shown from the tray menu.
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.hide();
                }
            }

            // Warm MCP tools cache in the background so opening the Tools panel feels instant.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let config = crate::config::AppConfig::load();
                    if config.mcp_remote_servers.iter().all(|s| !s.enabled) {
                        return;
                    }
                    let state = handle.state::<AppState>();
                    let _ = crate::mcp::get_cached_mcp_tools(&config, &state).await;
                });
            }

            // Start the share server in the background (delayed to avoid blocking startup)
            std::thread::spawn(|| {
                // Small delay to ensure main app is fully initialized
                std::thread::sleep(std::time::Duration::from_millis(500));
                match crate::share_server::start_server() {
                    Ok(port) => println!("[share-server] Started on port {}", port),
                    Err(e) => eprintln!("[share-server] Failed to start: {}", e),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            translate::translate_text,
            translate::translate_text_ai_stream,
            translate::translate_cancel,
            app::get_app_config,
            app::update_app_config,
            app::get_api_key_status,
            chat::chat_session_create,
            chat::chat_stream,
            chat::chat_cancel,
            chat::chat_tools_catalog,
            chat::chat_infer_title,
            capability::execute_capability,
            capability::execute_capability_v2,
            capability::get_capability_catalog,
            capability::get_current_invocation,
            misc::show_overlay,
            misc::close_overlay,
            misc::open_workspace,
            misc::get_clipboard_text,
            misc::get_clipboard_image,
            misc::read_local_image_data_url,
            misc::handle_deep_link_from_frontend,
            share::chat_share_create,
            share::get_share_server_port,
            action_predict::predict_actions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
