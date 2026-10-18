// @vitest-environment node

/**
 * The /api proxy the dev and preview servers put in front of uvicorn: where it
 * points, and what it answers when nothing is there.
 *
 * Each test loads a copy of vite.config.ts from a folder of its own, since the
 * config reads the .env files beside it, and the real ones are the
 * developer's.
 */

import { copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ProxyOptions } from 'vite'
import { createServer, resolveConfig } from 'vite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const FRONTEND = fileURLToPath(new URL('.', import.meta.url))
const FROM_DOTENV = 'http://from-dotenv:9999'

let dir: string
let configFile: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vite-config-'))
  configFile = join(dir, 'vite.config.ts')
  await copyFile(join(FRONTEND, 'vite.config.ts'), configFile)
  // So the copy's imports resolve to the packages installed here.
  await symlink(join(FRONTEND, 'node_modules'), join(dir, 'node_modules'), 'dir')
  await writeFile(join(dir, '.env.local'), `VITE_PROXY_TARGET=${FROM_DOTENV}\n`)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function apiProxy(proxies: Record<string, string | ProxyOptions> | undefined): ProxyOptions {
  const proxy = proxies?.['/api']
  if (!proxy || typeof proxy === 'string') throw new Error('no /api proxy options')
  return proxy
}

/** A port nothing is listening on: one the system hands out, let go again. */
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

describe('the proxy target', () => {
  // Vite reads .env files for the bundle only, after the config has run, so
  // a config reading process.env alone would never see this one.
  it('is read from a .env file, by the dev server and the preview alike', async () => {
    vi.stubEnv('VITE_PROXY_TARGET', undefined)
    const config = await resolveConfig({ configFile, logLevel: 'silent' }, 'serve')
    expect(apiProxy(config.server.proxy).target).toBe(FROM_DOTENV)
    expect(apiProxy(config.preview.proxy).target).toBe(FROM_DOTENV)
  })

  // Which is how playwright.config.ts points it at an API of its own.
  it('is taken from the shell over the files', async () => {
    vi.stubEnv('VITE_PROXY_TARGET', 'http://from-shell:7777')
    const config = await resolveConfig({ configFile, logLevel: 'silent' }, 'serve')
    expect(apiProxy(config.server.proxy).target).toBe('http://from-shell:7777')
  })
})

describe('with nothing listening behind the proxy', () => {
  // Vite's own answer is an empty 500, which the client can only call a
  // failed request. A 502 lets it say what is actually wrong.
  it('answers 502, as nginx does, rather than 500', async () => {
    vi.stubEnv('VITE_PROXY_TARGET', `http://127.0.0.1:${await closedPort()}`)
    const server = await createServer({
      configFile,
      logLevel: 'silent',
      cacheDir: join(dir, '.vite'),
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    })
    await server.listen()
    try {
      const [origin] = server.resolvedUrls?.local ?? []
      const response = await fetch(new URL('/api/levels', origin))
      expect(response.status).toBe(502)
    } finally {
      await server.close()
    }
  })
})
