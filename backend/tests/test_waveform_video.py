"""Exercise the actual API with original decoded frames and protected profile."""
import cv2
import numpy as np
from fastapi.testclient import TestClient
from sample_backend.main import create_app
from sample_backend.services.waveform_detection import WaveLayout
from dataclasses import asdict


def test_waveform_video_and_persistence(monkeypatch, tmp_path):
    monkeypatch.setenv('APP_DATA_DIR', str(tmp_path/'data'))
    layout = WaveLayout(240,180,120,10,60,170,100,55,55)
    profile = {'version':1,'layout':asdict(layout),'settings':{'entropy_ranges':[[0,1]]*6}}
    path = tmp_path/'wave.mp4'
    writer = cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),20,(240,180))
    assert writer.isOpened()
    frame=np.zeros((180,240,3),np.uint8)
    for n in (1,3,5):
        x,y,x1,y1=layout.rectangles()[n]
        cv2.line(frame,(x+4,y+4),(x1-5,y1-5),(0,255,0),3)
    frame[:,120:]=np.fliplr(frame[:,:120])
    for _ in range(30):
        writer.write(frame)
    writer.release()
    with TestClient(create_app()) as client:
        assert client.post('/api/waveform/open',json={}).status_code==422
        assert client.post('/api/waveform/profile/save',json={'admin_token':'bad','profile':profile}).status_code==403
        token=client.post('/api/users/setup',json={'password':'WaveformTest123'}).json()['admin_token']
        assert client.post('/api/video/source/save',json={'admin_token':token,'source':{'kind':'file','file_path':str(path)}}).status_code==200
        assert client.post('/api/waveform/profile/save',json={'admin_token':token,'profile':profile}).status_code==200
        opened=client.post('/api/waveform/open',json={'detecting':True})
        assert opened.status_code==200,opened.text
        data=opened.json()
        sid=data['session_id']
        assert data['frame']['result']['status']=='WARMUP'
        assert len(data['frame']['result']['entropy'])==6
        assert len(data['frame']['result']['symmetry'])==3
        for _ in range(12):
            packet=client.post('/api/video/next',json={'session_id':sid}).json()
        assert packet['result']['status']=='OK',packet['result']
        assert client.post('/api/video/detection/stop',json={'session_id':sid}).status_code==200
        assert client.post('/api/video/next',json={'session_id':sid}).json()['result']['status']=='PAUSED'
        assert client.post('/api/video/detection/start',json={'session_id':sid}).status_code==200
        assert client.post('/api/video/seek',json={'session_id':sid,'time_s':0}).json()['result']['status']=='WARMUP'
        backup=tmp_path/'wave.zip'
        assert client.post('/api/waveform/archive/export',json={'admin_token':token,'file_path':str(backup)}).status_code==200
        assert client.post('/api/waveform/archive/import',json={'admin_token':token,'file_path':str(backup)}).status_code==200
        assert client.post('/api/video/next',json={'session_id':sid}).status_code==409
    with TestClient(create_app()) as client:
        assert client.get('/api/waveform/profile').json()['layout']==asdict(layout)
