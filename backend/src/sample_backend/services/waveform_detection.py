"""Six fixed screen-space ROIs for ion-implanter waveform video.

Scores describe the visible trace, not implant dose. No per-frame alignment
or automatic ROI movement is performed.
"""
from dataclasses import dataclass
import math

import cv2
import numpy as np

PAIRS = ((1, 2), (3, 4), (5, 6))


@dataclass(frozen=True)
class WaveLayout:
    width: int
    height: int
    center_x: int
    top_y: int
    split_y: int
    bottom_y: int
    outer_half_width: int
    inner_half_width: int
    top_half_width: int

    def __post_init__(self):
        if any(type(v) is not int for v in vars(self).values()):
            raise ValueError("Layout coordinates must be integer source pixels")
        if not (1 <= self.width <= 4096 and 1 <= self.height <= 4096
                and self.width * self.height <= 4_194_304):
            raise ValueError("Unsupported image dimensions")
        if not (0 <= self.top_y <= self.split_y - 8
                and self.split_y <= self.bottom_y - 8
                and self.bottom_y <= self.height):
            raise ValueError("Invalid vertical bounds")
        if not (8 <= self.inner_half_width <= self.outer_half_width - 8
                and 8 <= self.top_half_width <= self.outer_half_width
                and self.outer_half_width <= min(self.center_x, self.width - self.center_x)):
            raise ValueError("Invalid horizontal bounds")

    def rectangles(self):
        c, t, s, b = self.center_x, self.top_y, self.split_y, self.bottom_y
        o, i, u = self.outer_half_width, self.inner_half_width, self.top_half_width
        # Half-open bounds: adjacent ROIs share a boundary, never pixels.
        return {
            1: (c-o, s, c-i, b), 2: (c+i, s, c+o, b),
            3: (c-i, s, c, b), 4: (c, s, c+i, b),
            5: (c-u, t, c, s), 6: (c, t, c+u, s),
        }


@dataclass(frozen=True)
class WaveSettings:
    # Empty ranges mean no approved reference; do not report OK.
    entropy_ranges: tuple[tuple[float, float], ...] = ()
    symmetry_min: tuple[float, float, float] = (.75, .75, .75)
    tolerance_ratio: float = .05
    min_pixels: int = 12
    max_fill: float = .90
    grid_size: int = 8
    hue_min: int = 35
    hue_max: int = 95
    saturation_min: int = 65
    value_min: int = 90
    green_margin: int = 28
    ng_hold_s: float = .5
    recover_hold_s: float = .5

    def __post_init__(self):
        if len(self.entropy_ranges) not in (0, 6) or any(
            not (0 <= low <= high <= 1) for low, high in self.entropy_ranges
        ):
            raise ValueError("Expected six normalized entropy ranges or none")
        if len(self.symmetry_min) != 3 or any(not 0 <= x <= 1 for x in self.symmetry_min):
            raise ValueError("Expected three symmetry thresholds")
        if not (0 <= self.tolerance_ratio <= .15 and 2 <= self.grid_size <= 8
                and self.min_pixels >= 1 and 0 < self.max_fill < 1
                and 0 <= self.hue_min <= self.hue_max <= 179
                and 0 <= self.saturation_min <= 255 and 0 <= self.value_min <= 255
                and 0 <= self.green_margin <= 255
                and 0 <= self.ng_hold_s <= 30 and 0 <= self.recover_hold_s <= 30):
            raise ValueError("Invalid waveform settings")


def extract_trace(bgr, settings):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (settings.hue_min, settings.saturation_min, settings.value_min),
                       (settings.hue_max, 255, 255))
    blue, green, red = cv2.split(bgr)
    # Signed arithmetic avoids overflow; reject red reference line and white glare.
    margin = green.astype(np.int16) - np.maximum(blue, red).astype(np.int16)
    mask[margin < settings.green_margin] = 0
    # Remove isolated pixels without eroding thin, valid traces.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= 3
    keep[0] = False
    return keep[labels]


