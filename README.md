<p align="center">
  <img src="./public/favicon.svg" width="72" alt="Veges 图标">
</p>

# Veges 项目篮子

Veges 是一个面向多项目并行工作的个人项目驾驶舱。它把项目日记、待办、风险、草稿、协作通知、安装包交付记录和 Veges AI 放在同一工作区，帮助用户快速恢复上下文并继续推进工作。

## 当前能力

- **项目上下文**：项目状态与标签、按日期维护的日记、风险标记、项目模块、搜索筛选和 Markdown 导出。
- **待办工作流**：跨项目待办、负责人和优先级筛选、确认或驳回、完成时间与完成人、事实时间线、备注、成员提及和图片附件。
- **Veges AI**：个人加密对话历史可跨刷新恢复；普通回复默认只保留在聊天历史中，项目回复可由用户明确转为仅本人可见的 AI 文档，项目日/周总结则自动保存为文档。明确提出当前日/周工作区复盘时，后端会按当前用户权限直接聚合项目、本人日记、待办活动、未完成待办和风险，不需要逐个选择项目或粘贴已有记录。普通回复与对话分析流式展示正文，工作区复盘、项目总结和 Markdown 待办提取只展示安全进度，最终结果仍由服务端统一保存。
- **协作与通知**：成员邀请、可撤销邀请链接、项目群通知、飞书 OAuth 绑定，以及可订阅的每日待办摘要和站内通知。
- **交付工作台**：项目交付事件、安装包市场、正式/测试版本与架构选择、OSS 临时下载链接、操作时间线、关联待办和时间线导出。
- **镜像同步**：调用固定 GitHub workflow，按个人任务查看 Run、Job 和 Step 进度；支持状态筛选、成功产物 OSS URI 和本人失败记录清理。

更细的信息组织和用户流见 [docs/ia.md](./docs/ia.md)，产品与视觉基线见 [PRODUCT.md](./PRODUCT.md) 和 [DESIGN.md](./DESIGN.md)。近期工程工作见 [ROADMAP.md](./ROADMAP.md)。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web | React 19、TypeScript、Vite 8、Tailwind CSS 4、Radix UI |
| API | Node.js 24、Express 5 |
| 数据 | PostgreSQL、应用层 AES-256-GCM 加密 |
| 集成 | 飞书开放平台、阿里云 OSS、OpenAI 兼容 AI 接口 |
| 部署 | 多阶段 Docker 镜像、Sealos 应用模板 |

## 本地启动

准备 Node.js 24 和一个可访问的 PostgreSQL 实例，然后安装依赖并创建本地配置：

```bash
npm ci
cp .env.example .env
```

至少设置 `DATABASE_URL`、`APP_ENCRYPTION_ACTIVE_KEY_ID` 和 `APP_ENCRYPTION_KEYS`。可用下面的命令生成 32 字节 Base64 密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

分别启动 API 与 Web 开发服务：

```bash
npm run dev:api
```

```bash
npm run dev
```

默认 Web 地址为 `http://localhost:5173`，Vite 会把 `/api` 代理到 `http://127.0.0.1:8787`。API 启动时会校验加密配置并应用当前数据库结构；`npm run db:init` 会额外写入演示数据，不属于常规启动步骤。

## 环境配置

以 [.env.example](./.env.example) 为配置入口：

| 配置组 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接地址，必填。 |
| `APP_ENCRYPTION_ACTIVE_KEY_ID`、`APP_ENCRYPTION_KEYS` | 敏感字段加密与密钥轮换，必填。 |
| `APP_PUBLIC_URL` | 浏览器访问 Veges 的公开根地址；本地默认 `http://localhost:5173`，用于飞书日报待办链接。 |
| `AI_API_BASE`、`AI_API_KEY`、`AI_MODEL` | 整个实例共用的 OpenAI 兼容模型配置，直接由服务端环境变量注入。 |
| `AI_RATE_*`、`AI_GLOBAL_RATE_LIMIT`、`AI_MAX_*` | 单用户/实例级 AI 请求频率、输入长度和上下文上限。 |
| `GITHUB_ACTIONS_TOKEN` | 镜像同步工作台使用的实例级 GitHub Token，仅限 `sealos-apps/sealos-pro` 的 Actions 写权限。 |
| `FEISHU_*` | 飞书 OAuth、事件回调和通知投递；启用事件回调前必须配置 `FEISHU_VERIFICATION_TOKEN`。 |
| `OSS_*`、`PACKAGE_MARKET_*` | 待办图片、安装包浏览和签名下载；启用对应能力时配置。 |
| `PORT` | API 监听端口，默认 `8787`。 |

