'use strict';

/**
 * ═══════════════════════════════════════════════════════
 *  start-all.js  —  Inicia todos os ambientes em paralelo
 *
 *  Uso:
 *    node start-all.js              → sobe todos da lista
 *    node start-all.js dev prod     → sobe só os citados
 *    node start-all.js --watch      → usa nodemon em todos
 * ═══════════════════════════════════════════════════════
 */

const { spawn }        = require('child_process');
const path             = require('path');
const { ENVIRONMENTS } = require('./config/environments');

// ════════════════════════════════════════
//  PARSE ARGUMENTOS
// ════════════════════════════════════════
const args       = process.argv.slice(2);
const useWatch   = args.includes('--watch');
const filterKeys = args.filter(a => !a.startsWith('--')).map(a => a.toUpperCase());

// Filtra ambientes pelo argumento ou usa todos
const targets = filterKeys.length
  ? ENVIRONMENTS.filter(e => filterKeys.includes(e.name))
  : ENVIRONMENTS;

if (!targets.length) {
  console.error(`[launcher] Nenhum ambiente encontrado para: ${filterKeys.join(', ')}`);
  console.error(`[launcher] Disponíveis: ${ENVIRONMENTS.map(e => e.name).join(', ')}`);
  process.exit(1);
}

// ════════════════════════════════════════
//  CORES ANSI (uma por ambiente)
// ════════════════════════════════════════
const PALETTE = [
  { fg: '\x1b[33m', bg: '\x1b[43m\x1b[30m' },  // amarelo
  { fg: '\x1b[36m', bg: '\x1b[46m\x1b[30m' },  // ciano
  { fg: '\x1b[35m', bg: '\x1b[45m\x1b[30m' },  // magenta
  { fg: '\x1b[32m', bg: '\x1b[42m\x1b[30m' },  // verde
  { fg: '\x1b[34m', bg: '\x1b[44m\x1b[37m' },  // azul
];
const RESET = '\x1b[0m';

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

// ════════════════════════════════════════
//  PREFIX  ex: " DEV :3000 "
// ════════════════════════════════════════
function makePrefix(env, color) {
  const label = ` ${env.name}:${env.port} `;
  return `${color.bg}${label}${RESET}${color.fg}`;
}

// Alinha prefixos pelo mais longo
const maxLen = Math.max(...targets.map(e => ` ${e.name}:${e.port} `.length));
function padPrefix(env, color) {
  const label = ` ${env.name}:${env.port} `.padEnd(maxLen);
  return `${color.bg}${label}${RESET}${color.fg}`;
}

// ════════════════════════════════════════
//  IMPRIME CABEÇALHO
// ════════════════════════════════════════
function printBanner() {
  const line = '═'.repeat(56);
  console.log(`\n${line}`);
  console.log('  Busque Aqui — Multi-Environment Launcher');
  console.log(`  Modo: ${useWatch ? 'watch (nodemon)' : 'node'}`);
  console.log(line);
  targets.forEach((env, i) => {
    const c = colorFor(i);
    console.log(
      `  ${c.fg}●${RESET}  ${env.name.padEnd(10)} ` +
      `porta ${String(env.port).padEnd(6)} ` +
      `env: ${env.envFile.padEnd(14)} ` +
      `html: ${env.html}`
    );
  });
  console.log(`${line}\n`);
}

// ════════════════════════════════════════
//  LANÇA UM PROCESSO POR AMBIENTE
// ════════════════════════════════════════
const processes = [];

function launchEnv(env, index) {
  const color  = colorFor(index);
  const prefix = padPrefix(env, color);

  const runner = useWatch ? 'nodemon' : 'node';
  const runnerArgs = useWatch
    ? ['server.js', '--', `--env=${env.name.toLowerCase()}`]
    : ['server.js', `--env=${env.name.toLowerCase()}`];

  const child = spawn(runner, runnerArgs, {
    cwd:   path.resolve(__dirname),
    stdio: ['ignore', 'pipe', 'pipe'],
    env:   { ...process.env },        // herda PATH, etc.
    shell: process.platform === 'win32',
  });

  // Formata e imprime cada linha com prefix colorido
  function printLines(stream, isError) {
    let buf = '';
    stream.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();             // guarda linha incompleta
      lines.forEach(line => {
        if (!line.trim()) return;
        const mark = isError ? `\x1b[31m✖${RESET}` : ' ';
        console.log(`${prefix} ${mark} ${line}${RESET}`);
      });
    });
    stream.on('end', () => {
      if (buf.trim()) console.log(`${prefix}   ${buf}${RESET}`);
    });
  }

  printLines(child.stdout, false);
  printLines(child.stderr, true);

  child.on('exit', (code, signal) => {
    const reason = signal ? `sinal ${signal}` : `código ${code}`;
    console.log(`\n${prefix} \x1b[31m✖ Processo encerrado (${reason})\x1b[0m`);
    processes.splice(processes.indexOf(child), 1);
    if (processes.length === 0) {
      console.log('\n[launcher] Todos os processos encerraram.\n');
      process.exit(0);
    }
  });

  child.on('error', err => {
    if (err.code === 'ENOENT') {
      console.error(`\n${prefix} \x1b[31m✖ Comando '${runner}' não encontrado.`);
      if (useWatch) console.error(`${prefix}   Instale com: npm install -g nodemon\x1b[0m\n`);
    } else {
      console.error(`\n${prefix} \x1b[31m✖ Erro: ${err.message}\x1b[0m\n`);
    }
  });

  processes.push(child);
  return child;
}

// ════════════════════════════════════════
//  GRACEFUL SHUTDOWN (Ctrl+C)
// ════════════════════════════════════════
function shutdownAll(sig) {
  const line = '─'.repeat(56);
  console.log(`\n${line}`);
  console.log(`[launcher] ${sig} recebido — encerrando ${processes.length} processo(s)…`);
  console.log(line);
  processes.forEach(p => {
    try { p.kill('SIGTERM'); } catch {}
  });
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT',  () => shutdownAll('SIGINT'));
process.on('SIGTERM', () => shutdownAll('SIGTERM'));

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
printBanner();
targets.forEach((env, i) => launchEnv(env, i));
