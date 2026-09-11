import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canDeleteTestCase,
  canDeleteTestBug,
  canDeleteTestSubject,
  canEditTestBug,
  canEditTestSpaceVersion,
  canEditTestSubject,
  canDeveloperRejectBug,
  canDeveloperSetBugStatus,
  canManageTestPlan,
  canRemoveTestPlanCase,
  isBugStatus,
  isBugSeverity,
  isTestResult,
  isTestSpaceMembershipStatus,
  normalizeTestSpaceInviteExpiresInMinutes,
  parseOptionalTestSpaceOrganizationId,
} from './test-workbench-policy.ts'

const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const testWorkbenchClientSource = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
const testWorkbenchApiSource = readFileSync(new URL('../src/test-workbench-api.ts', import.meta.url), 'utf8')
const testWorkbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const encryptExistingSource = readFileSync(new URL('./encrypt-existing.ts', import.meta.url), 'utf8')
const versionMigrationSource = readFileSync(new URL('./migrations/20260904_test_space_version_uniqueness.sql', import.meta.url), 'utf8')
const verificationMigrationSource = readFileSync(new URL('./migrations/20260908_test_bug_verification_packages.sql', import.meta.url), 'utf8')
const verificationDeliveriesMigrationSource = readFileSync(new URL('./migrations/20260909_test_bug_verification_deliveries.sql', import.meta.url), 'utf8')

test('test spaces persist encrypted organization-scoped unique versions', () => {
  assert.match(schemaSource, /add column if not exists version_label text/u)
  assert.match(schemaSource, /add column if not exists version_label_lookup text/u)
  assert.match(schemaSource, /idx_test_spaces_organization_version_lookup/u)
  assert.match(versionMigrationSource, /unique index if not exists idx_test_spaces_organization_version_lookup/u)
  assert.match(encryptExistingSource, /encryptTestSpaceVersionFields/u)
  assert.match(encryptExistingSource, /Duplicate test-space versions found in one organization/u)
  assert.match(testWorkbenchSource, /select s\.id, s\.owner_user_id, s\.name, s\.version_label/u)
  assert.match(testWorkbenchSource, /select ts\.id, ts\.owner_user_id, ts\.name, ts\.version_label/u)
  assert.match(testWorkbenchSource, /insert into test_spaces \(owner_user_id, name, version_label, version_label_lookup, organization_id\)/u)
  assert.match(testWorkbenchSource, /set name = \$1, version_label = \$2, version_label_lookup = \$3, organization_id = \$4/u)
  assert.match(testWorkbenchSource, /versionLabel: row\.version_label \? decryptText\(row\.version_label\) : undefined/u)
  assert.match(testWorkbenchClientSource, /createTestSpace\(normalizedName, normalizedVersion, organizationId\)/u)
  assert.match(testWorkbenchSource, /!name \|\| !versionLabel \|\| !organization\.valid \|\| organization\.value === null/u)
  assert.match(testWorkbenchClientSource, /!name\.trim\(\) \|\| !versionLabel\.trim\(\) \|\| !organizationValue/u)
  assert.match(testWorkbenchClientSource, /TestSpaceSelectLabel/u)
  assert.match(testWorkbenchClientSource, /<span>版本号<\/span><strong>\{selectedSpace\.versionLabel \|\| '未指定'\}<\/strong>/u)
  assert.doesNotMatch(testWorkbenchClientSource, /<DialogTitle>修改空间版本<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /迁移到其他测试空间/u)
  const createDialog = testWorkbenchClientSource.slice(
    testWorkbenchClientSource.indexOf('function TestSpaceCreateDialog'),
    testWorkbenchClientSource.indexOf('function TestSpaceDataImportDialog'),
  )
  assert.match(createDialog, /<Input maxLength=\{80\} value=\{versionLabel\}/u)
})

