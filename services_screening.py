import functools
import math
from typing import List, Optional, Tuple

import phonetics
from fuzzywuzzy import fuzz
import Levenshtein


@functools.lru_cache(maxsize=2048)
def _cached_metaphone(s: str) -> str:
    try:
        return phonetics.metaphone(s) or ""
    except Exception:
        return ""


@functools.lru_cache(maxsize=2048)
def _cached_soundex(s: str) -> str:
    try:
        return phonetics.soundex(s) or ""
    except Exception:
        return ""


def levenshtein_similarity(s1: str, s2: str) -> float:
    return Levenshtein.ratio(s1.lower(), s2.lower())


def fuzzy_similarity(s1: str, s2: str) -> float:
    return fuzz.ratio(s1.lower(), s2.lower()) / 100.0


def phonetic_similarity(s1: str, s2: str) -> float:
    try:
        code1 = _cached_metaphone(s1)
        code2 = _cached_metaphone(s2)
        if not code1 or not code2:
            return 0.0
        if code1 == code2:
            return 1.0
        return Levenshtein.ratio(code1, code2)
    except Exception:
        return 0.0


def soundalike_score(s1: str, s2: str) -> float:
    try:
        sx1 = _cached_soundex(s1)
        sx2 = _cached_soundex(s2)
        if sx1 and sx2 and sx1 == sx2:
            return 1.0
        phon = phonetic_similarity(s1, s2)
        if sx1 and sx2:
            return max(phon, Levenshtein.ratio(sx1, sx2))
        return phon
    except Exception:
        return phonetic_similarity(s1, s2)


# Visual character shape substitution mapping for pharmaceutical Look-Alike (LASA) detection
_VISUAL_SHAPE_MAP = str.maketrans({
    '0': 'o', 'O': 'o', 'c': 'o', 'e': 'o', 'a': 'o', 'Q': 'o',
    '1': 'l', 'I': 'l', 'i': 'l', 'j': 'l', 't': 'l', '|': 'l',
    'u': 'v', 'U': 'v', 'w': 'v', 'W': 'v', 'y': 'v', 'Y': 'v',
    'm': 'n', 'M': 'n', 'r': 'n', 'h': 'n', 'H': 'n',
    'p': 'b', 'P': 'b', 'q': 'b', 'd': 'b', 'D': 'b', 'g': 'b', 'B': 'b',
    'k': 'x', 'K': 'x', 'z': 's', 'Z': 's',
})


def _trigrams(s: str) -> set:
    padded = f"^{s.lower().strip()}$"
    return {padded[i:i+3] for i in range(len(padded) - 2)} if len(padded) >= 3 else {padded}


def lookalike_score(s1: str, s2: str) -> float:
    """Calculates pharmaceutical Look-Alike (Visual) similarity based on:
    1. Optical character shape similarity (visual glyph confusion matrix)
    2. Character trigram Dice coefficient
    """
    w1, w2 = s1.lower().strip(), s2.lower().strip()
    if not w1 or not w2:
        return 0.0
    if w1 == w2:
        return 1.0

    # 1. Trigram visual overlap
    t1, t2 = _trigrams(w1), _trigrams(w2)
    intersection = len(t1 & t2)
    dice_trigram = (2.0 * intersection) / (len(t1) + len(t2)) if (len(t1) + len(t2)) > 0 else 0.0

    # 2. Visual shape mapped distance (normalizes confusable glyphs like l/1/i, o/0/c, rn/m)
    v1 = w1.replace("rn", "n").replace("cl", "b").replace("vv", "v").translate(_VISUAL_SHAPE_MAP)
    v2 = w2.replace("rn", "n").replace("cl", "b").replace("vv", "v").translate(_VISUAL_SHAPE_MAP)
    shape_ratio = Levenshtein.ratio(v1, v2)

    return round(shape_ratio * 0.60 + dice_trigram * 0.40, 3)


