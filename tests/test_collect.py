import datetime as dt
import threading
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest import mock

import collect


class ParallelCollectionTests(unittest.TestCase):
    def test_scrapes_channels_in_parallel_and_preserves_results(self):
        lock = threading.Lock()
        active = 0
        maximum_active = 0

        def fake_scrape(channel, _target_date):
            nonlocal active, maximum_active
            with lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.02)
            with lock:
                active -= 1
            return [("12:00", f"message from {channel}")]

        output = StringIO()
        with (
            mock.patch.object(collect, "SCRAPE_WORKERS", 3),
            mock.patch.object(
                collect,
                "collect_scrape_channel",
                side_effect=fake_scrape,
            ),
            redirect_stdout(output),
        ):
            by_channel, source_map = collect.collect_category(
                "world",
                ["one", "two", "three"],
                dt.date(2026, 7, 26),
                None,
            )

        self.assertGreater(maximum_active, 1)
        self.assertEqual(list(by_channel), ["one", "two", "three"])
        self.assertEqual(source_map, {
            "one": "scrape",
            "two": "scrape",
            "three": "scrape",
        })
        self.assertIn("channels_completed=3", output.getvalue())
        self.assertIn("channels_total=3", output.getvalue())
        self.assertIn("messages=3", output.getvalue())


if __name__ == "__main__":
    unittest.main()
