import importlib.util
import json
import pathlib
import types
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name('georef-plate.py')
SPEC = importlib.util.spec_from_file_location('georef_plate', SCRIPT)
GEOREF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GEOREF)


class GeorefPlateTest(unittest.TestCase):
    def setUp(self):
        self.labels = [
            {'deg': 34.6, 'cx': 20, 'cy': 10},
            {'deg': 34.8, 'cx': 80, 'cy': 10},
            {'deg': 32.2, 'cx': 10, 'cy': 20},
            {'deg': 32.0, 'cx': 10, 'cy': 80},
        ]
        self.image = types.SimpleNamespace(size=(100, 100))

    def safe_fit(self):
        return {
            'frame': [10, 10, 90, 90],
            'resid_deg': [0.001, 0.001],
            'conformality': 1.0,
            'arp_frac': [0.5, 0.5],
            'sw': [32.0, 34.6],
            'ne': [32.2, 34.8],
        }

    def test_automatic_fit_passes_the_write_gate(self):
        info = types.SimpleNamespace(stdout='Page size: 100 x 100')
        with mock.patch.object(GEOREF, 'labels', return_value=self.labels), \
                mock.patch.object(GEOREF.subprocess, 'run', return_value=info), \
                mock.patch.object(GEOREF.Image, 'open', return_value=self.image), \
                mock.patch.object(GEOREF, 'frame', return_value=([10, 90], [10, 90], 100, 100)), \
                mock.patch.object(GEOREF, 'ticks_along', return_value=[]):
            out = GEOREF.georef('plate.pdf', 'plate.png', (32.1, 34.7))
        self.assertEqual(GEOREF.validate_fit(out), [])

    def test_manual_fit_rejects_reversed_bounds(self):
        with mock.patch.object(GEOREF, 'frame', return_value=([10, 90], [10, 90], 100, 100)):
            out = GEOREF.georef_manual(
                'plate.png',
                {34.6: 20, 34.8: 80},
                {32.0: 20, 32.2: 80},
                (32.1, 34.7),
            )
        self.assertTrue(any('reversed' in reason for reason in GEOREF.validate_fit(out)))

    def test_diagnostics_reject_distortion_and_outside_arp(self):
        out = {
            'frame': [0, 0, 100, 100],
            'resid_deg': [0, 0],
            'conformality': 0.5963,
            'arp_frac': [1.2, 0.5],
            'sw': [32.2, 34.6],
            'ne': [32.0, 34.8],
        }
        errors = GEOREF.validate_fit(out)
        self.assertGreaterEqual(len(errors), 3)

    def test_write_path_rejects_an_unsafe_fit_before_rendering(self):
        bad = self.safe_fit()
        bad['conformality'] = 0.5963
        with mock.patch('shutil.which', return_value='/usr/bin/tool'), \
                mock.patch('builtins.open', mock.mock_open(
                    read_data=json.dumps({'airfields': []}))), \
                mock.patch.object(GEOREF, 'georef', return_value=bad), \
                mock.patch('subprocess.run') as run:
            status = GEOREF.main(['plate.pdf', 'TEST', '--png', 'plate.png', '--write'])
        self.assertEqual(status, 2)
        run.assert_not_called()

    def test_write_path_renders_an_accepted_fit(self):
        hi = mock.MagicMock(size=(1000, 1000))
        low = mock.MagicMock(size=(100, 100))
        hi.convert.return_value = hi
        crop = mock.MagicMock(width=800, height=600)
        resized = mock.MagicMock()
        palette = mock.MagicMock()
        hi.crop.return_value = crop
        crop.resize.return_value = resized
        resized.convert.return_value = palette
        with mock.patch('shutil.which', return_value='/usr/bin/tool'), \
                mock.patch('builtins.open', mock.mock_open(
                    read_data=json.dumps({'airfields': []}))), \
                mock.patch.object(GEOREF, 'georef', return_value=self.safe_fit()), \
                mock.patch('glob.glob', side_effect=[[], ['/tmp/georef-plate-1.png']]), \
                mock.patch('subprocess.run') as run, \
                mock.patch.object(GEOREF.Image, 'open', side_effect=[hi, low]):
            status = GEOREF.main(['plate.pdf', 'TEST', '--png', 'plate.png', '--write'])
        self.assertEqual(status, 0)
        run.assert_called_once()
        palette.save.assert_called_once_with(
            'docs/cvfr-img/TEST_cvfr.png', optimize=True)

    def test_manual_dry_run_does_not_require_poppler(self):
        with mock.patch('shutil.which', return_value=None), \
                mock.patch('builtins.open', mock.mock_open(
                    read_data=json.dumps({'airfields': []}))), \
                mock.patch.object(GEOREF, 'georef_manual', return_value=self.safe_fit()):
            status = GEOREF.main([
                'plate.pdf', 'TEST', '--png', 'plate.png',
                '--lon', '34:36=20', '34:48=80',
                '--lat', '32:00=80', '32:12=20',
            ])
        self.assertEqual(status, 0)

    def test_write_path_reports_renderer_failure_without_opening_an_image(self):
        failure = GEOREF.subprocess.CalledProcessError(
            1, ['pdftoppm'], stderr='broken PDF')
        with mock.patch('shutil.which', return_value='/usr/bin/tool'), \
                mock.patch('builtins.open', mock.mock_open(
                    read_data=json.dumps({'airfields': []}))), \
                mock.patch.object(GEOREF, 'georef', return_value=self.safe_fit()), \
                mock.patch('glob.glob', return_value=[]), \
                mock.patch('subprocess.run', side_effect=failure), \
                mock.patch.object(GEOREF.Image, 'open') as image_open:
            status = GEOREF.main(['plate.pdf', 'TEST', '--png', 'plate.png', '--write'])
        self.assertEqual(status, 2)
        image_open.assert_not_called()


if __name__ == '__main__':
    unittest.main()
