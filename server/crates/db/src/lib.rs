//! Доступ к PostgreSQL: пул, миграции (папка `server/migrations`), запросы sqlx.
//!
//! Запросы написаны через `sqlx::query_as` без проверки на этапе компиляции, поэтому для сборки
//! база не нужна (удобно собирать на CI и кросс-компиляцией).

use std::time::Duration;

use sqlx::postgres::PgPoolOptions;

pub use sqlx;
pub use sqlx::PgPool;

pub mod activity;
pub mod columns;
pub mod comments;
pub mod docs;
pub mod files;
pub mod folders;
pub mod invites;
pub mod links;
pub mod members;
pub mod modules;
pub mod notifications;
pub mod projects;
pub mod releases;
pub mod search;
pub mod seed;
pub mod subtasks;
pub mod tags;
pub mod tasks;
pub mod team_invites;
pub mod teams;
pub mod tokens;
pub mod users;
pub mod wiki;

/// Миграции, вшитые в бинарник
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

/// Больше соединений серверу 1 ГБ не нужно (docs/ARCHITECTURE.md)
pub const MAX_CONNECTIONS: u32 = 5;

pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}
