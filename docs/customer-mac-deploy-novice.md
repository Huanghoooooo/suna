# 在客户 Mac 上部署 Kortix（Suna）—— 小白可跟做版

面向：**现场部署的人** 和 **客户方对接人** 都几乎不碰命令行。按顺序做即可；**不要跳步**。

> **预计总时间（首次、网速正常）**：约 1～2 小时，其中 **下载 Docker 镜像** 会占掉大部分时间。  
> **本方案**：在客户 Mac 上本机跑 **Supabase** + **沙盒（Docker）** + **用 Docker 起的 API 与网站**。适合交付演示或内网访问；**正式 7×24 上云**请用 Linux 服务器，见 `docs/deployment-modes.md`。

---

## 0. 部署前所有人一起确认 4 件事

1. 客户用的 Mac 能**联网**，且是 **macOS 较新版本**（建议近 3 年内的系统）。
2. 部署的人知道 **Mac 的管理员账户密码**（装软件、点「允许」时会要）。
3. 硬盘中**至少空出 25GB**（Docker 镜像 + 构建缓存会占空间）。
4. 当天有一整块时间，不要一边开会一边装——中间若失败，**从出错的【那一步】重来**，不必全盘重装系统。

**客户要做什么？** 多数时间只需要：**偶尔输入密码、点「允许」、最后打开浏览器访问** `http://localhost:3000`。技术操作主要由部署的人做。

---

## 1. 在 Mac 上安装这些软件（顺序随意，但必须都装好）

| 要装什么                      | 去哪装                                                                                                              | 装好后怎么知道成功了                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Docker Desktop（Mac 版）**  | 打开浏览器访问：<https://www.docker.com/products/docker-desktop/> 下载 Mac 版，拖进【应用程序】，首次打开会要权限。 | 屏幕**右上角菜单栏**出现**小鲸鱼图标**；点开后显示 **“Docker is running / Engine running”** 类似字样。 |
| **Node.js**（LTS 长期支持版） | 打开 <https://nodejs.org/> 下载 LTS，一路下一步安装。                                                               | 下面第 2 节里在「终端」输入命令能显示版本号。                                                          |
| **Git**（如果还没有）         | 打开 <https://git-scm.com/download/mac> 或安装 **Xcode Command Line Tools**（在终端会提示安装）。                   | 终端里输入 `git --version` 有一行版本信息。                                                            |
| 项目代码                      | 有 Git 地址就 `git clone`；没有就用 U 盘/网盘**把整个项目文件夹**拷到 Mac 桌面，例如 `suna` 文件夹。                | 在「访达」里能点开项目文件夹，里面能看到 `package.json` 和 `supabase` 等文件夹。                       |

> **不要** 使用 Windows 的 `.exe` 或 Linux 的 `.deb` 安装包，必须选 **macOS (Apple Chip / Intel)** 对应自己芯片的版本。

**如何认芯片**：左上角 ` ` **关于本机** 里，若写 **M1 / M2 / M3** 等选 **Apple Silicon**；写 **Intel** 就选 **Intel**。

---

## 2. 打开「终端」并装 pnpm、确认环境

1. 按 `Command(⌘) + 空格`，输入 **“终端”** 或 **“Terminal”**，回车打开。
2. **把下面这行整行复制**，粘贴到终端，按**回车**（需要联网）：

   ```bash
   corepack enable && corepack prepare pnpm@8.15.8 --activate
   ```

3. 再输入（每行后回车），应能看到版本号（数字无所谓，有就行）：

   ```bash
   node -v
   pnpm -v
   docker --version
   git --version
   ```

4. 若 `docker` 说找不到命令：先**完全打开 Docker Desktop**，等几十秒，再**关掉终端**重新打开\*\*试一次。

---

## 3. 进项目目录

假设项目在桌面上的文件夹名是 `suna`（**替换成你真实文件夹名**）：

```bash
cd ~/Desktop/suna
```

若 `cd` 后提示没有该目录：在「访达」里对着项目文件夹 **右键** → 按住 `Option(⌥)` 会出现**「将 XXX 复制为路径」**，把路径复制到终端的 `cd ` 后面即可。

**确认在正确目录**（应能看到 `package.json`）：

```bash
ls package.json
```

有输出就继续。

---

## 4. 装项目依赖

仍在项目根目录执行（第一次会下依赖，**可能要几分钟到十几分钟**）：

```bash
pnpm install
```

若报 `corepack` / `pnpm` 相关错：再执行第 2 步的 `corepack enable` 后重试。

---

## 5. 先启动 Supabase（数据库 + 登录服务）

1. 确认 **Docker Desktop 是运行状态**（小鲸鱼是绿的 / 没有报错红字）。
2. 在终端执行（**在 `suna` 根目录**）：

   ```bash
   cd supabase
   pnpm exec supabase start
   ```

