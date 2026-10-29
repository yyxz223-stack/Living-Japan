import { createRegionService } from './catalog.js';
let service;
self.onmessage = async ({ data }) => {
  const { id, method, args = [] } = data;
  try {
    if (method === 'init') { service = createRegionService(args[0]); self.postMessage({ id, result: true }); return; }
    if (!service || typeof service[method] !== 'function') throw new Error('全国资料尚未准备好');
    self.postMessage({ id, result: await service[method](...args) });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
