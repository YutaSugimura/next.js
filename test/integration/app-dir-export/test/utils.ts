/* eslint-env jest */

import { join } from 'path'
import { promisify } from 'util'
import fs from 'fs-extra'
import webdriver from 'next-webdriver'
import globOrig from 'glob'
import {
  check,
  fetchViaHTTP,
  File,
  findPort,
  getRedboxHeader,
  hasRedbox,
  killApp,
  launchApp,
  nextBuild,
  startStaticServer,
  stopApp,
} from 'next-test-utils'

const glob = promisify(globOrig)
export const appDir = join(__dirname, '..')
export const distDir = join(appDir, '.next')
export const exportDir = join(appDir, 'out')
export const nextConfig = new File(join(appDir, 'next.config.js'))
const slugPage = new File(join(appDir, 'app/another/[slug]/page.js'))
const apiJson = new File(join(appDir, 'app/api/json/route.js'))

export const expectedFiles = [
  '404.html',
  '404/index.html',
  '_next/static/media/test.3f1a293b.png',
  '_next/static/test-build-id/_buildManifest.js',
  '_next/static/test-build-id/_ssgManifest.js',
  'another/first/index.html',
  'another/first/index.txt',
  'another/index.html',
  'another/index.txt',
  'another/second/index.html',
  'another/second/index.txt',
  'api/json',
  'api/txt',
  'favicon.ico',
  'image-import/index.html',
  'image-import/index.txt',
  'index.html',
  'index.txt',
  'robots.txt',
]

export async function getFiles(cwd = exportDir) {
  const opts = { cwd, nodir: true }
  const files = ((await glob('**/*', opts)) as string[])
    .filter(
      (f) =>
        !f.startsWith('_next/static/chunks/') &&
        !f.startsWith('_next/static/development/') &&
        !f.startsWith('_next/static/webpack/')
    )
    .sort()
  return files
}
export async function runTests({
  isDev = false,
  trailingSlash = true,
  dynamicPage,
  dynamicApiRoute,
  expectedErrMsg,
}: {
  isDev?: boolean
  trailingSlash?: boolean
  dynamicPage?: string
  dynamicApiRoute?: string
  expectedErrMsg?: string
}) {
  if ((isDev && !process.env.TEST_DEV) || (!isDev && process.env.TEST_DEV)) {
    return
  }
  if (trailingSlash) {
    nextConfig.replace(
      'trailingSlash: true,',
      `trailingSlash: ${trailingSlash},`
    )
  }
  if (dynamicPage) {
    slugPage.replace(
      `const dynamic = 'force-static'`,
      `const dynamic = ${dynamicPage}`
    )
  }
  if (dynamicApiRoute) {
    apiJson.replace(
      `const dynamic = 'force-static'`,
      `const dynamic = ${dynamicApiRoute}`
    )
  }
  await fs.remove(distDir)
  await fs.remove(exportDir)
  const port = await findPort()
  let stopOrKill: () => Promise<void>
  let result = { code: 0, stdout: '', stderr: '' }
  if (isDev) {
    const app = await launchApp(appDir, port, {
      stdout: false,
      onStdout(msg: string) {
        result.stdout += msg || ''
      },
      stderr: false,
      onStderr(msg: string) {
        result.stderr += msg || ''
      },
    })
    stopOrKill = async () => await killApp(app)
  } else {
    result = await nextBuild(appDir, [], { stdout: true, stderr: true })
    const app = await startStaticServer(exportDir, null, port)
    stopOrKill = async () => await stopApp(app)
  }

  try {
    if (expectedErrMsg) {
      if (isDev) {
        const url = dynamicPage ? '/another/first' : '/api/json'
        const browser = await webdriver(port, url)
        expect(await hasRedbox(browser, true)).toBe(true)
        expect(await getRedboxHeader(browser)).toContain(expectedErrMsg)
      } else {
        await check(() => result.stderr, /error/i)
      }
      expect(result.stderr).toMatch(expectedErrMsg)
    } else {
      const a = (n: number) => `li:nth-child(${n}) a`
      const browser = await webdriver(port, '/')
      await check(() => browser.elementByCss('h1').text(), 'Home')
      expect(await browser.elementByCss(a(1)).text()).toBe(
        'another no trailingslash'
      )
      await browser.elementByCss(a(1)).click()

      await check(() => browser.elementByCss('h1').text(), 'Another')
      expect(await browser.elementByCss(a(1)).text()).toBe(
        'Visit the home page'
      )
      await browser.elementByCss(a(1)).click()

      await check(() => browser.elementByCss('h1').text(), 'Home')
      expect(await browser.elementByCss(a(2)).text()).toBe(
        'another has trailingslash'
      )
      await browser.elementByCss(a(2)).click()

      await check(() => browser.elementByCss('h1').text(), 'Another')
      expect(await browser.elementByCss(a(1)).text()).toBe(
        'Visit the home page'
      )
      await browser.elementByCss(a(1)).click()

      await check(() => browser.elementByCss('h1').text(), 'Home')
      expect(await browser.elementByCss(a(3)).text()).toBe('another first page')
      await browser.elementByCss(a(3)).click()

      await check(() => browser.elementByCss('h1').text(), 'first')
      expect(await browser.elementByCss(a(1)).text()).toBe('Visit another page')
      await browser.elementByCss(a(1)).click()

      await check(() => browser.elementByCss('h1').text(), 'Another')
      expect(await browser.elementByCss(a(4)).text()).toBe(
        'another second page'
      )
      await browser.elementByCss(a(4)).click()

      await check(() => browser.elementByCss('h1').text(), 'second')
      expect(await browser.elementByCss(a(1)).text()).toBe('Visit another page')
      await browser.elementByCss(a(1)).click()

      await check(() => browser.elementByCss('h1').text(), 'Another')
      expect(await browser.elementByCss(a(5)).text()).toBe('image import page')
      await browser.elementByCss(a(5)).click()

      await check(() => browser.elementByCss('h1').text(), 'Image Import')
      expect(await browser.elementByCss(a(2)).text()).toBe('View the image')
      expect(await browser.elementByCss(a(2)).getAttribute('href')).toContain(
        '/test.3f1a293b.png'
      )
      const res1 = await fetchViaHTTP(port, '/api/json')
      expect(res1.status).toBe(200)
      expect(await res1.json()).toEqual({ answer: 42 })

      const res2 = await fetchViaHTTP(port, '/api/txt')
      expect(res2.status).toBe(200)
      expect(await res2.text()).toEqual('this is plain text')

      if (!isDev && trailingSlash) {
        expect(await getFiles()).toEqual(expectedFiles)
      }
    }
  } finally {
    await stopOrKill()
    nextConfig.restore()
    slugPage.restore()
    apiJson.restore()
  }
}
