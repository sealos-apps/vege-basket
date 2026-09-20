# 平台管理实施计划

状态：2026-09-18，主体功能已在本分支实现；数据库迁移、真实第三方连通性、浏览器端到端和生产发布仍待授权环境验收。本文不授权连接生产数据库、迁移或发布。

本文同时作为实施依据和交付核对记录，取代 `.context/platform-settings-design.md` 中的讨论和待确认表述。字段逐项去向见 [配置字段覆盖清单](platform-management-field-coverage.md)。

## 1. 目标和边界

在现有 React/Vite、Express、PostgreSQL 架构内增加独立“平台管理”页面。业务配置加密落库、版本化保存、自动热更新；超级管理员管理平台配置、现有用户权限和组织生命周期。继续使用现有资源权限、AES-256-GCM、事务与确认弹窗，不增加配置中心、Redis 或独立后台服务。

已确定的产品规则：

- 只有主动选择“超级管理员”身份才进入平台管理。平台授权独立于职业角色，不授予项目或测试空间所有者权限。
- `admin` 永久为内置超级管理员，不可撤权、删除、禁用、离职、改登录名或取消本地密码认证；其他超级管理员可在页面授予和撤销。
- 不提供添加用户功能。普通新用户只通过飞书自动注册；保留既有历史账号及业务关系、既有密码登录，以及本地维护命令初始化内置 admin 的例外。
- 新建组织和删除组织只在平台管理中提供；组织管理员视图移除这两个入口。非空组织禁止删除，不能自动解绑或清空资源。
- 对象存储始终开启；配置缺失显示“待配置”。无关闭开关、历史存储区、多存储配置选择器。
- 全局 AI 只提供现有八个参数；五项限制沿用现有有效值，未配置时使用现有默认值，不新增分类或并发参数。
- 飞书两个回调地址由公网地址自动生成、只读、可复制。隐藏私聊 AI 和 OAuth state 密钥输入，但保留已有后台能力与配置。
- GitHub 可修改仓库、工作流文件和分支，提供只读可用性测试；测试不触发工作流。
- 移除包市场三个目录/模板独立输入，保留必要的旧路径兼容，完整规则必须校验。
- 凭据有显示/隐藏按钮，包含已保存值和新输入值；普通查询不返回明文。APP 根密钥、内部旧签名材料和账户密码不允许查看。
- 沿用现有界面结构，优先中文，使用“访问账号”“公网地址”“附件大小（MB）”；不显示“返回工作台”。

首期新增 SMTP 配置、连接验证和显式测试邮件。不包含密码找回、邀请邮件或邮件日报。也不包含自动迁移 OSS 对象、跨飞书应用迁移、在线 APP 根密钥轮换、整库透明加密、应用自发布、飞书加密事件协议或可调通知发送间隔。

这是跨模块改造，当前提交包含应用、迁移、测试和文档；单独交付页面不能视为热更新或权限迁移完成。隔离数据库与真实集成验收、生产迁移和发布仍需单独安排窗口。

## 2. 当前依据和必须同步的规则

已核对 `docs/architecture.md`、`docs/references.md`、`docs/runbook.md`，以及 `server/index.ts`、`roles.ts`、`schema.ts`、`crypto.ts`、`package-market.ts`、`image-sync-workflows.ts`、`todo-digest-worker.ts` 和现有设计记录。

| 当前情况 | 实施要求 |
| --- | --- |
| `roles.ts` 同步从 `VEGES_ADMIN_USERNAMES` 判断超管，更新日志也复用它 | 所有调用点改为以 userId 查询数据库授权，不能只替换新页面接口 |
| `organizations.ts` 现有创建已检查超管，删除允许组织管理员并解绑资源 | 创建入口搬迁，删除语义重写，旧删除接口停用 |
| 附件上限、前缀及上传 parser 在启动时创建 | 上传解析前获取有效配置，新上传采用新 parser 限制 |
| 飞书私聊重试定时器在 API 进程内，启动时按开关决定是否创建 | 改为常驻调度、每轮读配置；不虚构独立“通知 worker” |
| 日报通过独立 CronJob 执行 | 启动及投递前读取配置，不登记常驻实例心跳 |
| 邮箱发送模块尚不存在 | 新增 SMTP 适配层，采用 Nodemailer，不手写 SMTP 协议 |
| 项目使用 `js-yaml` 5.2.0，原型用了独立 4.1 bundle | 正式实现使用项目依赖，不复制原型 vendor bundle |

用户已明确的新需求取代 AGENTS.md 中“超管仅来自 env”“共享 AI 只读 env”“有邀请可密码注册”和原组织删除规则。实施时同步这些规则和运行文档；禁止用户级 AI 配置、资源授权、SSRF 防护、加密、事务及人工确认要求继续保留。

## 3. 启动配置与默认值

`~/.vage.env` 只保留以下启动配置，不自动覆盖用户文件。使用已有 dotenv，通过 `DOTENV_CONFIG_PATH` 显式选择文件；不让开发工作区自动加载主目录文件。部署进程环境优先，文件权限为仅所有者可读写。

| 配置 | 必需性/现有默认值 |
| --- | --- |
| `DATABASE_URL` | 必需 |
| `APP_ENCRYPTION_KEYS` | 必需，保留所有仍被引用的 key ID 和原密钥 |
| `APP_ENCRYPTION_ACTIVE_KEY_ID` | 必需 |
| `PORT` | 可选，8787 |
| `DB_POOL_MAX` | 可选，10；LISTEN 连接另计，CronJob 按现有独立预算 |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | 可选，3000 |
| `DB_POOL_IDLE_TIMEOUT_MS` | 可选，30000 |

`NODE_ENV`、`DOTENV_CONFIG_PATH`、开发代理端口、数据库组装参数、镜像和 CI/Kubernetes 凭据继续属于运行/部署输入。它们不进入平台业务设置。`VEGES_ADMIN_USERNAMES` 仅供一次性导入，导入完成后不参与授权；其他业务 env 同样不再参与运行时读取或故障回退。

