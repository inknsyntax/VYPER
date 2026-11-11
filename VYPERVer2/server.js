const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const memoryFile = path.join(__dirname, 'memory.json');
const searchFile = path.join(__dirname, 'search.json');
const accessFile = path.join(__dirname, 'file-access.json');
const agentConfigFile = path.join(__dirname, 'agent-config.json');
const auditFile = path.join(__dirname, 'audit.json');
const tasksFile = path.join(__dirname, 'tasks.json');
const systemCareFile = path.join(__dirname, 'system-care.json');
const root = __dirname;
const actionQueue = [];
let allowedFiles = new Set();
try{
  const accessConfig = JSON.parse(fs.readFileSync(accessFile, 'utf8'));
  allowedFiles = new Set((accessConfig.files || []).map(file => path.normalize(file)));
}catch(err){
  console.error('Unable to load file-access.json; code viewing disabled.');
}
const voiceClients = new Set();
let voiceProcess = null;
const defaultAgentConfig = {
  mode: 'operator-controlled',
  capabilities: {
    web_research: true,
    local_memory: true,
    voice: true,
    code_read: true,
    system_care: true,
    email: false,
    sms: false
  },
  approvalRequired: ['email', 'sms', 'system_change']
};

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function send(res, code, data, type){
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' https:; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https://esm.run https://esm.sh https://cdn.jsdelivr.net" });
  res.end(data);
}

function readAgentConfig(callback){
  fs.readFile(agentConfigFile, 'utf8', (err, data) => {
    if(err){
      if(err.code === 'ENOENT') return callback(null, defaultAgentConfig);
      return callback(err);
    }
    try{
      const parsed = JSON.parse(data || '{}');
      callback(null, {
        ...defaultAgentConfig,
        ...parsed,
        capabilities: { ...defaultAgentConfig.capabilities, ...(parsed.capabilities || {}) },
        approvalRequired: Array.isArray(parsed.approvalRequired) ? parsed.approvalRequired : defaultAgentConfig.approvalRequired
      });
    }catch(_){ callback(null, defaultAgentConfig); }
  });
}

function logAudit(event, callback){
  fs.readFile(auditFile, 'utf8', (readErr, data) => {
    let entries = [];
    try{ entries = JSON.parse(data || '[]'); if(!Array.isArray(entries)) entries = []; }catch(_){ entries = []; }
    entries.push({ ...event, createdAt: new Date().toISOString() });
    fs.writeFile(auditFile, JSON.stringify(entries.slice(-1000), null, 2), 'utf8', callback);
  });
}
function notFound(res){ send(res, 404, 'Not found', 'text/plain'); }


function readJson(req, callback){
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if(body.length > 1024 * 1024) req.destroy();

  });
  req.on('end', () => {
    try{ callback(null, JSON.parse(body || '{}')); }
    catch(err){ callback(err); }
  });
}

function logSearch(type, query, callback){
  fs.readFile(searchFile, 'utf8', (readErr, data) => {

    let entries = [];
    try{ entries = JSON.parse(data || '[]'); if(!Array.isArray(entries)) entries = []; }catch(_){ entries = []; }
    entries.push({ type: String(type).slice(0, 40), query: String(query).trim().slice(0, 500), createdAt: new Date().toISOString() });
    fs.writeFile(searchFile, JSON.stringify(entries.slice(-500), null, 2), 'utf8', callback);
  });
}

function readTasksList(callback){
  fs.readFile(tasksFile, 'utf8', (err, data) => {
    if(err){
      if(err.code === 'ENOENT') return callback(null, []);
      return callback(err);
    }
    try{
      logAudit({ action: 'queue', type: item.type, id: item.id, status: item.status }, () => {});
      return send(res, 202, JSON.stringify(item), 'application/json');
      callback(null, Array.isArray(parsed) ? parsed : []);
    }catch(_){ callback(null, []); }

  });
}

function writeTasksList(tasks, callback){
  fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2), 'utf8', callback);
}

function readSystemCareConfig(callback){
  fs.readFile(systemCareFile, 'utf8', (err, data) => {
    if(err){
      if(err.code === 'ENOENT') return callback(null, { protected: [], reminders: [] });
      return callback(err);
    }
    try{
      const parsed = JSON.parse(data || '{}');
      callback(null, {
        protected: Array.isArray(parsed.protected) ? parsed.protected : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : []
      });
    }catch(_){ callback(null, { protected: [], reminders: [] }); }
  });
}

