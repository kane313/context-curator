# context-curator

把 Claude Code 会话里产生的知识，沉淀成项目的上下文资产（`CLAUDE.md` / AI memory / `docs/` / 项目级 skills）。

> A Claude Code skill that mines your session transcripts for knowledge worth keeping — corrections, conventions, pitfalls, decisions — and proposes evidence-backed edits to your project's context assets. Zero-token background scanning, per-item confirmation before anything is written. Signal patterns are tuned for Chinese-language sessions; English coverage is partial.

## 解决什么问题

每次会话里产生的知识——你对 AI 的纠正、定下的约定、踩过的坑、做出的决策——会话一结束就散了。下次开新会话，AI 又从零开始，你得重新说一遍。

而 `CLAUDE.md`、memory、`docs/` 这些本该承载这些知识的文件，需要人手动维护，实际上很少有人维护，于是它们要么长期空白，要么越写越长、越写越旧，混着已经不成立的规则。

这个 skill 做两件事：**持续沉淀**（把值得留下的知识提取出来，路由到正确的文件）和**持续养护**（对已有资产做纠错、去重、瘦身、重组）。

## 三条铁律

1. **没有确认就不写。** 每条建议都要你明确说 y 才落地。一条都没批准就一个字都不改。
2. **没有证据就不提。** 每条建议必须指向具体会话文件 + 行号 + 你的原话。这是挡住 AI 凭空编造项目规则的主要闸门。
3. **拒绝过的不再提。** 拒绝时记指纹，往后不再出现。

第 1 条有硬保证而非仅靠自觉：全项目的脚本唯一被允许写入的文件只有 `queue.jsonl` 和 `state.json`，没有任何脚本有能力碰 `CLAUDE.md`、memory 或 `docs/`。初始化用的 `profile-project.js` 也一样：只读项目、只输出 JSON。

## 工作方式

```
会话结束 → SessionEnd hook → Node 粗筛 → queue.jsonl       （零 token，不打扰）
                                              ↓
   你说「沉淀一下」/curate → 读队列 → 子 agent 精读高分会话 → 候选知识
                                              ↓
              读现有 CLAUDE.md / memory / docs / skills → 比对
                                              ↓
                新增 / 纠错 / 合并 / 瘦身重组 四类建议
                                              ↓
                    逐条呈现 → 你 y/n/e → 只写批准的
```

会话结束时跑的是纯 Node 内置模块，**不调用任何模型、不消耗 token、不写任何资产文件**，只把高信号线索追加进队列。真正的分析发生在你主动唤起时。

三种模式：

| 模式 | 何时用 | 数据源 |
|---|---|---|
| **结算**（默认） | 说「沉淀一下」「整理上下文」 | 队列里未处理的会话 |
| **全量** | 首次接手一个有历史积累的项目 | 该项目全部会话 + 现有 memory + 代码 |
| **当下** | 「把刚才这个记下来」 | 当前正在进行的会话 |

另有一个**初始化**入口，服务「项目还没有任何上下文资产」的场景：

```
/context-curator:init docs/prd.md
```

它读三样东西——你给的 PRD、本地源码、该项目的历史会话——生成一份薄 `CLAUDE.md` 和 `docs/context/` 下的四份事实文档（产品与需求、架构、决策与踩坑、术语）。**只新增，不覆盖**：目标文件已存在就跳过；每一段都标出处（PRD 章节 / 代码路径 / 会话行号），指不到出处的不写。带 `--dry-run` 只打印不写盘。初始化完成后交给 `/curate` 持续养护。

## 安装

只需要 Node 18 或更高，没有任何其他依赖。macOS / Linux / Windows 都支持。

### Claude Code（推荐）

```
/plugin marketplace add kane313/context-curator
/plugin install context-curator
```

装完就齐了——skill、`/curate` 命令、`SessionEnd` hook 全部自动生效，**不需要手改 `settings.json`**。

### Codex

Codex 从 `~/.agents/skills/` 加载 skill，把仓库里的 skill 目录放进去即可：

```bash
git clone https://github.com/kane313/context-curator.git ~/.local/share/context-curator
ln -s ~/.local/share/context-curator/skills/context-curator ~/.agents/skills/context-curator
ln -s ~/.local/share/context-curator/skills/context-init ~/.agents/skills/context-init
```

`context-init` 自己不带脚本，靠探测找到旁边的 `context-curator` 目录复用脚本，所以两个目录要一起链。

想要会话结束自动攒线索，在 `~/.codex/hooks.json` 里加上（路径换成你的实际路径）：

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/绝对路径/context-curator/skills/context-curator/bin/scan-session.js"],
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

不配 hook 也能用，只是要靠 `/curate 全量` 手动扫。

### 手动安装（任意 agent）

`skills/context-curator/` 这个目录是自包含的——`SKILL.md` 和它调用的全部脚本都在里面，直接放进你的 agent 的 skill 目录即可。`/curate` 命令在 `commands/curate.md`。

`skills/context-init/` 只有 `SKILL.md` 和模板，要和 `context-curator` 放在同一个 skill 目录下。`/context-curator:init` 命令在 `commands/init.md`。

