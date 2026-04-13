# i18n 中文适配修复追踪

## 背景

项目使用 `next-intl`，翻译文件在 `apps/web/translations/`，支持 en/zh/de/it/ja/pt/fr/es。
问题：大多数页面和组件硬编码英文，只有账户设置页面使用了 `useTranslations()`，导致切换中文后其他页面不响应。

## 已完成

| 文件 | 说明 |
|------|------|
| `components/settings/user-settings-modal.tsx` | 已使用 useTranslations，账户页面正常 |
| `app/auth/page.tsx` | 已使用 useTranslations |
| `app/(dashboard)/credits-explained/page.tsx` | 已使用 useTranslations |
| `components/referrals/*.tsx` | 已使用 useTranslations |
| `components/auth/phone-verification/*.tsx` | 已使用 useTranslations |
| `components/home/navbar.tsx` | 已使用 useTranslations（部分） |

---

## 待修复

### 高优先级（用户高频使用）

- [ ] `components/sidebar/user-menu.tsx` — "Billing", "Settings", "Log out" 硬编码
- [ ] `components/dashboard/dashboard-content.tsx` — "Ask anything...", "New session", "Failed to create session" 硬编码
- [ ] `components/dashboard/project-selector.tsx` — "Search projects..." 硬编码
- [ ] `components/scheduled-tasks/scheduled-tasks-page.tsx` — 大量状态文字、时间描述硬编码
- [ ] `app/(dashboard)/settings/api-keys/page.tsx` — 整页大量文字硬编码
- [ ] `app/not-found.tsx` — 404 页面文字

### 中优先级

- [ ] `components/common/file-preview-dialog.tsx` — "Exit fullscreen", "Fullscreen", "Open in new tab", "Close"
- [ ] `components/ui/mermaid-renderer.tsx` — "View fullscreen", "Zoom in/out", "Reset view", "Fit to viewport"
- [ ] `components/markdown/unified-markdown.tsx` — "Copied!", "Copy code"
- [ ] `components/tabs/tab-bar.tsx` — "Close {tab}", "Open menu", "Quick actions"
- [ ] `components/session/session-chat-input.tsx` — "Clear reply", "Cancel command"
- [ ] `components/tunnel/tunnel-settings-dialog.tsx` — "Copy tunnel ID"

### 低优先级（aria-label / tooltip）

- [ ] 各组件中的 aria-label、title 属性

---

## 修复记录

| 文件 | 修复内容 |
|------|---------|
| `components/sidebar/user-menu.tsx` | Billing、Settings、Log out → 使用 `sidebar.*` 翻译 key |
| `components/dashboard/dashboard-content.tsx` | Ask anything...、New session、Failed to create/execute → 新增 `dashboard.*` key |
| `components/dashboard/project-selector.tsx` | 全部硬编码字符串 → 新增 `dashboard.projectSelector.*` key |
| `components/scheduled-tasks/scheduled-tasks-page.tsx` | Active/Paused、Next/Last/On demand、时间格式、错误提示、按钮文字 → 使用 `triggers.*` key |
| `components/common/file-preview-dialog.tsx` | Exit fullscreen、Fullscreen、Open in new tab、Close、错误状态文字 → 使用 `common.*` key |
| `components/ui/mermaid-renderer.tsx` | View fullscreen、Zoom in/out、Reset view、Fit to viewport → 使用 `common.*` key |
| `components/markdown/unified-markdown.tsx` | Copied!、Copy code → 使用 `common.*` key |
| `components/session/session-chat-input.tsx` | Clear reply、Cancel command → 使用 `common.*` key |
| `components/tabs/tab-bar.tsx` | Close {tab}、Open menu、Quick actions → 使用 `common.*` key |
| `components/tunnel/tunnel-settings-dialog.tsx` | Copy tunnel ID → 使用 `common.*` key |
| `app/(dashboard)/settings/api-keys/page.tsx` | 整页所有硬编码字符串 → 使用 `apiKeys.*` key（标题、描述、沙箱令牌、公共链接、密钥列表、对话框、状态、日期、提示文字等） |

---

## 待修复（剩余）

- [ ] `app/not-found.tsx` — 404 页面
- [ ] `app/(home)/page.tsx` — 首页 hero 文字
- [ ] `app/(home)/pricing/page.tsx` — 定价页

