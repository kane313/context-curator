#!/usr/bin/env node
'use strict';
// context-curator —— 批量粗筛，供 SKILL.md 的全量模式调用。
// 用法：node harvest.js <项目会话目录> [--min-score N]

const fs = require('node:fs');
const path = require('node:path');

// stdout 是管道时 process.exit 会截断 64KB 之后的输出，必须等写回调再退出
function emit(text) {
  process.stdout.on('error', () => process.exit(0));
  process.stdout.write(text, () => process.exit(0));
}

function main() {
  const dir = process.argv[2];
  if (!dir) return;

  let minScore = 1;
  const i = process.argv.indexOf('--min-score');
  if (i > 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n)) minScore = n;
  }

  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return;
  }

  const { scanText } = require('../lib/scan');
  const rows = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    let r;
    try {
      r = scanText(text);
    } catch {
      continue;
    }
    if (r.score < minScore) continue;
    rows.push({
      session_id: path.basename(f, '.jsonl'),
      path: path.join(dir, f),
      score: r.score,
      human_count: r.human_count,
      breakdown: r.breakdown,
      hits: r.hits,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  emit(rows.map(row => JSON.stringify(row) + '\n').join(''));
}

try {
  main();
} catch {
  // 失败不该中断 skill 流程
  process.exit(0);
}
