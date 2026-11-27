import json
import zipfile

from sample_backend.services.waveform_profile import (
    WaveProfile, WaveProfileStore, export_wave_profile, read_wave_profile,
)


def legacy_profile():
    return {
        'version': 1,
        'layout': {'width': 240, 'height': 180, 'center_x': 120,
                   'top_y': 10, 'split_y': 60, 'bottom_y': 170,
                   'outer_half_width': 100, 'inner_half_width': 55, 'top_half_width': 45},
        'settings': {'entropy_ranges': [[i/10, (i+1)/10] for i in range(6)],
                     'symmetry_min': [.71, .82, .93]},
    }


def assert_migrated(profile, old):
    assert profile.version == 2
    assert profile.model_dump()['layout'] == old['layout']
    assert list(profile.settings.entropy_ranges) == [
        tuple(old['settings']['entropy_ranges'][i]) for i in (0, 1, 4, 5, 2, 3)
    ]
    assert profile.settings.symmetry_min == (.71, .93, .82)


def test_old_profile_preserves_physical_thresholds_and_does_not_swap_twice(tmp_path):
    old = legacy_profile()
    path = tmp_path / 'profile.json'
    path.write_text(json.dumps(old), encoding='utf-8')
    store = WaveProfileStore(path)
    assert_migrated(store.current(), old)
    saved = store.save(store.current())
    assert_migrated(saved, old)
    assert json.loads(path.read_text(encoding='utf-8'))['version'] == 2
    assert_migrated(WaveProfileStore(path).current(), old)


def test_legacy_archive_migrates_and_new_archive_keeps_numbering(tmp_path):
    old = legacy_profile()
    source = tmp_path / 'old.zip'
    with zipfile.ZipFile(source, 'w') as archive:
        archive.writestr('waveform-profile-v1.json', json.dumps(old))
    profile = read_wave_profile(source)
    assert_migrated(profile, old)
    target = tmp_path / 'new.zip'
    export_wave_profile(profile, target)
    with zipfile.ZipFile(target) as archive:
        assert archive.namelist() == ['waveform-profile-v2.json']
    assert_migrated(read_wave_profile(target), old)


def test_empty_reference_stays_empty():
    p = WaveProfile.model_validate({'version': 1, 'settings': {'entropy_ranges': []}})
    assert p.version == 2
    assert p.settings.entropy_ranges == ()
