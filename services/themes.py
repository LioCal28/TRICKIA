# services/themes.py
"""
Central definition of Trickia themes.
This file is the single source of truth for all theme-related logic.

⚠️ IMPORTANT
- Keys = Trickia themes (used everywhere: quiz, stats, profile, badges)
- APIs are ONLY providers of questions
"""

TRICKIA_THEMES = {
    "Science": {
        "opentdb": [17, 19, 27],
        "triviaapi": ["science", "animals", "mathematics"]
    },
    "History": {
        "opentdb": [23, 24],
        "triviaapi": ["history", "politics"]
    },
    "Music": {
        "opentdb": [12],
        "triviaapi": ["music"]
    },
    "Movies & TV": {
        "opentdb": [11, 14, 32],
        "triviaapi": ["film", "tv", "anime", "cartoons"]
    },
    "Sports": {
        "opentdb": [21],
        "triviaapi": ["sports"]
    },
    "Geography": {
        "opentdb": [22],
        "triviaapi": ["geography"]
    },
    "Technology": {
        "opentdb": [15, 18, 28, 30],
        "triviaapi": ["technology", "video_games", "computers", "gadgets", "vehicles"]
    },
    "General Knowledge": {
        "opentdb": [9, 16, 26],
        "triviaapi": ["general", "food", "board_games", "celebrity"]
    },
    "Arts & Culture": {
        "opentdb": [10, 13, 20, 25, 29, 31],
        "triviaapi": ["art", "literature", "culture", "comics", "mythology"]
    }
}


# --------------------------------------------------
# SAFE HELPERS (ANTI-CASSE)
# --------------------------------------------------

def get_all_trickia_themes():
    """Return list of Trickia theme names."""
    return list(TRICKIA_THEMES.keys())


def is_valid_trickia_theme(theme: str) -> bool:
    return theme in TRICKIA_THEMES


def get_opentdb_categories(theme: str):
    """Return OpenTriviaDB category IDs for a theme, or empty list."""
    return TRICKIA_THEMES.get(theme, {}).get("opentdb", [])


def get_triviaapi_tags(theme: str):
    """Return TheTriviaAPI tags for a theme, or empty list."""
    return TRICKIA_THEMES.get(theme, {}).get("triviaapi", [])