| 现有参数 | 缺省时实际生效值 | 页面与迁移要求 |
| --- | --- | --- |
| `AI_RATE_LIMIT` | 5 | 每用户每窗口请求上限 |
| `AI_GLOBAL_RATE_LIMIT` | 30 | 每应用副本上限，不是所有副本合计 |
| `AI_RATE_WINDOW_MS` | 60000 | 页面显示 60 秒，存毫秒 |
| `AI_MAX_MESSAGE_LENGTH` | 2000 | 字符数 |
| `AI_MAX_CONTEXT_CHARS` | 12000 | 字符预算，不是 token |
| `TODO_IMAGE_UPLOAD_MAX_BYTES` | 10485760 | 页面显示 10 MB，仍按 1024×1024 换算，保留导入的精确字节数 |
| `TODO_IMAGE_OBJECT_PREFIX` | `todo-images` | 已使用后不能通过普通保存/恢复更换 |
| `TODO_IMAGE_URL_SECRET` | 无固定默认值 | 原代码按 `??` 依次回退 state 密钥、整个 APP 密钥环字符串；显式空字符串不回退 |
| 包市场默认下载时长 | 1800 秒 | 显式值优先；不能用示例文件的 600 秒覆盖 |

附件大小适用于待办图片和测试证据，不改变 AI 文本附件限制。其余已有校验范围和默认值从原解析器抽取为纯函数并共享，导入当前实际生效值，不重设为模板值。

## 4. 数据模型和模块分工

新增 DDL 同时进入 `server/schema.ts` 和 `server/migrations/20260917_platform_management.sql`，保持幂等。配置按完整不可变快照保存，分区保存合并后产生全局递增版本，避免 URL、密钥与模型跨版本拼接。

| 数据对象 | 字段与约束 |
| --- | --- |
| `platform_config_versions` | revision 主键、schema_version、payload_encrypted、created_by、created_at、source；完整配置用 `encryptText` 加密，插入后不可更新 |
| `platform_config_state` | 固定单行、active_revision 外键、updated_at；保存锁此行并比较 expectedRevision |
| `platform_security_secrets` | 用途、key_id、加密材料、legacy 标记、创建时间；配置仅保存当前签名 key_id；验证所需旧材料独立保留 |
| `platform_admin_grants` | user_id 主键、builtin/managed、来源 bootstrap/env_import/platform/maintenance、授予人/时间；builtin 唯一且不可撤销 |
| `platform_user_permission_versions` | user_id 主键、revision；角色、超管授权、账户状态变化均推进版本 |
| `platform_config_mutation_receipts` | actor_user_id/request_id 唯一、动作、keyed digest/key_id、结果版本；与配置写入同事务 |
| `platform_user_mutation_receipts` | 同上，关联目标用户与权限版本；不得承载新增普通账号操作 |
| `platform_organization_mutation_receipts` | 同上，记录 create/delete 和原组织 ID；不因组织删除级联丢失 |
| `platform_audit_events` | 操作者、动作、字段路径、前后版本、目标 ID、requestId、时间；不存凭据值，敏感自由文本加密 |
| `platform_config_runtime_status` | 进程启动 UUID、process_kind、applied_revision、心跳、脱敏错误码；当前常驻类型只有 API |
| `platform_bootstrap_receipts` | 步骤唯一主键、完成时间、来源；一次性初始化与导入回执，不保存 env 原文 |
| `platform_security_inspections` | 巡检时间、状态、key ID 引用计数和脱敏结果；页面读取最近结果，不在 GET 中全库扫描 |

在 `project_package_items` 和 `test_bug_verification_packages` 增加 `source_config_revision` 外键，记录下载授权的规则版本；新写入由服务端验证选包后赋值，不接受客户端可信版本。旧行按初次导入的有效规则验证并回填，无法匹配的行在报告中逐项列出，禁止猜测。GitHub 运行表同样记录规范化目标与创建时配置版本。组织级规则 ID 引用在全局规则修改时一起检查，不能因删除规则静默扩大组织可见范围。

`users` 增加 `is_builtin_admin`、`registration_source`（builtin/feishu/legacy_unknown）及历史用户飞书身份核实时间。新注册来源由服务器创建路径写入。迁移前已经保存合法 `ou_` Open ID 的 legacy_unknown 账号视为既有飞书绑定，可纳入现有飞书用户选择器，但不伪造原始注册来源；新来源账号仍必须成功完成官方飞书 OAuth、校验绑定唯一性和 active 状态，并写入身份核实时间。已有 env 导入授权继续保留，重新授予必须满足同一资格规则。

内置用户 CHECK 约束 active 状态、规范化登录名 admin 和非空密码哈希，部分唯一索引保证唯一。触发器禁止取消 builtin 标记、改登录名、禁用/离职、删除用户或删除 builtin 授权；延迟约束确保用户与授权一致。初始化完成后服务就绪检查必须发现该账号与授权，不自动补写掩盖损坏。数据库约束保护普通 DML，不承诺防止数据库所有者删除约束。

