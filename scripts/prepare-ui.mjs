import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// LJ-EXT-UI-TEMPLATES: retain approved markup/styles; replace demo logic with modules.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../交付/LivingJapan界面模板_用户确认版_20261029');
const templates = {
  desktop: 'LivingJapan界面重构_横版展示示例_20261027.html',
  portrait: 'LivingJapan界面重构_竖版统一主构架展示_20261028.html',
  mobile: 'LivingJapan界面重构_手机mini选定版精修_20261028.html',
};
fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
for (const [layout, name] of Object.entries(templates)) {
  let html = fs.readFileSync(path.join(source, name), 'utf8');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<p\b[^>]*>可试两条流程：[\s\S]*?<\/p>/g, '');
  html = html.replace(/<p\b[^>]*>[^<]*(?:草图已|未连接正式资料库)[^<]*<\/p>/g, '');
  html = html.replace(/<footer class="preview-note">[\s\S]*?<\/footer>/g, '');
  html = html.replace(/\s(on[a-z]+)="([^"]*)"/gi, (_, event, value) => ` data-legacy-${event.slice(2)}="${value}"`);
  if (!/<html\b/i.test(html)) html = `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  html = html.replace(/<body([^>]*)>/i, `<body$1 data-layout="${layout}"><div id="ljLoading" role="status">正在读取资料…</div>`);
  html = html.replace(/<\/head>/i, '<link rel="stylesheet" href="./runtime.css"><link rel="stylesheet" href="./materials.css"><link rel="stylesheet" href="./settings.css"></head>');
  html = html.replace(/<\/body>/i, '<script type="module" src="./controller.js"></script></body>');
  fs.writeFileSync(path.join(root, 'ui', `${layout}.html`), html);
}
console.log('Prepared three approved layouts without demonstration scripts.');
