import cv2
import numpy as np
import pytest

from sample_backend.services.waveform_detection import (
    WaveLayout, WaveSettings, WaveformDetector, extract_trace,
    spatial_entropy, symmetry_score,
)


def layout():
    return WaveLayout(240, 180, 120, 10, 60, 170, 100, 55, 55)


def frame():
    l = layout()
    img = np.zeros((l.height, l.width, 3), np.uint8)
    for n in (1, 3, 5):
        x0, y0, x1, y1 = l.rectangles()[n]
        cv2.line(img, (x0+3, y0+3), (x1-4, y1-4), (0,255,0), 2)
    img[:, 120:] = np.fliplr(img[:, :120])
    return img


def test_layout_shared_edges_and_reflection():
    r = layout().rectangles()
    assert r[1][2] == r[5][0]
    assert r[6][2] == r[2][0]
    for a,b in ((1,2),(3,4),(5,6)):
        assert r[a][0]+r[b][2] == 240
        assert r[a][2]+r[b][0] == 240
        assert r[a][1::2] == r[b][1::2]
    with pytest.raises(ValueError):
        WaveLayout(240,180,120,10,60,170,100,99,55)


def test_entropy_and_color():
    img = np.zeros((64,64,3),np.uint8)
    img[0:8,0:8] = (0,255,0)
    img[10:20,10:20] = (0,0,255)
    mask = extract_trace(img, WaveSettings())
    assert mask.sum() == 64
    assert spatial_entropy(mask) == 0
    assert spatial_entropy(np.ones((64,64),bool)) == pytest.approx(1)
    assert spatial_entropy(np.zeros((64,64),bool)) is None


def test_tolerant_symmetry():
    a = np.zeros((100,100),bool)
    a[10:90,30] = True
    b = np.zeros_like(a)
    b[10:90,67] = True
    assert symmetry_score(a,b,.03) == 1
    assert symmetry_score(a,b,0) == 0
    assert symmetry_score(a,np.zeros_like(a)) is None
    b[:,67] = False
    b[10:90,20] = True
    assert symmetry_score(a,b,.03) == 0


def test_state_and_missing_reference():
    f = frame()
    d = WaveformDetector(layout())
    assert d.process(f,0)["reason"] == "REFERENCE_REQUIRED"
    cfg = WaveSettings(entropy_ranges=((0,1),)*6)
    d = WaveformDetector(layout(),cfg)
    assert d.process(f,0)["status"] == "WARMUP"
    assert d.process(f,.25)["status"] == "WARMUP"
    assert d.process(f,.5)["status"] == "OK"
    changed=f.copy()
    x0,y0,x1,y1=layout().rectangles()[6]
    changed[y0:y1,x0:x1]=0
    cv2.line(changed,(x0+4,y1-5),(x1-5,y0+4),(0,255,0),2)
    # Use a horizontal line to create an obviously different right-side trace.
    changed[y0:y1,x0:x1]=0
    cv2.line(changed,(x0+4,y0+5),(x1-5,y0+5),(0,255,0),2)
    assert "5-6" in d.process(changed,.6)["bad_pairs"]
    assert d.process(changed,.85)["status"] == "WARMUP"
    assert d.process(changed,1.1)["status"] == "NG"
    assert d.process(f,1.35)["status"] == "NG"
    assert d.process(f,1.6)["status"] == "NG"
    assert d.process(f,1.85)["status"] == "OK"
    assert d.process(np.zeros_like(f),2)["status"] == "UNKNOWN"