| 文件/模块 | 责任 |
| --- | --- |
| `shared/platform-config.ts`（新增） | 非敏感 DTO、分区 ID、规则校验结果；不导出服务器凭据类型 |
| `server/platform-config-schema.ts`（新增） | 完整私有配置类型、默认值、严格校验、掩码 DTO 和字段操作白名单 |
| `server/platform-config-store.ts`（新增） | 快照事务、幂等回执、审计与恢复 |
| `server/platform-config-runtime.ts`（新增） | LISTEN、5 秒核对、单次操作快照、客户端生命周期和加载状态 |
| `server/platform-admins.ts`（新增） | 数据库授权、builtin 保护、平台授权锁和聚合权限服务 |
| `server/platform-organizations.ts`（新增） | 平台组织目录、创建/预检/删除、阻止项分类；复用现有组织领域校验 |
| `server/platform-config-tests.ts`（新增） | 候选配置测试编排和 Nodemailer SMTP 适配 |
| `server/platform-config-cli.ts`、`server/platform-legacy-config.ts`（新增） | 明确子命令、一次性导入、只读核对及纯旧配置解析 |
| `server/init-db.ts`、`server/encrypt-existing.ts` | 正式初始化只应用 schema/必要领域迁移；示例账号和项目移出到显式测试夹具，新增敏感列支持幂等加密 |
| `server/index.ts`、`roles.ts`、`changelog.ts`、账户治理模块 | 鉴权入口和现有超管能力一起迁移 |
| AI、OSS、GitHub、飞书、日报、组织邀请、周报等配置消费者 | 显式接收同一操作快照；清理业务 `process.env` 和模块级缓存 |
| `src/components/platform-management-workbench.tsx`、对应 CSS（新增） | 页面框架、分区表单、用户/组织治理、凭据控件与状态；复用现有设计系统 |
| `src/App.tsx`、`src/api.ts`、`src/types.ts`、现有角色/组织组件 | 管理视图、协议、角色菜单、原入口迁移 |

## 5. 公共接口契约

所有 `/api/admin/*` 每次验证有效会话、active 账户和数据库平台授权，不从客户端身份选择推断权限。以下路径已按此契约实现；保留现有资源 API 的独立授权。

| 接口 | 契约 |
| --- | --- |
| `GET /api/platform-info` | 仅平台名称和可用登录方式；不公开集成地址、桶或账号 |
| `GET /api/admin/platform-config` | 脱敏配置、revision、凭据 configured 状态和可编辑性；前端从公网地址实时生成两条回调地址 |
| `PUT /api/admin/platform-config/:section` | expectedRevision、requestId、该分区 fields、secrets；只允许明确 keep/replace/clear，不接收掩码作为值；服务端规范化比较后无变化则返回 `changed: false`，不创建版本、审计事件或热更新通知 |
| `POST /api/admin/platform-config/:section/secrets/:field/reveal` | expectedRevision；单字段白名单读取当前值，审计后返回 value/revision、no-store；不支持历史值或任意路径 |
| `POST /api/admin/platform-config/:section/test` | 当前候选 fields/secrets 和基准版本；不保存，返回逐项结果和候选摘要；邮件发送使用明确 send-email 动作 |
| `POST /api/admin/platform-config/packages/validate` | 精确 YAML 文本；只解析/校验，返回 valid、错误路径/行列、规则数及兼容提示，不访问 OSS |
| `GET /api/admin/platform-config/history` | 分页元数据、变更分区和数量；不返回配置密文或明文密钥 |
| `GET /api/admin/platform-config/history/:revision` | 按需返回该版本相对前一版本、相对当前版本的字段级脱敏差异；密钥只显示配置状态，规则文本按长文本展示 |
| `POST /api/admin/platform-config/restore` | targetRevision、expectedRevision、requestId；先返回待恢复差异，确认后重新校验当前约束并创建更高版本；目标与当前一致时不创建版本 |
| `GET /api/admin/platform-config/runtime` | 当前 revision、已知 API 实例加载版本/心跳/错误、CronJob 下次执行加载说明 |
| `GET /api/admin/platform-security` | 加密覆盖说明、key ID 引用和最近巡检结果；无密钥材料 |
| `GET /api/admin/users` | 复用现有查询，增加来源/核实状态、permissionVersion、平台授权和 builtin 能力标记 |
| `PATCH /api/admin/users/:userId/permissions` | roles、platformAdmin、expectedVersion、requestId；一次事务保存职业角色和平台授权 |
| `GET/POST /api/admin/platform-admins` | 列表/给已有合格用户授予超管；写操作含 expectedVersion、requestId，复用聚合权限服务 |
| `DELETE /api/admin/platform-admins/:userId` | expectedVersion、requestId；撤销 managed 授权，builtin 始终拒绝 |
| 现有用户 status/offboarding-preview/offboard | 保留交接校验，补 builtin 保护、expectedVersion、幂等和授权撤销 |
| `GET/POST /api/admin/organizations` | 分页治理元数据/创建；创建输入 name、ownerUserId、requestId |
| `GET /api/admin/organizations/:id/deletion-check` | 一致快照检查 name、canDelete、blockers 类别/数量、checkedAt |
| `DELETE /api/admin/organizations/:id` | confirmationName、requestId；事务内重查并删除空壳 |
| `GET /api/admin/platform-mutations/:scope/:requestId` | scope 为 config/users/organizations；授权查询本人请求的 canonical receipt，用于响应丢失核对 |

不增加 `POST /api/admin/users`。`POST /api/auth/register` 拒绝新增账号，含持邀请请求，返回 `REGISTRATION_VIA_FEISHU_ONLY`；未登录邀请流转飞书后接受成员关系。旧 `DELETE /api/organizations/:id` 对已认证调用返回 `410 ORGANIZATION_DELETE_MOVED`。其他旧超管/角色写接口统一委托新服务，不能保留旧 env 授权路径。

无登录 401、无授权 403；版本冲突/幂等键内容冲突/builtin 保护/非空组织/迁移限制为 409，分别使用稳定错误码。校验失败 422；数据库或有效配置暂不可用 503。组织非空返回 `ORGANIZATION_NOT_EMPTY` 与最新 blockers，不能把 FK 失败变成模糊成功。

幂等摘要使用带用途的 keyed digest 并保存 key ID，不保存输入凭据原文；相同 requestId、不同内容拒绝，重放相同内容返回原结果。回执和操作同事务，配置历史及回执首期不自动清理。自撤权/自离职的响应丢失，只允许仍有有效身份的本人读取该请求的最小完成状态；会话已失效则退出管理界面，不能为核对放宽其他管理读取权限。

## 6. 保存、恢复与热更新