3. 第一次会**拉取多个镜像**，**耐心等**；出现 **“API URL”“Studio”** 等字样、最后没有大段 `ERROR` 就成功。
4. 看账号、网址和密钥（**等下要抄到文件里**）：

   ```bash
   pnpm exec supabase status
   ```

   在输出里找类似：
   - **API URL**（一般是 `http://127.0.0.1:54321` 这类）
   - **anon public**（一长串，以 `eyJ` 开头）
   - **service_role**（也较长，**保密**，不要发群里）

5. 回到项目根目录：

   ```bash
   cd ..
   ```

---

## 6. 写配置文件（最要紧，但只需照着抄）

### 6.1 API：复制 `apps/api` 的示例文件

- 在「访达」里进：`suna` → `apps` → `api`
- 把 `.env.example` **复制**一份，改名为 **`.env`**（若已存在就打开编辑）

用「文本编辑」或 **VS Code / Cursor** 打开 `apps/api/.env`，**至少**保证（值从 `supabase status` 里**原样**抄，不要多空格、不要多引号）：

| 变量                        | 怎么填                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | 用 Supabase 文档里的 Postgres 地址；本地一般是 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`（**端口以 `supabase status` 为准，常见是 54322**）。**若下一步用 Docker 起 API，见 6.3 说明。** |
| `SUPABASE_URL`              | 和 `status` 里的 **API URL** 一致。                                                                                                                                                                      |
| `SUPABASE_SERVICE_ROLE_KEY` | `status` 里 **service_role** 的 key。                                                                                                                                                                    |
| `API_KEY_SECRET`            | 随便让 ChatGPT 生成 64 位 **十六进制**（0-9 a-f），或本机用：`openssl rand -hex 32` 粘贴进去。                                                                                                           |
| `ALLOWED_SANDBOX_PROVIDERS` | 填 `local_docker`（一般交付就这样）。                                                                                                                                                                    |
| 其它                        | 若 `apps/api/.env.example` 里标了 [REQUIRED]，**按示例注释**再补全。                                                                                                                                     |

**Docker 起 API 时（下面 `pnpm compose:up` 属于这种情况）**：`127.0.0.1` 在容器里指**容器自己**，**连不到**客户 Mac 上的 Supabase。请把 `DATABASE_URL` 里主机、以及 `SUPABASE_URL` 里的地址改成：

- 主机用 **`host.docker.internal`** 代替 `127.0.0.1`
- 例：`DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres`
- `SUPABASE_URL=http://host.docker.internal:54321`（**端口以 `status` 为准**）

`apps/api/.env` 同目录的 `.env.example` 里也有短注释，可对着改。

### 6.2 前端：建 `apps/web/.env.local`

- 在 `suna` → `apps` → `web` 里，复制 `.env.example` 为 **`.env.local`**

在 `.env.local` 里**至少**：

- `NEXT_PUBLIC_ENV_MODE=local`
- `NEXT_PUBLIC_SUPABASE_URL` = 和上面 **Supabase 的 API URL** 一样（**客户用浏览器访问的地址，一般用 `http://127.0.0.1:54321` 若网站不在 Docker 里**；若整站都 Docker 了仍可用同一套，**以能打开注册页为准**）
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `status` 里的 **anon** key
- `NEXT_PUBLIC_BACKEND_URL=http://localhost:8008/v1`（先这样；**若用域名或反代，以后再改成对外的**）

### 6.3 沙盒用 env（core/docker）

```bash
cp core/docker/.env.example core/docker/.env
```

用编辑器打开 `core/docker/.env`，在文件里**至少填一个**你们实际用的 **LLM API Key**（名字以 `.env.example` 里说明为准，例如 `ANTHROPIC_API_KEY` 等）——不填，沙盒里模型可能起不来，但**容器**可以先起。

---

## 7. 起沙盒（Kortix Computer）

仍在项目根 `suna`：

```bash
pnpm prod:sandbox:build
```

- **第一次**会**构建/拉镜像**，**非常慢**，**不要关终端、不要合盖到睡眠**。
- 成功则 Docker 里会出现以 `kortix-sandbox` 或类似为名的容器。
- 若只想不重建、直接起：可用 `pnpm prod:sandbox`（你方若已建过镜像）。

---

## 8. 起网站前端（Docker）

仍在项目根：

```bash
pnpm deploy:frontend
```

- 第一次会 **build 前端镜像**，**可能要十几到几十分钟**。
- 需存在 **`apps/web/.env.local`**（与开发时相同变量），否则前端容器会 500。

---

## 9. 起 API（在宿主机上运行，不在 Docker 里）

