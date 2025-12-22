from __future__ import annotations

from functools import lru_cache
import math
import os
import re
from typing import Callable, Iterable


DEFAULT_MODEL = "lxyuan/distilbert-base-multilingual-cased-sentiments-student"


class SentimentModelError(RuntimeError):
    pass


def _softmax(logits: Iterable[float]) -> list[float]:
    values = list(logits)
    max_val = max(values)
    exps = [math.exp(val - max_val) for val in values]
    total = sum(exps)
    return [val / total for val in exps]


def _label_scores(labels: list[str]) -> list[float]:
    lowered = [label.lower() for label in labels]
    if any("positive" in label for label in lowered) or any("negative" in label for label in lowered):
        scores = []
        for label in lowered:
            if "negative" in label:
                scores.append(-1.0)
            elif "positive" in label:
                scores.append(1.0)
            elif "neutral" in label:
                scores.append(0.0)
            else:
                scores.append(0.0)
        if any(score != 0.0 for score in scores):
            return scores

    numbers = []
    for label in lowered:
        match = re.search(r"(\\d+)", label)
        numbers.append(int(match.group(1)) if match else None)
    if all(value is not None for value in numbers):
        min_val = min(numbers)
        max_val = max(numbers)
        if max_val == min_val:
            return [0.0 for _ in numbers]
        return [((value - min_val) / (max_val - min_val)) * 2 - 1 for value in numbers]

    count = len(labels)
    if count <= 1:
        return [0.0]
    return [-1.0 + (2.0 * idx) / (count - 1) for idx in range(count)]


@lru_cache(maxsize=1)
def _load_model(model_name: str) -> tuple[object, object, list[float], object]:
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    import torch

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)
    model.eval()
    labels = [model.config.id2label[idx] for idx in range(model.config.num_labels)]
    label_scores = _label_scores(labels)
    return tokenizer, model, label_scores, torch


def get_sentiment_scorer(
    model_name: str | None = None, strict: bool = False
) -> Callable[[list[str]], list[float]] | None:
    # Force heuristic/none mode for browser/GitHub Pages version
    # to avoid loading heavy torch/transformers libraries.
    return None

    # Original code below disabled
    # mode = os.environ.get("MESSENGER_WRAPPED_SENTIMENT", "hf").lower()
    # ...
