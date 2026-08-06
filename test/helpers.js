'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

// 每次调用返回一个全新的空目录，测试之间互不污染
let counter = 0;
function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `cc-test-${process.pid}-${++counter}-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { FIXTURES, readFixture, tmpDir };
