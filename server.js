'use strict';

// ════════════════════════════════════════
//  1. RESOLVE AMBIENTE  (antes de qualquer require)
// ════════════════════════════════════════
const { resolveEnvironment, envFilePath, htmlFilePath } = require('./config/environments');

const ENV = resolveEnvironment();

// Carrega o .env do ambiente resolvido
const dotenvResult = require('dotenv').config({ path: envFilePath(ENV) });
if (dotenvResult.error) {
  console.warn(`[CONFIG] Arquivo ${ENV.envFile} não encontrado — usando variáveis do processo.`);
}

// ════════════════════════════════════════
//  2. IMPORTS
// ════════════════════════════════════════
const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'storefinder_secret_dev_unsafe';

// ════════════════════════════════════════
//  3. LOGGER  (responde ao logLevel do ambiente)
// ════════════════════════════════════════
const LEVELS = { verbose:3, normal:2, silent:0 };
const lvl    = LEVELS[ENV.options.logLevel] ?? 2;

const log = {
  info:    (...a) => lvl >= 2 && console.log ('[INFO]',  ...a),
  verbose: (...a) => lvl >= 3 && console.log ('[DEBUG]', ...a),
  warn:    (...a) => lvl >= 1 && console.warn('[WARN]',  ...a),
  error:   (...a) =>             console.error('[ERROR]', ...a),
};

// ════════════════════════════════════════
//  4. BANCO DE DADOS
// ════════════════════════════════════════
const pool = new Pool({
  host:                    process.env.DB_HOST     || 'localhost',
  port:     parseInt(     process.env.DB_PORT      || '5432'),
  database:                process.env.DB_NAME     || 'busqueaqui',
  user:                    process.env.DB_USER     || 'postgres',
  password:                process.env.DB_PASSWORD || '',
  max:      parseInt(     process.env.DB_POOL_MAX  || '10'),
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', err => log.error('Pool error:', err.message));

async function ensureAdmin() {
  const u = process.env.ADMIN_USER     || 'admin';
  const p = process.env.ADMIN_PASSWORD || 'admin123';
  const { rows } = await pool.query('SELECT id FROM admins WHERE username=$1', [u]);
  if (!rows.length) {
    const hash = await bcrypt.hash(p, 10);
    await pool.query('INSERT INTO admins(username,password_hash) VALUES($1,$2)', [u, hash]);
    log.info(`Admin '${u}' criado.`);
  }
}

// ════════════════════════════════════════
//  5. LÓGICA DE HORÁRIO
// ════════════════════════════════════════
function nowInTimezone(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone:tz, weekday:'short', hour:'2-digit', minute:'2-digit', hour12:false,
    }).formatToParts(new Date());
    const get  = t => parts.find(p => p.type === t)?.value ?? '0';
    const DAY  = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const hour = parseInt(get('hour')) % 24;
    return { day: DAY[get('weekday')] ?? 0, minutes: hour * 60 + parseInt(get('minute')) };
  } catch {
    const n = new Date();
    return { day:n.getUTCDay(), minutes:n.getUTCHours()*60+n.getUTCMinutes() };
  }
}

function toMin(t) {
  if (!t) return null;
  const [h,m] = t.split(':').map(Number);
  return h*60+(m||0);
}

function computeIsOpen(schedule, tz='America/Sao_Paulo', status='auto') {
  if (status==='open')   return { is_open:true,  status_label:'Sempre aberta',  next_event:null, closes_at:null, opens_at:null, opens_in_day:null };
  if (status==='closed') return { is_open:false, status_label:'Sempre fechada', next_event:null, closes_at:null, opens_at:null, opens_in_day:null };
  if (!schedule||typeof schedule!=='object')
    return { is_open:null, status_label:'Horário não informado', next_event:null, closes_at:null, opens_at:null, opens_in_day:null };

  const { day, minutes } = nowInTimezone(tz);
  const slot = schedule[String(day)];

  if (slot?.open && slot?.close) {
    const o=toMin(slot.open), c=toMin(slot.close);
    if (minutes>=o && minutes<c) {
      const rem=c-minutes;
      return { is_open:true, status_label:'Aberta agora',
        next_event: rem<=30?`Fecha em ${rem} min`:`Fecha às ${slot.close}`,
        closes_at:slot.close, opens_at:null, opens_in_day:null };
    }
  }

  const DAYS=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
  for (let delta=0;delta<=7;delta++) {
    const cd=(day+delta)%7, sl=schedule[String(cd)];
    if (!sl?.open) continue;
    const om=toMin(sl.open);
    if (delta===0&&om<=minutes) continue;
    const next=delta===0?`Abre hoje às ${sl.open}`:delta===1?`Abre amanhã às ${sl.open}`:`Abre ${DAYS[cd]} às ${sl.open}`;
    return { is_open:false, status_label:delta===0?'Abre mais tarde':'Fechada agora', next_event:next, closes_at:null, opens_at:sl.open, opens_in_day:delta };
  }
  return { is_open:false, status_label:'Fechada', next_event:'Sem previsão de abertura', closes_at:null, opens_at:null, opens_in_day:null };
}

