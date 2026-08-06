'use strict';

// 按行解析 JSONL。line 是 1-based 文件行号——空行与损坏行都占行号，
// 这样报给用户的行号能直接对上文件真实位置。
// 单行解析失败只跳过该行：真实 transcript 存在写入中途的截断行。
function parseSession(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    try {
      out.push({ line: i + 1, rec: JSON.parse(raw) });
    } catch {
      // 损坏行跳过，不中断整个文件
    }
  }
  return out;
}

// 取一条记录里的人类可读文本。tool_result 因为不是 type==='text' 而自然被排除。
function humanText(rec) {
  const c = rec && rec.message && rec.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter(x => x && x.type === 'text').map(x => x.text || '').join('\n');
  }
  return '';
}

// 老格式（无 origin 字段）的回退排除法。
// 已验证：在新格式会话上，本判据与 origin.kind==='human' 结果完全等价。
const INJECTED = /^(<local-command-|<command-name>|<command-message>|<system-reminder>|Caveat:|Base directory for this skill:|\[Request interrupted|\*\*用中文对话)/;

function extractHuman(entries) {
  // 整份会话里只要出现过 origin 字段，就认定是新格式，走精确判据
  const newFormat = entries.some(
    e => e.rec.type === 'user' && e.rec.origin && typeof e.rec.origin === 'object'
  );
  const human = [];
  for (const { line, rec } of entries) {
    if (rec.type !== 'user') continue;
    if (rec.isSidechain === true) continue;
    if (newFormat) {
      if (!(rec.origin && rec.origin.kind === 'human')) continue;
    }
    const text = humanText(rec);
    if (!text || !text.trim()) continue;
    if (!newFormat && INJECTED.test(text)) continue;
    human.push({ line, text });
  }
  return { newFormat, human };
}

module.exports = { parseSession, humanText, extractHuman };
