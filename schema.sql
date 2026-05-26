-- ═══════════════════════════════════════════════════════════════════
--  Busque Aqui — Schema Completo do Banco de Dados
--
--  Criado em: 05/2026
--  Versão:    2.0  (inclui horários estruturados + multiambiente)
--
--  Este arquivo é idempotente:
--  pode ser executado múltiplas vezes sem erros ou duplicatas.
--
--  Uso direto:
--    psql -U <user> -d <database> -f schema.sql
--
--  Uso via automação (recomendado):
--    node scripts/setup-db.js --env=dev
--    node scripts/setup-db.js --env=prod
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
--  BLOCO 1 — FUNÇÃO COMPARTILHADA: updated_at automático
--
--  Criada antes das tabelas pois é referenciada pelos triggers.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_set_updated_at() IS
    'Atualiza automaticamente updated_at antes de qualquer UPDATE. '
    'Utilizada pelos triggers das tabelas que possuem este campo.';


-- ───────────────────────────────────────────────────────────────────
--  BLOCO 2 — TABELA: stores
--
--  Armazena todas as lojas cadastradas no sistema.
--  O campo hours_schedule é um JSONB com a grade de horários
--  por dia da semana. O campo status controla o modo de operação.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stores (

    -- Identificação
    id              SERIAL          PRIMARY KEY,
    name            VARCHAR(150)    NOT NULL,
    category        VARCHAR(80)     NOT NULL,

    -- Contato
    phone           VARCHAR(30),
    website         VARCHAR(300),
    description     TEXT,

    -- Localização
    address         VARCHAR(200),
    city            VARCHAR(100),
    state           CHAR(2),
    lat             DOUBLE PRECISION    NOT NULL,
    lng             DOUBLE PRECISION    NOT NULL,

    -- Horário (texto livre — legado / exibição simples)
    hours           VARCHAR(150),

    -- Horário estruturado por dia da semana (JSONB)
    --   Chave  : número do dia  0=Dom  1=Seg  2=Ter  3=Qua  4=Qui  5=Sex  6=Sáb
    --   Valor  : {"open":"HH:MM","close":"HH:MM"}
    --   Ausente: dia fechado
    --   Exemplo: {"1":{"open":"09:00","close":"18:00"},"6":{"open":"09:00","close":"13:00"}}
    hours_schedule  JSONB,

    -- Timezone IANA da loja para cálculo correto do horário local
    --   Exemplos: America/Sao_Paulo · America/Manaus · America/Fortaleza · UTC
    timezone        VARCHAR(60)     NOT NULL DEFAULT 'America/Sao_Paulo',

    -- Modo de operação:
    --   auto   → calcula abertura pelo hours_schedule + timezone (recomendado)
    --   open   → força sempre aberta  (ignora hours_schedule)
    --   closed → força sempre fechada (ignora hours_schedule)
    status          VARCHAR(10)     NOT NULL DEFAULT 'auto'
                        CONSTRAINT stores_status_check
                        CHECK (status IN ('open', 'closed', 'auto')),

    -- Auditoria
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Índices para acelerar as buscas mais comuns
CREATE INDEX IF NOT EXISTS idx_stores_name      ON stores (name);
CREATE INDEX IF NOT EXISTS idx_stores_category  ON stores (category);
CREATE INDEX IF NOT EXISTS idx_stores_city      ON stores (city);
CREATE INDEX IF NOT EXISTS idx_stores_state     ON stores (state);
CREATE INDEX IF NOT EXISTS idx_stores_status    ON stores (status);
CREATE INDEX IF NOT EXISTS idx_stores_lat_lng   ON stores (lat, lng);

-- Índice GIN para buscas full-text dentro do JSONB de horários
CREATE INDEX IF NOT EXISTS idx_stores_schedule  ON stores USING GIN (hours_schedule);

-- Trigger: atualiza updated_at em todo UPDATE
DROP TRIGGER IF EXISTS trg_stores_updated_at ON stores;
CREATE TRIGGER trg_stores_updated_at
    BEFORE UPDATE ON stores
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();

-- Comentários das colunas (ficam visíveis em ferramentas como DBeaver/pgAdmin)
COMMENT ON TABLE  stores                    IS 'Lojas cadastradas no Busque Aqui.';
COMMENT ON COLUMN stores.id                 IS 'Identificador único auto-incrementado.';
COMMENT ON COLUMN stores.name               IS 'Nome comercial da loja.';
COMMENT ON COLUMN stores.category           IS 'Categoria: Moda, Eletrônicos, Alimentos, etc.';
COMMENT ON COLUMN stores.lat                IS 'Latitude WGS-84 para posicionamento no mapa.';
COMMENT ON COLUMN stores.lng                IS 'Longitude WGS-84 para posicionamento no mapa.';
COMMENT ON COLUMN stores.hours              IS 'Horário em texto livre (ex: "Seg-Sex: 9h–18h"). Campo legado.';
COMMENT ON COLUMN stores.hours_schedule     IS 'Grade de horários por dia da semana em JSONB. Chave = 0..6 (Dom..Sáb). Dia ausente = fechado.';
COMMENT ON COLUMN stores.timezone           IS 'Timezone IANA. Usado por computeIsOpen() no servidor para calcular abertura no horário local da loja.';
COMMENT ON COLUMN stores.status             IS 'auto=usa schedule | open=força aberta | closed=força fechada.';
COMMENT ON COLUMN stores.created_at         IS 'Data/hora de criação (UTC).';
COMMENT ON COLUMN stores.updated_at         IS 'Data/hora da última atualização (UTC). Mantida pelo trigger trg_stores_updated_at.';


-- ───────────────────────────────────────────────────────────────────
--  BLOCO 3 — TABELA: admins
--
--  Armazena os usuários administrativos do sistema.
--  Senhas sempre armazenadas como hash bcrypt (salt 10).
--  O admin padrão é criado automaticamente pelo servidor Node.js
--  na inicialização (via ensureAdmin()), mas pode ser inserido
--  aqui manualmente para bootstrapping.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admins (
    id              SERIAL          PRIMARY KEY,
    username        VARCHAR(60)     NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,     -- bcrypt $2b$ hash, sempre 60 chars
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Índice para login (lookup por username)
CREATE INDEX IF NOT EXISTS idx_admins_username ON admins (username);

COMMENT ON TABLE  admins                    IS 'Administradores com acesso ao painel de gestão.';
COMMENT ON COLUMN admins.id                 IS 'Identificador único.';
COMMENT ON COLUMN admins.username           IS 'Nome de usuário único para login.';
COMMENT ON COLUMN admins.password_hash      IS 'Hash bcrypt da senha (salt rounds = 10). NUNCA armazenar senha em texto puro.';
COMMENT ON COLUMN admins.created_at         IS 'Data/hora de criação do admin (UTC).';


-- ───────────────────────────────────────────────────────────────────
--  BLOCO 4 — DADOS DE EXEMPLO (seed)
--
--  Inseridos apenas se a tabela estiver vazia.
--  ON CONFLICT DO NOTHING garante idempotência.
--
--  status = 'auto' + hours_schedule = grade por dia da semana
--  O servidor calcula is_open em tempo real via computeIsOpen().
-- ───────────────────────────────────────────────────────────────────

INSERT INTO stores (
    name, category, phone, address, city, state, lat, lng,
    hours, hours_schedule, timezone, status, website, description
) VALUES

-- São Paulo
(
    'Moda Paulista', 'Moda', '(11) 3333-1111',
    'Av. Paulista, 1500', 'São Paulo', 'SP',
    -23.5613, -46.6558,
    'Seg-Sáb: 9h–20h',
    '{"1":{"open":"09:00","close":"20:00"},"2":{"open":"09:00","close":"20:00"},"3":{"open":"09:00","close":"20:00"},"4":{"open":"09:00","close":"20:00"},"5":{"open":"09:00","close":"20:00"},"6":{"open":"09:00","close":"20:00"}}',
    'America/Sao_Paulo', 'auto',
    'https://modapaulista.com.br',
    'Roupas femininas e masculinas com as últimas tendências.'
),
(
    'Tech World', 'Eletrônicos', '(11) 4444-2222',
    'R. da Consolação, 800', 'São Paulo', 'SP',
    -23.5529, -46.6594,
    'Seg-Dom: 10h–22h',
    '{"0":{"open":"10:00","close":"22:00"},"1":{"open":"10:00","close":"22:00"},"2":{"open":"10:00","close":"22:00"},"3":{"open":"10:00","close":"22:00"},"4":{"open":"10:00","close":"22:00"},"5":{"open":"10:00","close":"22:00"},"6":{"open":"10:00","close":"22:00"}}',
    'America/Sao_Paulo', 'auto',
    NULL,
    'Eletrônicos, smartphones e gadgets com os melhores preços.'
),

-- Rio de Janeiro
(
    'Sabor & Cia', 'Alimentos', '(21) 5555-3333',
    'R. do Catete, 200', 'Rio de Janeiro', 'RJ',
    -22.9254, -43.1742,
    'Diário: 7h–23h',
    '{"0":{"open":"07:00","close":"23:00"},"1":{"open":"07:00","close":"23:00"},"2":{"open":"07:00","close":"23:00"},"3":{"open":"07:00","close":"23:00"},"4":{"open":"07:00","close":"23:00"},"5":{"open":"07:00","close":"23:00"},"6":{"open":"07:00","close":"23:00"}}',
    'America/Sao_Paulo', 'auto',
    NULL,
    'Delicatessen com produtos importados e nacionais.'
),

-- Belo Horizonte
(
    'Casa Bonita', 'Casa & Decoração', '(31) 6666-4444',
    'Av. Afonso Pena, 1000', 'Belo Horizonte', 'MG',
    -19.9227, -43.9451,
    'Seg-Sex: 9h–18h',
    '{"1":{"open":"09:00","close":"18:00"},"2":{"open":"09:00","close":"18:00"},"3":{"open":"09:00","close":"18:00"},"4":{"open":"09:00","close":"18:00"},"5":{"open":"09:00","close":"18:00"}}',
    'America/Sao_Paulo', 'auto',
    'https://casabonita.com',
    'Móveis e decoração para todos os estilos.'
),

-- Curitiba
(
    'FitSport', 'Esportes', '(41) 7777-5555',
    'R. das Flores, 350', 'Curitiba', 'PR',
    -25.4290, -49.2733,
    'Seg-Sáb: 8h–20h',
    '{"1":{"open":"08:00","close":"20:00"},"2":{"open":"08:00","close":"20:00"},"3":{"open":"08:00","close":"20:00"},"4":{"open":"08:00","close":"20:00"},"5":{"open":"08:00","close":"20:00"},"6":{"open":"08:00","close":"16:00"}}',
    'America/Sao_Paulo', 'auto',
    NULL,
    'Artigos esportivos para atletas de todos os níveis.'
),

-- Porto Alegre
(
    'Livraria Mundo', 'Livraria', '(51) 8888-6666',
    'R. dos Andradas, 1100', 'Porto Alegre', 'RS',
    -30.0277, -51.2287,
    'Seg-Dom: 9h–21h',
    '{"0":{"open":"09:00","close":"21:00"},"1":{"open":"09:00","close":"21:00"},"2":{"open":"09:00","close":"21:00"},"3":{"open":"09:00","close":"21:00"},"4":{"open":"09:00","close":"21:00"},"5":{"open":"09:00","close":"21:00"},"6":{"open":"09:00","close":"21:00"}}',
    'America/Sao_Paulo', 'auto',
    NULL,
    'Mais de 50.000 títulos nacionais e importados.'
),

-- Fortaleza (timezone diferente!)
(
    'BeautySalon', 'Saúde & Beleza', '(85) 9999-7777',
    'Av. Beira Mar, 3000', 'Fortaleza', 'CE',
    -3.7319, -38.5267,
    'Ter-Sáb: 8h–19h',
    '{"2":{"open":"08:00","close":"19:00"},"3":{"open":"08:00","close":"19:00"},"4":{"open":"08:00","close":"19:00"},"5":{"open":"08:00","close":"19:00"},"6":{"open":"08:00","close":"19:00"}}',
    'America/Fortaleza', 'auto',
    NULL,
    'Salão completo com tratamentos capilares e estética.'
),

-- Manaus (fuso UTC-4)
(
    'Amazônia Pet Shop', 'Pet Shop', '(92) 1111-8888',
    'Av. Djalma Batista, 500', 'Manaus', 'AM',
    -3.1190, -60.0217,
    'Seg-Sex: 8h–18h, Sáb: 8h–12h',
    '{"1":{"open":"08:00","close":"18:00"},"2":{"open":"08:00","close":"18:00"},"3":{"open":"08:00","close":"18:00"},"4":{"open":"08:00","close":"18:00"},"5":{"open":"08:00","close":"18:00"},"6":{"open":"08:00","close":"12:00"}}',
    'America/Manaus', 'auto',
    NULL,
    'Tudo para o seu pet: rações, acessórios e banho & tosa.'
)

ON CONFLICT DO NOTHING;


-- ───────────────────────────────────────────────────────────────────
--  BLOCO 5 — VIEWS úteis (opcionais, para queries rápidas)
-- ───────────────────────────────────────────────────────────────────

-- View: resumo das lojas sem o schedule (mais leve para listagens simples)
CREATE OR REPLACE VIEW v_stores_summary AS
SELECT
    id, name, category, phone, city, state,
    lat, lng, status, timezone,
    website, created_at, updated_at
FROM stores
ORDER BY name;

COMMENT ON VIEW v_stores_summary IS 'Visão resumida das lojas sem o JSONB de horários.';

-- View: contadores por categoria
CREATE OR REPLACE VIEW v_category_stats AS
SELECT
    category,
    COUNT(*)                                        AS total,
    COUNT(*) FILTER (WHERE status = 'open')         AS always_open,
    COUNT(*) FILTER (WHERE status = 'closed')       AS always_closed,
    COUNT(*) FILTER (WHERE status = 'auto')         AS schedule_based
FROM stores
GROUP BY category
ORDER BY total DESC;

COMMENT ON VIEW v_category_stats IS 'Estatísticas de lojas agrupadas por categoria.';


-- ───────────────────────────────────────────────────────────────────
--  FIM DO SCHEMA
-- ───────────────────────────────────────────────────────────────────