function enrichStore(s) { return { ...s, ...computeIsOpen(s.hours_schedule, s.timezone, s.status) }; }

// ════════════════════════════════════════
//  6. EXPRESS
// ════════════════════════════════════════
const app = express();

if (ENV.options.trustProxy) app.set('trust proxy', 1);

// CORS — permissivo em dev, restritivo em prod
const corsOptions = ENV.options.corsOrigins === '*'
  ? { origin:'*' }
  : {
      origin(origin, cb) {
        const allowed = (process.env.CORS_ORIGIN||'').split(',').map(s=>s.trim()).filter(Boolean);
        if (!origin || allowed.includes(origin)) return cb(null, true);
        cb(new Error(`CORS bloqueado: ${origin}`));
      },
      credentials: true,
    };
app.use(cors(corsOptions));

// JSON pretty em dev
app.set('json spaces', ENV.options.prettyJson ? 2 : 0);
app.use(express.json({ limit:'1mb' }));

// Log por requisição
app.use((req, _res, next) => { log.verbose(`${req.method} ${req.path}`); next(); });

// Headers de debug (apenas DEV)
if (ENV.options.enableDevHints) {
  app.use((_req, res, next) => {
    res.setHeader('X-Environment', ENV.name);
    res.setHeader('X-Dev-Port',    String(ENV.port));
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error:'Token não fornecido.' });
  try { req.admin = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error:'Token inválido ou expirado.' }); }
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ════════════════════════════════════════
//  7. ROTAS META
// ════════════════════════════════════════

// Retorna info do ambiente — bloqueado em PROD
app.get('/api/env', (req, res) => {
  if (!ENV.options.enableDevHints) return res.status(404).json({ error:'Not found.' });
  res.json({
    environment: ENV.name,
    port:        ENV.port,
    html:        ENV.html,
    node:        process.version,
    uptime:      Math.floor(process.uptime())+'s',
    db: { host:process.env.DB_HOST, name:process.env.DB_NAME, pool_max:process.env.DB_POOL_MAX||10 },
    timestamp:   new Date().toISOString(),
  });
});

// Health check — disponível em todos os ambientes
app.get('/api/health', wrap(async (_req, res) => {
  const t = Date.now();
  try {
    await pool.query('SELECT 1');
    res.json({ status:'ok', environment:ENV.name, db:'connected', latency_ms:Date.now()-t });
  } catch(e) {
    res.status(503).json({ status:'error', environment:ENV.name, db:'disconnected', error:e.message });
  }
}));

// ════════════════════════════════════════
//  8. ROTAS AUTH
// ════════════════════════════════════════
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username||!password) return res.status(400).json({ error:'Informe usuário e senha.' });
  const { rows } = await pool.query('SELECT * FROM admins WHERE username=$1', [username]);
  if (!rows.length||!await bcrypt.compare(password, rows[0].password_hash))
    return res.status(401).json({ error:'Usuário ou senha incorretos.' });
  const token = jwt.sign({ id:rows[0].id, username:rows[0].username }, JWT_SECRET, { expiresIn:'8h' });
  log.info(`Login: ${username}`);
  res.json({ token, id:rows[0].id, username:rows[0].username, environment:ENV.name });
}));

app.post('/api/auth/verify', requireAuth, (req, res) =>
  res.json({ valid:true, username:req.admin.username }));