function writeSystemCareConfig(config, callback){
  fs.writeFile(systemCareFile, JSON.stringify({
    protected: Array.isArray(config.protected) ? config.protected : [],
    reminders: Array.isArray(config.reminders) ? config.reminders : []
  }, null, 2), 'utf8', callback);
}

function buildSystemCareSummary(callback){
  const files = [];
  const seen = new Set();
  const scanner = (dir) => {
    let entries;
    try{ entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch(_){ return; }
    for(const entry of entries){
      if(entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.vscode') continue;
      const full = path.join(dir, entry.name);
      if(entry.isDirectory()){
        scanner(full);
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if(!rel || rel === '.' || seen.has(rel)) continue;
      seen.add(rel);
      let stat;
      try{ stat = fs.statSync(full); }catch(_){ continue; }
      if(!stat.isFile()) continue;
      files.push({
        path: rel,
        size: stat.size,
        type: path.extname(entry.name).replace(/^\./, '').toLowerCase() || 'file',
        modifiedAt: stat.mtime.toISOString()
      });
    }
  };

  scanner(root);
  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const protected = [];
  const largeFiles = [...files].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 12);
  const recommendations = [];
  if(totalSize > 200 * 1024 * 1024 * 1024){
    recommendations.push('Storage is near capacity. Start by moving large media and archives to a secondary drive or external vault.');
  }
  if(largeFiles.length){
    recommendations.push(`Large items are dominating the footprint: ${largeFiles.slice(0, 3).map(file => file.path).join(', ')}.`);
  }
  recommendations.push('Protect your irreplaceable files by pinning them in the protection ledger so they are not treated as disposable clutter.');
  recommendations.push('Review older downloads, screenshots, and duplicate archives first; they are usually the easiest wins.');

  const explorer = [];
  const windowsRoots = [];
  if(process.platform === 'win32'){
    const winRoots = [
      'C:/Program Files',
      'C:/Program Files (x86)',
      path.join(os.homedir(), 'Downloads'),
      path.join(os.homedir(), 'Documents'),
      path.join(os.homedir(), 'Desktop')
    ];
    for(const dir of winRoots){
      try{ if(fs.existsSync(dir)) windowsRoots.push({ path: dir, exists: true }); }
      catch(_){ }
    }
  } else {
    const home = os.homedir();
    for(const dir of [home, path.join(home, 'Downloads'), path.join(home, 'Documents')]){
      try{ if(fs.existsSync(dir)) windowsRoots.push({ path: dir, exists: true }); }
      catch(_){ }
    }
  }
  for(const base of windowsRoots){
    try{
      const entries = fs.readdirSync(base.path, { withFileTypes: true }).slice(0, 8);
      explorer.push({
        path: base.path,
        entries: entries.filter(entry => entry.isDirectory() || entry.isFile()).slice(0, 8).map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file'
        }))
      });
    }catch(_){ }
  }

  const appUsage = [];
  const appRoots = [];
  const programRoots = process.platform === 'win32'
    ? ['C:/Program Files', 'C:/Program Files (x86)', path.join(os.homedir(), 'AppData', 'Local', 'Programs')]
    : [path.join(os.homedir(), '.local', 'share'), path.join(os.homedir(), '.npm')];
  for(const dir of programRoots){
    try{
      if(fs.existsSync(dir)) appRoots.push(dir);
    }catch(_){ }
  }
  for(const dir of appRoots){
    try{
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.filter(entry => entry.isDirectory()).slice(0, 8).forEach(entry => {
        const full = path.join(dir, entry.name);
        let stat = null;
        try{ stat = fs.statSync(full); }catch(_){ }
        appUsage.push({
          name: entry.name,
          path: full,
          modifiedAt: stat ? stat.mtime.toISOString() : new Date().toISOString(),
          kind: 'app'
        });
      });
    }catch(_){ }
  }

  readSystemCareConfig((readErr, config) => {
    if(!readErr){
      for(const item of (config.protected || [])){
        if(typeof item === 'object' && item && typeof item.path === 'string') protected.push(item);
      }
    }
    const summary = {
      fileCount: files.length,
      totalSize,
      totalSizeText: `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      files: files.slice(0, 200),
      protected,
      largeFiles,
      recommendations,
      explorer,
      appUsage: appUsage.slice(0, 12),
      health: {
        storage: totalSize > 200 * 1024 * 1024 * 1024 ? 'critical' : totalSize > 120 * 1024 * 1024 * 1024 ? 'warning' : 'stable',
        clutter: largeFiles.length > 3 ? 'warning' : 'stable',
        protection: protected.length > 0 ? 'guarded' : 'needs attention'
      }
    };
    callback(null, summary);
  });
}

function broadcastVoice(message){
  for(const client of voiceClients) client.write(`data: ${JSON.stringify(message)}\n\n`);
}

function startVoiceEngine(){
  if(voiceProcess) return true;
  if(process.platform !== 'win32') return false;
  voiceProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'voice-engine.ps1')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '';
  voiceProcess.stdout.setEncoding('utf8');
  voiceProcess.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for(const line of lines){
      try{ broadcastVoice(JSON.parse(line)); }catch(_){ }
    }
  });
  voiceProcess.stderr.on('data', chunk => broadcastVoice({ type: 'error', message: String(chunk).trim() }));
  voiceProcess.on('close', () => { voiceProcess = null; broadcastVoice({ type: 'stopped' }); });
  return true;
}

function stopVoiceEngine(){
  if(!voiceProcess) return;
  voiceProcess.stdin.write('stop\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if(url.pathname === '/api/memory'){
    if(req.method === 'GET'){
      fs.readFile(memoryFile, 'utf8', (err, data) => {
        if(err){
          if(err.code === 'ENOENT') return send(res, 200, JSON.stringify({}), 'application/json');
          return send(res, 500, JSON.stringify({ error: 'Unable to read memory.json' }), 'application/json');
        }
        send(res, 200, data || '{}', 'application/json');
      });
      return;
    }
    if(req.method === 'POST'){
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try{
          const json = JSON.parse(body || '{}');
          fs.writeFile(memoryFile, JSON.stringify(json, null, 2), 'utf8', err => {
            if(err) return send(res, 500, JSON.stringify({ error: 'Unable to save memory.json' }), 'application/json');
            send(res, 200, JSON.stringify({ success: true }), 'application/json');
          });
        }catch(_){
          send(res, 400, JSON.stringify({ error: 'Invalid JSON' }), 'application/json');
        }
      });
      return;
    }
    return notFound(res);
  }

  if(url.pathname === '/api/integrations/status' && req.method === 'GET'){
    return readAgentConfig((err, config) => {
      if(err) return send(res, 500, JSON.stringify({ error: 'Unable to read agent configuration.' }), 'application/json');
      send(res, 200, JSON.stringify({
        mode: config.mode,
        capabilities: config.capabilities,
        approvalRequired: config.approvalRequired,
        screen: { configured: true, mode: 'local' },
        memory: { configured: true, mode: 'local' },
        voice: { configured: process.platform === 'win32', mode: voiceProcess ? 'active' : 'stopped' },
        email: { configured: Boolean(process.env.VYPER_EMAIL_PROVIDER), enabled: Boolean(config.capabilities.email), mode: process.env.VYPER_EMAIL_PROVIDER ? 'ready' : 'setup' },
        sms: { configured: Boolean(process.env.VYPER_SMS_PROVIDER), enabled: Boolean(config.capabilities.sms), mode: process.env.VYPER_SMS_PROVIDER ? 'ready' : 'setup' },
        queued: actionQueue.length
      }), 'application/json');
    });
  }

  if(url.pathname === '/api/agent/config' && req.method === 'GET'){
    return readAgentConfig((err, config) => {
      if(err) return send(res, 500, JSON.stringify({ error: 'Unable to read agent configuration.' }), 'application/json');
      send(res, 200, JSON.stringify(config), 'application/json');
    });
  }

  if(url.pathname === '/api/audit' && req.method === 'GET'){
    return fs.readFile(auditFile, 'utf8', (err, data) => {
      if(err && err.code !== 'ENOENT') return send(res, 500, JSON.stringify({ error: 'Unable to read audit log.' }), 'application/json');
      let entries = [];
      try{ entries = JSON.parse(data || '[]'); }catch(_){ }
      send(res, 200, JSON.stringify(Array.isArray(entries) ? entries.slice(-200) : []), 'application/json');
    });
  }

  if(url.pathname === '/api/voice/stream' && req.method === 'GET'){
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: voiceProcess ? 'active' : 'stopped' })}\n\n`);
    voiceClients.add(res);
    req.on('close', () => voiceClients.delete(res));
    return;
  }

  if(url.pathname === '/api/voice/start' && req.method === 'POST'){
    return send(res, startVoiceEngine() ? 202 : 501, JSON.stringify({ active: Boolean(voiceProcess), local: process.platform === 'win32' }), 'application/json');
  }

  if(url.pathname === '/api/voice/stop' && req.method === 'POST'){
    stopVoiceEngine();
    return send(res, 200, JSON.stringify({ active: false }), 'application/json');
  }

  if(url.pathname === '/api/tasks' && req.method === 'GET'){
    return readTasksList((err, tasks) => {
      if(err) return send(res, 500, JSON.stringify({ error: 'Unable to read tasks.json' }), 'application/json');
      send(res, 200, JSON.stringify(tasks), 'application/json');
    });
  }

  if(url.pathname === '/api/tasks' && req.method === 'POST'){
    return readJson(req, (err, payload) => {
      if(err || typeof payload.text !== 'string' || !payload.text.trim()){
        return send(res, 400, JSON.stringify({ error: 'Task text is required.' }), 'application/json');
      }
      readTasksList((readErr, tasks) => {
        if(readErr) return send(res, 500, JSON.stringify({ error: 'Unable to read tasks.json' }), 'application/json');
        const created = {
          id: `task-${Date.now()}-${tasks.length + 1}`,
          text: payload.text.trim().slice(0, 1000),
          priority: ['low', 'medium', 'high'].includes(payload.priority) ? payload.priority : 'medium',
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        tasks.push(created);
        writeTasksList(tasks, writeErr => {
          if(writeErr) return send(res, 500, JSON.stringify({ error: 'Unable to save tasks.json' }), 'application/json');
          send(res, 201, JSON.stringify(created), 'application/json');
        });
      });
    });
  }

  if(url.pathname.startsWith('/api/tasks/') && req.method === 'PATCH'){
    const id = decodeURIComponent(url.pathname.replace('/api/tasks/', ''));
    if(!id) return send(res, 400, JSON.stringify({ error: 'Task id is required.' }), 'application/json');
    return readJson(req, (err, payload) => {
      if(err) return send(res, 400, JSON.stringify({ error: 'Invalid task update payload.' }), 'application/json');
      readTasksList((readErr, tasks) => {
        if(readErr) return send(res, 500, JSON.stringify({ error: 'Unable to read tasks.json' }), 'application/json');
        const index = tasks.findIndex(task => task.id === id);
        if(index === -1) return send(res, 404, JSON.stringify({ error: 'Task not found.' }), 'application/json');
        if(typeof payload.status === 'string') tasks[index].status = ['pending', 'in_progress', 'done'].includes(payload.status) ? payload.status : tasks[index].status;
        if(typeof payload.priority === 'string') tasks[index].priority = ['low', 'medium', 'high'].includes(payload.priority) ? payload.priority : tasks[index].priority;
        if(typeof payload.text === 'string' && payload.text.trim()) tasks[index].text = payload.text.trim().slice(0, 1000);
        writeTasksList(tasks, writeErr => {
          if(writeErr) return send(res, 500, JSON.stringify({ error: 'Unable to save tasks.json' }), 'application/json');
          send(res, 200, JSON.stringify(tasks[index]), 'application/json');
        });
      });
    });
  }

  if(url.pathname === '/api/search' && req.method === 'POST'){
    return readJson(req, (err, payload) => {
      if(err || typeof payload.type !== 'string' || typeof payload.query !== 'string' || !payload.query.trim()){
        return send(res, 400, JSON.stringify({ error: 'Search entries require type and query.' }), 'application/json');
      }
      logSearch(payload.type, payload.query, writeErr => {
        if(writeErr) return send(res, 500, JSON.stringify({ error: 'Unable to save search.json' }), 'application/json');
        send(res, 201, JSON.stringify({ success: true }), 'application/json');
      });
    });
  }

  if(url.pathname === '/api/system-care/summary' && req.method === 'GET'){
    return buildSystemCareSummary((err, summary) => {
      if(err) return send(res, 500, JSON.stringify({ error: 'Unable to build system care summary.' }), 'application/json');
      send(res, 200, JSON.stringify(summary), 'application/json');
    });
  }

  if(url.pathname === '/api/system-care/protect' && req.method === 'POST'){
    return readJson(req, (err, payload) => {
      if(err || typeof payload.path !== 'string' || !payload.path.trim()){
        return send(res, 400, JSON.stringify({ error: 'A file path is required.' }), 'application/json');
      }
      const normalized = payload.path.trim().replace(/\\/g, '/');
      readSystemCareConfig((readErr, config) => {
        if(readErr) return send(res, 500, JSON.stringify({ error: 'Unable to read protection ledger.' }), 'application/json');
        const nextProtected = [...(config.protected || [])];
        const existingIndex = nextProtected.findIndex(item => String(item.path).replace(/\\/g, '/') === normalized);
        const entry = { path: normalized, reason: typeof payload.reason === 'string' ? payload.reason.trim() : 'protected by VYPER', addedAt: new Date().toISOString() };
        if(existingIndex >= 0) nextProtected[existingIndex] = entry; else nextProtected.push(entry);
        writeSystemCareConfig({ protected: nextProtected, reminders: config.reminders || [] }, writeErr => {
          if(writeErr) return send(res, 500, JSON.stringify({ error: 'Unable to save protection ledger.' }), 'application/json');
          send(res, 200, JSON.stringify({ success: true, protected: nextProtected }), 'application/json');
        });
      });
    });
  }

  if(url.pathname === '/api/code' && req.method === 'GET'){
    const requested = url.searchParams.get('file') || '';
    const filePath = path.resolve(root, requested);
    const relativePath = path.normalize(path.relative(root, filePath));
    if(!filePath.startsWith(root + path.sep) || !allowedFiles.has(relativePath)){
      return send(res, 403, JSON.stringify({ error: 'Read-only code access denied for this path.' }), 'application/json');
    }
    return fs.readFile(filePath, 'utf8', (err, data) => {
      if(err) return send(res, 404, JSON.stringify({ error: 'File not found.' }), 'application/json');
      send(res, 200, JSON.stringify({ file: path.relative(root, filePath), readOnly: true, content: data }), 'application/json');
    });
  }

  if(url.pathname === '/api/code/list' && req.method === 'GET'){
    return send(res, 200, JSON.stringify({ mode: 'read-only', files: [...allowedFiles] }), 'application/json');
  }

  if(url.pathname === '/api/web/fetch' && req.method === 'POST'){
    return readJson(req, (err, payload) => {
      if(err || typeof payload.url !== 'string') return send(res, 400, JSON.stringify({ error: 'A URL is required.' }), 'application/json');
      let target;
      try{ target = new URL(payload.url); }catch(_){ return send(res, 400, JSON.stringify({ error: 'Invalid URL.' }), 'application/json'); }
      const query = typeof payload.query === 'string' ? payload.query : target.href;
      logSearch('web', query, logErr => {
        if(logErr) return send(res, 500, JSON.stringify({ error: 'Unable to save search.json' }), 'application/json');
        if(target.protocol !== 'https:'){
          return send(res, 403, JSON.stringify({ error: 'Only HTTPS web requests are permitted.', logged: true }), 'application/json');
        }
        const request=https.get(target, { headers: { 'User-Agent': 'VYPER-local-box/1.0', Accept: 'text/plain,text/html,application/json' } }, upstream => {
          let body='';
          upstream.setEncoding('utf8');
          upstream.on('data', chunk => { if(body.length < 200000) body += chunk; });
          upstream.on('end', () => send(res, upstream.statusCode === 200 ? 200 : 502, JSON.stringify({ status: upstream.statusCode, url: target.href, content: body, logged: true }), 'application/json'));
        });
        request.setTimeout(5000, () => request.destroy());
        request.on('error', () => send(res, 502, JSON.stringify({ error: 'Allowlisted web host unavailable.', logged: true }), 'application/json'));
      });
    });
  }

  if(url.pathname === '/api/web/search' && req.method === 'POST'){
    return readJson(req, (err, payload) => {
      if(err || typeof payload.query !== 'string' || !payload.query.trim()) return send(res, 400, JSON.stringify({ error: 'A research query is required.' }), 'application/json');
      const query = payload.query.trim().slice(0, 500);
      logSearch('research', query, logErr => {
        if(logErr) return send(res, 500, JSON.stringify({ error: 'Unable to save search.json' }), 'application/json');
        const target = new URL('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
        const request = https.get(target, { headers: { 'User-Agent': 'VYPER-research/1.0' } }, upstream => {
          let body = '';
          upstream.setEncoding('utf8');
          upstream.on('data', chunk => { if(body.length < 250000) body += chunk; });
          upstream.on('end', () => {
            const results = [...body.matchAll(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 8).map(match => ({
              title: match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim(),
              snippet: match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
            }));
            send(res, upstream.statusCode === 200 ? 200 : 502, JSON.stringify({ query, results, logged: true }), 'application/json');
          });
        });
        request.setTimeout(8000, () => request.destroy());
        request.on('error', () => send(res, 502, JSON.stringify({ error: 'Research service unavailable.', logged: true }), 'application/json'));
      });
    });
  }

  if(url.pathname === '/api/automation/queue' && req.method === 'GET'){
    return send(res, 200, JSON.stringify(actionQueue), 'application/json');
  }

  if(url.pathname === '/api/automation/queue' && req.method === 'POST'){
    return readJson(req, (err, payload) => {
      if(err || !['email', 'sms'].includes(payload.type) || typeof payload.content !== 'string' || !payload.content.trim()){
        return send(res, 400, JSON.stringify({ error: 'Queue entries require type=email|sms and content.' }), 'application/json');
      }
      const item = {
        id: `action-${Date.now()}-${actionQueue.length + 1}`,
        type: payload.type,
        content: payload.content.trim().slice(0, 4000),
        recipient: typeof payload.recipient === 'string' ? payload.recipient.trim().slice(0, 320) : '',
        status: 'awaiting_approval',
        createdAt: new Date().toISOString()
      };
      actionQueue.push(item);
      logAudit({ action: 'queue', type: item.type, id: item.id, status: item.status }, () => {});
      return send(res, 202, JSON.stringify(item), 'application/json');
    });
  }

  if(url.pathname.startsWith('/api/automation/queue/') && req.method === 'PATCH'){
    const id = decodeURIComponent(url.pathname.replace('/api/automation/queue/', ''));
    return readJson(req, (err, payload) => {
      if(err || !['approve', 'reject'].includes(payload.action)) return send(res, 400, JSON.stringify({ error: 'Action must be approve or reject.' }), 'application/json');
      const item = actionQueue.find(entry => entry.id === id);
      if(!item) return send(res, 404, JSON.stringify({ error: 'Queued action not found.' }), 'application/json');
      if(item.status !== 'awaiting_approval') return send(res, 409, JSON.stringify({ error: 'Queued action was already decided.' }), 'application/json');
      item.status = payload.action === 'approve' ? 'approved_not_sent' : 'rejected';
      item.decidedAt = new Date().toISOString();
      logAudit({ action: payload.action, type: item.type, id: item.id, status: item.status }, () => {});
      return send(res, 200, JSON.stringify(item), 'application/json');
    });
  }

  // Simple sound control API (uses `loudness` package). Endpoints:
  // GET  /api/sound/status    -> { muted: boolean }
  // POST /api/sound/mute      -> { muted: true }
  // POST /api/sound/unmute    -> { muted: false }
  // POST /api/sound/toggle    -> { muted: <new state> }
  if(url.pathname.startsWith('/api/sound')){
    (async ()=>{
      try{
        const loudness = require('loudness');
        if(req.method === 'GET' && url.pathname === '/api/sound/status'){
          const muted = await loudness.getMuted();
          return send(res, 200, JSON.stringify({ muted }), 'application/json');
        }
        if(req.method === 'POST'){
          if(url.pathname === '/api/sound/mute'){
            await loudness.setMuted(true);
            return send(res, 200, JSON.stringify({ muted: true }), 'application/json');
          }
          if(url.pathname === '/api/sound/unmute'){
            await loudness.setMuted(false);
            return send(res, 200, JSON.stringify({ muted: false }), 'application/json');
          }
          if(url.pathname === '/api/sound/toggle'){
            const currently = await loudness.getMuted();
            await loudness.setMuted(!currently);
            const now = await loudness.getMuted();
            return send(res, 200, JSON.stringify({ muted: now }), 'application/json');
          }
        }
        return notFound(res);
      }catch(err){
        return send(res, 500, JSON.stringify({ error: 'Sound control unavailable', details: String(err) }), 'application/json');
      }
    })();
    return;
  }

  let filePath = path.resolve(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if(!filePath.startsWith(root + path.sep)) return notFound(res);
  if(!path.extname(filePath)) filePath += '.html';
  fs.readFile(filePath, (err, data) => {
    if(err) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, mime[ext] || 'application/octet-stream');
  });
});

const port = process.env.PORT || 2727;
const host = '127.0.0.1';
server.listen(port, host, () => {
  console.log(`VYPER local server running at http://${host}:${port}`);
});
