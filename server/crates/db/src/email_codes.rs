//! Коды из писем (регистрация, сброс пароля). В базе только хэш кода. Для одного адреса и одного назначения действует
//! самый новый код. По тем же строкам считаются лимиты на письма.

use domain::codes::{MAX_CODE_ATTEMPTS, Purpose};
use sqlx::{PgConnection, PgPool};
use time::Duration;
use uuid::Uuid;

/// Что вышло с просьбой о новом коде
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Issue {
    /// Код заведён; письмо ещё надо отправить, а при неудаче вернуть строку (`remove`)
    Issued(Uuid),
    /// На этот адрес письмо уходило меньше минуты назад
    TooSoon,
    /// Сервер уже отправил за последний час столько писем, сколько разрешено
    TooMany,
}

/// Что вышло с проверкой введённого кода
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Check {
    /// Код верный. Строка осталась: её убирает `consume` вместе с действием, ради которого код нужен.
    Match,
    /// Код неверный; `left` — сколько попыток осталось (0: код сгорел, нужен новый)
    Wrong { left: i16 },
    /// Кода нет: не запрашивали, истёк, сгорел или уже использован
    Gone,
}

/// Заводит новый код для адреса, если лимиты позволяют. Всё в одной транзакции под замком на (назначение, адрес):
/// два одновременных запроса не пройдут проверку «не чаще раза в минуту» оба.
pub async fn issue(
    pool: &PgPool,
    purpose: Purpose,
    email: &str,
    code_hash: &str,
    ttl: Duration,
    cooldown: Duration,
    max_per_hour: u32,
) -> Result<Issue, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("select pg_advisory_xact_lock(hashtext($1))")
        .bind(format!("email_codes:{}:{email}", purpose.as_str()))
        .execute(&mut *tx)
        .await?;
    sqlx::query("delete from email_codes where created_at < now() - interval '2 hours'").execute(&mut *tx).await?;

    let too_soon: bool = sqlx::query_scalar(
        "select exists (select 1 from email_codes where purpose = $1 and email = $2 \
                        and created_at > now() - make_interval(secs => $3))",
    )
    .bind(purpose.as_str())
    .bind(email)
    .bind(cooldown.as_seconds_f64())
    .fetch_one(&mut *tx)
    .await?;
    if too_soon {
        return Ok(Issue::TooSoon);
    }
    let last_hour: i64 =
        sqlx::query_scalar("select count(*) from email_codes where created_at > now() - interval '1 hour'")
            .fetch_one(&mut *tx)
            .await?;
    if last_hour >= i64::from(max_per_hour) {
        return Ok(Issue::TooMany);
    }

    let id: Uuid = sqlx::query_scalar(
        "insert into email_codes (purpose, email, code_hash, expires_at) \
         values ($1, $2, $3, now() + make_interval(secs => $4)) returning id",
    )
    .bind(purpose.as_str())
    .bind(email)
    .bind(code_hash)
    .bind(ttl.as_seconds_f64())
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Issue::Issued(id))
}

/// Убирает только что заведённый код, если письмо отправить не удалось: иначе человек ждал бы минуту до новой попытки
pub async fn remove(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from email_codes where id = $1").bind(id).execute(pool).await?;
    Ok(())
}

/// Проверяет код против самого нового действующего для адреса. Ошибка засчитывается (`attempts + 1`), на последней
/// попытке строка удаляется. Вызывающий обязан сделать `commit` и после `Wrong`: иначе счётчик попыток не сохранится.
/// Строка блокируется до конца транзакции: два одновременных запроса с верным кодом не пройдут оба.
pub async fn check(
    conn: &mut PgConnection,
    purpose: Purpose,
    email: &str,
    code_hash: &str,
) -> Result<Check, sqlx::Error> {
    let row: Option<(Uuid, String, i16)> = sqlx::query_as(
        "select id, code_hash, attempts from email_codes \
         where purpose = $1 and email = $2 and expires_at > now() \
         order by created_at desc, id limit 1 for update",
    )
    .bind(purpose.as_str())
    .bind(email)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((id, stored, attempts)) = row else { return Ok(Check::Gone) };

    if attempts >= MAX_CODE_ATTEMPTS {
        sqlx::query("delete from email_codes where id = $1").bind(id).execute(&mut *conn).await?;
        return Ok(Check::Gone);
    }
    if stored == code_hash {
        return Ok(Check::Match);
    }
    let attempts = attempts + 1;
    if attempts >= MAX_CODE_ATTEMPTS {
        sqlx::query("delete from email_codes where id = $1").bind(id).execute(&mut *conn).await?;
    } else {
        sqlx::query("update email_codes set attempts = $2 where id = $1").bind(id).bind(attempts).execute(&mut *conn).await?;
    }
    Ok(Check::Wrong { left: MAX_CODE_ATTEMPTS - attempts })
}

/// Код использован: убирает все коды этого назначения для адреса, в том числе прежние (они уже не должны подходить)
pub async fn consume(conn: &mut PgConnection, purpose: Purpose, email: &str) -> Result<(), sqlx::Error> {
    sqlx::query("delete from email_codes where purpose = $1 and email = $2")
        .bind(purpose.as_str())
        .bind(email)
        .execute(conn)
        .await?;
    Ok(())
}
