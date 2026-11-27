"""Six-region profile and approved-source opening; reuse existing video transport."""
import zipfile

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from sample_backend.services.user_access import AccessDenied
from sample_backend.services.video_stream import (
    WaveVideoOpenInput, VideoDimensionsMismatch, VideoDimensionsTooLarge,
)
from sample_backend.services.waveform_profile import WaveProfile, export_wave_profile, read_wave_profile

router = APIRouter(prefix='/api/waveform')


class SaveProfile(BaseModel):
    admin_token: str = Field(min_length=1, max_length=128)
    profile: WaveProfile


class ArchiveInput(BaseModel):
    admin_token: str = Field(min_length=1, max_length=128)
    file_path: str = Field(min_length=1, max_length=4096)


@router.get('/profile')
def get_profile(request: Request):
    return request.app.state.waveform_profile.current()


@router.post('/profile/save')
def save_profile(req: SaveProfile, request: Request):
    try:
        request.app.state.user_access.require_admin(req.admin_token)
        result = request.app.state.waveform_profile.save(req.profile)
        request.app.state.video_stream.close()
        return result
    except AccessDenied as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(422, detail='波形配置保存失败') from exc


@router.post('/open')
def open_wave_video(req: WaveVideoOpenInput, request: Request):
    profile = request.app.state.waveform_profile.current()
    if profile.layout is None:
        raise HTTPException(422, detail='请管理员先完成六区域标定')
    try:
        return request.app.state.video_stream.open(
            req, request.app.state.video_source.current(), profile.layout, profile.settings)
    except VideoDimensionsMismatch as exc:
        raise HTTPException(422, detail={
            'code': 'CALIBRATION_RESOLUTION_MISMATCH',
            'video_width': exc.width, 'video_height': exc.height,
            'calibration_width': exc.calibration_width, 'calibration_height': exc.calibration_height,
        }) from exc
    except VideoDimensionsTooLarge as exc:
        raise HTTPException(422, detail={
            'code': 'VIDEO_RESOLUTION_TOO_LARGE', 'video_width': exc.width, 'video_height': exc.height,
        }) from exc
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.post('/archive/export')
def archive_export(req: ArchiveInput, request: Request):
    try:
        request.app.state.user_access.require_admin(req.admin_token)
        export_wave_profile(request.app.state.waveform_profile.current(), req.file_path)
        return {'saved': True}
    except AccessDenied as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(422, detail='波形配置导出失败') from exc


@router.post('/archive/import')
def archive_import(req: ArchiveInput, request: Request):
    try:
        request.app.state.user_access.require_admin(req.admin_token)
        profile = read_wave_profile(req.file_path)
        result = request.app.state.waveform_profile.save(profile)
        request.app.state.video_stream.close()
        return result
    except AccessDenied as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from exc
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as exc:
        raise HTTPException(422, detail='波形配置导入失败，原配置未替换') from exc
