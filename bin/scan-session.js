#!/usr/bin/env node
'use strict';
// context-curator —— SessionEnd hook 入口。
// 铁律：零 token、零资产写入、任何路径都 exit 0，绝不干扰会话结束。

const fs = require('node:fs');
const path = require('node:path');

function main(payload) {
  let hook;
  try {
    hook = JSON.parse(payload);
  } catch {
    return;
  }
  if (!hook || typeof hook !== 'object') return;

  const transcript = hook.transcript_path;
  const sessionId = hook.session_id;
  if (!transcript || !sessionId) return;

  let stat;
  try {
    stat = fs.statSync(transcript);
  } catch {
    return;
  }
  if (!stat.isFile()) return;

  // transcript 的父目录就是 <projects>/<slug>/，无需自己推导 slug
  const ccDir = path.join(path.dirname(transcript), 'context-curator');

  const { hasSession, appendQueue } = require('../lib/store');
  if (hasSession(ccDir, sessionId)) return;

  let text;
  try {
    text = fs.readFileSync(transcript, 'utf8');
  } catch {
    return;
  }

  const { scanText } = require('../lib/scan');
  const r = scanText(text);

  // 零分不入队：纯流程会话没有沉淀价值
  if (!r.score) return;

  appendQueue(ccDir, {
    session_id: sessionId,
    path: transcript,
    cwd: hook.cwd || '',
    ended_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    reason: hook.reason || 'other',
    score: r.score,
    human_count: r.human_count,
    breakdown: r.breakdown,
    hits: r.hits,
    status: 'pending',
  });
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  try {
    main(input);
  } catch {
    // 任何未预期的异常都不能干扰会话结束
  }
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
