// Общее для стенда тестов: окружение тестовой базы и наполнение её данными макета.

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../../..')
export const E2E_PORT = 8099
export const E2E_SERVER_URL = `http://127.0.0.1:${E2E_PORT}`
/** «Сегодня» в макете: даты в данных сдвигаются так, чтобы сегодня было это число */
export const MOCK_TODAY = '2026-10-18'
export const E2E_DB = 'plexolab_e2e'
export const MANIFEST = path.join(ROOT, 'server', 'Cargo.toml')
/** Загруженные в тестах файлы лежат здесь (папка не попадает в git) и стираются вместе с данными */
export const E2E_DATA_DIR = path.join(ROOT, 'tests', 'visual', 'output', 'data')
/** Письма с кодами тестовый сервер не отправляет, а пишет файлами сюда (MAIL_OUTBOX_DIR); стирается вместе с данными */
export const E2E_OUTBOX_DIR = path.join(E2E_DATA_DIR, 'outbox')

/** Читает KEY=VALUE из .env в корне репозитория (без зависимостей) */
function readEnvFile() {
  const out = {}
  try {
    for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m) out[m[1]] = m[2]
    }
  } catch {
    // .env нет: пригодятся переменные окружения процесса
  }
  return out
}

/** Адрес администратора Postgres (для создания базы) и окружение сервера и сида для тестовой базы */
export function e2eEnv() {
  const env = { ...readEnvFile(), ...process.env }
  const base = env.E2E_DATABASE_URL ?? env.DATABASE_URL
  if (!base) throw new Error('Нужен DATABASE_URL (см. .env.example)')
  const admin = new URL(base)
  admin.pathname = '/postgres'
  const url = new URL(base)
  url.pathname = `/${E2E_DB}`
  return {
    admin: admin.toString(),
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      JWT_SECRET: env.JWT_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-32',
      BIND_ADDR: `127.0.0.1:${E2E_PORT}`,
      EXPOSE_OPENAPI: 'false',
      DATA_DIR: E2E_DATA_DIR,
      // лимит мал нарочно: тест «файл больше лимита» обходится двумя мегабайтами
      MAX_UPLOAD_MB: '1',
      // почта: письма в папку, а не в Resend. Ключ и адрес пустые нарочно: настоящий ключ из окружения или .env
      // разработчика не должен ни уйти в тесты, ни поссорить их с MAIL_OUTBOX_DIR
      MAIL_OUTBOX_DIR: E2E_OUTBOX_DIR,
      RESEND_API_KEY: '',
      MAIL_FROM: '',
      MAIL_MAX_PER_HOUR: '200',
      RUST_LOG: 'warn',
    },
  }
}

export function run(command, args, options = {}) {
  const r = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options })
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} завершилась с кодом ${r.status}`)
}

/** Стирает данные тестовой базы и заполняет её данными макета. Вызывается при запуске и перед изменяющими тестами. */
export function seedDatabase(env = e2eEnv().env) {
  rmSync(E2E_DATA_DIR, { recursive: true, force: true })
  run('cargo', ['run', '-q', '--manifest-path', MANIFEST, '--bin', 'seed', '--', '--reset', '--today', MOCK_TODAY], { env })
}
