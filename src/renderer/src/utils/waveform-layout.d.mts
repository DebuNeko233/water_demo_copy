export interface WaveLayout {
  width: number
  height: number
  center_x: number
  top_y: number
  split_y: number
  bottom_y: number
  outer_half_width: number
  inner_half_width: number
  top_half_width: number
}
export interface WaveRectangle { id:number; x:number; y:number; width:number; height:number }
export type WaveHandle = 'move'|'center'|'outer-left'|'outer-right'|'inner-left'|'inner-right'|'top-left'|'top-right'|'top'|'split'|'bottom'
export function validateLayout(l: WaveLayout): boolean
export function defaultLayout(width:number,height:number): WaveLayout
export function rectangles(l:WaveLayout): WaveRectangle[]
export function dragLayout(l:WaveLayout,handle:WaveHandle,dx:number,dy:number): WaveLayout
