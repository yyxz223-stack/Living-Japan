// LJ-EXT-ENTRY: one deferred extension owner, with a separately loaded work surface.
import { startLivingJapan } from './src/app.js';

if (!globalThis.LivingJapanReady) {
  globalThis.LivingJapanReady = startLivingJapan({ baseUrl: new URL('./', import.meta.url) }).catch(error => {
    console.error('[Living Japan] 启动失败', error);
    const button = document.getElementById('living-japan-open');
    if (button) { button.textContent = 'LJ !'; button.title = `Living Japan 未能启动：${error.message}`; }
    throw error;
  });
}
