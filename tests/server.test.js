import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
