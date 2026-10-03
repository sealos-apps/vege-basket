import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveExistingOperationInteraction } from '../src/project-package-operation-access.ts'
import { preserveLoadedPackageEventDetails } from '../src/project-package-timeline-state.ts'
import type { ProjectPackageEvent, ProjectPackageTimeline } from '../src/types.ts'

const workbenchSource = readFileSync(
  new URL('../src/components/project-package-workbench.tsx', import.meta.url),
  'utf8',
)
const timelineSource = readFileSync(
  new URL('./project-package-timeline.ts', import.meta.url),
  'utf8',
)
const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const paginationSource = readFileSync(
  new URL('../src/components/list-pagination.tsx', import.meta.url),
  'utf8',
)
const eventFilterSource = readFileSync(
  new URL('../src/components/package-event-filter-builder-dialog.tsx', import.meta.url),
  'utf8',
)
const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const deliveryArtifactsMigrationSource = readFileSync(
  new URL('./migrations/20260930_project_delivery_artifacts.sql', import.meta.url),
  'utf8',
)
const deliveryRuntimeConfigMigrationSource = readFileSync(
  new URL('./migrations/20260930_project_delivery_runtime_config.sql', import.meta.url),
  'utf8',
)
const deliveryOtherScriptMigrationSource = readFileSync(
  new URL('./migrations/20261001_project_delivery_other_script.sql', import.meta.url),
  'utf8',
)
const deliveryExecutionMigrationSource = readFileSync(
  new URL('./migrations/20261001_project_delivery_execution_steps.sql', import.meta.url),
  'utf8',
)

