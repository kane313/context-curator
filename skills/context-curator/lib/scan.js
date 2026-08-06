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

// 纯推进指令，无沉淀价值。实测「继续」「跑 home」「整理一下」占真人输入的三成。
const NOISE = /继续|下一步|跑|整理|好的|嗯|^ok$/i;
function isNoise(t) {
  return t.length < 6 && NOISE.test(t);
}

// 正则经真实会话校准，能命中「…不就好了」「不要再修了。。。」
// 「为什么build了那么久没有一行代码的产出？」「…是不是就会永远都是default？」
// 注意：jq 版用 (?i) 内联标志，JS 不支持，统一改用 /i flag（中文不受大小写影响）
const PATTERNS = [
  { type: 'correction',    w: 5, re: /不对|不是这样|错了|应该是|别这样|别再|不要再|不用|重来|我说的是|你搞错了|搞反了|不就好了|不就行了|\bno,\s|\bwrong\b/i },
  { type: 'complaint',     w: 5, re: /为什么.{0,12}(没有|还没|还是|又|不)|怎么还|怎么又|？？|。。。|居然|竟然/ },
  { type: 'convention',    w: 5, re: /必须|禁止|不许|规范|我们项目|我习惯|一律|统一用|用这个|就用/ },
  { type: 'memory_intent', w: 5, re: /记住|以后|下次|每次|别忘了|\bremember\b/i },
  { type: 'pitfall',       w: 3, re: /报错|失败|崩了|Exception|build failed|编译不过|不生效|没反应/ },
  { type: 'decision',      w: 3, re: /决定|方案定了|确定用|直接按|就按/ },
  { type: 'doubt',         w: 2, re: /是不是|会不会|难道|确定吗/ },
];

const INTERRUPT_RE = /^\[Request interrupted/;
const ASSET_RE = /CLAUDE\.md|\/docs\//;

function snippetOf(text) {
  return text.slice(0, 100).replace(/\n/g, ' ');
}

function scanText(text) {
  const entries = parseSession(text);
  const { human } = extractHuman(entries);
  const hits = [];

  // 文本类信号
  for (const h of human) {
    if (isNoise(h.text)) continue;
    for (const p of PATTERNS) {
      if (p.re.test(h.text)) {
        hits.push({ type: p.type, w: p.w, line: h.line, snippet: snippetOf(h.text) });
      }
    }
  }

  // 用户打断：AI 走偏的强信号，实测 32% 的会话出现过。
  // 必须走 humanText——中断记录的 content 是数组形态，按字符串匹配会让命中率恒为 0。
  for (const { line, rec } of entries) {
    if (rec.type !== 'user') continue;
    if (INTERRUPT_RE.test(humanText(rec))) {
      hits.push({ type: 'interrupt', w: 3, line, snippet: '用户打断了执行' });
    }
  }

  // 资产改动：权重仅 1，因为绝大多数是 AI 自己写文档
  for (const { line, rec } of entries) {
    if (rec.type !== 'assistant') continue;
    const c = rec.message && rec.message.content;
    if (!Array.isArray(c)) continue;
    for (const blk of c) {
      if (!blk || blk.type !== 'tool_use') continue;
      if (blk.name !== 'Edit' && blk.name !== 'Write') continue;
      const fp = (blk.input && blk.input.file_path) || '';
      if (ASSET_RE.test(fp)) {
        hits.push({ type: 'asset_edit', w: 1, line, snippet: '改动资产: ' + fp });
      }
    }
  }

  // 同类信号按 权重 × min(命中次数, 3) 封顶。
  // 不封顶会让一个 AI 自己写了 20 次 docs 的流程会话霸榜，而真正含用户纠正的会话是 0 分。
  const counts = new Map();
  for (const h of hits) {
    const cur = counts.get(h.type) || { w: h.w, n: 0 };
    cur.n += 1;
    counts.set(h.type, cur);
  }
  const breakdown = {};
  for (const [type, { w, n }] of counts) {
    breakdown[type] = w * Math.min(n, 3);
  }

  // human_count 为 0 的纯流程会话直接判 0，不入队
  const score = human.length === 0
    ? 0
    : 1 + Object.values(breakdown).reduce((a, b) => a + b, 0);

  return {
    score,
    human_count: human.length,
    breakdown,
    hits: hits.map(({ type, line, snippet }) => ({ type, line, snippet })),
    human,
  };
}

module.exports = { parseSession, humanText, extractHuman, scanText };
