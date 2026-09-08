#!/usr/bin/env node
'use strict';
// context-curator —— 项目探测 CLI,供 context-init skill 调用。
// 只读项目、只输出 JSON。任何失败都退出 0 并输出 {},不中断 skill 流程。
// 用法:node profile-project.js [项目根目录] [--pretty]

// stdout 是管道时 process.exit 会截断 64KB 之后的输出，必须等写回调再退出
function emit(text) {
  process.stdout.on('error', () => process.exit(0));
  process.stdout.write(text, () => process.exit(0));
}

function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes('--pretty');
  const root = args.find(a => !a.startsWith('--')) || process.cwd();
  const { profileProject } = require('../lib/profile');
  const profile = profileProject(root) || {};
  emit(JSON.stringify(profile, null, pretty ? 2 : 0) + '\n');
}

try {
  main();
} catch {
  try {
    emit('{}\n');
  } catch {
    // 连输出都失败就算了
    process.exit(0);
  }
}
