"""Admin-approved layout and thresholds; versioned atomic persistence."""
import os
import threading
import zipfile
from pathlib import Path
from uuid import uuid4
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from sample_backend.core.config import data_directory
from .waveform_detection import WaveLayout, WaveSettings


class WaveProfile(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    version: Literal[1] = 1
    layout: WaveLayout | None = None
    settings: WaveSettings = Field(default_factory=WaveSettings)


class WaveProfileStore:
    def __init__(self, path: Path | None = None):
        self.path = path or data_directory() / 'waveform' / 'profile.json'
        self._lock = threading.RLock()
        self._profile = (WaveProfile.model_validate_json(self.path.read_text(encoding='utf-8'))
                         if self.path.is_file() else WaveProfile())

    def current(self):
        with self._lock:
            return self._profile.model_copy(deep=True)

    def save(self, profile: WaveProfile):
        # Fully validated before replacing the previous on-disk record.
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_name(uuid4().hex + '.tmp')
            try:
                temp.write_text(profile.model_dump_json(indent=2), encoding='utf-8')
                os.replace(temp, self.path)
            finally:
                temp.unlink(missing_ok=True)
            self._profile = profile.model_copy(deep=True)
            return self.current()


ARCHIVE_NAME = 'waveform-profile-v1.json'
MAX_PROFILE_BYTES = 64 * 1024


def export_wave_profile(profile, target):
    target = Path(target)
    if target.suffix.lower() != '.zip' or not target.is_absolute() or not target.parent.is_dir():
        raise ValueError('请选择有效的 ZIP 文件路径')
    tmp = target.with_name(uuid4().hex + '.tmp')
    try:
        with zipfile.ZipFile(tmp, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr(ARCHIVE_NAME, profile.model_dump_json())
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def read_wave_profile(source):
    source = Path(source)
    if source.suffix.lower() != '.zip' or not source.is_absolute() or not source.is_file():
        raise ValueError('请选择有效的 ZIP 文件')
    if source.stat().st_size > MAX_PROFILE_BYTES:
        raise ValueError('配置文件过大')
    with zipfile.ZipFile(source) as z:
        infos = z.infolist()
        if (len(infos) != 1 or infos[0].filename != ARCHIVE_NAME
                or infos[0].file_size > MAX_PROFILE_BYTES):
            raise ValueError('不是受支持的波形配置 ZIP')
        return WaveProfile.model_validate_json(z.read(infos[0]))
