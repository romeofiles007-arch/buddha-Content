import assert from 'node:assert/strict'
import { CATEGORIES } from '../extension/prompts.js'

const { themeKey, categoryGenre, themeForGenre, CATEGORY_THEMES, categoryThemeCss } = await import('../extension/category-themes.js')
for(const c of CATEGORIES) {
  assert.equal(themeKey(c.id),c.id)
  assert.equal(themeKey(c.name),c.id)
  assert.equal(categoryGenre(c.id),c.name)
  assert.equal(categoryGenre(c.name),c.name)
  assert.equal(themeForGenre(c.name),CATEGORY_THEMES[c.id])
  assert.equal(themeForGenre(c.id).day,`agents/category-${c.id}-day.png`)
  assert.equal(themeForGenre(c.id).night,`agents/category-${c.id}-night.png`)
}
for(const value of ['mix','',undefined,null,'unknown-category']) assert.equal(themeKey(value),'mix')
assert.equal(new Set(Object.values(CATEGORY_THEMES).map(t=>t.day)).size,3)
assert.match(categoryThemeCss(),/prefers-color-scheme: dark/)
for(const c of CATEGORIES) assert.ok(categoryThemeCss().includes(`html[data-category='${c.id}']`))

const luminance=hex=>{const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722}
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05)
for(const [id,t] of Object.entries(CATEGORY_THEMES)) for(const mode of ['light','dark']) {
 const p=t[mode]
 for(const fg of ['ink','muted','accent','ok','warn','danger']) for(const bg of ['bg','panel','pick']) assert.ok(contrast(p[fg],p[bg])>=4.5,`${id}/${mode}/${fg}/${bg}: ${contrast(p[fg],p[bg]).toFixed(2)}`)
 assert.ok(contrast(p.accent,p['accent-ink'])>=4.5,`${id}/${mode}/action`)
 if(p.action) assert.ok(contrast(p.action,p['action-ink'])>=4.5,`${id}/${mode}/gold action`)
}
console.log('PASS: all three category IDs/names, neutral mix fallback, distinct scenery, full light/dark category palette contrast >=4.5:1.')
