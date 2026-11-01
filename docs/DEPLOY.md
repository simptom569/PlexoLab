# Развёртывание сервера

Как поставить серверную часть PlexoLab на свой Linux-сервер. Расчёт на один сервер, который ставят один раз и потом иногда обновляют. Команды для Debian и Ubuntu; на другой системе шаги те же, отличаются пакеты и менеджер пакетов.

## Что получится

- Сервер PlexoLab (один файл) слушает http-порт, по умолчанию 8080.
- PostgreSQL на том же сервере хранит данные.
- Загруженные файлы (вики, вложения задач) лежат в `/var/lib/plexolab`.
- Служба systemd запускает сервер при включении машины и перезапускает его при падении.
- Приложение на Windows подключается по адресу `http://адрес-сервера:8080`.

HTTPS сам сервер не делает. Если нужен, перед ним ставят прокси с сертификатом: [раздел «HTTPS»](#https).

## Что нужно

- Linux x86_64 с systemd. Бинарник собирается на Ubuntu 24.04 и запускается на Debian 13, Ubuntu 24.04 и новее. На более старых системах может не подойти версия glibc.
- Права root. Все команды ниже выполняются от root.
- PostgreSQL 13 или новее. Автотесты идут на PostgreSQL 18.
- Около 300 МБ оперативной памяти на сервер вместе с базой. Для маленького сервера (1 ГБ) настройки Postgres подобраны в [ARCHITECTURE.md](ARCHITECTURE.md), «Развёртывание на сервере 1 ядро / 1 ГБ».
- Доступ в интернет к github.com (оттуда скачивается бинарник).
- Открытый входящий TCP-порт (по умолчанию 8080) и в файрволе сервера, и в панели хостинга, если она есть.

Номер версии берут со страницы [релизов](https://github.com/simptom569/PlexoLab/releases). Дальше команды используют переменную `VERSION`; все блоки выполняйте в одном окне терминала, переменные из первых блоков нужны в следующих.

```
VERSION=v1.0.0
```

## 1. PostgreSQL

Установка (если Postgres уже стоит, пропустите):

```
apt-get update
apt-get install -y postgresql curl ca-certificates
```

Пароль базы и секрет входа. Они запишутся в `.env` в разделе 3 и нигде больше не хранятся:

```
DBPASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
JWT=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
```

Роль и база. База создаётся в локали `C.UTF-8`: она различает регистр русских букв, а обычная локаль `C` нет (поиск «планирование» не нашёл бы «Планирование»):

```
cd /tmp
runuser -u postgres -- psql -c "create role plexolab login password '$DBPASS'"
runuser -u postgres -- psql -c "create database plexolab owner plexolab template template0 encoding 'UTF8' locale 'C.UTF-8'"
runuser -u postgres -- psql -d plexolab -Atc "select lower('ЁЖИК Я') = 'ёжик я'"
```

Последняя команда должна напечатать `t`. Если напечатала `f` или `create database` отказалась от локали, база на этой системе не различает регистр русских букв. Тогда пересоздайте её с готовой русской локалью (база пока пустая, терять нечего):

```
apt-get install -y locales
sed -i 's/^# *ru_RU.UTF-8/ru_RU.UTF-8/' /etc/locale.gen && locale-gen
runuser -u postgres -- psql -c "drop database if exists plexolab"
runuser -u postgres -- psql -c "create database plexolab owner plexolab template template0 encoding 'UTF8' locale 'ru_RU.UTF-8'"
runuser -u postgres -- psql -d plexolab -Atc "select lower('ЁЖИК Я') = 'ёжик я'"
```

Сервер сам проверяет это при запуске и пишет в журнал предупреждение, если регистр не различается.

## 2. Пользователь и папки

Сервер работает от отдельного пользователя без входа в систему и без прав root:

```
useradd --system --user-group --home-dir /var/lib/plexolab --shell /usr/sbin/nologin plexolab
mkdir -p /opt/plexolab /var/lib/plexolab
chown plexolab:plexolab /var/lib/plexolab
```

## 3. Сервер и настройки

Бинарник берётся со страницы релиза, настройки из `.env.example` в корне репозитория той же версии:

```
curl -fL -o /opt/plexolab/plexolab-server https://github.com/simptom569/PlexoLab/releases/download/$VERSION/plexolab-server-linux-x86_64
chmod +x /opt/plexolab/plexolab-server
/opt/plexolab/plexolab-server help | head -3
curl -fL -o /opt/plexolab/.env https://raw.githubusercontent.com/simptom569/PlexoLab/$VERSION/.env.example
```

Команда `help` должна напечатать «PlexoLab: сервер» и список команд: значит, файл запускается.

Дальше в `.env` меняются пять строк:

```
cd /opt/plexolab
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://plexolab:$DBPASS@127.0.0.1:5432/plexolab|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
sed -i "s|^BIND_ADDR=.*|BIND_ADDR=0.0.0.0:8080|" .env
sed -i "s|^DATA_DIR=.*|DATA_DIR=/var/lib/plexolab|" .env
sed -i "s|^EXPOSE_OPENAPI=.*|EXPOSE_OPENAPI=false|" .env
chown root:plexolab .env
chmod 640 .env
```

| Строка | Зачем |
|---|---|
| `DATABASE_URL` | подключение к базе из раздела 1 |
| `JWT_SECRET` | секрет подписи токенов входа, не короче 32 символов; если его сменить, все выйдут из аккаунтов |
| `BIND_ADDR` | `0.0.0.0:8080`: слушать все адреса на порту 8080. За своим прокси ставят `127.0.0.1:8080` |
| `DATA_DIR` | папка загруженных файлов; её же нужно включать в резервную копию |
| `EXPOSE_OPENAPI` | схема API в боевом режиме выключена |

Остальные строки (`MAX_UPLOAD_MB`, `MAX_TEAMS_PER_USER`, почта) описаны комментариями в самом файле. `CORS_ORIGINS` не трогайте: по умолчанию подходят адреса приложения.

`.env` теперь единственное место, где лежат пароль базы и секрет входа. Скопируйте файл в безопасное место: восстановить эти значения неоткуда.

## 4. Служба

```
cat > /etc/systemd/system/plexolab.service <<'EOF'
[Unit]
Description=PlexoLab server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=plexolab
Group=plexolab
WorkingDirectory=/opt/plexolab
ExecStart=/opt/plexolab/plexolab-server serve
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/plexolab

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now plexolab
sleep 3
systemctl status plexolab --no-pager
curl -s http://127.0.0.1:8080/healthz
```

В статусе должно быть `active (running)`, а `curl` напечатать `ok`. Сервер находит `.env` в рабочей папке службы (`/opt/plexolab`), миграции базы применяет сам при запуске.

На маленьком сервере в секцию `[Service]` можно добавить потолок памяти, например `MemoryMax=200M`: при превышении перезапустится только эта служба, а не чужие.

## 5. Первый пользователь

```
cd /opt/plexolab
read -rs -p 'Пароль (не короче 8 символов): ' P; echo
printf '%s' "$P" | ./plexolab-server user add --email ваша@почта --name "Ваше имя" --role Владелец --admin --password-stdin
```

Команду выполняйте из `/opt/plexolab`: настройки (адрес базы) она читает из `.env` в текущей папке. Остальных пользователей заводят так же, без `--admin`. Сменить пароль: `./plexolab-server user passwd --email ... --password-stdin`. Демо-данные (`seed`) на боевой сервер не заливают: он начинает пустым.

## 6. Проверка

С другого компьютера:

```
curl -m 5 http://адрес-сервера:8080/healthz
```

Ответ `ok`: сервер доступен снаружи. В PowerShell на Windows пишите `curl.exe`, а не `curl`.

Если на самом сервере (раздел 4) ответ есть, а снаружи нет или долгая пауза, закрыт порт. Откройте входящий TCP-порт 8080 в панели хостинга (файрвол, группы безопасности) и, если на сервере включён `ufw`, выполните `ufw allow 8080/tcp`.

## 7. Подключение приложения

При первом запуске приложение спрашивает адрес сервера. Введите его вместе со схемой: `http://адрес-сервера:8080` (без схемы приложение сначала попробует https). Дальше e-mail и пароль пользователя из раздела 5.

## 8. Почта

Без почты не работают регистрация в приложении и «Забыли пароль?»: пользователей заводят командой из раздела 5. Чтобы включить письма с кодами, откройте `/opt/plexolab/.env`, впишите `RESEND_API_KEY` и `MAIL_FROM` (значение с пробелом и «<» берётся в двойные кавычки), затем:

```
systemctl restart plexolab
journalctl -u plexolab -n 20 --no-pager
```

В журнале должна быть строка про отправку писем через Resend. Домен отправителя нужно подтвердить в Resend, иначе письма доходят только владельцу аккаунта Resend. Подробности: [REGISTRATION.md](REGISTRATION.md).

Внимание: при включённой почте зарегистрироваться может любой, кто знает адрес сервера. Общего потолка на объём файлов с человека нет (только `MAX_UPLOAD_MB` на один файл).

## HTTPS

Сервер говорит только по http. По http пароли и токены идут по сети открытым текстом, поэтому в интернете этого достаточно разве что внутри VPN или другой доверенной сети. Для HTTPS нужен домен, указывающий на сервер, и прокси перед PlexoLab. Например, Caddy сам получает и продлевает сертификат; весь `Caddyfile`:

```
plexo.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

В `.env` ставят `BIND_ADDR=127.0.0.1:8080` (наружу порт 8080 больше не нужен) и перезапускают службу. Приложению тогда дают адрес `https://plexo.example.com`. WebSocket (живые обновления) прокси пропускает без особых настроек.

## Резервные копии

Копировать нужно две вещи: базу и папку `/var/lib/plexolab`. Ночная копия, 14 дней хранения:

```
apt-get install -y cron
cat > /etc/cron.d/plexolab-backup <<'EOF'
30 3 * * * root umask 077; mkdir -p /var/backups/plexolab; cd /tmp; runuser -u postgres -- pg_dump -Fc plexolab > /var/backups/plexolab/db-$(date +\%F).dump && tar -C /var/lib/plexolab -czf /var/backups/plexolab/files-$(date +\%F).tar.gz . && find /var/backups/plexolab -type f -mtime +14 -delete
EOF
```

Сразу проверьте базу руками и убедитесь, что копия восстанавливается. Копия, которую ни разу не восстанавливали, не считается копией:

```
umask 077; mkdir -p /var/backups/plexolab; cd /tmp
runuser -u postgres -- pg_dump -Fc plexolab > /var/backups/plexolab/db-test.dump
runuser -u postgres -- createdb restore_test
runuser -u postgres -- pg_restore --no-owner -d restore_test < /var/backups/plexolab/db-test.dump
runuser -u postgres -- psql -d restore_test -Atc "select count(*) from users"
runuser -u postgres -- psql -d plexolab -Atc "select count(*) from users"
runuser -u postgres -- dropdb restore_test
```

Два числа должны совпасть. Боевая база не затрагивается. Копии на том же диске не защищают от поломки диска, поэтому изредка забирайте их на другой компьютер (`scp -r root@адрес-сервера:/var/backups/plexolab .`).

**Восстановление при потере базы:** остановить службу (`systemctl stop plexolab`), пересоздать пустую базу как в разделе 1, затем `runuser -u postgres -- pg_restore --no-owner --role=plexolab -d plexolab < файл.dump`, распаковать `files-*.tar.gz` в `/var/lib/plexolab` (владелец `plexolab`), запустить службу.

## Обновление и откат

Миграции базы применяются сами при запуске и назад не откатываются: бинарник вернуть можно, данные нет. Поэтому перед обновлением делают копию базы. Подставьте номер новой версии:

```
VERSION=v1.1.0
umask 077; mkdir -p /var/backups/plexolab; cd /tmp
runuser -u postgres -- pg_dump -Fc plexolab > /var/backups/plexolab/db-before-update.dump
cd /opt/plexolab
curl -fL -o plexolab-server.new https://github.com/simptom569/PlexoLab/releases/download/$VERSION/plexolab-server-linux-x86_64
chmod +x plexolab-server.new
mv plexolab-server plexolab-server.prev
mv plexolab-server.new plexolab-server
systemctl restart plexolab
sleep 3
curl -s http://127.0.0.1:8080/healthz
```

Ответ `ok`: готово. Если сервер не ответил, вернуть прежний бинарник:

```
mv /opt/plexolab/plexolab-server.prev /opt/plexolab/plexolab-server
systemctl restart plexolab
```

Новые строки в настройках, если они появились, перечислены в `.env.example` новой версии. Старый `.env` продолжает работать: добавлять нужно только то, что вам нужно.

Приложения на Windows обновляются сами при выходе релиза. API сервера обратно совместим: новый сервер работает с прежним приложением, а новое приложение не требует от сервера того, чего в нём ещё нет, поэтому порядок «сначала сервер или сначала приложение» не важен.

## Если что-то не работает

Журнал: `journalctl -u plexolab -n 50 --no-pager`. Частые причины:

| Что видно | Причина |
|---|---|
| `не задана переменная окружения DATABASE_URL` | служба не нашла `.env`: проверьте `WorkingDirectory=/opt/plexolab` и что файл лежит там |
| `JWT_SECRET короче ...` | секрет в `.env` слишком короткий или не подставился в разделе 3 |
| `не удалось подключиться к базе данных` | неверный пароль в `DATABASE_URL` или Postgres не запущен: `systemctl status postgresql` |
| `Address already in use` | порт занят другим сервисом: `ss -tlnp`, затем другой порт в `BIND_ADDR` |
| `ok` на сервере, но снаружи тишина | закрыт порт в файрволе или в панели хостинга (раздел 6) |
| «локаль базы не различает регистр русских букв» | база создана в обычной локали `C`: пересоздайте её по разделу 1 |
