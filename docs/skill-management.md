# Skill 管理 | Skill Management

本文档记录 Suna 的 skill 存储结构、上传/删除流程、生效机制，以及前后端
实现位置。面向平台运维（super_admin）与后续二次开发。

This document covers skill storage layout, upload/delete workflow, how
changes take effect, and the backend/frontend implementation. Audience:
platform operators (super_admin) and future maintainers.

---

## 1. Skill 是什么 | What a skill is

**一个 skill 是一个目录**，至少含 `SKILL.md`（YAML frontmatter + Markdown），
可选 `scripts/` 子目录（Python/JS 辅助脚本）。SKILL.md 里 `name` 字段对应
目录名，`description` 在 UI 与 LLM 提示词里用来识别这个技能。

A skill is a **directory** with at least `SKILL.md` (YAML frontmatter +
Markdown body) and optionally a `scripts/` subdirectory. The `name` in
frontmatter must match the directory name; `description` surfaces in the
UI and in the LLM's skill catalog.

**最小合法 SKILL.md**：

```markdown
---
name: my-skill
description: "Short explanation the LLM reads to decide when to use this."
---

# My Skill

Detailed instructions the LLM follows once invoked.
```

**名字规范**：小写字母、数字、连字符（`/^[a-z0-9]+(-[a-z0-9]+)*$/`），
1–64 字符，例如 `account-research`、`docx`。

Names are lowercase-hyphenated, 1–64 chars.

---

## 2. 磁盘结构 | On-disk Layout

```
core/kortix-master/opencode/skills/
├── GENERAL-KNOWLEDGE-WORKER/       # 上游随 repo 发布的通用 skill
│   ├── account-research/
│   │   └── SKILL.md
│   └── docx/
│       ├── SKILL.md
│       └── scripts/
├── KORTIX-system/                  # 上游随 repo 发布的平台 skill
│   └── agent-browser/
│       └── SKILL.md
└── custom/                         # ← 管理员上传的自定义 skill 全在这
    ├── demo-skill/
    │   └── SKILL.md
    └── my-internal-skill/
        ├── SKILL.md
        └── scripts/
```

**为什么分 `custom/`**：
- 上游更新 repo 时 `GENERAL-KNOWLEDGE-WORKER/` / `KORTIX-system/` 可能被覆盖
- `custom/` 是平台方私有命名空间，绝不与上游冲突
- 卸载自定义 skill = 删 `custom/<name>/` 目录
- 上游 skill 要改 / 删 → 直接 patch repo，不走管理 UI

---

## 3. 管理 UI | Management UI

**路径**：`/admin/skills`（仅 super_admin 可见；平台 `admin` 会看到"仅限
super_admin"提示）。

**能力**：
- 列表：显示所有 `custom/` 下 skill 的名称、描述、是否有 scripts/、修改时间
- 上传：Dialog 填 skill 名 + 选 zip → 解压到 `custom/<name>/`
- 删除：二次确认后 `rm -rf` 对应目录

**Accessible at** `/admin/skills` (super_admin only). Features: list with
name/description/scripts-flag/mtime, upload zip dialog, delete with
confirmation.

### Zip 格式要求 | Zip format

zip 解压后必须能找到 `SKILL.md`。两种合法形态都支持：

**形态 A（推荐）**：zip 根直接是 SKILL.md 与 scripts/

```
demo.zip
├── SKILL.md
└── scripts/
    └── helper.py
```

**形态 B**：zip 根只有一个目录，SKILL.md 在该目录里

```
demo.zip
└── demo-skill/
    ├── SKILL.md
    └── scripts/
```

后端自动探测（看根有没有 SKILL.md，没有就找唯一顶层目录），flatten 后放进目标目录。

The backend auto-detects: if SKILL.md is at the zip root it uses that;
if there's exactly one top-level directory containing SKILL.md it flattens
that directory.

### 上传前快速打包 | Quick pack on your machine

```bash
# 在你本机上
mkdir -p demo-skill
cat > demo-skill/SKILL.md <<'EOF'
---
name: demo-skill
description: "示例 skill。"
---
# Demo
这是一个示例。
EOF
zip -r demo.zip demo-skill
# 上传 demo.zip，填名字 demo-skill
```

---

## 4. 生效机制 | How changes take effect

**上传/删除 skill 只改仓库磁盘文件，不会主动通知沙盒**。沙盒在下列情况重读
skills：

Upload/delete only touches repo disk. Running sandboxes pick up changes on:

- 沙盒**进程重启**（`pnpm dev` 重起、容器 restart、或 `/admin/sandboxes`
  里 stop → start）
- 沙盒内部调用 `client.instance.dispose()`——这是 OpenCode 的"dispose-only"
  热重载，2 秒左右完成，但目前**管理 UI 没暴露按钮**
- 新建的沙盒自然从磁盘加载最新 skills

