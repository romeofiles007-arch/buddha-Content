import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { CATEGORY_THEMES } from '../extension/category-themes.js'

const { spritePosition, SPRITE_COLUMNS, SPRITE_ROWS, SPRITE_FRAMES, SPRITE_KEYFRAMES, TEMPLE_ASSETS, DEPARTMENTS } = await import('../extension/agents.js')
assert.equal(SPRITE_COLUMNS, 4)
assert.equal(SPRITE_ROWS, 3)
assert.equal(SPRITE_FRAMES, 12)
assert.equal(typeof spritePosition, 'function', 'atlas renderer must provide frame positioning')
const positions = Array.from({length: 12}, (_, i) => spritePosition(i))
assert.deepEqual(positions[0], [0, 0])
assert.deepEqual(positions[3], [100, 0])
assert.deepEqual(positions[4], [0, 50], 'frame 4 must wrap to the second row')
assert.deepEqual(positions[7], [100, 50])
assert.deepEqual(positions[8], [0, 100], 'frame 8 must wrap to the final row')
assert.deepEqual(positions[11], [100, 100])
assert.equal(new Set(positions.map(JSON.stringify)).size, 12)
for (const invalid of [-1, 12, NaN, 0.5, '1', null]) assert.throws(() => spritePosition(invalid), RangeError)
for (const {id, animal} of DEPARTMENTS) {
  assert.equal(TEMPLE_ASSETS[id], `adult-${id}`)
  assert.doesNotMatch(animal, /เณร|เด็ก|เต่า|ปลาหมึก|ม้าน้ำ|โลมา|^ปู$/)
}
console.log('PASS: twelve unique atlas positions, both row transitions, invalid frames, five temple departments.')

const css = readFileSync(new URL('../extension/temple.css',import.meta.url),'utf8')
const html = readFileSync(new URL('../extension/sidepanel.html',import.meta.url),'utf8')
const js = readFileSync(new URL('../extension/sidepanel.js',import.meta.url),'utf8')
assert.match(html, /<link rel="stylesheet" href="temple.css"/)
assert.match(css,/var\(--sprite-animation\) 1\.8s steps\(1, end\) infinite/)
assert.match(css,/background-size: 400% 300%/)
assert.equal([...SPRITE_KEYFRAMES.matchAll(/background-position:/g)].length,13)
assert.match(css,/prefers-reduced-motion: reduce/)
assert.match(js,/setInterval\(refreshAgents, 3000\)/)
assert.match(js,/if \(document\.hidden \|\| agentRefreshing\) return/)
assert.match(js,/mascot\.dataset\.hidden = hidden/)
assert.doesNotMatch(js,/requestAnimationFrame/)
assert.doesNotMatch(readFileSync(new URL('../extension/agents.css',import.meta.url),'utf8'), /\[data-state='idle'\][^{]+\{\s*animation:\s*sea-breathe/, 'idle portraits must remain still')
console.log('PASS: atlas CSS integration, reduce motion, background and sticky pause, preserved 3-second polling.')

const luminance = hex => {
  const rgb = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4)
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
}
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05)
const roots = [...css.matchAll(/:root, html\[data-dept\] \{([^}]+)\}/g)]
assert.equal(roots.length,2)
for(const [i,root] of roots.entries()) {
  const c=Object.fromEntries([...root[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(m=>[m[1],m[2]]))
  for(const fg of ['ink','muted','accent','ok','warn','danger']) for(const bg of ['bg','panel','pick']) assert.ok(contrast(c[fg],c[bg])>=4.5,`${i}/${fg}/${bg} text contrast ${contrast(c[fg],c[bg]).toFixed(2)}`)
  assert.ok(contrast(c.accent,c['accent-ink'])>=4.5)
  for(const id of ['chatgpt','flow','meta','voice','edit']) {
    const accent=c[`dept-${id}`], pick=c[`dept-${id}-pick`]
    assert.ok(contrast(accent,c.panel)>=4.5,`${i}/${id} label contrast`)
    assert.ok(contrast(accent,pick)>=4.5,`${i}/${id} selected label contrast`)
    assert.ok(contrast(accent,c['accent-ink'])>=4.5,`${i}/${id} button contrast`)
  }
}
console.log('PASS: light/dark text, semantic statuses, department labels and action contrast >=4.5:1.')

if (!process.argv.includes('--assets')) process.exit(0)

// Decode native RGBA PNG scanlines so blank or repeated atlas cells cannot pass.
function decodePng(buffer) {
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20)
  assert.equal(buffer[24],8,'8-bit atlas')
  assert.equal(buffer[25],6,'native RGBA atlas')
  assert.equal(buffer[28],0,'non-interlaced atlas')
  const parts=[]
  for(let o=8;o<buffer.length;) {const n=buffer.readUInt32BE(o);if(buffer.toString('ascii',o+4,o+8)==='IDAT')parts.push(buffer.subarray(o+8,o+8+n));o+=n+12}
  const raw=inflateSync(Buffer.concat(parts)),stride=width*4,pixels=Buffer.alloc(stride*height)
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)],start=y*(stride+1)+1
    for(let x=0;x<stride;x++) {
      const a=x>=4?pixels[y*stride+x-4]:0,b=y?pixels[(y-1)*stride+x]:0,c=x>=4&&y?pixels[(y-1)*stride+x-4]:0
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):NaN
      assert.ok(Number.isFinite(predictor),'valid PNG row filter')
      pixels[y*stride+x]=(raw[start+x]+predictor)&255
    }
  }
  return {width,height,pixels}
}
for(const {id} of DEPARTMENTS) {
  const path=new URL(`../extension/agents/${TEMPLE_ASSETS[id]}.png`,import.meta.url)
  assert.ok(existsSync(path),`Missing atlas: ${id}`)
  const {width,height,pixels}=decodePng(readFileSync(path))
  const hashes=[]
  for(let f=0;f<12;f++) {
    // Native transparent generation may trim one pixel at an outer edge;
    // the renderer uses normalized 4x3 cells, not hardcoded integer crops.
    const left=Math.round((f%4)*width/4),right=Math.round((f%4+1)*width/4)
    const top=Math.round(Math.floor(f/4)*height/3),bottom=Math.round((Math.floor(f/4)+1)*height/3)
    const w=right-left,h=bottom-top
    const hash=createHash('sha256');let visible=0,transparent=0
    for(let y=0;y<h;y++) {
      const start=((top+y)*width+left)*4
      const row=pixels.subarray(start,start+w*4);hash.update(row)
      for(let x=3;x<row.length;x+=4){if(row[x]>32)visible++;if(row[x]===0)transparent++}
    }
    assert.ok(visible>w*h*.05,`${id}/${f} nonempty frame`)
    assert.ok(transparent>w*h*.02,`${id}/${f} real transparent background`)
    hashes.push(hash.digest('hex'))
  }
  assert.equal(new Set(hashes).size,12,`${id}: all twelve actual cells must differ`)
  console.log(`PASS: ${id} ${width}x${height}: twelve nonempty distinct frames with native transparency.`)
}
for(const theme of Object.values(CATEGORY_THEMES)) for(const mode of ['day','night']) {
  const bytes=readFileSync(new URL(`../extension/${theme[mode]}`,import.meta.url))
  assert.ok(bytes.readUInt32BE(16)>=1024&&bytes.readUInt32BE(20)>=1024)
}
console.log('PASS: all eleven generated adult/category image assets.')
