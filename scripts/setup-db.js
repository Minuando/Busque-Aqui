'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  scripts/setup-db.js
 *
 *  Automação completa de criação e configuração do banco de dados.
 *
 *  O que este script faz (em ordem):
 *    1. Lê o ambiente (--env=dev | --env=prod | --env=staging ...)
 *    2. Carrega as variáveis do .env correspondente
 *    3. Conecta ao PostgreSQL no banco padrão "postgres"
 *    4. Verifica se a database de destino existe
 *    5. Cria a database se necessário (com encoding UTF-8)
 *    6. Reconecta na database de destino
 *    7. Aplica schema.sql  (tabelas, índices, triggers, views, seed)
 *    8. Cria o admin padrão com senha em hash bcrypt
 *    9. Exibe um relatório final do que foi criado
 *
 *  Uso:
 *    node scripts/setup-db.js --env=dev
 *    node scripts/setup-db.js --env=prod
 *    node scripts/setup-db.js --env=prod --no-seed   (pula dados de exemplo)
 *    node scripts/setup-db.js --env=dev  --no-admin  (pula criação do admin)
 *    node scripts/setup-db.js --env=dev  --verbose   (SQL no console)
 *
 *  O script é IDEMPOTENTE:
 *    pode ser executado várias vezes sem criar duplicatas ou erros.
 * ═══════════════════════════════════════════════════════════════════
 */

const path   = require('path');
const fs     = require('fs');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// ── Resolve ambiente ─────────────────────────────────────────────
const { resolveEnvironment, envFilePath } = require('../config/environments');
const ENV = resolveEnvironment();

// Flags opcionais
const args     = process.argv.slice(2);
const NO_SEED  = args.includes('--no-seed');
const NO_ADMIN = args.includes('--no-admin');
const VERBOSE  = args.includes('--verbose');

// ── Carrega .env do ambiente ─────────────────────────────────────
const envFile = envFilePath(ENV);
if (fs.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
} else {
  console.warn(`[setup] Arquivo ${ENV.envFile} não encontrado — usando variáveis do processo.`);
}

// ── Configurações ────────────────────────────────────────────────
const DB_HOST     = process.env.DB_HOST     || 'localhost';
const DB_PORT     = parseInt(process.env.DB_PORT || '5432');
const DB_NAME     = process.env.DB_NAME     || 'busqueaqui';
const DB_USER     = process.env.DB_USER     || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'admin123';

const SCHEMA_FILE = path.resolve(__dirname, '../schema.sql');

// ════════════════════════════════════════
//  UTILITÁRIOS
// ════════════════════════════════════════

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';

const ok   = msg => console.log(`  ${GREEN}✔${RESET}  ${msg}`);
const warn = msg => console.log(`  ${YELLOW}⚠${RESET}  ${msg}`);
const info = msg => console.log(`  ${CYAN}ℹ${RESET}  ${msg}`);
const err  = msg => console.log(`  ${RED}✖${RESET}  ${msg}`);
const dim  = msg => console.log(`${DIM}     ${msg}${RESET}`);
const hr   = ()  => console.log(`${'─'.repeat(58)}`);

