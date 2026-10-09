"""Self-checks for measure.py. Run: Benchmark/.venv/Scripts/python.exe -m unittest discover -s Benchmark -p "test_*.py" """
import json
import unittest
from pathlib import Path

import measure


class MergeSpans(unittest.TestCase):
    def test_overlapping_windows_merge(self):
        self.assertEqual(measure.merge_spans([10, 15], 10, 100), [[1, 25]])

    def test_distant_windows_stay_separate(self):
        self.assertEqual(measure.merge_spans([5, 50], 3, 100), [[2, 8], [47, 53]])

    def test_clamped_to_file(self):
        self.assertEqual(measure.merge_spans([1, 99], 5, 100), [[1, 6], [94, 100]])


class Counts(unittest.TestCase):
    def test_empty(self):
        c = measure.counts("")
        self.assertEqual(c["o200k_base"], 0)
        self.assertEqual(c["chars_div4"], 0)

    def test_nonzero(self):
        self.assertGreater(measure.counts("hello world")["cl100k_base"], 0)


class Tasks(unittest.TestCase):
    def test_every_task_has_graph_call_and_baseline(self):
        tasks = json.loads((Path(measure.HERE) / "tasks.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(tasks), 8)
        for t in tasks:
            self.assertIn("tool", t["graph_call"])
            self.assertTrue(t["baseline"].get("cmd") or t["baseline"].get("paths"))

    def test_baselines_nonempty(self):
        tasks = json.loads((Path(measure.HERE) / "tasks.json").read_text(encoding="utf-8"))
        for t in tasks:
            if t["id"] not in ("t8", "t14"):  # t8: clean tree; t14: deliberate no-hit search
                self.assertTrue(measure.baseline(t["baseline"]).strip(), t["id"])


if __name__ == "__main__":
    unittest.main()
