// Isolated headless Chrome: actual panel markup/controller, fake API, no real jobs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = process.argv[2] || mkdtempSync(join(tmpdir(), 'production-panel-qa-'))
mkdirSync(output, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'production-panel-chrome-'))
const source = readFileSync(join(root, 'extension/sidepanel.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
const controller = readFileSync(join(root, 'extension/sidepanel.js'), 'utf8').split('// ── 🏭 ผลิตต่อเนื่อง —')[1]
assert.ok(controller, 'production controller exists')
const fixture = `
import { scheduleFromFields, scheduleFields, scheduleCopy } from '/extension/production-schedule.js';
import { applyCategoryTheme } from '/extension/category-themes.js';
const params = new URLSearchParams(location.search);
applyCategoryTheme(params.get('category') || 'dhamma');
const box = document.getElementById('prodBox'),control=document.getElementById('autoControlBlock'),section=document.getElementById('autoSection'),main=document.querySelector('main');
control.replaceChildren(box);section.replaceChildren(control);main.replaceChildren(section);document.body.replaceChildren(main);
// Preserve all shipped ancestor selectors and inherited tokens, trim only the preview surround.
main.style.padding='12px';section.style.cssText='border:0;padding:0;margin:0;background:transparent';control.style.cssText='border:0;padding:0;margin:0;background:transparent';box.open=true;
const $=id=>document.getElementById(id),selfMode=()=>false,localApp=async()=>({}),showFinishedVideo=async()=>true;
window.calls=[];window.failSave=false;window.apiDelay=0;
const data={settings:{count:5,start:'daily',time:'22:00',delayMin:20,delayMax:40,random:{genre:true,art:true,narration:false,language:false},languages:['th'],autoPost:'now',postPages:'all',pageQuota:{}},state:{active:false,made:0,failed:0,run:null,nextAt:null,history:[]},postTargets:2,postPages:[{key:'fb:a',kind:'facebook',name:'ใจใส ใจสบาย วันหยุด'},{key:'tk:why',kind:'tiktok',name:'@whytakorn'}]};
window.fixture=data;
const api=async(app,path,body)=>{
  window.calls.push({path,body:structuredClone(body)});
  await new Promise(r=>setTimeout(r,window.apiDelay));
  if(path.endsWith('/settings')) {if(window.failSave)throw new Error('จำลองการเชื่อมต่อขาด');data.settings=structuredClone(body)}
  if(path.endsWith('/start')) {data.settings=structuredClone(body.settings);data.state.active=true;data.state.nextAt=Date.now()+3600000}
  if(path.endsWith('/stop')) {data.state.active=false;data.state.run=null}
  return structuredClone(data);
};
const chrome={runtime:{sendMessage:async()=>({ok:true})}};
// ── 🏭 ผลิตต่อเนื่อง —${controller}
window.qa={render:()=>{prod=structuredClone(data);renderProd()},refill:s=>{data.settings=s;prod=structuredClone(data);prodFilled=false;renderProd()},form:prodForm};
await new Promise(r=>setTimeout(r,30));window.previewReady=true;
`
const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/extension/preview.html') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(source.replace('</html>', '<script type="module" src="/extension/fixture.js"></script></html>')); return
    }
    if (url.pathname === '/extension/fixture.js') { res.setHeader('content-type', 'application/javascript'); res.end(fixture); return }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!path.startsWith(resolve(root, 'extension') + (process.platform === 'win32' ? '\\' : '/'))) { res.writeHead(403).end(); return }
    res.setHeader('content-type', { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream')
    res.end(readFileSync(path))
  } catch { res.writeHead(404).end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const binary = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const chrome = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true })