```text
平台页面 -> 认证 API -> 配置版本 + 当前指针 + 审计 + 幂等回执
                            PostgreSQL 事务提交
                                   |
                            NOTIFY(revision)
                                   |
                      各 API 配置管理器（含内嵌调度器）
                       /           |             \
                  自动加载      5 秒核对       版本/心跳回执
                                   |
                         按版本持有集成客户端

每次新配置相关操作 -> 读取数据库当前版本 -> 取得一致快照 -> 执行业务
独立日报 CronJob   -> 启动加载；每次投递前重新检查有效版本
```

1. 保存先完整校验输入，在同一 PoolClient 事务中依次取得平台授权锁、复查操作者、锁当前指针、比对版本、校验历史引用限制、写快照/回执/审计、切换指针并发 NOTIFY。外部网络测试不在事务内执行。
2. 每个 API 进程用一条专用连接 LISTEN，计入连接预算。先提交 LISTEN，再读版本；掉线重连后全量核对。保存进程提交后主动刷新。每 5 秒核对版本，单个刷新任务合并通知，应用版本只能前进。
3. 严格解密和校验整份快照，构造所需客户端后原子切换；不能用宽松解密默认值把损坏配置当作未配置。允许未配置的集成使用明确 unavailable 适配器，管理服务可进入配置页面；外部凭据测试失败不使整个管理面板失效。
4. 每次新配置相关操作直接读取数据库版本，落后就先加载；失败拒绝开始该动作，不无限沿用旧参数或回退 env。版本查询是该动作选择配置的时间点，随后并发保存不追溯取消已经开始的动作。
5. 单次动作固定一份快照。AI 分类和生成是两个动作，各自核对配置，保留 canonical receipt/TTL 和原有权限校验。既有请求不混用主机和凭据；等待、重试、下一次外部发送重新检查启用状态。
6. AI 限流配置更新不清空已用额度。飞书 token 按应用及凭据版本隔离，OSS/SMTP 按分区版本隔离；无关分区变化不重复建立客户端，旧客户端待使用者结束后释放。飞书重试定时器始终存在、每轮检查隐藏开关，避免启动关闭后永远不能启用。
7. 上传路由在解析请求体前取得快照，按当前附件大小选择 parser；新上传生效，已开始上传固定旧限制。签名、校验、包市场缓存、分享链接、周报/邀请通知和日报均纳入消费者清单。
8. API 每 15 秒心跳并报告 appliedRevision；45 秒无心跳显示未知，加载失败显示错误码。页面区分“已保存”“加载中”“已生效”“加载异常”，保存成功不能因本机刷新失败显示成未保存。仅报告已知实例，不能声称发现了所有部署副本。
9. CronJob 启动和实际投递前读当前值，不占常驻 LISTEN 连接；保留投递幂等和租约。无数据库时暂停新的外部动作，不重复发送已经成功的通知。
10. 恢复旧版本也走相同事务、当前 schema 校验、位置/身份约束和热更新，不倒退 revision。回调地址随恢复后的公网地址生成；平台授权、用户状态和组织生命周期不随配置恢复，签名旧材料只追加保留，不能因恢复而删除。

正常路径自动通知；漏通知时在 5 秒加加载耗时内收敛。网络/解密故障不承诺硬时限，以实际状态报告。平台非敏感信息最多缓存 5 秒，页面重新聚焦时刷新。

## 7. 管理员、用户和凭据安全

平台写事务、撤权、禁用和离职统一先取平台授权 advisory lock，再遵守组织编号、项目编号和资源行的既有锁序；锁内重查操作者。全部旧写入口必须迁入同一锁序，不能有先锁用户/组织、后取平台锁的逆序路径。

内置 admin 通过本地命令初始化：已有账号保留 ID、密码哈希和业务关联；缺失才隐藏输入密码后创建，绝无默认密码。已有 admin 不 active、无有效密码或规范化重名时阻止自动导入；由显式维护命令恢复登录能力，不能自动复活离职成员关系。第三方注册/自动邮箱关联拒绝占用大小写和首尾空格变体的 admin；主动绑定只能由已认证 admin 发起。

`VEGES_ADMIN_USERNAMES` 去空白、小写、去重后解析已有 active 账号；不存在或非 active 使导入整体失败，不顺带创建账号。空名单也写导入完成回执，始终有 builtin admin。再次导入、重启和配置恢复都不能恢复已撤销授权。

角色、启停、离职保持现有功能。managed 超管禁用时授权暂不生效，重新启用恢复；离职与授权撤销在同一事务，保留原交接预检。admin 的职业角色可以调整，builtin 权限不可调整；普通超管可以撤销自己的 managed 授权。

凭据查看使用专用控件：已保存值按需调用 reveal，输入草稿只切换本地 password/text。查看值与编辑值分开，不因为显示创建脏状态。服务端在平台授权锁事务内复核权限、当前 revision、字段白名单，解密一个字段并记录无值审计；返回 `Cache-Control: no-store`，排除日志/追踪响应体。

30 秒、失焦、离页、身份切换、保存、退出或获知撤权后清除明文；异步响应绑定页面、字段、版本和请求序号，过期结果丢弃。未配置眼睛禁用，失败保持掩码。不可查看 APP 密钥环、隐藏 state、bcrypt 密码哈希或从 APP/state 派生的旧附件签名材料；迁移后生成的独立附件密钥才可查看。

数据库加密沿用应用层 AES-256-GCM：配置快照/历史、外部密码、签名材料和敏感业务文本加密；关系 ID、状态和时间仍可查询，账户密码继续 bcrypt。扩展 `db:encrypt-existing` 支持新增敏感列的幂等补齐，不宣称它可自动轮换全部既有密文。巡检还须检查盲索引、模块 lookup key、AI 摘要、回执摘要和历史配置引用；数据库磁盘及备份加密由基础设施负责。

## 8. 组织生命周期

平台列表仅返回组织名称、所有者、成员/项目/测试空间数量、canDelete、阻止类别及检查时间，分页检索。超管不会因此获得所有组织的业务正文或合成 owner 身份。

