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
    assert r[1][2] == r[3][0]
    assert r[4][2] == r[2][0]
    assert r[3] == (65, 60, 120, 170)
    assert r[4] == (120, 60, 175, 170)
    assert r[5] == (65, 10, 120, 60)
    assert r[6] == (120, 10, 175, 60)
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
    x0,y0,x1,y1=layout().rectangles()[4]
    changed[y0:y1,x0:x1]=0
    cv2.line(changed,(x0+4,y1-5),(x1-5,y0+4),(0,255,0),2)
    # Use a horizontal line to create an obviously different right-side trace.
    changed[y0:y1,x0:x1]=0
    cv2.line(changed,(x0+4,y0+5),(x1-5,y0+5),(0,255,0),2)
    assert d.process(changed,.6)["bad_pairs"] == ["3-4"]
    assert d.process(changed,.85)["status"] == "WARMUP"
    assert d.process(changed,1.1)["status"] == "NG"
    assert d.process(f,1.35)["status"] == "NG"
    assert d.process(f,1.6)["status"] == "NG"
    assert d.process(f,1.85)["status"] == "OK"
    assert d.process(np.zeros_like(f),2)["status"] == "UNKNOWN"


def test_region_fill_is_fixed_and_does_not_modify_analysis_frame():
    from sample_backend.services.waveform_detection import (
        render_waveform_frame, REGION_COLORS_BGR, REGION_FILL_OPACITY,
    )
    l = layout()
    raw = np.full((l.height, l.width, 3), (12, 40, 80), np.uint8)
    before = raw.copy()
    normal = {'status': 'OK', 'bad_regions': [], 'bad_pairs': [], 'invalid_regions': []}
    abnormal = {'status': 'NG', 'bad_regions': [1], 'bad_pairs': ['3-4'], 'invalid_regions': [6]}
    a = render_waveform_frame(raw, l, normal)
    b = render_waveform_frame(raw, l, abnormal)
    interior = []
    for n, (x0, y0, x1, y1) in l.rectangles().items():
        y, x = y1-4, (x0+x1)//2
        expected = np.rint((1-REGION_FILL_OPACITY)*before[y,x] +
                           REGION_FILL_OPACITY*np.array(REGION_COLORS_BGR[n-1]))
        np.testing.assert_allclose(a[y,x], expected, atol=1)
        np.testing.assert_array_equal(a[y,x], b[y,x])
        interior.append(tuple(a[y,x]))
    assert len(set(interior)) == 6
    x0,y0,_,_ = l.rectangles()[1]
    assert tuple(a[y0,x0]) == (70,200,80)
    assert tuple(b[y0,x0]) == (40,50,230)
    np.testing.assert_array_equal(raw, before)
    np.testing.assert_array_equal(a[0,0], before[0,0])
