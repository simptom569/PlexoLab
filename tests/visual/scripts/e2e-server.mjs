// Поднимает сервер для визуальных и поведенческих тестов: отдельная база plexolab_e2e с данными макета
// и сервер на 127.0.0.1:8099. Запускается Playwright как webServer (playwright.config.ts).

import { spawn } from 'node:child_process'
import { e2eEnv, E2E_DB, MANIFEST, ROOT, run, seedDatabase } from './e2e-env.mjs'

const { admin, env } = e2eEnv()

// база создаётся заново: так в ней точно только данные сида
run('psql', [admin, '-v', 'ON_ERROR_STOP=1', '-c', `drop database if exists ${E2E_DB} with (force)`, '-c', `create database ${E2E_DB}`])
seedDatabase(env)

const server = spawn('cargo', ['run', '-q', '--manifest-path', MANIFEST], { stdio: 'inherit', cwd: ROOT, env })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill())
server.on('exit', (code) => process.exit(code ?? 0))
