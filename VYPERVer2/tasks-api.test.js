const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const taskFile = path.join(root, 'tasks.json');
const port = 3100;
const baseUrl = `http://127.0.0.1:${port}`;

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 8000) {
        clearInterval(timer);
        reject(new Error('Server did not start in time'));
      }
      fetch(`${baseUrl}/api/integrations/status`)
        .then(() => {
          clearInterval(timer);
          resolve();
        })
        .catch(() => {});
    }, 200);
  });
}

test('local task API can create and list tasks', async () => {
  const initial = fs.existsSync(taskFile) ? fs.readFileSync(taskFile, 'utf8') : '[]';
  fs.writeFileSync(taskFile, '[]');

  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Draft the weekly summary', priority: 'high' })
    });

    assert.equal(createResponse.status, 201, 'expected task creation status 201');
    const created = await createResponse.json();
    assert.equal(created.text, 'Draft the weekly summary');
    assert.equal(created.status, 'pending');

    const listResponse = await fetch(`${baseUrl}/api/tasks`);
    assert.equal(listResponse.status, 200, 'expected task list status 200');
    const list = await listResponse.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.some(task => task.text === 'Draft the weekly summary'));
  } finally {
    child.kill('SIGTERM');
    fs.writeFileSync(taskFile, initial || '[]');
  }
});

test('system care scan returns a storage health summary and protection list', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const summaryResponse = await fetch(`${baseUrl}/api/system-care/summary`);
    assert.equal(summaryResponse.status, 200, 'expected system care summary status 200');
    const summary = await summaryResponse.json();
    assert.ok(summary && typeof summary === 'object');
    assert.ok(Array.isArray(summary.files));
    assert.ok(Array.isArray(summary.protected));
    assert.ok(typeof summary.totalSize === 'number');

    const protectResponse = await fetch(`${baseUrl}/api/system-care/protect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'README.md', reason: 'keep this file safe' })
    });
    assert.equal(protectResponse.status, 200, 'expected system care protect status 200');
    const protect = await protectResponse.json();
    assert.ok(Array.isArray(protect.protected));
    assert.ok(protect.protected.some(item => item.path === 'README.md'));
  } finally {
    child.kill('SIGTERM');
  }
});