// ════════════════════════════════════════
//  PASSO 1 — BANNER
// ════════════════════════════════════════
function printBanner() {
  const line = '═'.repeat(58);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  Busque Aqui — Setup do Banco de Dados${RESET}`);
  console.log(`${line}`);
  console.log(`  Ambiente  : ${BOLD}${ENV.name}${RESET}`);
  console.log(`  Host      : ${DB_HOST}:${DB_PORT}`);
  console.log(`  Database  : ${BOLD}${DB_NAME}${RESET}`);
  console.log(`  Usuário   : ${DB_USER}`);
  console.log(`  Schema    : ${path.relative(process.cwd(), SCHEMA_FILE)}`);
  console.log(`  Seed      : ${NO_SEED  ? RED+'desativado'+RESET : GREEN+'ativado'+RESET}`);
  console.log(`  Admin     : ${NO_ADMIN ? RED+'desativado'+RESET : GREEN+'ativado'+RESET}`);
  console.log(`${line}\n`);
}

// ════════════════════════════════════════
//  PASSO 2 — CONECTA NO BANCO "postgres" (admin)
//  Necessário para CREATE DATABASE
// ════════════════════════════════════════
async function connectAdmin() {
  const client = new Client({
    host: DB_HOST, port: DB_PORT,
    database: 'postgres',           // banco padrão sempre existente
    user: DB_USER, password: DB_PASSWORD,
    connectionTimeoutMillis: 8_000,
  });
  await client.connect();
  return client;
}

// ════════════════════════════════════════
//  PASSO 3 — CONECTA NA DATABASE DE DESTINO
// ════════════════════════════════════════
async function connectTarget() {
  const client = new Client({
    host: DB_HOST, port: DB_PORT,
    database: DB_NAME,
    user: DB_USER, password: DB_PASSWORD,
    connectionTimeoutMillis: 8_000,
  });
  await client.connect();
  return client;
}

// ════════════════════════════════════════
//  PASSO 4 — CRIA DATABASE SE NÃO EXISTIR
// ════════════════════════════════════════
async function ensureDatabase(adminClient) {
  console.log(`\n${BOLD}[ 1/4 ] Verificando database${RESET}`);
  hr();

  const { rows } = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
  );

  if (rows.length > 0) {
    ok(`Database "${DB_NAME}" já existe — pulando criação.`);
    return;
  }

  info(`Database "${DB_NAME}" não encontrada — criando...`);

  // Cria com encoding UTF-8 e locale pt_BR quando disponível
  try {
    await adminClient.query(
      `CREATE DATABASE "${DB_NAME}"
         ENCODING 'UTF8'
         LC_COLLATE 'pt_BR.UTF-8'
         LC_CTYPE   'pt_BR.UTF-8'
         TEMPLATE template0`
    );
  } catch {
    // Locale pt_BR pode não estar disponível em todos os sistemas
    warn('Locale pt_BR.UTF-8 não disponível — usando padrão do sistema.');
    await adminClient.query(`CREATE DATABASE "${DB_NAME}" ENCODING 'UTF8'`);
  }

  ok(`Database "${DB_NAME}" criada com sucesso (UTF-8).`);
}

// ════════════════════════════════════════
//  PASSO 5 — APLICA schema.sql
// ════════════════════════════════════════
async function applySchema(client) {
  console.log(`\n${BOLD}[ 2/4 ] Aplicando schema.sql${RESET}`);
  hr();

  if (!fs.existsSync(SCHEMA_FILE)) {
    throw new Error(`Arquivo schema.sql não encontrado em: ${SCHEMA_FILE}`);
  }

  let sql = fs.readFileSync(SCHEMA_FILE, 'utf8');

  // Se --no-seed, remove o bloco de INSERT (BLOCO 4)
  if (NO_SEED) {
    const seedStart = sql.indexOf('-- ─────────────────────────\n--  BLOCO 4');
    const seedEnd   = sql.indexOf('ON CONFLICT DO NOTHING;');
    if (seedStart !== -1 && seedEnd !== -1) {
      sql = sql.slice(0, seedStart) + sql.slice(seedEnd + 'ON CONFLICT DO NOTHING;'.length);
      warn('Flag --no-seed: bloco de dados de exemplo removido.');
    }
  }

  if (VERBOSE) {
    dim('SQL a executar:');
    console.log(DIM + sql.slice(0, 500) + '...' + RESET);
  }

  // Executa todo o schema em uma única transação
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    ok('schema.sql aplicado com sucesso.');
  } catch(e) {
    await client.query('ROLLBACK');
    throw new Error(`Erro ao aplicar schema.sql: ${e.message}`);
  }
}

// ════════════════════════════════════════
//  PASSO 6 — CRIA ADMIN PADRÃO
// ════════════════════════════════════════
async function ensureAdmin(client) {
  console.log(`\n${BOLD}[ 3/4 ] Configurando administrador padrão${RESET}`);
  hr();

  if (NO_ADMIN) {
    warn('Flag --no-admin: criação do admin pulada.');
    return;
  }

  const { rows } = await client.query(
    'SELECT id FROM admins WHERE username = $1', [ADMIN_USER]
  );

  if (rows.length > 0) {
    ok(`Admin "${ADMIN_USER}" já existe — sem alteração.`);
    return;
  }

  info(`Criando admin "${ADMIN_USER}"...`);
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  const { rows: created } = await client.query(
    'INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
    [ADMIN_USER, hash]
  );
  ok(`Admin "${created[0].username}" criado (id=${created[0].id}).`);
  warn(`Senha: ${BOLD}${ADMIN_PASS}${RESET} — altere via painel ou PATCH /api/admins/:id/password`);
}

// ════════════════════════════════════════
//  PASSO 7 — RELATÓRIO FINAL
// ════════════════════════════════════════
async function printReport(client) {
  console.log(`\n${BOLD}[ 4/4 ] Relatório do banco${RESET}`);
  hr();

  // Tabelas
  const { rows: tables } = await client.query(`
    SELECT tablename AS name,
           pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS size
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  // Índices
  const { rows: indexes } = await client.query(`
    SELECT COUNT(*) AS total FROM pg_indexes WHERE schemaname = 'public'
  `);

  // Views
  const { rows: views } = await client.query(`
    SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname
  `);

  // Triggers
  const { rows: triggers } = await client.query(`
    SELECT trigger_name, event_object_table
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table
  `);

  // Contagem de registros
  const { rows: storeCnt } = await client.query('SELECT COUNT(*) n FROM stores');
  const { rows: adminCnt } = await client.query('SELECT COUNT(*) n FROM admins');

  console.log(`\n  ${BOLD}Tabelas${RESET}`);
  tables.forEach(t => dim(`  ${t.name.padEnd(20)} ${t.size}`));

  console.log(`\n  ${BOLD}Views${RESET}`);
  views.length
    ? views.forEach(v => dim(`  ${v.viewname}`))
    : dim('  Nenhuma');

  console.log(`\n  ${BOLD}Triggers${RESET}`);
  triggers.length
    ? triggers.forEach(t => dim(`  ${t.trigger_name} → ${t.event_object_table}`))
    : dim('  Nenhum');

  console.log(`\n  ${BOLD}Índices${RESET}`);
  dim(`  ${indexes[0].total} índices criados`);

  console.log(`\n  ${BOLD}Registros${RESET}`);
  dim(`  stores : ${storeCnt[0].n} loja(s)`);
  dim(`  admins : ${adminCnt[0].n} admin(s)`);
}

