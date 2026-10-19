//! Заполняет базу демо-данными для разработки (данные из seed() макета).
//!
//!   cargo run --bin seed                  заполнить пустую базу
//!   cargo run --bin seed -- --reset       сначала стереть ВСЕ данные в базе
//!   cargo run --bin seed -- --today 2026-10-18   считать «сегодня» этим днём (по умолчанию реальная дата)
//!   cargo run --bin seed -- --password dev       пароль демо-пользователей (по умолчанию dev)
//!
//! Только для разработки: пользователи получают простой пароль.

use anyhow::{Context, bail};
use db::seed::{SeedError, SeedOptions};
use time::{Date, format_description::well_known::Iso8601};

const USAGE: &str = "Параметры: --reset, --today ГГГГ-ММ-ДД, --password <пароль>, --help";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    let (mut reset, mut today, mut password) = (false, None, "dev".to_owned());
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--reset" => reset = true,
            "--today" => {
                let value = args.next().context("у --today нет значения")?;
                today = Some(
                    Date::parse(&value, &Iso8601::DATE)
                        .with_context(|| format!("дата «{value}», нужен вид 2026-10-18"))?,
                );
            }
            "--password" => password = args.next().context("у --password нет значения")?,
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(());
            }
            other => bail!("неизвестный параметр «{other}». {USAGE}"),
        }
    }

    let database_url = std::env::var("DATABASE_URL").context("не задана переменная окружения DATABASE_URL")?;
    let pool = db::connect(&database_url).await.context("не удалось подключиться к базе данных")?;
    db::migrate(&pool).await.context("не удалось применить миграции")?;

    if reset {
        eprintln!("Стираю все данные в базе {}", describe(&database_url));
        db::seed::reset(&pool).await.context("не удалось очистить базу")?;
    }

    let mut options = SeedOptions::now(password);
    if let Some(day) = today {
        options.today = day;
    }
    match db::seed::seed(&pool, &options).await {
        Ok(report) => {
            println!("База заполнена, «сегодня» = {}. Создано:\n{report}", options.today);
            println!(
                "Вход: lena@example.com (администратор), artem@, daniil@, sonya@, igor@example.com, пароль «{}»",
                options.password
            );
            Ok(())
        }
        Err(SeedError::NotEmpty) => bail!("{}", SeedError::NotEmpty),
        Err(e) => Err(e.into()),
    }
}

/// Адрес базы без пароля: для сообщения
fn describe(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    rest.rsplit_once('@').map_or(rest, |(_, host)| host).to_owned()
}
