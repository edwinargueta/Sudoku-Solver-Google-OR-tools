import { defineConfig, devices } from '@playwright/test'

// The browser tests run against the bundle that ships and the real API: a
// fresh `vite build` served by `vite preview`, proxying /api to uvicorn and
// CP-SAT. Both start on ports of their own, so a running `make dev` is left
// alone, and neither is ever reused, so a stale build cannot be tested by
// mistake.
const CI = !!process.env.CI
const API_PORT = 8001
const WEB_PORT = 4180

// `make e2e-linux` runs the browsers in Playwright's Ubuntu 24.04 image: the
// release CI runs on, and the browser builds this version installs there. The
// tests and servers stay on this machine; '<loopback>' lets the browsers in the
// container reach them.
const linuxBrowsers = process.env.E2E_BROWSER_SERVER

// Safari's visible area on an iPhone SE with both toolbars showing. The
// preset's 375x667 is the whole screen, which would let a number pad pushed
// below the fold pass.
const iphoneSE = { ...devices['iPhone SE (3rd gen)'], viewport: { width: 375, height: 548 } }

// Likewise the Galaxy S24's 360x780 less Chrome's toolbar and Android's bars,
// roughly. The SE is the tighter of the two; this one is here for its width.
const galaxyS24 = { ...devices['Galaxy S24'], viewport: { width: 360, height: 660 } }

// A test tagged @any-engine checks something the browser engine cannot change,
// such as the API contract or an iPhone size, so it runs once per kind of
// pointer rather than on every project.
const onePerPointer = /@any-engine/

export default defineConfig({
  testDir: 'e2e',
  // The API keeps no state between requests, and every test gets its own page.
  fullyParallel: true,
  forbidOnly: CI,
  // One retry on CI so a flake is reported as flaky; failOnFlakyTests still
  // turns the run red, so a flake cannot quietly rot.
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  workers: CI ? 2 : undefined,
  // Never opens the report by itself: that would hold `make e2e` open after a
  // failure. `make e2e-report` opens the last one.
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    // SolveStats formats numbers with toLocaleString.
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    trace: CI ? 'retain-on-failure-and-retries' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    connectOptions: linuxBrowsers
      ? { wsEndpoint: linuxBrowsers, exposeNetwork: '<loopback>' }
      : undefined,
  },
  webServer: [
    {
      name: 'api',
      cwd: '../backend',
      command: `.venv/bin/python -m uvicorn app.main:app --port ${API_PORT} --log-level warning`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      // The runner has four cores; eight CP-SAT workers a solve would only
      // fight the browsers for them.
      env: { SUDOKU_SOLVER_WORKERS: '2' },
      reuseExistingServer: false,
    },
    {
      name: 'web',
      // Plain `vite build`: type errors are the frontend job's to report.
      command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      // Pinned here, so a local .env cannot point the bundle somewhere else.
      // The preview server reuses the dev server's /api proxy.
      env: { VITE_API_BASE_URL: '/api', VITE_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  // Folders decide the devices: e2e/desktop only runs with a mouse and
  // keyboard, e2e/touch only on a phone, and everything else on all four,
  // bar the @any-engine tests. Playwright matches these globs against the
  // whole path, ignoring case, so without the e2e/ a clone in ~/Desktop would
  // quietly drop every phone test.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: 'e2e/touch/**' },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'] },
      testIgnore: 'e2e/touch/**',
      grepInvert: onePerPointer,
    },
    { name: 'iphone', use: iphoneSE, testIgnore: 'e2e/desktop/**' },
    { name: 'android', use: galaxyS24, testIgnore: 'e2e/desktop/**', grepInvert: onePerPointer },
  ],
})
