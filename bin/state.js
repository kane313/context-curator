#!/usr/bin/env node
'use strict';
// context-curator —— 队列状态与拒绝指纹 CLI。
// 注意：本脚本用退出码表达语义（is-rejected 命中 0 / 未命中 1 / 用法错误 2），
// 这是公共约束里「hook 链路必须 exit 0」的明确例外，不是缺陷。

const S = require('../lib/store');

const [, , cmd, a, b, c, d] = process.argv;

switch (cmd) {
  case 'fingerprint':
    process.stdout.write(S.fingerprint(a, b, c));
    process.exit(0);
    break;
  case 'reject':
    S.reject(a, b, c, d);
    process.exit(0);
    break;
  case 'is-rejected':
    process.exit(S.isRejected(a, b) ? 0 : 1);
    break;
  case 'done':
    S.markDone(a, b);
    process.exit(0);
    break;
  default:
    process.stderr.write('用法: state.js {fingerprint|reject|is-rejected|done} ...\n');
    process.exit(2);
}
