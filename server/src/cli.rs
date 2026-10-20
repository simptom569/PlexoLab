//! Разбор командной строки. Своя маленькая реализация: команд пока три, тянуть ради них clap не нужно.

pub const USAGE: &str = "\
PlexoLab: сервер

Команды:
  server [serve]          запустить сервер (настройки из переменных окружения или файла .env)
  server user add ...     создать пользователя
  server user passwd ...  сменить пароль пользователя (его сессии на всех устройствах завершаются)
  server openapi [--out файл]   вывести схему OpenAPI (для генерации типов клиента), сервер и база не нужны

Параметры `user add`:
  --email <адрес>         обязательно
  --name <имя>            обязательно, например \"Лена М.\"
  --role <роль>           подпись под именем, например Frontend
  --tone <0..4>           цвет аватара (по умолчанию 0)
  --admin                 сделать администратором
  --password <пароль>     пароль, не короче 8 символов
  --password-stdin        прочитать пароль из стандартного ввода (безопаснее, чем --password)

Параметры `user passwd`:
  --email <адрес>         чей пароль меняем, обязательно
  --password <пароль> или --password-stdin   новый пароль, как в `user add`

Примеры (PowerShell):
  'секретный-пароль' | server user add --email lena@example.com --name \"Лена М.\" --role Frontend --password-stdin
  'новый-пароль' | server user passwd --email lena@example.com --password-stdin
";

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Serve,
    UserAdd(UserAdd),
    UserPasswd(UserPasswd),
    /// Вывести схему OpenAPI в файл или на экран
    Openapi {
        out: Option<String>,
    },
    Help,
}

#[derive(Debug, PartialEq, Eq)]
pub struct UserPasswd {
    pub email: String,
    pub password: PasswordSource,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PasswordSource {
    Value(String),
    Stdin,
}

#[derive(Debug, PartialEq, Eq)]
pub struct UserAdd {
    pub email: String,
    pub name: String,
    pub role: String,
    pub tone: i16,
    pub admin: bool,
    pub password: PasswordSource,
}

pub fn parse(args: &[String]) -> Result<Command, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        [] | ["serve"] => Ok(Command::Serve),
        ["help" | "--help" | "-h"] => Ok(Command::Help),
        ["user", "add", rest @ ..] => parse_user_add(rest).map(Command::UserAdd),
        ["user", "passwd", rest @ ..] => parse_user_passwd(rest).map(Command::UserPasswd),
        ["openapi"] => Ok(Command::Openapi { out: None }),
        ["openapi", "--out", path] => Ok(Command::Openapi { out: Some((*path).to_owned()) }),
        ["openapi", arg] if arg.starts_with("--out=") => {
            Ok(Command::Openapi { out: Some(arg["--out=".len()..].to_owned()) })
        }
        ["openapi", ..] => Err("у `openapi` один необязательный параметр: --out <файл>".to_owned()),
        ["user", ..] => Err("после `user` ожидается `add` или `passwd`".to_owned()),
        [other, ..] => Err(format!("неизвестная команда «{other}»")),
    }
}

/// Допускаем и `--name X`, и `--name=X`
fn split_flag(arg: &str) -> (&str, Option<String>) {
    match arg.split_once('=') {
        Some((flag, value)) if flag.starts_with("--") => (flag, Some(value.to_owned())),
        _ => (arg, None),
    }
}

fn check_email(raw: &str) -> Result<String, String> {
    let email = raw.trim().to_lowercase();
    if !email.contains('@') || email.contains(char::is_whitespace) {
        return Err(format!("«{email}» не похож на e-mail"));
    }
    Ok(email)
}

fn parse_user_passwd(args: &[&str]) -> Result<UserPasswd, String> {
    let (mut email, mut password) = (None, None);
    let mut it = args.iter().copied();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        let mut value = |flag: &str| {
            inline.clone().or_else(|| it.next().map(str::to_owned)).ok_or_else(|| format!("у {flag} нет значения"))
        };
        match flag {
            "--email" => email = Some(value(flag)?),
            "--password" => password = Some(PasswordSource::Value(value(flag)?)),
            "--password-stdin" => password = Some(PasswordSource::Stdin),
            other => return Err(format!("неизвестный параметр «{other}»")),
        }
    }
    let email = check_email(&email.ok_or("укажите --email")?)?;
    let password = password.ok_or("укажите --password или --password-stdin")?;
    if let PasswordSource::Value(p) = &password {
        check_password(p)?;
    }
    Ok(UserPasswd { email, password })
}

