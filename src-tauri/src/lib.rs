mod database;

use database::{
  adjust_local_product_stock, close_local_cash_session, count_local_products,
  create_local_remate, dispose_local_product, find_local_product_by_barcode,
  generate_next_local_barcode, get_local_app_setting, get_local_cash_session_report, get_local_database_info,
  get_local_session_sales_stats, get_local_sync_queue_stats, get_open_local_cash_session, initialize_database,
  list_local_bodega_products, list_local_cash_sessions, list_local_expenses, list_local_printers,
  list_local_inventory_movements, list_local_partners, list_local_products, list_local_sales,
  list_local_product_keys, list_local_sync_queue, mark_local_sync_queue_item_failed,
  mark_local_sync_queue_item_synced, open_local_cash_session, print_text_ticket_silent, register_local_sale,
  remove_local_sync_queue_item, requeue_all_failed_local_sync_queue_items, requeue_local_sync_queue_item,
  set_local_app_setting, upsert_local_expense, upsert_local_product, upsert_remote_partners, upsert_remote_products,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let database_state = initialize_database(app.handle())?;
      app.manage(database_state);

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(desktop)]
      app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_local_database_info,
      get_local_app_setting,
      set_local_app_setting,
      get_open_local_cash_session,
      open_local_cash_session,
      close_local_cash_session,
      register_local_sale,
      get_local_session_sales_stats,
      list_local_sales,
      list_local_cash_sessions,
      get_local_cash_session_report,
      adjust_local_product_stock,
      list_local_inventory_movements,
      list_local_bodega_products,
      create_local_remate,
      dispose_local_product,
      list_local_partners,
      get_local_sync_queue_stats,
      list_local_sync_queue,
      remove_local_sync_queue_item,
      mark_local_sync_queue_item_synced,
      mark_local_sync_queue_item_failed,
      requeue_local_sync_queue_item,
      requeue_all_failed_local_sync_queue_items,
      list_local_expenses,
      upsert_local_expense,
      upsert_remote_partners,
      list_local_products,
      list_local_product_keys,
      count_local_products,
      upsert_remote_products,
      find_local_product_by_barcode,
      generate_next_local_barcode,
      upsert_local_product,
      list_local_printers,
      print_text_ticket_silent
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
