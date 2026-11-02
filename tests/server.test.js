import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

test('local server serves only public frontend files and blocks data writes', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['serve.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const origin = await new Promise((resolve, reject) => {
      child.stdout.on('data', bytes => {
        const match = String(bytes).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Server exited before ready: ' + code)));
    });
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes('Fictional demo data'));
    assert.ok(home.headers.get('content-security-policy').includes("connect-src 'none'"));
    assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    const source = await fetch(origin + '/calc.js');
    assert.equal(source.status, 200);
    assert.ok(source.headers.get('content-type').includes('javascript'));
    for (const path of ['/README.md', '/package.json', '/tests/calc.test.js', '/.git/config', '/%2e%2e%2fREADME.md', '/%00', '/does-not-exist']) assert.equal((await fetch(origin + path)).status, 404, path);
    assert.equal((await fetch(origin, { method: 'POST', body: 'fictional=only' })).status, 405);
    const head = await fetch(origin, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally { child.kill(); }
});

test('loopback responses keep their security policy and reject unsupported request framing', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['serve.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const origin = await new Promise((resolve, reject) => {
      child.stdout.on('data', bytes => { const match = String(bytes).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Server exited before ready: ' + code)));
    });
    for (const path of ['/missing', '/%FF']) {
      const response = await fetch(origin + path);
      assert.ok(response.status >= 400);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(response.headers.get('content-security-policy').includes("connect-src 'none'"));
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    }
    const hostStatus = await new Promise((resolve, reject) => {
      const req = request(origin + '/', { headers: { Host: 'outside.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.once('error', reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    const bodyStatus = await new Promise((resolve, reject) => {
      const req = request(origin + '/', { method: 'GET', headers: { 'Content-Length': '1' } }, res => { res.resume(); resolve(res.statusCode); });
      req.once('error', reject);
      req.end('x');
    });
    assert.equal(bodyStatus, 400);
    const post = await fetch(origin, { method: 'POST', body: 'synthetic only' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    assert.equal(post.headers.get('x-content-type-options'), 'nosniff');
    const rawStatus = text => new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: new URL(origin).port });
      let response = '';
      socket.setTimeout(1500, () => { socket.destroy(); reject(new Error('HTTP framing probe timed out.')); });
      socket.on('connect', () => socket.write(text));
      socket.on('data', chunk => { response += chunk; });
      socket.on('end', () => resolve(Number(response.match(/^HTTP\/1\.1 (\d+)/)?.[1])));
      socket.on('error', reject);
    });
    assert.equal(await rawStatus('GET http://outside.example/app.js HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'), 400);
    assert.equal(await rawStatus('GET / HTTP/1.1\r\nHost: localhost\r\nHost: outside.example\r\nConnection: close\r\n\r\n'), 403);
    assert.equal(await rawStatus('GET / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n'), 400);
    assert.equal(await rawStatus('GET / HTTP/1.1\r\nHost: localhost\r\nX-Fill: ' + 'x'.repeat(9000) + '\r\nConnection: close\r\n\r\n'), 431);
  } finally { child.kill(); }
});
