import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REGION_COLORS, REGION_FILL_OPACITY } from '../src/renderer/src/utils/waveform-colors.mjs'
import { defaultLayout, rectangles, validateLayout, dragLayout } from '../src/renderer/src/utils/waveform-layout.mjs'

test('six linked rectangles share edges and mirror',()=>{
  const l=defaultLayout(1920,1080)
  const r=rectangles(l)
  assert.equal(r[0].x+r[0].width,r[4].x)
  assert.equal(r[5].x+r[5].width,r[1].x)
  for(const [a,b] of [[0,1],[2,3],[4,5]]){
    assert.equal(r[a].x+r[b].x+r[b].width,2*l.center_x)
    assert.equal(r[a].width,r[b].width)
    assert.equal(r[a].height,r[b].height)
  }
})
test('drag handles clamp and mirror without overlap',()=>{
  const start=defaultLayout(640,480)
  for(const h of ['move','center','outer-left','outer-right','inner-left','inner-right','top-left','top-right','top','split','bottom']){
    for(const delta of [-10000,-30,0,30,10000]){
      const n=dragLayout(start,h,delta,delta)
      assert.ok(validateLayout(n))
      assert.equal(rectangles(n).length,6)
    }
  }
  const n=dragLayout(start,'inner-left',-20,0)
  assert.equal(n.inner_half_width,start.inner_half_width+20)
  assert.equal(rectangles(n)[0].width,rectangles(start)[0].width-20)
})


test('six region colors are distinct and translucent, independent of verdict',()=>{
  assert.equal(REGION_COLORS.length,6)
  assert.equal(new Set(REGION_COLORS).size,6)
  assert.ok(REGION_FILL_OPACITY > 0 && REGION_FILL_OPACITY <= .25)
  const overlay=readFileSync(new URL('../src/renderer/src/components/WaveformCalibrationOverlay.vue',import.meta.url),'utf8')
  const monitor=readFileSync(new URL('../src/renderer/src/WaveformMonitor.vue',import.meta.url),'utf8')
  assert.match(overlay, /:fill="palette\[r\.id-1\]" :fill-opacity="REGION_FILL_OPACITY"/)
  assert.match(monitor, /import \{ REGION_COLORS as colors \}/)
})
