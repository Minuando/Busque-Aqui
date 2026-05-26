'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  scripts/check-db.js
 *
 *  Inspeciona o estado atual do banco de dados sem fazer alterações.
 *  Útil para diagnóstico e verificação pós-setup.
 *
 *  Uso:
 *    node scripts/check-db.js --env=dev
 *    node scripts/check-db.js --env=prod
 * ═══════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const { Client } = require('pg');
const { resolveEnvironment, envFilePath } = require('../config/environments');

const ENV = resolveEnvironment();

const envFile = envFilePath(ENV);
if (fs.existsSync(envFile)) require('dotenv').config({ path: envFile });

const DB_HOST     = process.env.DB_HOST     || 'localhost';
const DB_PORT     = parseInt(process.env.DB_PORT || '5432');
const DB_NAME     = process.env.DB_NAME     || 'storefinder';
const DB_USER     = process.env.DB_USER     || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

// ── Visual ───────────────────────────────────────────────────────
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

const ok    = msg => console.log(`  ${GREEN}✔${RESET}  ${msg}`);
const fail  = msg => console.log(`  ${RED}✖${RESET}  ${msg}`);
const warn  = msg => console.log(`  ${YELLOW}⚠${RESET}  ${msg}`);
const sec   = msg => console.log(`\n${BOLD}  ${msg}${RESET}`);
const row   = (k, v, color='') => console.log(`  ${DIM}${k.padEnd(28)}${RESET}${color}${v}${RESET}`);
const hr    = () => console.log('─'.repeat(58));