// ════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════
async function main() {
  printBanner();

  let adminClient, targetClient;

  try {
    // Conecta no postgres (para criar database)
    info('Conectando ao PostgreSQL...');
    adminClient = await connectAdmin();
    ok(`Conectado em ${DB_HOST}:${DB_PORT}/postgres`);

    await ensureDatabase(adminClient);
    await adminClient.end();

    // Conecta na database de destino
    targetClient = await connectTarget();
    ok(`Conectado em ${DB_HOST}:${DB_PORT}/${DB_NAME}`);

    await applySchema(targetClient);
    await ensureAdmin(targetClient);
    await printReport(targetClient);

    const line = '═'.repeat(58);
    console.log(`\n${GREEN}${BOLD}${line}${RESET}`);
    console.log(`${GREEN}${BOLD}  ✔  Setup concluído com sucesso!${RESET}`);
    console.log(`${GREEN}${line}${RESET}`);
    console.log(`\n  Inicie o servidor com:\n`);
    console.log(`    ${BOLD}npm run ${ENV.name.toLowerCase()}${RESET}         (porta ${ENV.port})\n`);

  } catch(e) {
    hr();
    err(`Setup falhou: ${e.message}`);
    if (VERBOSE) console.error(e.stack);
    process.exit(1);
  } finally {
    if (adminClient)  try { await adminClient.end();  } catch {}
    if (targetClient) try { await targetClient.end(); } catch {}
  }
}

main();
