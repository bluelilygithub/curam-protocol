'use strict';

function normalizeAppEnv(value) {
  const env = String(value || '').trim().toLowerCase();
  if (env === 'production' || env === 'prod') return 'production';
  if (env === 'local') return 'local';
  if (env === 'development' || env === 'dev' || env === 'test') return env;
  return process.env.NODE_ENV === 'production' ? 'production' : 'local';
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function selectedDatabase() {
  const appEnv = normalizeAppEnv(process.env.APP_ENV);
  if (appEnv === 'local' && process.env.LOCAL_DATABASE_URL) {
    return { url: process.env.LOCAL_DATABASE_URL, source: 'LOCAL_DATABASE_URL' };
  }
  return { url: process.env.DATABASE_URL, source: 'DATABASE_URL' };
}

function maskDatabaseUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch (_) {
    return 'configured';
  }
}

const database = selectedDatabase();
const appEnv = normalizeAppEnv(process.env.APP_ENV);

const runtimeConfig = {
  appEnv,
  isLocal: appEnv === 'local',
  isProduction: appEnv === 'production',
  databaseUrl: database.url,
  databaseUrlSource: database.source,
  safeDatabaseUrl: maskDatabaseUrl(database.url),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  modelProvider: process.env.MODEL_PROVIDER || null,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || null,
  defaultLocalModel: process.env.DEFAULT_LOCAL_MODEL || null,
  imageProvider: process.env.IMAGE_PROVIDER || null,
  localImageApiUrl: process.env.LOCAL_IMAGE_API_URL || null,
  localImageModel: process.env.LOCAL_IMAGE_MODEL || null,
  disableEmail: truthy(process.env.DISABLE_EMAIL),
  disableExternalCron: truthy(process.env.DISABLE_EXTERNAL_CRON),
  disableWebSearch: truthy(process.env.DISABLE_WEB_SEARCH),
};

function getPublicRuntimeConfig() {
  return {
    appEnv: runtimeConfig.appEnv,
    isLocal: runtimeConfig.isLocal,
    isProduction: runtimeConfig.isProduction,
    databaseUrlSource: runtimeConfig.databaseUrlSource,
    safeDatabaseUrl: runtimeConfig.safeDatabaseUrl,
    appUrl: runtimeConfig.appUrl,
    modelProvider: runtimeConfig.modelProvider,
    ollamaBaseUrl: runtimeConfig.ollamaBaseUrl,
    defaultLocalModel: runtimeConfig.defaultLocalModel,
    imageProvider: runtimeConfig.imageProvider,
    localImageApiUrl: runtimeConfig.localImageApiUrl,
    localImageModel: runtimeConfig.localImageModel,
    disableEmail: runtimeConfig.disableEmail,
    disableExternalCron: runtimeConfig.disableExternalCron,
    disableWebSearch: runtimeConfig.disableWebSearch,
  };
}

module.exports = {
  runtimeConfig,
  getPublicRuntimeConfig,
};
