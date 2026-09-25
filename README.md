# COMBO

**把一个 Codex 会话分享给别人，带着上下文继续聊。**

COMBO 是 [当当 Tech](https://github.com/dangdang-tech) 基于 [Happier](https://github.com/happier-dev/happier) 开发的共享编程工作台。主机连接 Codex，邀请成员通过 Google 登录网页，得到邀请创建时的聊天上下文副本，再各自继续对话。大家共同使用主机上的项目文件。

本文描述源码开发版，不代表某个测试站已完成部署或验收。仓库保留 Happier 的运行时、包名与配置变量，以便复用既有执行、加密和同步机制；上游发布的安装包不包含本 fork 的改动。

## 使用方式

1. **连接主机**：在自己的计算机上运行服务与连接端，选择由连接端管理的 Codex 会话及项目目录。
2. **发布会话**：让 Codex 调用发布命令，提供标题和用途，返回分享链接；也可以从会话信息页创建邀请。
3. **继承上下文**：创建邀请时固定已有的用户与助手文字。成员通过 Google 登录领取邀请，连接端把这些文字复制到每人的独立会话，作为继续聊天的上下文。
4. **分别继续**：A 后续发送的消息不会再复制给 B，B 的新问答也不会写回 A 的原会话。项目目录与文件仍共用，不会克隆工作区。模型使用主机方凭据，费用由主机方承担。
5. **管理访问**：主机方可以启用或禁用成员。成员可以查看和发送自己的会话，不能管理分享或批准工具权限；工具审批仍由主机方按既有执行策略处理。

主机离线时不受理新任务；网页保留草稿，上线后由用户手动发送。重新启用成员会恢复其原会话。详细规则见[共享入口说明](apps/docs/content/docs/accounts/session-sharing.mdx#shared-workspace-entries)。

## 让 Codex 完成发布

完成下方的主机连接后，Codex 可以执行发布命令并把返回的链接交给你。标题和用途会显示给打开链接的人；只发布你明确选定的会话。

已有 COMBO 会话：

```sh
yarn --cwd apps/cli dev session publish <COMBO_SESSION_ID> \
  --title '产品经理面试教练' --description '一次一道题，点评后继续。' --json
```

本机原生 Codex 会话：

```sh
yarn --cwd apps/cli dev session publish \
  --codex-thread <EXACT_CODEX_THREAD_ID> --codex-home <ABSOLUTE_CODEX_HOME> \
  --title '产品经理面试教练' --description '一次一道题，点评后继续。' --json
```

原生发布读取指定会话已保存的聊天文字，写入独立的分享来源，再创建邀请；不会接管或恢复原线程。这里的副本是文字上下文重放，不包含工具原始输出、推理、附件或 Codex 内部运行状态。不要用“最近会话”或当前目录猜测要发布的会话。

COMBO 的 MCP 提供 `session_publish` 工具。已绑定 COMBO 会话时可省略来源；发布原生 Codex 会话时需明确提供 thread ID 与 Codex home。工具和命令使用相同的发布逻辑；外部 Codex 的连接配置见 [MCP 接入](apps/docs/content/docs/extending/happier-as-mcp-server.mdx#configure-an-mcp-host)。重复发布返回已有可恢复链接及其原快照。已有 COMBO 源会话可以在网页创建新快照；原生 Codex 发布固定于首次导入，重复发布不会更新其历史，目前没有重新导入后续对话的入口。

接收者打开链接后先看到标题和用途，登录并领取自己的副本。已领取的人重新打开或刷新邀请会回到同一个副本。项目文件仍共用，执行主机需在线。

## 从源码启动

需要 Node.js 22、Yarn Classic 1.22、可用的 Codex，以及用于真实登录的 Google OAuth 配置。

```sh
git clone https://github.com/dangdang-tech/combo-workspace.git
cd combo-workspace
HAPPIER_INSTALL_SCOPE=server,cli,ui yarn install --frozen-lockfile
yarn build:packages
```

在项目根目录启动本地 SQLite 服务：

```sh
HAPPIER_SERVER_HOST=127.0.0.1 \
PORT=49321 \
HAPPIER_DB_PROVIDER=sqlite \
HAPPIER_SERVER_LIGHT_DATA_DIR="$HOME/.combo-workspace/server" \
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
export HAPPIER_HOME_DIR="$HOME/.combo-workspace/host"
export HAPPIER_SERVER_URL=http://127.0.0.1:49321
export HAPPIER_WEBAPP_URL=http://127.0.0.1:49322
export HAPPIER_CLI_RUNTIME_DISABLE=1
export HAPPIER_CLI_SUBPROCESS_PREFER_TSX=1
yarn --cwd apps/cli dev auth login
yarn --cwd apps/cli dev daemon start
```

Google 登录沿用服务端的 OIDC 配置；提供者 ID 使用 `google`，启用 verified-email 校验与 keyed signup。客户端 ID、密钥及回调地址由部署者配置，见 [Google OIDC 接入](apps/docs/content/docs/self-hosting/auth-oidc.mdx#google-keyed-accounts-with-e2ee)。共享功能还需保留 session sharing 与 content keys 开关。

### 连接远程测试环境

测试站配置地址为 `https://combo-workspace-test.43-160-242-46.sslip.io`，网页与 API 共用此 HTTPS 地址。部署就绪后，按以下步骤连接；功能验收需同时检查网页、远程 API 与执行 Codex 的主机。

在执行 Codex 的主机上完成上面的源码获取与构建，然后在仓库根目录的 Bash 或 Zsh 终端运行：

```sh
export HAPPIER_HOME_DIR="$HOME/.combo-workspace/host"
export HAPPIER_SERVER_URL='https://combo-workspace-test.43-160-242-46.sslip.io'
export HAPPIER_WEBAPP_URL='https://combo-workspace-test.43-160-242-46.sslip.io'
export HAPPIER_CLI_RUNTIME_DISABLE=1
export HAPPIER_CLI_SUBPROCESS_PREFER_TSX=1
yarn --cwd apps/cli dev auth login
yarn --cwd apps/cli dev daemon start
```

`HAPPIER_HOME_DIR` 将 COMBO 连接端的身份与状态保存在独立目录，不复用上游默认数据目录。按终端输出，在同一测试站的已登录网页中批准主机连接。主机在线后可在网页新建会话，或在上述终端继续运行 `yarn --cwd apps/cli dev codex`。新开终端时需要重新设置这五个环境变量；网页空会话引导中的复制命令会带上当前选择的服务地址与网页地址。

Google 登录与账户恢复使用当前测试站的配置；请保存账户恢复密钥。远程环境的版本升级与验收步骤见[部署说明](docs/deployment.md)。本文不把旧版本的登录或执行结果作为当前快照版本的验收结论。

## 当前范围

- 当前产品入口聚焦 Google 登录、Codex 会话和邀请分享。端到端验收应覆盖同一源码版本的服务器、网页与主机连接端。
- 加密部署为每个成员会话创建独立的数据加密密钥（DEK）；成员不会收到原会话密钥。
- 复制的是可读的用户与助手文字，不包括工具原始输出、推理过程或完整运行记录。已依赖 fork 祖先历史的来源暂不支持。
- 服务端快照最多 5,000 条主会话存储记录、2,000,000 字节；连接端上下文预算默认 120,000 字符，包含提示框架。超限或内容无法完整读取会拒绝创建，不会悄悄截断。
- 更换邀请链接保留原快照。旧邀请没有快照且已有成员时，需创建新的分享快照；旧成员及其已有会话保留，不会补入主人最新的历史。
- 共享入口的在线检查目前面向单服务进程；同一目录的并发文件修改需要参与者协调。
- 邀请链接目前没有过期时间或领取次数限制；可换链接停止新的领取，也可单独禁用既有成员。删除源会话会级联删除入口、成员及其访问授权；child 会话仍由主机方保留。这里不承诺已打开连接会即时断开。
- 已接收的任务在离线或禁用时停止分发，重新启用后可能继续；禁用访问不承诺停止正在运行的任务，也不能删除对方已经下载的历史。
- 当前重点为网页与主机连接端。iOS / Android 应用发布、公共服务、COMBO 的独立安装与更新渠道尚未配置。

## 开发与来源

前端位于 `apps/ui`，连接端位于 `apps/cli`，服务端位于 `apps/server`。内部 `@happier-dev/*` 包名、`HAPPIER_*` 环境变量及协议标识保留兼容。

本 fork 的 GitHub Actions 暂时关闭。继承的工作流含上游专用发布、维护服务与项目管理配置；启用前应配置当当 Tech 自己的目标和凭据。

COMBO 派生自 [Happier](https://github.com/happier-dev/happier)，Happier 源于 [Happy](https://github.com/slopus/happy)。保留原有版权、[MIT 许可证](LICENCE)与各组件、第三方材料的许可证。感谢上游贡献者。
