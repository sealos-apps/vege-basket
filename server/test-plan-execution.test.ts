import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('./migrations/20260920_test_plan_executions.sql', import.meta.url), 'utf8')
const imageLimitMigration = readFileSync(new URL('./migrations/20260921_test_plan_execution_image_platform_limit.sql', import.meta.url), 'utf8')
const workbench = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const image = readFileSync(new URL('./test-plan-image.ts', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/components/test-plan-execution.tsx', import.meta.url), 'utf8')
const workbenchComponent = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/components/test-workbench.css', import.meta.url), 'utf8')

test('test plan execution history schema keeps encrypted evidence and idempotency boundaries', () => {
  for (const source of [schema, migration]) {
    assert.match(source, /create table if not exists test_plan_executions/u)
    assert.match(source, /unique \(test_plan_case_id, client_id\)/u)
    assert.match(source, /create table if not exists test_plan_execution_images/u)
    assert.match(source, /test_plan_execution_images\(execution_id, id\)/u)
  }
  assert.match(migration, /file_size bigint not null check \(file_size > 0 and file_size <= 10485760\)/u)
  assert.match(schema, /file_size bigint not null check \(file_size > 0 and file_size <= 31457280\)/u)
  assert.match(schema, /pg_get_constraintdef\(oid\) not like '%31457280%'/u)
  assert.match(imageLimitMigration, /drop constraint if exists test_plan_execution_images_file_size_check/u)
  assert.match(imageLimitMigration, /check \(file_size > 0 and file_size <= 31457280\)/u)
})

test('execution writes lock the plan case, encrypt text, append images, and update the legacy final result', () => {
  assert.match(workbench, /for update of pc, p/u)
  assert.match(workbench, /on conflict \(test_plan_case_id, client_id\) do nothing/u)
  assert.match(workbench, /encryptText\(input\.actualResult\)/u)
  assert.match(workbench, /encryptText\(input\.note\)/u)
  assert.match(workbench, /insert into test_plan_execution_images/u)
  assert.match(workbench, /update test_plan_cases[\s\S]+result = \$1, result_note = \$2/u)
  assert.match(workbench, /router\.post\('\/test-spaces\/:spaceId\/plan-cases\/:planCaseId\/executions'/u)
})

test('execution image transport uses a dedicated allowlisted signed object path and platform size limit', () => {
  assert.match(image, /test-plan-executions/u)
  assert.match(image, /image\/jpeg.*image\/png.*image\/webp.*image\/gif/u)
  assert.match(image, /isTestPlanImageObjectKey/u)
  assert.match(image, /timingSafeEqual/u)
  assert.match(api, /\/api\/test-plan-images/u)
  assert.match(image, /testPlanImageUploadMaxBytes/u)
  assert.match(image, /config\.storage\.uploadMaxBytes/u)
  assert.match(image, /Math\.min\(testPlanImageMaxTotalBytes/u)
  assert.match(workbench, /testPlanImageMaxBytes: testPlanImageUploadMaxBytes\(\)/u)
  assert.match(component, /剩余 \{remainingImageCount\} 张/u)
  assert.match(component, /剩余 \{formatMiB\(remainingImageBytes\)\}/u)
})

test('real workbench exposes history, recording, and Bug evidence without PDF implementation', () => {
  assert.match(workbenchComponent, /TestPlanExecutionPanel/u)
  assert.match(workbenchComponent, /记录执行/u)
  assert.match(workbenchComponent, /testPlanExecutionBugEvidence/u)
  assert.doesNotMatch(workbenchComponent, /TestPlanExecutionReport|导出 PDF|打印 \/ 保存 PDF/u)
  assert.doesNotMatch(component, /TestPlanExecutionReport|打印 \/ 保存 PDF|window\.print/u)
})

test('execution layout and history status contrast remain stable under constrained space', () => {
  assert.match(styles, /container: test-plan-detail \/ inline-size/u)
  assert.match(workbenchComponent, /PLAN_EXECUTION_ROW_BLOCK_SIZE = 116/u)
  assert.match(styles, /grid-auto-rows: minmax\(108px, auto\)/u)
  assert.match(styles, /min-height: 108px/u)
  assert.match(styles, /minmax\(300px, 360px\)/u)
  assert.match(styles, /grid-template-areas:[\s\S]*"copy result"[\s\S]*"copy actions"/u)
  assert.match(component, /test-execution-result-badge test-execution-result-\$\{record\.result\}/u)
  assert.match(component, /test-execution-history-index/u)
  assert.match(component, /test-execution-history-latest/u)
  assert.match(styles, /test-execution-result-passed/u)
  assert.match(styles, /test-execution-result-failed/u)
  assert.match(styles, /test-execution-history-latest/u)
})
