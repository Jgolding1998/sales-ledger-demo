// Tiny local static server; no dependencies, uploads, API routes or remote access.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 through 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const allowed = new Set(['index.html', 'styles.css', 'app.js', 'calc.js', 'data.js']);
const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?$/i;
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  const reply = (status, body, type = 'text/plain; charset=utf-8', close = false) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (close) res.setHeader('Connection', 'close');
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
  try {
    const hostHeaders = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host').length;
    const host = hostHeaders === 1 && localHost.exec(req.headers.host || '');
    if (!host || host[2] && (+host[2] < 1 || +host[2] > 65535)) { reply(403, 'Use the local address printed by this server.', undefined, true); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); reply(405, 'Method not allowed', undefined, true); return; }
    if (req.headers['transfer-encoding'] !== undefined || req.headers['content-length'] !== undefined && !/^0+$/.test(req.headers['content-length'])) { reply(400, 'This static server does not accept request bodies.', undefined, true); return; }
    if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) { reply(400, 'Use a local path.', undefined, true); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = resolve(root, name);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !allowed.has(name)) { reply(404, 'Not found'); return; }
    const bytes = await readFile(path);
    reply(200, bytes, types[extname(path)] || 'application/octet-stream');
  } catch (error) {
    reply(error instanceof URIError ? 400 : 404, 'Not found');
  }
});
server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(port, '127.0.0.1', () => console.log('Sales demo: http://127.0.0.1:' + server.address().port));
