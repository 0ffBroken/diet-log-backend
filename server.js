/* 食记 · 数据收集后端
 * 仅学习用途。饮食记录不含隐私，由记录者主动上报。
 * POST /api/record   接收一条记录
 * GET  /api/records  返回全部记录（汇总/管理者用）
 * GET  /api/devices  返回设备与条数概览
 *
 * 持久化：
 *   - 若设置了 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，则用 Redis REST 持久化（Render 免费 KV）
 *   - 否则写本地 data.json（仅本地测试用，云端重启会丢，务必接 KV）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 8799;
const RKEY = 'dietlog:db';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function emptyDb() { return { records: [], devices: {} }; }

async function redisGet() {
  const res = await fetch(REDIS_URL + '/get/' + RKEY, { headers: { Authorization: 'Bearer ' + REDIS_TOKEN } });
  const j = await res.json();
  if (j.result == null) return null;
  return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
}
async function redisSet(db) {
  await fetch(REDIS_URL + '/set/' + RKEY, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'text/plain' },
    body: JSON.stringify(db)
  });
}
async function load() {
  if (REDIS_URL) {
    const r = await redisGet();
    return r || emptyDb();
  }
  try { return JSON.parse(await fs.promises.readFile(DATA, 'utf8')); }
  catch (e) { return emptyDb(); }
}
async function save(db) {
  if (REDIS_URL) { await redisSet(db); return; }
  await fs.promises.writeFile(DATA, JSON.stringify(db));
}

function readBody(req) {
  return new Promise(function (res, rej) {
    var d = '';
    req.on('data', function (c) { d += c; if (d.length > 2e6) { req.destroy(); rej(new Error('too big')); } });
    req.on('end', function () { res(d); });
    req.on('error', rej);
  });
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async function (req, res) {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }

  if (req.method === 'POST' && url === '/api/record') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const db = await load();
      const device = String(body.device || '未知').slice(0, 40);
      db.records.push({
        device: device,
        ts: body.ts || Date.now(),
        date: String(body.date || ''),
        name: String(body.name || '').slice(0, 40),
        unit: String(body.unit || '').slice(0, 20),
        meal: String(body.meal || ''),
        qty: Number(body.qty || 1),
        kcal: Number(body.kcal || 0),
        p: Number(body.p || 0),
        f: Number(body.f || 0),
        cb: Number(body.cb || 0)
      });
      db.devices[device] = (db.devices[device] || 0) + 1;
      if (db.records.length > 200000) db.records = db.records.slice(-200000);
      await save(db);
      send(res, 200, { ok: true, id: db.records.length });
    } catch (e) {
      send(res, 400, { ok: false, err: 'bad data' });
    }
    return;
  }

  if (req.method === 'GET' && url === '/api/records') {
    const db = await load();
    send(res, 200, { ok: true, total: db.records.length, records: db.records });
    return;
  }

  if (req.method === 'GET' && url === '/api/devices') {
    const db = await load();
    send(res, 200, { ok: true, devices: db.devices });
    return;
  }

  if (req.method === 'GET' && url === '/api/health') {
    send(res, 200, { ok: true, name: '食记收集后端', time: new Date().toISOString(), storage: REDIS_URL ? 'redis' : 'file' });
    return;
  }

  send(res, 404, { ok: false, err: 'not found' });
});

server.listen(PORT, function () {
  console.log('食记收集后端 running: http://0.0.0.0:' + PORT + ' storage=' + (REDIS_URL ? 'redis' : 'file'));
});