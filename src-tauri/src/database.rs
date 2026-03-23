use std::{
    ffi::c_void,
    fs,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
    ptr::null_mut,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, ToSql, Transaction};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::HANDLE,
    Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, GetDefaultPrinterW, OpenPrinterW,
        StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
    },
    System::Threading::CREATE_NO_WINDOW,
};

const DB_FILE_NAME: &str = "pos_tienda_local.db3";
const SCHEMA_VERSION: i64 = 3;

const MIGRATIONS_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partners (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  is_expense_eligible INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  barcode TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  owner_id TEXT NOT NULL,
  owner_remote_id TEXT,
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  sale_price_x3 REAL,
  sale_price_x6 REAL,
  sale_price_x12 REAL,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_clearance INTEGER NOT NULL DEFAULT 0,
  clearance_price REAL,
  bodega_at TEXT,
  disposed_at TEXT,
  bodega_stock INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_owner_id ON products(owner_id);
CREATE INDEX IF NOT EXISTS idx_products_remote_id ON products(remote_id);

CREATE TABLE IF NOT EXISTS cash_sessions (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  opened_by_remote_id TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  cash_session_local_id TEXT NOT NULL,
  cash_session_remote_id TEXT,
  sold_by_remote_id TEXT,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  amount_received REAL,
  change_given REAL,
  idempotency_key TEXT UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  FOREIGN KEY(cash_session_local_id) REFERENCES cash_sessions(local_id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  sale_local_id TEXT NOT NULL,
  sale_remote_id TEXT,
  product_local_id TEXT,
  product_remote_id TEXT,
  product_name TEXT NOT NULL,
  product_barcode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  price_tier TEXT NOT NULL DEFAULT 'normal',
  subtotal REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  FOREIGN KEY(sale_local_id) REFERENCES sales(local_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  cash_session_local_id TEXT NOT NULL,
  cash_session_remote_id TEXT,
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  registered_by_remote_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  FOREIGN KEY(cash_session_local_id) REFERENCES cash_sessions(local_id)
);

CREATE TABLE IF NOT EXISTS expense_allocations (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  expense_local_id TEXT NOT NULL,
  expense_remote_id TEXT,
  partner_id TEXT NOT NULL,
  partner_remote_id TEXT,
  amount REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  FOREIGN KEY(expense_local_id) REFERENCES expenses(local_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  local_id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  product_id TEXT NOT NULL,
  product_remote_id TEXT,
  quantity_change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_local_id TEXT,
  reference_remote_id TEXT,
  performed_by_remote_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_queue (
  local_id TEXT PRIMARY KEY,
  entity_name TEXT NOT NULL,
  entity_local_id TEXT NOT NULL,
  entity_remote_id TEXT,
  operation_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);

CREATE TABLE IF NOT EXISTS sync_journal (
  local_id TEXT PRIMARY KEY,
  entity_name TEXT NOT NULL,
  entity_local_id TEXT NOT NULL,
  entity_remote_id TEXT,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

#[derive(Clone)]
pub struct DatabaseState {
    pub db_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub db_path: String,
    pub file_exists: bool,
    pub file_size_bytes: u64,
    pub schema_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAppSettingValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalPartner {
    pub id: String,
    pub remote_id: Option<String>,
    pub name: String,
    pub display_name: String,
    pub color_hex: String,
    pub is_expense_eligible: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalProduct {
    pub id: String,
    pub remote_id: Option<String>,
    pub barcode: String,
    pub sku: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub owner_id: String,
    pub purchase_price: f64,
    pub sale_price: f64,
    pub sale_price_x3: Option<f64>,
    pub sale_price_x6: Option<f64>,
    pub sale_price_x12: Option<f64>,
    pub stock: i64,
    pub min_stock: i64,
    pub image_url: Option<String>,
    pub is_active: bool,
    pub is_clearance: bool,
    pub clearance_price: Option<f64>,
    pub bodega_at: Option<String>,
    pub disposed_at: Option<String>,
    pub bodega_stock: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalProductWithOwner {
    #[serde(flatten)]
    pub product: LocalProduct,
    pub owner: LocalPartner,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalProductKey {
    pub id: String,
    pub remote_id: Option<String>,
    pub barcode: String,
    pub sku: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductQuery {
    pub search: Option<String>,
    pub owner_id: Option<String>,
    pub stock_filter: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductCounts {
    pub total_count: i64,
    pub out_count: i64,
    pub low_count: i64,
    pub available_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertLocalProductInput {
    pub product_id: Option<String>,
    pub remote_id: Option<String>,
    pub barcode: String,
    pub sku: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub owner_id: String,
    pub purchase_price: f64,
    pub sale_price: f64,
    pub sale_price_x3: Option<f64>,
    pub sale_price_x6: Option<f64>,
    pub sale_price_x12: Option<f64>,
    pub stock: i64,
    pub min_stock: i64,
    pub is_active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertLocalProductResult {
    pub product_id: String,
    pub movement_delta: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalCashSession {
    pub id: String,
    pub remote_id: Option<String>,
    pub opened_by: Option<String>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub opening_cash: f64,
    pub closing_cash: Option<f64>,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalExpenseAllocationWithPartner {
    pub id: String,
    pub partner_id: String,
    pub amount: f64,
    pub partner: LocalPartner,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalExpenseWithAllocations {
    pub id: String,
    pub remote_id: Option<String>,
    pub cash_session_id: String,
    pub amount: f64,
    pub description: String,
    pub scope: String,
    pub idempotency_key: Option<String>,
    pub registered_by: Option<String>,
    pub created_at: String,
    pub synced: bool,
    pub expense_allocations: Vec<LocalExpenseAllocationWithPartner>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertLocalExpenseInput {
    pub expense_id: Option<String>,
    pub cash_session_id: String,
    pub amount: f64,
    pub description: String,
    pub scope: String,
    pub partner_id: Option<String>,
    pub shared_partner_ids: Option<Vec<String>>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertLocalExpenseResult {
    pub expense_id: String,
    pub allocation_count: i64,
}

fn default_price_tier() -> String {
    "normal".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterLocalSaleItemInput {
    pub product_id: String,
    pub quantity: i64,
    pub unit_price: f64,
    #[serde(default = "default_price_tier")]
    pub price_tier: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterLocalSaleInput {
    pub cash_session_id: String,
    pub payment_method: String,
    pub items: Vec<RegisterLocalSaleItemInput>,
    pub notes: Option<String>,
    pub amount_received: Option<f64>,
    pub change_given: Option<f64>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterLocalSaleResult {
    pub sale_id: String,
    pub total: f64,
    pub item_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionSalesStats {
    pub total_sales: f64,
    pub total_cash: f64,
    pub total_transfer: f64,
    pub sale_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalSaleHistoryItem {
    pub id: String,
    pub product_name: String,
    pub quantity: i64,
    pub unit_price: f64,
    pub price_tier: String,
    pub subtotal: f64,
    pub owner_id: String,
    pub partner: Option<LocalPartner>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalSaleHistory {
    pub id: String,
    pub remote_id: Option<String>,
    pub created_at: String,
    pub total: f64,
    pub payment_method: String,
    pub sold_by_partner: Option<LocalPartner>,
    pub sale_items: Vec<LocalSaleHistoryItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalCashSessionReportRow {
    pub session_id: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub partner_id: String,
    pub partner: String,
    pub display_name: String,
    pub color_hex: String,
    pub total_sales: f64,
    pub total_expenses: f64,
    pub net_total: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalInventoryMovementProduct {
    pub id: String,
    pub name: String,
    pub barcode: String,
    pub owner: Option<LocalPartner>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalInventoryMovementWithProduct {
    pub id: String,
    pub product_id: String,
    pub quantity_change: i64,
    pub reason: String,
    pub reference_id: Option<String>,
    pub performed_by: Option<String>,
    pub created_at: String,
    pub product: Option<LocalInventoryMovementProduct>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjustLocalProductStockResult {
    pub product_id: String,
    pub new_stock: i64,
    pub movement_delta: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct LocalBodegaProduct {
    pub id: String,
    pub remote_id: Option<String>,
    pub name: String,
    pub barcode: String,
    pub sku: Option<String>,
    pub sale_price: f64,
    pub sale_price_x3: Option<f64>,
    pub sale_price_x6: Option<f64>,
    pub sale_price_x12: Option<f64>,
    pub stock: i64,
    pub bodega_stock: i64,
    pub bodega_at: Option<String>,
    pub is_active: bool,
    pub owner: Option<LocalPartner>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocalRemateResult {
    pub product_id: String,
    pub product_name: String,
    pub original_price: f64,
    pub remate_price: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisposeLocalProductResult {
    pub product_id: String,
    pub product_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncQueueItem {
    pub id: String,
    pub entity_name: String,
    pub entity_local_id: String,
    pub entity_remote_id: Option<String>,
    pub operation_type: String,
    pub payload_json: String,
    pub idempotency_key: Option<String>,
    pub status: String,
    pub attempts: i64,
    pub next_retry_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncQueueStats {
    pub total: i64,
    pub pending: i64,
    pub failed: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalPrinterInfo {
    pub name: String,
    pub is_default: bool,
    pub is_offline: bool,
    pub printer_status: Option<i64>,
    pub is_virtual: bool,
}

#[derive(Debug, Deserialize)]
struct WindowsPrinterInfo {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Default")]
    default_printer: Option<bool>,
    #[serde(rename = "WorkOffline")]
    work_offline: Option<bool>,
    #[serde(rename = "PrinterStatus")]
    printer_status: Option<i64>,
}

pub fn initialize_database(app: &AppHandle) -> Result<DatabaseState, String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo resolver carpeta local: {error}"))?;

    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("No se pudo crear carpeta local de la app: {error}"))?;

    let db_path = app_dir.join(DB_FILE_NAME);
    let mut connection = open_connection(&db_path)?;

    if let Err(error) = connection.execute_batch(MIGRATIONS_SQL) {
        drop(connection);
        backup_and_reset_incompatible_database(&db_path)?;
        connection = open_connection(&db_path)?;
        connection
      .execute_batch(MIGRATIONS_SQL)
      .map_err(|retry_error| {
        format!(
          "No se pudo aplicar schema local despues de recrear la base. Error original: {error}. Error final: {retry_error}"
        )
      })?;
    }

    apply_incremental_sqlite_migrations(&connection)?;

    connection
        .execute(
            "INSERT INTO app_settings (key, value) VALUES ('schema_version', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|error| format!("No se pudo registrar schema_version local: {error}"))?;

    Ok(DatabaseState { db_path })
}

fn sqlite_table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma_sql = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&pragma_sql)
        .map_err(|error| format!("No se pudo inspeccionar columnas de {table_name}: {error}"))?;

    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("No se pudieron leer columnas de {table_name}: {error}"))?;

    for row in rows {
        let current = row
            .map_err(|error| format!("No se pudo mapear columna de {table_name}: {error}"))?;
        if current == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn ensure_sqlite_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    alter_sql: &str,
) -> Result<(), String> {
    if sqlite_table_has_column(connection, table_name, column_name)? {
        return Ok(());
    }

    connection
        .execute(alter_sql, [])
        .map_err(|error| format!("No se pudo agregar columna {table_name}.{column_name}: {error}"))?;

    Ok(())
}

fn apply_incremental_sqlite_migrations(connection: &Connection) -> Result<(), String> {
    ensure_sqlite_column(
        connection,
        "products",
        "sale_price_x3",
        "ALTER TABLE products ADD COLUMN sale_price_x3 REAL",
    )?;
    ensure_sqlite_column(
        connection,
        "products",
        "sale_price_x6",
        "ALTER TABLE products ADD COLUMN sale_price_x6 REAL",
    )?;
    ensure_sqlite_column(
        connection,
        "products",
        "sale_price_x12",
        "ALTER TABLE products ADD COLUMN sale_price_x12 REAL",
    )?;
    ensure_sqlite_column(
        connection,
        "sale_items",
        "price_tier",
        "ALTER TABLE sale_items ADD COLUMN price_tier TEXT NOT NULL DEFAULT 'normal'",
    )?;

    connection
        .execute(
            "UPDATE sale_items
       SET price_tier = 'normal'
       WHERE price_tier IS NULL
          OR TRIM(price_tier) = ''",
            [],
        )
        .map_err(|error| format!("No se pudo normalizar price_tier local: {error}"))?;

    Ok(())
}

fn backup_and_reset_incompatible_database(db_path: &PathBuf) -> Result<(), String> {
    if !db_path.exists() {
        return Ok(());
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("No se pudo obtener timestamp para backup local: {error}"))?
        .as_secs();

    let file_stem = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("pos_tienda_local");
    let extension = db_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("db3");

    let backup_path = db_path.with_file_name(format!("{file_stem}.backup-{timestamp}.{extension}"));

    fs::rename(db_path, &backup_path).map_err(|error| {
        format!(
            "No se pudo respaldar la base local incompatible a {}: {error}",
            backup_path.display()
        )
    })?;

    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", db_path.display(), suffix));
        if sidecar.exists() {
            let backup_sidecar = PathBuf::from(format!("{}{}", backup_path.display(), suffix));
            fs::rename(&sidecar, &backup_sidecar).map_err(|error| {
                format!(
                    "No se pudo respaldar archivo auxiliar local {}: {error}",
                    sidecar.display()
                )
            })?;
        }
    }

    Ok(())
}

fn open_connection(db_path: &PathBuf) -> Result<Connection, String> {
    Connection::open(db_path)
        .map_err(|error| format!("No se pudo abrir base local SQLite: {error}"))
}

fn connection_from_state(state: &DatabaseState) -> Result<Connection, String> {
    open_connection(&state.db_path)
}

fn read_database_info(state: &DatabaseState) -> Result<DatabaseInfo, String> {
    let metadata = fs::metadata(&state.db_path)
        .map_err(|error| format!("No se pudo leer metadata de la base local: {error}"))?;

    let connection = connection_from_state(state)?;
    let schema_version = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("No se pudo leer schema_version local: {error}"))?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();

    Ok(DatabaseInfo {
        db_path: state.db_path.display().to_string(),
        file_exists: true,
        file_size_bytes: metadata.len(),
        schema_version,
    })
}

fn map_partner(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalPartner> {
    Ok(LocalPartner {
        id: row.get("local_id")?,
        remote_id: row.get("remote_id")?,
        name: row.get("name")?,
        display_name: row.get("display_name")?,
        color_hex: row.get("color_hex")?,
        is_expense_eligible: row.get::<_, i64>("is_expense_eligible")? == 1,
        created_at: None,
    })
}

fn map_product_with_owner(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalProductWithOwner> {
    Ok(LocalProductWithOwner {
        product: LocalProduct {
            id: row.get("product_local_id")?,
            remote_id: row.get("product_remote_id")?,
            barcode: row.get("barcode")?,
            sku: row.get("sku")?,
            name: row.get("name")?,
            description: row.get("description")?,
            category: row.get("category")?,
            owner_id: row.get("owner_local_id")?,
            purchase_price: row.get("purchase_price")?,
            sale_price: row.get("sale_price")?,
            sale_price_x3: row.get("sale_price_x3")?,
            sale_price_x6: row.get("sale_price_x6")?,
            sale_price_x12: row.get("sale_price_x12")?,
            stock: row.get("stock")?,
            min_stock: row.get("min_stock")?,
            image_url: row.get("image_url")?,
            is_active: row.get::<_, i64>("is_active")? == 1,
            is_clearance: row.get::<_, i64>("is_clearance")? == 1,
            clearance_price: row.get("clearance_price")?,
            bodega_at: row.get("bodega_at")?,
            disposed_at: row.get("disposed_at")?,
            bodega_stock: row.get("bodega_stock")?,
            created_at: None,
            updated_at: row.get("updated_at")?,
        },
        owner: LocalPartner {
            id: row.get("owner_local_id")?,
            remote_id: row.get("owner_remote_id")?,
            name: row.get("owner_name")?,
            display_name: row.get("owner_display_name")?,
            color_hex: row.get("owner_color_hex")?,
            is_expense_eligible: row.get::<_, i64>("owner_is_expense_eligible")? == 1,
            created_at: None,
        },
    })
}

fn map_cash_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalCashSession> {
    Ok(LocalCashSession {
        id: row.get("local_id")?,
        remote_id: row.get("remote_id")?,
        opened_by: row.get("opened_by_remote_id")?,
        opened_at: row.get("opened_at")?,
        closed_at: row.get("closed_at")?,
        opening_cash: row.get("opening_cash")?,
        closing_cash: row.get("closing_cash")?,
        status: row.get("status")?,
        notes: row.get("notes")?,
    })
}

fn build_product_query_sql(filters: &ProductQuery) -> (String, Vec<Box<dyn ToSql>>) {
    let mut sql = String::from(
        r#"
SELECT
  p.local_id AS product_local_id,
  p.remote_id AS product_remote_id,
  p.barcode,
  p.sku,
  p.name,
  p.description,
  p.category,
  p.purchase_price,
  p.sale_price,
  p.sale_price_x3,
  p.sale_price_x6,
  p.sale_price_x12,
  p.stock,
  p.min_stock,
  p.image_url,
  p.is_active,
  p.is_clearance,
  p.clearance_price,
  p.bodega_at,
  p.disposed_at,
  p.bodega_stock,
  p.updated_at,
  o.local_id AS owner_local_id,
  o.remote_id AS owner_remote_id,
  o.name AS owner_name,
  o.display_name AS owner_display_name,
  o.color_hex AS owner_color_hex,
  o.is_expense_eligible AS owner_is_expense_eligible
FROM products p
JOIN partners o ON o.local_id = p.owner_id
WHERE p.is_active = 1
"#,
    );

    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(owner_id) = filters
        .owner_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        sql.push_str(" AND p.owner_id = ?");
        params.push(Box::new(owner_id.trim().to_string()));
    }

    let mut search_term_for_order: Option<String> = None;

    if let Some(search) = filters
        .search
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        let trimmed = search.trim().to_string();
        if let Some(like) = build_tokenized_like_pattern(&trimmed) {
            sql.push_str(" AND (p.name LIKE ? COLLATE NOCASE OR p.barcode LIKE ? COLLATE NOCASE OR COALESCE(p.sku, '') LIKE ? COLLATE NOCASE)");
            params.push(Box::new(like.clone()));
            params.push(Box::new(like.clone()));
            params.push(Box::new(like));
        }
        search_term_for_order = Some(trimmed);
    }

    match filters.stock_filter.as_deref() {
        Some("out") => sql.push_str(" AND p.stock <= 0"),
        Some("low") => sql.push_str(" AND p.stock > 0 AND p.stock <= p.min_stock"),
        Some("ok") => sql.push_str(" AND p.stock > p.min_stock"),
        _ => {}
    }

    if let Some(exact_term) = search_term_for_order {
        sql.push_str(
            " ORDER BY 
        CASE 
          WHEN p.barcode COLLATE NOCASE = ? THEN 1
          WHEN COALESCE(p.sku, '') COLLATE NOCASE = ? THEN 1
          ELSE 2 
        END ASC, 
        p.name ASC",
        );
        params.push(Box::new(exact_term.clone()));
        params.push(Box::new(exact_term));
    } else {
        sql.push_str(" ORDER BY p.name ASC");
    }

    let limit = filters.limit.unwrap_or(50).max(1);
    let offset = filters.offset.unwrap_or(0).max(0);
    sql.push_str(" LIMIT ? OFFSET ?");
    params.push(Box::new(limit));
    params.push(Box::new(offset));

    (sql, params)
}

fn build_counts_where_clause(
    search: Option<String>,
    owner_id: Option<String>,
) -> (String, Vec<Box<dyn ToSql>>) {
    let mut sql = String::from(" WHERE is_active = 1");
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(owner_id) = owner_id.filter(|value| !value.trim().is_empty()) {
        sql.push_str(" AND owner_id = ?");
        params.push(Box::new(owner_id.trim().to_string()));
    }

    if let Some(search) = search.filter(|value| !value.trim().is_empty()) {
        if let Some(like) = build_tokenized_like_pattern(search.trim()) {
            sql.push_str(" AND (name LIKE ? COLLATE NOCASE OR barcode LIKE ? COLLATE NOCASE OR COALESCE(sku, '') LIKE ? COLLATE NOCASE)");
            params.push(Box::new(like.clone()));
            params.push(Box::new(like.clone()));
            params.push(Box::new(like));
        }
    }

    (sql, params)
}

fn build_tokenized_like_pattern(raw: &str) -> Option<String> {
    let normalized: String = raw
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect();
    let tokens: Vec<&str> = normalized.split_whitespace().collect();

    if tokens.is_empty() {
        return None;
    }

    Some(format!("%{}%", tokens.join("%")))
}

fn resolve_cash_session_local_id(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<(String, Option<String>)>, String> {
    connection
    .query_row(
      "SELECT local_id, remote_id FROM cash_sessions WHERE local_id = ?1 OR remote_id = ?1 LIMIT 1",
      params![session_id],
      |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    )
    .optional()
    .map_err(|error| format!("No se pudo resolver sesion local: {error}"))
}

fn resolve_expense_local_id(
    connection: &Connection,
    expense_id: &str,
) -> Result<Option<(String, Option<String>)>, String> {
    connection
    .query_row(
      "SELECT local_id, remote_id FROM expenses WHERE local_id = ?1 OR remote_id = ?1 LIMIT 1",
      params![expense_id],
      |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    )
    .optional()
    .map_err(|error| format!("No se pudo resolver gasto local: {error}"))
}

fn resolve_partner_local_id(
    connection: &Connection,
    partner_id: &str,
) -> Result<Option<(String, Option<String>)>, String> {
    connection
    .query_row(
      "SELECT local_id, remote_id FROM partners WHERE local_id = ?1 OR remote_id = ?1 LIMIT 1",
      params![partner_id],
      |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    )
    .optional()
    .map_err(|error| format!("No se pudo resolver socia local: {error}"))
}

fn resolve_product_row(
    connection: &Connection,
    product_id: &str,
) -> Result<Option<(String, Option<String>, String, String, String, i64, bool)>, String> {
    connection
        .query_row(
            "SELECT local_id, remote_id, name, barcode, owner_id, stock, is_active
       FROM products
       WHERE local_id = ?1 OR remote_id = ?1
       LIMIT 1",
            params![product_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)? == 1,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo resolver producto local: {error}"))
}

fn entity_sync_status_after_success(
    connection: &Connection,
    entity_name: &str,
    entity_local_id: &str,
    current_item_id: &str,
) -> Result<&'static str, String> {
    let has_followups: i64 = connection
        .query_row(
            "SELECT EXISTS(
         SELECT 1
         FROM sync_queue
         WHERE entity_name = ?1
           AND entity_local_id = ?2
           AND local_id <> ?3
       )",
            params![entity_name, entity_local_id, current_item_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudo verificar cola relacionada: {error}"))?;

    Ok(if has_followups > 0 {
        "pending"
    } else {
        "synced"
    })
}

fn propagate_remote_id_to_followups(
    connection: &Connection,
    entity_name: &str,
    entity_local_id: &str,
    current_item_id: &str,
    entity_remote_id: Option<&str>,
) -> Result<(), String> {
    let Some(remote_id) = entity_remote_id else {
        return Ok(());
    };

    connection
        .execute(
            "UPDATE sync_queue
       SET entity_remote_id = COALESCE(entity_remote_id, ?4),
           updated_at = CURRENT_TIMESTAMP
       WHERE entity_name = ?1
         AND entity_local_id = ?2
         AND local_id <> ?3",
            params![entity_name, entity_local_id, current_item_id, remote_id],
        )
        .map_err(|error| format!("No se pudo propagar remote_id a cola local: {error}"))?;

    Ok(())
}

fn mark_inventory_movement_synced_for_item(
    connection: &Connection,
    product_local_id: &str,
    operation_type: &str,
    payload_json: &str,
    product_remote_id: Option<&str>,
) -> Result<(), String> {
    let payload =
        serde_json::from_str::<serde_json::Value>(payload_json).unwrap_or(serde_json::Value::Null);
    let movement_local_id = payload
        .get("movementLocalId")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    if let Some(movement_id) = movement_local_id {
        connection
            .execute(
                "UPDATE inventory_movements
         SET product_remote_id = COALESCE(product_remote_id, ?2),
             sync_status = 'synced',
             synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE local_id = ?1",
                params![movement_id, product_remote_id],
            )
            .map_err(|error| {
                format!("No se pudo marcar movimiento local exacto como sincronizado: {error}")
            })?;

        return Ok(());
    }

    let (reason, quantity_change) = match operation_type {
        "adjust" => {
            let quantity = payload
                .get("quantity")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let operation = payload
                .get("operation")
                .and_then(|value| value.as_str())
                .unwrap_or("in");
            let reason = payload
                .get("reason")
                .and_then(|value| value.as_str())
                .unwrap_or("manual_adjustment");

            (
                Some(reason.to_string()),
                Some(if operation == "out" {
                    -quantity
                } else {
                    quantity
                }),
            )
        }
        "create_remate" => {
            let stock = payload
                .get("stock")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            (Some("restock".to_string()), Some(stock))
        }
        "insert" => {
            let movement_delta = payload
                .get("movementDelta")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            if movement_delta == 0 {
                (None, None)
            } else {
                (Some("initial_stock".to_string()), Some(movement_delta))
            }
        }
        "update" => {
            let movement_delta = payload
                .get("movementDelta")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            if movement_delta == 0 {
                (None, None)
            } else {
                (Some("manual_adjustment".to_string()), Some(movement_delta))
            }
        }
        _ => (None, None),
    };

    let (Some(reason), Some(quantity_change)) = (reason, quantity_change) else {
        return Ok(());
    };

    connection
        .execute(
            "UPDATE inventory_movements
       SET product_remote_id = COALESCE(product_remote_id, ?4),
           sync_status = 'synced',
           synced_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE local_id = (
         SELECT local_id
         FROM inventory_movements
         WHERE product_id = ?1
           AND sync_status = 'pending'
           AND reason = ?2
           AND quantity_change = ?3
         ORDER BY updated_at ASC
         LIMIT 1
       )",
            params![product_local_id, reason, quantity_change, product_remote_id],
        )
        .map_err(|error| {
            format!("No se pudo marcar movimiento local por fallback como sincronizado: {error}")
        })?;

    Ok(())
}

fn build_datetime_range_clause(
    field_name: &str,
    from_date: Option<String>,
    to_date: Option<String>,
) -> (String, Vec<Box<dyn ToSql>>) {
    let mut clause = String::new();
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();
    let normalized_field = format!("datetime({field_name}, '-5 hours')");

    if let Some(from) = from_date.filter(|value| !value.trim().is_empty()) {
        clause.push_str(&format!(" AND {normalized_field} >= ?"));
        params.push(Box::new(format!("{} 00:00:00", from.trim())));
    }

    if let Some(to) = to_date.filter(|value| !value.trim().is_empty()) {
        clause.push_str(&format!(" AND {normalized_field} <= ?"));
        params.push(Box::new(format!("{} 23:59:59", to.trim())));
    }

    (clause, params)
}

fn ensure_today_local_cash_session(
    transaction: &Transaction<'_>,
) -> Result<(String, Option<String>), String> {
    let existing_today = transaction
        .query_row(
            "SELECT local_id, remote_id
       FROM cash_sessions
       WHERE status = 'open'
         AND date(opened_at, '-5 hours') = date('now', '-5 hours')
       ORDER BY opened_at DESC
       LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|error| format!("No se pudo verificar el dia operativo actual: {error}"))?;

    if let Some(session) = existing_today {
        return Ok(session);
    }

    let session_id = Uuid::new_v4().to_string();

    transaction
        .execute(
            "INSERT INTO cash_sessions (
         local_id, opened_by_remote_id, opened_at, opening_cash, status, sync_status
       ) VALUES (?1, NULL, CURRENT_TIMESTAMP, 0, 'open', 'pending')",
            params![session_id.clone()],
        )
        .map_err(|error| format!("No se pudo crear el dia operativo local: {error}"))?;

    let payload = serde_json::json!({
      "openingCash": 0.0,
    });

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
       ) VALUES (?1, 'cash_sessions', ?2, NULL, 'insert', ?3, 'pending')",
      params![Uuid::new_v4().to_string(), session_id.clone(), payload.to_string()],
    )
    .map_err(|error| format!("No se pudo encolar el dia operativo local: {error}"))?;

    Ok((session_id, None))
}

#[tauri::command]
pub fn get_local_database_info(state: State<'_, DatabaseState>) -> Result<DatabaseInfo, String> {
    read_database_info(&state)
}

#[tauri::command]
pub fn get_local_app_setting(
    state: State<'_, DatabaseState>,
    key: String,
) -> Result<Option<LocalAppSettingValue>, String> {
    let connection = connection_from_state(&state)?;
    let result = connection
        .query_row(
            "SELECT key, value FROM app_settings WHERE key = ?1 LIMIT 1",
            params![key],
            |row| {
                Ok(LocalAppSettingValue {
                    key: row.get::<_, String>(0)?,
                    value: row.get::<_, String>(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo leer app_setting local: {error}"))?;

    Ok(result)
}

#[tauri::command]
pub fn set_local_app_setting(
    state: State<'_, DatabaseState>,
    key: String,
    value: String,
) -> Result<bool, String> {
    let connection = connection_from_state(&state)?;
    connection
        .execute(
            "INSERT INTO app_settings (key, value, updated_at)
       VALUES (?1, ?2, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )
        .map_err(|error| format!("No se pudo guardar app_setting local: {error}"))?;

    Ok(true)
}

#[tauri::command]
pub fn get_open_local_cash_session(
    state: State<'_, DatabaseState>,
) -> Result<Option<LocalCashSession>, String> {
    let connection = connection_from_state(&state)?;
    let mut statement = connection
    .prepare(
      "SELECT local_id, remote_id, opened_by_remote_id, opened_at, closed_at, opening_cash, closing_cash, status, notes
       FROM cash_sessions
       WHERE status = 'open'
         AND date(opened_at, '-5 hours') = date('now', '-5 hours')
       ORDER BY opened_at DESC
       LIMIT 1",
    )
    .map_err(|error| format!("No se pudo preparar lectura de sesion local: {error}"))?;

    statement
        .query_row([], map_cash_session)
        .optional()
        .map_err(|error| format!("No se pudo leer sesion local abierta: {error}"))
}

#[tauri::command]
pub fn open_local_cash_session(
    state: State<'_, DatabaseState>,
    opening_cash: f64,
) -> Result<LocalCashSession, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para sesion: {error}"))?;

    let existing_open = transaction
    .query_row(
      "SELECT local_id, remote_id, opened_by_remote_id, opened_at, closed_at, opening_cash, closing_cash, status, notes
       FROM cash_sessions
       WHERE status = 'open'
         AND date(opened_at, '-5 hours') = date('now', '-5 hours')
       ORDER BY opened_at DESC
       LIMIT 1",
      [],
      map_cash_session,
    )
    .optional()
    .map_err(|error| format!("No se pudo verificar sesion local existente: {error}"))?;

    if let Some(session) = existing_open {
        return Ok(session);
    }

    let session_id = Uuid::new_v4().to_string();

    transaction
        .execute(
            "INSERT INTO cash_sessions (
         local_id, opened_by_remote_id, opened_at, opening_cash, status, sync_status
       ) VALUES (?1, NULL, CURRENT_TIMESTAMP, ?2, 'open', 'pending')",
            params![session_id, opening_cash],
        )
        .map_err(|error| format!("No se pudo crear sesion local: {error}"))?;

    let payload = serde_json::json!({
      "openingCash": opening_cash,
    });

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
       ) VALUES (?1, 'cash_sessions', ?2, NULL, 'insert', ?3, 'pending')",
      params![Uuid::new_v4().to_string(), session_id, payload.to_string()],
    )
    .map_err(|error| format!("No se pudo encolar sesion local: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar sesion local: {error}"))?;

    let connection = connection_from_state(&state)?;
    connection
    .query_row(
      "SELECT local_id, remote_id, opened_by_remote_id, opened_at, closed_at, opening_cash, closing_cash, status, notes
       FROM cash_sessions
       WHERE local_id = ?1
       LIMIT 1",
      params![session_id],
      map_cash_session,
    )
    .map_err(|error| format!("No se pudo recargar sesion local creada: {error}"))
}

#[tauri::command]
pub fn ensure_local_cash_sessions_sync_queued(
    state: State<'_, DatabaseState>,
) -> Result<i64, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection.transaction().map_err(|error| {
        format!("No se pudo abrir transaccion local para reparar sesiones: {error}")
    })?;

    let sessions: Vec<(String, f64)> = {
        let mut statement = transaction
            .prepare(
                "SELECT local_id, opening_cash
         FROM cash_sessions
         WHERE remote_id IS NULL",
            )
            .map_err(|error| {
                format!("No se pudo preparar lectura de sesiones sin remote_id: {error}")
            })?;

        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .map_err(|error| format!("No se pudieron leer sesiones locales pendientes: {error}"))?;

        let mut values = Vec::new();
        for row in rows {
            values.push(
                row.map_err(|error| format!("No se pudo mapear sesion local pendiente: {error}"))?,
            );
        }
        values
    };

    let mut repaired_count = 0_i64;

    for (session_local_id, opening_cash) in sessions {
        let existing_queue = transaction
            .query_row(
                "SELECT local_id, status
         FROM sync_queue
         WHERE entity_name = 'cash_sessions'
           AND entity_local_id = ?1
           AND operation_type = 'insert'
         ORDER BY created_at DESC
         LIMIT 1",
                params![session_local_id.clone()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| format!("No se pudo revisar la cola de la sesion local: {error}"))?;

        match existing_queue {
            Some((queue_id, status)) => {
                if status != "pending" {
                    transaction
                        .execute(
                            "UPDATE sync_queue
               SET status = 'pending',
                   last_error = NULL,
                   next_retry_at = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE local_id = ?1",
                            params![queue_id],
                        )
                        .map_err(|error| {
                            format!("No se pudo reactivar la cola de la sesion local: {error}")
                        })?;
                    repaired_count += 1;
                }
            }
            None => {
                let payload = serde_json::json!({
                  "openingCash": opening_cash,
                });

                transaction
          .execute(
            "INSERT INTO sync_queue (
               local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
             ) VALUES (?1, 'cash_sessions', ?2, NULL, 'insert', ?3, 'pending')",
            params![Uuid::new_v4().to_string(), session_local_id, payload.to_string()],
          )
          .map_err(|error| format!("No se pudo recrear la cola de la sesion local: {error}"))?;
                repaired_count += 1;
            }
        }
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar reparacion de sesiones locales: {error}"))?;

    Ok(repaired_count)
}

#[tauri::command]
pub fn close_local_cash_session(
    state: State<'_, DatabaseState>,
    session_id: String,
    closing_cash: Option<f64>,
    notes: Option<String>,
) -> Result<bool, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para cierre: {error}"))?;

    let Some((local_id, remote_id)) = resolve_cash_session_local_id(&transaction, &session_id)?
    else {
        return Err("No se encontro la sesion local a cerrar".to_string());
    };

    transaction
        .execute(
            "UPDATE cash_sessions
       SET status = 'closed',
           closed_at = CURRENT_TIMESTAMP,
           closing_cash = ?2,
           notes = ?3,
           sync_status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE local_id = ?1",
            params![local_id, closing_cash, notes],
        )
        .map_err(|error| format!("No se pudo cerrar sesion local: {error}"))?;

    let payload = serde_json::json!({
      "closingCash": closing_cash,
      "notes": notes,
    });

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
       ) VALUES (?1, 'cash_sessions', ?2, ?3, 'close', ?4, 'pending')",
      params![Uuid::new_v4().to_string(), local_id, remote_id, payload.to_string()],
    )
    .map_err(|error| format!("No se pudo encolar cierre local de sesion: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar cierre local de sesion: {error}"))?;

    Ok(true)
}

#[tauri::command]
pub fn list_local_expenses(
    state: State<'_, DatabaseState>,
    cash_session_id: String,
) -> Result<Vec<LocalExpenseWithAllocations>, String> {
    let connection = connection_from_state(&state)?;
    let Some((session_local_id, _)) = resolve_cash_session_local_id(&connection, &cash_session_id)?
    else {
        return Ok(Vec::new());
    };

    let mut statement = connection
    .prepare(
      "SELECT local_id, remote_id, cash_session_local_id, amount, description, scope, idempotency_key,
              registered_by_remote_id, updated_at, sync_status
       FROM expenses
       WHERE cash_session_local_id = ?1
       ORDER BY updated_at DESC",
    )
    .map_err(|error| format!("No se pudo preparar lectura local de gastos: {error}"))?;

    let rows = statement
        .query_map(params![session_local_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|error| format!("No se pudieron leer gastos locales: {error}"))?;

    let mut expenses = Vec::new();

    for row in rows {
        let (
            expense_local_id,
            remote_id,
            cash_session_local_id,
            amount,
            description,
            scope,
            idempotency_key,
            registered_by,
            created_at,
            sync_status,
        ) = row.map_err(|error| format!("No se pudo mapear gasto local: {error}"))?;

        let mut allocation_statement = connection
            .prepare(
                "SELECT
           ea.local_id,
           ea.partner_id,
           ea.amount,
           p.local_id,
           p.remote_id,
           p.name,
           p.display_name,
           p.color_hex,
           p.is_expense_eligible
         FROM expense_allocations ea
         JOIN partners p ON p.local_id = ea.partner_id
         WHERE ea.expense_local_id = ?1
         ORDER BY p.name ASC",
            )
            .map_err(|error| format!("No se pudo preparar asignaciones locales: {error}"))?;

        let allocation_rows = allocation_statement
            .query_map(params![expense_local_id.clone()], |allocation_row| {
                Ok(LocalExpenseAllocationWithPartner {
                    id: allocation_row.get::<_, String>(0)?,
                    partner_id: allocation_row.get::<_, String>(1)?,
                    amount: allocation_row.get::<_, f64>(2)?,
                    partner: LocalPartner {
                        id: allocation_row.get::<_, String>(3)?,
                        remote_id: allocation_row.get::<_, Option<String>>(4)?,
                        name: allocation_row.get::<_, String>(5)?,
                        display_name: allocation_row.get::<_, String>(6)?,
                        color_hex: allocation_row.get::<_, String>(7)?,
                        is_expense_eligible: allocation_row.get::<_, i64>(8)? == 1,
                        created_at: None,
                    },
                })
            })
            .map_err(|error| format!("No se pudieron leer asignaciones locales: {error}"))?;

        let mut allocations = Vec::new();
        for allocation in allocation_rows {
            allocations.push(
                allocation
                    .map_err(|error| format!("No se pudo mapear asignacion local: {error}"))?,
            );
        }

        expenses.push(LocalExpenseWithAllocations {
            id: expense_local_id,
            remote_id,
            cash_session_id: cash_session_local_id,
            amount,
            description,
            scope,
            idempotency_key,
            registered_by,
            created_at,
            synced: sync_status == "synced",
            expense_allocations: allocations,
        });
    }

    Ok(expenses)
}

#[tauri::command]
pub fn upsert_local_expense(
    state: State<'_, DatabaseState>,
    input: UpsertLocalExpenseInput,
) -> Result<UpsertLocalExpenseResult, String> {
    if input.amount <= 0.0 {
        return Err("Monto invalido".to_string());
    }

    if input.description.trim().is_empty() {
        return Err("Descripcion requerida".to_string());
    }

    if input.scope != "shared" && input.scope != "individual" {
        return Err("Tipo de gasto invalido".to_string());
    }

    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para gasto: {error}"))?;

    let existing = if let Some(expense_id) = input.expense_id.as_ref() {
        resolve_expense_local_id(&transaction, expense_id)?
    } else {
        None
    };

    let (cash_session_local_id, cash_session_remote_id) = if existing.is_some() {
        let Some((session_local_id, session_remote_id)) =
            resolve_cash_session_local_id(&transaction, &input.cash_session_id)?
        else {
            return Err("No se encontro el dia operativo para registrar el gasto".to_string());
        };
        (session_local_id, session_remote_id)
    } else {
        ensure_today_local_cash_session(&transaction)?
    };

    let expense_local_id = existing
        .as_ref()
        .map(|(local_id, _)| local_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let expense_remote_id = existing
        .as_ref()
        .and_then(|(_, remote_id)| remote_id.clone());

    transaction
    .execute(
      "INSERT INTO expenses (
         local_id, remote_id, cash_session_local_id, cash_session_remote_id, amount, description, scope,
         idempotency_key, registered_by_remote_id, sync_status
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 'pending')
       ON CONFLICT(local_id) DO UPDATE SET
         remote_id = excluded.remote_id,
         cash_session_local_id = excluded.cash_session_local_id,
         cash_session_remote_id = excluded.cash_session_remote_id,
         amount = excluded.amount,
         description = excluded.description,
         scope = excluded.scope,
         idempotency_key = excluded.idempotency_key,
         sync_status = 'pending',
         updated_at = CURRENT_TIMESTAMP",
      params![
        expense_local_id,
        expense_remote_id,
        cash_session_local_id,
        cash_session_remote_id,
        input.amount,
        input.description.trim(),
        input.scope,
        input.idempotency_key
      ],
    )
    .map_err(|error| format!("No se pudo guardar gasto local: {error}"))?;

    transaction
        .execute(
            "DELETE FROM expense_allocations WHERE expense_local_id = ?1",
            params![expense_local_id.clone()],
        )
        .map_err(|error| {
            format!("No se pudieron limpiar asignaciones locales del gasto: {error}")
        })?;

    let partner_ids: Vec<String> = if input.scope == "individual" {
        vec![input
            .partner_id
            .clone()
            .ok_or_else(|| "Socia requerida para gasto individual".to_string())?]
    } else {
        let shared = input
            .shared_partner_ids
            .clone()
            .filter(|ids| !ids.is_empty())
            .ok_or_else(|| "Socias requeridas para gasto compartido".to_string())?;
        shared
    };

    let partner_count = partner_ids.len() as i64;
    let base_share = ((input.amount / partner_count as f64) * 100.0).round() / 100.0;
    let assigned_total = base_share * partner_count as f64;
    let remainder = ((input.amount - assigned_total) * 100.0).round() / 100.0;

    for (index, partner_id) in partner_ids.iter().enumerate() {
        let Some((partner_local_id, partner_remote_id)) =
            resolve_partner_local_id(&transaction, partner_id)?
        else {
            return Err(format!(
                "No se encontro la socia local para asignar gasto: {partner_id}"
            ));
        };

        if input.scope == "shared" {
            let (partner_name, partner_is_eligible) = transaction
        .query_row(
          "SELECT display_name, is_expense_eligible
           FROM partners
           WHERE local_id = ?1
           LIMIT 1",
          params![partner_local_id.clone()],
          |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| {
          format!("No se pudo validar elegibilidad local de socia para gasto compartido: {error}")
        })?;

            if partner_is_eligible != 1 {
                return Err(format!(
                    "La socia \"{partner_name}\" no es elegible para gastos compartidos"
                ));
            }
        }

        let mut amount = base_share;
        if index == 0 {
            amount = ((amount + remainder) * 100.0).round() / 100.0;
        }

        transaction
      .execute(
        "INSERT INTO expense_allocations (
           local_id, remote_id, expense_local_id, expense_remote_id, partner_id, partner_remote_id, amount
         ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6)",
        params![
          Uuid::new_v4().to_string(),
          expense_local_id,
          expense_remote_id,
          partner_local_id,
          partner_remote_id,
          amount
        ],
      )
      .map_err(|error| format!("No se pudo guardar asignacion local del gasto: {error}"))?;
    }

    let payload = serde_json::to_string(&input)
        .map_err(|error| format!("No se pudo serializar payload local del gasto: {error}"))?;

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, idempotency_key, status
       ) VALUES (?1, 'expenses', ?2, ?3, ?4, ?5, ?6, 'pending')",
      params![
        Uuid::new_v4().to_string(),
        expense_local_id,
        expense_remote_id,
        if existing.is_some() { "update" } else { "insert" },
        payload,
        input.idempotency_key
      ],
    )
    .map_err(|error| format!("No se pudo encolar sync local del gasto: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar gasto local: {error}"))?;

    Ok(UpsertLocalExpenseResult {
        expense_id: expense_local_id,
        allocation_count: partner_count,
    })
}

#[tauri::command]
pub fn register_local_sale(
    state: State<'_, DatabaseState>,
    input: RegisterLocalSaleInput,
) -> Result<RegisterLocalSaleResult, String> {
    if input.payment_method != "cash" && input.payment_method != "transfer" {
        return Err("Metodo de pago invalido".to_string());
    }

    if input.items.is_empty() {
        return Err("La venta debe incluir al menos un item".to_string());
    }

    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para venta: {error}"))?;

    if let Some(key) = input
        .idempotency_key
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        let existing = transaction
            .query_row(
                "SELECT local_id, total FROM sales WHERE idempotency_key = ?1 LIMIT 1",
                params![key.trim()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
            )
            .optional()
            .map_err(|error| {
                format!("No se pudo verificar idempotencia local de venta: {error}")
            })?;

        if let Some((sale_id, total)) = existing {
            let item_count = transaction
                .query_row(
                    "SELECT COALESCE(SUM(quantity), 0) FROM sale_items WHERE sale_local_id = ?1",
                    params![sale_id.clone()],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| {
                    format!("No se pudo leer detalle local de venta existente: {error}")
                })?;

            return Ok(RegisterLocalSaleResult {
                sale_id,
                total,
                item_count,
            });
        }
    }

    let (cash_session_local_id, cash_session_remote_id) =
        ensure_today_local_cash_session(&transaction)?;

    let sale_local_id = Uuid::new_v4().to_string();
    let mut total = 0.0_f64;
    let mut item_count = 0_i64;

    for item in &input.items {
        if item.quantity <= 0 {
            return Err("Cantidad invalida en uno de los items".to_string());
        }

        if item.unit_price < 0.0 {
            return Err("Precio invalido en uno de los items".to_string());
        }

        if item.price_tier != "normal"
            && item.price_tier != "x3"
            && item.price_tier != "x6"
            && item.price_tier != "x12"
            && item.price_tier != "manual"
        {
            return Err("Price tier invalido en uno de los items".to_string());
        }

        total += item.unit_price * item.quantity as f64;
        item_count += item.quantity;
    }

    total = (total * 100.0).round() / 100.0;

    transaction
    .execute(
      "INSERT INTO sales (
         local_id, remote_id, cash_session_local_id, cash_session_remote_id, sold_by_remote_id, total,
         payment_method, notes, amount_received, change_given, idempotency_key, sync_status
       ) VALUES (?1, NULL, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, 'pending')",
      params![
        sale_local_id,
        cash_session_local_id,
        cash_session_remote_id,
        total,
        input.payment_method,
        input.notes,
        input.amount_received,
        input.change_given,
        input.idempotency_key
      ],
    )
    .map_err(|error| format!("No se pudo guardar venta local: {error}"))?;

    for item in &input.items {
        let Some((
            product_local_id,
            product_remote_id,
            product_name,
            product_barcode,
            owner_id,
            current_stock,
            is_active,
        )) = resolve_product_row(&transaction, &item.product_id)?
        else {
            return Err(format!(
                "No se encontro el producto local: {}",
                item.product_id
            ));
        };

        if !is_active {
            return Err(format!("El producto esta inactivo: {product_name}"));
        }

        let next_stock = current_stock - item.quantity;

        transaction
            .execute(
                "UPDATE products
         SET stock = ?2, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
         WHERE local_id = ?1",
                params![product_local_id, next_stock],
            )
            .map_err(|error| format!("No se pudo ajustar stock local del producto: {error}"))?;

        transaction
            .execute(
                "INSERT INTO sale_items (
           local_id, remote_id, sale_local_id, sale_remote_id, product_local_id, product_remote_id,
           product_name, product_barcode, owner_id, quantity, unit_price, price_tier, subtotal
         ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    Uuid::new_v4().to_string(),
                    sale_local_id,
                    product_local_id.clone(),
                    product_remote_id,
                    product_name,
                    product_barcode,
                    owner_id,
                    item.quantity,
                    item.unit_price,
                    item.price_tier,
                    ((item.unit_price * item.quantity as f64) * 100.0).round() / 100.0
                ],
            )
            .map_err(|error| format!("No se pudo guardar detalle local de venta: {error}"))?;

        transaction
            .execute(
                "INSERT INTO inventory_movements (
           local_id, remote_id, product_id, product_remote_id, quantity_change, reason,
           reference_local_id, reference_remote_id, performed_by_remote_id, sync_status
         ) VALUES (?1, NULL, ?2, ?3, ?4, 'sale', ?5, NULL, NULL, 'pending')",
                params![
                    Uuid::new_v4().to_string(),
                    product_local_id,
                    product_remote_id,
                    -item.quantity,
                    sale_local_id
                ],
            )
            .map_err(|error| {
                format!("No se pudo guardar movimiento local de inventario por venta: {error}")
            })?;
    }

    let payload = serde_json::to_string(&input)
        .map_err(|error| format!("No se pudo serializar payload local de venta: {error}"))?;

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, idempotency_key, status
       ) VALUES (?1, 'sales', ?2, NULL, 'insert', ?3, ?4, 'pending')",
      params![
        Uuid::new_v4().to_string(),
        sale_local_id,
        payload,
        input.idempotency_key
      ],
    )
    .map_err(|error| format!("No se pudo encolar sync local de venta: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar venta local: {error}"))?;

    Ok(RegisterLocalSaleResult {
        sale_id: sale_local_id,
        total,
        item_count,
    })
}

#[tauri::command]
pub fn get_local_session_sales_stats(
    state: State<'_, DatabaseState>,
    cash_session_id: String,
) -> Result<LocalSessionSalesStats, String> {
    let connection = connection_from_state(&state)?;
    let Some((cash_session_local_id, _)) =
        resolve_cash_session_local_id(&connection, &cash_session_id)?
    else {
        return Ok(LocalSessionSalesStats {
            total_sales: 0.0,
            total_cash: 0.0,
            total_transfer: 0.0,
            sale_count: 0,
        });
    };

    let total_sales = connection
        .query_row(
            "SELECT COALESCE(SUM(total), 0) FROM sales WHERE cash_session_local_id = ?1",
            params![cash_session_local_id.clone()],
            |row| row.get::<_, f64>(0),
        )
        .map_err(|error| format!("No se pudo sumar ventas locales: {error}"))?;
    let total_cash = connection
    .query_row(
      "SELECT COALESCE(SUM(total), 0) FROM sales WHERE cash_session_local_id = ?1 AND payment_method = 'cash'",
      params![cash_session_local_id.clone()],
      |row| row.get::<_, f64>(0),
    )
    .map_err(|error| format!("No se pudo sumar ventas locales en efectivo: {error}"))?;
    let total_transfer = connection
    .query_row(
      "SELECT COALESCE(SUM(total), 0) FROM sales WHERE cash_session_local_id = ?1 AND payment_method = 'transfer'",
      params![cash_session_local_id.clone()],
      |row| row.get::<_, f64>(0),
    )
    .map_err(|error| format!("No se pudo sumar ventas locales por transferencia: {error}"))?;
    let sale_count = connection
        .query_row(
            "SELECT COUNT(*) FROM sales WHERE cash_session_local_id = ?1",
            params![cash_session_local_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("No se pudo contar ventas locales: {error}"))?;

    Ok(LocalSessionSalesStats {
        total_sales,
        total_cash,
        total_transfer,
        sale_count,
    })
}

#[tauri::command]
pub fn list_local_sales(
    state: State<'_, DatabaseState>,
    from_date: Option<String>,
    to_date: Option<String>,
) -> Result<Vec<LocalSaleHistory>, String> {
    let connection = connection_from_state(&state)?;
    let (date_clause, params) = build_datetime_range_clause("s.updated_at", from_date, to_date);
    let params_refs: Vec<&dyn ToSql> = params.iter().map(|value| value.as_ref()).collect();

    let mut sales_sql = String::from(
        "SELECT s.local_id, s.remote_id, s.updated_at, s.total, s.payment_method
     FROM sales s
     WHERE 1 = 1",
    );
    sales_sql.push_str(&date_clause);
    sales_sql.push_str(" ORDER BY s.updated_at DESC");

    let mut statement = connection
        .prepare(&sales_sql)
        .map_err(|error| format!("No se pudo preparar lectura local de ventas: {error}"))?;

    let rows = statement
        .query_map(params_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| format!("No se pudieron leer ventas locales: {error}"))?;

    let mut sales = Vec::new();
    for row in rows {
        let (sale_local_id, remote_id, created_at, total, payment_method) =
            row.map_err(|error| format!("No se pudo mapear venta local: {error}"))?;

        let mut item_statement = connection
            .prepare(
                "SELECT
           si.local_id,
           si.product_name,
           si.quantity,
           si.unit_price,
           si.price_tier,
           si.subtotal,
           p.local_id,
           p.remote_id,
           p.name,
           p.display_name,
           p.color_hex,
           p.is_expense_eligible
         FROM sale_items si
         LEFT JOIN partners p ON p.local_id = si.owner_id
         WHERE si.sale_local_id = ?1
         ORDER BY si.local_id ASC",
            )
            .map_err(|error| format!("No se pudo preparar detalle local de venta: {error}"))?;

        let item_rows = item_statement
            .query_map(params![sale_local_id.clone()], |item_row| {
                let partner_local_id: Option<String> = item_row.get(6)?;
                let partner = if let Some(local_id) = partner_local_id {
                    Some(LocalPartner {
                        id: local_id,
                        remote_id: item_row.get::<_, Option<String>>(7)?,
                        name: item_row.get::<_, String>(8)?,
                        display_name: item_row.get::<_, String>(9)?,
                        color_hex: item_row.get::<_, String>(10)?,
                        is_expense_eligible: item_row.get::<_, i64>(11)? == 1,
                        created_at: None,
                    })
                } else {
                    None
                };

                Ok(LocalSaleHistoryItem {
                    id: item_row.get::<_, String>(0)?,
                    product_name: item_row.get::<_, String>(1)?,
                    quantity: item_row.get::<_, i64>(2)?,
                    unit_price: item_row.get::<_, f64>(3)?,
                    price_tier: item_row.get::<_, String>(4)?,
                    subtotal: item_row.get::<_, f64>(5)?,
                    owner_id: partner
                        .as_ref()
                        .and_then(|current| current.remote_id.clone())
                        .unwrap_or_else(|| {
                            partner
                                .as_ref()
                                .map(|current| current.id.clone())
                                .unwrap_or_default()
                        }),
                    partner,
                })
            })
            .map_err(|error| format!("No se pudo leer items locales de venta: {error}"))?;

        let mut sale_items = Vec::new();
        for item in item_rows {
            sale_items.push(
                item.map_err(|error| format!("No se pudo mapear item local de venta: {error}"))?,
            );
        }

        sales.push(LocalSaleHistory {
            id: sale_local_id,
            remote_id,
            created_at,
            total,
            payment_method,
            sold_by_partner: None,
            sale_items,
        });
    }

    Ok(sales)
}

#[tauri::command]
pub fn list_local_cash_sessions(
    state: State<'_, DatabaseState>,
    from_date: Option<String>,
    to_date: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<LocalCashSession>, String> {
    let connection = connection_from_state(&state)?;
    let (date_clause, mut params) = build_datetime_range_clause("opened_at", from_date, to_date);
    let mut sql = String::from(
    "SELECT local_id, remote_id, opened_by_remote_id, opened_at, closed_at, opening_cash, closing_cash, status, notes
     FROM cash_sessions
     WHERE 1 = 1",
  );
    sql.push_str(&date_clause);
    sql.push_str(" ORDER BY opened_at DESC");

    if params.is_empty() {
        sql.push_str(" LIMIT ?");
        params.push(Box::new(limit.unwrap_or(30).max(1)));
    }

    let params_refs: Vec<&dyn ToSql> = params.iter().map(|value| value.as_ref()).collect();
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("No se pudo preparar lectura local de sesiones: {error}"))?;

    let rows = statement
        .query_map(params_refs.as_slice(), map_cash_session)
        .map_err(|error| format!("No se pudieron leer sesiones locales: {error}"))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|error| format!("No se pudo mapear sesion local: {error}"))?);
    }

    Ok(sessions)
}

#[tauri::command]
pub fn get_local_cash_session_report(
    state: State<'_, DatabaseState>,
    cash_session_id: String,
) -> Result<Vec<LocalCashSessionReportRow>, String> {
    let connection = connection_from_state(&state)?;
    let Some((cash_session_local_id, _)) =
        resolve_cash_session_local_id(&connection, &cash_session_id)?
    else {
        return Ok(Vec::new());
    };

    let mut statement = connection
        .prepare(
            "SELECT
         cs.local_id,
         cs.opened_at,
         cs.closed_at,
         p.local_id,
         p.remote_id,
         p.name,
         p.display_name,
         p.color_hex,
         COALESCE((
           SELECT SUM(si.subtotal)
           FROM sales s
           JOIN sale_items si ON si.sale_local_id = s.local_id
           WHERE s.cash_session_local_id = cs.local_id
             AND si.owner_id = p.local_id
         ), 0) AS total_sales,
         COALESCE((
           SELECT SUM(ea.amount)
           FROM expenses e
           JOIN expense_allocations ea ON ea.expense_local_id = e.local_id
           WHERE e.cash_session_local_id = cs.local_id
             AND ea.partner_id = p.local_id
         ), 0) AS total_expenses
       FROM cash_sessions cs
       CROSS JOIN partners p
       WHERE cs.local_id = ?1
         AND p.is_active = 1
       ORDER BY p.name ASC",
        )
        .map_err(|error| format!("No se pudo preparar reporte local de sesion: {error}"))?;

    let rows = statement
        .query_map(params![cash_session_local_id], |row| {
            let total_sales: f64 = row.get(8)?;
            let total_expenses: f64 = row.get(9)?;
            let partner_remote_id: Option<String> = row.get(4)?;
            Ok(LocalCashSessionReportRow {
                session_id: row.get::<_, String>(0)?,
                opened_at: row.get::<_, String>(1)?,
                closed_at: row.get::<_, Option<String>>(2)?,
                partner_id: partner_remote_id
                    .unwrap_or_else(|| row.get::<_, String>(3).unwrap_or_default()),
                partner: row.get::<_, String>(5)?,
                display_name: row.get::<_, String>(6)?,
                color_hex: row.get::<_, String>(7)?,
                total_sales,
                total_expenses,
                net_total: total_sales - total_expenses,
            })
        })
        .map_err(|error| format!("No se pudo leer reporte local de sesion: {error}"))?;

    let mut report = Vec::new();
    for row in rows {
        report.push(
            row.map_err(|error| format!("No se pudo mapear reporte local de sesion: {error}"))?,
        );
    }

    Ok(report)
}

#[tauri::command]
pub fn adjust_local_product_stock(
    state: State<'_, DatabaseState>,
    product_id: String,
    quantity: i64,
    operation: String,
    reason: String,
) -> Result<AdjustLocalProductStockResult, String> {
    if quantity <= 0 {
        return Err("Cantidad invalida".to_string());
    }

    if operation != "in" && operation != "out" {
        return Err("Operacion invalida".to_string());
    }

    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para ajuste: {error}"))?;

    let Some((product_local_id, product_remote_id, _, _, _, current_stock, _)) =
        resolve_product_row(&transaction, &product_id)?
    else {
        return Err("Producto no encontrado".to_string());
    };

    let movement_delta = if operation == "in" {
        quantity
    } else {
        -quantity
    };
    let next_stock = current_stock + movement_delta;

    transaction
        .execute(
            "UPDATE products
       SET stock = ?2, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE local_id = ?1",
            params![product_local_id.clone(), next_stock],
        )
        .map_err(|error| format!("No se pudo ajustar stock local: {error}"))?;

    let movement_id = Uuid::new_v4().to_string();

    transaction
        .execute(
            "INSERT INTO inventory_movements (
         local_id, remote_id, product_id, product_remote_id, quantity_change, reason,
         reference_local_id, reference_remote_id, performed_by_remote_id, sync_status
       ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?2, NULL, NULL, 'pending')",
            params![
                movement_id.clone(),
                product_local_id.clone(),
                product_remote_id,
                movement_delta,
                reason
            ],
        )
        .map_err(|error| format!("No se pudo registrar movimiento local: {error}"))?;

    let payload = serde_json::json!({
      "productId": product_id,
      "quantity": quantity,
      "operation": operation,
      "reason": reason,
      "movementLocalId": movement_id,
    });

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
       ) VALUES (?1, 'inventory_movements', ?2, ?3, 'adjust', ?4, 'pending')",
      params![
        Uuid::new_v4().to_string(),
        product_local_id.clone(),
        product_remote_id,
        payload.to_string()
      ],
    )
    .map_err(|error| format!("No se pudo encolar ajuste local de inventario: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar ajuste local de inventario: {error}"))?;

    Ok(AdjustLocalProductStockResult {
        product_id: product_local_id,
        new_stock: next_stock,
        movement_delta,
    })
}

#[tauri::command]
pub fn list_local_inventory_movements(
    state: State<'_, DatabaseState>,
    limit: Option<i64>,
) -> Result<Vec<LocalInventoryMovementWithProduct>, String> {
    let connection = connection_from_state(&state)?;
    let movement_limit = limit.unwrap_or(200).max(1);

    let mut statement = connection
        .prepare(
            "SELECT
         im.local_id,
         im.product_id,
         im.quantity_change,
         im.reason,
         im.reference_remote_id,
         im.performed_by_remote_id,
         im.updated_at,
         p.local_id,
         p.remote_id,
         p.name,
         p.barcode,
         o.local_id,
         o.remote_id,
         o.name,
         o.display_name,
         o.color_hex,
         o.is_expense_eligible
       FROM inventory_movements im
       LEFT JOIN products p ON p.local_id = im.product_id
       LEFT JOIN partners o ON o.local_id = p.owner_id
       ORDER BY im.updated_at DESC
       LIMIT ?1",
        )
        .map_err(|error| format!("No se pudo preparar lectura local de movimientos: {error}"))?;

    let rows = statement
        .query_map(params![movement_limit], |row| {
            let product_local_id: Option<String> = row.get(7)?;
            let owner_local_id: Option<String> = row.get(11)?;
            let owner = if let Some(local_id) = owner_local_id {
                Some(LocalPartner {
                    id: local_id,
                    remote_id: row.get::<_, Option<String>>(12)?,
                    name: row.get::<_, String>(13)?,
                    display_name: row.get::<_, String>(14)?,
                    color_hex: row.get::<_, String>(15)?,
                    is_expense_eligible: row.get::<_, i64>(16)? == 1,
                    created_at: None,
                })
            } else {
                None
            };

            let product = if let Some(local_id) = product_local_id {
                Some(LocalInventoryMovementProduct {
                    id: row.get::<_, Option<String>>(8)?.unwrap_or(local_id),
                    name: row.get::<_, String>(9)?,
                    barcode: row.get::<_, String>(10)?,
                    owner,
                })
            } else {
                None
            };

            Ok(LocalInventoryMovementWithProduct {
                id: row.get::<_, String>(0)?,
                product_id: row.get::<_, String>(1)?,
                quantity_change: row.get::<_, i64>(2)?,
                reason: row.get::<_, String>(3)?,
                reference_id: row.get::<_, Option<String>>(4)?,
                performed_by: row.get::<_, Option<String>>(5)?,
                created_at: row.get::<_, String>(6)?,
                product,
            })
        })
        .map_err(|error| format!("No se pudieron leer movimientos locales: {error}"))?;

    let mut movements = Vec::new();
    for row in rows {
        movements
            .push(row.map_err(|error| format!("No se pudo mapear movimiento local: {error}"))?);
    }

    Ok(movements)
}

#[tauri::command]
pub fn list_local_bodega_products(
    state: State<'_, DatabaseState>,
) -> Result<Vec<LocalBodegaProduct>, String> {
    let connection = connection_from_state(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT
         p.local_id,
         p.remote_id,
         p.name,
         p.barcode,
         p.sku,
         p.sale_price,
         p.sale_price_x3,
         p.sale_price_x6,
         p.sale_price_x12,
         p.stock,
         p.bodega_stock,
         p.bodega_at,
         p.is_active,
         o.local_id,
         o.remote_id,
         o.name,
         o.display_name,
         o.color_hex,
         o.is_expense_eligible
       FROM products p
       LEFT JOIN partners o ON o.local_id = p.owner_id
       WHERE p.bodega_stock > 0
         AND p.disposed_at IS NULL
       ORDER BY p.bodega_at ASC",
        )
        .map_err(|error| format!("No se pudo preparar lectura local de bodega: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let owner_local_id: Option<String> = row.get(13)?;
            let owner = owner_local_id.map(|local_id| LocalPartner {
                id: local_id,
                remote_id: row.get::<_, Option<String>>(14).unwrap_or(None),
                name: row.get::<_, String>(15).unwrap_or_default(),
                display_name: row.get::<_, String>(16).unwrap_or_default(),
                color_hex: row.get::<_, String>(17).unwrap_or_default(),
                is_expense_eligible: row.get::<_, i64>(18).unwrap_or(1) == 1,
                created_at: None,
            });

            Ok(LocalBodegaProduct {
                id: row.get::<_, String>(0)?,
                remote_id: row.get::<_, Option<String>>(1)?,
                name: row.get::<_, String>(2)?,
                barcode: row.get::<_, String>(3)?,
                sku: row.get::<_, Option<String>>(4)?,
                sale_price: row.get::<_, f64>(5)?,
                sale_price_x3: row.get::<_, Option<f64>>(6)?,
                sale_price_x6: row.get::<_, Option<f64>>(7)?,
                sale_price_x12: row.get::<_, Option<f64>>(8)?,
                stock: row.get::<_, i64>(9)?,
                bodega_stock: row.get::<_, i64>(10)?,
                bodega_at: row.get::<_, Option<String>>(11)?,
                is_active: row.get::<_, i64>(12)? == 1,
                owner,
            })
        })
        .map_err(|error| format!("No se pudieron leer productos locales de bodega: {error}"))?;

    let mut products = Vec::new();
    for row in rows {
        products.push(
            row.map_err(|error| format!("No se pudo mapear producto de bodega local: {error}"))?,
        );
    }

    Ok(products)
}

#[tauri::command]
pub fn create_local_remate(
    state: State<'_, DatabaseState>,
    product_id: String,
    clearance_price: f64,
    stock: i64,
) -> Result<CreateLocalRemateResult, String> {
    if clearance_price <= 0.0 {
        return Err("Precio de remate invalido".to_string());
    }

    if stock <= 0 {
        return Err("Cantidad invalida para remate".to_string());
    }

    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para remate: {error}"))?;

    let Some((product_local_id, product_remote_id, product_name, _, _, current_stock, _)) =
        resolve_product_row(&transaction, &product_id)?
    else {
        return Err("Producto no encontrado".to_string());
    };

    let Some((original_price, current_bodega_stock, disposed_at)) = transaction
        .query_row(
            "SELECT sale_price, bodega_stock, disposed_at
       FROM products
       WHERE local_id = ?1
       LIMIT 1",
            params![product_local_id.clone()],
            |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo leer estado local de bodega: {error}"))?
    else {
        return Err("Producto no encontrado en bodega".to_string());
    };

    if disposed_at.is_some() || current_bodega_stock <= 0 {
        return Err("Producto no encontrado en bodega".to_string());
    }

    if stock > current_bodega_stock {
        return Err(format!(
      "No puedes reingresar mas unidades ({stock}) de las que hay en bodega ({current_bodega_stock})"
    ));
    }

    transaction
        .execute(
            "UPDATE products
       SET is_active = 1,
           is_clearance = 1,
           clearance_price = ?2,
           bodega_at = NULL,
           stock = ?3,
           bodega_stock = ?4,
           sync_status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE local_id = ?1",
            params![
                product_local_id.clone(),
                clearance_price,
                current_stock + stock,
                current_bodega_stock - stock
            ],
        )
        .map_err(|error| format!("No se pudo actualizar producto local para remate: {error}"))?;

    let movement_id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO inventory_movements (
         local_id, remote_id, product_id, product_remote_id, quantity_change, reason,
         reference_local_id, reference_remote_id, performed_by_remote_id, sync_status
       ) VALUES (?1, NULL, ?2, ?3, ?4, 'restock', ?2, NULL, NULL, 'pending')",
            params![
                movement_id,
                product_local_id.clone(),
                product_remote_id.clone(),
                stock
            ],
        )
        .map_err(|error| format!("No se pudo registrar movimiento local de remate: {error}"))?;

    let payload = serde_json::json!({
      "productId": product_id,
      "clearancePrice": clearance_price,
      "stock": stock,
      "movementLocalId": movement_id,
    });

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
       ) VALUES (?1, 'products', ?2, ?3, 'create_remate', ?4, 'pending')",
      params![
        Uuid::new_v4().to_string(),
        product_local_id.clone(),
        product_remote_id,
        payload.to_string()
      ],
    )
    .map_err(|error| format!("No se pudo encolar remate local: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar remate local: {error}"))?;

    Ok(CreateLocalRemateResult {
        product_id: product_local_id,
        product_name,
        original_price,
        remate_price: clearance_price,
    })
}

#[tauri::command]
pub fn dispose_local_product(
    state: State<'_, DatabaseState>,
    product_id: String,
) -> Result<DisposeLocalProductResult, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para desecho: {error}"))?;

    let Some((product_local_id, product_remote_id, product_name, _, _, _, _)) =
        resolve_product_row(&transaction, &product_id)?
    else {
        return Err("Producto no encontrado".to_string());
    };

    let Some((current_bodega_stock, disposed_at)) = transaction
        .query_row(
            "SELECT bodega_stock, disposed_at
       FROM products
       WHERE local_id = ?1
       LIMIT 1",
            params![product_local_id.clone()],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|error| format!("No se pudo leer estado local para desecho: {error}"))?
    else {
        return Err("Producto no encontrado en bodega".to_string());
    };

    if disposed_at.is_some() || current_bodega_stock <= 0 {
        return Err("Producto no encontrado en bodega".to_string());
    }

    transaction
        .execute(
            "UPDATE products
       SET disposed_at = CURRENT_TIMESTAMP,
           bodega_stock = 0,
           sync_status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE local_id = ?1",
            params![product_local_id.clone()],
        )
        .map_err(|error| format!("No se pudo marcar desecho local: {error}"))?;

    let payload = serde_json::json!({
      "productId": product_id,
    });

    transaction
    .execute(
      "INSERT INTO sync_queue (
         local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
       ) VALUES (?1, 'products', ?2, ?3, 'dispose', ?4, 'pending')",
      params![
        Uuid::new_v4().to_string(),
        product_local_id.clone(),
        product_remote_id,
        payload.to_string()
      ],
    )
    .map_err(|error| format!("No se pudo encolar desecho local: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar desecho local: {error}"))?;

    Ok(DisposeLocalProductResult {
        product_id: product_local_id,
        product_name,
    })
}

#[tauri::command]
pub fn list_local_partners(state: State<'_, DatabaseState>) -> Result<Vec<LocalPartner>, String> {
    let connection = connection_from_state(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT local_id, remote_id, name, display_name, color_hex, is_expense_eligible
       FROM partners
       WHERE is_active = 1
       ORDER BY name ASC",
        )
        .map_err(|error| format!("No se pudo preparar lectura de partners locales: {error}"))?;

    let rows = statement
        .query_map([], map_partner)
        .map_err(|error| format!("No se pudieron leer partners locales: {error}"))?;

    let mut partners = Vec::new();
    for row in rows {
        partners.push(row.map_err(|error| format!("No se pudo mapear partner local: {error}"))?);
    }

    Ok(partners)
}

#[tauri::command]
pub fn get_local_sync_queue_stats(
    state: State<'_, DatabaseState>,
) -> Result<LocalSyncQueueStats, String> {
    let connection = connection_from_state(&state)?;

    let total: i64 = connection
        .query_row("SELECT COUNT(*) FROM sync_queue", [], |row| row.get(0))
        .map_err(|error| format!("No se pudo contar cola local: {error}"))?;

    let pending: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudo contar pendientes locales: {error}"))?;

    let failed: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudo contar fallidos locales: {error}"))?;

    Ok(LocalSyncQueueStats {
        total,
        pending,
        failed,
    })
}

#[tauri::command]
pub fn list_local_sync_queue(
    state: State<'_, DatabaseState>,
) -> Result<Vec<LocalSyncQueueItem>, String> {
    let connection = connection_from_state(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT
         local_id,
         entity_name,
         entity_local_id,
         entity_remote_id,
         operation_type,
         payload_json,
         idempotency_key,
         status,
         attempts,
         next_retry_at,
         last_error,
         created_at,
         updated_at
       FROM sync_queue
       ORDER BY created_at DESC",
        )
        .map_err(|error| format!("No se pudo preparar lectura de cola local: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(LocalSyncQueueItem {
                id: row.get::<_, String>(0)?,
                entity_name: row.get::<_, String>(1)?,
                entity_local_id: row.get::<_, String>(2)?,
                entity_remote_id: row.get::<_, Option<String>>(3)?,
                operation_type: row.get::<_, String>(4)?,
                payload_json: row.get::<_, String>(5)?,
                idempotency_key: row.get::<_, Option<String>>(6)?,
                status: row.get::<_, String>(7)?,
                attempts: row.get::<_, i64>(8)?,
                next_retry_at: row.get::<_, Option<String>>(9)?,
                last_error: row.get::<_, Option<String>>(10)?,
                created_at: row.get::<_, String>(11)?,
                updated_at: row.get::<_, String>(12)?,
            })
        })
        .map_err(|error| format!("No se pudo leer cola local: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("No se pudo mapear cola local: {error}"))?);
    }

    Ok(items)
}

#[tauri::command]
pub fn remove_local_sync_queue_item(
    state: State<'_, DatabaseState>,
    item_id: String,
) -> Result<bool, String> {
    let connection = connection_from_state(&state)?;
    let deleted = connection
        .execute(
            "DELETE FROM sync_queue WHERE local_id = ?1",
            params![item_id],
        )
        .map_err(|error| format!("No se pudo quitar item de cola local: {error}"))?;

    Ok(deleted > 0)
}

#[tauri::command]
pub fn requeue_local_sync_queue_item(
    state: State<'_, DatabaseState>,
    item_id: String,
) -> Result<bool, String> {
    let connection = connection_from_state(&state)?;
    let updated = connection
        .execute(
            "UPDATE sync_queue
       SET status = 'pending',
           last_error = NULL,
           next_retry_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE local_id = ?1",
            params![item_id],
        )
        .map_err(|error| format!("No se pudo reencolar item local: {error}"))?;

    Ok(updated > 0)
}

#[tauri::command]
pub fn requeue_all_failed_local_sync_queue_items(
    state: State<'_, DatabaseState>,
) -> Result<i64, String> {
    let connection = connection_from_state(&state)?;
    let updated = connection
        .execute(
            "UPDATE sync_queue
       SET status = 'pending',
           last_error = NULL,
           next_retry_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'failed'",
            [],
        )
        .map_err(|error| format!("No se pudieron reencolar fallidos locales: {error}"))?;

    Ok(updated as i64)
}

#[tauri::command]
pub fn mark_local_sync_queue_item_synced(
    state: State<'_, DatabaseState>,
    item_id: String,
    entity_remote_id: Option<String>,
) -> Result<bool, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection.transaction().map_err(|error| {
        format!("No se pudo abrir transaccion local para sync exitoso: {error}")
    })?;

    let Some((entity_name, entity_local_id, queue_remote_id, operation_type, payload_json)) = transaction
    .query_row(
      "SELECT entity_name, entity_local_id, entity_remote_id, operation_type, payload_json
       FROM sync_queue
       WHERE local_id = ?1
       LIMIT 1",
      params![item_id.clone()],
      |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, Option<String>>(2)?,
          row.get::<_, String>(3)?,
          row.get::<_, String>(4)?,
        ))
      },
    )
    .optional()
    .map_err(|error| format!("No se pudo leer item de sync local: {error}"))?
  else {
    return Ok(false);
  };

    let effective_remote_id = entity_remote_id.or(queue_remote_id);
    let entity_sync_status =
        entity_sync_status_after_success(&transaction, &entity_name, &entity_local_id, &item_id)?;

    match entity_name.as_str() {
        "cash_sessions" => {
            if effective_remote_id.is_none() {
                return Err("No se recibio remote_id para sincronizar la sesion local".to_string());
            }

            transaction
                .execute(
                    "UPDATE cash_sessions
           SET remote_id = COALESCE(remote_id, ?2),
               sync_status = ?3,
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE local_id = ?1",
                    params![
                        entity_local_id.clone(),
                        effective_remote_id.clone(),
                        entity_sync_status
                    ],
                )
                .map_err(|error| {
                    format!("No se pudo marcar sesion local como sincronizada: {error}")
                })?;

            transaction
                .execute(
                    "UPDATE sales
           SET cash_session_remote_id = COALESCE(cash_session_remote_id, ?2),
               updated_at = CURRENT_TIMESTAMP
           WHERE cash_session_local_id = ?1",
                    params![entity_local_id.clone(), effective_remote_id.clone()],
                )
                .map_err(|error| {
                    format!("No se pudo propagar remote_id de sesion a ventas locales: {error}")
                })?;

            transaction
                .execute(
                    "UPDATE expenses
           SET cash_session_remote_id = COALESCE(cash_session_remote_id, ?2),
               updated_at = CURRENT_TIMESTAMP
           WHERE cash_session_local_id = ?1",
                    params![entity_local_id.clone(), effective_remote_id.clone()],
                )
                .map_err(|error| {
                    format!("No se pudo propagar remote_id de sesion a gastos locales: {error}")
                })?;
        }
        "sales" => {
            if effective_remote_id.is_none() {
                return Err("No se recibio remote_id para sincronizar la venta local".to_string());
            }

            transaction
                .execute(
                    "UPDATE sales
           SET remote_id = COALESCE(remote_id, ?2),
               sync_status = 'synced',
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE local_id = ?1",
                    params![entity_local_id.clone(), effective_remote_id.clone()],
                )
                .map_err(|error| {
                    format!("No se pudo marcar venta local como sincronizada: {error}")
                })?;

            transaction
                .execute(
                    "UPDATE sale_items
           SET sale_remote_id = COALESCE(sale_remote_id, ?2),
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE sale_local_id = ?1",
                    params![entity_local_id.clone(), effective_remote_id.clone()],
                )
                .map_err(|error| {
                    format!("No se pudo marcar detalle local de venta como sincronizado: {error}")
                })?;

            transaction
        .execute(
          "UPDATE inventory_movements
           SET reference_remote_id = COALESCE(reference_remote_id, ?2),
               sync_status = 'synced',
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE reference_local_id = ?1
             AND reason = 'sale'",
          params![entity_local_id.clone(), effective_remote_id.clone()],
        )
        .map_err(|error| format!("No se pudo marcar movimientos locales de venta como sincronizados: {error}"))?;
        }
        "expenses" => {
            if effective_remote_id.is_none() {
                return Err("No se recibio remote_id para sincronizar el gasto local".to_string());
            }

            transaction
                .execute(
                    "UPDATE expenses
           SET remote_id = COALESCE(remote_id, ?2),
               sync_status = ?3,
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE local_id = ?1",
                    params![
                        entity_local_id.clone(),
                        effective_remote_id.clone(),
                        entity_sync_status
                    ],
                )
                .map_err(|error| {
                    format!("No se pudo marcar gasto local como sincronizado: {error}")
                })?;

            transaction
        .execute(
          "UPDATE expense_allocations
           SET expense_remote_id = COALESCE(expense_remote_id, ?2),
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE expense_local_id = ?1",
          params![entity_local_id.clone(), effective_remote_id.clone()],
        )
        .map_err(|error| format!("No se pudieron marcar asignaciones locales del gasto como sincronizadas: {error}"))?;
        }
        "products" => {
            transaction
                .execute(
                    "UPDATE products
           SET remote_id = COALESCE(remote_id, ?2),
               sync_status = ?3,
               synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE local_id = ?1",
                    params![
                        entity_local_id.clone(),
                        effective_remote_id.clone(),
                        entity_sync_status
                    ],
                )
                .map_err(|error| {
                    format!("No se pudo marcar producto local como sincronizado: {error}")
                })?;

            transaction
        .execute(
          "UPDATE sale_items
           SET product_remote_id = COALESCE(product_remote_id, ?2),
               updated_at = CURRENT_TIMESTAMP
           WHERE product_local_id = ?1",
          params![entity_local_id.clone(), effective_remote_id.clone()],
        )
        .map_err(|error| format!("No se pudo propagar remote_id del producto a detalle local de venta: {error}"))?;

            transaction
                .execute(
                    "UPDATE inventory_movements
           SET product_remote_id = COALESCE(product_remote_id, ?2),
               updated_at = CURRENT_TIMESTAMP
           WHERE product_id = ?1",
                    params![entity_local_id.clone(), effective_remote_id.clone()],
                )
                .map_err(|error| {
                    format!(
                        "No se pudo propagar remote_id del producto a movimientos locales: {error}"
                    )
                })?;

            mark_inventory_movement_synced_for_item(
                &transaction,
                &entity_local_id,
                &operation_type,
                &payload_json,
                effective_remote_id.as_deref(),
            )?;
        }
        "inventory_movements" => {
            mark_inventory_movement_synced_for_item(
                &transaction,
                &entity_local_id,
                &operation_type,
                &payload_json,
                effective_remote_id.as_deref(),
            )?;
        }
        _ => {}
    }

    propagate_remote_id_to_followups(
        &transaction,
        &entity_name,
        &entity_local_id,
        &item_id,
        effective_remote_id.as_deref(),
    )?;

    transaction
        .execute(
            "DELETE FROM sync_queue WHERE local_id = ?1",
            params![item_id],
        )
        .map_err(|error| {
            format!("No se pudo remover item sincronizado de la cola local: {error}")
        })?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar sync exitoso local: {error}"))?;

    Ok(true)
}

#[tauri::command]
pub fn mark_local_sync_queue_item_failed(
    state: State<'_, DatabaseState>,
    item_id: String,
    error_message: String,
    retryable: bool,
) -> Result<bool, String> {
    let connection = connection_from_state(&state)?;
    let next_status = if retryable { "pending" } else { "failed" };
    let updated = connection
        .execute(
            "UPDATE sync_queue
       SET status = ?2,
           attempts = attempts + 1,
           last_error = ?3,
           next_retry_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE local_id = ?1",
            params![item_id, next_status, error_message],
        )
        .map_err(|error| format!("No se pudo registrar error de sync local: {error}"))?;

    Ok(updated > 0)
}

#[tauri::command]
pub fn upsert_remote_partners(
    state: State<'_, DatabaseState>,
    partners: Vec<LocalPartner>,
) -> Result<usize, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para partners: {error}"))?;

    for partner in &partners {
        let local_id = partner
            .remote_id
            .clone()
            .unwrap_or_else(|| partner.id.clone());
        transaction
      .execute(
        r#"
        INSERT INTO partners (
          local_id, remote_id, name, display_name, color_hex, is_expense_eligible, is_active, sync_status, synced_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'synced', CURRENT_TIMESTAMP)
        ON CONFLICT(local_id) DO UPDATE SET
          remote_id = excluded.remote_id,
          name = excluded.name,
          display_name = excluded.display_name,
          color_hex = excluded.color_hex,
          is_expense_eligible = excluded.is_expense_eligible,
          is_active = 1,
          sync_status = 'synced',
          updated_at = CURRENT_TIMESTAMP,
          synced_at = CURRENT_TIMESTAMP
        "#,
        params![
          local_id,
          partner.remote_id,
          partner.name,
          partner.display_name,
          partner.color_hex,
          if partner.is_expense_eligible { 1 } else { 0 }
        ],
      )
      .map_err(|error| format!("No se pudo guardar partner local: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar partners locales: {error}"))?;

    Ok(partners.len())
}

#[tauri::command]
pub fn list_local_products(
    state: State<'_, DatabaseState>,
    filters: ProductQuery,
) -> Result<Vec<LocalProductWithOwner>, String> {
    let connection = connection_from_state(&state)?;
    let (sql, params) = build_product_query_sql(&filters);
    let params_refs: Vec<&dyn ToSql> = params.iter().map(|value| value.as_ref()).collect();

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("No se pudo preparar lectura de productos locales: {error}"))?;
    let rows = statement
        .query_map(params_refs.as_slice(), map_product_with_owner)
        .map_err(|error| format!("No se pudieron leer productos locales: {error}"))?;

    let mut products = Vec::new();
    for row in rows {
        products.push(row.map_err(|error| format!("No se pudo mapear producto local: {error}"))?);
    }

    Ok(products)
}

#[tauri::command]
pub fn list_local_product_keys(
    state: State<'_, DatabaseState>,
) -> Result<Vec<LocalProductKey>, String> {
    let connection = connection_from_state(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT local_id, remote_id, barcode, sku
       FROM products
       ORDER BY updated_at DESC",
        )
        .map_err(|error| {
            format!("No se pudo preparar lectura local de claves de productos: {error}")
        })?;

    let rows = statement
        .query_map([], |row| {
            Ok(LocalProductKey {
                id: row.get::<_, String>(0)?,
                remote_id: row.get::<_, Option<String>>(1)?,
                barcode: row.get::<_, String>(2)?,
                sku: row.get::<_, Option<String>>(3)?,
            })
        })
        .map_err(|error| format!("No se pudieron leer claves locales de productos: {error}"))?;

    let mut products = Vec::new();
    for row in rows {
        products.push(
            row.map_err(|error| format!("No se pudo mapear clave local de producto: {error}"))?,
        );
    }

    Ok(products)
}

#[tauri::command]
pub fn count_local_products(
    state: State<'_, DatabaseState>,
    search: Option<String>,
    owner_id: Option<String>,
) -> Result<ProductCounts, String> {
    let connection = connection_from_state(&state)?;
    let (where_clause, params) = build_counts_where_clause(search, owner_id);
    let params_refs: Vec<&dyn ToSql> = params.iter().map(|value| value.as_ref()).collect();

    let total_sql = format!("SELECT COUNT(*) FROM products{where_clause}");
    let out_sql = format!("SELECT COUNT(*) FROM products{where_clause} AND stock <= 0");
    let low_sql =
        format!("SELECT COUNT(*) FROM products{where_clause} AND stock > 0 AND stock <= min_stock");
    let ok_sql = format!("SELECT COUNT(*) FROM products{where_clause} AND stock > min_stock");

    let total_count: i64 = connection
        .query_row(&total_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|error| format!("No se pudo contar productos locales: {error}"))?;
    let out_count: i64 = connection
        .query_row(&out_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|error| format!("No se pudo contar productos agotados locales: {error}"))?;
    let low_count: i64 = connection
        .query_row(&low_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|error| format!("No se pudo contar productos bajos locales: {error}"))?;
    let available_count: i64 = connection
        .query_row(&ok_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|error| format!("No se pudo contar productos disponibles locales: {error}"))?;

    Ok(ProductCounts {
        total_count,
        out_count,
        low_count,
        available_count,
    })
}

#[tauri::command]
pub fn upsert_remote_products(
    state: State<'_, DatabaseState>,
    products: Vec<LocalProduct>,
) -> Result<usize, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para productos: {error}"))?;

    for product in &products {
        let local_id = product
            .remote_id
            .clone()
            .unwrap_or_else(|| product.id.clone());
        let owner_local_id = product.owner_id.clone();

        transaction
            .execute(
                r#"
        INSERT INTO products (
          local_id, remote_id, barcode, sku, name, description, category,
          owner_id, owner_remote_id, purchase_price, sale_price, sale_price_x3, sale_price_x6, sale_price_x12, stock, min_stock,
          image_url, is_active, is_clearance, clearance_price, bodega_at, disposed_at, bodega_stock,
          sync_status, synced_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7,
          ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
          ?17, ?18, ?19, ?20, ?21, ?22, ?23,
          'synced', CURRENT_TIMESTAMP
        )
        ON CONFLICT(local_id) DO UPDATE SET
          remote_id = excluded.remote_id,
          barcode = excluded.barcode,
          sku = excluded.sku,
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          owner_id = excluded.owner_id,
          owner_remote_id = excluded.owner_remote_id,
          purchase_price = excluded.purchase_price,
          sale_price = excluded.sale_price,
          sale_price_x3 = excluded.sale_price_x3,
          sale_price_x6 = excluded.sale_price_x6,
          sale_price_x12 = excluded.sale_price_x12,
          stock = excluded.stock,
          min_stock = excluded.min_stock,
          image_url = excluded.image_url,
          is_active = excluded.is_active,
          is_clearance = excluded.is_clearance,
          clearance_price = excluded.clearance_price,
          bodega_at = excluded.bodega_at,
          disposed_at = excluded.disposed_at,
          bodega_stock = excluded.bodega_stock,
          sync_status = 'synced',
          updated_at = CURRENT_TIMESTAMP,
          synced_at = CURRENT_TIMESTAMP
        "#,
                params![
                    local_id,
                    product.remote_id,
                    product.barcode,
                    product.sku,
                    product.name,
                    product.description,
                    product.category,
                    owner_local_id,
                    product.owner_id,
                    product.purchase_price,
                    product.sale_price,
                    product.sale_price_x3,
                    product.sale_price_x6,
                    product.sale_price_x12,
                    product.stock,
                    product.min_stock,
                    product.image_url,
                    if product.is_active { 1 } else { 0 },
                    if product.is_clearance { 1 } else { 0 },
                    product.clearance_price,
                    product.bodega_at,
                    product.disposed_at,
                    product.bodega_stock
                ],
            )
            .map_err(|error| format!("No se pudo guardar producto local: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar productos locales: {error}"))?;

    Ok(products.len())
}

#[tauri::command]
pub fn find_local_product_by_barcode(
    state: State<'_, DatabaseState>,
    barcode: String,
) -> Result<Option<LocalProductWithOwner>, String> {
    let connection = connection_from_state(&state)?;
    let mut statement = connection
        .prepare(
            r#"
      SELECT
        p.local_id AS product_local_id,
        p.remote_id AS product_remote_id,
        p.barcode,
        p.sku,
        p.name,
        p.description,
        p.category,
        p.purchase_price,
        p.sale_price,
        p.sale_price_x3,
        p.sale_price_x6,
        p.sale_price_x12,
        p.stock,
        p.min_stock,
        p.image_url,
        p.is_active,
        p.is_clearance,
        p.clearance_price,
        p.bodega_at,
        p.disposed_at,
        p.bodega_stock,
        p.updated_at,
        o.local_id AS owner_local_id,
        o.remote_id AS owner_remote_id,
        o.name AS owner_name,
        o.display_name AS owner_display_name,
        o.color_hex AS owner_color_hex,
        o.is_expense_eligible AS owner_is_expense_eligible
      FROM products p
      JOIN partners o ON o.local_id = p.owner_id
      WHERE p.is_active = 1
        AND (p.barcode = ?1 OR COALESCE(p.sku, '') = ?1)
      LIMIT 1
      "#,
        )
        .map_err(|error| format!("No se pudo preparar busqueda local de barcode: {error}"))?;

    let product = statement
        .query_row(params![barcode], map_product_with_owner)
        .optional()
        .map_err(|error| format!("No se pudo buscar producto local por barcode: {error}"))?;

    Ok(product)
}

#[tauri::command]
pub fn generate_next_local_barcode(state: State<'_, DatabaseState>) -> Result<String, String> {
    let connection = connection_from_state(&state)?;
    let last_barcode = connection
        .query_row(
            "SELECT barcode FROM products WHERE barcode LIKE 'ELB-%' ORDER BY barcode DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("No se pudo leer ultimo barcode local: {error}"))?;

    let mut next_num = 1_i64;
    if let Some(value) = last_barcode {
        if let Some(number) = value
            .strip_prefix("ELB-")
            .and_then(|raw| raw.parse::<i64>().ok())
        {
            next_num = number + 1;
        }
    }

    Ok(format!("ELB-{next_num:05}"))
}

#[tauri::command]
pub fn upsert_local_product(
    state: State<'_, DatabaseState>,
    input: UpsertLocalProductInput,
) -> Result<UpsertLocalProductResult, String> {
    let mut connection = connection_from_state(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo abrir transaccion local para producto: {error}"))?;

    let existing = if let Some(product_id) = input.product_id.as_ref() {
        transaction
      .query_row(
        "SELECT local_id, stock, remote_id FROM products WHERE local_id = ?1 OR remote_id = ?1 LIMIT 1",
        params![product_id],
        |row| {
          Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<String>>(2)?,
          ))
        },
      )
      .optional()
      .map_err(|error| format!("No se pudo leer producto local existente: {error}"))?
    } else {
        None
    };

    let local_id = existing
        .as_ref()
        .map(|(local_id, _, _)| local_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let previous_stock = existing.as_ref().map(|(_, stock, _)| *stock).unwrap_or(0);
    let movement_delta = input.stock - previous_stock;
    let remote_id = input.remote_id.clone().or_else(|| {
        existing
            .as_ref()
            .and_then(|(_, _, remote_id)| remote_id.clone())
    });

    transaction
        .execute(
            r#"
      INSERT INTO products (
        local_id, remote_id, barcode, sku, name, description, category,
        owner_id, owner_remote_id, purchase_price, sale_price, sale_price_x3, sale_price_x6, sale_price_x12, stock, min_stock,
        image_url, is_active, is_clearance, clearance_price, bodega_at, disposed_at, bodega_stock,
        sync_status
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7,
        ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
        NULL, ?17, 0, NULL, NULL, NULL, 0,
        'pending'
      )
      ON CONFLICT(local_id) DO UPDATE SET
        remote_id = excluded.remote_id,
        barcode = excluded.barcode,
        sku = excluded.sku,
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        owner_id = excluded.owner_id,
        owner_remote_id = excluded.owner_remote_id,
        purchase_price = excluded.purchase_price,
        sale_price = excluded.sale_price,
        sale_price_x3 = excluded.sale_price_x3,
        sale_price_x6 = excluded.sale_price_x6,
        sale_price_x12 = excluded.sale_price_x12,
        stock = excluded.stock,
        min_stock = excluded.min_stock,
        is_active = excluded.is_active,
        sync_status = 'pending',
        updated_at = CURRENT_TIMESTAMP
      "#,
            params![
                local_id,
                remote_id,
                input.barcode,
                input.sku,
                input.name,
                input.description,
                input.category,
                input.owner_id,
                input.owner_id,
                input.purchase_price,
                input.sale_price,
                input.sale_price_x3,
                input.sale_price_x6,
                input.sale_price_x12,
                input.stock,
                input.min_stock,
                if input.is_active { 1 } else { 0 }
            ],
        )
        .map_err(|error| format!("No se pudo guardar producto local: {error}"))?;

    let movement_local_id = if movement_delta != 0 {
        let movement_id = Uuid::new_v4().to_string();
        let reason = if existing.is_some() {
            "manual_adjustment"
        } else {
            "initial_stock"
        };

        transaction
      .execute(
        r#"
        INSERT INTO inventory_movements (
          local_id, product_id, product_remote_id, quantity_change, reason, reference_local_id, sync_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')
        "#,
        params![movement_id, local_id, remote_id, movement_delta, reason, local_id],
      )
      .map_err(|error| format!("No se pudo registrar movimiento local de inventario: {error}"))?;
        Some(movement_id)
    } else {
        None
    };

    let desired_queue_operation = if existing.is_some() { "update" } else { "insert" };
    let existing_queue = transaction
        .query_row(
            r#"
      SELECT local_id, operation_type
      FROM sync_queue
      WHERE entity_name = 'products'
        AND entity_local_id = ?1
        AND status IN ('pending', 'failed')
        AND operation_type IN ('insert', 'update')
      ORDER BY
        CASE WHEN operation_type = 'insert' THEN 0 ELSE 1 END,
        created_at ASC,
        local_id ASC
      LIMIT 1
      "#,
            params![local_id.clone()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("No se pudo revisar cola local de producto: {error}"))?;

    let mut payload = serde_json::to_value(&input)
        .map_err(|error| format!("No se pudo serializar payload local de producto: {error}"))?;
    if let Some(movement_id) = movement_local_id {
        payload["movementLocalId"] = serde_json::Value::String(movement_id);
    }
    payload["movementDelta"] = serde_json::Value::from(movement_delta);
    let payload = serde_json::to_string(&payload)
        .map_err(|error| format!("No se pudo serializar payload final del producto: {error}"))?;

    if let Some((queue_id, queued_operation)) = existing_queue {
        let queue_operation = if remote_id.is_none() && queued_operation == "insert" {
            "insert"
        } else {
            desired_queue_operation
        };

        transaction
            .execute(
                r#"
        UPDATE sync_queue
        SET entity_remote_id = ?2,
            operation_type = ?3,
            payload_json = ?4,
            status = 'pending',
            attempts = 0,
            next_retry_at = NULL,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE local_id = ?1
        "#,
                params![queue_id, remote_id, queue_operation, payload],
            )
            .map_err(|error| format!("No se pudo compactar sync local del producto: {error}"))?;
    } else {
        let queue_id = Uuid::new_v4().to_string();
        transaction
            .execute(
                r#"
        INSERT INTO sync_queue (
          local_id, entity_name, entity_local_id, entity_remote_id, operation_type, payload_json, status
        ) VALUES (?1, 'products', ?2, ?3, ?4, ?5, 'pending')
        "#,
                params![
                    queue_id,
                    local_id,
                    remote_id,
                    desired_queue_operation,
                    payload
                ],
            )
            .map_err(|error| format!("No se pudo encolar sync local del producto: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar producto local: {error}"))?;

    Ok(UpsertLocalProductResult {
        product_id: local_id,
        movement_delta,
    })
}

fn is_virtual_printer_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    normalized.contains("pdf")
        || normalized.contains("xps")
        || normalized.contains("onenote")
        || normalized.contains("fax")
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn get_default_windows_printer_name() -> Result<String, String> {
    unsafe {
        let mut required_len = 0u32;
        let first_call = GetDefaultPrinterW(null_mut(), &mut required_len);

        if first_call != 0 {
            return Err(
                "Windows devolvio un resultado invalido al consultar la impresora predeterminada."
                    .to_string(),
            );
        }

        if required_len == 0 {
            return Err("No hay impresora predeterminada configurada en Windows.".to_string());
        }

        let mut buffer = vec![0u16; required_len as usize];
        let ok = GetDefaultPrinterW(buffer.as_mut_ptr(), &mut required_len);
        if ok == 0 {
            return Err(format!(
                "No se pudo leer la impresora predeterminada: {}",
                std::io::Error::last_os_error()
            ));
        }

        let actual_len = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(buffer.len());

        let printer_name = String::from_utf16(&buffer[..actual_len]).map_err(|error| {
            format!("No se pudo decodificar la impresora predeterminada: {error}")
        })?;

        if printer_name.trim().is_empty() {
            return Err("No hay impresora predeterminada configurada en Windows.".to_string());
        }

        Ok(printer_name)
    }
}

#[cfg(target_os = "windows")]
fn build_tm_u220_raw_bytes(ticket_text: &str) -> Vec<u8> {
    let normalized_text = ticket_text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n");

    let mut bytes = Vec::with_capacity(normalized_text.len() + 32);

    // Inicializa la impresora, alinea a la izquierda, usa espaciado por defecto
    // y envía texto plano RAW sin pasar por maquetación de Windows.
    bytes.extend_from_slice(&[0x1B, 0x40]); // ESC @
    bytes.extend_from_slice(&[0x1B, 0x61, 0x00]); // ESC a 0
    bytes.extend_from_slice(&[0x1B, 0x32]); // ESC 2
    bytes.extend_from_slice(normalized_text.as_bytes());
    bytes.extend_from_slice(b"\r\n");
    bytes.extend_from_slice(&[0x1B, 0x64, 0x04]); // ESC d 4

    bytes
}

#[cfg(target_os = "windows")]
fn print_raw_bytes_to_windows_printer(printer_name: &str, raw_bytes: &[u8]) -> Result<(), String> {
    if raw_bytes.is_empty() {
        return Err("No hay datos para imprimir.".to_string());
    }

    unsafe {
        let printer_name_wide = to_wide_null(printer_name);
        let doc_name_wide = to_wide_null("POS Ticket");
        let data_type_wide = to_wide_null("RAW");

        let mut printer_handle: HANDLE = null_mut();

        if OpenPrinterW(
            printer_name_wide.as_ptr() as *mut u16,
            &mut printer_handle,
            null_mut(),
        ) == 0
        {
            return Err(format!(
                "No se pudo abrir la impresora '{}': {}",
                printer_name,
                std::io::Error::last_os_error()
            ));
        }

        let doc_info = DOC_INFO_1W {
            pDocName: doc_name_wide.as_ptr() as *mut u16,
            pOutputFile: null_mut(),
            pDatatype: data_type_wide.as_ptr() as *mut u16,
        };

        let job_id = StartDocPrinterW(printer_handle, 1, &doc_info as *const _);
        if job_id == 0 {
            let message = format!(
                "No se pudo iniciar el documento RAW para '{}': {}",
                printer_name,
                std::io::Error::last_os_error()
            );
            ClosePrinter(printer_handle);
            return Err(message);
        }

        if StartPagePrinter(printer_handle) == 0 {
            let message = format!(
                "No se pudo iniciar la pagina de impresion para '{}': {}",
                printer_name,
                std::io::Error::last_os_error()
            );
            EndDocPrinter(printer_handle);
            ClosePrinter(printer_handle);
            return Err(message);
        }

        let mut bytes_written = 0u32;
        let write_ok = WritePrinter(
            printer_handle,
            raw_bytes.as_ptr() as *const c_void,
            raw_bytes.len() as u32,
            &mut bytes_written,
        );

        EndPagePrinter(printer_handle);
        EndDocPrinter(printer_handle);
        ClosePrinter(printer_handle);

        if write_ok == 0 {
            return Err(format!(
                "Fallo la impresion RAW en '{}': {}",
                printer_name,
                std::io::Error::last_os_error()
            ));
        }

        if bytes_written != raw_bytes.len() as u32 {
            return Err(format!(
                "La impresora '{}' solo acepto {bytes_written} de {} bytes.",
                printer_name,
                raw_bytes.len()
            ));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn list_local_printers() -> Result<Vec<LocalPrinterInfo>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("La lista de impresoras solo esta soportada en Windows por ahora".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference='Stop';
$printers = @(Get-CimInstance Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus | Sort-Object Name);
if ($printers.Count -eq 0) {
  '[]'
} else {
  $printers | ConvertTo-Json -Compress
}"#;

        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("No se pudo consultar impresoras de Windows: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("No se pudo leer impresoras instaladas: {detail}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let raw_value: serde_json::Value =
            serde_json::from_str(if stdout.is_empty() { "[]" } else { &stdout })
                .map_err(|error| format!("No se pudo decodificar lista de impresoras: {error}"))?;

        let raw_printers: Vec<WindowsPrinterInfo> = match raw_value {
            serde_json::Value::Array(values) => values
                .into_iter()
                .map(serde_json::from_value::<WindowsPrinterInfo>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("No se pudo convertir lista de impresoras: {error}"))?,
            value @ serde_json::Value::Object(_) => {
                vec![serde_json::from_value::<WindowsPrinterInfo>(value)
                    .map_err(|error| format!("No se pudo convertir impresora unica: {error}"))?]
            }
            serde_json::Value::Null => Vec::new(),
            _ => {
                return Err(
                    "Windows devolvio un formato inesperado al listar impresoras".to_string(),
                );
            }
        };

        let mut printers = raw_printers
            .into_iter()
            .filter(|printer| !printer.name.trim().is_empty())
            .map(|printer| LocalPrinterInfo {
                is_virtual: is_virtual_printer_name(&printer.name),
                name: printer.name,
                is_default: printer.default_printer.unwrap_or(false),
                is_offline: printer.work_offline.unwrap_or(false),
                printer_status: printer.printer_status,
            })
            .collect::<Vec<_>>();

        printers.sort_by(|left, right| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        });
        Ok(printers)
    }
}

#[tauri::command]
pub fn print_text_ticket_silent(
    ticket_text: String,
    printer_name: Option<String>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = ticket_text;
        let _ = printer_name;
        return Err("La impresion silenciosa solo esta soportada en Windows por ahora".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if ticket_text.trim().is_empty() {
            return Err("El ticket esta vacio".to_string());
        }

        let requested_printer = printer_name.unwrap_or_default().trim().to_string();

        let target_printer = if requested_printer.is_empty() {
            get_default_windows_printer_name()?
        } else {
            requested_printer
        };

        if is_virtual_printer_name(&target_printer) {
            return Err(format!(
                "La impresora seleccionada no es termica: {}. Configura la Epson TM-U220.",
                target_printer
            ));
        }

        let raw_bytes = build_tm_u220_raw_bytes(&ticket_text);
        print_raw_bytes_to_windows_printer(&target_printer, &raw_bytes)
    }
}