fn parse_user_add(args: &[&str]) -> Result<UserAdd, String> {
    let (mut email, mut name, mut role) = (None, None, String::new());
    let (mut tone, mut admin, mut password) = (0i16, false, None);

    let mut it = args.iter().copied();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        let mut value = |flag: &str| {
            inline.clone().or_else(|| it.next().map(str::to_owned)).ok_or_else(|| format!("у {flag} нет значения"))
        };
        match flag {
            "--email" => email = Some(value(flag)?),
            "--name" => name = Some(value(flag)?),
            "--role" => role = value(flag)?,
            "--tone" => {
                let v = value(flag)?;
                tone = v.parse().ok().filter(|t| (0..=4).contains(t)).ok_or("--tone: число от 0 до 4")?;
            }
            "--password" => password = Some(PasswordSource::Value(value(flag)?)),
            "--password-stdin" => password = Some(PasswordSource::Stdin),
            "--admin" => admin = true,
            other => return Err(format!("неизвестный параметр «{other}»")),
        }
    }

    let email = check_email(&email.ok_or("укажите --email")?)?;
    let name = name.ok_or("укажите --name")?.trim().to_owned();
    if name.is_empty() {
        return Err("--name не может быть пустым".to_owned());
    }
    let password = password.ok_or("укажите --password или --password-stdin")?;
    if let PasswordSource::Value(p) = &password {
        check_password(p)?;
    }
    Ok(UserAdd { email, name, role: role.trim().to_owned(), tone, admin, password })
}

/// Пароль из стандартного ввода: без маркера UTF-8 в начале и без перевода строки в конце.
/// Windows PowerShell 5.1 при передаче через пайп добавляет в начало невидимый маркер (EF BB BF),
/// и без этой очистки пароль сохранился бы с лишним невидимым символом.
pub fn password_from_stdin(raw: &str) -> String {
    raw.trim_start_matches('\u{feff}').trim_end_matches(['\r', '\n']).to_owned()
}

