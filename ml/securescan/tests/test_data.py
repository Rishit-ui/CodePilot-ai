from types import SimpleNamespace

import pytest
from datasets import Dataset, DatasetDict

from securescan_ml import data
from securescan_ml.leakage import grouped_partitions, investigate_and_group


def row(code, label, label_name, language="Python"):
    return {
        "code": code,
        "label": label,
        "programming_language": language,
        "cwe_id": "CWE-79",
        "cwe_name": "Cross-site Scripting",
        "description": "metadata must not enter the model",
        "url": "https://example.test/cwe",
        "label_name": label_name,
    }


def dataset_dict(train_rows=None, validation_rows=None, test_rows=None):
    return DatasetDict(
        {
            "train": Dataset.from_list(train_rows or [row("safe_call(value)", 1, "safe")]),
            "validation": Dataset.from_list(validation_rows or [row("eval(user_input)", 0, "vulnerable")]),
            "test": Dataset.from_list(test_rows or [row("return escaped(value)", 1, "safe")]),
        }
    )


def test_dataset_loader_validates_splits_and_records_source(monkeypatch, tmp_path):
    fixture = dataset_dict()
    monkeypatch.setattr(data, "load_dataset", lambda *args, **kwargs: fixture)
    monkeypatch.setattr(
        data,
        "HfApi",
        lambda: SimpleNamespace(
            dataset_info=lambda dataset_id, **kwargs: SimpleNamespace(
                sha="fixture-revision", card_data=SimpleNamespace(license="mit")
            ),
            list_repo_files=lambda dataset_id, **kwargs: ["README.md", "LICENSE"],
        ),
    )
    loaded, source = data.load_dataset_bundle(tmp_path, revision="fixture-revision")
    assert set(loaded) == {"train", "validation", "test"}
    assert source.revision == "fixture-revision"
    assert source.license == "mit"
    assert source.license_files == ("LICENSE",)


def test_verified_label_mapping_inverts_source_labels_for_vulnerability_positive_class():
    assert data.encode_label(0, "vulnerable") == 1
    assert data.encode_label(1, "safe") == 0
    with pytest.raises(ValueError, match="Inconsistent label pair"):
        data.encode_label(0, "safe")


def test_preprocessing_removes_empty_conflicting_and_cross_split_exact_duplicates():
    shared = "dangerous(user_input)"
    fixture = dataset_dict(
        train_rows=[
            row(shared, 0, "vulnerable"),
            row("   ", 1, "safe"),
            row("conflict(value)", 0, "vulnerable"),
            row("conflict(value)", 1, "safe"),
        ],
        validation_rows=[row(shared, 0, "vulnerable"), row("validate(value)", 1, "safe")],
        test_rows=[row(shared, 0, "vulnerable"), row("sanitize(value)", 1, "safe")],
    )
    processed, stats = data.prepare_splits(fixture)
    assert stats["unusable_rows"] == 1
    assert stats["conflicting_duplicate_groups_removed"] == 1
    assert stats["conflicting_duplicate_rows_removed"] == 2
    assert stats["exact_duplicate_rows_removed"] == 2
    assert shared in processed["train"]["code"].tolist()
    assert shared not in processed["validation"]["code"].tolist()
    assert shared not in processed["test"]["code"].tolist()
    assert set(processed["train"].columns) >= {"code", "programming_language", "target", "target_name"}
    assert "description" not in processed["train"].columns


def test_empty_and_minimal_inputs_are_unusable():
    assert data.normalize_code(None) == ""
    assert not data.is_usable_code("")
    assert not data.is_usable_code("{}")
    assert data.is_usable_code("return value;")


def test_simhash_is_deterministic_and_identifier_insensitive():
    first = data.simhash64("function check(user) { return sanitize(user); }")
    second = data.simhash64("function check(value) { return sanitize(value); }")
    assert first == data.simhash64("function check(user) { return sanitize(user); }")
    assert (first ^ second).bit_count() <= 3


def test_verified_clone_groups_never_cross_controlled_partitions():
    rows = []
    for index in range(100):
        target = index % 2
        code = f"int function_{index}(void) {{ return {index}; }}"
        rows.append({
            "code": code,
            "code_sha256": f"hash-{index}",
            "source_split": ("train", "validation", "test")[index % 3],
            "source_index": index,
            "programming_language": "C" if index % 4 else "C++",
            "target": target,
        })
    frame = __import__("pandas").DataFrame(rows)
    audited = investigate_and_group(frame)
    partitions = grouped_partitions(audited.frame)
    groups = {name: set(partition["clone_group"]) for name, partition in partitions.items()}
    assert groups["train"].isdisjoint(groups["validation"])
    assert groups["train"].isdisjoint(groups["test"])
    assert groups["validation"].isdisjoint(groups["test"])
