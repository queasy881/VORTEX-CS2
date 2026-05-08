import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  r2: {
    accountId: required('R2_ACCOUNT_ID'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucketName: required('R2_BUCKET_NAME'),
    endpoint: required('R2_ENDPOINT'),
  },
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  compressorUrl: optional('COMPRESSOR_URL', 'http://localhost:3001'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),
  accessTokenTtlSeconds: 60 * 15,
  refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
  bcryptCost: 12,
  signedUrlTtlSeconds: 60 * 15,
};
