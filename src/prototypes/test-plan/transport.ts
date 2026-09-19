import type { PrototypeStore } from './mock-api'

export function installPrototypeTransport(store: PrototypeStore) {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.pathname.startsWith('/api/')) {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : ''
      return store.handle(url, init?.method ?? (input instanceof Request ? input.method : 'GET'), body)
    }
    if (url.origin !== window.location.origin) throw new Error('原型不允许外部网络请求。')
    return nativeFetch(input, init)
  }
  return () => { window.fetch = nativeFetch }
}
