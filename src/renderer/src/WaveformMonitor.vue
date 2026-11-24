<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AdminAccessDialog from './components/AdminAccessDialog.vue'
import WaveformCalibrationOverlay from './components/WaveformCalibrationOverlay.vue'
import { useWaveformVideoStream } from './composables/useWaveformVideoStream'
import { defaultLayout, validateLayout, type WaveLayout } from './utils/waveform-layout.mjs'
import { loadWaveProfile, saveWaveProfile, exportWaveArchive, importWaveArchive, type WaveProfile, type WaveSettings } from './services/waveform-video'
import { loadUserStatus, setupAdministrator, loginAdministrator, logoutAdministrator } from './services/user-management'
import { publicVideoSource, adminVideoSource, saveVideoSource, cameraSnapshot, DEFAULT_VIDEO_SOURCE, type VideoSourceSettings, type VideoSourceStatus } from './services/video-source'
import brandIconUrl from './assets/brand-icon.ico?url'

const d=useWaveformVideoStream()
const {status,result,error,records,renderedFrame,sourceFrameRate,currentTime,duration,isLive,videoWidth,videoHeight,isPlaying,hasSession,isDetecting}=d
const profile=ref<WaveProfile|null>(null)
const draft=ref<WaveProfile|null>(null)
const source=ref<VideoSourceStatus>({kind:'file',usb_index:0})
const sourceDraft=ref<VideoSourceSettings>({...DEFAULT_VIDEO_SOURCE})
const token=ref('')
const configured=ref(false)
const loginOpen=ref(false), loginBusy=ref(false), loginError=ref('')
const busy=ref(false), message=ref('')
const modal=ref<'calibration'|'settings'|null>(null)
const tab=ref<'source'|'detector'>('source')
const snapshot=ref('')
const snapshotTime=ref(0), snapshotDuration=ref(0)
const layout=ref<WaveLayout|null>(null)
const chartMode=ref<'entropy'|'symmetry'>('entropy')
const seekDraft=ref<number|null>(null)
const resumeSeek=ref(false)
let resumeModal=false
let snapshotVersion=0
let off: (()=>void)|undefined
const isAdmin=computed(()=>!!token.value)
const sourceLabel=computed(()=>({file:'本地视频',rtsp:'RTSP 摄像头',usb:'USB 摄像头'}[source.value.kind]))
const state=computed(()=>status.value==='error'?'ERROR':status.value==='connecting'?'连接中':result.value?.status??'--')
const reason=computed(()=>{
  const r=result.value
  if(!r) return profile.value?.layout?'等待检测':'请管理员完成六区域标定'
  if(r.reason==='REFERENCE_REQUIRED') return '未标定正常熵值范围'
  if(r.invalid_regions.length) return '无有效波形：'+r.invalid_regions.join('、')
  const parts=[]
  if(r.bad_regions.length) parts.push('熵异常：'+r.bad_regions.join('、'))
  if(r.bad_pairs.length) parts.push('对称异常：'+r.bad_pairs.join('、'))
  return parts.join('；') || (r.status==='WARMUP'?'正在确认连续状态':r.status==='OK'?'波形正常':r.status==='NG'?'等待恢复':'')
})
const colors=['#48caff','#65d6b5','#f7c46f','#ec92a6','#ad95f3','#f19a67']
const pairs=['1–2','3–4','5–6']
const timeLabel=(v:number)=>v.toFixed(1)+' s'
const fmt=(v:number|null|undefined,digits=3)=>v==null?'--':v.toFixed(digits)
const percent=(v:number|null|undefined)=>v==null?'--':(100*v).toFixed(1)+'%'
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T
const progress=computed(()=>100*(seekDraft.value??currentTime.value)/Math.max(.01,duration.value))
const chartPaths=computed(()=>{
  const h=result.value?.history??[]
  const end=result.value?.time_s??0
  return Array.from({length:chartMode.value==='entropy'?6:3},(_,i)=>{
    let path='',last=false
    for(const p of h){
      const v=p[chartMode.value][i]
      if(v==null){last=false;continue}
      const x=32+470*Math.max(0,Math.min(1,(p.time_s-end+5)/5))
      const y=90-78*v
      path+=(last?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' '
      last=true
    }
    return path
  })
})
async function refresh(){
  try{
    const [p,s,u]=await Promise.all([loadWaveProfile(),publicVideoSource(),loadUserStatus()])
    profile.value=p;source.value=s;configured.value=u.admin_configured
    message.value=''
  }catch{message.value='Python 后端尚未就绪，请重试连接'}
}
async function reconnect(){
  try{await window.desktop.backend.retry();await refresh()}catch{message.value='重连失败，请查看启动日志'}
}
async function switchRole(){
  if(token.value){
    const old=token.value;token.value='';loginOpen.value=false;closeModal()
    sourceDraft.value={...DEFAULT_VIDEO_SOURCE}
    await logoutAdministrator(old).catch(()=>undefined)
  }else{
    loginError.value='';loginOpen.value=true
    try{configured.value=(await loadUserStatus()).admin_configured}catch{}
  }
}
async function authorize(password:string){
  loginBusy.value=true;loginError.value=''
  try{
    const r=configured.value?await loginAdministrator(password):await setupAdministrator(password)
    token.value=r.admin_token;configured.value=true;loginOpen.value=false
  }catch{loginError.value='管理员登录失败，请检查密码或后端连接'}
  finally{loginBusy.value=false}
}
async function openVideo(detect=false){
  if(busy.value)return
  message.value=''
  if(!profile.value?.layout){
    if(isAdmin.value) await openCalibration()
    else message.value='请管理员先完成六区域标定'
    return
  }
  await d.open(0,true,detect)
}
async function runDetection(){
  if(busy.value)return
  if(!hasSession.value){await openVideo(true);return}
  busy.value=true
  try{await d.startDetection();if(!isPlaying.value)d.play()}catch{message.value='启动检测失败'}
  finally{busy.value=false}
}
async function stopDetection(){
  busy.value=true
  try{await d.stopDetection()}catch{message.value='停止检测失败'}
  finally{busy.value=false}
}
function togglePlay(){isPlaying.value?d.pause():d.play()}
function inputSeek(e:Event){
  if(seekDraft.value===null){resumeSeek.value=isPlaying.value;d.pause()}
  seekDraft.value=Number((e.target as HTMLInputElement).value)
}
function commitSeek(){
  if(seekDraft.value===null)return
  const t=seekDraft.value;seekDraft.value=null;void d.seek(t,resumeSeek.value)
}
function jump(delta:number){void d.seek(Math.max(0,Math.min(duration.value,currentTime.value+delta)))}
function beginModal(name:'settings'|'calibration'){
  resumeModal=isPlaying.value;d.pause();modal.value=name;message.value=''
}
function closeModal(resume=true){
  snapshotVersion++;modal.value=null;draft.value=null;layout.value=null;snapshot.value=''
  if(resume&&resumeModal)d.play()
  resumeModal=false
}
async function openCalibration(){
  if(!isAdmin.value||busy.value||modal.value)return
  beginModal('calibration')
  snapshotTime.value=isLive.value?0:currentTime.value
  snapshotDuration.value=0
  await getSnapshot()
}
async function getSnapshot(){
  if(!token.value||modal.value!=='calibration'||busy.value)return
  const v=++snapshotVersion
  busy.value=true;message.value=''
  try{
    const s=await cameraSnapshot(token.value,snapshotTime.value)
    if(v!==snapshotVersion||modal.value!=='calibration')return
    snapshot.value='data:image/jpeg;base64,'+s.jpeg_base64
    snapshotTime.value=s.time_s;snapshotDuration.value=s.duration_s
    if(!layout.value||layout.value.width!==s.width||layout.value.height!==s.height){
      const l=profile.value?.layout
      layout.value=l&&l.width===s.width&&l.height===s.height?copy(l):defaultLayout(s.width,s.height)
    }
  }catch{if(v===snapshotVersion)message.value='无法读取标定画面，请检查视频源'}
  finally{busy.value=false}
}
function resetLayout(){if(layout.value)layout.value=defaultLayout(layout.value.width,layout.value.height)}
async function applyCalibration(){
  if(!token.value||!profile.value||!layout.value||!validateLayout(layout.value)||busy.value)return
  const p=copy(profile.value)
  if(JSON.stringify(p.layout)!==JSON.stringify(layout.value))p.settings.entropy_ranges=[]
  p.layout=copy(layout.value)
  const t=snapshotTime.value
  busy.value=true
  try{
    profile.value=await saveWaveProfile(p,token.value)
    closeModal(false);d.invalidate()
    await d.open(source.value.kind==='file'?t:0,true,false)
    message.value=p.settings.entropy_ranges.length?'标定已保存':'标定已保存，请用已确认正常的视频建立熵值参考'
  }catch{message.value='标定保存失败'}
  finally{busy.value=false}
}
async function openSettings(){
  if(!token.value||busy.value||modal.value)return
  beginModal('settings')
  tab.value='source'
  try{
    const [p,s]=await Promise.all([loadWaveProfile(),adminVideoSource(token.value)])
    if(modal.value!=='settings'||!token.value)return
    draft.value=copy(p);sourceDraft.value=s
  }catch{message.value='读取设置失败'}
}
async function browse(){
  const path=await window.desktop.system.selectVideoFile()
  if(path&&isAdmin.value)sourceDraft.value.file_path=path
}
async function applySource(){
  if(!token.value||busy.value)return
  busy.value=true
  try{
    const r=await saveVideoSource({...sourceDraft.value},token.value)
    source.value={kind:r.source.kind,usb_index:r.source.usb_index}
    d.invalidate();closeModal(false);message.value='视频源已保存'
  }catch{message.value='视频源保存失败，请检查地址或文件'}
  finally{busy.value=false}
}
function enableRanges(e:Event){
  if(!draft.value)return
  draft.value.settings.entropy_ranges=(e.target as HTMLInputElement).checked
    ?Array.from({length:6},()=>[0,1] as [number,number]):[]
}
function useNormalSamples(){
  if(!draft.value)return
  const last=records.value.at(-1)
  if(!last||!isDetecting.value){message.value='请先播放已确认正常的视频并开始检测';return}
  const recent=records.value.filter(x=>x.time_s>=last.time_s-5&&x.time_s<=last.time_s)
  if(recent.length<20||last.time_s-(recent[0]?.time_s??last.time_s)<1||recent.some(x=>x.entropy.some(v=>v==null))){
    message.value='需要最近至少 20 帧且跨越 1 秒的有效波形数据';return
  }
  if(!window.confirm('确认最近这段视频为正常工况？将根据已检测的有效帧生成六个熵值范围，仍需现场验证。'))return
  draft.value.settings.entropy_ranges=Array.from({length:6},(_,i)=>{
    const v=recent.map(r=>r.entropy[i] as number)
    return [Math.max(0,Math.min(...v)-.04),Math.min(1,Math.max(...v)+.04)]
  })
  message.value='正常熵值范围已生成，可微调后保存'
}
async function applyDetector(){
  if(!token.value||!draft.value||busy.value)return
  const t=currentTime.value,detect=isDetecting.value,resume=resumeModal,opened=hasSession.value
  busy.value=true
  try{
    profile.value=await saveWaveProfile(copy(draft.value),token.value)
    closeModal(false);d.invalidate()
    if(opened&&profile.value.layout)await d.open(source.value.kind==='file'?t:0,resume,detect)
    message.value='检测参数已保存'
  }catch{message.value='参数无效或保存失败，请检查取值范围'}
  finally{busy.value=false}
}
async function archive(action:'import'|'export'){
  if(!token.value||busy.value)return
  busy.value=true
  try{
    const path=action==='import'?await window.desktop.system.chooseProfileArchive():await window.desktop.system.saveProfileArchive()
    if(!path||!token.value)return
    if(action==='import'){
      if(!window.confirm('导入将替换六区域标定和检测参数，确定继续？'))return
      profile.value=await importWaveArchive(path,token.value)
      d.invalidate();closeModal(false)
      message.value='配置已导入'
    }else{
      await exportWaveArchive(path,token.value);message.value='配置已导出'
    }
  }catch{message.value='配置导入或导出失败'}
  finally{busy.value=false}
}
function windowAction(a:'minimize'|'toggleMaximize'|'closeWindow'){void window.desktop.system[a]()}
function esc(e:KeyboardEvent){if(e.key==='Escape'&&!busy.value){if(loginOpen.value)loginOpen.value=false;else if(modal.value)closeModal()}}
const advanced: {key:keyof Pick<WaveSettings,'min_pixels'|'max_fill'|'grid_size'|'hue_min'|'hue_max'|'saturation_min'|'value_min'|'green_margin'>;label:string;min:number;max:number;step:number}[]=[
  {key:'min_pixels',label:'最少波形像素',min:1,max:100000,step:1},
  {key:'max_fill',label:'最大前景占比',min:.01,max:.99,step:.01},
  {key:'grid_size',label:'熵网格边长',min:2,max:8,step:1},
  {key:'hue_min',label:'色相下限',min:0,max:179,step:1},
  {key:'hue_max',label:'色相上限',min:0,max:179,step:1},
  {key:'saturation_min',label:'饱和度下限',min:0,max:255,step:1},
  {key:'value_min',label:'亮度下限',min:0,max:255,step:1},
  {key:'green_margin',label:'绿色优势',min:0,max:255,step:1}
]
onMounted(()=>{
  void refresh()
  off=window.desktop.backend.onStatus(s=>{
    if(s==='ready'){token.value='';closeModal(false);d.invalidate();void refresh()}
    if(s==='offline'||s==='failed'){token.value='';closeModal(false);d.invalidate();message.value='Python 后端已断开'}
  })
  window.addEventListener('keydown',esc)
})
onBeforeUnmount(()=>{off?.();window.removeEventListener('keydown',esc)})
</script>

<template>
  <div class="zebo-app wave-app">
    <header class="app-header">
      <div class="brand"><div class="brand-icon"><img :src="brandIconUrl" alt=""/></div><div class="brand-name">ZeboVision</div></div>
      <div class="app-title">注入机波形检测系统</div>
      <div class="header-actions">
        <button class="btn btn-muted" @click="switchRole">{{isAdmin?'管理员':'操作员'}}</button>
        <button v-if="isAdmin" class="btn btn-muted" :disabled="busy" @click="openSettings">设置</button>
        <div class="window-controls">
          <button title="最小化" @click="windowAction('minimize')">—</button>
          <button title="最大化或还原" @click="windowAction('toggleMaximize')">□</button>
          <button class="close-window" title="关闭" @click="windowAction('closeWindow')">×</button>
        </div>
      </div>
    </header>
    <main class="workspace">
      <section class="panel video-panel">
        <div class="panel-heading"><span class="panel-title">检测画面</span><div class="heading-actions">
          <button v-if="isAdmin" class="btn btn-muted" :disabled="busy" @click="openCalibration">区域标定</button>
          <button class="btn btn-primary" :disabled="busy||status==='connecting'" @click="openVideo()">{{source.kind==='file'?'打开视频':'连接摄像头'}}</button>
        </div></div>
        <div class="video-stage">
          <img v-if="renderedFrame" class="video-element" :src="renderedFrame" alt="波形检测画面"/>
          <div v-if="error" class="video-error"><span>{{error}}</span><button class="btn btn-muted" @click="reconnect">重试后端连接</button></div>
          <span v-else-if="!renderedFrame" class="data-label">{{profile?.layout?'打开视频或连接摄像头':'请先完成六区域标定'}}</span>
        </div>
        <div class="video-footer">
          <input v-if="!isLive" class="progress-range" type="range" min="0" :max="duration||1" step=".01" :value="seekDraft??currentTime" :style="{'--progress':progress+'%'}" :disabled="!hasSession||!duration" @input="inputSeek" @change="commitSeek"/>
          <div class="playback"><div class="playback-left">
            <button v-if="!isLive" :disabled="!hasSession" title="后退 5 秒" @click="jump(-5)">↶</button>
            <button :disabled="!hasSession" :title="isPlaying?'暂停画面':'继续画面'" @click="togglePlay">{{isPlaying?'Ⅱ':'▶'}}</button>
            <button v-if="!isLive" :disabled="!hasSession" title="前进 5 秒" @click="jump(5)">↷</button>
            <span>{{timeLabel(seekDraft??currentTime)}} {{isLive?' · LIVE':' / '+timeLabel(duration)}}</span>
          </div></div>
        </div>
      </section>
      <div class="right-column wave-right">
        <section class="panel wave-verdict">
          <div><div class="data-label">检测结果</div><div class="status-unavailable" :class="{'status-good':state==='OK','status-bad':state==='NG','status-error':state==='ERROR'}">{{state}}</div></div>
          <div><div class="data-label">异常持续时间</div><strong>{{fmt(result?.abnormal_run_s,2)}} s</strong><p class="status-description">{{reason}}</p></div>
        </section>
        <section class="panel wave-metrics">
          <div class="panel-heading"><span class="panel-title">分区熵值</span></div>
          <div class="wave-metric-grid">
            <div v-for="n in 6" :key="n" class="wave-metric" :class="{bad:result?.bad_regions.includes(n),invalid:result?.invalid_regions.includes(n)}">
              <span :style="{color:colors[n-1]}">R{{n}}</span><b>{{fmt(result?.entropy[n-1])}}</b>
            </div>
          </div>
          <div class="panel-heading"><span class="panel-title">镜像对称性</span></div>
          <div class="wave-metric-grid symmetry">
            <div v-for="(p,i) in pairs" :key="p" class="wave-metric" :class="{bad:result?.bad_pairs.includes(p.replace('–','-'))}">
              <span>{{p}}</span><b>{{percent(result?.symmetry[i])}}</b>
            </div>
          </div>
        </section>
        <section class="panel chart-panel wave-chart">
          <div class="panel-heading"><span class="panel-title">指标趋势</span><div class="heading-actions">
            <button class="btn" :class="{'btn-primary':chartMode==='entropy'}" @click="chartMode='entropy'">熵值</button>
            <button class="btn" :class="{'btn-primary':chartMode==='symmetry'}" @click="chartMode='symmetry'">对称性</button>
          </div></div>
          <div class="chart-body">
            <svg viewBox="0 0 520 110" preserveAspectRatio="none" role="img" aria-label="最近五秒的指标趋势">
              <path d="M32 12H502 M32 51H502 M32 90H502" class="chart-grid"/>
              <text x="6" y="15">1.0</text><text x="6" y="54">0.5</text><text x="6" y="93">0.0</text>
              <text x="32" y="105">-5 s</text><text x="475" y="105">当前</text>
              <path v-for="(p,i) in chartPaths" :key="i" :d="p" fill="none" :stroke="colors[i]" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
            </svg>
          </div>
        </section>
      </div>
    </main>
    <footer class="bottom-bar">
      <div class="file-info"><strong>{{sourceLabel}}</strong><span v-if="videoWidth">{{videoWidth}} × {{videoHeight}} · {{sourceFrameRate.toFixed(1)}} FPS</span><span v-if="message" class="wave-message" role="status">{{message}}</span></div>
      <div class="footer-actions">
        <button class="btn btn-primary" :disabled="busy||isDetecting||status==='connecting'" @click="runDetection">开始检测</button>
        <button class="btn btn-danger" :disabled="busy||!isDetecting" @click="stopDetection">停止检测</button>
        <button class="btn btn-muted" :disabled="!records.length" @click="d.exportCSV">导出结果</button>
      </div>
    </footer>
    <AdminAccessDialog v-if="loginOpen" :configured="configured" :busy="loginBusy" :error="loginError" @cancel="loginOpen=false" @submit="authorize"/>
    <div v-if="modal==='calibration'&&isAdmin" class="modal-mask">
      <section class="calibration-modal wave-calibration" role="dialog" aria-modal="true" aria-label="六区域标定">
        <div class="modal-header"><h2>六区域标定</h2><button class="modal-close" :disabled="busy" @click="closeModal()">×</button></div>
        <div class="wave-calibration-body">
          <div v-if="snapshot&&layout" class="wave-calibration-frame" :style="{aspectRatio:layout.width+'/'+layout.height}">
            <img :src="snapshot" alt="原始标定画面"/>
            <WaveformCalibrationOverlay v-model="layout" :readonly="busy"/>
          </div>
          <div v-else class="wave-empty">尚未获取标定画面</div>
        </div>
        <div class="wave-calibration-tools">
          <span class="data-label">拖动框内移动整组；拖动控制点调整相邻边界及镜像区域</span>
          <input v-if="source.kind==='file'" v-model.number="snapshotTime" type="range" min="0" :max="snapshotDuration||1" step=".01" :disabled="busy||!snapshotDuration" @change="getSnapshot"/>
          <button class="btn btn-muted" :disabled="busy" @click="getSnapshot">刷新画面</button>
        </div>
        <div v-if="message" class="wave-modal-message">{{message}}</div>
        <div class="modal-footer"><span>1–2 外侧 · 3–4 顶部 · 5–6 中间</span><div><button class="btn btn-muted" :disabled="busy||!layout" @click="resetLayout">重置</button><button class="btn btn-primary" :disabled="busy||!layout||!snapshot" @click="applyCalibration">保存标定</button></div></div>
      </section>
    </div>
    <div v-if="modal==='settings'&&isAdmin" class="modal-mask">
      <section class="calibration-modal wave-settings" role="dialog" aria-modal="true" aria-label="系统设置">
        <div class="modal-header"><h2>系统设置</h2><button class="modal-close" :disabled="busy" @click="closeModal()">×</button></div>
        <div class="wave-settings-tabs"><button class="btn" :class="{'btn-primary':tab==='source'}" @click="tab='source'">视频源</button><button class="btn" :class="{'btn-primary':tab==='detector'}" @click="tab='detector'">检测参数</button><span class="wave-spacer"/><button class="btn btn-muted" :disabled="busy" @click="archive('import')">导入配置</button><button class="btn btn-muted" :disabled="busy" @click="archive('export')">导出配置</button></div>
        <div v-if="tab==='source'" class="wave-settings-body">
          <label>视频源<select v-model="sourceDraft.kind"><option value="file">本地视频</option><option value="rtsp">RTSP</option><option value="usb">USB 摄像头</option></select></label>
          <label v-if="sourceDraft.kind==='file'">视频文件<div class="wave-inline"><input v-model="sourceDraft.file_path" readonly/><button class="btn" @click="browse">浏览…</button></div></label>
          <label v-if="sourceDraft.kind==='rtsp'">RTSP 地址<input v-model="sourceDraft.rtsp_url" type="password" autocomplete="off"/></label>
          <label v-if="sourceDraft.kind==='usb'">设备编号<input v-model.number="sourceDraft.usb_index" type="number" min="0" max="15"/></label>
        </div>
        <div v-else-if="draft" class="wave-settings-body">
          <div class="wave-inline"><label class="wave-check"><input type="checkbox" :checked="draft.settings.entropy_ranges.length===6" @change="enableRanges"/>已设定正常熵值范围</label><button class="btn btn-muted" @click="useNormalSamples">使用最近正常样本</button></div>
          <div v-if="draft.settings.entropy_ranges.length===6" class="wave-thresholds">
            <span>区域</span><span>熵值下限</span><span>熵值上限</span>
            <template v-for="(r,i) in draft.settings.entropy_ranges" :key="i"><b>R{{i+1}}</b><input v-model.number="r[0]" type="number" min="0" max="1" step=".01"/><input v-model.number="r[1]" type="number" min="0" max="1" step=".01"/></template>
          </div>
          <p v-else class="data-label">未设置正常范围时只输出指标，不判定 OK。</p>
          <div class="wave-setting-grid">
            <label v-for="(p,i) in pairs" :key="p">{{p}} 最低对称性<input v-model.number="draft.settings.symmetry_min[i]" type="number" min="0" max="1" step=".01"/></label>
            <label>镜像位置容差比例<input v-model.number="draft.settings.tolerance_ratio" type="number" min="0" max=".15" step=".01"/></label>
            <label>异常确认时间 (s)<input v-model.number="draft.settings.ng_hold_s" type="number" min="0" max="30" step=".1"/></label>
            <label>正常恢复时间 (s)<input v-model.number="draft.settings.recover_hold_s" type="number" min="0" max="30" step=".1"/></label>
          </div>
          <details><summary>波形提取参数</summary><div class="wave-setting-grid"><label v-for="a in advanced" :key="a.key">{{a.label}}<input v-model.number="draft.settings[a.key]" type="number" :min="a.min" :max="a.max" :step="a.step"/></label></div></details>
        </div>
        <div v-if="message" class="wave-modal-message">{{message}}</div>
        <div class="modal-footer"><span>参数仅由管理员保存</span><div><button class="btn btn-muted" :disabled="busy" @click="closeModal()">取消</button><button class="btn btn-primary" :disabled="busy||(tab==='detector'&&!draft)" @click="tab==='source'?applySource():applyDetector()">保存</button></div></div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.wave-app .app-header{height:60px;padding:0 14px}
.wave-app .app-title{font-size:20px}
.wave-app .header-actions{gap:8px;-webkit-app-region:no-drag}
.wave-app .workspace{grid-template-columns:minmax(0,1.8fr) minmax(300px,1fr)}
.wave-right{overflow:auto}
.wave-verdict{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:14px 16px;align-items:center;min-height:110px;flex-shrink:0}
.wave-verdict strong{display:block;font-size:20px;margin-top:6px}
.wave-verdict .status-unavailable{font-size:33px}
.wave-metrics{flex-shrink:0}
.wave-metrics .panel-heading{min-height:36px;padding:0 12px}
.wave-metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px 12px}
.wave-metric{display:flex;flex-direction:column;gap:5px;padding:7px 9px;border:1px solid #294357;border-radius:5px;background:#12263b;font-variant-numeric:tabular-nums}
.wave-metric span{font-size:12px;color:#a7bed0}
.wave-metric b{font-size:18px}
.wave-metric.bad{border-color:#c24b58;color:#ff9198;background:#442631}
.wave-metric.invalid{border-color:#b78b4a;color:#f2c271}
.wave-chart{min-height:160px;flex:1}
.wave-chart .btn{padding:5px 8px}
.wave-message{white-space:normal;color:#b7d6e9;overflow-wrap:anywhere}
.wave-calibration{width:min(1050px,95vw)}
.wave-calibration-body{display:flex;align-items:center;justify-content:center;min-height:120px;padding:10px 16px;background:#040c13;overflow:auto}
.wave-calibration-frame{position:relative;width:min(100%,calc((100vh - 240px)*1.4));max-height:calc(100vh - 240px);flex:none}
.wave-calibration-frame img{display:block;width:100%;height:100%;object-fit:fill}
.wave-empty{padding:40px;color:#9ab5c9}
.wave-calibration-tools,.wave-settings-tabs{padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.wave-calibration-tools input{flex:1;min-width:100px}
.wave-settings{width:min(720px,94vw)}
.wave-settings-body{padding:14px 20px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.wave-settings-body label{display:flex;flex-direction:column;gap:6px;color:#c3d8e8;font-size:12px}
.wave-settings-body input:not([type=checkbox]),.wave-settings-body select{width:100%;min-width:0;border:1px solid #36546b;border-radius:4px;padding:7px 8px;color:#edf5fa;background:#091623;font:inherit}
.wave-inline{display:flex;align-items:center;gap:10px}
.wave-settings-body .wave-check{flex-direction:row;align-items:center}
.wave-thresholds{display:grid;grid-template-columns:60px 1fr 1fr;align-items:center;gap:8px;font-size:12px}
.wave-setting-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.wave-spacer{flex:1}
.wave-modal-message{padding:8px 20px;color:#ffc67c;font-size:12px}
.wave-settings-body summary{cursor:pointer;font-size:13px;margin-bottom:10px}
</style>
