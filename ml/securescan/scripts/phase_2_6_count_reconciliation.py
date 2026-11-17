"""Stream the immutable source database into the count-reconciliation store."""
from _phase_2_6_entrypoint import run_stage

if __name__ == "__main__":
    raise SystemExit(run_stage("extract"))
