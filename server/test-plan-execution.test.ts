import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('./migrations/20260920_test_plan_executions.sql', import.meta.url), 'utf8')
const workbench = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const image = readFileSync(new URL('./test-plan-image.ts', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/components/test-plan-execution.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/components/test-workbench.css', import.meta.url), 'utf8')

test('test plan execution history schema keeps encrypted evidence and idempotency boundaries', () => {
  for (const source of [schema, migration]) {
    assert.match(source, /create table if not exists test_plan_executions/u)
    assert.match(source, /unique \(test_plan_case_id, client_id\)/u)
    assert.match(source, /create table if not exists test_plan_execution_images/u)
    assert.match(source, /file_size bigint not null check \(file_size > 0 and file_size <= 10485760\)/u)
    assert.match(source, /test_plan_execution_images\(execution_id, id\)/u)
  }
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

test('execution image transport uses a dedicated allowlisted signed object path', () => {
  assert.match(image, /test-plan-executions/u)
  assert.match(image, /image\/jpeg.*image\/png.*image\/webp.*image\/gif/u)
  assert.match(image, /isTestPlanImageObjectKey/u)
  assert.match(image, /timingSafeEqual/u)
  assert.match(api, /\/api\/test-plan-images/u)
  assert.match(component, /最多 6 张，单张 10 MiB，总计 30 MiB/u)
})

test('real workbench exposes history, recording, Bug evidence, and PDF entry points', () => {
  const workbenchComponent = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
  assert.match(workbenchComponent, /TestPlanExecutionPanel/u)
  assert.match(workbenchComponent, /TestPlanExecutionReport/u)
  assert.match(workbenchComponent, /记录执行/u)
  assert.match(workbenchComponent, /导出 PDF/u)
  assert.match(workbenchComponent, /testPlanExecutionBugEvidence/u)
})

test('execution layout and PDF export degrade gracefully under constrained space or image failures', () => {
  assert.match(styles, /container: test-plan-detail \/ inline-size/u)
  assert.match(styles, /grid-template-areas:[\s\S]*"copy result"[\s\S]*"copy actions"/u)
  assert.match(styles, /content-visibility: auto/u)
  assert.match(styles, /test-plan-execution-report\.is-printing/u)
  assert.match(component, /printImageTimeoutMs = 2500/u)
  assert.match(component, /window\.setTimeout\(\(\) => finish\(false\), printImageTimeoutMs\)/u)
  assert.match(component, /requestAnimationFrame\(\(\) => resolve\(\)\)/u)
  assert.match(component, /if \(!ready\) images\[index\]\.removeAttribute\('src'\)/u)
  assert.match(component, /部分截图加载超时，已继续导出/u)
})