### 验证安装

```bash
cd <skill 目录>
node --test   # 应输出「pass 40」「fail 0」
```

## 跨平台

全部实现是纯 Node 内置模块（`node:fs`、`node:path`、`node:crypto`），零 npm 依赖。路径处理交给 `node:path`，不依赖 shell 通配符展开，也不用 `sed` / `find` / `jq` 之类的命令行工具。

- Windows 用户**不需要** Git Bash，也**不需要**装 jq——hook 直接用 `node` 执行 `.js`，跟 macOS / Linux 是同一份代码。
- hook 统一用 exec form（`command` 传可执行文件、`args` 传数组），不依赖 shebang 或可执行位。
- Claude Code 与 Codex 的 `SessionEnd` hook payload 字段一致（`session_id` / `transcript_path` / `cwd`），所以两边共用同一个 `scan-session.js`。

**两条诚实说明**：

1. **Windows 尚未实机验证。** 目前只做了代码层面的跨平台处理，没有在真实 Windows 机器上跑过。遇到问题欢迎提 issue。
2. **Codex 的会话记录格式尚未验证。** 信号提取是照着 Claude Code 的 transcript 格式写的。如果 Codex 的格式不同，hook 会因为解析不出真人输入而判 0 分、安静跳过——不会报错，但也不会有线索入队。这种情况下 `/curate 当下`（只分析当前对话）仍然可用。有 Codex 会话样本的话欢迎提 issue，我可以补上格式适配。

## 怎么用

装好之后不需要做任何事——每次会话结束，hook 会自动把线索攒进队列。攒了几次之后，想沉淀了就说一句：

```
沉淀一下
```

或者用斜杠命令 `/curate`。它会读出队列里积压的会话，按信号强度排序，逐条给你看建议：

```
[纠错] CLAUDE.md:42
  现有：所有页面用 Provider 管理状态
  证据：会话 1c966b53 第 331 行，你说"这个项目已经全换 Riverpod 了"
  拟改：所有页面用 Riverpod 管理状态
  ⬆ 全局候选（其他项目可能同样适用，本次只改本项目）
  → y 采纳 / n 拒绝 / e 改措辞
```

你的回应：

| 回应 | 效果 |
|---|---|
| `y` | 采纳，写入目标文件 |
| `n` | 拒绝，记指纹，**以后不会再提这条** |
| `e` | 措辞不满意，你改完再落地 |

一条一条过，不会一次甩给你二十条批量确认。全程你不说 `y`，就一个字都不会被改。

**建议类型**有四种：`新增`（现有资产里没有）、`纠错`（与现有条目矛盾，会附冲突证据）、`合并`（与现有条目重复）、`瘦身重组`（`CLAUDE.md` 太长、内容放错层）。

**知识会被路由到哪**：约束 AI 干活的规则进 `CLAUDE.md`；你的偏好与项目状态进 memory；项目事实性知识（架构、接入方式、踩坑原理）进 `docs/`；反复出现的多步操作进项目级 skill。判不准的一律归 `docs/`——`CLAUDE.md` 里每一行都是每次会话都要付的成本。

### 首次接手一个有历史积累的项目

```
/curate 全量
```

忽略队列，把该项目**全部历史会话** + 现有 memory + 代码从头扫一遍。这是唯一会做「这条规则从来没被任何会话引用过，建议删掉」这类判断的模式——结算模式的数据量不足以支撑。

### 聊到一半就想记下来

```
/curate 当下
```

只看当前这次会话，不等它结束。

### 队列是空的

会直接告诉你「队列里没有待沉淀的线索」然后停下，不会为了有产出而硬编知识。纯流程会话（只打了个斜杠命令、你全程没说话）本来就不入队，这是设计如此。

### 项目还没有任何上下文资产

```
/context-curator:init docs/prd.md
```

一次性生成 `CLAUDE.md` + `docs/context/`。PRD 可以不给（跳过产品文档），历史会话可以没有（跳过决策文档），但源码必须在当前目录。已存在的文件一律跳过，报告里会列出来。

## 文件

```
.claude-plugin/marketplace.json   Claude Code 插件市场清单（source 指向仓库根）
.claude-plugin/plugin.json        Claude Code 插件元数据
.codex-plugin/plugin.json         Codex 插件元数据
hooks/hooks.json                  插件自带的 SessionEnd hook（装完即生效）
commands/curate.md                /curate 斜杠命令
commands/init.md                  /context-curator:init 斜杠命令
skills/context-init/              ← 初始化 skill：只有流程与模板，脚本借用下面的工具箱
├── SKILL.md                      初始化流程：四个信息源、只新增不覆盖、出处规则
└── templates/                    CLAUDE.md 与四份 docs/context 文档的模板
skills/context-curator/           ← 自包含的 skill，可整个搬进任何 agent 的 skill 目录
├── SKILL.md                      主体流程：三种模式、路由规则、确认协议
├── lib/scan.js                   提取真人输入 + 信号打分（hook 与 harvest 共用同一份）
├── lib/paths.js                  跨平台项目定位、slug 推导 + cwd 反查
├── lib/store.js                  队列、状态与拒绝指纹的读写
├── lib/manifests.js              manifest 解析与命令推断（初始化用）
├── lib/walk.js                   目录遍历统计与入口识别（初始化用）
├── lib/profile.js                项目探测总编排：工具链、已有资产、git、会话
├── bin/scan-session.js           SessionEnd hook 入口
├── bin/harvest.js                批量粗筛，供全量模式与初始化用
├── bin/state.js                  队列状态、拒绝指纹与初始化时间戳 CLI
├── bin/profile-project.js        项目探测 CLI，零 token、只读、只输出 JSON
└── test/                         node:test 用例 + 三份 fixture + 回归比对记录
```