> **为什么不放 Docker？** API 需要通过 Docker API 管理沙盒容器（创建、启动、注入 token）。在 Windows/macOS 的 Docker Desktop 里，Bun 运行时无法可靠地通过挂载的 `docker.sock` 与宿主机 Docker 通信。所以 **API 直接在宿主机跑**，前端在 Docker 里跑。

**另开一个终端窗口**（不要关第 8 步的终端），在项目根执行：

```bash
pnpm deploy:api
```

- API 会在 `http://127.0.0.1:8008` 启动。
- 看到 `Started` 或 `listening on` 类字样、且无 `FAILED` 红字即成功。
- API 健康检查：浏览器打开 <http://127.0.0.1:8008/v1/health>，应返回含 `"status":"ok"` 的 JSON。

---

## 10. 打开网站

浏览器打开 **<http://127.0.0.1:3000>**（**注意**：用 `127.0.0.1`，**不要**用 `localhost`；两者 cookie 域不同，用 `localhost` 会一直转圈）。

- 建议 **强制刷新**（Mac: `Cmd+Shift+R`；Windows: `Ctrl+Shift+R`）。
- 应看到本产品的登录页面。若标题像「别的项目」——说明旧标签页缓存未清，关掉标签页重新打开。

---

## 11. 客户/部署的人一起「验收 3 条」

1. 浏览器能打开 `http://127.0.0.1:3000`，**无整页白屏**、无一直转圈。
2. 能**登录**测试账号。
3. 登录后进主界面，能看到实例列表；若有沙盒，确认 Docker 里沙盒容器是 **运行中**（Docker Desktop 的 **Containers** 里可看到 `kortix-sandbox`）。

**超级管理员**（给内部管理页）按 `README_ZH.md` 里 `bootstrap-admin` 脚本执行（需先有可登录的邮箱用户）。

---

## 12. 出问题时先看这里（不碰代码）

| 现象                              | 最常见原因                                                 | 做啥                                                                         |
| --------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 说 **Docker** 连不上、daemon      | Docker Desktop 没开或还在启动                              | 打开 Docker，等 1 分钟，**重开「终端」** 再试。                              |
| `supabase start` 红字、端口被占用 | 本机 54321/54322 等已被别的程序占用                        | 关掉其他占端口的本机服务，或换一台**干净**的机器试。                         |
| 能开网页但 **不能登录/报错**      | `.env` 与 `supabase status` 不一致、或 `NEXT_PUBLIC_` 写错 | 重新对一遍第 6 节，**保存文件后**重启前端容器和 API。                        |
| 网站 `127.0.0.1:3000` 打不开      | 前端容器没起来、或端口被占                                 | 终端看 `pnpm deploy:frontend` 有没有 `ERROR`；`docker ps` 看 3000 是否映射。 |
| 网站一直「登录中」转圈            | 用了 `localhost` 而不是 `127.0.0.1`                        | 换成 `http://127.0.0.1:3000` 访问。                                          |
| API 8008 连不上                   | API 终端关了 / 没跑起来                                    | 回到第 9 步的终端，确认 API 在运行；若关了重新 `pnpm deploy:api`。           |
| 沙盒实例一直报「错误」            | API 跑在 Docker 里（不是宿主机上）                         | 确认 API 是用 `pnpm deploy:api` 在宿主机终端跑的，而不是 `pnpm compose:up`。 |

**保存一切截图**：终端**最后 30 行**红字、Docker Desktop 里**红色容器**的日志，发给你们技术支持最快。

---

## 13. 和「本机开发模式」的区别（给客户一句话）

- **本指南**：尽量接近**交付/演示**（Docker 起服务 + 生产用 compose 脚本名）。
- 若现场时间不够、只要「先跑起来」：可临时用 `pnpm dev` + `pnpm dev:sandbox`（**开发**配置，有热更新，**不**当正式上线标准）——见根目录 `README_ZH.md` 第 2 节。

---

## 14. 部署结束后建议

1. 在客户机只保留**必要**人员账号；测试账号可删。
2. 若机子会外出：**勿**在咖啡厅等公共网暴露 `localhost` 到公网；对外访问必须加**反代+HTTPS+鉴权**（本小白文档不展开，见 `docs/deployment-modes.md`）。

此文档与仓库中 `package.json` 的 `deploy:frontend`、`deploy:api`、`deploy:sandbox` 等脚本保持一致；若脚本改名，以仓库**最新** `package.json` 为准。

> **Linux VPS 部署**：在 Linux 服务器上，API 可以放进 Docker 容器（`pnpm compose:up` 启用 `--profile all`），因为 Linux 原生 `/var/run/docker.sock` 可被 Bun 正常使用。详见 `docs/deployment-modes.md`。