// ════════════════════════════════════════
//  9. ROTAS STORES (público)
// ════════════════════════════════════════
app.get('/api/stores', wrap(async (req, res) => {
  const { search, category } = req.query;
  const params=[], conds=[];
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(name ILIKE $${params.length} OR city ILIKE $${params.length} OR address ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (category&&category!=='all') { params.push(category); conds.push(`category=$${params.length}`); }
  const where=conds.length?`WHERE ${conds.join(' AND ')}`:'';
  const { rows } = await pool.query(`SELECT * FROM stores ${where} ORDER BY name`, params);
  res.json(rows.map(enrichStore));
}));

app.get('/api/stores/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stores WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error:'Loja não encontrada.' });
  res.json(enrichStore(rows[0]));
}));

app.get('/api/stores/:id/open-status', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,status,hours_schedule,timezone FROM stores WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error:'Loja não encontrada.' });
  const s=rows[0];
  res.json({ id:s.id, name:s.name, ...computeIsOpen(s.hours_schedule, s.timezone, s.status) });
}));

app.get('/api/categories', wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT DISTINCT category FROM stores ORDER BY category');
  res.json(rows.map(r=>r.category));
}));

app.get('/api/stats', wrap(async (_req, res) => {
  const { rows }  = await pool.query('SELECT status,hours_schedule,timezone FROM stores');
  const enriched  = rows.map(s=>computeIsOpen(s.hours_schedule, s.timezone, s.status));
  const { rows:agg } = await pool.query('SELECT COUNT(DISTINCT category) c, COUNT(DISTINCT city) ci FROM stores');
  res.json({ total:rows.length, open:enriched.filter(s=>s.is_open===true).length, categories:+agg[0].c, cities:+agg[0].ci });
}));

// ════════════════════════════════════════
//  10. ROTAS STORES (admin)
// ════════════════════════════════════════
const COLS = `name,category,phone,address,city,state,lat,lng,hours,hours_schedule,timezone,status,website,description`;