`skills/context-curator/` 刻意做成自包含的——脚本和 `SKILL.md` 放在一起，所以它既能作为 Claude 插件的一部分被加载，也能单独拷进 `~/.agents/skills/` 给 Codex 用，不用改任何路径。

数据落在 `~/.claude/projects/<项目slug>/context-curator/`，与 memory 同级，不污染你的项目仓库：

- `queue.jsonl` —— 线索队列
- `state.json` —— 水位线与拒绝指纹

## 设计要点

这几条都是拿真实会话数据换来的，不是拍脑袋定的。想改之前先看看为什么：

- **纯流程会话不入队。** 只打了个斜杠命令、全程没真人打字的会话判 0 分。实测占历史会话 **42%**，不挡掉队列会被它们淹没。
- **同类信号按 `权重 × min(命中次数, 3)` 封顶。** 早期版本每次命中都累加，结果一个 AI 自己写了 20 次 `docs/` 的流程会话拿 60 分霸榜，而真正含用户纠正的会话是 0 分——方向完全反了。
- **`asset_edit` 权重仅 1。** 它抓到的绝大多数是 AI 自己写文档，跟「有没有值得沉淀的知识」几乎无关。
- **会话记录有新旧两种格式。** 新格式用 `origin.kind == "human"` 精确识别真人输入；老格式没这个字段，回退正则排除法。实测 42% 的历史会话是老格式，只做一种判据会漏掉近一半历史。
- **中断记录的 `content` 是数组形态，不是字符串。** 实测 string 0 条 / array 11 条。按字符串匹配会让这个覆盖三分之一会话的信号命中率恒为 0。
- **项目 slug：路径里所有非字母数字字符都换成 `-`，下划线也不例外。** `flutter_plant` → `flutter-plant`。只替换 `/` 会在含下划线的路径上算错，导致找不到队列文件、整个 skill 静默失效。
- **拒绝指纹是必需的，不是锦上添花。** 没有它，全量模式第二次跑就会把你拒过的建议原样再推一遍，这个 skill 用两次就废了。

## 信号

按权重从高到低：`correction`（纠正）、`complaint`（不满）、`convention`（约定禁令）、`memory_intent`（记忆意图）各 5 分；`pitfall`（踩坑）、`decision`（决策）、`interrupt`（用户打断）各 3 分；`doubt`（技术质疑）2 分；`asset_edit`（改动资产）1 分。

长度小于 6 且命中「继续/下一步/跑/整理/好的/嗯/ok」的纯推进指令判为噪声，不计分——实测这类占真人输入的三成。

**正则以中文为主**，英文只覆盖了 `no,` / `wrong` / `remember` 等少数几个。英文会话用户建议自行扩充 `lib/scan.js` 里的 `patterns` 定义。

## 排障

| 现象 | 检查 |
|---|---|
| 队列一直是空的 | 用插件装的话 hook 由 `hooks/hooks.json` 提供，跑 `/plugin` 看插件是否已启用；手动配的话确认 `~/.claude/settings.json`（或 Codex 的 `~/.codex/hooks.json`）里有 `SessionEnd`。再手动喂一条 payload 给 `bin/scan-session.js` 看结果 |
| 装了插件又手配过 hook | 两个 hook 会都触发，但 `scan-session.js` 对同一 session 是幂等的，不会重复入队。想干净就删掉手配的那份 |
| 会话结束卡顿 | 实测 1.7MB 会话仅 0.03s、2.0MB 会话 0.1s。若卡顿先确认 `timeout: 5` 配上了 |
| 找不到队列目录 | 多半是项目路径含下划线，确认用的是「非字母数字全换 `-`」的 slug 规则 |
| 想临时关掉 | 从 `settings.json` 删掉 `SessionEnd` 段即可，已有队列文件不受影响 |

`node` 不在 PATH 里会导致 hook 静默不生效（进程都起不来），不会影响你的会话，但队列也不会有新数据——排查时先确认 `which node` / `where node` 有输出。

## 开发

```bash
cd ~/.claude/skills/context-curator
node --test
```

40 个用例，纯 `node:test` 实现，零 npm 依赖。改动 `lib/scan.js` 的信号逻辑后请跑一遍——测试里有变异测试验证过的排除类断言，能抓住排除逻辑被误删。

## License

MIT
