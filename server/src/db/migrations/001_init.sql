CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id BIGINT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  avatar_url TEXT,
  access_token_enc BYTEA,
  token_key_id SMALLINT NOT NULL DEFAULT 1,
  granted_scopes TEXT NOT NULL DEFAULT '',
  ai_notice_ack_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_session_expire ON session (expire);

CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  github_repo_id BIGINT,
  owner TEXT NOT NULL,            -- stored lowercase
  name TEXT NOT NULL,             -- stored lowercase
  display_name TEXT NOT NULL,     -- "Owner/Name" as GitHub returns it
  default_branch TEXT NOT NULL,
  commit_sha TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'analyzing', 'ready', 'failed')),
  file_count INT,
  edge_count INT,
  language_summary JSONB,
  ingestion_ms INT,
  last_ingested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, owner, name)
);

CREATE TABLE ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('initial', 'resync')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  phase TEXT CHECK (phase IN ('fetching', 'extracting', 'parsing', 'resolving', 'persisting')),
  files_total INT,
  files_processed INT NOT NULL DEFAULT 0,
  files_skipped INT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_jobs_repo ON ingestion_jobs (repository_id, created_at DESC);
CREATE UNIQUE INDEX one_active_job_per_repo
  ON ingestion_jobs (repository_id) WHERE status IN ('queued', 'running');

CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_ltree LTREE NOT NULL,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('file', 'folder')),
  language TEXT,
  content_hash TEXT,
  size_bytes INT,
  exports TEXT[],
  metrics JSONB NOT NULL DEFAULT '{}',
  UNIQUE (repository_id, path),
  UNIQUE (repository_id, id)
);
CREATE INDEX idx_nodes_path_ltree ON nodes USING GIST (path_ltree);

CREATE TABLE edges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL,
  target_node_id UUID NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'import',
  FOREIGN KEY (repository_id, source_node_id)
    REFERENCES nodes (repository_id, id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, target_node_id)
    REFERENCES nodes (repository_id, id) ON DELETE CASCADE,
  CHECK (source_node_id <> target_node_id),
  UNIQUE (source_node_id, target_node_id, edge_type)
);
CREATE INDEX idx_edges_source ON edges (source_node_id);
CREATE INDEX idx_edges_target ON edges (target_node_id);

CREATE TABLE unresolved_imports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_node_id UUID NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  raw_specifier TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX idx_unresolved_source ON unresolved_imports (source_node_id);

CREATE TABLE ai_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  target_path TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL
    CHECK (mode IN ('blast_radius', 'summary', 'intent_search', 'change_plan')),
  input_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, mode, target_path, input_hash)
);

CREATE TABLE ai_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  ai_result_id UUID REFERENCES ai_results (id) ON DELETE SET NULL,
  session_id_hash TEXT,
  mode TEXT NOT NULL,
  target_path TEXT,
  input_hash TEXT NOT NULL,
  cache_hit BOOLEAN NOT NULL,
  model TEXT,                 -- model that produced the answer; NULL for cache hits, short-circuits and total failures
  attempts SMALLINT NOT NULL DEFAULT 0,  -- number of Gemini calls made (0 for cache hits)
  outcome TEXT NOT NULL
    CHECK (outcome IN ('success', 'quota_exceeded', 'timeout', 'malformed_output', 'network_error')),
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_repo ON ai_audit_log (repository_id, created_at DESC);