/// Те же правила, что у смены пароля в приложении
pub fn check_password(password: &str) -> Result<(), String> {
    domain::auth::check_new_password(password)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> Result<Command, String> {
        parse(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn no_arguments_starts_the_server() {
        assert_eq!(p(&[]), Ok(Command::Serve));
        assert_eq!(p(&["serve"]), Ok(Command::Serve));
        assert_eq!(p(&["--help"]), Ok(Command::Help));
    }

    #[test]
    fn unknown_commands_are_errors() {
        assert!(p(&["dance"]).is_err());
        assert!(p(&["user"]).is_err());
        assert!(p(&["user", "remove"]).is_err());
    }

    #[test]
    fn stdin_password_loses_the_bom_and_the_line_break_only() {
        assert_eq!(password_from_stdin("секрет-123"), "секрет-123");
        assert_eq!(password_from_stdin("secret\r\n"), "secret");
        assert_eq!(password_from_stdin("secret\n"), "secret");
        assert_eq!(password_from_stdin("\u{feff}secret\r\n"), "secret", "так приходит из PowerShell 5.1");
        assert_eq!(password_from_stdin("\u{feff}\u{feff}secret"), "secret");
        assert_eq!(password_from_stdin(" secret with spaces "), " secret with spaces ", "пробелы — часть пароля");
        assert_eq!(password_from_stdin("\r\n"), "");
    }

    #[test]
    fn openapi_command_takes_an_optional_output_file() {
        assert_eq!(p(&["openapi"]), Ok(Command::Openapi { out: None }));
        assert_eq!(p(&["openapi", "--out", "a/b.json"]), Ok(Command::Openapi { out: Some("a/b.json".into()) }));
        assert_eq!(p(&["openapi", "--out=a/b.json"]), Ok(Command::Openapi { out: Some("a/b.json".into()) }));
        assert!(p(&["openapi", "--out"]).is_err());
        assert!(p(&["openapi", "file.json"]).is_err());
        assert!(p(&["openapi", "--out", "a", "b"]).is_err());
    }

    #[test]
    fn user_passwd_reads_email_and_password() {
        assert_eq!(
            p(&["user", "passwd", "--email", " Lena@Example.com ", "--password", "long-enough-pass"]),
            Ok(Command::UserPasswd(UserPasswd {
                email: "lena@example.com".into(),
                password: PasswordSource::Value("long-enough-pass".into()),
            }))
        );
        assert_eq!(
            p(&["user", "passwd", "--email=a@b.c", "--password-stdin"]),
            Ok(Command::UserPasswd(UserPasswd { email: "a@b.c".into(), password: PasswordSource::Stdin }))
        );
    }

    #[test]
    fn user_passwd_validates_input() {
        let ok = ["user", "passwd", "--email", "a@b.c", "--password", "long-enough-pass"];
        assert!(p(&ok).is_ok());
        assert!(p(&["user", "passwd", "--password", "long-enough-pass"]).is_err(), "без --email");
        assert!(p(&["user", "passwd", "--email", "a@b.c"]).is_err(), "без пароля");
        assert!(p(&["user", "passwd", "--email", "a@b.c", "--password", "short"]).is_err(), "короткий пароль");
        assert!(p(&["user", "passwd", "--email", "no-at", "--password", "long-enough-pass"]).is_err());
        assert!(p(&["user", "passwd", "--email", "a@b.c", "--password"]).is_err(), "у --password нет значения");
        assert!(p(&["user", "passwd", "--email", "a@b.c", "--password-stdin", "--admin"]).is_err(), "лишний параметр");
        assert!(p(&["user", "passwd", "--email", "a@b.c", "--name", "X", "--password-stdin"]).is_err());
    }

    #[test]
    fn user_add_reads_all_options() {
        let c = p(&[
            "user",
            "add",
            "--email",
            " Lena@Example.com ",
            "--name",
            "Лена М.",
            "--role",
            "Frontend",
            "--tone",
            "3",
            "--admin",
            "--password",
            "long-enough-pass",
        ])
        .unwrap();
        assert_eq!(
            c,
            Command::UserAdd(UserAdd {
                email: "lena@example.com".into(),
                name: "Лена М.".into(),
                role: "Frontend".into(),
                tone: 3,
                admin: true,
                password: PasswordSource::Value("long-enough-pass".into()),
            })
        );
    }

    #[test]
    fn user_add_supports_equals_form_and_stdin_password() {
        let Command::UserAdd(u) = p(&["user", "add", "--email=a@b.c", "--name=Имя", "--password-stdin"]).unwrap()
        else {
            panic!("ожидалась команда user add")
        };
        assert_eq!(u.email, "a@b.c");
        assert_eq!(u.name, "Имя");
        assert_eq!((u.role.as_str(), u.tone, u.admin), ("", 0, false), "значения по умолчанию");
        assert_eq!(u.password, PasswordSource::Stdin);
    }

    #[test]
    fn user_add_validates_input() {
        let base = ["user", "add", "--email", "a@b.c", "--name", "N", "--password", "long-enough-pass"];
        assert!(p(&base).is_ok());
        let without = |skip: &str| -> Vec<&str> {
            let mut v = base.to_vec();
            let i = v.iter().position(|x| *x == skip).unwrap();
            v.drain(i..i + 2);
            v
        };
        for flag in ["--email", "--name", "--password"] {
            assert!(p(&without(flag)).is_err(), "без {flag}");
        }
        fn with<'a>(base: &[&'a str], extra: &[&'a str]) -> Vec<&'a str> {
            [base, extra].concat()
        }
        assert!(p(&with(&base, &["--tone", "5"])).is_err());
        assert!(p(&with(&base, &["--tone", "x"])).is_err());
        assert!(p(&with(&base, &["--role"])).is_err(), "у --role нет значения");
        assert!(p(&with(&base, &["--bogus"])).is_err());
        assert!(p(&["user", "add", "--email", "no-at", "--name", "N", "--password", "long-enough-pass"]).is_err());
        assert!(p(&["user", "add", "--email", "a@b.c", "--name", "  ", "--password", "long-enough-pass"]).is_err());
        assert!(p(&["user", "add", "--email", "a@b.c", "--name", "N", "--password", "short"]).is_err());
    }
}