def prefix_similarity(s1: str, s2: str) -> float:
    """Evaluates pharmaceutical prefix similarity (first 3-4 characters + phonetic prefix)."""
    w1, w2 = s1.lower().strip(), s2.lower().strip()
    if not w1 or not w2:
        return 0.0
    p1, p2 = w1[:min(4, len(w1))], w2[:min(4, len(w2))]
    lev_p = Levenshtein.ratio(p1, p2)
    m1, m2 = _cached_metaphone(p1), _cached_metaphone(p2)
    phon_p = Levenshtein.jaro_winkler(m1, m2) if (m1 and m2) else 0.0
    if m1 and m2 and m1 == m2:
        phon_p = 1.0
    return max(lev_p, phon_p)


def suffix_similarity(s1: str, s2: str) -> float:
    """Evaluates pharmaceutical suffix similarity (last 3-4 characters + phonetic suffix)."""
    w1, w2 = s1.lower().strip(), s2.lower().strip()
    if not w1 or not w2:
        return 0.0
    suf1, suf2 = w1[-min(4, len(w1)):], w2[-min(4, len(w2)):]
    lev_s = Levenshtein.ratio(suf1, suf2)
    m1, m2 = _cached_metaphone(suf1), _cached_metaphone(suf2)
    phon_s = Levenshtein.jaro_winkler(m1, m2) if (m1 and m2) else 0.0
    if m1 and m2 and m1 == m2:
        phon_s = 1.0
    return max(lev_s, phon_s)


def prefix_suffix_collision_score(s1: str, s2: str) -> float:
    """Computes combined prefix and suffix pharmaceutical Look-Alike / Sound-Alike (LASA) collision score."""
    lev = levenshtein_similarity(s1, s2)
    if lev < 0.50:
        return lev * 0.5
    
    l1, l2 = len(s1.strip()), len(s2.strip())
    len_ratio = min(l1, l2) / max(l1, l2) if max(l1, l2) > 0 else 1.0
    if len_ratio < 0.60:
        return lev * 0.6

    p_sim = prefix_similarity(s1, s2)
    s_sim = suffix_similarity(s1, s2)
    if p_sim >= 0.85 and s_sim >= 0.60 and lev >= 0.60:
        return max(p_sim * 0.6 + s_sim * 0.4, 0.85)
    return p_sim * 0.5 + s_sim * 0.5


def composite_similarity(s1: str, s2: str) -> float:
    """Blended spelling, phonetic, prefix, and suffix similarity used to rank conflict candidates."""
    lev = levenshtein_similarity(s1, s2)
    fuz = fuzzy_similarity(s1, s2)
    phon = phonetic_similarity(s1, s2)
    ps_score = prefix_suffix_collision_score(s1, s2)
    base = lev * 0.30 + fuz * 0.30 + phon * 0.25 + ps_score * 0.15
    if (ps_score >= 0.85 and phon >= 0.70) or phon >= 0.90:
        return max(base, max(phon, ps_score))
    return base


PHONETIC_TYPE_THRESHOLD = 0.45
SPELLING_TYPE_THRESHOLD = 0.45
LOOKALIKE_TYPE_THRESHOLD = 0.45
SEMANTIC_TYPE_THRESHOLD = 0.45


def classify_similarity_types(
    lev: float, fuz: float, phon: float, look: float,
    semantic: Optional[float] = None,
) -> List[str]:
    types: List[str] = []
    if phon >= PHONETIC_TYPE_THRESHOLD:
        types.append("Phonetic")
    if max(lev, fuz) >= SPELLING_TYPE_THRESHOLD:
        types.append("Spelling")
    if look >= LOOKALIKE_TYPE_THRESHOLD:
        types.append("Visual")
    if semantic is not None and semantic >= SEMANTIC_TYPE_THRESHOLD:
        types.append("Conceptual")
    return types


def classify_similarity_type(s1: str, s2: str) -> str:
    lev = levenshtein_similarity(s1, s2)
    fuz = fuzzy_similarity(s1, s2)
    phon = phonetic_similarity(s1, s2)
    look = lookalike_score(s1, s2)
    types = classify_similarity_types(lev, fuz, phon, look)
    return types[0] if types else "Spelling"


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_a * norm_b)))


