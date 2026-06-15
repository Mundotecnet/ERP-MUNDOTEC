#!/usr/bin/env ts-node
/**
 * Verifica que las tablas modeladas en `apps/api/prisma/schema.prisma` coincidan
 * exactamente con `db/erp_schema.sql`.
 *
 * Approach:
 *   1. Lee la lista de tablas modeladas (extraídas de los @@map del schema Prisma).
 *   2. Carga las migraciones Prisma en el schema temporal `_drift_prisma`.
 *   3. Carga `db/erp_schema.sql` en el schema temporal `_drift_canon`.
 *   4. Compara columna a columna (nombre, tipo, tamaño, precision, nullable, default)
 *      via information_schema sólo para las tablas modeladas.
 *   5. Falla si hay diferencias. Limpia los schemas temporales siempre.
 *
 * Variables de entorno:
 *   - DATABASE_URL: conexión a una DB PostgreSQL donde el usuario pueda crear/borrar
 *     schemas (no tiene que estar vacía; el script aísla todo en schemas temporales).
 *
 * Uso:
 *   pnpm db:check-drift
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

const REPO_ROOT = join(__dirname, '..');
const SCHEMA_PRISMA = join(REPO_ROOT, 'apps/api/prisma/schema.prisma');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/api/prisma/migrations');
const ERP_SCHEMA_SQL = join(REPO_ROOT, 'db/erp_schema.sql');

const PRISMA_SCHEMA = '_drift_prisma';
const CANON_SCHEMA = '_drift_canon';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: 'YES' | 'NO';
  is_identity: 'YES' | 'NO';
  column_default: string | null;
}

function extractModeledTables(): string[] {
  const content = readFileSync(SCHEMA_PRISMA, 'utf8');
  const tables: string[] = [];
  const regex = /@@map\("([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    tables.push(m[1]);
  }
  return tables.sort();
}

function readMigrations(): string {
  if (!existsSync(MIGRATIONS_DIR)) return '';
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return dirs
    .map((d) => readFileSync(join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8'))
    .join('\n\n');
}

function readCanonical(): string {
  return readFileSync(ERP_SCHEMA_SQL, 'utf8');
}

function stripGlobalStatements(sql: string): string {
  // CREATE EXTENSION es global; no se puede ejecutar dentro de un schema temporal
  // con un usuario sin privilegios. El núcleo no usa funciones de esas extensiones,
  // así que es seguro removerlas para la verificación de drift.
  return sql.replace(/CREATE\s+EXTENSION[^;]+;/gi, '');
}

async function setup(client: Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS "${PRISMA_SCHEMA}" CASCADE`);
  await client.query(`DROP SCHEMA IF EXISTS "${CANON_SCHEMA}" CASCADE`);
  await client.query(`CREATE SCHEMA "${PRISMA_SCHEMA}"`);
  await client.query(`CREATE SCHEMA "${CANON_SCHEMA}"`);
}

async function teardown(client: Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS "${PRISMA_SCHEMA}" CASCADE`);
  await client.query(`DROP SCHEMA IF EXISTS "${CANON_SCHEMA}" CASCADE`);
}

async function loadInto(client: Client, schema: string, sql: string): Promise<void> {
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(stripGlobalStatements(sql));
}

async function describeTable(
  client: Client,
  schema: string,
  table: string,
): Promise<ColumnInfo[] | null> {
  const result = await client.query<ColumnInfo>(
    `SELECT column_name, data_type, character_maximum_length, numeric_precision,
            numeric_scale, is_nullable, is_identity, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table],
  );
  return result.rows.length > 0 ? result.rows : null;
}

function normalizeAutoIncrement(col: ColumnInfo): string | null {
  // Prisma genera BIGSERIAL → default nextval(...). erp_schema.sql usa
  // BIGINT GENERATED ALWAYS AS IDENTITY → is_identity = YES, sin default.
  // Tratamos ambos como "auto-increment" para no detectar drift falso.
  if (col.is_identity === 'YES') return 'AUTO_INCREMENT';
  if (col.column_default && /^nextval\(.+::regclass\)$/.test(col.column_default)) {
    return 'AUTO_INCREMENT';
  }
  return col.column_default;
}

function normalizeDefault(col: ColumnInfo): string | null {
  const auto = normalizeAutoIncrement(col);
  if (auto === 'AUTO_INCREMENT') return auto;
  if (auto === null) return null;
  // now() y CURRENT_TIMESTAMP son equivalentes en PostgreSQL.
  if (/^(now\(\)|CURRENT_TIMESTAMP)/i.test(auto)) return 'now()';
  // Normalizar literales con cast: 'USD'::bpchar → 'USD'.
  return auto.replace(/::\w+(\(\d+(,\d+)?\))?/g, '').trim();
}

function compareTable(prisma: ColumnInfo[], canon: ColumnInfo[]): string[] {
  const diffs: string[] = [];
  const prismaByName = new Map(prisma.map((c) => [c.column_name, c]));
  const canonByName = new Map(canon.map((c) => [c.column_name, c]));

  for (const [name, p] of prismaByName) {
    const c = canonByName.get(name);
    if (!c) {
      diffs.push(`columna "${name}" presente en Prisma pero no en erp_schema.sql`);
      continue;
    }
    if (p.data_type !== c.data_type) {
      diffs.push(`columna "${name}": data_type prisma=${p.data_type} vs canon=${c.data_type}`);
    }
    if (p.character_maximum_length !== c.character_maximum_length) {
      diffs.push(
        `columna "${name}": max length prisma=${p.character_maximum_length} vs canon=${c.character_maximum_length}`,
      );
    }
    if (p.numeric_precision !== c.numeric_precision || p.numeric_scale !== c.numeric_scale) {
      diffs.push(
        `columna "${name}": numeric prisma=(${p.numeric_precision},${p.numeric_scale}) vs canon=(${c.numeric_precision},${c.numeric_scale})`,
      );
    }
    if (p.is_nullable !== c.is_nullable) {
      diffs.push(`columna "${name}": nullable prisma=${p.is_nullable} vs canon=${c.is_nullable}`);
    }
    const pd = normalizeDefault(p);
    const cd = normalizeDefault(c);
    if (pd !== cd) {
      diffs.push(`columna "${name}": default prisma=${pd} vs canon=${cd}`);
    }
  }
  for (const [name] of canonByName) {
    if (!prismaByName.has(name)) {
      diffs.push(`columna "${name}" presente en erp_schema.sql pero no en Prisma`);
    }
  }
  return diffs;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL no está definido. Apunta a una DB Postgres accesible.');
    process.exit(2);
  }

  const tables = extractModeledTables();
  console.log(`▸ Verificando ${tables.length} tablas modeladas contra db/erp_schema.sql`);
  console.log(`  ${tables.join(', ')}\n`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  let ok = true;
  try {
    await setup(client);
    await loadInto(client, PRISMA_SCHEMA, readMigrations());
    await loadInto(client, CANON_SCHEMA, readCanonical());

    for (const table of tables) {
      const p = await describeTable(client, PRISMA_SCHEMA, table);
      const c = await describeTable(client, CANON_SCHEMA, table);
      if (!p) {
        console.error(`  ✗ ${table}: no existe en las migraciones Prisma`);
        ok = false;
        continue;
      }
      if (!c) {
        console.error(`  ✗ ${table}: no existe en db/erp_schema.sql`);
        ok = false;
        continue;
      }
      const diffs = compareTable(p, c);
      if (diffs.length === 0) {
        console.log(`  ✓ ${table}`);
      } else {
        ok = false;
        console.error(`  ✗ ${table}`);
        for (const d of diffs) console.error(`     - ${d}`);
      }
    }
  } finally {
    await teardown(client);
    await client.end();
  }

  if (!ok) {
    console.error(
      '\n▸ Drift detectado. Sincroniza db/erp_schema.sql y apps/api/prisma/schema.prisma antes de mergear.',
    );
    process.exit(1);
  }
  console.log('\n▸ OK: sin drift en las tablas modeladas.');
}

main().catch((err) => {
  console.error('check-schema-drift falló:', err);
  process.exit(2);
});