app.post('/api/stores', requireAuth, wrap(async (req, res) => {
  const b=req.body;
  if (!b.name||!b.category||b.lat==null||b.lng==null)
    return res.status(400).json({ error:'Nome, categoria e coordenadas são obrigatórios.' });
  const { rows } = await pool.query(
    `INSERT INTO stores (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [b.name,b.category,b.phone||null,b.address||null,b.city||null,b.state||null,
     b.lat,b.lng,b.hours||null,b.hours_schedule?JSON.stringify(b.hours_schedule):null,
     b.timezone||'America/Sao_Paulo',b.status||'auto',b.website||null,b.description||null]
  );
  log.info(`Loja criada: ${b.name} [id=${rows[0].id}]`);
  res.status(201).json(enrichStore(rows[0]));
}));

app.put('/api/stores/:id', requireAuth, wrap(async (req, res) => {
  const b=req.body;
  if (!b.name||!b.category||b.lat==null||b.lng==null)
    return res.status(400).json({ error:'Nome, categoria e coordenadas são obrigatórios.' });
  const { rows } = await pool.query(
    `UPDATE stores SET name=$1,category=$2,phone=$3,address=$4,city=$5,state=$6,lat=$7,lng=$8,
     hours=$9,hours_schedule=$10,timezone=$11,status=$12,website=$13,description=$14
     WHERE id=$15 RETURNING *`,
    [b.name,b.category,b.phone||null,b.address||null,b.city||null,b.state||null,
     b.lat,b.lng,b.hours||null,b.hours_schedule?JSON.stringify(b.hours_schedule):null,
     b.timezone||'America/Sao_Paulo',b.status||'auto',b.website||null,b.description||null,
     req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error:'Loja não encontrada.' });
  log.info(`Loja atualizada: id=${req.params.id}`);
  res.json(enrichStore(rows[0]));
}));

app.delete('/api/stores/:id', requireAuth, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM stores WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error:'Loja não encontrada.' });
  log.info(`Loja removida: id=${req.params.id}`);
  res.json({ success:true });
}));

// ════════════════════════════════════════
//  11. ROTAS ADMINS
// ════════════════════════════════════════
app.get('/api/admins', requireAuth, wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT id,username,created_at FROM admins ORDER BY username');
  res.json(rows);
}));

// POST /api/admins — cria novo administrador
app.post('/api/admins', requireAuth, wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO admins(username,password_hash) VALUES($1,$2) RETURNING id,username,created_at',
      [username, hash]
    );
    log.info(`Admin criado: ${username}`);
    res.status(201).json(rows[0]);
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Usuário já existe.' });
    throw e;
  }
}));

// PATCH /api/admins/:id/password — atualiza senha
//
// Regras de segurança:
//   • Qualquer admin autenticado pode alterar a própria senha
//     → exige o campo "current_password" para confirmar identidade
//   • Um admin SÓ pode alterar senha de outro se não for ele mesmo
//     → NÃO exige "current_password" (ação administrativa)
//   • A nova senha deve ter no mínimo 6 caracteres
app.patch('/api/admins/:id/password', requireAuth, wrap(async (req, res) => {
  const targetId    = String(req.params.id);
  const requesterId = String(req.admin.id);
  const isSelf      = targetId === requesterId;

  const { new_password, current_password } = req.body;

  // ── Validação da nova senha ──────────────────────────
  if (!new_password)
    return res.status(400).json({ error: 'O campo new_password é obrigatório.' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });

  // ── Busca o admin alvo ───────────────────────────────
  const { rows } = await pool.query(
    'SELECT id, username, password_hash FROM admins WHERE id=$1',
    [targetId]
  );
  if (!rows.length)
    return res.status(404).json({ error: 'Admin não encontrado.' });

  const target = rows[0];

  // ── Alteração da própria senha: exige senha atual ────
  if (isSelf) {
    if (!current_password)
      return res.status(400).json({ error: 'Informe a senha atual (current_password).' });

    const valid = await bcrypt.compare(current_password, target.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Senha atual incorreta.' });

    // Garante que a nova senha seja diferente da atual
    const same = await bcrypt.compare(new_password, target.password_hash);
    if (same)
      return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
  }

  // ── Gera hash e persiste ─────────────────────────────
  const newHash = await bcrypt.hash(new_password, 10);
  await pool.query(
    'UPDATE admins SET password_hash=$1 WHERE id=$2',
    [newHash, targetId]
  );

  const who = isSelf ? `própria senha` : `senha de '${target.username}'`;
  log.info(`Admin '${req.admin.username}' atualizou ${who}`);

  res.json({
    success:  true,
    message:  isSelf ? 'Senha alterada com sucesso.' : `Senha de '${target.username}' redefinida.`,
    username: target.username,
  });
}));

// DELETE /api/admins/:id — remove administrador
app.delete('/api/admins/:id', requireAuth, wrap(async (req, res) => {
  if (String(req.admin.id) === String(req.params.id))
    return res.status(400).json({ error: 'Você não pode excluir a si mesmo.' });
  const { rowCount } = await pool.query('DELETE FROM admins WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Admin não encontrado.' });
  log.info(`Admin removido: id=${req.params.id}`);
  res.json({ success: true });
}));

// ════════════════════════════════════════
//  12. SPA FALLBACK → HTML do ambiente
// ════════════════════════════════════════
app.get('*', (_req, res) => {
  const file = htmlFilePath(ENV);
  if (fs.existsSync(file)) return res.sendFile(file);
  log.warn(`HTML '${ENV.html}' não encontrado — usando index.html`);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ════════════════════════════════════════
//  13. TRATAMENTO DE ERROS
// ════════════════════════════════════════
app.use((err, req, res, _next) => {
  log.error(`${req.method} ${req.path} —`, err.message);
  const body = { error:'Erro interno do servidor.' };
  if (ENV.options.stackTrace) body.stack = err.stack;
  res.status(500).json(body);
});

// ════════════════════════════════════════
//  14. START
// ════════════════════════════════════════
async function start() {
  const line = '═'.repeat(52);
  console.log(`\n${line}`);
  console.log(`  Busque Aqui  │  Ambiente : ${ENV.name}`);
  console.log(`  Porta        │  ${ENV.port}`);
  console.log(`  Env file     │  ${ENV.envFile}`);
  console.log(`  HTML         │  public/${ENV.html}`);
  console.log(`  Log level    │  ${ENV.options.logLevel}`);
  console.log(`${line}\n`);

  try {
    await pool.query('SELECT 1');
    log.info(`PostgreSQL → ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
    await ensureAdmin();

    app.listen(ENV.port, () => {
      log.info(`Servidor em http://localhost:${ENV.port}`);
      if (ENV.options.enableDevHints) {
        log.info(`Debug → http://localhost:${ENV.port}/api/env`);
        log.info(`Health → http://localhost:${ENV.port}/api/health`);
      }
    });
  } catch(err) {
    log.error('Falha ao conectar ao banco:', err.message);
    log.error('Verifique as variáveis em', ENV.envFile);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (sig) => {
  log.info(`${sig} recebido — encerrando...`);
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
