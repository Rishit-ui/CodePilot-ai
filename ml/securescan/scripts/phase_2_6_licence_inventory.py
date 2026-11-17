"""Refresh the per-repository licence and provenance inventory."""
from _phase_2_6_entrypoint import run_stage

if __name__ == "__main__":
    raise SystemExit(run_stage("license"))