> [!CAUTION]
> 不要提交 `.env`、数据库口令、加密密钥、飞书密钥或 OSS 访问凭据。加密密钥丢失后，已有密文无法恢复。

## 安全说明

- 项目、日记、待办、草稿、总结、成员标识和交付记录等敏感字段使用 AES-256-GCM 应用层加密；查询所需的标识使用盲索引。
- AI 服务地址只接受无凭据的 HTTPS 公网地址，并禁止自动跟随重定向；本地代理返回
  `198.18.0.0/15` Fake-IP 时会经固定公共 DNS-over-HTTPS 复核，并把验证后的地址固定到
  实际连接；其他私网地址仍拒绝。
- 共享 AI 启用后，密码注册必须来自有效项目邀请；飞书 OAuth 登录仍作为企业身份入口。单用户和实例总量使用同一时间窗限流。
- AI 对话由服务端保存 canonical turns，浏览器不能提交或伪造助手历史；普通对话不会隐式读取整个工作区。新消息先由共享模型在不读取项目或工作区事实的前提下返回严格的语义意图 JSON，不用浏览器正则猜测能力，也不允许浏览器提交可信意图。流式连接只承载增量正文、固定进度和终态通知，断流后浏览器回查服务端结果，不能把 partial text 当成完成。对话标题、用户/助手正文和附件名称/正文均加密，历史接口只返回附件元数据；删除后的会话 UUID 会保留墓碑，晚到请求不能把历史重新创建出来。
- 工作区复盘只响应明确的当前日/周复盘意图。服务端记录该 turn 使用的全部来源项目；失去任一来源项目权限或项目被删除后，该 turn 不再出现在历史接口或后续模型上下文中，重新获得全部权限后才可再次读取。
- 飞书事件回调在处理 challenge 或事件前校验 verification token；安装包下载只签发规则允许的 OSS Object Key。
- 镜像同步 Token 仅由服务端读取。任务按会话用户持久化隔离，每个用户同时只能运行一个任务，并限制每小时提交数量。
- 浏览器当前使用 `localStorage` 保存 Bearer 会话。请避免在不受信任的浏览器环境使用，并将迁移到 HttpOnly Cookie 或一次性交换流程作为上线前加固项。
- `npm run db:encrypt-existing` 会修改数据库，仅用于把历史明文迁移为密文；执行前必须备份数据库并确认完整密钥集合。

## 验证

```bash
npm run lint
npm run build
npm test
git diff --check
```

当前 Node 测试覆盖通知策略、API 错误信息脱敏、OSS Endpoint 规范化、AI Provider 安全与流式终止规则、AI turn SSE 编解码与客户端恢复、AI 会话领域与客户端状态、AI 周期、工作区复盘上下文与待办提案解析、AI 限流和日报调度。涉及待办并发、AI turn 租约、工作区复盘来源鉴权、数据库结构、项目失权或历史数据加密的变更，需要在明确授权的隔离数据库中补充集成验证。

## 部署边界

- 从主分支升级到 AI 对话历史与飞书日报版本时，部署负责人应先完成 [配置更新说明](./docs/configuration-update-main-to-ai-workflows.md)，尤其要准备实例级 AI 配置并保留现有数据库与完整加密 key ring。
- [Dockerfile](./Dockerfile) 构建前后端并以单个 Node.js 服务监听 `8787`；`main` 推送后 CI 会分别构建 `linux/amd64` 与 `linux/arm64` 镜像，再用 `docker manifest` 合并为同一个不可变标签。
- CI 工作流见 [.github/workflows](./.github/workflows)：PR 只构建镜像不推送；`main` 推送后推送 `ghcr.io/<仓库>/vege-basket:main-<12位sha>` 合并镜像，以及 `-amd64`、`-arm64` 分架构标签，镜像名由仓库名自动生成。
- [.sealos/template/index.yaml](./.sealos/template/index.yaml) 负责创建 PostgreSQL、应用工作负载、待办日报 CronJob、健康检查、Service 和 TLS Ingress。部署时必须通过 `VEGES_IMAGE` 提供由当前源码构建的不可变 `main-<12位sha>` 合并镜像标签或分架构标签/摘要；应用和日报 worker 共用这一输入。
- AI、飞书和 OSS 等运行配置与其他服务配置一样，由部署输入直接传入容器环境变量；不要把真实值写入仓库或镜像。
- 提交到 `main` 会自动构建并发布新镜像，但不会自动更新线上实例。部署仍需要把新镜像标签填入模板的 `VEGES_IMAGE`，再执行运行时健康检查。
