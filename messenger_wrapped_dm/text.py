from __future__ import annotations

import math
import re
import unicodedata


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "but",
    "by",
    "do",
    "for",
    "from",
    "had",
    "has",
    "have",
    "he",
    "her",
    "his",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "or",
    "our",
    "out",
    "she",
    "so",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "they",
    "this",
    "to",
    "up",
    "us",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "who",
    "why",
    "with",
    "you",
    "your",
    "w",
    "z",
    "na",
    "do",
    "po",
    "od",
    "za",
    "pod",
    "nad",
    "przy",
    "bez",
    "dla",
    "jak",
    "nie",
    "tak",
    "ze",
    "co",
    "czy",
    "ja",
    "ty",
    "on",
    "ona",
    "ono",
    "my",
    "wy",
    "oni",
    "one",
    "jest",
    "sa",
    "byc",
    "sie",
    "tez",
    "albo",
    "o",
    "u",
    "ale",
    "ej",
    "aha",
    "mhm",
    "bo",
    "to",
    "ten",
    "ta",
    "te",
    "tu",
    "tam",
    "juz",
    "jeszcze",
    "nic",
    "wszystko",
    "bardzo",
    "tylko",
    "wiec",
    "skoro",
    "czyli",
    "i",
    "oraz",
    "lub",
    "badz",
    "no",
    "ok",
    "dobra",
    "wlasnie",
    "gdzie",
    "kiedy",
    "kto",
    "ile",
    "czemu",
    "dlaczego",
    "bo",
    "choc",
    "mimo",
    "lecz",
    "aby",
    "zeby",
    "gdy",
    "gdyby",
    "jesli",
    "jezeli",
    "chyba",
    "moze",
    "wiem",
    "sobie",
    "mi",
    "mu",
    "jej",
    "nam",
    "wam",
    "im",
    "go",
    "ja",
    "nas",
    "was",
    "ich",
    "cie",
    "mnie",
    "tobie",
}

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
SPACES_RE = re.compile(r"\s+")
EMOJI_RE = re.compile(
    "["
    "\U0001F1E6-\U0001F1FF"
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\u2600-\u26FF"
    "\u2700-\u27BF"
    "]",
    re.UNICODE,
)
_DIACRITIC_MAP = str.maketrans(
    {
        "\u0105": "a",
        "\u0107": "c",
        "\u0119": "e",
        "\u0142": "l",
        "\u0144": "n",
        "\u00f3": "o",
        "\u015b": "s",
        "\u017c": "z",
        "\u017a": "z",
    }
)
TINY_MODEL_WEIGHTS = {
    "super": 1.4,
    "ok": 0.8,
    "dobry": 1.2,
    "swietny": 1.6,
    "fajny": 1.1,
    "kocham": 2.0,
    "lubi": 0.9,
    "lubie": 0.9,
    "dzieki": 1.1,
    "dziekuje": 1.1,
    "spoko": 1.0,
    "wow": 1.2,
    "git": 1.1,
    "cool": 1.2,
    "nice": 1.1,
    "great": 1.5,
    "awesome": 1.7,
    "love": 1.6,
    "happy": 1.3,
    "perfect": 1.6,
    "yes": 0.7,
    "yup": 0.6,
    "thx": 0.8,
    "thanks": 1.0,
    "xD": 0.5,
    "xd": 0.5,
    "lol": 0.6,
    "zly": -1.4,
    "slaby": -1.1,
    "smutny": -1.3,
    "wkurza": -1.6,
    "nie": -0.6,
    "niechce": -1.1,
    "nienawidze": -2.0,
    "problem": -0.9,
    "sorry": -0.7,
    "bad": -1.2,
    "sad": -1.2,
    "angry": -1.5,
    "hate": -1.8,
    "nope": -0.8,
    "worst": -1.6,
    "sucks": -1.4,
    "wtf": -1.3,
    "eh": -0.4,
    "serio": -0.6,
    "bezsens": -1.1,
    "masakra": -1.4,
}
TINY_MODEL_BIAS = 0.0


def tokenize(text: str) -> list[str]:
    text = text.lower()
    text = URL_RE.sub(" ", text)
    text = text.replace("_", " ")
    text = PUNCT_RE.sub(" ", text)
    text = SPACES_RE.sub(" ", text).strip()
    if not text:
        return []
    tokens = []
    for token in text.split(" "):
        if len(token) < 2:
            continue
        if token.isdigit():
            continue
        if token in STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def tokenize_raw(text: str) -> list[str]:
    """Tokenizes text but keeps stopwords, useful for n-gram generation."""
    text = text.lower()
    text = URL_RE.sub(" ", text)
    text = text.replace("_", " ")
    text = PUNCT_RE.sub(" ", text)
    text = SPACES_RE.sub(" ", text).strip()
    if not text:
        return []
    tokens = []
    for token in text.split(" "):
        if not token:
            continue
        tokens.append(token)
    return tokens


def generate_ngrams(tokens: list[str], n: int) -> list[str]:
    if len(tokens) < n:
        return []
    return [" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def is_meaningful_phrase(phrase: str) -> bool:
    """Returns True if the phrase is not composed entirely of stopwords."""
    words = phrase.split()
    if not words:
        return False
        
    # Helper to check if a word is a stopword (with normalization)
    def is_stop(w: str) -> bool:
        return normalize_token(w) in STOPWORDS
    
    # Must have at least one non-stopword
    has_content = any(not is_stop(word) for word in words)
    if not has_content:
        return False
        
    # Extra heuristic: for 2-word phrases, neither start nor end should be a generic stopword
    # unless it's a very strong combination (hard to judge without big dictionary).
    # But usually "stop stop" is garbage.
    # "stop content" (e.g. "w domu") is fine.
    # "content stop" (e.g. "domu w") is usually bad cutting.
    
    if len(words) == 2:
        # Reject if starts with stopword AND ends with stopword (already covered by has_content logic mostly,
        # but if we have mixed logic).
        # Actually, "w domu" -> start=stop, end=content -> OK.
        # "domu w" -> start=content, end=stop -> Maybe weird? "ide do domu w" (cut off).
        # Let's reject if ENDS with stopword for short phrases.
        if is_stop(words[-1]):
            return False
            
    return True


def normalize_token(token: str) -> str:
    token = token.casefold()
    token = token.translate(_DIACRITIC_MAP)
    normalized = unicodedata.normalize("NFKD", token)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def sentiment_tokenize(text: str) -> list[str]:
    text = text.lower()
    text = URL_RE.sub(" ", text)
    text = text.replace("_", " ")
    text = PUNCT_RE.sub(" ", text)
    text = SPACES_RE.sub(" ", text).strip()
    if not text:
        return []
    tokens = []
    for token in text.split(" "):
        if len(token) < 2:
            continue
        if token.isdigit():
            continue
        tokens.append(normalize_token(token))
    return tokens


def sentiment_score(text: str) -> float:
    tokens = sentiment_tokenize(text)
    if not tokens:
        return 0.0
    score = TINY_MODEL_BIAS
    for token in tokens:
        score += TINY_MODEL_WEIGHTS.get(token, 0.0)
    score = score / max(1.0, math.sqrt(len(tokens)))
    prob = 1.0 / (1.0 + math.exp(-score))
    return 2 * prob - 1


def extract_emojis(text: str) -> list[str]:
    if not text:
        return []
    return EMOJI_RE.findall(text)


def extract_links(text: str) -> list[str]:
    if not text:
        return []
    return URL_RE.findall(text)
