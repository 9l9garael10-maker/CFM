-- ...existing code...
/*
  Migração compatível com PostgreSQL para Render (sem partes SQLite).
  Evita CREATE INDEX IF NOT EXISTS problemático e protege CREATE EXTENSION.
*/

-- tentar criar extensão (silencia erro se não for permitida)
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'uuid-ossp not available or permission denied - continuing without it';
  END;
END;
$$;

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  currency CHAR(3) DEFAULT 'BRL',
  theme TEXT,
  pin_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de categorias
CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  user_email TEXT REFERENCES users(email) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  icone TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  custom BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de transações
CREATE TABLE IF NOT EXISTS transacoes (
  id BIGINT PRIMARY KEY,
  uuid UUID,
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  descricao TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  data DATE NOT NULL,
  categoria_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  deleted BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- FK categoria (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'transacoes' AND kcu.column_name = 'categoria_id'
  ) THEN
    ALTER TABLE transacoes
      ADD CONSTRAINT fk_categoria
      FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'fk_categoria may already exist or cannot be created: %', SQLERRM;
END;
$$;

-- Função e trigger updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp ON transacoes;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON transacoes
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Índices (usar DROP IF EXISTS + CREATE para evitar IF NOT EXISTS em CREATE INDEX)
DROP INDEX IF EXISTS idx_transacoes_user_date;
CREATE INDEX idx_transacoes_user_date ON transacoes (user_email, data);

DROP INDEX IF EXISTS idx_transacoes_user_tipo;
CREATE INDEX idx_transacoes_user_tipo ON transacoes (user_email, tipo);

DROP INDEX IF EXISTS idx_transacoes_categoria;
CREATE INDEX idx_transacoes_categoria ON transacoes (categoria_id);

DROP INDEX IF EXISTS idx_transacoes_ts;
CREATE INDEX idx_transacoes_ts ON transacoes (timestamp);
-- ...existing code...