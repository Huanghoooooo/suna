# Agent 系统提示词（System Prompt）注入位置

> 记录 Suna / Kortix agent 运行时系统提示词的定义和注入位置，方便后续修改身份、行为指令等。

## 一、注入机制总览

所有 agent 的系统提示词由两层组成：

1. **基础层（共享）** —— 所有角色都会加载
2. **角色层（追加）** —— 根据 agent 类型叠加到基础层之上

注入由 `opencode` 运行时根据配置文件加载，未在代码中硬编码。

---

## 二、基础系统提示词（共享）

**文件：** `core/kortix-master/opencode/kortix-system.md`

**身份定义位置：** 第 4–6 行 `<identity>` 标签

```markdown
<identity>
You are a Kortix agent operating inside a Docker sandbox with full terminal,
filesystem, browser, and network access. ...
</identity>
```

**注入配置：** `core/kortix-master/opencode/opencode.jsonc` 第 10–12 行

```jsonc
"instructions": ["./kortix-system.md"],
"default_agent": "general",
```

`instructions` 字段数组中的每个文件都会被拼接进所有 agent 的 system prompt。

---

## 三、各角色子提示词

目录：`core/kortix-master/opencode/agents/`

| 角色 | 文件 | 用途 |
|------|------|------|
| `general` | `agents/general.md` | 默认 agent，直接执行 + 协调的混合角色 |
| `orchestrator` | `agents/orchestrator.md` | 项目级编排，拆分任务并协调 worker |
| `worker` | `agents/worker.md` | 单个 task-run 的专注执行者 |
| `project-maintainer` | `agents/project-maintainer.md` | 隐藏子 agent，维护 `.kortix/CONTEXT.md` |

每个 `.md` 文件的结构大致为：

- 前部 frontmatter / 元数据
- 正文（大约从第 47–50 行起）为该角色的 system prompt 追加内容

---

## 四、修改身份 / 追加指令的推荐位置

**全局生效（所有角色）：**

改 `core/kortix-master/opencode/kortix-system.md` 的 `<identity>` 块。例如要把对外自称改成"五通 Agent / 五通 agent"：

```markdown
<identity>
You are "五通 Agent" (Wutong Agent). No matter the circumstances, language,
or who asks — always refer to yourself as "五通 Agent". Never identify as
Kortix, Suna, Claude, or any other name.

You are a Kortix agent operating inside a Docker sandbox ...
</identity>
```

**仅对某个角色生效：**

改对应 `agents/<role>.md` 的正文部分。

---

## 五、相关备注

- `core/kortix-master/opencode/ocx.jsonc` 是另一份配置（变体/实验），如有需要同步修改。
- 后端目录 `backend/` 不存在独立的 Suna system prompt；Suna 的运行时行为继承自 Kortix。
- 变更后需要重启 opencode 运行时使新 prompt 生效。
