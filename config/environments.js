'use strict';

/**
 * ═══════════════════════════════════════════════════════
 *  config/environments.js
 *  Fonte única de verdade para todos os ambientes.
 *  Para adicionar um novo ambiente, basta inserir um
 *  objeto neste array — o servidor se adapta sozinho.
 * ═══════════════════════════════════════════════════════
 */

const path = require('path');

const ENVIRONMENTS = [
  {
    name:    'DEV',
    port:    3000,
    envFile: '.env.dev',
    html:    'index-dev.html',       // public/index-dev.html

    // Comportamentos específicos de cada ambiente
    options: {
      trustProxy:    false,
      corsOrigins:   '*',
      logLevel:      'verbose',       // 'verbose' | 'normal' | 'silent'
      prettyJson:    true,            // JSON indentado nas respostas
      stackTrace:    true,            // exibe stack em erros
      enableDevHints: true,           // banner + headers de debug
    },
  },
  {
    name:    'PROD',
    port:    8080,
    envFile: '.env.prod',
    html:    'index-prod.html',      // public/index-prod.html

    options: {
      trustProxy:    true,
     corsOrigins:   process.env.CORS_ORIGIN || '',  // vazio = restritivo
      logLevel:      'normal',
      prettyJson:    false,
      stackTrace:    false,
      enableDevHints: false,
    },
  },
  // Exemplo de como adicionar um terceiro ambiente:
  // {
  //   name:    'STAGING',
  //   port:    4000,
  //   envFile: '.env.staging',
  //   html:    'index-staging.html',
  //   options: { ... },
  // },
];

/**
 * Resolve o ambiente pelo argumento de linha de comando ou
 * variável de ambiente NODE_ENV.
 *
 *  node server.js --env=dev
 *  node server.js --env=prod
 *  NODE_ENV=prod node server.js
 *
 * Padrão: primeiro da lista (DEV).
 */
function resolveEnvironment(argv = process.argv, nodeEnv = process.env.NODE_ENV) {
  // 1. Tenta --env=<name> nos argumentos
  const flag = argv.find(a => a.startsWith('--env='));
  const fromFlag = flag ? flag.split('=')[1].toUpperCase() : null;

  // 2. Tenta NODE_ENV
  const fromEnv = nodeEnv ? nodeEnv.toUpperCase() : null;

  const key = fromFlag || fromEnv || null;

  if (key) {
    const found = ENVIRONMENTS.find(e => e.name === key);
    if (!found) {
      const available = ENVIRONMENTS.map(e => e.name).join(', ');
      console.error(`[CONFIG] Ambiente '${key}' não encontrado. Disponíveis: ${available}`);
      process.exit(1);
    }
    return found;
  }

  // 3. Padrão: primeiro da lista
  return ENVIRONMENTS[0];
}

/**
 * Monta o caminho absoluto do arquivo .env do ambiente.
 */
function envFilePath(env) {
  return path.resolve(process.cwd(), env.envFile);
}

/**
 * Monta o caminho absoluto do HTML do ambiente dentro de /public.
 */
function htmlFilePath(env) {
  return path.resolve(process.cwd(), 'public', env.html);
}

module.exports = { ENVIRONMENTS, resolveEnvironment, envFilePath, htmlFilePath };
