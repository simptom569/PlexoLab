mod cli;

use std::io::Read;

use anyhow::{Context, bail};
use tracing_subscriber::EnvFilter;

use cli::{Command, PasswordSource, UserAdd, UserPasswd};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env нужен только при разработке, на сервере настройки приходят из окружения службы
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    match cli::parse(&args) {
        Ok(Command::Serve) => api::run(api::Config::from_env()?).await,
        Ok(Command::UserAdd(args)) => user_add(args).await,
        Ok(Command::UserPasswd(args)) => user_passwd(args).await,
        Ok(Command::Help) => {
            print!("{}", cli::USAGE);
            Ok(())
        }
        Err(message) => {
            eprintln!("Ошибка: {message}\n\n{}", cli::USAGE);
            std::process::exit(2);
        }
    }
}

/// Пароль из параметра или из стандартного ввода
fn read_password(source: PasswordSource) -> anyhow::Result<String> {
    match source {
        PasswordSource::Value(p) => Ok(p),
        PasswordSource::Stdin => {
            let mut input = String::new();
            std::io::stdin().read_to_string(&mut input).context("не удалось прочитать пароль из стандартного ввода")?;
            let password = cli::password_from_stdin(&input);
            if let Err(message) = cli::check_password(&password) {
                bail!("{message}");
            }
            Ok(password)
        }
    }
}

async fn user_passwd(args: UserPasswd) -> anyhow::Result<()> {
    let password = read_password(args.password)?;
    let database_url = std::env::var("DATABASE_URL").context("не задана переменная окружения DATABASE_URL")?;
    let pool = db::connect(&database_url).await.context("не удалось подключиться к базе данных")?;

    let password_hash = tokio::task::spawn_blocking(move || domain::auth::hash_password(&password)).await??;
    match db::users::change_password(&pool, &args.email, &password_hash).await {
        Ok(user) => {
            println!("Пароль пользователя {} изменён, его сессии завершены", user.email);
            Ok(())
        }
        Err(db::users::ChangePasswordError::NotFound) => bail!("пользователь с e-mail {} не найден", args.email),
        Err(e) => Err(e.into()),
    }
}

async fn user_add(args: UserAdd) -> anyhow::Result<()> {
    let password = read_password(args.password)?;

    let database_url = std::env::var("DATABASE_URL").context("не задана переменная окружения DATABASE_URL")?;
    let pool = db::connect(&database_url).await.context("не удалось подключиться к базе данных")?;
    // на пустой базе таблиц ещё нет
    db::migrate(&pool).await.context("не удалось применить миграции")?;

    let password_hash = tokio::task::spawn_blocking(move || domain::auth::hash_password(&password)).await??;
    let user = db::users::create(
        &pool,
        &db::users::NewUser {
            email: args.email,
            name: args.name,
            role: args.role,
            tone: args.tone,
            is_admin: args.admin,
            password_hash,
        },
    )
    .await?;
    println!(
        "Пользователь {} создан (id {}{})",
        user.email,
        user.id,
        if user.is_admin { ", администратор" } else { "" }
    );
    Ok(())
}