新建复用名称规范化、加密和 blind index 唯一规则。所有者选择已有 active 飞书身份已核实用户或 builtin admin；同事务创建 owner 关系、补 organization_admin 职业角色并审计、推进相应权限版本。不自动加入操作者、不授予平台权限、不自动写空的自定义设置行。重复名称 409，任一步失败全回滚。

空组织允许组织基础行、唯一的当前 owner 成员关系和需要保留的审计。除此之外，关联行仍存在即阻止，不按 active 筛选历史：

| 类别 | 阻止项 |
| --- | --- |
| 成员 | 非当前 owner 的任意成员关系，含 removed |
| 资源 | 任何关联项目、测试空间，含完成、停用、归档 |
| 邀请 | 邀请、邀请链接，含过期、撤销、已接受 |
| 周报 | 周报、修订、来源、汇总、提醒，含草稿与完成记录 |
| 组织目录 | 组织模块、测试环境和绑定，含停用 |
| 设置 | 显式组织功能、包市场渠道/选取/可见范围/覆盖等设置行 |
| 转移与交接 | 项目转移、组织相关离职交接及其他保留引用，含已完成 |

预检用只读一致快照；删除提交在事务内重新校验，不能相信 canDelete。取得平台授权锁、组织 catalog 锁、相关项目排序锁后才将组织行升级到 `FOR UPDATE`，避免现有治理审计 FK 的死锁；原初始 `FOR KEY SHARE` 不提前加强。校验完整确认名称、操作者权限和全部 blocker 后只删 owner 关系与组织壳，不删账号、不撤全局职业角色、不解绑资源。

枚举 PostgreSQL 中所有引用 organizations 的 FK，并检索无 FK 的逻辑引用（含 JSON 中的组织 ID），建立显式分类注册表及测试。业务引用改为 RESTRICT；owner 成员表也改 RESTRICT，事务明确删唯一允许的 owner 关系。审计 FK 改可空 SET NULL，增加不可变 original_organization_id 和加密组织名称快照，幂等回填旧审计。组织 BEFORE DELETE 防护拒绝仍有业务数据的直接 DML；审计例外不参与空判断。未知引用分类必须让迁移检查/测试失败，不能默认级联处理。

审查组织绑定、成员/邀请、周报 worker、自定义设置等写入路径：遵守组织 catalog 锁并复查组织存在；FK 负责最后一道完整性约束。非 FK 逻辑引用写入也必须取同一锁。删除与并发写竞争时，一方合法提交、另一方明确失败，不能静默 SET NULL/CASCADE 清掉业务数据。正常读请求不回填设置。

旧组织工作区 canCreate 固定 false 并移除创建/删除 UI，不影响项目/测试空间 canDelete。空组织删除使用 ConfirmActionDialog，输入完整名称；非空行禁用删除并能查看阻止项。pending/失败留窗，返回真实 Promise<boolean>，只有 canonical success 才移除行；响应丢失先核对 requestId，不自动重发。

## 9. 各集成的具体改造

### 9.1 全局 AI 与对象存储

AI 保留八项参数、现有 URL 公网 DNS/IP 校验、地址固定、TLS SNI/Host 和禁止重定向，不恢复用户级设置。状态 API 返回当前有效限制，浏览器按更新值校验；模型切换不改变历史会话上下文、来源授权或 canonical turn 协议。

OSS 只有一套配置，enabled=false 一律拒绝。首次填写位置后，存在上传/产物/任务、发现有效规则指向已有外部对象或不能证明未使用时，endpoint/bucket/prefix 的保存和恢复都返回 `STORAGE_MIGRATION_REQUIRED`。只改凭据、上传上限和独立签名密钥可热更新；位置变更走本计划之外的专门迁移。

导入在内存中精确计算原附件 HMAC 材料并加密保存为 legacy verify-only；不得因 APP 密钥环文本变化丢失旧链接。新签名使用独立随机用途密钥和 key ID，旧 URL 走有界 legacy 验证且仍检查对象前缀/授权。恢复配置或签名轮换不能删除仍需验证的 key，不通过眼睛暴露 legacy 材料。

### 9.2 飞书和固定地址

本部署初始化固定：

- 事件回调：`https://veges.private.sealos.pub/api/integrations/feishu/events`
- 登录重定向：`https://pre.veges.private.sealos.pub/api/auth/feishu/oauth/callback`

存在既有重定向时导入前比对；本部署采用以上已确认值，报告任何不一致。其他安装从其原有效地址初始化，不把本站域名硬编码进产品。固定值独立加密落库，页面只读/复制，API 拒绝提交这两个字段；公网地址修改和历史恢复不改变它们。

隐藏但保留 `FEISHU_AI_CHAT_ENABLED` 和 state 签名密钥，新安装私聊 AI 默认关闭。导入原 state 有效材料，覆盖在途 state 的有效期，不开放任意密钥尝试。已有身份绑定/待处理任务时拒绝直接换 App ID；App Secret、验证 token、通知开关、分析验证信息可热更新。对话分析接收用户名一次性精确解析到已有 userId，失败阻止该项导入，不猜账号。`FEISHU_ENCRYPT_KEY` 和 `FEISHU_DELIVERY_INTERVAL_MS` 只报告未实现。

### 9.3 GitHub

新增 repositoryUrl/workflowFile/branch/enabled，默认目标保持 `https://github.com/sealos-apps/sealos-pro`、`sync-images-tar-oss.yml`、`main`；enabled 初值从旧令牌是否配置得到。只允许规范化 github.com HTTPS 仓库，固定请求 api.github.com，拒绝自定义主机、凭据 URL 和任意下载地址。

可用性测试读取仓库、分支、workflow 元数据、默认分支与目标分支工作流源，检查启用状态、workflow_dispatch、`image`/`arch`/`request_id` 输入及现有 run-name 对账约定。权限不足标“无法验证”，不能当不存在；静态检查通过不证明 Actions write、实际运行或 OSS 上传成功。候选值一变测试结果过期，正常测试绝不 dispatch。

