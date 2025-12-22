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
    "io",
    "ii",
    "iii",
    "iv",
    "vi",
    "vii",
    "viii",
    "ix",
    "xx",
}
VOWELS = set("aeiouy")

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
EXTRA_SENTIMENT_WEIGHTS = {
    "wspanialy": 1.8,
    "cudowny": 1.7,
    "fantastyczny": 1.6,
    "niesamowity": 1.6,
    "rewelacja": 1.7,
    "rewelacyjny": 1.6,
    "extra": 1.1,
    "fajnie": 1.0,
    "pieknie": 1.2,
    "uroczo": 1.1,
    "slodko": 1.1,
    "kochany": 1.4,
    "uwielbiam": 1.9,
    "dumna": 1.2,
    "dumny": 1.2,
    "wspaniale": 1.6,
    "super": 1.4,
    "genialny": 1.7,
    "genialnie": 1.5,
    "zajebiscie": 1.8,
    "zajebisty": 1.8,
    "spokojnie": 0.6,
    "tragedia": -1.7,
    "dramat": -1.6,
    "beznadziejny": -1.7,
    "okropny": -1.6,
    "fatalny": -1.6,
    "smutno": -1.3,
    "smutny": -1.3,
    "przykro": -1.1,
    "zal": -1.1,
    "zalosny": -1.2,
    "zalosne": -1.2,
    "zle": -1.2,
    "gorzej": -0.9,
    "slabo": -1.1,
    "wkurzony": -1.4,
    "wkurza": -1.4,
    "wkurwiony": -1.6,
    "zalamka": -1.4,
    "bezsens": -1.1,
    "nerwowo": -1.1,
    "nerwowy": -1.1,
    "stres": -1.0,
    "stresujace": -1.1,
    "okropnie": -1.5,
    "niefajny": -1.0,
}
SENTIMENT_LEXICON = {**TINY_MODEL_WEIGHTS, **EXTRA_SENTIMENT_WEIGHTS}
INTENSIFIERS = {
    "bardzo": 1.3,
    "mega": 1.4,
    "super": 1.2,
    "strasznie": 1.4,
    "naprawde": 1.2,
    "totalnie": 1.2,
    "mocno": 1.2,
    "niesamowicie": 1.4,
    "cholernie": 1.3,
}
DAMPENERS = {
    "troche": 0.7,
    "troszke": 0.7,
    "lekko": 0.8,
    "raczej": 0.8,
}
NEGATIONS = {
    "nie",
    "nigdy",
    "bez",
    "zadne",
    "zadnych",
    "zadna",
    "zadnego",
    "nikt",
    "nic",
}
POSITIVE_EMOTICON_RE = re.compile(r"(:\)+|:-\)+|:d+|x-?d+|;\)+|<3)", re.IGNORECASE)
NEGATIVE_EMOTICON_RE = re.compile(r"(:\(+|:-\(+|:'\(+|=\(+|d:|d=|>:\()", re.IGNORECASE)
LAUGHTER_RE = re.compile(r"\b(ha){2,}|(he){2,}|(ja){2,}|lol+\b", re.IGNORECASE)
REPEAT_RE = re.compile(r"(.)\1{2,}")
POSITIVE_EMOJI = {
    "\U0001F602",
    "\U0001F60D",
    "\U0001F60A",
    "\U0001F600",
    "\U0001F601",
    "\U0001F973",
    "\U0001F970",
    "\U0001F44D",
    "\U0001F495",
    "\U0001F496",
    "\U0001F497",
    "\U0001F498",
    "\U0001F49B",
    "\U0001F49C",
    "\U0001F49A",
    "\U0001F49D",
    "\U0001F60E",
    "\U0001F609",
}
NEGATIVE_EMOJI = {
    "\U0001F62D",
    "\U0001F622",
    "\U0001F641",
    "\U0001F614",
    "\U0001F612",
    "\U0001F621",
    "\U0001F620",
    "\U0001F624",
    "\U0001F92C",
    "\U0001F494",
    "\U0001F625",
}


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
    normalized = [normalize_token(word) for word in words]
    if all(len(word) <= 2 for word in normalized):
        return False

    def has_vowel(token: str) -> bool:
        return any(ch in VOWELS for ch in token)

    def has_consonant(token: str) -> bool:
        return any(ch.isalpha() and ch not in VOWELS for ch in token)

    def is_noise_token(token: str) -> bool:
        if len(token) <= 2:
            return True
        if len(token) >= 3 and len(set(token)) == 1:
            return True
        if len(token) <= 3:
            if not has_vowel(token) or not has_consonant(token):
                return True
        return False
        
    # Helper to check if a word is a stopword (with normalization)
    def is_stop(w: str) -> bool:
        return normalize_token(w) in STOPWORDS
    
    # Must have at least one non-stopword
    has_content = any(not is_stop(word) for word in words)
    if not has_content:
        return False

    content_tokens = [normalize_token(word) for word in words if not is_stop(word)]
    if not content_tokens:
        return False
    if all(is_noise_token(token) for token in content_tokens):
        return False
    if not any(len(token) >= 3 and has_vowel(token) and has_consonant(token) for token in content_tokens):
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
    if not text:
        return 0.0
    cleaned = REPEAT_RE.sub(r"\1\1", text)
    tokens = sentiment_tokenize(cleaned)

    score = TINY_MODEL_BIAS
    intensify = 1.0
    negate = 0
    for token in tokens:
        if token in NEGATIONS:
            negate = 2
            continue
        if token in INTENSIFIERS:
            intensify = max(intensify, INTENSIFIERS[token])
            continue
        if token in DAMPENERS:
            intensify *= DAMPENERS[token]
            continue
        weight = SENTIMENT_LEXICON.get(token, 0.0)
        if weight == 0.0:
            continue
        if negate > 0:
            weight = -weight * 0.85
            negate -= 1
        weight *= intensify
        intensify = 1.0
        score += weight

    pos_emot = len(POSITIVE_EMOTICON_RE.findall(text))
    neg_emot = len(NEGATIVE_EMOTICON_RE.findall(text))
    score += 0.6 * (pos_emot - neg_emot)
    if LAUGHTER_RE.search(text):
        score += 0.5

    emojis = extract_emojis(text)
    pos_emo = sum(1 for emo in emojis if emo in POSITIVE_EMOJI)
    neg_emo = sum(1 for emo in emojis if emo in NEGATIVE_EMOJI)
    score += 0.7 * (pos_emo - neg_emo)

    punct = text.count("!") + text.count("?")
    if punct:
        score *= 1.0 + min(0.3, 0.04 * punct)

    letters = [c for c in text if c.isalpha()]
    if len(letters) >= 4:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio >= 0.6:
            score *= 1.1

    norm = max(1.0, math.sqrt(len(tokens) + pos_emot + neg_emot + pos_emo + neg_emo))
    score = score / norm
    return math.tanh(score / 2.0)


def extract_emojis(text: str) -> list[str]:
    if not text:
        return []
    return EMOJI_RE.findall(text)


def extract_links(text: str) -> list[str]:
    if not text:
        return []
    return URL_RE.findall(text)
