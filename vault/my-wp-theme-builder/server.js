require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { runtimeConfig } = require('../server/config/runtime');
const { isOllamaAvailable } = require('../server/services/ollamaClient');
const { resolveStage1Model } = require('./utils/modelCall');
const { createThemeBuilderApp, initThemeBuilder } = require('./createApp');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initThemeBuilder();

    if (runtimeConfig.isLocal) {
      const ollamaUp = await isOllamaAvailable();
      let model = null;
      try {
        model = await resolveStage1Model({ userId: null, model: null });
      } catch (_) {}
      console.log(
        `Local model runtime: APP_ENV=${runtimeConfig.appEnv}, ollama=${ollamaUp ? 'up' : 'down'}${model ? `, model=${model}` : ''}`
      );
    }
  } catch (err) {
    console.error('Database init failed:', err.message);
    const { isEnabled } = require('./utils/db');
    if (isEnabled()) process.exit(1);
  }

  createThemeBuilderApp().listen(PORT, () => {
    console.log(`WP Theme Builder listening on http://localhost:${PORT}`);
  });
}

start();
