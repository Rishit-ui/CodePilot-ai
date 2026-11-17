"""Thin, named Phase 2.6 task entry points backed by the restartable pipeline."""

from __future__ import annotations

import sys

from phase_2_6_curate import main


def run_stage(stage: str) -> int:
    """Inject a fixed pipeline stage while preserving all documented options."""
    sys.argv.insert(1, stage)
    return main()
