'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  scripts/teardown-db.js
 *
 *  Remove e recria a database do ambiente especificado.
 *  ⚠️  DESTRÓI TODOS OS DADOS — use apenas em DEV/STAGING.
 *
 *  O que este script faz:
 *    1. Lê o ambiente (--env=dev | --env=staging)
 *    2. Pede confirmação interativa (exceto com --force)
 *    3. Encerra conexões ativas na database alvo
 *    4. Drop da database
 *    5. Chama setup-db.js para recriar tudo do zero
 *
 *  Uso:
 *    node scripts/teardown-db.js --env=dev
 *    node scripts/teardown-db.js --env=dev --force    (sem confirmação)
 *    node scripts/teardown-db.js --env=dev --no-seed  (sem dados de exemplo)
 *
 *  ⛔  PROD está bloqueado por padrão.
 *      Use --allow-prod apenas se souber o que está fazendo.
 * ═══════════════════════════════════════════════════════════════════
 */

const path     = require('path');
const fs       = require('fs');
const readline = require('readline');
const { Client }   = require('pg');
const { execSync } = require('child_process');

const { resolveEnvironment, envFilePath } = require('../config/environments');
const ENV = resolveEnvironment();

const args      = process.argv.slice(2);
const FORCE     = args.includes('--force');
const ALLOW_PROD = args.includes('--allow-prod');

// ── Constantes visuais ───────────────────────────────────────────
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

const ok   = msg => console.log(`  ${GREEN}✔${RESET}  ${msg}`);
const warn = msg => console.log(`  ${YELLOW}⚠${RESET}  ${msg}`);
const info = msg => console.log(`  ${CYAN}ℹ${RESET}  ${msg}`);
const hr   = ()  => console.log('─'.repeat(58));

// ── Carrega .env ─────────────────────────────────────────────────
const envFile = envFilePath(ENV);
if (fs.existsSync(envFile)) require('dotenv').config({ path: envFile });

const DB_HOST     = process.env.DB_HOST     || 'localhost';
const DB_PORT     = parseInt(process.env.DB_PORT || '5432');
const DB_NAME     = process.env.DB_NAME     || 'busqueaqui';
const DB_USER     = process.env.DB_USER     || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

// ════════════════════════════════════════
//  PROTEÇÃO: bloqueia PROD por padrão
// ════════════════════════════════════════
function guardProduction() {
  if (ENV.name === 'PROD' && !ALLOW_PROD) {
    console.log(`\n${RED}${BOLD}  ⛔  BLOQUEADO — teardown em PROD é proibido por padrão.${RESET}`);
    console.log(`\n  Se tiver certeza, use a flag ${BOLD}--allow-prod${RESET}:`);
    console.log(`  ${DIM}node scripts/teardown-db.js --env=prod --allow-prod --force${RESET}\n`);
    process.exit(1);
  }
}

// ════════════════════════════════════════
//  CONFIRMAÇÃO INTERATIVA
// ════════════════════════════════════════
async function confirm() {
  if (FORCE) return;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n${RED}${BOLD}  ⚠  ATENÇÃO — Operação destrutiva!${RESET}`);
  console.log(`\n  Ambiente  : ${BOLD}${ENV.name}${RESET}`);
  console.log(`  Database  : ${BOLD}${DB_NAME}${RESET} em ${DB_HOST}:${DB_PORT}`);
  console.log(`\n  ${RED}Todos os dados serão apagados permanentemente.${RESET}\n`);

  await new Promise((resolve, reject) => {
    rl.question(`  Digite ${BOLD}"${DB_NAME}"${RESET} para confirmar: `, answer => {
      rl.close();
      if (answer.trim() === DB_NAME) {
        resolve();
      } else {
        console.log(`\n  ${YELLOW}Operação cancelada.${RESET}\n`);
        process.exit(0);
      }
    });
  });
}

// ════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════
async function main() {
  const line = '═'.repeat(58);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  Busque Aqui — Teardown do Banco de Dados${RESET}`);
  console.log(`${line}\n`);

  guardProduction();
  await confirm();

  let client;
  try {
    // Conecta no postgres para poder dropar a database alvo
    client = new Client({
      host: DB_HOST, port: DB_PORT,
      database: 'postgres',
      user: DB_USER, password: DB_PASSWORD,
      connectionTimeoutMillis: 8_000,
    });
    await client.connect();
    ok(`Conectado em ${DB_HOST}:${DB_PORT}/postgres`);

    // Verifica se a database existe
    const { rows } = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
    );

    if (!rows.length) {
      warn(`Database "${DB_NAME}" não existe — nada a remover.`);
    } else {
      // Encerra todas as conexões ativas na database alvo
      info(`Encerrando conexões ativas em "${DB_NAME}"...`);
      await client.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `, [DB_NAME]);

      // Drop
      info(`Removendo database "${DB_NAME}"...`);
      await client.query(`DROP DATABASE "${DB_NAME}"`);
      ok(`Database "${DB_NAME}" removida.`);
    }

    await client.end();
    client = null;

    // Chama setup-db.js para recriar
    console.log(`\n${BOLD}  Recriando do zero via setup-db.js...${RESET}\n`);
    hr();

    const extraFlags = args
      .filter(a => a !== '--force' && a !== '--allow-prod' && !a.startsWith('--env'))
      .join(' ');

    execSync(
      `node ${path.resolve(__dirname, 'setup-db.js')} --env=${ENV.name.toLowerCase()} ${extraFlags}`,
      { stdio: 'inherit', cwd: path.resolve(__dirname, '..') }
    );

  } catch(e) {
    hr();
    console.log(`  ${RED}✖${RESET}  Teardown falhou: ${e.message}`);
    process.exit(1);
  } finally {
    if (client) try { await client.end(); } catch {}
  }
}

main();
