/** Reuse the secure desktop HTTP bridge; no video pixels travel back into Python. */
import type { WaveLayout } from '../utils/waveform-layout.mjs'
export interface WaveSettings {
  entropy_ranges: [number, number][]
  symmetry_min: [number, number, number]
  tolerance_ratio: number
  min_pixels: number
  max_fill: number
  grid_size: number
  hue_min: number
  hue_max: number
  saturation_min: number
  value_min: number
  green_margin: number
  ng_hold_s: number
  recover_hold_s: number
}
export interface WaveProfile {
  version: 1
  layout: WaveLayout | null
  settings: WaveSettings
}
export interface WaveHistory {
  time_s: number
  entropy: (number|null)[]
  symmetry: (number|null)[]
}
export interface WaveResult extends WaveHistory {
  session_id: string
  frame_index: number
  status: 'OK'|'NG'|'UNKNOWN'|'WARMUP'|'PAUSED'
  reason: string
  pixel_counts: number[]
  invalid_regions: number[]
  bad_regions: number[]
  bad_pairs: string[]
  abnormal_run_s: number
  history_ready: boolean
  history: WaveHistory[]
}
export interface WaveFrame {
  ended: boolean
  samples?: WaveResult[]
  performance?: { frames:number; decode_ms:number; analysis_ms:number; preview_ms:number }
  frame_index?: number
  time_s?: number
  jpeg_base64?: string
  result?: WaveResult
  detecting?: boolean
}
export interface WaveSession {
  session_id:string
  fps:number
  width:number
  height:number
  duration_s:number
  is_live:boolean
  source_kind:'file'|'rtsp'|'usb'
  detecting:boolean
  frame:WaveFrame
}
export function loadWaveProfile():Promise<WaveProfile> {
  return window.desktop.backend.request('GET','/api/waveform/profile')
}
export function saveWaveProfile(profile:WaveProfile,adminToken:string):Promise<WaveProfile> {
  // Vue reactive objects cannot be structured-cloned by Electron IPC.
  return window.desktop.backend.request('POST','/api/waveform/profile/save',{
    profile:JSON.parse(JSON.stringify(profile)),admin_token:adminToken
  })
}
export function openWaveVideo(time:number,detecting:boolean):Promise<WaveSession> {
  return window.desktop.backend.request('POST','/api/waveform/open',{start_time_s:time,detecting})
}
export function readWaveFrame(id:string,batch=1):Promise<WaveFrame> {
  return window.desktop.backend.request('POST','/api/video/next',{session_id:id,batch_frames:batch})
}
export function seekWaveVideo(id:string,time:number):Promise<WaveFrame> {
  return window.desktop.backend.request('POST','/api/video/seek',{session_id:id,time_s:time})
}
export function setWaveDetection(id:string,enabled:boolean):Promise<{detecting:boolean}> {
  return window.desktop.backend.request('POST',enabled?'/api/video/detection/start':'/api/video/detection/stop',{session_id:id})
}
export function exportWaveArchive(filePath:string,adminToken:string):Promise<{saved:boolean}> {
  return window.desktop.backend.request('POST','/api/waveform/archive/export',{file_path:filePath,admin_token:adminToken})
}
export function importWaveArchive(filePath:string,adminToken:string):Promise<WaveProfile> {
  return window.desktop.backend.request('POST','/api/waveform/archive/import',{file_path:filePath,admin_token:adminToken})
}
