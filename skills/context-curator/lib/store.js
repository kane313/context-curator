'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const QUEUE = 'queue.jsonl';
const STATE = 'state.json';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// 目标文件 + 建议类型 + 内容要点 → 稳定指纹。
// 必须跨进程稳定，否则「拒绝过的不再提」这个承诺会失效。
function fingerprint(target, kind, gist) {
  const h = crypto.createHash('sha1');
  h.update([target || '', kind || '', gist || ''].join('\x1f'));
  return 'sha1:' + h.digest('hex');
}

function readQueue(ccDir) {
  const f = path.join(ccDir, QUEUE);
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // 损坏行跳过
    }
  }
  return out;
}

function appendQueue(ccDir, obj) {
  ensureDir(ccDir);
  fs.appendFileSync(path.join(ccDir, QUEUE), JSON.stringify(obj) + '\n');
}

function hasSession(ccDir, sessionId) {
  return readQueue(ccDir).some(x => x.session_id === sessionId);
}

function readState(ccDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ccDir, STATE), 'utf8'));
    if (!Array.isArray(s.rejected)) s.rejected = [];
    return s;
  } catch {
    return { last_scanned_at: null, rejected: [] };
  }
}

function writeState(ccDir, state) {
  ensureDir(ccDir);
  writeAtomic(path.join(ccDir, STATE), JSON.stringify(state, null, 2) + '\n');
}

function isRejected(ccDir, fp) {
  return readState(ccDir).rejected.some(r => r.fingerprint === fp);
}

function reject(ccDir, fp, target, gist) {
  const state = readState(ccDir);
  if (state.rejected.some(r => r.fingerprint === fp)) return;
  state.rejected.push({
    fingerprint: fp,
    target: target || '',
    gist: gist || '',
    rejected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  writeState(ccDir, state);
}

function markDone(ccDir, sessionId) {
  const q = readQueue(ccDir).map(x =>
    x.session_id === sessionId ? { ...x, status: 'done' } : x
  );
  ensureDir(ccDir);
  writeAtomic(path.join(ccDir, QUEUE), q.map(x => JSON.stringify(x)).join('\n') + (q.length ? '\n' : ''));
  const state = readState(ccDir);
  state.last_scanned_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeState(ccDir, state);
}

// 初始化流程完成时记时间戳。刻意不动 queue：初始化挖过的会话仍可被结算模式再看一遍，
// 结算第 6 步的资产比对会自然去重。
function markInitialized(ccDir) {
  const state = readState(ccDir);
  state.initialized_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeState(ccDir, state);
}

module.exports = {
  fingerprint, readQueue, appendQueue, hasSession,
  readState, isRejected, reject, markDone, markInitialized,
};
