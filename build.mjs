import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { build, context } from 'esbuild'

const isWatch = process.argv.includes('--watch')
const outdir = 'dist'
const ICON_SIZES = [16, 32, 48, 128]
const BRAND_RGB = [79, 70, 229]

const esbuildOptions = {
  entryPoints: {
    background: 'src/background/service-worker.ts',
    'content-kijiji': 'src/content/kijiji.ts',
    'content-facebook': 'src/content/facebook.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': JSON.stringify(isWatch ? 'development' : 'production') },
  logLevel: 'info',
}

const createPngChunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typeAndData) >>> 0)
  return Buffer.concat([length, typeAndData, checksum])
}

const isInsideRoundedSquare = (x, y, size, radius) => {
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

const createIconPng = (size) => {
  const rowLength = size * 4 + 1
  const pixels = Buffer.alloc(rowLength * size)
  const center = size / 2
  const ringOuter = size * 0.32
  const ringInner = size * 0.2
  for (let y = 0; y < size; y++) {
    pixels[y * rowLength] = 0
    for (let x = 0; x < size; x++) {
      const offset = y * rowLength + 1 + x * 4
      if (!isInsideRoundedSquare(x + 0.5, y + 0.5, size, size * 0.22)) continue
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      const isGap = x + 0.5 > center && y + 0.5 < center && Math.abs(x + 0.5 - center) < size * 0.12
      const isRing = distance <= ringOuter && distance >= ringInner && !isGap
      const [r, g, b] = isRing ? [255, 255, 255] : BRAND_RGB
      pixels.set([r, g, b, 255], offset)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk('IHDR', header),
    createPngChunk('IDAT', deflateSync(pixels)),
    createPngChunk('IEND', Buffer.alloc(0)),
  ])
}

const writeIcons = () =>
  Promise.all(ICON_SIZES.map((size) => writeFile(`${outdir}/icons/icon-${size}.png`, createIconPng(size))))

const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))))
  })

const runTailwind = () => {
  const args = ['-i', 'src/styles.css', '-o', `${outdir}/styles.css`, isWatch ? '--watch' : '--minify']
  const child = spawn('node_modules/.bin/tailwindcss', args, { stdio: 'inherit' })
  if (isWatch) return Promise.resolve()
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tailwindcss exited with ${code}`))))
  })
}

const findBrowserDir = async (appOutDir) => {
  const browserDir = join(appOutDir, 'browser')
  try {
    await readdir(browserDir)
    return browserDir
  } catch {
    return appOutDir
  }
}

const flattenAngularApp = async (appName) => {
  const browserDir = await findBrowserDir(`dist-angular/${appName}`)
  const files = await readdir(browserDir)
  const htmlName = files.find((name) => name.endsWith('.html'))
  if (!htmlName) throw new Error(`No HTML output found for ${appName} in ${browserDir}`)

  const copiedScripts = []
  for (const file of files) {
    if (file.endsWith('.html') || file === 'styles.css' || file === 'media') continue
    const targetName = file === 'main.js' ? `${appName}.js` : file
    await cp(join(browserDir, file), join(outdir, targetName), { recursive: true })
    if (targetName.endsWith('.js')) copiedScripts.push(targetName)
  }

  let html = await readFile(join(browserDir, htmlName), 'utf8')
  html = html
    .replace(/<base href="[^"]*"\s*\/?>/i, '')
    .replace(/<link rel="stylesheet"[^>]*href="styles\.css"[^>]*>/gi, '')
    .replace(/<script[^>]*src="[^"]*main\.js"[^>]*><\/script>/gi, `<script src="${appName}.js" type="module"></script>`)
    .replace(/<\/head>/i, '    <link rel="stylesheet" href="styles.css" />\n  </head>')

  // Keep any chunk scripts Angular emitted (already renamed only main.js).
  if (!html.includes(`${appName}.js`)) {
    const scriptTags = copiedScripts.map((file) => `    <script src="${file}" type="module"></script>`).join('\n')
    html = html.replace(/<\/body>/i, `${scriptTags}\n  </body>`)
  }

  await writeFile(join(outdir, `${appName}.html`), html)
}

const buildAngularApps = async () => {
  const configuration = isWatch ? 'development' : 'production'
  await runCommand('npx', ['ng', 'build', 'popup', `--configuration=${configuration}`])
  await runCommand('npx', ['ng', 'build', 'dashboard', `--configuration=${configuration}`])
  await flattenAngularApp('popup')
  await flattenAngularApp('dashboard')
}

await rm(outdir, { recursive: true, force: true })
await rm('dist-angular', { recursive: true, force: true })
await mkdir(`${outdir}/icons`, { recursive: true })
await cp('public', outdir, { recursive: true })
await writeIcons()

if (isWatch) {
  const ctx = await context(esbuildOptions)
  await ctx.watch()
  await buildAngularApps()
  await runTailwind()
  console.log('Watching for changes… reload the extension in chrome://extensions after edits.')
} else {
  await build(esbuildOptions)
  await buildAngularApps()
  await runTailwind()
  console.log(`Built extension into ./${outdir}`)
}
