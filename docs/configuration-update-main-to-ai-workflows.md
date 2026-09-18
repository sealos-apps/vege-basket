# AI 工作流版本配置更新说明

本文用于把 `main` 基线 `4fb3ea5` 升级到 [PR #5](https://github.com/felixqiu014-wq/vege-basket/pull/5)。内容只列部署方需要处理的配置、发布顺序和验收项，不包含任何真实凭据。

## 升级前阻断项

这次升级把 AI 配置从用户级 `ai_settings` 改为整个实例共用的环境变量。应用启动时会删除旧表，旧的用户级模型地址、API Key 和模型名不会自动迁移。部署前必须准备好 `AI_API_BASE`、`AI_API_KEY`、`AI_MODEL`，三项缺少任意一项都会让 Veges AI 处于未配置状态。

现有 `DATABASE_URL`、`APP_ENCRYPTION_ACTIVE_KEY_ID` 和完整的 `APP_ENCRYPTION_KEYS` 必须原样沿用。不要重新生成或替换现有 key ring，否则数据库里的项目内容、AI 历史和日报记录可能无法解密。发布前先做数据库快照，并把当前完整 key ring 单独安全留存。

## 配置更新表

| 配置 | 相对 `main` 的变化 | 部署操作 |
| --- | --- | --- |
| `VEGES_IMAGE` | Sealos 模板新增必填输入 | 填写本次版本构建并发布的不可变 `linux/amd64` 镜像标签或 digest。Deployment、`originImageName` 和日报 CronJob 会共用这个值。 |
| `AI_API_BASE` | 模板中已有，本版本开始作为实例级共享 AI 配置使用 | 填写无内嵌凭据的公网 HTTPS OpenAI 兼容接口地址。 |
| `AI_API_KEY` | 模板中已有，本版本开始作为实例级共享 AI 配置使用 | 填写实例共用的 Provider Key，并按敏感配置管理。 |
| `AI_MODEL` | 模板中已有，本版本开始作为实例级共享 AI 配置使用 | 填写 Provider 实际支持的模型名。 |
| `AI_GLOBAL_RATE_LIMIT` | 新增，可选 | 单个应用副本在一个限流窗口内接受的 AI 请求总量，默认 `30`。当前窗口为 `60000` 毫秒。 |
| `APP_PUBLIC_URL` | 新增运行配置 | Sealos 模板会按 TLS Ingress 自动生成。自定义部署需填写精确的 HTTPS 根地址，例如 `https://veges.example.com`，不能带路径、查询参数、fragment 或凭据。 |
| `FEISHU_DELIVERY_ENABLED` | Sealos 模板新增投递开关 | `false` 会停止所有飞书出站通知，但不影响 OAuth 和事件接收；`true` 允许投递。首次升级可先设为 `false`，验收完成后再开启。 |
| `DATABASE_URL` | 无变化 | 沿用现有生产数据库，不要换成新库，也不要运行 `db:init`。 |
| `APP_ENCRYPTION_ACTIVE_KEY_ID`、`APP_ENCRYPTION_KEYS` | 无变化，但升级依赖现有值 | 原样沿用当前 active key ID 和完整 key ring，禁止重新生成。 |
| `FEISHU_APP_ID`、`FEISHU_APP_SECRET` | 无变化 | 沿用现有飞书应用凭据。模板会把同一组值注入 API 和日报 worker。 |
| `FEISHU_VERIFICATION_TOKEN` | 无变化 | 沿用现有值，并确认与飞书开放平台事件订阅中的 Verification Token 一致。 |
| OSS 和 `PACKAGE_MARKET_*` | 无变化 | 原样沿用当前配置。 |

`FEISHU_ENCRYPT_KEY` 仍出现在模板元数据中，但当前服务端不会读取它。不要把设置这个变量当作已经启用飞书加密事件。

部署负责人可以按下面的占位模板准备本次新增或开始生效的值。真实值应写入部署平台的 Secret 或配置界面，不要回填到仓库：

```dotenv
VEGES_IMAGE=<本次版本的不可变 linux/amd64 镜像标签或 digest>
AI_API_BASE=<OpenAI 兼容接口的公网 HTTPS 地址>
AI_API_KEY=<实例共用的 Provider Key>
AI_MODEL=<Provider 支持的模型名>
AI_GLOBAL_RATE_LIMIT=30
FEISHU_DELIVERY_ENABLED=false
```

自定义部署还需补充 `APP_PUBLIC_URL=https://<生产域名>`。使用当前 Sealos 模板时不需要手工填写，它会从 TLS Ingress 域名生成。

## 飞书开放平台

生产域名不变且当前 OAuth、事件回调均正常时，不需要修改飞书开放平台。域名发生变化时，同步检查以下地址：

| 项目 | 地址 |
| --- | --- |
| OAuth 重定向 URL | `https://<生产域名>/api/auth/feishu/oauth/callback` |
| 事件回调 URL | `https://<生产域名>/api/integrations/feishu/events` |

事件回调 URL 和 OAuth 重定向 URL 都由平台管理中的公网地址生成，不再读取 `FEISHU_OAUTH_REDIRECT_URI`，也不会根据请求来源推断。修改公网地址后需把页面展示的两条地址同步到飞书开放平台；已经开始的 OAuth 流程继续使用其签名 state 中保存的原重定向地址。

飞书自建应用的可用范围应只包含预期内部用户。Veges 会把成功的飞书 OAuth 当作内部身份，当前没有额外的租户或邮箱域名白名单。还需确认应用具有向绑定用户 `open_id` 发送消息的权限。

## 工作负载变化

本版本新增 `todo-digest` CronJob，每 5 分钟扫描一次已经到发送时间的订阅，时区为 `Asia/Shanghai`。这不表示每位用户每 5 分钟都会收到消息，实际发送时间仍由用户在账户设置中配置。

AI 对话协议与旧前端不兼容，新旧应用镜像不应同时提供服务。Sealos 模板已把应用 Deployment 设为 `Recreate`。发布后应确认应用 Pod 和日报 CronJob 使用同一个不可变镜像 digest。

API 启动会执行当前 `schemaSql`，因此启动本身会修改数据库结构。不要额外运行 `npm run db:init` 或手工反向 SQL。数据库结构不会随镜像回滚。

## 建议发布顺序

1. 对生产 PostgreSQL 做快照，安全保存当前 `DATABASE_URL` 和完整加密 key ring。
2. 准备实例级 `AI_API_BASE`、`AI_API_KEY`、`AI_MODEL`，确认三项可以组合调用目标模型。
3. 从待发布提交构建并发布不可变 `linux/amd64` 镜像，把标签或 digest 填入 `VEGES_IMAGE`。
4. 沿用数据库、加密、飞书、OSS 和 Package Market 的现有值，新增 `AI_GLOBAL_RATE_LIMIT`；自定义部署同时设置 `APP_PUBLIC_URL`。
5. 首次发布可把 `FEISHU_DELIVERY_ENABLED` 设为 `false`，部署并完成非投递验收。
6. 确认应用 Pod 与 CronJob 镜像一致，再开启飞书投递并验证一个已授权订阅。

## 验收清单

- [ ] `/api/health` 返回正常，既有账号可以登录，既有加密项目数据可以读取。
- [ ] `GET /api/ai/status` 返回 `configured: true`，并显示预期模型名。
- [ ] 普通 AI 问答逐步显示正文；项目总结、工作区复盘和待办提取显示进度，完成后一次展示最终结果。
- [ ] 飞书 OAuth 回调后仍保持登录状态。
- [ ] 应用 Pod 与 `todo-digest` CronJob 使用同一个不可变镜像 digest。
- [ ] CronJob 产生成功 Job；用户绑定飞书并开启订阅后，可以在设定时间收到日报。
- [ ] 日报中的任务标题打开当前生产域名，并定位到有权限的对应待办。
- [ ] `FEISHU_DELIVERY_ENABLED=false` 时不会发送飞书出站消息，OAuth 仍可使用。
- [ ] 开启投递前，飞书应用可用范围没有包含非预期用户。

## 回滚注意事项

回滚应用前先暂停日报 CronJob，避免故障期间继续投递。回滚到另一个支持日报 worker 的版本时，应用和 worker 必须使用同一个旧版本镜像。回滚到本功能之前的 `main` 镜像时，应保持 CronJob 暂停或直接删除，因为旧镜像不包含 `server/todo-digest-worker.ts`，只能回滚应用 Deployment。

本版本启动后已经应用的数据库结构不会自动回滚。若问题涉及数据兼容性，应停止写入并使用发布前数据库快照恢复，不要对生产库执行临时反向 SQL。
