import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {spritePose,spriteKeyframes} from '../extension/agents.js'
const calibration=JSON.parse(readFileSync(new URL('../extension/sprite-registration.json',import.meta.url),'utf8'))
for(const [id,character]of Object.entries(calibration.characters)){
 const png=readFileSync(new URL('../extension/'+character.image,import.meta.url))
 assert.equal(createHash('sha256').update(png).digest('hex'),character.sha256,`${id}: calibration must match actual pixels`)
 const floors=[]
 for(let i=0;i<12;i++){
  const p=spritePose(id,i)
  floors.push(p.scale*character.frames[i].sourceFloor+p.y)
  assert.ok(Math.abs(floors[i]-character.referenceFloor)<.00003,`${id}/${i}: floor shifted`)
  assert.ok(p.scale>=.82&&p.scale<=1.18)
 }
 assert.ok(Math.max(...floors)-Math.min(...floors)<.00003)
 assert.equal([...spriteKeyframes(id).matchAll(/transform:/g)].length,13)
}
console.log('PASS: all60 registered poses preserve floor anchors and use calibration for unchanged native PNGs.')
