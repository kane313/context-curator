'use strict';
// 安装脚本的纯逻辑测试。跑法：node --test scripts/install-codex.test.js
// 不放进 skills/context-curator/test/：那套测试属于自包含的 skill，安装脚本不是 skill 的一部分。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const I = require('./install-codex');

let n = 0;
function tmp(name) {
  const d = path.join(os.tmpdir(), `ic-test-${process.pid}-${++n}-${name}`);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// —— readMarketplaceName ——

test('readMarketplaceName 从 marketplace.json 读市场名与插件名', () => {
  const root = tmp('repo');
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'context-curator', plugins: [{ name: 'context-curator' }] }));
  assert.deepStrictEqual(I.readMarketplaceName(root), {
    marketplace: 'context-curator',
    plugin: 'context-curator',
    selector: 'context-curator@context-curator',
  });
});

test('readMarketplaceName 文件缺失时抛出可读错误', () => {
  assert.throws(() => I.readMarketplaceName(tmp('empty')), /marketplace\.json/);
});

test('readMarketplaceName 缺 name 或 plugins 时抛出可读错误', () => {
  const root = tmp('bad');
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [] }));
  assert.throws(() => I.readMarketplaceName(root), /name/);
});

// —— linkState：「绝不覆盖」铁律的实现 ——

test('linkState 路径不存在返回 absent', () => {
  const d = tmp('ls');
  assert.strictEqual(I.linkState(path.join(d, 'target'), path.join(d, 'nope')), 'absent');
});

test('linkState 已指向目标返回 ok', () => {
  const d = tmp('ls');
  const target = path.join(d, 'target');
  const link = path.join(d, 'link');
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, 'junction');
  assert.strictEqual(I.linkState(target, link), 'ok');
});

test('linkState 指向别处返回 conflict——绝不覆盖', () => {
  const d = tmp('ls');
  const target = path.join(d, 'target');
  const other = path.join(d, 'other');
  const link = path.join(d, 'link');
  fs.mkdirSync(target);
  fs.mkdirSync(other);
  fs.symlinkSync(other, link, 'junction');
  assert.strictEqual(I.linkState(target, link), 'conflict');
});

test('linkState 被实体目录占据返回 occupied——绝不覆盖', () => {
  const d = tmp('ls');
  const target = path.join(d, 'target');
  const link = path.join(d, 'link');
  fs.mkdirSync(target);
  fs.mkdirSync(link);
  fs.writeFileSync(path.join(link, 'someones-work.md'), 'x');
  assert.strictEqual(I.linkState(target, link), 'occupied');
});

// —— parseInstalled：注意 "not installed" 里也含 "installed" ——

test('parseInstalled 认出已安装', () => {
  const out = [
    'Marketplace `context-curator`',
    '/repo/.claude-plugin/marketplace.json',
    '',
    'PLUGIN                           STATUS              VERSION  SOURCE',
    'context-curator@context-curator  installed, enabled  1.2.0    /repo',
  ].join('\n');
  assert.strictEqual(I.parseInstalled(out, 'context-curator@context-curator'), true);
});

test('parseInstalled 不把 not installed 误判为已安装', () => {
  const out = [
    'PLUGIN                           STATUS         VERSION  SOURCE',
    'context-curator@context-curator  not installed           /repo',
  ].join('\n');
  assert.strictEqual(I.parseInstalled(out, 'context-curator@context-curator'), false);
});

test('parseInstalled 找不到 selector 返回 false', () => {
  assert.strictEqual(I.parseInstalled('PLUGIN  STATUS\nother@mkt  installed', 'context-curator@context-curator'), false);
});

// —— detectSkillConflicts ——

test('detectSkillConflicts 报出同名 skill 目录', () => {
  const home = tmp('home');
  const cx = tmp('codexhome');
  fs.mkdirSync(path.join(home, '.agents', 'skills', 'context-curator'), { recursive: true });
  fs.mkdirSync(path.join(cx, 'skills', 'context-init'), { recursive: true });
  const hits = I.detectSkillConflicts(home, cx);
  assert.strictEqual(hits.length, 2);
  assert.ok(hits.some(h => h.includes(path.join('.agents', 'skills', 'context-curator'))));
  assert.ok(hits.some(h => h.includes(path.join('skills', 'context-init'))));
});

test('detectSkillConflicts 没有同名目录时返回空数组', () => {
  assert.deepStrictEqual(I.detectSkillConflicts(tmp('home'), tmp('cx')), []);
});
