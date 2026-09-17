# context-curator 开发说明

这个仓库同时是三样东西：一个 Claude Code 插件市场、一个 Claude Code 插件、一个可以直接拷走的 agent skill。

## 结构约定

`skills/context-curator/` 必须保持**自包含**——`SKILL.md` 和它调用的所有脚本都在这个目录里。别把 `lib/` 或 `bin/` 挪到仓库根，否则这个目录就不能单独拷进 `~/.agents/skills/` 给 Codex 用了。

`SKILL.md` 里不要写死脚本的绝对路径。skill 可能装在 Claude 插件缓存、`~/.claude/skills/`、`~/.agents/skills/`、`<CODEX_HOME>/skills/`、Codex 插件缓存几种位置之一，第 0 步的探测逻辑负责找到它自己。

`skills/context-init/` 是第二个 skill，**只放 `SKILL.md` 与 `templates/`，不放脚本**。它需要的探测、粗筛、状态脚本全在 `skills/context-curator/` 里，靠 SKILL.md 第 0 步从自己的 base directory 往上一级找 `context-curator/`（找不到再走与 curate 相同的全局探测）。别把脚本复制一份过去，slug 推导之类的逻辑出现两份迟早漂移。

平台判定只有一处实现：`lib/profile.js` 的 `detectPlatform()`，由 `bin/profile-project.js` 以 `--skill-base=` / `--platform=` 暴露，输出到 profile 的 `platform` 字段。两份 SKILL.md 只消费这个字段，**不要**在 markdown 里自己写 shell 判平台——理由和上面那条「slug 推导出现两份迟早漂移」是一样的。

两份 SKILL.md 第 0 步的脚本探测片段是同构的重复逻辑（一份找 `lib/scan.js`、一份找 `lib/profile.js`），**改一处必须同步改另一处**，漏一处就是只在某个平台出现的 bug。另外别再往里加 `CODEX_PLUGIN_ROOT`：这个环境变量在 Codex 里不存在（0.154 二进制里只有裸的 `PLUGIN_ROOT`，那是 MCP stdio 配置的路径占位符），Codex 侧认的是 `CODEX_HOME`（默认 `~/.codex`）。

`bin/profile-project.js` 与 `lib/profile.js` / `lib/walk.js` / `lib/manifests.js` 只读项目、只输出 JSON，和 hook 一样任何失败都 `exit 0`。它们没有、也不该有写 `CLAUDE.md`、`docs/` 或 memory 的能力——初始化的写入只由 SKILL 主体在最后一步用 Write 工具完成。

`scripts/install-codex.js` 是给用户跑的 Codex 安装脚本，**它的失败纪律和 `bin/` 下的脚本相反**：`bin/` 里那些是 hook 与 skill 的被调脚本，任何失败都必须 `exit 0` 以免拖累会话；安装脚本装失败必须让用户知道，所以一律非 0 退出。别为了"统一风格"把它改成 `exit 0`。它的纯逻辑在 `scripts/install-codex.test.js` 里有测试，跑法是 `node --test scripts/install-codex.test.js`（不在 skill 的 `node --test` 范围内——安装脚本不属于自包含 skill）。

## 开发

```bash
cd skills/context-curator
node --test
```

**注意是无参的 `node --test`**。写成 `node --test test/` 会让 Node 把 `test` 当模块去 require 并报 MODULE_NOT_FOUND；写成 `node --test test/*.test.js` 则依赖 shell 展开通配符，Windows 上不成立——而跨平台正是这个项目的目标之一。

`test/` 目录下所有 `.js` 都会被 Node 当测试文件加载，所以 `test/helpers.js` 里只能有函数定义和 `module.exports`，不得有任何顶层副作用代码。

## 改信号逻辑前先读这个

`lib/scan.js` 里的正则、权重、封顶规则都是拿真实会话数据校准出来的，不是拍脑袋定的。凭直觉调整基本都会让它变差。几条踩过的坑：

- **同类信号必须按 `权重 × min(命中次数, 3)` 封顶。** 早期版本每次命中都累加，结果一个 AI 自己写了 20 次 `docs/` 的流程会话拿 60 分霸榜，真正含用户纠正的会话反而是 0 分。
- **`asset_edit` 权重只能是 1。** 它抓到的绝大多数是 AI 自己写文档，与"有没有值得沉淀的知识"几乎无关。
- **`human_count === 0` 必须判 0 分。** 纯斜杠命令驱动、用户全程没说话的会话占历史会话 42%，不挡掉队列会被淹没。
- **中断记录的 `content` 是数组形态，不是字符串。** 必须走 `humanText()` 取值。按字符串匹配会让这个覆盖三分之一会话的信号命中率恒为 0——这个 bug 真实发生过。
- **会话记录有新旧两种格式。** 新格式用 `origin.kind === 'human'`，老格式没这个字段要回退正则排除法。42% 的历史会话是老格式。

改完信号逻辑后，除了跑测试，最好再做一次回归比对——`test/regression.md` 里记着方法。

## hook 的铁律

`bin/scan-session.js` 在用户会话结束那一刻运行。**任何**失败路径都必须 `process.exit(0)`，绝不能报错或拖慢会话结束。它唯一被允许写入的文件是 `queue.jsonl`，绝不碰 `CLAUDE.md`、memory 或 `docs/`——那些只能在用户逐条确认后由 skill 主体写入。

## 发布

改动 `.claude-plugin/plugin.json` 的 `version` 后推送到 main，用户跑 `/plugin marketplace update` 即可拿到新版。
