'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function projectsRoot() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

// Claude Code 把项目路径里所有非字母数字字符都换成 -，下划线也不例外。
// 只替换 / 会在 flutter_plant、flutter_center、client_harness 这类路径上算错。
function slugify(dir) {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

// 读一个项目目录里任一 jsonl 的 cwd 字段。
// 逐行找直到读到带 cwd 的记录——第一行常常是没有 cwd 的元数据。
function readCwd(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return null;
  }
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec.cwd === 'string' && rec.cwd) return rec.cwd;
      } catch {
        // 损坏行跳过
      }
    }
  }
  return null;
}

function findProjectDir(cwd, root) {
  const base = root || projectsRoot();
  const bySlug = path.join(base, slugify(cwd));
  if (fs.existsSync(bySlug)) return bySlug;

  // slug 规则是逆向出来的，未必适用于所有平台，按 cwd 反查
  let dirs;
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(base, d.name));
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (readCwd(d) === cwd) return d;
  }
  return null;
}

function curatorDir(projectDir) {
  return path.join(projectDir, 'context-curator');
}

module.exports = { projectsRoot, slugify, findProjectDir, curatorDir, readCwd };