def spatial_entropy(mask, grid=8):
    """Normalized Shannon entropy of foreground counts over a fixed grid."""
    y, x = np.nonzero(mask)
    if x.size == 0:
        return None
    h, w = mask.shape
    gy, gx = min(grid, h), min(grid, w)
    cells = (y * gy // h) * gx + (x * gx // w)
    counts = np.bincount(cells, minlength=gy*gx)
    p = counts[counts > 0] / x.size
    return float(np.clip(-np.sum(p * np.log2(p)) / math.log2(gy*gx), 0, 1)) if gy*gx > 1 else 0.0


def symmetry_score(left, right, tolerance_ratio=.03):
    """Bidirectional nearest foreground coverage after horizontal reflection."""
    if left.shape != right.shape:
        raise ValueError("Paired ROIs must have equal dimensions")
    right = np.ascontiguousarray(np.fliplr(right))
    if not left.any() or not right.any():
        return None
    radius = max(1, round(min(left.shape) * tolerance_ratio)) if tolerance_ratio else 0
    da = cv2.distanceTransform((~left).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    db = cv2.distanceTransform((~right).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    return float(((db[left] <= radius).mean() + (da[right] <= radius).mean()) / 2)


class WaveformDetector:
    def __init__(self, layout: WaveLayout, settings: WaveSettings | None = None):
        self.layout = layout
        self.settings = settings or WaveSettings()
        self.reset()

    def reset(self):
        self.status = "WARMUP"
        self.last_time = None
        self.bad_since = None
        self.good_since = None

    def process(self, frame, time_s):
        if frame.shape != (self.layout.height, self.layout.width, 3) or frame.dtype != np.uint8:
            raise ValueError("Frame must be source-sized uint8 BGR")
        if not math.isfinite(time_s) or time_s < 0 or (
                self.last_time is not None and time_s <= self.last_time):
            raise ValueError("Frame timestamp must increase; reset after seek")
        # A large capture gap cannot establish continuous abnormal/normal time.
        if self.last_time is not None and time_s - self.last_time > .5:
            self.reset()
        self.last_time = time_s
        cfg = self.settings
        rects = self.layout.rectangles()
        c, o, t, b = self.layout.center_x, self.layout.outer_half_width, self.layout.top_y, self.layout.bottom_y
        trace = extract_trace(frame[t:b, c-o:c+o], cfg)
        masks, entropy, pixels, valid = {}, [], [], []
        for n, (x0, y0, x1, y1) in rects.items():
            mask = trace[y0-t:y1-t, x0-c+o:x1-c+o]
            masks[n] = mask
            count = int(mask.sum())
            ok = cfg.min_pixels <= count <= cfg.max_fill * mask.size
            pixels.append(count)
            valid.append(ok)
            entropy.append(spatial_entropy(mask, cfg.grid_size) if ok else None)
        symmetry = [symmetry_score(masks[a], masks[b], cfg.tolerance_ratio)
                    if valid[a-1] and valid[b-1] else None for a, b in PAIRS]
        bad_regions = [n for n, value in enumerate(entropy, 1)
                       if value is not None and cfg.entropy_ranges and
                       not cfg.entropy_ranges[n-1][0] <= value <= cfg.entropy_ranges[n-1][1]]
        bad_pairs = [f"{a}-{b}" for (a, b), value, threshold in zip(PAIRS, symmetry, cfg.symmetry_min)
                     if value is not None and value < threshold]
        invalid_regions = [n for n, ok in enumerate(valid, 1) if not ok]
        reason = ""
        if invalid_regions or not cfg.entropy_ranges:
            self.status = "UNKNOWN"
            self.bad_since = self.good_since = None
            reason = "INVALID_TRACE" if invalid_regions else "REFERENCE_REQUIRED"
        elif bad_regions or bad_pairs:
            self.good_since = None
            if self.bad_since is None:
                self.bad_since = time_s
            if time_s - self.bad_since >= cfg.ng_hold_s - 1e-9:
                self.status = "NG"
            elif self.status != "NG":
                self.status = "WARMUP"  # Current candidate is not yet confirmed.
        else:
            self.bad_since = None
            if self.good_since is None:
                self.good_since = time_s
            if time_s - self.good_since >= cfg.recover_hold_s - 1e-9:
                self.status = "OK"
            elif self.status != "NG":
                self.status = "WARMUP"
        return {"status": self.status, "reason": reason, "time_s": time_s,
                "entropy": entropy, "symmetry": symmetry, "pixel_counts": pixels,
                "invalid_regions": invalid_regions, "bad_regions": bad_regions,
                "bad_pairs": bad_pairs,
                "abnormal_run_s": 0.0 if self.bad_since is None else time_s - self.bad_since}


# OpenCV BGR equivalents of the fixed frontend region colors.
# Fill is only a visual identifier; existing borders still indicate status.
REGION_COLORS_BGR = (
    (255, 202, 72), (181, 214, 101), (111, 196, 247),
    (166, 146, 236), (243, 149, 173), (103, 154, 241),
)
REGION_FILL_OPACITY = 0.16


def render_waveform_frame(frame, layout, result):
    image = frame.copy()
    bad = set(result["bad_regions"])
    for pair in result["bad_pairs"]:
        bad.update(map(int, pair.split("-")))
    invalid = set(result["invalid_regions"])
    for n, (x0, y0, x1, y1) in layout.rectangles().items():
        # Blend only the copied display pixels, never the detector's input.
        roi = image[y0:y1, x0:x1]
        tint = np.empty_like(roi)
        tint[:] = REGION_COLORS_BGR[n-1]
        cv2.addWeighted(roi, 1-REGION_FILL_OPACITY, tint, REGION_FILL_OPACITY, 0, dst=roi)
        color = ((40, 50, 230) if n in bad else (0, 190, 255) if n in invalid
                 else (70, 200, 80) if result['status'] == 'OK' else (170, 170, 170))
        cv2.rectangle(image, (x0, y0), (x1-1, y1-1), color, 1)
        cv2.putText(image, str(n), (x0+3, y0+15), cv2.FONT_HERSHEY_SIMPLEX, .45, color, 1, cv2.LINE_AA)
    return image