镜像同步任务增加持久化目标仓库/工作流/分支/config revision，并回填旧固定目标。每次 dispatch、查询、对账和链接校验使用任务绑定目标；换平台目标只影响新任务。凭据可取当前有效令牌，但若失去旧仓库权限明确报错，不能把旧 run ID 发往新仓库。工作流内部 OSS Secret 仍由目标仓库管理，不会随本平台自动修改；真实上传和两边桶一致性需要授权的端到端验收。

### 9.4 包市场规则

删除三个模板/目录输入。这三个变量并非死代码：导入当前生效 discovery roots 到规则；旧对象/列表模板加密保存为后台兼容快照。保留实际优先级和 `??` 对空字符串的语义，不能把被 YAML 覆盖的 env 重新激活，不能静默改写 `offline/{deployType}/...` 历史路径。

前后端共用纯 schema 校验，服务端保存校验精确候选文本。复用项目 js-yaml；在解析阶段拒绝重复键、锚点/别名、危险 tag，限制 256 KiB、500 条规则、每列表 100 项和深度 64，不能只在解析后检查已展开的对象。检查字段白名单/类型、唯一 ID、相对路径、占位符、分类、父引用/环；保留现有隐式依赖规则与合法自定义 page_kinds。错误提供字段路径，语法错误附行列。

允许规则能力完整清单见字段附录。变更删除/修改被历史包引用的规则时，历史记录绑定原规则版本并回填可证明的原版本；无法证明匹配时阻止该规则变更并报告引用。新请求走当前规则，历史授权只在已有资源授权后使用其绑定快照，不能把所有旧规则并集为全局对象白名单。导入/导出不接受服务器任意文件路径，不混入组织级策略。

### 9.5 SMTP 和集成测试

SMTP 默认关闭，配置 host、port、隐式 TLS/STARTTLS、username、password、发件名称/地址，启用要求字段完整。测试收件地址仅属本次请求。采用 Nodemailer，实施时核对 Node 24 支持并锁定兼容版本；连接验证和显式发送测试邮件分开，保存不发送。

测试只影响候选配置，失败不覆盖有效版本；使用固定无业务数据的 AI 测试内容，OSS 默认只读列举验证，飞书只请求 token/应用信息，不发消息，GitHub 只读。测试邮件和单独 OSS 写权限测试属于明确外部副作用动作，按钮与返回结果如实标识。限时、限并发并脱敏错误；长期事务不包围外部调用。

SMTP 只允许公网 TLS 服务，校验并固定解析地址，禁止 TLS 降级；OSS 限定支持的阿里云 HTTPS endpoint，飞书/GitHub 官方 API 固定。所有测试沿用对应 SSRF 保护，不能成为内网探测入口。

## 10. 页面和交互交付

沿用现有色彩、字体、图标和组件。账号菜单顺序为“账户设置、更新日志、分隔线、选择角色（二级菜单）、亮色模式开关、分隔线、退出登录”。二级菜单按权限显示开发工程师、测试工程师、组织管理员、超级管理员，当前项勾选。业务 persona 与 managementView 分离，不将平台身份加入职业角色枚举。

仅显式选择超管后进入平台视图。未选择时直接访问平台 URL 回到当前工作区，不自动切换；无权限无菜单项、API 403。切回其他身份隐藏平台页面；未保存草稿切换先确认。账户状态刷新及任一授权失败及时退出平台、清除敏感状态；不声称能追回已发送到浏览器的明文。

平台 220px 左侧分区与右侧工作区，移动端分区选择避免挤压表单。分区完整顺序：平台信息、用户与角色、组织管理、全局 AI、邮箱、对象存储、包市场规则、飞书、GitHub、数据安全、配置历史。每区独立草稿、测试、保存和冲突提示；保存显示数据库版本与运行加载状态，测试结果单独显示。历史恢复、权限撤销、禁用、离职和组织删除沿用 ConfirmActionDialog。

交互对照原型位于 `.context/platform-prototype/index.html`，可直接在浏览器打开，不需要服务器。该目录是本工作区辅助材料，不是正式应用，也不作为唯一需求来源。

| 本地参考图 | 验收重点 |
| --- | --- |
| `combined-platform-ui.png`、`combined-account-menu.png` | 与附图账号菜单结合、显式选择身份、无返回按钮 |
| `password-visible.png`、`password-editor.png` | 已保存和新输入凭据均有眼睛按钮 |
| `platform-organizations.png`、`organization-create.png` | 平台组织目录和选择已有所有者 |
| `organization-delete-blocked.png`、`organization-delete-empty.png` | 非空阻止、空组织确认 |
| `mobile-combined-menu.png`、`mobile-organizations.png` | 375px 下无横向溢出、菜单和确认可操作 |

以上均位于 `.context/platform-prototype/`，只反映原型效果；`desktop-add-user.png`、`mobile-add-user.png` 已废弃，严禁据此实现添加用户。后台状态按实际 API/CronJob 结构显示，不能照搬原型中的示意进程标签。

## 11. 按依赖执行的工作清单

勾选表示本分支代码或文档已经完成；未勾选项需要授权环境、真实第三方或浏览器验收，不能由无数据库检查替代。

### 阶段一：契约、迁移和初始化（约 2–3 天）

- [x] 实现纯配置 schema、掩码 DTO、旧解析器及附录 34 项/5 别名/2 未实现项覆盖测试。
- [x] 增加配置、授权、回执、安全材料和巡检表；users/GitHub 任务/历史规则绑定字段；DDL 与版本迁移同步。
- [x] 实现 builtin 约束、本地初始化/恢复、幂等导入、由公网地址生成回调和 legacy 签名材料保存；移出 db:init 的示例账号/项目创建，防止正式初始化新增普通用户。
- [ ] 以隔离库验证旧数据、重复迁移、失败回滚、加密补齐；记录所有新加密列及保留 key 引用。

完成条件：无数据库的解析预检可执行；显式授权的隔离数据库导入可重放且不覆盖已有配置/授权，缺失 admin 或配置损坏不能进入业务就绪状态。

