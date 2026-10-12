// Imported first by openapi-export.ts: the export never touches the database or signs
// tokens, so it only needs syntactically valid configuration.
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/openapi_export';
process.env.JWT_SECRET ??= 'openapi-export-placeholder-secret-0000';
process.env.LOG_LEVEL = 'silent';

export {};