def safe_phonetic_code(name: str) -> str:
    try:
        return phonetics.metaphone(name)
    except Exception:
        return name.upper()


def validate_linguistic_structure(name: str) -> Tuple[bool, Optional[str]]:
    """Validates whether a brand name meets basic pharmaceutical nomenclature
    and phonotactic pronounceability rules (FDA PDUFA / CDSCO guidelines).

    Rejects:
    1. Zero vowels / semi-vowels (e.g. 'hjkjhjkj', 'bcdfgh', 'qwrtyp')
    2. Severe consonant clusters (>= 5 consecutive consonants without a vowel or 'y')
    3. Repeating character spam (e.g. 'aaaaaa', 'zzzzzz', 'dddddd')
    4. Extremely short strings (< 3 letters)

    Returns:
        (is_valid: bool, rejection_reason: Optional[str])
    """
    import re
    clean = re.sub(r"[^a-zA-Z]", "", name.strip()).lower()
    if len(clean) < 3:
        return False, f"'{name}' is too short (< 3 characters) to form a valid pharmaceutical brand name."

    vowels = set("aeiouy")
    vowel_count = sum(1 for ch in clean if ch in vowels)

    # 1. Total lack of vowels/semi-vowels
    if vowel_count == 0:
        return False, f"'{name}' contains zero vowels or semi-vowels, making it unpronounceable and invalid under FDA/CDSCO guidelines."

    # 2. Vowel density check (e.g. 1 vowel in 9 consonants is below 15%)
    density = vowel_count / len(clean)
    if density < 0.15 and len(clean) >= 6:
        return False, f"'{name}' has an extremely low vowel density ({int(density*100)}%), violating standard phonetic pronounceability rules."

    # 3. Consecutive consonants cluster check (>= 5 consecutive consonants)
    consonant_cluster = 0
    max_consonants = 0
    for ch in clean:
        if ch not in vowels:
            consonant_cluster += 1
            max_consonants = max(max_consonants, consonant_cluster)
        else:
            consonant_cluster = 0

    if max_consonants >= 5:
        return False, f"'{name}' contains a cluster of {max_consonants} consecutive consonants, making it unpronounceable in clinical practice."

    # 4. Monotonous repeating character spam (>= 4 same character in a row e.g. 'aaaa')
    if re.search(r"(.)\1{3,}", clean):
        return False, f"'{name}' contains repeated identical characters, violating brand distinctiveness guidelines."

    return True, None


def calculate_mentor_risk_score(
    phonetic_score: float,
    spelling_score: float,
    visual_score: float,
    conceptual_score: float,
    is_exact_match: bool = False,
    is_who_inn_knockout: bool = False,
) -> Tuple[float, str, str]:
    """Calculates risk using Mentor's 4-Parameter Balanced Formula:
    Risk = (Phonetic * 0.30) + (Spelling * 0.30) + (Visual * 0.20) + (Conceptual * 0.20)

    Hard Knockout Overrides:
    - Exact match or WHO INN knockout -> 100.0 (HIGH / REJECT)
    - Extreme single-dimension hazard (Phonetic >= 0.90 or Spelling >= 0.90) -> max(85.0, Phonetic * 100) (HIGH / REJECT)

    Returns:
        (overall_risk_score, risk_classification, ai_recommendation)
    """
    if is_exact_match or is_who_inn_knockout:
        return 100.0, "HIGH", "REJECT"

    if phonetic_score >= 0.90 or spelling_score >= 0.90:
        score = round(max(85.0, phonetic_score * 100.0), 1)
        return score, "HIGH", "REJECT"

    raw_score = (
        (phonetic_score * 0.30) +
        (spelling_score * 0.30) +
        (visual_score * 0.20) +
        (conceptual_score * 0.20)
    ) * 100.0

    overall_score = round(min(max(raw_score, 0.0), 100.0), 1)

    if overall_score >= 65.0:
        return overall_score, "HIGH", "REJECT"
    elif overall_score >= 30.0:
        return overall_score, "MEDIUM", "LEGAL_REVIEW"
    else:
        return overall_score, "LOW", "PROCEED"