test('test plan root directory entries reserve the correct grid columns', () => {
  assert.match(testWorkbenchClientSource, /test-plan-directory-node-root/u)
  assert.match(testWorkbenchClientSource, /className=\{`test-plan-directory-node test-plan-directory-node-root \$\{selected === 'all'/u)
  assert.match(testWorkbenchClientSource, /className=\{`test-plan-directory-node test-plan-directory-node-root \$\{selected === 'uncategorized'/u)
  assert.match(readFileSync(new URL('../src/components/test-workbench.css', import.meta.url), 'utf8'), /\.test-plan-directory-node-root\s*\{\s*grid-template-columns: 16px minmax\(0, 1fr\) auto;/u)
})

test('test-space member settings do not show unrelated departed accounts', () => {
  assert.doesNotMatch(testWorkbenchSource, /getDepartedUsers/u)
  assert.doesNotMatch(testWorkbenchClientSource, /departedUsers.*TestSpaceSettingsDialog/u)
  assert.match(testWorkbenchClientSource, /<span>成员与邀请<\/span>/u)
  assert.match(testWorkbenchClientSource, /selectedSpace\.members\.length/u)
})

test('Bug scope stays within the current space while its subject is returned as detail metadata', () => {
  assert.match(testWorkbenchSource, /join test_subjects subject on subject\.id = b\.test_subject_id/u)
  assert.match(testWorkbenchSource, /subject\.name as test_subject_name/u)
  assert.match(testWorkbenchSource, /testSubjectName: decryptText\(row\.test_subject_name\)/u)
  assert.match(testWorkbenchClientSource, /const bugs = data\.bugs\.filter\(\s*\(bug\) => bug\.testSpaceId === spaceId,/u)
  assert.doesNotMatch(testWorkbenchClientSource, /const bugs = data\.bugs\.filter\(\s*\(bug\) => bug\.testSpaceId === spaceId && \(!subjectId/u)
  assert.match(testWorkbenchClientSource, /activeSpace && tab === 'cases' \?/u)
  assert.doesNotMatch(testWorkbenchClientSource, /tab === 'cases' && !activeSubject \?/u)
  assert.match(testWorkbenchClientSource, /test-bug-detail-meta/u)
  assert.match(testWorkbenchClientSource, /测试对象\s*<strong>\{bug\.testSubjectName/u)
  assert.match(testWorkbenchClientSource, /测试空间\s*<strong>\{bug\.testSpaceName \|\| '未记录'\}/u)
  assert.match(testWorkbenchClientSource, /当前测试空间还没有测试对象，请先创建测试对象/u)
  assert.match(testWorkbenchClientSource, /<Label>\s*测试对象[\s\S]*subjects\.map/u)
})

test('assigned Bug details include their test subject and space version label', () => {
  assert.match(testWorkbenchSource, /space\.version_label as test_space_version_label/u)
  assert.match(testWorkbenchSource, /testSpaceVersionLabel: row\.test_space_version_label\s*\? decryptText\(row\.test_space_version_label\)\s*:\s*undefined/u)
  assert.match(testWorkbenchClientSource, /selected\.testSubjectName/u)
  assert.match(testWorkbenchClientSource, /selected\.testSpaceVersionLabel \|\| '未指定'/u)
  assert.match(testWorkbenchClientSource, /<small>\{bug\.testSpaceName \|\| '未知测试空间'\} · 版本号 \{bug\.testSpaceVersionLabel \|\| '未指定'\}/u)
  assert.match(testWorkbenchClientSource, /label: `\$\{bug\.testSpaceName\}\$\{bug\.testSpaceVersionLabel \? ` · \$\{bug\.testSpaceVersionLabel\}` : ''\}`/u)
})

test('assigned Bugs use the selected organization for reads, mutations, and local space selection', () => {
  assert.match(testWorkbenchSource, /requireAssignedBugOrganizationContext/u)
  assert.match(testWorkbenchSource, /space\.organization_id is not distinct from \$2::bigint/u)
  assert.match(testWorkbenchSource, /space\.organization_id is not distinct from \$3::bigint/u)
  assert.match(testWorkbenchSource, /space\.organization_id is not distinct from \$4::bigint/u)
  assert.match(testWorkbenchSource, /getAssignedBugs\(session\.userId, organizationId\)/u)
  assert.match(testWorkbenchApiSource, /function withOrganizationContext/u)
  assert.match(testWorkbenchApiSource, /serializeOrganizationContext\(organizationId\)/u)
  assert.match(testWorkbenchApiSource, /fetchAssignedTestBugs\(organizationId: OrganizationContext\)/u)
  assert.match(testWorkbenchClientSource, /fetchAssignedTestBugs\(organizationId\)/u)
  assert.match(testWorkbenchClientSource, /getAssignedBugSpaceStorageKey\(currentUserId, organizationId\)/u)
})

test('developer bug transitions stop at pending verification', () => {
  assert.equal(canDeveloperSetBugStatus('assigned', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('pending_confirmation', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('in_progress', 'pending_verification'), true)
  assert.equal(canDeveloperSetBugStatus('pending_verification', 'closed'), false)
  assert.equal(canDeveloperSetBugStatus('new', 'rejected'), false)
  assert.equal(canDeveloperSetBugStatus('pending_confirmation', 'pending_verification'), false)
})

test('developer can reject only Bugs that are not yet being fixed', () => {
  assert.equal(canDeveloperRejectBug('pending_confirmation'), true)
  assert.equal(canDeveloperRejectBug('assigned'), true)
  assert.equal(canDeveloperRejectBug('in_progress'), false)
  assert.equal(canDeveloperRejectBug('pending_verification'), false)
  assert.equal(canDeveloperRejectBug('rejected'), false)
  assert.equal(canDeveloperRejectBug('closed'), false)
})

test('bug status and comment kind checks include pending confirmation, reject, and legacy acceptance', () => {
  assert.match(schemaSource, /update test_bugs[\s\S]*where status in \('confirmed', 'reopened'\)/u)
  assert.match(schemaSource, /update test_bugs[\s\S]*where status = 'duplicate'/u)
  assert.match(schemaSource, /check \(status in \('new', 'pending_confirmation', 'assigned', 'in_progress', 'pending_verification', 'closed', 'rejected'\)\)/u)
  assert.match(schemaSource, /check \(kind in \('comment', 'transfer', 'reject', 'acceptance'\)\)/u)
})

test('returning a Bug to pending confirmation keeps the status change notification', () => {
  assert.match(testWorkbenchSource, /(status|lockedStatus) === 'pending_verification'\s*\|\|\s*\((?:status|lockedStatus) === 'pending_confirmation'\s*&&\s*(?:currentBug|lockedBug)\.status\s*!==\s*'new'\)/u)
  assert.match(testWorkbenchSource, /b\.status not in \('closed', 'rejected'\)/u)
  assert.match(testWorkbenchSource, /!\[['"]closed['"], ['"]rejected['"]\]\.includes\(row\.status\)/u)
})

test('assigned Bugs start in pending confirmation and reject writes a system comment', () => {
  assert.match(testWorkbenchSource, /const status(?:: BugStatus)? = assigneeUserId \? 'pending_confirmation' : 'new'/u)
  assert.match(testWorkbenchSource, /status = 'pending_confirmation', updated_at = now\(\)/u)
  const rejectRouteStart = testWorkbenchSource.indexOf("router.post('/test-bugs/:bugId/assigned/reject'")
  assert.ok(rejectRouteStart >= 0)
  const rejectRoute = testWorkbenchSource.slice(rejectRouteStart)
  assert.match(rejectRoute, /canDeveloperRejectBug\(bug\.status\)/u)
  assert.match(rejectRoute, /status = 'rejected', updated_at = now\(\)/u)
  assert.match(rejectRoute, /values \(\$1, \$2, \$3, 'reject'\)/u)
  assert.match(rejectRoute, /onTestBugRejected\(/u)
  assert.match(rejectRoute, /for update of b/u)
})

test('developer workbench offers start and reject for pending confirmation Bugs', () => {
  assert.match(testWorkbenchClientSource, /pending_confirmation: '待确认'/u)
  assert.match(testWorkbenchClientSource, /selected\.status === 'pending_confirmation'/u)
  assert.match(testWorkbenchClientSource, /<DialogTitle>驳回 Bug<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /rejectAssignedTestBug\(organizationId, bug\.id, reason\)/u)
  assert.match(testWorkbenchClientSource, /驳回记录/u)
})

test('verification submissions snapshot one delivery mode and emit an immutable acceptance comment atomically', () => {
  assert.match(schemaSource, /create table if not exists test_bug_verification_submissions/u)
  assert.match(schemaSource, /create table if not exists test_bug_verification_packages/u)
  assert.match(schemaSource, /create table if not exists test_bug_verification_container_images/u)
  assert.match(schemaSource, /unique \(test_bug_verification_submission_id, object_key\)/u)
  assert.match(verificationMigrationSource, /^begin;$/mu)
  assert.match(verificationMigrationSource, /^commit;$/mu)
  assert.match(verificationDeliveriesMigrationSource, /^begin;$/mu)
  assert.match(verificationDeliveriesMigrationSource, /verification_submission_id bigint/u)
  assert.match(verificationDeliveriesMigrationSource, /kind in \('acceptance', 'comment', 'transfer', 'reject'\)/u)
  assert.match(verificationDeliveriesMigrationSource, /idx_test_bug_comments_verification_submission/u)
  assert.match(testWorkbenchSource, /router\.post\('\/test-bugs\/:bugId\/assigned\/verification-submissions'/u)
  assert.match(testWorkbenchSource, /parseVerificationPackages\(request\.body\?\.packages\)/u)
  assert.match(testWorkbenchSource, /parseVerificationContainerImages\(request\.body\?\.containerImages\)/u)
  assert.match(testWorkbenchSource, /packages\.length > 20/u)
  assert.match(testWorkbenchSource, /objectKeys\.has\(objectKey\)/u)
  assert.match(testWorkbenchSource, /packageVersions\.get\(sourcePackageId\)/u)
  assert.match(testWorkbenchSource, /安装包与集群镜像必须二选一/u)
  assert.match(testWorkbenchSource, /normalizeContainerImageReference\(candidate, \{ requireTagOrDigest: true \}\)/u)
  assert.match(testWorkbenchSource, /for update of b/u)
  assert.match(testWorkbenchSource, /ensurePackageMarketRuleAllowed\(rules, policy, item\.sourcePackageId, item\.channel\)/u)
  assert.match(testWorkbenchSource, /isPackageMarketObjectKeyAllowedForRule/u)
  assert.match(testWorkbenchSource, /insert into test_bug_verification_submissions/u)
  assert.match(testWorkbenchSource, /insert into test_bug_verification_container_images/u)
  assert.match(testWorkbenchSource, /insert into test_bug_comments[\s\S]*?'acceptance'/u)
  assert.match(testWorkbenchSource, /formatVerificationAcceptanceComment/u)
  assert.doesNotMatch(testWorkbenchSource, /\$ veges bug verify-/u)
  assert.match(testWorkbenchSource, /update test_bugs[\s\S]*set status = 'pending_verification'/u)
  assert.match(testWorkbenchSource, /请通过提交验证流程选择安装包后再提交/u)
  assert.match(testWorkbenchSource, /verification-submissions\/:submissionId\/script/u)
  assert.match(testWorkbenchSource, /createPackageItemDownloadLink/u)
  assert.match(testWorkbenchSource, /createClusterImageVerificationScript/u)
  assert.match(testWorkbenchClientSource, /关联集群镜像/u)
  assert.match(testWorkbenchClientSource, /集群镜像名称 \$\{index \+ 1\}/u)
  assert.match(testWorkbenchClientSource, /normalizeContainerImageReference\(value, \{ requireTagOrDigest: true \}\)/u)
  assert.match(testWorkbenchClientSource, /提交验证（集群镜像 \$\{normalizedContainerImages\.length\}）/u)
  assert.match(testWorkbenchClientSource, /submitAssignedBugVerification\(organizationId, bug\.id, packages, containerImages\)/u)
  assert.match(testWorkbenchClientSource, /BugVerificationSubmissions/u)
  assert.match(testWorkbenchClientSource, /<h3>验收记录<\/h3>/u)
  assert.match(testWorkbenchClientSource, /复制验证脚本/u)
  assert.match(testWorkbenchClientSource, /fetchTestBugVerificationScript/u)
  assert.match(testWorkbenchClientSource, /bug\.comments\.filter\(\(item\) => item\.kind !== 'acceptance'\)/u)
  assert.match(testWorkbenchClientSource, /submission\.packages\.map\(\(item\) => \[item\.sourcePackageId, item\]\)/u)
})

test('verification package picker supports filtered paginated catalogs and incremental version loading', () => {
  assert.match(testWorkbenchClientSource, /aria-label="安装包渠道"/u)
  assert.match(testWorkbenchClientSource, /\['release', '正式包'\]/u)
  assert.match(testWorkbenchClientSource, /\['ci', '测试包'\]/u)
  assert.match(testWorkbenchClientSource, /test-verification-channel-\$\{value\}/u)
  assert.match(testWorkbenchClientSource, /aria-label="安装包类别"/u)
  assert.match(testWorkbenchClientSource, /aria-label="搜索安装包"/u)
  assert.match(testWorkbenchClientSource, /const rulePageSize = 8/u)
  assert.match(testWorkbenchClientSource, /aria-label="安装包分页"/u)
  assert.match(testWorkbenchClientSource, /fetchPackageMarketReleaseVersions/u)
  assert.match(testWorkbenchClientSource, /fetchPackageMarketCiVersions/u)
  assert.match(testWorkbenchClientSource, /加载更多版本/u)
  assert.match(testWorkbenchClientSource, /type SelectedVerificationPackage = VerificationPackageSelection &/u)
  assert.match(testWorkbenchClientSource, /selectionKey: string/u)
  assert.match(testWorkbenchClientSource, /const selectedGroups = useMemo/u)
  assert.match(testWorkbenchClientSource, /function verificationPackageSnapshot\(item: SelectedVerificationPackage\)/u)
  assert.match(testWorkbenchClientSource, /const payload = packages\.map\(verificationPackageSnapshot\)/u)
  assert.match(testWorkbenchClientSource, /已选择 \$\{conflictingSelection\.sourcePackageName\}/u)
  assert.match(testWorkbenchClientSource, /请先移除后再选择其他版本/u)
  assert.doesNotMatch(testWorkbenchClientSource, /跳过并提交/u)
})

test('reopening a rejected or closed Bug is a dedicated button next to share that returns it to pending confirmation', () => {
  assert.match(testWorkbenchClientSource, /\(bug\.status === 'rejected' \|\| bug\.status === 'closed'\) \? <Button/u)
  assert.match(testWorkbenchClientSource, /onStatus\(bug, 'pending_confirmation'\)/u)
  assert.match(testWorkbenchClientSource, /<ArrowCounterClockwise \/> 重新打开/u)
  assert.doesNotMatch(testWorkbenchClientSource, /\[['"]reopened['"], '重新打开'\]/u)
  assert.doesNotMatch(testWorkbenchClientSource, /if \(status === 'reopened'\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /updateTestBug\(selected\.testSpaceId, selected\.id, \{ status: 'pending_confirmation' \}\)/u)
})

test('Bug timeline records creation, assignment, transfer and status changes without comments', () => {
  assert.match(schemaSource, /create table if not exists test_bug_events/u)
  assert.match(schemaSource, /transfer_source text/u)
  assert.match(schemaSource, /test_bug_events_transfer_source_check/u)
  assert.match(schemaSource, /event_type text not null\s+check \(event_type in \('created', 'assigned', 'transferred', 'status_changed', 'space_transferred'\)\)/u)
  assert.match(schemaSource, /create index if not exists idx_test_bug_events_bug/u)
  assert.match(schemaSource, /on test_bug_events\(test_bug_id, created_at, id\)/u)

  assert.match(testWorkbenchSource, /async function recordTestBugEvent\(/u)
  assert.match(testWorkbenchSource, /insert into test_bug_events/u)
  assert.match(testWorkbenchSource, /eventType: 'created'/u)
  assert.match(testWorkbenchSource, /eventType: 'assigned'/u)
  assert.match(testWorkbenchSource, /eventType: 'transferred'/u)
  assert.match(testWorkbenchSource, /transferSource: 'manual'/u)
  assert.match(testWorkbenchSource, /transferSource: row\.transfer_source \?\? undefined/u)
  assert.match(testWorkbenchSource, /eventType: 'status_changed'/u)
  assert.match(testWorkbenchSource, /eventType: 'space_transferred'/u)
  assert.match(testWorkbenchSource, /previous_test_space_id, next_test_space_id/u)
  assert.match(testWorkbenchSource, /events: eventsByBug\.get\(Number\(row\.id\)\) \?\? \[\]/u)
  assert.match(testWorkbenchSource, /reporter\.display_name as reporter_display_name/u)
  assert.match(testWorkbenchSource, /reporterName: row\.reporter_display_name \|\| row\.reporter_email \|\| undefined/u)
  assert.match(testWorkbenchSource, /assigneeName: row\.assignee_display_name \|\| row\.assignee_email \|\| undefined/u)
  assert.match(testWorkbenchClientSource, /assigneeTransferSource === 'offboarding' \? '（离职转移）' : null/u)
})

test('Bug detail header actions use icon-only buttons with accessible labels', () => {
  assert.match(testWorkbenchClientSource, /aria-label="转移空间"[\s\S]*?size="icon-sm"[\s\S]*?title="转移空间"[\s\S]*?<ArrowsLeftRight \/><\/Button>/u)
  assert.match(testWorkbenchClientSource, /aria-label="时间线"[\s\S]*?size="icon-sm"[\s\S]*?title="时间线"[\s\S]*?<Clock \/><\/Button>/u)
  assert.match(testWorkbenchClientSource, /aria-label="分享 Bug"[\s\S]*?size="icon-sm"[\s\S]*?title="分享 Bug"[\s\S]*?<LinkSimple \/><\/Button>/u)
  assert.match(testWorkbenchClientSource, /aria-label="编辑"[\s\S]*?size="icon-sm"[\s\S]*?title="编辑"[\s\S]*?<PencilSimple \/><\/Button>/u)
  assert.match(testWorkbenchClientSource, /function BugTimelineDialog/u)
  assert.match(testWorkbenchClientSource, /<DialogTitle>Bug 时间线<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /eventType === 'created' \? \(/u)
  assert.match(testWorkbenchClientSource, /创建了 Bug/u)
  assert.match(testWorkbenchClientSource, /指派给 <UserName/u)
  assert.match(testWorkbenchClientSource, /转移给 <UserName/u)
  assert.match(testWorkbenchClientSource, /状态从「\{event\.previousStatus \? bugStatusLabel\[event\.previousStatus\] : '未知'\}」改为「\{event\.nextStatus \? bugStatusLabel\[event\.nextStatus\] : '未知'\}」/u)
  assert.match(testWorkbenchClientSource, /hasCreatedEvent = bug\.events\.some\(\(event\) => event\.eventType === 'created'\)/u)
  assert.match(testWorkbenchClientSource, /isNamedTransferComment/u)
  assert.match(testWorkbenchClientSource, /comment\.kind === 'transfer' && \/转移给「\(\[\^」\]\+\)」\/u\.test\(comment\.content\)/u)
  assert.match(testWorkbenchClientSource, /eventType: comment\.kind === 'reject' \? 'rejected' as const : 'transferred' as const/u)
  assert.match(testWorkbenchClientSource, /转移给「\(\[\^」\]\+\)」/u)
  assert.match(testWorkbenchClientSource, /驳回了该 Bug/u)
  assert.match(testWorkbenchClientSource, /eventType === 'space_transferred'/u)
  assert.match(testWorkbenchClientSource, /previousSpaceName/u)
  assert.match(testWorkbenchClientSource, /nextSpaceName/u)
})

test('test-space data import supports copied cases and plans only', () => {
  assert.match(schemaSource, /create table if not exists test_space_data_imports/u)
  assert.match(schemaSource, /unique \(target_test_space_id, source_test_space_id, data_type, source_record_id\)/u)
  assert.match(testWorkbenchSource, /router\.post\('\/test-spaces\/:spaceId\/data-import'/u)
  assert.match(testWorkbenchSource, /requireSpaceOwner\(response, targetSpaceId, session\.userId\)/u)
  assert.match(testWorkbenchSource, /category === 'cases' \|\| category === 'plans'/u)
  assert.match(testWorkbenchClientSource, /复制到当前空间/u)
  assert.match(testWorkbenchClientSource, /全部用例/u)
  assert.match(testWorkbenchClientSource, /全部测试计划/u)
  assert.doesNotMatch(testWorkbenchClientSource, /全部复制到当前空间/u)
  assert.doesNotMatch(testWorkbenchClientSource, /转移到当前空间/u)
  assert.doesNotMatch(testWorkbenchClientSource, /movedBugs/u)
  assert.match(testWorkbenchClientSource, /<Checkbox/u)
  assert.match(testWorkbenchClientSource, /importTestSpaceData\(selectedSpace\.id, sources\)/u)
})

test('Bug details offer same-organization space transfer with the existing transfer transaction', () => {
  assert.match(testWorkbenchSource, /router\.post\('\/test-spaces\/:spaceId\/bugs\/:bugId\/transfer-space'/u)
  assert.match(testWorkbenchSource, /bugIds: \[bugId\], categories: \['bugs'\], spaceId/u)
  assert.match(testWorkbenchSource, /canTransferSpace: canEditTestSpaceVersion/u)
  assert.match(testWorkbenchSource, /transferSpaceCandidates: ownedSpaces/u)
  assert.match(testWorkbenchSource, /space\.organization_id === row\.organization_id/u)
  assert.match(testWorkbenchSource, /allowBugCreatorTransfer: true/u)
  assert.match(testWorkbenchSource, /目标测试空间还没有测试对象，请先创建测试对象/u)
  assert.match(testWorkbenchClientSource, /bug\.canTransferSpace/u)
  assert.match(testWorkbenchClientSource, /<BugSpaceTransferDialog/u)
  assert.match(testWorkbenchClientSource, /<DialogTitle>转移 Bug 到其他空间<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /transferTestBugToSpace\(bug\.testSpaceId, bug\.id, targetSpaceId\)/u)
})

test('assigned Bug selection keeps the current item when parent callbacks refresh counts', () => {
  assert.match(testWorkbenchClientSource, /const onBugsChangeRef = useRef\(onBugsChange\)/u)
  assert.match(testWorkbenchClientSource, /onBugsChangeRef\.current\?\.\(result\.bugs\)/u)
  assert.match(testWorkbenchClientSource, /useEffect\(\(\) => \{\s+onBugsChangeRef\.current = onBugsChange\s+\}, \[onBugsChange\]\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /useEffect\(\(\) => \{\s+fetchAssignedTestBugs\(\)[\s\S]*\}, \[currentUserId, initialBugId, onBugsChange\]\)/u)
})

test('test result and bug status guards reject unknown values', () => {
  assert.equal(isTestResult('blocked'), true)
  assert.equal(isTestResult('success'), false)
  assert.equal(isBugStatus('pending_verification'), true)
  assert.equal(isBugStatus('confirmed'), false)
  assert.equal(isBugStatus('fixed'), false)
  assert.equal(isBugSeverity('major'), true)
  assert.equal(isBugSeverity('fixed'), false)
})

test('test workbench restores the last visited tab, space and selection after refresh', () => {
  assert.match(testWorkbenchClientSource, /testWorkbenchViewStatePrefix = 'veges\.testWorkbench\.viewState\.v1'/u)
  assert.match(testWorkbenchClientSource, /function readTestWorkbenchViewState/u)
  assert.match(testWorkbenchClientSource, /function writeTestWorkbenchViewState/u)
  assert.match(testWorkbenchClientSource, /const saved = readTestWorkbenchViewState\(currentUserId\)/u)
  assert.match(testWorkbenchClientSource, /setSpaceId\(savedSpaceId \?\? result\.spaces\[0\]\?\.id\)/u)
  assert.match(testWorkbenchClientSource, /setTab\(saved\?\.tab \?\? 'cases'\)/u)
  assert.match(testWorkbenchClientSource, /viewStateReadyRef\.current = true/u)
  assert.match(testWorkbenchClientSource, /if \(!viewStateReadyRef\.current\) return/u)
  assert.match(testWorkbenchClientSource, /writeTestWorkbenchViewState\(currentUserId, \{/u)
})

test('only the Bug creator can edit Bug details', () => {
  assert.equal(canEditTestBug(42, 42), true)
  assert.equal(canEditTestBug(42, 7), false)
  assert.equal(canEditTestBug(null, 7), false)
})

test('Bug deletion and test-space version editing stay creator/owner scoped', () => {
  assert.equal(canDeleteTestBug(42, 42), true)
  assert.equal(canDeleteTestBug(42, 7), false)
  assert.equal(canDeleteTestBug(null, 42), false)
  assert.equal(canEditTestSpaceVersion(7, null, 7), true)
  assert.equal(canEditTestSpaceVersion(7, 42, 42), true)
  assert.equal(canEditTestSpaceVersion(7, 42, 8), false)
  assert.equal(canEditTestSpaceVersion(null, 42, 42), true)
})

test('Bug deletion and version routes recheck direct membership and keep mutations scoped', () => {
  const versionStart = testWorkbenchSource.indexOf("router.patch('/test-spaces/:spaceId/version'")
  const spaceDeleteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId'", versionStart)
  const bugDeleteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/bugs/:bugId'")
  const commentsStart = testWorkbenchSource.indexOf("router.post('/test-spaces/:spaceId/bugs/:bugId/comments'", bugDeleteStart)
  assert.ok(versionStart >= 0)
  assert.ok(spaceDeleteStart > versionStart)
  assert.ok(bugDeleteStart >= 0)
  assert.ok(commentsStart > bugDeleteStart)
  const versionRoute = testWorkbenchSource.slice(versionStart, spaceDeleteStart)
  const bugDeleteRoute = testWorkbenchSource.slice(bugDeleteStart, commentsStart)
  assert.match(versionRoute, /requireActiveRole\(request, response, 'tester'\)/u)
  assert.match(versionRoute, /getDirectSpaceAccess\(spaceId, session\.userId, client\)/u)
  assert.match(versionRoute, /where space\.id = \$1[\s\S]*\[spaceId\]/u)
  assert.match(versionRoute, /from test_bugs[\s\S]*reporter_user_id = \$2[\s\S]*for share/u)
  assert.match(versionRoute, /canEditTestSpaceVersion/u)
  assert.match(versionRoute, /set version_label = \$1, version_label_lookup = \$2, updated_at = now\(\)/u)
  assert.match(versionRoute, /hasTestSpaceVersionConflict\(client, Number\(space\.organization_id\), versionLabel, spaceId\)/u)
  assert.match(versionRoute, /!spaceId \|\| !hasVersionLabel \|\| !versionLabel/u)
  assert.match(bugDeleteRoute, /getDirectSpaceAccess\(spaceId, session\.userId, client\)/u)
  assert.match(bugDeleteRoute, /canDeleteTestBug/u)
  assert.match(bugDeleteRoute, /delete from notification_deliveries/u)
  assert.match(bugDeleteRoute, /delete from notification_states/u)
  assert.match(bugDeleteRoute, /delete from test_bugs where id = \$1 and test_space_id = \$2/u)
})

test('configured test environments are restricted to assigned spaces and preserve Bug snapshots', () => {
  assert.match(schemaSource, /create table if not exists test_environments/u)
  assert.match(schemaSource, /create table if not exists test_environment_spaces/u)
  assert.match(schemaSource, /test_environment_id bigint references test_environments\(id\)/u)
  assert.match(schemaSource, /foreign key \(test_environment_id, test_space_id\)\s+references test_environment_spaces/u)
  assert.match(testWorkbenchSource, /getAssignedTestEnvironment\(/u)
  assert.match(testWorkbenchSource, /Test environment is not configured for this test space/u)
  assert.match(testWorkbenchSource, /environmentSnapshot\(/u)
  assert.match(testWorkbenchClientSource, /environments\.map\(\(item\) => <SelectItem/u)
  assert.match(testWorkbenchClientSource, /手工填写环境/u)
})

test('only the test subject creator can edit or delete it', () => {
  assert.equal(canEditTestSubject(7, 7), true)
  assert.equal(canEditTestSubject(7, 8), false)
  assert.equal(canEditTestSubject(null, 7), false)
  assert.equal(canDeleteTestSubject(7, 7), true)
  assert.equal(canDeleteTestSubject(7, 8), false)
  assert.equal(canDeleteTestSubject(null, 7), false)
})

test('only the test case creator can delete it', () => {
  assert.equal(canDeleteTestCase(7, 7), true)
  assert.equal(canDeleteTestCase(7, 8), false)
  assert.equal(canDeleteTestCase(null, 7), false)
})

test('test case deletion stays creator-scoped and preserves plan snapshots', () => {
  const deleteRouteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/cases/:caseId'")
  const createPlanRouteStart = testWorkbenchSource.indexOf("router.post('/test-spaces/:spaceId/plans'", deleteRouteStart)

  assert.ok(deleteRouteStart >= 0)
  assert.ok(createPlanRouteStart > deleteRouteStart)

  const deleteRoute = testWorkbenchSource.slice(deleteRouteStart, createPlanRouteStart)
  assert.match(deleteRoute, /requireActiveRole\(request, response, 'tester'\)/u)
  assert.match(deleteRoute, /requireSpaceAccess\(response, spaceId, session\.userId, true\)/u)
  assert.match(deleteRoute, /canDeleteTestCase\(createdByUserId, session\.userId\)/u)
  assert.match(deleteRoute, /where id = \$1 and test_space_id = \$2 and created_by_user_id = \$3/u)
  assert.match(schemaSource, /test_case_id bigint references test_cases\(id\) on delete set null/u)
})

test('test case deletion is exposed only when allowed and requires confirmation', () => {
  assert.match(testWorkbenchClientSource, /selected\.canDelete/u)
  assert.match(testWorkbenchClientSource, /<DialogTitle>删除测试用例<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /已加入测试计划的执行快照继续保留/u)
  assert.match(testWorkbenchClientSource, /deleteTestCase\(casePendingDelete\.testSpaceId, casePendingDelete\.id\)/u)
  assert.match(testWorkbenchClientSource, /<Dialog open=\{caseDeleteDialogOpen\} onOpenChange=\{setCaseDeleteDialogOpen\}>/u)
  assert.match(testWorkbenchClientSource, /if \(caseDeleteDialogOpen \|\| !casePendingDelete\) return[\s\S]*setTimeout[\s\S]*setCasePendingDelete\(undefined\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /open=\{Boolean\(casePendingDelete\)\}/u)
  assert.match(testWorkbenchClientSource, /<Dialog open=\{planDeleteDialogOpen\} onOpenChange=\{setPlanDeleteDialogOpen\}>/u)
  assert.match(testWorkbenchClientSource, /if \(planDeleteDialogOpen \|\| !planPendingDelete\) return[\s\S]*setTimeout[\s\S]*setPlanPendingDelete\(undefined\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /open=\{Boolean\(planPendingDelete\)\}/u)
  assert.doesNotMatch(testWorkbenchClientSource, /归档为基线|onArchive|caseKind|case_kind/u)
  assert.match(testWorkbenchSource, /insert into test_cases[\s\S]*values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13\)/u)
})

test('test subject editing uses a dedicated patch route without version or environment fields', () => {
  const patchRouteStart = testWorkbenchSource.indexOf("router.patch('/test-spaces/:spaceId/subjects/:subjectId'")
  const deleteRouteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/subjects/:subjectId'")

  assert.ok(patchRouteStart >= 0)
  assert.ok(deleteRouteStart > patchRouteStart)

  const patchRoute = testWorkbenchSource.slice(patchRouteStart, deleteRouteStart)
  assert.match(patchRoute, /Only the test subject creator can edit it/u)
  assert.match(patchRoute, /set name = \$1,\s+name_lookup = \$2,\s+description = \$3,\s+updated_at = now\(\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /当前版本|默认环境/u)
})

test('test space invitation policy accepts only supported states and expiries', () => {
  assert.equal(isTestSpaceMembershipStatus('pending'), true)
  assert.equal(isTestSpaceMembershipStatus('active'), true)
  assert.equal(isTestSpaceMembershipStatus('removed'), false)
  assert.equal(normalizeTestSpaceInviteExpiresInMinutes(60), 60)
  assert.equal(normalizeTestSpaceInviteExpiresInMinutes(15), 10)
  assert.equal(normalizeTestSpaceInviteExpiresInMinutes('1440'), 1440)
})

test('test space organization selection accepts an active id or no organization', () => {
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(null), { valid: true, value: null })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(''), { valid: true, value: null })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId('12'), { valid: true, value: 12 })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(12), { valid: true, value: 12 })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(0), { valid: false })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(true), { valid: false })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId('1.5'), { valid: false })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId('invalid'), { valid: false })
})

test('test space organization changes validate membership before updating', () => {
  const membershipLock = testWorkbenchSource.indexOf('lockActiveOrganizationMembership(client, nextOrganizationId')
  const memberValidation = testWorkbenchSource.indexOf('everyCurrentTestSpaceMemberBelongsToOrganization(client, spaceId, nextOrganizationId)')
  const update = testWorkbenchSource.indexOf('set name = $1, version_label = $2, version_label_lookup = $3, organization_id = $4, updated_at = now()')

  assert.notEqual(membershipLock, -1)
  assert.notEqual(memberValidation, -1)
  assert.notEqual(update, -1)
  assert.ok(membershipLock < memberValidation)
  assert.ok(memberValidation < update)
  assert.match(testWorkbenchSource, /status in \('pending', 'active'\)[\s\S]*for share of membership/u)
  assert.match(testWorkbenchSource, /update test_space_invite_links set revoked_at = now\(\)/u)
  assert.match(testWorkbenchSource, /hasOwnProperty\.call\(request\.body \?\? \{\}, 'organizationId'\)/u)
  assert.match(testWorkbenchSource, /hasTestSpaceVersionConflict\(client, nextOrganizationId, versionLabel, spaceId\)/u)
})

test('organization test-space invite links can be created and require member access on acceptance', () => {
  const createRouteStart = testWorkbenchSource.indexOf("router.post('/test-spaces/:spaceId/invite-link'")
  const deleteRouteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/invite-link'")
  const acceptRouteStart = testWorkbenchSource.indexOf("router.post('/test-space-invite-links/:token/accept'")
  assert.ok(createRouteStart >= 0)
  assert.ok(deleteRouteStart > createRouteStart)
  assert.ok(acceptRouteStart > deleteRouteStart)

  const createRoute = testWorkbenchSource.slice(createRouteStart, deleteRouteStart)
  const acceptRoute = testWorkbenchSource.slice(acceptRouteStart)
  assert.doesNotMatch(createRoute, /Organization test spaces do not use public invite links/u)
  assert.match(acceptRoute, /lockActiveOrganizationMembership\(client, organizationId, session\.userId\)/u)
  assert.match(acceptRoute, /Organization test space invites require active organization membership/u)
})

test('only the plan creator can manage it and remove unexecuted cases', () => {
  assert.equal(canManageTestPlan(7, 7), true)
  assert.equal(canManageTestPlan(7, 8), false)
  assert.equal(canRemoveTestPlanCase(7, 7, 'untested'), true)
  assert.equal(canRemoveTestPlanCase(7, 7, 'passed'), false)
  assert.equal(canRemoveTestPlanCase(7, 8, 'untested'), false)
})
