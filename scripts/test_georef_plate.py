import importlib.util
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
                'plate.pdf', 'plate.png',
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


if __name__ == '__main__':
    unittest.main()