### 阶段二：授权与配置运行时（约 2–3 天）

- [x] 全量迁移 isSystemAdmin 调用，包含更新日志、已有角色管理和组织创建，增加统一授权锁与权限版本。
- [x] 实现保存/恢复/历史/reveal/receipt API，字段白名单、乐观并发、严格解密及审计。
- [x] 实现 NOTIFY/LISTEN、轮询、操作前版本检查、引用计数客户端和运行状态。
- [ ] 完成两 API 实例漏通知/重连/乱序/并发保存/撤权测试，确认没有模块级旧业务 env 回退。

完成条件：服务无需重启取得新配置；写入成功与加载失败可区分；未授权请求拿不到设置或凭据，旧接口无法绕过数据库授权。

### 阶段三：配置消费者与外部适配（约 3–4 天）

- [x] 改 AI/上传 parser/OSS/签名/包市场/GitHub/飞书/链接生成/周报/邀请/日报全部消费者。
- [x] 实现规则校验与历史授权绑定、GitHub 可变目标与任务回填、SMTP 和候选配置测试。
- [x] 加入存储位置、飞书 App ID、固定地址以及签名 key 保留约束，保存和恢复共享。
- [ ] 用模拟第三方测试覆盖失败/超时/SSRF/不混版，在授权测试账号中验证真实集成。

完成条件：逐字段保存可影响实际执行路径，特别是新上传上限和 CronJob；旧对象/链接/任务保持正确归属，测试不隐式触发未请求的外部动作。

### 阶段四：用户与组织治理（约 2–3 天）

- [x] 关闭普通密码注册及邀请绕过，保持历史登录，飞书路径记录来源/核实状态并保护 admin 保留名。
- [x] 聚合角色与超管授权事务，复用启停/离职交接，完善幂等与自撤权状态核对。
- [x] 建立组织引用分类与 FK/删除防护，保留审计，实现平台创建、预检与空删除。
- [x] 停用旧删除路径并迁移组织写入锁序。
- [ ] 在隔离数据库验证删除与成员、资源、邀请、周报写入并发。

完成条件：所有 UI/API/普通 DML builtin 破坏尝试失败；非空组织无论记录状态均不能删除；组织删除不抹除账号、权限、审计或回执。

### 阶段五：正式页面（约 2–3 天）

- [x] 实现身份二级菜单和平台管理视图，迁移现有用户治理，移除组织视图新建/删除。
- [x] 完成全部 11 个分区、中文字段、规则编辑/校验、派生回调复制和 GitHub 测试。
- [x] 实现敏感值 reveal 生命周期、版本冲突/草稿保留、保存与加载状态、确认后 mutation 核对。
- [ ] 浏览器覆盖桌面与 375px 手机、键盘菜单、长名称/错误、滚动、授权撤销和延迟响应，保存截图。

完成条件：截图及实际交互满足第 10 节；无添加用户、返回工作台、存储关闭或历史存储入口；不靠前端隐藏替代后端权限。

### 阶段六：回归、文档与演练（约 1–2 天）

- [x] 完成无数据库测试矩阵与跨模块回归，记录真实集成未验证项。
- [x] 同步 AGENTS.md、`.env.example`、architecture/references/runbook 和 manual-confirmation-checklist。
- [x] 更新 Sealos 应用与日报所需启动变量说明，移除业务 env 运行依赖；不顺带修改 CronJob 生命周期或发布配置。
- [ ] 隔离环境完成“备份 → 停旧实例 → 初始化导入 → 启新实例/日报 → 验收 → 恢复演练”，形成执行记录后再安排授权的生产窗口。

完成条件：测试证据与实施代码一致，文档不再声称 env 控制业务设置；无生产迁移或部署在未授权时执行。

## 12. 运维命令与迁移顺序

以下命令统一由 `server/platform-config-cli.ts` 分发；初始化和迁移命令已实现，加密巡检命令保留为后续授权环境运维项。只读子命令不得导入自动执行 schema 的入口。

| 命令 | 行为 |
| --- | --- |
| `npm run platform:config -- inspect --env-file "$HOME/.vage.env"` | 只读文件、纯解析；不加载 db.ts、不连接数据库、不请求第三方。只报告键名、去向、缺失/未知项和解析错误 |
| `npm run platform:config -- verify --env-file "$HOME/.vage.env"` | 显式连接选定数据库，以 READ ONLY 事务检查账号、旧引用、加密 key、固定地址差异和迁移条件；兼容新增表尚不存在的旧 schema，不执行 schema |
| `npm run platform:config -- bootstrap-admin` | 在明确选定数据库创建/固定 admin，隐藏输入密码；已有异常 admin 失败，不自动恢复 |
| `npm run platform:config -- recover-admin` | 显式维护恢复 admin 登录能力、隐藏输入密码并审计，不重建其业务成员关系 |
| `npm run platform:config -- import --env-file "$HOME/.vage.env"` | 从已审计文件导入有效业务配置和旧超管，固定本部署回调；同一事务完成并写唯一回执，重复执行只返回完成状态 |

这些命令的数据库目标始终来自明确设置的启动配置；inspect 不连接数据库，verify 的 READ ONLY 模式也不能通过隐式模块初始化写库。报告不得包含凭据、URL 密码、密文载荷、旧密钥材料或签名 URL。导入默认采用文件内容作为迁移输入，不混入终端残留业务 env；出现冲突仅报告键名，要求在指定文件中明确实际旧值。`audit-encryption` 与 `--record` 尚未实现，属于后续授权环境运维项；数据安全页在没有巡检记录时明确显示“尚无巡检记录”。

执行迁移：

