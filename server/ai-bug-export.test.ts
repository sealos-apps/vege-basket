import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAiBugExportRequest, type AiBugExportBug } from './ai-bug-export.ts'
import { todoImageSignature } from './todo-image-signature.ts'

const bug: AiBugExportBug = {
  actualResult: '页面白屏',
  comments: [],
  environment: 'staging',
  expectedResult: '展示列表',
  id: 42,
  priority: 'high',
  reproductionSteps: '打开页面',
  severity: 'major',
  status: 'new',
  title: '列表无法打开',
}

test('builds a text-only Bug prompt without attachments', async () => {
  const result = await buildAiBugExportRequest(bug, {
    getConfig: () => ({ config: { storage: { objectPrefix: 'veges', urlSecret: 'secret' } } }),
    getLegacySecrets: async () => [],
  })

  assert.equal(result.images.length, 0)
  assert.equal(result.request.imageParts?.length, 0)
  assert.match(result.request.untrustedContext ?? '', /BUG-42/u)
  assert.match(result.request.untrustedContext ?? '', /列表无法打开/u)
})

test('loads only signed image references under the configured object prefix', async () => {
  const objectKey = 'veges/2026-10-01/user-7/image.png'
  const signature = todoImageSignature(objectKey, 'secret')
  const result = await buildAiBugExportRequest({
    ...bug,
    comments: [{
      authorName: '测试员',
      content: `![截图](/api/todo-images?key=${encodeURIComponent(objectKey)}&sig=${encodeURIComponent(signature)})`,
      createdAt: '2026-10-01T00:00:00.000Z',
    }],
  }, {
    getConfig: () => ({ config: { storage: { objectPrefix: 'veges', urlSecret: 'secret' } } }),
    getLegacySecrets: async () => [],
    getObject: async () => ({
      content: Buffer.from('png-bytes'),
      res: { headers: { 'content-type': 'image/png' } },
    }) as never,
  })

  assert.equal(result.images.length, 1)
  assert.equal(result.request.imageParts?.length, 1)
  assert.match(result.request.imageParts?.[0].image_url.url ?? '', /^data:image\/png;base64,/u)
})

test('ignores unsigned and external image references', async () => {
  let reads = 0
  const result = await buildAiBugExportRequest({
    ...bug,
    comments: [{
      authorName: '测试员',
      content: '![外部](https://example.com/image.png) ![伪造](/api/todo-images?key=veges/x.png&sig=bad)',
      createdAt: '2026-10-01T00:00:00.000Z',
    }],
  }, {
    getConfig: () => ({ config: { storage: { objectPrefix: 'veges', urlSecret: 'secret' } } }),
    getLegacySecrets: async () => [],
    getObject: async () => {
      reads += 1
      return { content: Buffer.from('unexpected') } as never
    },
  })

  assert.equal(result.images.length, 0)
  assert.equal(reads, 0)
})