async function main() {
  const line = '═'.repeat(58);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  StoreFinder — Diagnóstico do Banco${RESET}`);
  console.log(`${line}\n`);

  console.log(`  Ambiente  : ${BOLD}${ENV.name}${RESET}`);
  console.log(`  Host      : ${DB_HOST}:${DB_PORT}`);
  console.log(`  Database  : ${BOLD}${DB_NAME}${RESET}`);
  console.log(`  Usuário   : ${DB_USER}\n`);

  let client;
  try {
    client = new Client({
      host: DB_HOST, port: DB_PORT,
      database: DB_NAME,
      user: DB_USER, password: DB_PASSWORD,
      connectionTimeoutMillis: 6_000,
    });

    const t0 = Date.now();
    await client.connect();
    const latency = Date.now() - t0;

    ok(`Conectado (latência: ${latency}ms)`);

    // ── Versão do PostgreSQL ───────────────────────────────────
    sec('PostgreSQL');
    hr();
    const { rows: pgver } = await client.query('SELECT version()');
    row('Versão', pgver[0].version.split(' ').slice(0, 2).join(' '));

    const { rows: pgsize } = await client.query(
      `SELECT pg_size_pretty(pg_database_size($1)) AS size`, [DB_NAME]
    );
    row('Tamanho da database', pgsize[0].size);

    const { rows: conns } = await client.query(
      `SELECT COUNT(*) n FROM pg_stat_activity WHERE datname = $1`, [DB_NAME]
    );
    row('Conexões ativas', conns[0].n);

    // ── Tabelas ───────────────────────────────────────────────
    sec('Tabelas');
    hr();
    const { rows: tables } = await client.query(`
      SELECT
        t.tablename                                            AS name,
        pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename))) AS size,
        (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_name = t.tablename AND table_schema = 'public') AS cols
      FROM pg_tables t
      WHERE t.schemaname = 'public'
      ORDER BY t.tablename
    `);

    if (!tables.length) {
      warn('Nenhuma tabela encontrada — o schema não foi aplicado.');
    } else {
      tables.forEach(t => {
        row(`${t.name}`, `${t.cols} colunas  ${t.size}`);
      });
    }

    // ── Verificação de tabelas obrigatórias ───────────────────
    sec('Verificação de integridade');
    hr();
    const required = ['stores', 'admins'];
    const existing = tables.map(t => t.name);

    required.forEach(tbl => {
      if (existing.includes(tbl)) ok(`Tabela "${tbl}" presente.`);
      else                        fail(`Tabela "${tbl}" AUSENTE — execute setup-db.js`);
    });

    // Verifica colunas críticas de stores
    const { rows: storeCols } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'stores' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    const criticalCols = ['id','name','category','lat','lng','hours_schedule','timezone','status'];
    const existingCols = storeCols.map(c => c.column_name);
    criticalCols.forEach(col => {
      if (existingCols.includes(col)) ok(`Coluna stores.${col} presente.`);
      else                            fail(`Coluna stores.${col} AUSENTE — execute migration_hours.sql`);
    });

    // ── Índices ───────────────────────────────────────────────
    sec('Índices');
    hr();
    const { rows: idxs } = await client.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);
    if (!idxs.length) {
      warn('Nenhum índice encontrado.');
    } else {
      idxs.forEach(i => row(`${i.tablename}.${i.indexname}`, ''));
    }

    // ── Triggers ──────────────────────────────────────────────
    sec('Triggers');
    hr();
    const { rows: trigs } = await client.query(`
      SELECT trigger_name, event_object_table, event_manipulation
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      ORDER BY event_object_table
    `);
    if (!trigs.length) warn('Nenhum trigger encontrado.');
    else trigs.forEach(t => row(`${t.event_object_table}`, `${t.trigger_name} (${t.event_manipulation})`));

    // ── Views ─────────────────────────────────────────────────
    sec('Views');
    hr();
    const { rows: vws } = await client.query(`
      SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname
    `);
    if (!vws.length) warn('Nenhuma view encontrada.');
    else vws.forEach(v => row(v.viewname, ''));

    // ── Contagem de registros ─────────────────────────────────
    sec('Dados');
    hr();
    const { rows: sc } = await client.query('SELECT COUNT(*) n FROM stores');
    const { rows: ac } = await client.query('SELECT COUNT(*) n FROM admins');
    row('Lojas cadastradas',    sc[0].n, sc[0].n > 0 ? GREEN : YELLOW);
    row('Administradores',      ac[0].n, ac[0].n > 0 ? GREEN : RED);

    // Detalhes das lojas
    if (sc[0].n > 0) {
      const { rows: cats } = await client.query(`
        SELECT category, COUNT(*) n FROM stores GROUP BY category ORDER BY n DESC
      `);
      const { rows: statuses } = await client.query(`
        SELECT status, COUNT(*) n FROM stores GROUP BY status ORDER BY status
      `);

      console.log('');
      cats.forEach(c    => row(`  · ${c.category}`, `${c.n} loja(s)`, DIM));
      console.log('');
      statuses.forEach(s => row(`  · status=${s.status}`, `${s.n} loja(s)`, DIM));
    }

    // Detalhes dos admins
    if (ac[0].n > 0) {
      const { rows: adms } = await client.query(
        `SELECT username, created_at FROM admins ORDER BY created_at`
      );
      console.log('');
      adms.forEach(a => row(
        `  · ${a.username}`,
        `criado em ${new Date(a.created_at).toLocaleDateString('pt-BR')}`,
        DIM
      ));
    }

    // ── Resumo final ──────────────────────────────────────────
    const allOk = required.every(t => existing.includes(t)) &&
                  criticalCols.every(c => existingCols.includes(c));

    console.log(`\n${'═'.repeat(58)}`);
    if (allOk) {
      console.log(`${GREEN}${BOLD}  ✔  Banco de dados OK — pronto para uso.${RESET}`);
    } else {
      console.log(`${RED}${BOLD}  ✖  Banco incompleto — execute: npm run setup:${ENV.name.toLowerCase()}${RESET}`);
    }
    console.log(`${'═'.repeat(58)}\n`);

  } catch(e) {
    hr();
    fail(`Falha na conexão: ${e.message}`);
    console.log(`\n  Verifique:\n`);
    console.log(`    • PostgreSQL está rodando em ${DB_HOST}:${DB_PORT}`);
    console.log(`    • As credenciais em ${ENV.envFile} estão corretas`);
    console.log(`    • A database "${DB_NAME}" existe\n`);
    console.log(`  Para criar do zero:\n`);
    console.log(`    ${BOLD}npm run setup:${ENV.name.toLowerCase()}${RESET}\n`);
    process.exit(1);
  } finally {
    if (client) try { await client.end(); } catch {}
  }
}

main();
