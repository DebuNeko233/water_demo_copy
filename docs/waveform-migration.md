# 注入机波形视频检测改造

改造分支以 WaveformMonitor.vue 作为 Electron 渲染入口，复用原视频流、解码、播放背压、摄像头、管理员登录和安全 IPC。旧水流源码暂留用于回归和后续清理，不再是默认入口。

## 标定

管理员在设置中选择本地视频、RTSP 或 USB，再打开区域标定。框内拖动整组；拖动控制点移动公共边界，左右镜像联动。1/2 外侧，3/4 顶部，5/6 中间。坐标使用原视频整数像素，分辨率改变需要重新标定。保存几何后清空旧熵值范围。

六个区域分别使用固定颜色，标定及检测预览均以 16% 不透明度填充，与区域熵值颜色一致；填充只区分编号，不随 OK/NG 变化。检测仍使用未经叠加的原始帧，原有告警边框保持不变。

## 检测

- HSV 与绿色优势提取绿色轨迹，排除红线、白色反光和孤立点。初始颜色阈值根据现场示例视频调整为 S≥65、V≥90、绿色通道优势≥28；均可编辑。预处理改变后重新标定熵范围。
- 各区固定网格统计前景分布，归一化 Shannon 熵 0–1；上下限独立。
- 三组水平镜像双向距离匹配，默认容差为 ROI 短边 5%，默认最低相似度 0.75。不做逐帧自动配准。
- 正常范围由管理员通过已确认的正常视频建立：播放检测至少 20 个有效记录且跨度至少 1 秒，设置 → 检测参数 → 使用最近正常样本；范围为近 5 秒各区最小/最大值外扩 0.04，管理员可修改。这是初始标定建议，不是经过验证的工艺阈值。
- 未设置参考或轨迹无效时输出 UNKNOWN；0.5 秒持续异常与恢复时间可配置。红框标识异常候选，灰框表示尚未确认状态，黄框表示无有效波形。只监测显示波形，不能作为实际注入剂量验收或自动停机联锁。
- 每帧检测使用原始 BGR 图像，JPEG 只用于结果展示；本地文件批处理返回每帧指标。实时预览只取最新包，CSV 是所接收的实时记录而非所有摄像头帧。
- 配置保存在 data/waveform/profile.json；ZIP 含单独的版本化波形配置，不含密码、RTSP 地址或原视频。旧水流 ZIP 不兼容。

## API

GET /api/waveform/profile；POST /api/waveform/profile/save、/api/waveform/archive/import、/api/waveform/archive/export 需要管理员令牌。POST /api/waveform/open 只使用后端批准的视频源与配置；沿用 /api/video/next、/seek、/detection/start、/detection/stop。结果包括 entropy[6]、symmetry[3]、bad_regions、bad_pairs、invalid_regions、pixel_counts、abnormal_run_s 和 history。

## 验证

`node --test tests/waveform-layout.test.mjs`；`uv run --project backend pytest backend/tests/test_waveform_detection.py backend/tests/test_waveform_video.py`；`pnpm typecheck`；`pnpm dev`。

尚需实机测试：现场屏幕曝光/闪烁、摄像头畸变、正常范围与误报；旧水流代码和静态测试迁移、Windows 打包回归、实时长期运行。