const pause = ms => new Promise(r => setTimeout(r, ms))
let ws
try {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await pause(100)
  const port = readFileSync(portFile, 'utf8').split('\n')[0]
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pending = new Map(), errors = []
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ': ' + m.params.exceptionDetails.exception?.description)
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
  }
  const command = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })) })
  const evaluate = async expression => {
    const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await command('Page.enable'); await command('Runtime.enable')
  const load = async (category = 'dhamma') => {
    await command('Page.navigate', { url: base + '/extension/preview.html?category=' + category })
    for (let i = 0; i < 100; i++) { if (await evaluate('window.previewReady === true')) return; await pause(50) }
    throw new Error('Preview did not become ready: ' + errors.join('; '))
  }
  const change = async (id, value, event = 'change') => evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});${typeof value === 'boolean' ? 'e.checked' : 'e.value'}=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`)
  const saved = async () => { await pause(650); return evaluate('window.calls.filter(c=>c.path.endsWith("/settings")).at(-1)?.body') }
  await load()
  assert.equal(await evaluate('window.calls.some(c=>c.path.endsWith("/start"))'), false)
  assert.match(await evaluate('document.getElementById("prodPlanTitle").textContent'), /ทุกวัน.*5 คลิป/)
  await change('prodStart', 'now')
  assert.equal(await evaluate('document.getElementById("prodTimeRow").hidden'), true)
  assert.equal((await saved()).start, 'now')
  await change('prodPauseMode', 'none')
  assert.equal((await saved()).delayMax, 0)
  await change('prodPauseMode', 'fixed'); await change('prodDelayMin', '12', 'input')
  assert.equal((await saved()).delayMax, 12)
  await change('prodUnlimited', true)
  assert.equal((await saved()).count, 0)
  assert.equal(await evaluate('document.getElementById("prodCount").disabled'), true)
  await change('prodUnlimited', false); await saved()
  const beforeInvalid = await evaluate('window.calls.length')
  await change('prodCount', '', 'input'); await pause(650)
  await evaluate('document.getElementById("prodGo").click()')
  assert.equal(await evaluate('window.calls.length'), beforeInvalid, 'blank count must neither save nor start')
  assert.equal(await evaluate('document.activeElement.id'), 'prodCount')
  await change('prodCount', '7', 'input'); await saved()
  await evaluate('window.failSave=true')
  await change('prodCount', '8', 'input'); await saved()
  assert.match(await evaluate('document.getElementById("prodSaveState").textContent'), /บันทึกไม่สำเร็จ/)
  await evaluate('window.failSave=false')
  await change('prodCount', '9', 'input'); await saved()
  assert.equal(await evaluate('document.getElementById("prodSaveState").classList.contains("error")'), false)
  // A delayed save is serialized before start, and a pending debounce cannot overwrite start.
  await evaluate('window.apiDelay=150')
  await change('prodCount', '10', 'input'); await pause(520)
  await change('prodCount', '11', 'input')
  await evaluate('document.getElementById("prodGo").click();document.getElementById("prodGo").click()')
  await pause(650)
  assert.equal(await evaluate('window.calls.filter(c=>c.path.endsWith("/start")).length'), 1)
  assert.equal(await evaluate('window.fixture.settings.count'), 11)
  assert.equal(await evaluate('document.getElementById("prodGo").disabled'), true)
  await evaluate('window.fixture.state.run=null;window.fixture.state.nextAt=Date.now()-1000;window.qa.render()')
  assert.equal(await evaluate('document.getElementById("prodBadge").textContent'), 'รอเริ่มผลิต')
  // Reload legacy settings into the actual form, including count=0 and a fixed pause.
  await evaluate('window.qa.refill({...window.fixture.settings,count:0,delayMin:0,delayMax:0});window.roundTrip=window.qa.form()')
  assert.equal(await evaluate('window.roundTrip.count'), 0)
  assert.equal(await evaluate('window.roundTrip.delayMax'), 0)
  await evaluate('window.apiDelay=0')
  await change('prodCount', '9', 'input')
  await change('prodUnlimited', false)
  await evaluate('document.getElementById("prodStop").click()')
  await pause(750)
  assert.equal(await evaluate('window.fixture.settings.count'), 9, 'stopping must preserve the pending settings edit')
  assert.equal(await evaluate('window.fixture.state.active'), false)
  await evaluate('window.fixture.state.active=true;window.qa.render();window.apiDelay=750;window.stopCheck=window.calls.length')
  await change('prodCount', '12', 'input')
  await evaluate('document.getElementById("prodStop").click()')
  await pause(600)
  assert.equal(await evaluate('window.calls.slice(window.stopCheck).filter(c=>c.path.endsWith("/settings")).length'), 0, 'a debounced save waits for Stop to finish')
  await pause(1050)
  assert.equal(await evaluate('window.fixture.settings.count'), 12)
  assert.equal(await evaluate('window.fixture.state.active'), false)
  assert.equal(await evaluate('window.calls.some(c=>/posting/.test(c.path))'), false)
  const results = []
  for (const mode of process.argv.includes('--interactions-only') ? [] : ['dark', 'light']) for (const category of ['dhamma', 'monk', 'buddha']) for (const width of [360, 450]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1500, deviceScaleFactor: 1, mobile: false })
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    await load(category)
    for (const advanced of [false, true]) {
      await evaluate(`document.querySelector('.prodOptions').open=${advanced};window.qa.render()`)
      const metrics = await evaluate(`(()=>{
        const lum=c=>{const a=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722};
        const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        const box=document.getElementById('prodBox'),bg=getComputedStyle(box).backgroundColor;
        const primary=getComputedStyle(document.getElementById('prodGo'));
        return {overflow:document.documentElement.scrollWidth>innerWidth,contrast:ratio(getComputedStyle(document.getElementById('prodPlanDetail')).color,bg),buttonContrast:ratio(primary.color,primary.backgroundColor),height:box.getBoundingClientRect().height,targets:[...box.querySelectorAll('button,select,input:not([type=checkbox])')].filter(e=>e.getClientRects().length&&!e.disabled).every(e=>e.getBoundingClientRect().height>=42)}
      })()`)
      results.push({ mode, category, width, advanced, ...metrics })
      assert.equal(metrics.overflow, false, JSON.stringify(results.at(-1)))
      assert.ok(metrics.contrast >= 4.5, JSON.stringify(results.at(-1)))
      assert.ok(metrics.buttonContrast >= 4.5, JSON.stringify(results.at(-1)))
      assert.equal(metrics.targets, true, JSON.stringify(results.at(-1)))
      if (category === 'dhamma' && width === 360 || category === 'buddha' && width === 450 && !advanced) {
        const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        writeFileSync(join(output, `production-${category}-${mode}-${width}${advanced ? '-options' : ''}.png`), Buffer.from(shot.data, 'base64'))
      }
    }
  }
  assert.deepEqual(errors, [], 'no controller runtime errors')
  if (results.length) writeFileSync(join(output, 'production-panel-qa.json'), JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ interactionChecks: 'passed', screens: results.length, minContrast: Math.min(...results.map(r => r.contrast)), output }, null, 2))
  await command('Browser.close').catch(() => {})
} finally { ws?.close(); chrome.kill(); server.close() }
