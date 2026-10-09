// Runtime configuration. Everything comes from environment variables so the same image runs
// against the bundled database (docker-compose) or any external Bolt/openCypher endpoint.

function parseAuth(raw) {
  // NEO4J_AUTH is "user/password" (or "none").
  if (!raw || raw === 'none') return null;
  const i = raw.indexOf('/');
  if (i < 0) return null;
  return { username: raw.slice(0, i), password: raw.slice(i + 1) };
}

export function loadConfig(env = process.env) {
  const auth = parseAuth(env.NEO4J_AUTH);
  return {
    db: {
      uri: env.NEO4J_URI || 'bolt://127.0.0.1:17687',
      username: env.NEO4J_USERNAME || auth?.username || 'neo4j',
      password: env.NEO4J_PASSWORD || auth?.password || '',
      database: env.NEO4J_DATABASE || undefined,
    },
    userId: env.CODELENSE_USER_ID || 'default',
    token: env.CODELENSE_TOKEN || '',
    port: Number(env.PORT || 8787),
    host: env.HOST || '127.0.0.1',
    embeddings: {
      url: env.EMBEDDINGS_URL || '',
      key: env.EMBEDDINGS_API_KEY || '',
      model: env.EMBEDDINGS_MODEL || 'text-embedding-3-small',
    },
    dataDir: env.CODELENSE_DATA_DIR || './data',
    grammarsDir: env.CODELENSE_GRAMMARS_DIR || undefined,
    workspaceRoot: env.CODELENSE_WORKSPACE_ROOT || process.cwd(),
  };
}
