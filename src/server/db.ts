import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://ultradev:ultradev@localhost:5432/ultradev',
})

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      repo_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      column_id TEXT NOT NULL DEFAULT 'backlog' CHECK(column_id IN ('backlog', 'assigned', 'working', 'pr', 'merged')),
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      github_url TEXT DEFAULT '',
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cronjobs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT '* * * * *',
      description TEXT DEFAULT '',
      command TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
      last_run TIMESTAMPTZ,
      next_run TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_cronjobs (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      cronjob_id INTEGER NOT NULL REFERENCES cronjobs(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, cronjob_id)
    );
  `)
}

export default pool