test('new delivery events require content and support reusable ordered shell scripts', () => {
  assert.match(timelineSource, /至少添加一种交付内容后才能创建交付事件/u)
  assert.match(timelineSource, /normalizeDeliveryOther/u)
  assert.match(workbenchSource, /添加 Shell 脚本/u)
  assert.match(workbenchSource, /脚本只有加入交付流程后才参与执行，可被多个流程重复引用/u)
  assert.match(workbenchSource, /流程名称会写入生成脚本的注释/u)
  assert.match(timelineSource, /const comment = `# 流程/u)
  assert.match(timelineSource, /step\.processName/u)
  assert.match(indexSource, /limit: '512kb'/u)
  assert.match(workbenchSource, /maxDeliveryOtherScriptLength/u)
  assert.match(deliveryOtherScriptMigrationSource, /add column if not exists other_script/u)
  assert.match(schemaSource, /add column if not exists other_script text/u)
  assert.match(timelineSource, /交付内容类型无效/u)
})

test('legacy delivery fallback uses stable database identities everywhere', () => {
  assert.match(timelineSource, /function buildFallbackDeliverySteps/u)
  assert.match(timelineSource, /buildFallbackDeliverySteps\(\{[\s\S]*items: \(groupsByEvent/u)
  assert.match(timelineSource, /buildFallbackDeliverySteps\(\{[\s\S]*legacyItems/u)
  assert.match(timelineSource, /buildFallbackDeliverySteps\(\{[\s\S]*packageLinks.map/u)
  assert.match(timelineSource, /id: `package-\$\{item\.id\}`/u)
  assert.match(timelineSource, /id: `offline-\$\{item\.id\}`/u)
  assert.match(timelineSource, /id: `image-\$\{item\.id\}`/u)
})

test('omitted delivery plan fields preserve stored values and reject dangling references', () => {
  assert.match(timelineSource, /const hasDeliveryScripts = params\.deliveryScripts !== undefined/u)
  assert.match(timelineSource, /const hasDeliverySteps = params\.deliverySteps !== undefined/u)
  assert.match(timelineSource, /const effectiveScripts = hasDeliveryScripts \? deliveryScripts : storedScripts/u)
  assert.match(timelineSource, /const effectiveSteps = hasDeliverySteps \? deliverySteps : storedSteps/u)
  assert.match(timelineSource, /请提交完整交付流程/u)
  assert.match(timelineSource, /delivery_steps = \$11/u)
  assert.match(timelineSource, /delivery_scripts = \$12/u)
})

test('delivery lifecycle migration preserves terminal states and rejection history', () => {
  assert.match(deliveryExecutionMigrationSource, /delivery_result = 'failed' or status = 'failed'.*?then 'failed'/su)
  assert.match(deliveryExecutionMigrationSource, /delivery_result = 'partial' or status = 'partially_delivered'.*?then 'partially_delivered'/su)
  assert.match(deliveryExecutionMigrationSource, /delivery_result = 'rejected' or status = 'rejected'.*?then 'rejected'/su)
  assert.match(deliveryExecutionMigrationSource, /create table if not exists project_package_event_rejections/u)
  assert.match(deliveryExecutionMigrationSource, /set completed_at = coalesce\(completed_at, updated_at, published_at, created_at\)/u)
  assert.match(deliveryExecutionMigrationSource, /project_package_events_terminal_result_check/u)
  assert.match(deliveryExecutionMigrationSource, /status = 'partially_delivered' and delivery_result = 'partial' and completed_at is not null/u)
  assert.match(timelineSource, /交付结果无效/u)
  assert.match(timelineSource, /执行结果无效/u)
})

test('package market offers link validity choices from four hours through seven days', () => {
  const expireOptionsSource = workbenchSource.slice(
    workbenchSource.indexOf('const packageMarketExpireOptions = ['),
    workbenchSource.indexOf('const packageMarketExpireMaxMinutes'),
  )
  assert.match(
    expireOptionsSource,
    /4 小时[\s\S]*?4 \* 60[\s\S]*?8 小时[\s\S]*?8 \* 60[\s\S]*?24 小时[\s\S]*?24 \* 60[\s\S]*?3 天[\s\S]*?3 \* 24 \* 60[\s\S]*?7 天[\s\S]*?7 \* 24 \* 60/u,
  )
  assert.doesNotMatch(expireOptionsSource, /分钟|10 小时|14 天/u)
})

test('published event and package documents remain openable for read-only viewing', () => {
  assert.deepEqual(resolveExistingOperationInteraction(false), {
    disabled: false,
    readOnly: true,
  })
})

test('package market rule-outside objects keep download actions', () => {
  assert.doesNotMatch(workbenchSource, /当前规则不允许下载此对象/u)
  assert.match(indexSource, /isSafePackageMarketObjectKey/u)
  assert.doesNotMatch(indexSource, /isAllowedPackageMarketObjectKey/u)
})

test('draft event documents remain openable for editing', () => {
  assert.deepEqual(resolveExistingOperationInteraction(true), {
    disabled: false,
    readOnly: false,
  })
})

test('delivery documents no longer expose todo association actions', () => {
  const detailDrawerSource = workbenchSource.slice(
    workbenchSource.indexOf('<Dialog open={eventDetailOpen'),
    workbenchSource.indexOf('<Dialog open={deliveryResultDialogOpen'),
  )
  assert.doesNotMatch(detailDrawerSource, /关联待办|删除记录|添加操作文档/u)
  assert.match(
    timelineSource,
    /const operation = await findOperationMeta\([\s\S]*?if \(!operation\)[\s\S]*?if \(operation\.published_at && updates\.length > 0\)[\s\S]*?Published events are read-only/u,
  )
})

test('delivery workbench enforces one event-level change record and package-only views', () => {
  assert.match(timelineSource, /只允许一个事件级变更记录/u)
  assert.match(timelineSource, /每个交付事件只能有一个变更记录/u)
  assert.match(timelineSource, /安装包仅展示安装包列表/u)
  assert.doesNotMatch(workbenchSource, /scope: 'package'/u)
  assert.match(workbenchSource, /变更记录/u)
})

test('event details separate read-only overview and delivery content tabs', () => {
  const detailDrawerSource = workbenchSource.slice(
    workbenchSource.indexOf('<Dialog open={eventDetailOpen'),
    workbenchSource.indexOf('<Dialog open={deliveryResultDialogOpen'),
  )
  assert.match(workbenchSource, /基础信息与变更记录/u)
  assert.match(workbenchSource, /<TabsTrigger value="delivery">交付内容<\/TabsTrigger>/u)
  assert.match(workbenchSource, /暂无变更记录/u)
  assert.match(workbenchSource, /暂无交付内容/u)
  assert.match(workbenchSource, /<h4>交付项<\/h4>/u)
  assert.match(workbenchSource, /formatEventDeliveryDate\(selectedEvent\)/u)
  assert.match(workbenchSource, /交付失败记录/u)
  assert.doesNotMatch(workbenchSource, /部分交付失败记录/u)
  assert.doesNotMatch(detailDrawerSource, /<h3>安装包<\/h3>/u)
  assert.match(workbenchSource, /在线命令/u)
  assert.match(workbenchSource, /离线命令/u)
  assert.match(workbenchSource, /预览 Values 修改/u)
  assert.match(workbenchSource, /复制执行脚本/u)
  assert.match(workbenchSource, /previewConfig\.valuesPath/u)
  assert.match(workbenchSource, /previewConfig\.valuesPatch/u)
  assert.doesNotMatch(workbenchSource, /const valuesScriptKey/u)
  assert.match(workbenchSource, /所有交付项需要 <code>sealos<\/code>；在线命令还需要 <code>wget<\/code>/u)
  assert.match(workbenchSource, /yq v4/u)
  assert.match(workbenchSource, /eventDetailTab !== 'delivery'/u)
})

test('event filters expose every delivery lifecycle status', () => {
  for (const status of ['draft', 'delivering', 'rejected', 'partially_delivered', 'delivered', 'failed']) {
    assert.match(eventFilterSource, new RegExp(`value="${status}"`, 'u'))
  }
})

test('rejected event editing keeps the latest rejection reason visible', () => {
  const editorSource = workbenchSource.slice(
    workbenchSource.indexOf('function renderEventEditor'),
    workbenchSource.indexOf('function renderTimelineExport'),
  )
  assert.match(editorSource, /event-rejection-notice/u)
  assert.match(editorSource, /latestRejectionReason/u)
  assert.match(editorSource, /拒绝理由/u)
})

test('event wizard keeps the stepper below its compact header with a return-list action', () => {
  const headerSource = workbenchSource.slice(
    workbenchSource.indexOf('<header className="event-wizard-header">'),
    workbenchSource.indexOf('<div className="event-wizard-steps-row">'),
  )
  const editorTopSource = workbenchSource.slice(
    workbenchSource.indexOf('<header className="event-wizard-header">'),
    workbenchSource.indexOf('<div className="event-wizard-content">'),
  )
  assert.match(headerSource, /event-wizard-heading/u)
  assert.doesNotMatch(headerSource, /event-wizard-steps/u)
  assert.match(editorTopSource, /<\/header>[\s\S]*event-wizard-main[\s\S]*event-wizard-steps-row[\s\S]*event-wizard-steps/u)
  assert.match(editorTopSource, /item\.step <= eventEditorStep \? 'reached'/u)
  assert.match(headerSource, /返回事件列表/u)
  assert.match(headerSource, /returnToEventList/u)
})

test('selecting a draft event opens its summary instead of the editor', () => {
  const listSelectionSource = workbenchSource.slice(
    workbenchSource.indexOf('function selectEventFromList'),
    workbenchSource.indexOf('function resetEventEditor'),
  )
  const imperativeSelectionSource = workbenchSource.slice(
    workbenchSource.indexOf('selectEvent: (eventId: number) => {'),
    workbenchSource.indexOf('  }))', workbenchSource.indexOf('selectEvent: (eventId: number) => {')),
  )
  assert.doesNotMatch(listSelectionSource, /openDraftEventEditor/u)
  assert.match(listSelectionSource, /setEventEditorOpen\(false\)/u)
  assert.doesNotMatch(imperativeSelectionSource, /openDraftEventEditor/u)
})

test('deleting the edited event closes its editor and advances to the next visible event', () => {
  const deletionSource = workbenchSource.slice(
    workbenchSource.indexOf('async function deleteEventFromList'),
    workbenchSource.indexOf('async function handleTodoDialogSave'),
  )
  assert.match(deletionSource, /visibleEvents\[deletedIndex \+ 1\]/u)
  assert.match(deletionSource, /visibleEvents\[deletedIndex - 1\]/u)
  assert.match(deletionSource, /const deleted = await onDeleteEvent\(event\.id\)/u)
  assert.match(deletionSource, /if \(!deleted \|\| !deletingActiveEvent\) return/u)
  assert.match(deletionSource, /setEventEditorOpen\(false\)/u)
  assert.match(deletionSource, /setEventEditorEventId\(null\)/u)
  assert.match(workbenchSource, /onConfirm=\{\(\) => deleteEventFromList\(event\)\}/u)
})

test('event wizard has one event-level change record and no todo association controls', () => {
  const stepThreeSource = workbenchSource.slice(
    workbenchSource.indexOf('{eventEditorStep === 3 ? ('),
    workbenchSource.indexOf('<footer className="event-wizard-footer">'),
  )
  assert.match(stepThreeSource, /变更记录/u)
  assert.doesNotMatch(workbenchSource, /relatedTodoIds: eventDocumentRelatedTodoIds/u)
  assert.match(workbenchSource, /documents: \[\{[\s\S]*?relatedTodoIds: \[\]/u)
  assert.match(workbenchSource, /const documentScopes = useMemo\(\(\) => \['event'\], \[\]\)/u)
  assert.match(workbenchSource, /event-wizard-footer-actions[\s\S]*event-wizard-navigation[\s\S]*event-wizard-save-actions/u)
})

test('event wizard document navigation keeps one valid change-record tab', () => {
  const documentNavigationSource = workbenchSource.slice(
    workbenchSource.indexOf('<div className="event-wizard-document-nav"'),
    workbenchSource.indexOf('<Label className="event-document-title-field">'),
  )
  assert.match(documentNavigationSource, /role="tablist"/u)
  assert.match(documentNavigationSource, /变更记录/u)
  assert.doesNotMatch(documentNavigationSource, /id=\{`\$\{documentTabsId\}-package-/u)
  assert.match(documentNavigationSource, /aria-controls=\{`\$\{documentTabsId\}-panel`\}/u)
  assert.match(documentNavigationSource, /tabIndex=\{resolvedDocumentScope ===/u)
  assert.match(documentNavigationSource, /onKeyDown=\{\(event\) => handleDocumentTabKeyDown/u)
  assert.match(documentNavigationSource, /role="tabpanel"/u)
  assert.match(documentNavigationSource, /aria-labelledby=/u)
  assert.match(workbenchSource, /if \(documentScopes\.includes\(activeDocumentScope\)\) return/u)
  assert.match(workbenchSource, /const resolvedDocumentScope = documentScopes\.includes\(activeDocumentScope\)/u)
  assert.match(workbenchSource, /setActiveDocumentScope\('event'\)/u)
})

test('event wizard keeps long package document navigation inside the desktop sidebar', () => {
  const appCssSource = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.match(
    appCssSource,
    /\.event-wizard-main \{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/u,
  )
  assert.match(
    appCssSource,
    /\.event-wizard-steps-row \{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/u,
  )
  assert.match(
    appCssSource,
    /\.event-wizard-step-group\.documents \{[\s\S]*?grid-template-rows: 58px minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/u,
  )
  assert.match(
    appCssSource,
    /\.event-wizard-document-nav \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/u,
  )
  const mobileCssSource = appCssSource.slice(appCssSource.indexOf('@media (max-width: 760px)'))
  assert.match(
    mobileCssSource,
    /\.event-wizard-document-nav \{[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/u,
  )
})

test('aggregate event save ignores legacy document todo links transactionally', () => {
  assert.match(indexSource, /relatedTodoIds: Array\.isArray\(value\.relatedTodoIds\)/u)
  assert.match(
    timelineSource,
    /return withTransaction\(async \(client\) => \{\s*await authorizeDelivery\(client, params\.projectId, params\.createdByUserId,[\s\S]*?await requireDeliveryAssignee\([\s\S]*?let eventId = params\.eventId/u,
  )
  assert.match(timelineSource, /const relatedTodoIds: number\[\] = \[\]/u)
  assert.match(
    timelineSource,
    /insert into project_package_operations[\s\S]*?returning id[\s\S]*?replaceOperationTodoLinks\(/u,
  )
})

test('delivery events expose per-event comments with author names', () => {
  assert.match(timelineSource, /comments: commentsByEvent\.get\(Number\(row\.id\)\) \?\? \[\]/u)
  assert.match(timelineSource, /from project_package_event_comments c/u)
  assert.match(timelineSource, /content: decryptText\(row\.content\)/u)
  assert.match(timelineSource, /authorName: displayUserName\(/u)
  assert.match(timelineSource, /mentionableMembers,/u)
  assert.match(timelineSource, /organization_memberships om on om\.organization_id = p\.organization_id/u)
})

test('package event comments support encrypted author-only updates and deletes', () => {
  const commentSource = timelineSource.slice(
    timelineSource.indexOf('export async function createProjectPackageEventComment'),
  )
  assert.match(commentSource, /insert into project_package_event_comments \(project_package_event_id, author_user_id, content\)/u)
  assert.match(commentSource, /values \(\$1, \$2, \$3\)\s*returning id/u)
  assert.match(commentSource, /encryptText\(params\.content\)/u)
  assert.match(commentSource, /mentionedUserIds: number\[\]/u)
  assert.match(commentSource, /insert into notification_deliveries/u)
  assert.match(commentSource, /where kind = 'package_event_comment_added' and source_id = \$1/u)
  assert.match(commentSource, /for update of c/u)
  assert.match(commentSource, /Only the comment author can change it/u)
  assert.match(commentSource, /delete from project_package_event_comments where id = \$1/u)
  assert.match(timelineSource, /readonly status: 400 \| 403 \| 404 \| 409/u)
})

test('delivery comment mention resolution covers organization and project members', () => {
  const resolver = timelineSource.slice(
    timelineSource.indexOf('export async function resolvePackageEventMentionUserIds'),
    timelineSource.indexOf('export async function createProjectPackageEventComment'),
  )
  assert.match(resolver, /lower\(coalesce\(nullif\(u\.display_name, ''\), u\.email\)\) = any\(\$2::text\[\]\)/u)
  assert.match(resolver, /u\.id = \(select p\.user_id from projects p where p\.id = \$1\)/u)
  assert.match(resolver, /project_memberships pm[\s\S]*pm\.status = 'active'/u)
  assert.match(resolver, /organization_memberships om[\s\S]*om\.status = 'active'/u)
})

test('package event comment routes require project write access and valid content', () => {
  const commentRoutes = indexSource.slice(
    indexSource.indexOf("app.post('/api/projects/:projectId/package-timeline/events/:eventId/comments'"),
    indexSource.indexOf("app.get('/api/projects/:projectId/package-timeline/export'"),
  )
  assert.match(commentRoutes, /getProjectAccess\(projectId, userId\)/u)
  assert.match(commentRoutes, /Comment is required/u)
  assert.match(commentRoutes, /createProjectPackageEventComment/u)
  assert.match(commentRoutes, /resolvePackageEventMentionUserIds\(projectId, content\)/u)
  assert.match(commentRoutes, /enqueuePackageEventCommentAddedDelivery/u)
  assert.match(commentRoutes, /updateProjectPackageEventComment/u)
  assert.match(commentRoutes, /deleteProjectPackageEventComment/u)
})

test('delivery workbench keeps feedback beside delivery result actions', () => {
  assert.match(workbenchSource, /交付反馈/u)
  assert.match(workbenchSource, /ChatCircleDots/u)
  assert.match(workbenchSource, /setCommentsDrawerOpen\(true\)/u)
  assert.match(workbenchSource, /PackageEventCommentsDrawer/u)
  assert.match(workbenchSource, /slide-in-from-right/u)
  assert.match(workbenchSource, /MentionTextarea/u)
  assert.match(workbenchSource, /onAddEventComment\(eventId, content\)/u)
  assert.match(workbenchSource, /提交交付结果/u)
  assert.match(workbenchSource, /拒绝交付/u)
  assert.match(workbenchSource, /部分交付/u)
  assert.match(workbenchSource, /发送反馈/u)
  assert.equal((workbenchSource.match(/menuPlacement="above"/g) ?? []).length, 2)
  const mentionSource = readFileSync(
    new URL('../src/components/mention-textarea.tsx', import.meta.url),
    'utf8',
  )
  assert.match(mentionSource, /menuPlacement\?: 'above' \| 'auto'/u)
  assert.match(mentionSource, /menuPlacement === 'above'/u)
  assert.match(mentionSource, /const mentionMenuMaxHeight = 220/u)
  assert.match(mentionSource, /Math\.min\(filteredMembers\.length \* 46 \+ 12, mentionMenuMaxHeight\)/u)
  assert.match(mentionSource, /maxHeight: mentionMenuMaxHeight/u)
  assert.match(mentionSource, /overflowY: 'auto'/u)
  assert.match(mentionSource, /closest<HTMLElement>\('\[data-slot="dialog-content"\]'\)/u)
  assert.match(mentionSource, /menuPortalHost === document\.body \? 'fixed' : 'absolute'/u)
  assert.doesNotMatch(mentionSource, /onMouseDownCapture/u)
  assert.match(mentionSource, /closest\('\.mention-menu-floating'\)/u)
  const appCssSource = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.match(
    appCssSource,
    /\.mention-menu-floating \{[\s\S]*?position: fixed;[\s\S]*?max-height: 220px;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;[\s\S]*?scrollbar-color: transparent transparent;/u,
  )
  assert.match(appCssSource, /\.mention-menu-floating:hover[\s\S]*?scrollbar-color:/u)
  assert.match(appCssSource, /\.mention-menu-floating:hover::-webkit-scrollbar-thumb[\s\S]*?background:/u)
})

test('delivery event lists keep searchable paginated surfaces with the global menu', () => {
  assert.doesNotMatch(workbenchSource, /const \[packageQuery, setPackageQuery\]/u)
  assert.doesNotMatch(workbenchSource, /visiblePackageGroups/u)
  assert.match(workbenchSource, /ListPagination label="交付事件分页"/u)
  assert.match(workbenchSource, /onPageSizeChange=\{\(size\) => \{ setEventPage\(0\); setEventPageSize\(size\) \}\}/u)
  assert.doesNotMatch(workbenchSource, /ListPagination label="安装包列表分页"/u)
  assert.match(paginationSource, /pageSizeOptions = \[20, 50\]/u)
  assert.match(paginationSource, /new Set\(\[\.\.\.pageSizeOptions, pageSize\]\)/u)
  assert.doesNotMatch(workbenchSource, /const isEmptyState/u)
  assert.match(workbenchSource, /<ListPagination label="交付事件分页"[\s\S]*?total=\{eventTotal\}/u)
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(appSource, /const hideSidebar/u)
  assert.match(appSource, /<aside className="sidebar"/u)
})

test('delivery timeline API accepts bounded search pagination and reports totals', () => {
  assert.match(indexSource, /request\.query\.limit/u)
  assert.match(indexSource, /request\.query\.offset/u)
  assert.match(indexSource, /request\.query\.q/u)
  assert.match(timelineSource, /const normalizedQuery = options\.q\?\.trim()/u)
  assert.match(timelineSource, /Math\.min\(500/u)
  assert.match(timelineSource, /pagination: \{ limit, offset, total \}/u)
  assert.match(indexSource, /parseProjectPackageEventFilters\(request\.query\.filters\)/u)
  assert.match(timelineSource, /options\.join === 'or'/u)
  assert.match(timelineSource, /options\.assignedUserId/u)
})

test('delivery event summaries use database pagination and hydrate one selected event on demand', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(indexSource, /eventId: Number\.isSafeInteger\(eventId\)[\s\S]*?includeDetails,/u)
  assert.match(timelineSource, /options\.includeDetails !== false/u)
  assert.match(timelineSource, /limit \$2 offset \$3/u)
  assert.match(timelineSource, /select count\(\*\)::text as total from project_package_events/u)
  assert.match(timelineSource, /where e\.project_id = \$1\$\{eventIdClause\}/u)
  assert.match(timelineSource, /detailsLoaded: includeDetails/u)
  assert.match(timelineSource, /select count\(\*\)[\s\S]*?from project_package_groups g[\s\S]*?join project_package_items i[\s\S]*?where g\.project_package_event_id = e\.id/u)
  assert.match(workbenchSource, /includeDetails: false/u)
  assert.match(workbenchSource, /eventId: selectedEventDetailId, includeDetails: true/u)
  assert.match(workbenchSource, /project-event-counts/u)
  assert.match(workbenchSource, /拒绝次数/u)
  assert.match(timelineSource, /rejection_count/u)
  assert.match(timelineSource, /includeDetails \? 'e\.delivery_scripts' : 'null::text'/u)
  assert.match(timelineSource, /includeDetails && selectedEventIds\.length > 0/u)
  assert.match(timelineSource, /deliveryScripts: includeDetails \?/u)
  assert.match(appSource, /preserveLoadedPackageEventDetails/u)
  assert.match(workbenchSource, /openLoadedDraftEventEditor/u)
  assert.match(workbenchSource, /await onLoadTimeline\(\{ eventId: event\.id, includeDetails: true, limit: 1, offset: 0 \}\)/u)
  assert.doesNotMatch(timelineSource, /packageCount:[\s\S]*?container_image_count/u)
  assert.match(indexSource, /savedEventId: result\.eventId/u)
  assert.match(indexSource, /containerImages: Array\.isArray\(body\.containerImages\)[\s\S]*?: undefined/u)
  assert.match(timelineSource, /params\.eventId == null \|\| containerImages != null/u)
  assert.match(appSource, /const savedEventId = mutationResult\.savedEventId \?\? eventId/u)
  assert.match(appSource, /fetchProjectPackageTimeline\(projectId, \{ \.\.\.installTimelineQueryRef\.current, includeDetails: false \}\)/u)
})

test('delivery summary refresh preserves every loaded detail field only for the same event revision', () => {
  const detailEvent = {
    id: 7,
    updatedAt: '2026-10-01 12:00:00',
    detailRevision: '1790841600.123456',
    detailsLoaded: true,
    comments: [{ id: 1 }],
    containerImages: [{ id: 2 }],
    deliveryFailureReason: '整体失败详情',
    deliveryScripts: [{ id: 'script-1', title: '检查', content: 'echo ok' }],
    deliverySteps: [{ id: 'step-1', kind: 'shell-script', processName: '检查', reference: 'script-1' }],
    groups: [{ id: 3 }],
    latestRejectedAt: '2026-10-01 11:00:00',
    latestRejectedByName: '执行人',
    latestRejectionReason: '需要调整顺序',
    offlinePackages: [{ id: 4 }],
    operations: [{ id: 5 }],
    other: { content: 'echo legacy', type: 'shell-script' },
    rejections: [{ createdAt: '2026-10-01 11:00:00', reason: '需要调整顺序', rejectedByName: '执行人' }],
  } as ProjectPackageEvent
  const summaryEvent = {
    ...detailEvent,
    comments: [],
    containerImages: [],
    deliveryFailureReason: undefined,
    deliveryScripts: [],
    deliverySteps: [],
    groups: [],
    latestRejectedAt: undefined,
    latestRejectedByName: undefined,
    latestRejectionReason: undefined,
    offlinePackages: [],
    operations: [],
    other: null,
    rejections: [],
    detailsLoaded: false,
    rejectionCount: 1,
  }
  const timeline = (event: ProjectPackageEvent) => ({ events: [event] }) as ProjectPackageTimeline

  const preserved = preserveLoadedPackageEventDetails(timeline(detailEvent), timeline(summaryEvent)).events[0]
  assert.equal(preserved.detailsLoaded, true)
  assert.deepEqual(preserved.deliverySteps, detailEvent.deliverySteps)
  assert.deepEqual(preserved.deliveryScripts, detailEvent.deliveryScripts)
  assert.deepEqual(preserved.rejections, detailEvent.rejections)
  assert.equal(preserved.latestRejectionReason, detailEvent.latestRejectionReason)
  assert.equal(preserved.deliveryFailureReason, detailEvent.deliveryFailureReason)
  assert.equal(preserved.other, detailEvent.other)

  const changedSummary = {
    ...summaryEvent,
    updatedAt: detailEvent.updatedAt,
    detailRevision: '1790841600.123789',
  }
  const invalidated = preserveLoadedPackageEventDetails(timeline(detailEvent), timeline(changedSummary)).events[0]
  assert.equal(invalidated.detailsLoaded, false)
  assert.deepEqual(invalidated.deliverySteps, [])
  assert.deepEqual(invalidated.rejections, [])
})

test('delivery events support mixed encrypted artifacts and server-generated scripts', () => {
  assert.match(timelineSource, /project_package_event_container_images/u)
  assert.match(timelineSource, /project_package_event_offline_packages/u)
  assert.match(timelineSource, /encryptText\(item\.image\)/u)
  assert.match(timelineSource, /encryptText\(item\.url\)/u)
  assert.match(timelineSource, /encryptedDeliveryRuntimeConfig/u)
  assert.match(timelineSource, /readDeliveryRuntimeConfig/u)
  assert.match(timelineSource, /createDeliveryExecutionScript/u)
  assert.match(indexSource, /delivery-artifacts/u)
  assert.match(workbenchSource, /集群镜像/u)
  assert.match(workbenchSource, /离线包地址/u)
  assert.match(workbenchSource, /delivery-process-actions/u)
  assert.match(workbenchSource, /已复制链接/u)
  assert.match(workbenchSource, /已复制在线命令/u)
  assert.match(workbenchSource, /已复制离线命令/u)
  assert.match(timelineSource, /onlineCommand,\n\s+content:/u)
  assert.match(timelineSource, /offlineCommand/u)
  assert.doesNotMatch(workbenchSource, /完整执行脚本/u)
  assert.doesNotMatch(workbenchSource, /流程内容/u)
  assert.match(workbenchSource, /deliveryArtifacts\.processes\.map/u)
  for (const table of [
    'project_package_event_container_images',
    'project_package_event_offline_packages',
  ]) {
    const tablePattern = new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`, 'u')
    const schemaDefinition = schemaSource.match(tablePattern)?.[0]
    assert.ok(schemaDefinition, `${table} must exist in the startup schema`)
    assert.ok(deliveryArtifactsMigrationSource.includes(schemaDefinition), `${table} migration must match the startup schema`)
  }
  assert.match(schemaSource, /environment_variables text/u)
  assert.match(schemaSource, /values_path text/u)
  assert.match(schemaSource, /values_patch text/u)
  assert.match(deliveryRuntimeConfigMigrationSource, /alter table project_package_items/u)
  assert.match(deliveryRuntimeConfigMigrationSource, /alter table project_package_event_container_images/u)
  assert.match(deliveryRuntimeConfigMigrationSource, /alter table project_package_event_offline_packages/u)
})

test('delivery list exposes signed delay days with distinct visual states', () => {
  assert.match(timelineSource, /deliveryDelayDays/u)
  assert.match(timelineSource, /calendarDayDifference/u)
  assert.match(workbenchSource, /交付延期/u)
  assert.match(workbenchSource, /project-event-delay-cell/u)
})

test('delivery workbench uses a full-width event list and a desktop right detail drawer', () => {
  assert.match(workbenchSource, /delivery-workbench-shell/u)
  assert.match(workbenchSource, /delivery-workbench-heading/u)
  assert.match(workbenchSource, /delivery-event-stats/u)
  assert.match(workbenchSource, /project-event-table-head/u)
  assert.match(workbenchSource, /delivery-event-table-viewport/u)
  assert.match(workbenchSource, /project-package-event-drawer/u)
  assert.match(workbenchSource, /事件详情暂时无法显示/u)
  assert.match(workbenchSource, /<DialogContent fixedHeader className="project-package-event-drawer">/u)
  assert.match(workbenchSource, /selectedEvent\.detailsLoaded === false && !eventDetailsError/u)
  assert.match(workbenchSource, /事件不存在、已删除或当前账号无权查看/u)
  assert.match(workbenchSource, /setEventDetailOpen\(true\)/u)
  const workbenchCss = readFileSync(
    new URL('../src/components/project-package-workbench.css', import.meta.url),
    'utf8',
  )
  assert.match(workbenchCss, /\.project-package-event-drawer[\s\S]*width: min\(820px/u)
  assert.match(workbenchCss, /\.delivery-event-table-viewport[\s\S]*overflow: auto/u)
  assert.match(workbenchCss, /\.project-event-table-head[\s\S]*position: sticky/u)
  assert.match(workbenchCss, /--delivery-event-content-columns:[\s\S]*minmax\(130px, 1fr\)/u)
  assert.match(workbenchCss, /grid-template-columns: var\(--delivery-event-content-columns\) 40px/u)
  assert.match(workbenchCss, /\.delivery-event-list-panel[\s\S]*grid-template-rows: auto auto auto auto auto minmax\(0, 1fr\) auto/u)
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(appSource, /preserveLoadedPackageEventDetails/u)
  assert.match(appSource, /if \(options\.eventId == null\) installTimelineQueryRef\.current = options/u)
  assert.match(workbenchCss, /\.project-package-event-drawer[\s\S]*width: min\(820px, calc\(100vw - 32px\)\) !important/u)
  assert.match(workbenchCss, /\.project-package-event-drawer[\s\S]*translate: none !important/u)
  assert.doesNotMatch(workbenchCss, /@media \(max-width: 680px\)[\s\S]*\.project-package-event-drawer[\s\S]*width: 100vw/u)
  assert.match(workbenchCss, /prefers-reduced-motion/u)
})
