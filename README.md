# ZeboVision 注入机波形检测系统

基于 Electron + Vue 3 + TypeScript + Python FastAPI + OpenCV 的桌面应用，分析摄像头拍摄的离子注入机 SCAN–BEAM 束流轮廓。采用传统图像处理，无需采集原始电压或训练神经网络。

## 功能

- 本地视频、RTSP、USB 摄像头，原始 BGR 逐帧检测。
- 六区域联动标定：1/2 外侧、3/4 中间、5/6 顶部；整组拖拽、共享边界、镜像约束。
- 6 个独立空间熵与 3 组宽容镜像对称性；默认对称性 75%，位置容差为 ROI 短边 5%，不是工艺验收阈值。
- 正常样本建立熵值范围；无参考或无有效轨迹时不输出 OK。
- 连续状态确认、异常区域高亮、最近五秒趋势、CSV 导出。
- 管理员标定及设置，操作员只运行已批准配置；设备配置 ZIP 导入导出不包含凭据或原视频。

## 开发运行

Windows x64，Node.js 22+，pnpm。原有 uv 自动引导和独立 Python 运行机制保留。

~~~powershell
git clone -b waveform-monitor https://github.com/DebuNeko233/water_demo_copy.git
cd water_demo_copy
pnpm install
pnpm dev
~~~

先登录管理员 → 设置视频源 → 区域标定 → 开始检测。播放已确认正常的视频后，在设置的检测参数页使用最近正常样本建立熵范围，保存后再开展正式检测。

~~~powershell
pnpm test:backend
pnpm test:scripts
pnpm typecheck
pnpm build
~~~

Windows 绿色程序仍输出 `dist/win-unpacked/ZeboVision.exe`，发布时需保留整个目录。

详见 [波形改造与算法说明](docs/waveform-migration.md)、[原有开发运行指南](docs/getting-started.md)。

本分支已切换默认桌面入口及视频检测业务；旧水流模块和测试仍保留，待后续清理。现场阈值和实机可靠性需要正常及异常视频验证。本软件不作为晶圆剂量验收或安全联锁。