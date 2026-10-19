//! Разбор командной строки. Своя маленькая реализация: команд пока две, тянуть ради них clap не нужно.

pub const USAGE: &str = "\
PlexoLab: сервер

Команды:
  server [serve]          запустить сервер (настройки из переменных окружения или файла .env)
  server user add ...     создать пользователя

Параметры `user add`:
  --email <адрес>         обязательно
  --name <имя>            обязательно, например \"Лена М.\"
  --role <роль>           подпись под именем, например Frontend
  --tone <0..4>           цвет аватара (по умолчанию 0)
  --admin                 сделать администратором
  --password <пароль>     пароль, не короче 8 символов
  --password-stdin        прочитать пароль из стандартного ввода (безопаснее, чем --password)

Пример (PowerShell):
  'секретный-пароль' | server user add --email lena@example.com --name \"Лена М.\" --role Frontend --password-stdin
";

pub const MIN_PASSWORD_LEN: usize = 8;

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Serve,
    UserAdd(UserAdd),
    Help,
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
        ["user", ..] => Err("после `user` ожидается `add`".to_owned()),
        [other, ..] => Err(format!("неизвестная команда «{other}»")),
    }
}

fn parse_user_add(args: &[&str]) -> Result<UserAdd, String> {
    let (mut email, mut name, mut role) = (None, None, String::new());
    let (mut tone, mut admin, mut password) = (0i16, false, None);

    let mut it = args.iter().copied();
    while let Some(arg) = it.next() {
        // допускаем и `--name X`, и `--name=X`
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_owned())),
            _ => (arg, None),
        };
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

    let email = email.ok_or("укажите --email")?.trim().to_lowercase();
    if !email.contains('@') || email.contains(char::is_whitespace) {
        return Err(format!("«{email}» не похож на e-mail"));
    }
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

pub fn check_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!("пароль короче {MIN_PASSWORD_LEN} символов"));
    }
    if password.len() > domain::auth::MAX_PASSWORD_LEN {
        return Err("пароль слишком длинный".to_owned());
    }
    Ok(())
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