1. 在隔离库恢复获准使用的脱敏/测试快照，保留所需旧密钥。先完成 inspect 和 verify；解决缺失账号、异常 admin、非法规则、未明历史引用等问题再导入，不能跳过失败项静默丢功能。
2. 保存数据库快照、完整 APP 密钥环和原 env 的受保护备份；记录当前镜像。停止旧 API 写入、暂停日报调度并等在途工作结束，不能混跑旧 env 版本和新 DB 版本。
3. 明确授权后运行本阶段改造后的 `npm run db:init` 应用幂等 schema，再运行 bootstrap-admin 和 import。不能使用旧版本 db:init，它会创建示例账号和项目；只有显式测试夹具可以创建模拟用户。
4. 按需要显式运行 `npm run db:encrypt-existing` 补齐新增加密列，执行巡检并记录；不能重新生成 APP 密钥覆盖原密钥环。
5. 用最小启动配置启动新 API，初始化/严格解密通过后才监听并就绪；验证 admin 登录和飞书回调，再验证业务与热更新。恢复日报调度前确认其镜像和启动配置匹配。
6. 验收后人工从部署配置移除已迁入的业务 env，原文件保留到回退窗口结束。本机文件由操作者明确修改，导入程序不覆写 `~/.vage.env`。

首次全新安装同样先 db:init、bootstrap-admin、import；允许未配置的外部集成状态明确显示 unavailable，超管可完成平台配置，不能以存储关闭开关绕过要求。普通用户注册上线前必须已完成 builtin 初始化和飞书设置。

配置故障优先通过管理 API 修正/恢复前版，生成新 revision。根密钥缺失或数据库故障由运维恢复，不能靠旧 env 自动兜底。应用版本回滚不能撤销数据：旧应用会重新启用 env 超管和旧组织删除语义，因此不支持只换旧镜像直接回滚；必须停写，协调恢复批准的数据库快照、匹配镜像和完整密钥环，评估恢复点后的业务写入损失。没有可接受快照时采用向前修复。

## 13. 验证与交付标准

先做不连接数据库的检查：

```bash
npm run build
npm run lint
npm test
git diff --check
```

触及 TypeScript 的阶段补充 scoped ESLint。纯测试需注入配置、时钟、通知和客户端工厂；不能在 import 时启动 API 或执行查询。如果现有纯测试仅因 db.ts 检查缺少 URL，可给测试进程设置指向未使用本地端口的无效连接，测试不得真正连接。

隔离 PostgreSQL HTTP/并发集成验收要求显式测试连接、显式标记的专用数据库，启动前拒绝非测试目标；清理仅限本次测试创建的数据。该验收会写库，须明确授权。保留现有 `npm run test:resource-management` 回归组织资源、锁序和交接能力，不能用单元测试代替真实数据库验收。

| 范围 | 必须覆盖的成功、错误和边界 |
| --- | --- |
| 配置与导入 | 34 项和 5 别名、默认/空字符串/优先级、未知项报告、旧 key、幂等、并发导入、重复 DDL、解密失败、完整回滚、无 env 故障回退 |
| 管理员 | env 空/缺 admin、已有 ID/密码保留、保留名抢注、异常旧 admin、builtin 全路径不可移除、managed 授撤与自撤、撤权后重启/恢复不复活 |
| 用户 | 无手工添加、密码注册含邀请拒绝、首次/重复飞书回调、无效 state、禁用/离职不复活、历史绑定核实、原子权限版本冲突、离职交接回滚 |
| 明文查看 | 默认 DTO/日志不含值、单字段白名单、未授权/版本冲突、30 秒/失焦/离页清除、延迟响应丢弃、查看不生成配置版本、legacy 根材料不可取 |
| 热更新 | 两 API 和 CronJob、新旧动作不混版、漏/乱序通知、断线重连、轮询、连续保存、加载失败/失联、限流不重置、上传 parser 真正生效、隐藏重试开关生效 |
| 组织 | 各 blocker 单独及历史状态、错误名称、预检后新增、空壳可删、审计/账号保留、旧接口 410、普通组织管理员 403、未知 FK 分类失败 |
| 数据库并发 | 撤权与保存/删除、组织删除与邀请/成员/绑定/周报写入、断连后 receipt 核对、FK 竞争、无孤儿/静默级联、固定锁序无死锁 |
| 外部集成 | AI/SMTP SSRF、token 版本隔离、凭据换版旧链接可读、使用中位置和 App ID 更换拒绝、回调随公网地址保存/恢复变化且进行中 OAuth 保留原地址、历史 GitHub 目标固定 |
| 包规则 | YAML 语法/重复键/tag/alias/深度/超限、未知字段/路径穿越/占位符/引用环、全部现有字段兼容、历史对象授权不扩大、编辑后旧校验结果失效 |
| 界面 | 11 分区、二级菜单、显式身份、无返回/添加用户/存储关闭、中文/MB、桌面和 375px、长文本/键盘/草稿冲突、pending 与错误留窗、确认 Promise<boolean> |

真实集成验收所需外部资源：AI 提供方 key 和模型；阿里云 OSS 账号/桶；飞书企业自建应用和校验 token；GitHub 目标仓库令牌（读取 workflow 需 Contents read，运行需 Actions write）；SMTP 账户或应用授权码。开发与大部分验证用模拟适配器，凭据只在获准的测试环境输入，不进入计划、日志或仓库。无需新增 MCP 服务或配置中心账号。

关键运行假设是数据库可提供权威配置，以及旧签名/APP 密钥仍可取得。数据库故障时暂停新配置相关动作，历史密钥缺失时迁移必须失败；不得通过放宽认证、重置密钥或忽略历史数据继续。10 倍负载重点检查每操作版本读取、分页治理查询和连接预算，配置行做主键查询，阻止项按组织索引计数；不以取消版本检查换吞吐。第三方故障只影响对应集成，平台仍可更改配置。

本计划未连接真实数据库、OSS、飞书、GitHub 目标仓库或 SMTP，未验证两个固定域名的 OAuth 路由与会话落点。真实端到端运行、发送邮件/消息、OSS 写入、workflow 执行、生产迁移和部署只在对应授权环境进行，报告必须区分模拟通过、真实通过和未验证。