**Manual trigger inside a sandbox**: OpenCode's `client.instance.dispose()`
hot-reloads config from disk in ~2s. No UI button for this yet.

结论：**上传一个 skill，想让现有沙盒立刻用上，要去 `/admin/sandboxes`
重启对应沙盒**。新建沙盒的会自动看到。

---

## 5. 权限模型 | Permissions

| 操作 | 谁能做 | 实现位置 |
|---|---|---|
| 查看自定义 skill 列表 | super_admin | `GET /v1/admin/api/skills` |
| 上传 skill | super_admin | `POST /v1/admin/api/skills` |
| 删除 skill | super_admin | `DELETE /v1/admin/api/skills/:name` |
| 改上游 skill | 谁有 repo 提交权谁改 | 直接 PR 到 repo |
| 沙盒调用 skill | 沙盒内的任意 session | OpenCode 自动加载 |

平台 `admin` **不能**管理 skill——管理 UI 前端直接显示"仅限 super_admin"，
后端 `requireSuperAdmin` 兜底返回 403。原因：skill 注入相当于把代码部署
到所有沙盒，属于平台级改动，不适合授权给运营层的 admin。

Regular platform `admin` cannot manage skills — the UI and backend both
gate to super_admin. Skills ship to every sandbox; treating them as an
ops-level permission would be a footgun.

---

## 6. 故障排查 | Troubleshooting

| 症状 | 原因 | 修复 |
|---|---|---|
| `Repo root not found; skills dir unavailable` | API 找不到仓库根 | 设 `KORTIX_REPO_ROOT=/path/to/suna` 环境变量，或确认 `pnpm-workspace.yaml` 存在于预期路径 |
| `Skill "xxx" already exists` | 同名 custom skill 已存在 | UI 里先删旧的，或换名字 |
| `Zip must contain SKILL.md` | zip 根没 SKILL.md 也没有唯一顶层目录含 SKILL.md | 按 §3 两种形态重新打包 |
| `Invalid name` | 名字不符合 lowercase-hyphenated 正则 | 只用 `[a-z0-9-]`，中间不能连续连字符 |
| 上传成功但沙盒看不到 | 运行中的沙盒未重启 | `/admin/sandboxes` 里 stop → start，或让沙盒内触发 instance dispose |
| `Failed to install skill` + unzip 错误 | 系统缺 `unzip` 命令 | 容器镜像里装 `apt-get install -y unzip`（Alpine: `apk add unzip`） |

---

## 7. 与上游 skill 的关系 | Relation to upstream skills

- **上游 skill**（`GENERAL-KNOWLEDGE-WORKER/`、`KORTIX-system/`）走正常的
  Git 工作流——在 feature 分支改 SKILL.md → PR → merge，跟普通代码一样。
- **自定义 skill**（`custom/`）通过 UI 上传，走文件系统路径，**不进 Git**。
  企业部署时如果你希望 custom skill 被 Git 跟踪：
  1. `custom/` 默认 `.gitignore` 没排除，会被 Git 看到——上传完 commit 即可
  2. 或者你希望 custom 不进 Git，在 `.gitignore` 加 `core/kortix-master/opencode/skills/custom/`

- **Upstream skills** follow the usual Git flow — commit SKILL.md changes
  like any other file.
- **Custom skills** land on disk via UI. They are NOT git-ignored by
  default, so you can commit them; add `custom/` to `.gitignore` if you'd
  rather they stay out of Git.

---

## 8. 文件索引 | File Index

```
apps/api/src/admin/
├── index.ts                      # 挂载 /api/skills 到 adminApp
└── skills.ts                     # GET/POST/DELETE 实现

apps/web/src/
├── app/(dashboard)/admin/skills/
│   └── page.tsx                  # 管理 UI
├── hooks/admin/
│   └── use-admin-skills.ts       # React Query 封装
├── lib/menu-registry.ts          # admin-skills 菜单条目 + VISIBLE_IDS
├── lib/tab-route-resolver.ts     # /admin/skills 的 tab 描述
└── components/tabs/page-tab-content.tsx  # /admin/skills → AdminSkillsPage

core/kortix-master/opencode/skills/
├── GENERAL-KNOWLEDGE-WORKER/     # 上游
├── KORTIX-system/                # 上游
└── custom/                       # 管理 UI 落盘目录
```

## 9. 未来增强 | Future Enhancements

本期只做"先有个样子"，已知缺口：

Known gaps (intentionally out of scope for v1):

- [ ] 上传后自动触发所有活动沙盒的 `instance.dispose()`，免去手动重启
- [ ] 预览 SKILL.md 内容（直接在 UI 里 render Markdown）
- [ ] 编辑 skill（当前只能删了重传）
- [ ] skill 版本管理 / 回滚
- [ ] 按 account 分配"哪些 skill 可见"（当前所有沙盒都能看所有 skill）
- [ ] 上传大小 / 文件数 / 白名单后缀限制（目前任由 zip 解压）
