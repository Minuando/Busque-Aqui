# Busque Aqui 🗺️

Sistema de busca de lojas com mapa interativo, detecção automática de horário de funcionamento por timezone, suporte a múltiplos ambientes e painel administrativo completo — incluindo automação total de banco de dados.

**Stack:** Node.js · Express · PostgreSQL · Leaflet (OpenStreetMap) · JWT · bcrypt

---

## Índice

1. [Estrutura do projeto](#1-estrutura-do-projeto)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Instalação rápida](#3-instalação-rápida)
4. [Ambientes](#4-ambientes)
5. [Banco de dados](#5-banco-de-dados)
6. [Automação do banco](#6-automação-do-banco)
7. [Inicialização do servidor](#7-inicialização-do-servidor)
8. [API REST](#8-api-rest)
9. [Detecção de horário](#9-detecção-de-horário)
10. [Funcionalidades do frontend](#10-funcionalidades-do-frontend)
11. [Gerenciamento de administradores](#11-gerenciamento-de-administradores)
12. [Segurança](#12-segurança)
13. [Adicionar novo ambiente](#13-adicionar-novo-ambiente)

---

## 1. Estrutura do projeto

```
Busque_Aqui/
│
├── server.js                    # Servidor Express multiambiente
├── start-all.js                 # Launcher paralelo de todos os ambientes
│
├── config/
│   └── environments.js          # Fonte única de verdade dos ambientes
│
├── scripts/
│   ├── setup-db.js              # Cria database + aplica schema + admin
│   ├── check-db.js              # Diagnóstico do banco (somente leitura)
│   └── teardown-db.js           # Drop + recriação (apenas DEV/STAGING)
│
├── public/
│   ├── index.html               # HTML base (fallback)
│   ├── index-dev.html           # Frontend DEV (com painel de debug)
│   └── index-prod.html          # Frontend PROD (limpo, sem debug)
│
├── schema.sql                   # Schema completo e idempotente
│
├── .env.dev                     # Variáveis do ambiente DEV
├── .env.prod                    # Variáveis do ambiente PROD ⚠️ não commitar
├── .env.example                 # Modelo de referência
├── .gitignore
└── package.json
```

## 2. Pré-requisitos

| Ferramenta | Versão mínima |
|---|---|
| Node.js | 18+ |
| PostgreSQL | 14+ |
| npm | 9+ |

---

## 3. Instalação rápida

```bash
# 1. Instale as dependências
npm install

# 2. Configure as variáveis de ambiente
cp .env.example .env.dev
cp .env.example .env.prod
# Edite cada arquivo com as credenciais do banco correspondente

# 3. Crie e configure os bancos (um comando faz tudo)
npm run setup:dev
npm run setup:prod

# 4. Inicie o servidor
npm run dev        # DEV  — http://localhost:3000
npm run prod       # PROD — http://localhost:8080
```

---

## 4. Ambientes

Os ambientes são definidos em **`config/environments.js`** — fonte única de verdade. Cada ambiente tem porta, arquivo `.env` e HTML próprios.

| Propriedade | DEV | PROD |
|---|---|---|
| Porta | `3000` | `8080` |
| Arquivo `.env` | `.env.dev` | `.env.prod` |
| HTML servido | `public/index-dev.html` | `public/index-prod.html` |
| Log level | `verbose` | `normal` |
| JSON indentado | ✅ | ❌ |
| Stack trace em erros | ✅ | ❌ |
| `GET /api/env` | ✅ exposto | ❌ bloqueado (404) |
| CORS | `*` (permissivo) | Lista em `CORS_ORIGIN` |
| Trust proxy | ❌ | ✅ (Nginx/LB) |
| Headers `X-Environment` | ✅ | ❌ |

### Variáveis de ambiente (`.env.dev` / `.env.prod`)

```env
# ── PostgreSQL ─────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=busqueaqui_dev      # busqueaqui em prod
DB_USER=postgres
DB_PASSWORD=sua_senha
DB_POOL_MAX=50

# ── Segurança ───────────────────────────────────────────
# Gere com: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=chave_secreta_longa_e_aleatoria

# ── Admin padrão (criado automaticamente no setup) ──────
ADMIN_USER=admin
ADMIN_PASSWORD=admin123

# ── CORS — apenas PROD (separado por vírgula) utilizar http://localhost:8080 para acessos locais em PRD ───────────
CORS_ORIGIN=https://seudomain.com,https://www.seudomain.com,http://localhost:8080
```

---

## 5. Banco de dados

### Diagrama de tabelas

```
┌──────────────────────────────────────────────────────────────┐
│  stores                                                      │
├──────────────────┬──────────────────┬────────────────────────┤
│ id               │ SERIAL PK        │ Auto-incrementado       │
│ name             │ VARCHAR(150) NN  │ Nome da loja            │
│ category         │ VARCHAR(80)  NN  │ Moda, Eletrônicos …     │
│ phone            │ VARCHAR(30)      │ Telefone                │
│ website          │ VARCHAR(300)     │ URL do site             │
│ description      │ TEXT             │ Descrição livre         │
│ address          │ VARCHAR(200)     │ Logradouro              │
│ city             │ VARCHAR(100)     │ Cidade                  │
│ state            │ CHAR(2)          │ UF                      │
│ lat              │ DOUBLE PREC. NN  │ Latitude WGS-84         │
│ lng              │ DOUBLE PREC. NN  │ Longitude WGS-84        │
│ hours            │ VARCHAR(150)     │ Horário em texto (legado)│
│ hours_schedule   │ JSONB            │ Grade por dia da semana │
│ timezone         │ VARCHAR(60)  NN  │ Timezone IANA da loja   │
│ status           │ VARCHAR(10)  NN  │ auto│open│closed        │
│ created_at       │ TIMESTAMPTZ  NN  │ Criação (UTC)           │
│ updated_at       │ TIMESTAMPTZ  NN  │ Atualização (UTC, auto) │
└──────────────────┴──────────────────┴────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  admins                                                      │
├──────────────────┬──────────────────┬────────────────────────┤
│ id               │ SERIAL PK        │ Auto-incrementado       │
│ username         │ VARCHAR(60) UQ   │ Login único             │
│ password_hash    │ VARCHAR(255) NN  │ Hash bcrypt (salt 10)   │
│ created_at       │ TIMESTAMPTZ  NN  │ Criação (UTC)           │
└──────────────────┴──────────────────┴────────────────────────┘
```

### Estrutura do `hours_schedule` (JSONB)

```json
{
  "0": { "open": "10:00", "close": "18:00" },
  "1": { "open": "09:00", "close": "20:00" },
  "2": { "open": "09:00", "close": "20:00" },
  "3": { "open": "09:00", "close": "20:00" },
  "4": { "open": "09:00", "close": "20:00" },
  "5": { "open": "09:00", "close": "20:00" },
  "6": { "open": "09:00", "close": "14:00" }
}
```

Chave = dia da semana: `0`=Dom · `1`=Seg · `2`=Ter · `3`=Qua · `4`=Qui · `5`=Sex · `6`=Sáb.
Dia ausente no objeto = fechado naquele dia.

### Coluna `status`

| Valor | Comportamento |
|---|---|
| `auto` | Calcula abertura pelo `hours_schedule` + `timezone` em tempo real |
| `open` | Força sempre aberta (ignora schedule) |
| `closed` | Força sempre fechada (ignora schedule) |

### Índices

| Índice | Tabela | Coluna(s) | Tipo |
|---|---|---|---|
| `idx_stores_name` | stores | name | B-tree |
| `idx_stores_category` | stores | category | B-tree |
| `idx_stores_city` | stores | city | B-tree |
| `idx_stores_state` | stores | state | B-tree |
| `idx_stores_status` | stores | status | B-tree |
| `idx_stores_lat_lng` | stores | lat, lng | B-tree |
| `idx_stores_schedule` | stores | hours_schedule | GIN (JSONB) |
| `idx_admins_username` | admins | username | B-tree |

### Trigger

`trg_stores_updated_at` → executa `fn_set_updated_at()` antes de cada `UPDATE` na tabela `stores`, mantendo `updated_at` sempre atualizado automaticamente.

### Views analíticas

| View | Descrição |
|---|---|
| `v_stores_summary` | Listagem leve das lojas (sem o campo JSONB de horários) |
| `v_category_stats` | Contagem de lojas por categoria, separada por modo de status |

---

## 6. Automação do banco

Todos os scripts em `scripts/` lêem o ambiente pelo flag `--env=` ou `NODE_ENV`, carregam o `.env` correspondente e conectam ao banco correto — sem precisar configurar nada manualmente.

### `setup-db.js` — criação completa

Executa 4 etapas em sequência:

```
[ 1/4 ] Verificando database
         Conecta em /postgres (banco padrão do PG).
         Se a database não existe, cria com UTF-8
         e locale pt_BR.UTF-8 (fallback automático
         se o locale não estiver disponível no SO).

[ 2/4 ] Aplicando schema.sql
         Executa o schema inteiro em uma transação.
         Se falhar em qualquer ponto → ROLLBACK total.
         Com --no-seed: remove o bloco INSERT antes
         de executar (útil para staging limpo).

[ 3/4 ] Configurando administrador padrão
         Gera hash bcrypt da senha definida em .env
         e insere o admin na tabela. Se já existe,
         não faz nada (idempotente).

[ 4/4 ] Relatório
         Exibe tabelas, views, triggers, total de
         índices e contagem de registros criados.
```

O script é **idempotente** — pode ser executado várias vezes sem criar duplicatas ou erros.

```bash
# Uso via npm
npm run setup:dev            # cria banco DEV com seed
npm run setup:prod           # cria banco PROD com seed
npm run setup:dev:fresh      # cria banco DEV sem dados de exemplo

# Uso direto com flags
node scripts/setup-db.js --env=dev
node scripts/setup-db.js --env=prod --no-seed    # sem dados de exemplo
node scripts/setup-db.js --env=dev  --no-admin   # sem criar admin padrão
node scripts/setup-db.js --env=dev  --verbose    # exibe o SQL executado
```

**Saída esperada:**

```
══════════════════════════════════════════════════════
  StoreFinder — Setup do Banco de Dados
══════════════════════════════════════════════════════
  Ambiente  : DEV
  Host      : localhost:5432
  Database  : storefinder_dev
  Schema    : schema.sql
  Seed      : ativado
  Admin     : ativado

[ 1/4 ] Verificando database
  ✔  Conectado em localhost:5432/postgres
  ✔  Database "storefinder_dev" criada com sucesso (UTF-8).

[ 2/4 ] Aplicando schema.sql
  ✔  schema.sql aplicado com sucesso.

[ 3/4 ] Configurando administrador padrão
  ✔  Admin "admin" criado (id=1).
  ⚠  Senha: admin123 — altere via painel ou PATCH /api/admins/:id/password

[ 4/4 ] Relatório
  Tabelas       stores   48 kB
                admins    8 kB
  Views         v_stores_summary
                v_category_stats
  Triggers      trg_stores_updated_at → stores (UPDATE)
  Índices       8 índices criados
  Registros     stores : 8 loja(s)
                admins : 1 admin(s)

══════════════════════════════════════════════════════
  ✔  Setup concluído com sucesso!
══════════════════════════════════════════════════════
```

---

### `check-db.js` — diagnóstico (somente leitura)

Inspeciona o estado do banco sem fazer nenhuma alteração. Útil para verificar se o setup foi aplicado corretamente ou para diagnóstico em produção.

```bash
npm run check:dev
npm run check:prod
```

Verifica e exibe:

- Versão do PostgreSQL e latência de conexão
- Tamanho da database e número de conexões ativas
- Lista de tabelas com tamanho e número de colunas
- **Integridade:** confirma presença das tabelas `stores` e `admins` e das colunas críticas (`hours_schedule`, `timezone`, `status`, `lat`, `lng` etc.)
- Lista completa de índices, triggers e views
- Contagem de lojas por categoria e por modo de status
- Lista de admins cadastrados com data de criação
- Resumo final: ✔ OK ou ✖ com instrução de correção

---

### `teardown-db.js` — reset completo (DEV/STAGING)

⚠️ **Destrói todos os dados.** Use apenas em ambientes não produtivos.

```bash
# Com confirmação interativa (digita o nome do banco para confirmar)
npm run reset:dev:ask

# Sem confirmação (para CI/CD)
npm run reset:dev

# Direto, com flags extras
node scripts/teardown-db.js --env=dev --force --no-seed
```

O script:
1. Bloqueia execução em PROD por padrão (use `--allow-prod` se souber o que está fazendo)
2. Pede para digitar o nome exato da database como confirmação (exceto com `--force`)
3. Encerra todas as conexões ativas na database alvo (evita erro de "banco em uso")
4. Executa `DROP DATABASE`
5. Chama `setup-db.js` automaticamente para recriar tudo

### Referência completa dos flags

| Flag | Aplica-se a | Efeito |
|---|---|---|
| `--env=dev\|prod\|staging` | todos | Seleciona o ambiente |
| `--no-seed` | `setup-db` | Pula o bloco de INSERT de dados de exemplo |
| `--no-admin` | `setup-db` | Pula a criação do admin padrão |
| `--verbose` | `setup-db` | Exibe o SQL sendo executado |
| `--force` | `teardown-db` | Pula a confirmação interativa |
| `--allow-prod` | `teardown-db` | Remove o bloqueio de PROD |

---

## 7. Inicialização do servidor

### Um ambiente por vez

```bash
npm run dev             # DEV  — porta 3000, .env.dev,  index-dev.html
npm run prod            # PROD — porta 8080, .env.prod, index-prod.html

npm run dev:watch       # DEV  com hot-reload (nodemon)
npm run prod:watch      # PROD com hot-reload (nodemon)
```

### Todos os ambientes em paralelo

```bash
npm run all             # sobe DEV + PROD simultaneamente
npm run all:watch       # idem com nodemon em ambos
npm run all:dev         # só DEV  (via start-all.js)
npm run all:prod        # só PROD (via start-all.js)
```

O `start-all.js` lança processos `node` independentes por ambiente. Os logs chegam ao mesmo terminal com **prefixo colorido** por ambiente:

```
 DEV:3000  [INFO] PostgreSQL → localhost:5432/storefinder_dev
 PROD:8080  [INFO] PostgreSQL → db.prod.com:5432/storefinder
 DEV:3000  [DEBUG] GET /api/stores
 PROD:8080  [INFO] Login: admin
```

**Ctrl+C** encerra todos os processos filhos com `SIGTERM`.

### Via argumento ou variável de ambiente

```bash
node server.js --env=dev
node server.js --env=prod
NODE_ENV=prod node server.js
```

### Referência de todos os scripts npm

| Script | Descrição |
|---|---|
| `npm start` | Inicia sem definir ambiente (usa o primeiro da lista) |
| `npm run dev` | Servidor DEV — porta 3000 |
| `npm run prod` | Servidor PROD — porta 8080 |
| `npm run dev:watch` | DEV com nodemon |
| `npm run prod:watch` | PROD com nodemon |
| `npm run all` | DEV + PROD em paralelo |
| `npm run all:watch` | DEV + PROD em paralelo com nodemon |
| `npm run setup:dev` | Cria e configura banco DEV |
| `npm run setup:prod` | Cria e configura banco PROD |
| `npm run setup:dev:fresh` | Banco DEV sem dados de exemplo |
| `npm run check:dev` | Diagnóstico do banco DEV |
| `npm run check:prod` | Diagnóstico do banco PROD |
| `npm run reset:dev` | Apaga e recria banco DEV (sem confirmar) |
| `npm run reset:dev:ask` | Apaga e recria banco DEV (pede confirmação) |

---

## 8. API REST

### Autenticação

Rotas de **escrita** exigem o header:

```
Authorization: Bearer <token>
```

O token é obtido via `POST /api/auth/login` e expira em **8 horas**. Mantido apenas em memória JS no frontend — nunca em `localStorage` ou `sessionStorage`.

### Referência completa

#### Meta

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/health` | — | Status do servidor e latência do banco |
| `GET` | `/api/env` | — | Info do ambiente *(bloqueado em PROD)* |

#### Autenticação

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Login → retorna `{ token, id, username, environment }` |
| `POST` | `/api/auth/verify` | JWT | Valida token ativo |

#### Lojas — leitura pública

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/stores` | — | Lista lojas com `is_open` calculado em tempo real |
| `GET` | `/api/stores/:id` | — | Detalhe de uma loja |
| `GET` | `/api/stores/:id/open-status` | — | Recalcula status de abertura agora |
| `GET` | `/api/categories` | — | Categorias distintas cadastradas |
| `GET` | `/api/stats` | — | Totais: lojas, abertas agora, categorias, cidades |

**Query params em `GET /api/stores`:**

```
?search=paulo        busca em nome, cidade, endereço e categoria (ILIKE)
?category=Moda       filtra por categoria exata
```

#### Lojas — escrita (admin)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/stores` | JWT | Criar loja |
| `PUT` | `/api/stores/:id` | JWT | Atualizar loja |
| `DELETE` | `/api/stores/:id` | JWT | Excluir loja |

**Body de criação/atualização:**

```json
{
  "name": "Loja Centro",
  "category": "Moda",
  "phone": "(11) 9 9999-9999",
  "address": "Av. Paulista, 1500",
  "city": "São Paulo",
  "state": "SP",
  "lat": -23.5613,
  "lng": -46.6558,
  "website": "https://loja.com",
  "description": "Descrição da loja",
  "status": "auto",
  "timezone": "America/Sao_Paulo",
  "hours_schedule": {
    "1": { "open": "09:00", "close": "18:00" },
    "2": { "open": "09:00", "close": "18:00" },
    "3": { "open": "09:00", "close": "18:00" },
    "4": { "open": "09:00", "close": "18:00" },
    "5": { "open": "09:00", "close": "18:00" },
    "6": { "open": "09:00", "close": "13:00" }
  }
}
```

#### Administradores

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/admins` | JWT | Lista admins (sem hash de senha) |
| `POST` | `/api/admins` | JWT | Criar admin |
| `PATCH` | `/api/admins/:id/password` | JWT | Alterar senha |
| `DELETE` | `/api/admins/:id` | JWT | Remover admin |

---

## 9. Detecção de horário

A função `computeIsOpen(schedule, timezone, status)` roda no **servidor** a cada requisição, usando a API `Intl.DateTimeFormat` nativa do Node.js — sem bibliotecas externas.

### Algoritmo

```
status = 'open'   → retorna sempre aberta  (ignora schedule)
status = 'closed' → retorna sempre fechada (ignora schedule)
status = 'auto'   →
  1. Converte new Date() para o timezone da loja
     ex: America/Manaus em vez de America/Sao_Paulo
  2. Obtém dia da semana (0–6) e minutos desde meia-noite
  3. Consulta hours_schedule[dia_atual]
  4. Se minuto_atual ∈ [open_min, close_min) → ABERTA
  5. Caso fechada: varre os próximos 7 dias buscando
     a próxima abertura e monta a mensagem de evento
```

### Campos retornados em cada loja

| Campo | Tipo | Exemplos |
|---|---|---|
| `is_open` | `boolean \| null` | `true`, `false`, `null` (sem config) |
| `status_label` | `string` | `"Aberta agora"`, `"Fecha em 12 min"`, `"Abre amanhã às 09:00"` |
| `next_event` | `string \| null` | `"Fecha às 18:00"`, `"Abre terça às 09:00"` |
| `closes_at` | `string \| null` | `"18:00"` (se aberta agora) |
| `opens_at` | `string \| null` | `"09:00"` (próxima abertura) |
| `opens_in_day` | `number \| null` | `0` = hoje, `1` = amanhã, `2`+ = dias até abrir |

### Timezones suportados no frontend

| Timezone IANA | Sigla |
|---|---|
| `America/Sao_Paulo` | BRT (UTC-3) |
| `America/Manaus` | AMT (UTC-4) |
| `America/Belem` | BRT (UTC-3) |
| `America/Fortaleza` | BRT (UTC-3) |
| `America/Recife` | BRT (UTC-3) |
| `America/Bahia` | BRT (UTC-3) |
| `America/Campo_Grande` | AMST (UTC-4) |
| `America/Cuiaba` | AMST (UTC-4) |
| `America/Porto_Velho` | AMT (UTC-4) |
| `America/Boa_Vista` | AMT (UTC-4) |
| `America/Rio_Branco` | ACT (UTC-5) |
| `America/Noronha` | FNT (UTC-2) |
| `UTC` | UTC |

Qualquer timezone IANA válido funciona no backend — a lista acima é apenas o que aparece no seletor do formulário de edição.

---

## 10. Funcionalidades do frontend

### Área pública (sem login)

- Mapa interativo com OpenStreetMap via Leaflet — gratuito, sem API key
- Marcadores coloridos por categoria com ponto interno indicando status em tempo real (verde/vermelho/cinza)
- Busca em tempo real — filtra por nome, cidade, endereço ou categoria com debounce de 350 ms
- Filtros por categoria — chips dinâmicos gerados com base nas categorias cadastradas no banco
- Status de abertura ao vivo — pill colorido com animação pulse quando aberta
- Mensagem de próximo evento — "Fecha às 18:00", "Abre amanhã às 09:00", "Fecha em 12 min"
- Painel de detalhes lateral — horário da semana inteira com destaque do dia atual no timezone da loja
- Popup no mapa — endereço, telefone, horário, status e link para o site ao clicar no marcador
- Badge de conexão com PostgreSQL — indicador visual no topo
- Polling automático a cada 5 minutos para atualizar status sem recarregar a página

### Área administrativa (requer login JWT)

- Dashboard com 4 contadores: total de lojas, abertas agora, categorias, cidades
- Tabela de lojas com status calculado em tempo real e coluna de próximo evento
- CRUD completo de lojas via modal
- Editor visual de horários — toggle liga/desliga por dia, inputs de hora nativos, preview do timezone ("Agora: segunda, 14:32")
- Três modos de operação por loja: Sempre aberta / Por horário / Sempre fechada
- Gerenciamento de administradores: criar, alterar senha, remover
- Botão "Minha Senha" na barra de navegação para troca da própria senha
- Aba separada para listagem e gestão de admins

### Diferença entre os HTMLs

| | `index-dev.html` | `index-prod.html` |
|---|---|---|
| Título da aba | `[DEV] StoreFinder` | `StoreFinder` |
| Painel de debug | ✅ fixo no rodapé | ❌ |
| Log de requests interceptados | ✅ (intercepta `fetch()`) | ❌ |
| Endpoint `/api/env` | ✅ consumido | ❌ (404 no servidor) |
| Headers `X-Environment` | ✅ | ❌ |

O painel DEV exibe em tempo real: ambiente, porta, banco (host/name/pool/latência), stats de lojas e log das últimas 15 requisições com método, status HTTP e tempo de resposta. Atualiza a cada 15 s.

---

## 11. Gerenciamento de administradores

### Criar admin

```bash
curl -X POST http://localhost:3000/api/admins \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"username":"novoAdmin","password":"senha123"}'
```

### Alterar senha — regras por contexto

O endpoint `PATCH /api/admins/:id/password` aplica regras diferentes conforme quem faz a requisição:

| Contexto | `current_password` | Comportamento |
|---|---|---|
| Própria senha | **Obrigatório** | Valida senha atual antes de trocar; nova não pode ser igual à atual |
| Senha de outro admin | Não enviado | Troca diretamente (ação administrativa) |

```bash
# Própria conta — exige senha atual
curl -X PATCH http://localhost:3000/api/admins/1/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"current_password":"admin123","new_password":"novaSenha@456"}'

# Redefinição administrativa — sem senha atual
curl -X PATCH http://localhost:3000/api/admins/2/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"new_password":"senhaNova@789"}'
```

**Validações aplicadas em ambos os casos:**
- `new_password` obrigatório, mínimo 6 caracteres
- Na própria conta: `current_password` obrigatório e deve estar correto
- Na própria conta: nova senha não pode ser idêntica à atual

**No modal do frontend:** barra de força da senha em 5 níveis com cor e texto, confirmação com feedback visual em tempo real, toggle para mostrar/ocultar cada campo.

### Remover admin

```bash
curl -X DELETE http://localhost:3000/api/admins/2 \
  -H "Authorization: Bearer <token>"
```

> Um admin não pode excluir a si mesmo.

---

## 12. Segurança

| Mecanismo | Implementação |
|---|---|
| Hash de senhas | bcrypt com salt rounds = 10 |
| Autenticação | JWT HS256, expiração em 8 h |
| Token no cliente | Apenas em variável JS em memória — perdido ao fechar a aba |
| Stack trace | Exposto apenas em DEV (`stackTrace: true`) |
| `/api/env` | Retorna 404 em PROD |
| CORS | `*` em DEV; lista restrita via `CORS_ORIGIN` em PROD |
| Trust proxy | Desativado em DEV; ativado em PROD (para IP real atrás de Nginx) |
| Teardown de PROD | Bloqueado por padrão em `teardown-db.js` |
| Graceful shutdown | `SIGTERM`/`SIGINT` fecham o pool do banco antes de encerrar |

**Arquivos que nunca devem ir para o repositório** (já no `.gitignore`):

```
.env.dev
.env.prod
.env.staging
```

---

## 13. Adicionar novo ambiente

Edite apenas **`config/environments.js`** — todos os outros arquivos (`server.js`, `start-all.js`, `scripts/`) se adaptam automaticamente:

```js
const ENVIRONMENTS = [
  { name:'DEV',  port:3000, envFile:'.env.dev',     html:'index-dev.html',     options:{ ... } },
  { name:'PROD', port:8080, envFile:'.env.prod',    html:'index-prod.html',    options:{ ... } },

  // Adicione aqui ↓
  {
    name:    'STAGING',
    port:    4000,
    envFile: '.env.staging',
    html:    'index-staging.html',
    options: {
      logLevel:       'normal',
      prettyJson:     true,
      stackTrace:     true,
      corsOrigins:    'https://staging.seudomain.com',
      trustProxy:     true,
      enableDevHints: false,
    },
  },
];
```

```bash
# Crie os arquivos do novo ambiente
cp .env.example .env.staging
cp public/index-prod.html public/index-staging.html

# Configure e suba o banco
node scripts/setup-db.js --env=staging

# Inicie
node server.js --env=staging

# Ou em paralelo com os demais
npm run all     # sobe DEV + PROD + STAGING automaticamente
```

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 18+ |
| Framework HTTP | Express 4 |
| Banco de dados | PostgreSQL 14+ (driver `pg` com pool de conexões) |
| Autenticação | JWT `jsonwebtoken` + hash `bcryptjs` |
| Configuração | `dotenv` — arquivo `.env` por ambiente |
| CORS | pacote `cors` |
| Mapa | Leaflet 1.9 + OpenStreetMap — gratuito, sem API key |
| Detecção de horário | `Intl.DateTimeFormat` nativo do Node.js, sem dependências externas |
| Frontend | HTML5 + CSS3 + JavaScript puro, sem frameworks |
| Hot-reload | `nodemon` (devDependency) |
