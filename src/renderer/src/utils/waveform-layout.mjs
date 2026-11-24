// One constrained geometry; all coordinates are integer source-image pixels.
const clamp = (x, min, max) => Math.max(min, Math.min(max, Math.round(x)))

export function validateLayout(l) {
  const { width:w, height:h, center_x:c, top_y:t, split_y:s, bottom_y:b,
    outer_half_width:o, inner_half_width:i, top_half_width:u } = l
  return [w,h,c,t,s,b,o,i,u].every(Number.isInteger) &&
    w >= 1 && h >= 1 && w <= 4096 && h <= 4096 && w*h <= 4194304 &&
    t >= 0 && t <= s-8 && s <= b-8 && b <= h &&
    i >= 8 && i <= o-8 && u >= 8 && u <= o && o <= Math.min(c,w-c)
}

export function defaultLayout(width, height) {
  const o = Math.floor(width*.4)
  const l = { width, height, center_x:Math.floor(width/2),
    top_y:Math.floor(height*.15), split_y:Math.floor(height*.4),
    bottom_y:Math.floor(height*.85), outer_half_width:o,
    inner_half_width:Math.floor(o*.55), top_half_width:Math.floor(o*.55) }
  if (!validateLayout(l)) throw new Error('Unsupported calibration dimensions')
  return l
}

export function rectangles(l) {
  if (!validateLayout(l)) throw new Error('Invalid waveform calibration')
  const {center_x:c,top_y:t,split_y:s,bottom_y:b,outer_half_width:o,inner_half_width:i,top_half_width:u}=l
  return [[c-o,s,c-i,b],[c+i,s,c+o,b],[c-u,t,c,s],[c,t,c+u,s],[c-i,s,c,b],[c,s,c+i,b]]
    .map(([x,y,x1,y1],j)=>({id:j+1,x,y,width:x1-x,height:y1-y}))
}

export function dragLayout(l, handle, dx, dy) {
  if (!validateLayout(l)) throw new Error('Invalid waveform calibration')
  const n = {...l}
  const c=l.center_x, o=l.outer_half_width, i=l.inner_half_width, u=l.top_half_width
  const maxO=Math.min(c,l.width-c)
  switch(handle) {
    case 'move': {
      n.center_x=clamp(c+dx,o,l.width-o)
      const d=clamp(dy,-l.top_y,l.height-l.bottom_y)
      n.top_y+=d; n.split_y+=d; n.bottom_y+=d
      break
    }
    case 'center': n.center_x=clamp(c+dx,o,l.width-o); break
    case 'outer-left': case 'outer-right':
      n.outer_half_width=clamp(o+(handle==='outer-left'?-dx:dx),Math.max(i+8,u),maxO); break
    case 'inner-left': case 'inner-right':
      n.inner_half_width=clamp(i+(handle==='inner-left'?-dx:dx),8,o-8); break
    case 'top-left': case 'top-right':
      n.top_half_width=clamp(u+(handle==='top-left'?-dx:dx),8,o); break
    case 'top': n.top_y=clamp(l.top_y+dy,0,l.split_y-8); break
    case 'split': n.split_y=clamp(l.split_y+dy,l.top_y+8,l.bottom_y-8); break
    case 'bottom': n.bottom_y=clamp(l.bottom_y+dy,l.split_y+8,l.height); break
    default: throw new Error('Unknown drag handle')
  }
  return n
}
