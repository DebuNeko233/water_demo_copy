<script setup lang="ts">
import { computed, ref } from 'vue'
import { dragLayout, rectangles, type WaveHandle, type WaveLayout } from '../utils/waveform-layout.mjs'

const props = defineProps<{ modelValue: WaveLayout; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: WaveLayout] }>()
const svg = ref<SVGSVGElement | null>(null)
const boxes = computed(() => rectangles(props.modelValue))
const palette = ['#53a5ff','#53a5ff','#f2bf52','#f2bf52','#b48aff','#b48aff']
const handles = computed(() => {
  const l = props.modelValue
  const c=l.center_x, o=l.outer_half_width, i=l.inner_half_width, u=l.top_half_width
  const low=(l.split_y+l.bottom_y)/2, high=(l.top_y+l.split_y)/2
  return [
    { key:'outer-left', x:c-o,y:low },{ key:'outer-right',x:c+o,y:low },
    { key:'inner-left',x:c-i,y:low },{ key:'inner-right',x:c+i,y:low },
    { key:'top-left',x:c-u,y:high },{ key:'top-right',x:c+u,y:high },
    { key:'top',x:c-u/2,y:l.top_y },{ key:'split',x:c-u/2,y:l.split_y },
    { key:'bottom',x:c-u/2,y:l.bottom_y },{ key:'center',x:c,y:high },
  ] as { key:WaveHandle;x:number;y:number }[]
})
let drag: { pointer:number;handle:WaveHandle;start:DOMPoint;layout:WaveLayout } | null = null
function point(e: PointerEvent): DOMPoint | null {
  const matrix = svg.value?.getScreenCTM()
  return matrix ? new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse()) : null
}
function begin(e:PointerEvent,handle:WaveHandle) {
  if (props.readonly || e.button!==0 || drag) return
  const p=point(e)
  if (!p || !svg.value) return
  e.preventDefault(); e.stopPropagation()
  drag={pointer:e.pointerId,handle,start:p,layout:{...props.modelValue}}
  svg.value.setPointerCapture(e.pointerId)
}
function move(e:PointerEvent) {
  if (!drag || drag.pointer!==e.pointerId) return
  const p=point(e)
  if (p) emit('update:modelValue',dragLayout(drag.layout,drag.handle,p.x-drag.start.x,p.y-drag.start.y))
}
function end(e:PointerEvent) {
  if (drag?.pointer===e.pointerId) drag=null
}
</script>

<template>
  <svg ref="svg" class="wave-overlay" :viewBox="`0 0 ${modelValue.width} ${modelValue.height}`"
       preserveAspectRatio="none" :class="{locked:readonly}"
       @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end">
    <g v-for="r in boxes" :key="r.id">
      <rect :x="r.x" :y="r.y" :width="r.width" :height="r.height" :stroke="palette[r.id-1]"
            fill="transparent" stroke-width="1.6" vector-effect="non-scaling-stroke"
            class="wave-region" @pointerdown="begin($event,'move')" />
      <text :x="r.x+r.width/2" :y="r.y+r.height/2" :fill="palette[r.id-1]"
            :font-size="Math.max(12, modelValue.height*.035)" text-anchor="middle"
            dominant-baseline="central">{{r.id}}</text>
    </g>
    <line :x1="modelValue.center_x" :x2="modelValue.center_x" :y1="modelValue.top_y"
          :y2="modelValue.bottom_y" stroke="#eee" stroke-dasharray="5 4"
          vector-effect="non-scaling-stroke" pointer-events="none"/>
    <g v-if="!readonly">
      <circle v-for="h in handles" :key="h.key" :cx="h.x" :cy="h.y"
              :r="Math.max(4,modelValue.height*.009)" fill="#fff" stroke="#334155"
              vector-effect="non-scaling-stroke"
              :class="['wave-handle', ['top','bottom','split'].includes(h.key)?'vertical':'horizontal']"
              @pointerdown="begin($event,h.key)" />
    </g>
  </svg>
</template>

<style scoped>
.wave-overlay {position:absolute;inset:0;width:100%;height:100%;touch-action:none;user-select:none;pointer-events:auto}
.wave-overlay text {pointer-events:none;font-weight:600;paint-order:stroke;stroke:#111;stroke-width:1px}
.wave-region {cursor:move}
.wave-handle.horizontal {cursor:ew-resize}
.wave-handle.vertical {cursor:ns-resize}
.wave-overlay.locked {pointer-events:none}
</style>
