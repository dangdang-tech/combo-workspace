# 当当 Agent

**同一个项目，各自的 AI 对话。**

当当 Agent 是 [当当 Tech](https://github.com/dangdang-tech) 基于 [Happier](https://github.com/happier-dev/happier) 开发的共享编程工作台。主机连接 Codex，邀请成员通过网页进入各自独立的会话，共同使用主机上的项目文件。

当前为开发版，尚未发布当当 Agent 安装包或上线公共服务。仓库保留 Happier 的运行时、包名与配置变量，以便复用既有执行、加密和同步机制；上游发布的安装包不包含本 fork 的改动。

## 使用方式

1. **连接主机**：在自己的计算机上运行服务与连接端，选择由连接端管理的 Codex 会话及项目目录。
2. **创建邀请**：从会话信息页打开共享入口，创建并复制邀请链接。
3. **独立对话**：成员通过 Google 登录领取邀请；连接端为每人建立独立的空白会话。
4. **共享项目**：各会话使用同一目录，文件与改动共享，对话历史分别保存。模型使用主机方凭据，费用由主机方承担。
5. **管理访问**：主机方可以启用或禁用成员。成员可以查看和发送自己的会话，工具审批由主机方处理。

主机离线时不受理新任务；网页保留草稿，上线后由用户手动发送。重新启用成员会恢复其原会话。详细规则见[共享入口说明](apps/docs/content/docs/accounts/session-sharing.mdx#shared-workspace-entries)。

## 从源码启动

需要 Node.js 22、Yarn Classic 1.22、可用的 Codex，以及用于真实登录的 Google OAuth 配置。

```sh
git clone https://github.com/dangdang-tech/dangdang-agent.git
cd dangdang-agent
HAPPIER_INSTALL_SCOPE=server,cli,ui yarn install --frozen-lockfile
yarn build:packages
```

在项目根目录启动本地 SQLite 服务：

```sh
HAPPIER_SERVER_HOST=127.0.0.1 \
PORT=49321 \
HAPPIER_DB_PROVIDER=sqlite \
HAPPIER_SERVER_LIGHT_DATA_DIR="$HOME/.dangdang-agent/server" \
HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED=1 \
HAPPIER_WEBAPP_URL=http://127.0.0.1:49322 \
PUBLIC_URL=http://127.0.0.1:49321 \
yarn server:light
```

另一个终端启动网页：

```sh
EXPO_PUBLIC_HAPPY_SERVER_URL=http://127.0.0.1:49321 \
yarn --cwd apps/ui start --port 49322 --host localhost
```

浏览器打开 `http://127.0.0.1:49322`。本例仅供本机开发；远程成员需要可以访问的服务与网页地址。

连接端使用与网页相同的服务地址，并使用独立的数据目录：

```sh
export HAPPIER_HOME_DIR="$HOME/.dangdang-agent/host"
export HAPPIER_SERVER_URL=http://127.0.0.1:49321
export HAPPIER_WEBAPP_URL=http://127.0.0.1:49322
export HAPPIER_CLI_RUNTIME_DISABLE=1
export HAPPIER_CLI_SUBPROCESS_PREFER_TSX=1
yarn --cwd apps/cli dev auth login
yarn --cwd apps/cli dev daemon start
```

Google 登录沿用服务端的 OIDC 配置；提供者 ID 使用 `google`，启用 verified-email 校验与 keyed signup。客户端 ID、密钥及回调地址由部署者配置，见 [Google OIDC 接入](apps/docs/content/docs/self-hosting/auth-oidc.mdx#google-keyed-accounts-with-e2ee)。共享功能还需保留 session sharing 与 content keys 开关。

## 当前范围

- 已在本地 SQLite 环境验证两个独立账号的真实 Codex 执行、会话隔离、加密密钥交付、离线拒收、撤权和恢复。
- 登录集成使用签名 OIDC 测试服务验证；真实 Google 授权需要部署者完成 OAuth 配置并验证。
- 共享入口的在线检查目前面向单服务进程；同一目录的并发文件修改需要参与者协调。
- 邀请链接目前没有过期时间或领取次数限制；可换链接停止新的领取，也可单独禁用既有成员。
- 已接收的任务在离线或禁用时停止分发，重新启用后可能继续；禁用访问不承诺停止正在运行的任务，也不能删除对方已经下载的历史。
- 当前重点为网页与主机连接端。原生端发布、公共服务、当当 Agent 的独立安装与更新渠道尚未配置。

## 开发与来源

前端位于 `apps/ui`，连接端位于 `apps/cli`，服务端位于 `apps/server`。内部 `@happier-dev/*` 包名、`HAPPIER_*` 环境变量及协议标识保留兼容。

本 fork 的 GitHub Actions 暂时关闭。继承的工作流含上游专用发布、维护服务与项目管理配置；启用前应配置当当 Tech 自己的目标和凭据。

当当 Agent 派生自 [Happier](https://github.com/happier-dev/happier)，Happier 源于 [Happy](https://github.com/slopus/happy)。保留原有版权、[MIT 许可证](LICENCE)与各组件、第三方材料的许可证。感谢上游贡献者。
