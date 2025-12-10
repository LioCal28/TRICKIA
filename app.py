from flask import Flask, jsonify, request, send_from_directory
import requests
import random
import html
import json
import os

app = Flask(__name__, static_folder="static", static_url_path="")

# -----------------------------------------------------
# GLOBAL STATE
# -----------------------------------------------------
THEME_STATS = {}       # { "Science": {"correct": X, "total": Y}, ... }
QUESTION_NUMBER = 0
USER_SCORE = 0

LAST_CORRECT_ANSWER = None
LAST_CATEGORY = None     # Canonical theme (e.g. "Science", "Video Games")
LAST_DIFFICULTY = None
LAST_SOURCE = None       # "OpenTriviaDB" or "TheTriviaAPI"

USED_QUESTIONS = set()   # Set of (source, question_text) for current session

API_DISABLED = {
    "OpenTriviaDB": False,
    "TheTriviaAPI": False,
}

API_STATS = {
    "OpenTriviaDB": {"correct": 0, "total": 0},
    "TheTriviaAPI": {"correct": 0, "total": 0},
}

PRIMARY_SOURCE_RATIO = 0.7  # 70% The Trivia API, 30% OpenTriviaDB


# OpenTrivia category IDs (static mapping)
OPENTDB_ID_TO_NAME = {
    9: "General Knowledge",
    10: "Entertainment: Books",
    11: "Entertainment: Film",
    12: "Entertainment: Music",
    13: "Entertainment: Musicals & Theatres",
    14: "Entertainment: Television",
    15: "Entertainment: Video Games",
    16: "Entertainment: Board Games",
    17: "Science & Nature",
    18: "Science: Computers",
    19: "Science: Mathematics",
    20: "Mythology",
    21: "Sports",
    22: "Geography",
    23: "History",
    24: "Politics",
    25: "Art",
    26: "Celebrities",
    27: "Animals",
    28: "Vehicles",
    29: "Entertainment: Comics",
    30: "Science: Gadgets",
    31: "Entertainment: Japanese Anime & Manga",
    32: "Entertainment: Cartoon & Animations",
}


# -----------------------------------------------------
# FRONTEND
# -----------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# -----------------------------------------------------
# UTIL : SAVE USER STATS TO JSON
# -----------------------------------------------------
def save_user_stat(entry):
    file_path = "data/user_stats.json"

    if not os.path.exists("data"):
        os.makedirs("data")

    if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
        data = []
    else:
        try:
            with open(file_path, "r") as f:
                data = json.load(f)
                if not isinstance(data, list):
                    data = []
        except Exception:
            data = []

    data.append(entry)

    with open(file_path, "w") as f:
        json.dump(data, f, indent=4)


# -----------------------------------------------------
# CATEGORY NORMALIZATION
# -----------------------------------------------------
def canonical_theme_from_opentdb_id(cat_id):
    """Map OpenTriviaDB category ID to a canonical theme name (clean, no 'Entertainment:' prefix)."""
    if cat_id is None:
        return "General Knowledge"

    name = OPENTDB_ID_TO_NAME.get(cat_id, "General Knowledge")
    n = name.lower()

    # Science group (excluding Mathematics)
    if "science" in n and "mathematics" not in n:
        return "Science"

    # Mathematics kept separate
    if "mathematics" in n:
        return "Mathematics"

    # Animals considered part of Science
    if name == "Animals":
        return "Science"

    # Simple mappings
    if name == "General Knowledge":
        return "General Knowledge"

    if name == "Sports":
        return "Sports"

    if "geography" in n:
        return "Geography"

    if "history" in n:
        return "History"

    # Music (remove 'Entertainment:' prefix)
    if "music" in n:
        return "Music"

    # Films / TV -> Television bucket
    if "television" in n or "film" in n or "movie" in n:
        return "Television"

    # Video games
    if "video games" in n:
        return "Video Games"

    # Art -> Society & Culture
    if name == "Art":
        return "Society & Culture"

    # Vehicles kept separate
    if "vehicles" in n:
        return "Vehicles"

    # Politics / Mythology / Celebrities -> Society & Culture
    if "politics" in n or "mythology" in n or "celebrities" in n:
        return "Society & Culture"

    # Various entertainment buckets grouped as generic Entertainment
    if any(k in n for k in ["comics", "anime", "cartoon", "musicals", "theatres", "books", "board games", "japanese"]):
        return "Entertainment"

    # Default: remove 'Entertainment:' prefix if still present
    if name.startswith("Entertainment:"):
        return name.split(":", 1)[1].strip()

    return name


def trivia_slug_for_theme(canonical_theme: str | None):
    """Map canonical theme to The Trivia API category slug."""
    if not canonical_theme:
        return None
    t = canonical_theme.lower()

    if "general knowledge" in t:
        return "general_knowledge"
    if "science" in t:
        return "science"
    if "mathematics" in t:
        # The Trivia API may not have dedicated math, use science
        return "science"
    if "geography" in t:
        return "geography"
    if "history" in t:
        return "history"
    if "food" in t:
        return "food_and_drink"
    if "society" in t or "culture" in t:
        return "society_and_culture"
    if "music" in t:
        return "music"
    if "sport" in t:
        return "sport_and_leisure"
    if "video games" in t or "television" in t or "entertainment" in t:
        # Approximation: use film & TV when targeting entertainment/gaming
        return "film_and_tv"

    return None  # fallback: no category filter


# -----------------------------------------------------
# OPEN TRIVIA DB FETCH
# -----------------------------------------------------
def fetch_trivia_question(category_id=None):
    base = "https://opentdb.com/api.php?amount=1&type=multiple"

    if category_id is not None:
        base += f"&category={category_id}"

    headers = {"User-Agent": "Mozilla/5.0"}
    resp = requests.get(base, headers=headers, timeout=5)

    if resp.status_code != 200:
        raise Exception("Erreur API OpenTriviaDB")

    data = resp.json()
    if data.get("response_code") != 0:
        raise Exception("Aucune question valide renvoyée (OpenTriviaDB)")

    q = data["results"][0]

    question = html.unescape(q.get("question", "Question indisponible"))
    correct = html.unescape(q.get("correct_answer", ""))
    incorrect = [html.unescape(a) for a in q.get("incorrect_answers", [])]

    answers = incorrect + [correct]
    random.shuffle(answers)

    difficulty = html.unescape(q.get("difficulty", "unknown"))

    return {
        "question": question,
        "correct": correct,
        "answers": answers,
        "difficulty": difficulty
    }


# -----------------------------------------------------
# THE TRIVIA API FETCH
# -----------------------------------------------------
def fetch_triviaapi_question(canonical_theme: str | None = None):
    base = "https://the-trivia-api.com/v2/questions?limit=1"
    headers = {"User-Agent": "Mozilla/5.0"}

    slug = trivia_slug_for_theme(canonical_theme)
    if slug:
        url = f"{base}&categories={slug}"
    else:
        url = base

    resp = requests.get(url, headers=headers, timeout=5)
    if resp.status_code != 200:
        raise Exception("Erreur API The Trivia API")

    data = resp.json()
    if not isinstance(data, list) or not data:
        raise Exception("Aucune question valide renvoyée (The Trivia API)")

    q = data[0]

    question_raw = q.get("question", {})
    if isinstance(question_raw, dict):
        question = question_raw.get("text", "Question unavailable")
    else:
        question = str(question_raw or "Question unavailable")

    correct = q.get("correctAnswer", "")
    incorrect = q.get("incorrectAnswers", [])
    if not isinstance(incorrect, list):
        incorrect = []

    answers = incorrect + [correct]
    random.shuffle(answers)

    difficulty = q.get("difficulty", "unknown")
    return {
        "question": question,
        "correct": correct,
        "answers": answers,
        "difficulty": difficulty
    }


# -----------------------------------------------------
# SOURCE SELECTION & RETRIES
# -----------------------------------------------------
def choose_source():
    """Choose a trivia source based on weights and disabled flags."""
    enabled_sources = [s for s, disabled in API_DISABLED.items() if not disabled]
    if not enabled_sources:
        raise Exception("No trivia source available")

    if len(enabled_sources) == 1:
        return enabled_sources[0]

    # Both enabled: 70% The Trivia API, 30% OpenTriviaDB
    r = random.random()
    return "TheTriviaAPI" if r < PRIMARY_SOURCE_RATIO else "OpenTriviaDB"


def fetch_from_source(source, category_id, canonical_theme):
    """Try up to 3 times for the chosen source."""
    last_error = None
    for _ in range(3):
        try:
            if source == "OpenTriviaDB":
                return fetch_trivia_question(category_id)
            else:
                return fetch_triviaapi_question(canonical_theme)
        except Exception as e:
            last_error = e
    raise last_error or Exception(f"Failed to fetch from {source}")


def fetch_question_any_source(category_id, canonical_theme):
    """Choose a source (70/30), try it; fallback to other if completely failing."""
    last_error = None
    tried = set()

    for _ in range(2):  # at most two different sources
        source = choose_source()
        if source in tried:
            # avoid infinite loop
            break
        tried.add(source)

        try:
            q = fetch_from_source(source, category_id, canonical_theme)
            return q, source
        except Exception as e:
            # Disable this source for the rest of the session
            API_DISABLED[source] = True
            last_error = e

    raise last_error or Exception("No trivia API could provide a question")


# -----------------------------------------------------
# ROUTE : START NEW SESSION
# -----------------------------------------------------
@app.route("/api/session/start", methods=["POST"])
def start_session():
    """
    Called from frontend at the beginning of a new quiz session.
    Resets session-level and stats state.
    """
    global QUESTION_NUMBER, USER_SCORE, USED_QUESTIONS, API_DISABLED, THEME_STATS, API_STATS

    QUESTION_NUMBER = 0
    USER_SCORE = 0
    USED_QUESTIONS = set()
    API_DISABLED = {
        "OpenTriviaDB": False,
        "TheTriviaAPI": False,
    }

    # Reset theme and API performance stats for this new quiz
    THEME_STATS = {}
    API_STATS = {
        "OpenTriviaDB": {"correct": 0, "total": 0},
        "TheTriviaAPI": {"correct": 0, "total": 0},
    }

    return jsonify({"status": "ok"})


# -----------------------------------------------------
# ROUTE : GET NEW QUESTION
# -----------------------------------------------------
@app.route("/api/question")
def get_question():
    global LAST_CORRECT_ANSWER, LAST_CATEGORY, LAST_DIFFICULTY, LAST_SOURCE, QUESTION_NUMBER, USED_QUESTIONS

    category_param = request.args.get("category")
    category_id = int(category_param) if category_param else None

    canonical_theme = canonical_theme_from_opentdb_id(category_id)

    QUESTION_NUMBER += 1

    q = None
    source = None

    # Avoid duplicates for the current quiz session
    for _ in range(5):
        q_data, src = fetch_question_any_source(category_id, canonical_theme)
        key = (src, q_data["question"])
        if key not in USED_QUESTIONS:
            USED_QUESTIONS.add(key)
            q = q_data
            source = src
            break

    # If we couldn't avoid duplicates, just use the last fetched question
    if q is None or source is None:
        q, source = fetch_question_any_source(category_id, canonical_theme)

    LAST_CORRECT_ANSWER = q["correct"]
    LAST_CATEGORY = canonical_theme
    LAST_DIFFICULTY = q["difficulty"]
    LAST_SOURCE = source

    return jsonify({
        "id": QUESTION_NUMBER,
        "question": q["question"],
        "answers": q["answers"],
        "category": canonical_theme,
        "difficulty": q["difficulty"],
        "source": source
    })


# -----------------------------------------------------
# ROUTE : ANSWER
# -----------------------------------------------------
@app.route("/api/answer", methods=["POST"])
def answer():
    global LAST_CORRECT_ANSWER, USER_SCORE, THEME_STATS, LAST_CATEGORY, LAST_DIFFICULTY, LAST_SOURCE, API_STATS

    data = request.get_json()
    question_id = data.get("question_id")
    user_answer = data.get("answer")

    correct = (user_answer == LAST_CORRECT_ANSWER)

    if correct:
        USER_SCORE += 1

    theme = LAST_CATEGORY or "General Knowledge"

    if theme not in THEME_STATS:
        THEME_STATS[theme] = {"correct": 0, "total": 0}

    THEME_STATS[theme]["total"] += 1
    if correct:
        THEME_STATS[theme]["correct"] += 1

    # Update API source stats
    source = LAST_SOURCE or "Unknown"
    if source not in API_STATS:
        API_STATS[source] = {"correct": 0, "total": 0}
    API_STATS[source]["total"] += 1
    if correct:
        API_STATS[source]["correct"] += 1

    entry = {
        "question_id": question_id,
        "user_answer": user_answer,
        "correct_answer": LAST_CORRECT_ANSWER,
        "correct": correct,
        "score_after": USER_SCORE,
        "category": theme,
        "difficulty": LAST_DIFFICULTY,
        "source": source
    }
    save_user_stat(entry)

    return jsonify({
        "status": "success" if correct else "fail",
        "correct": LAST_CORRECT_ANSWER,
        "score": USER_SCORE,
        "source": source
    })


# -----------------------------------------------------
# ROUTE : THEME STATS
# -----------------------------------------------------
@app.route("/api/stats")
def get_stats():
    stats_out = []

    for theme, data in THEME_STATS.items():
        if data["total"] > 0:
            percent = round(100 * data["correct"] / data["total"], 1)
        else:
            percent = 0.0

        stats_out.append({
            "theme": theme,
            "correct": data["correct"],
            "total": data["total"],
            "percent": percent
        })

    return jsonify(stats_out)


# -----------------------------------------------------
# ROUTE : API SOURCE STATS
# -----------------------------------------------------
@app.route("/api/api_stats")
def get_api_stats():
    out = []
    for src, data in API_STATS.items():
        total = data["total"]
        percent = round(100 * data["correct"] / total, 1) if total > 0 else 0.0
        out.append({
            "source": src,
            "correct": data["correct"],
            "total": total,
            "percent": percent
        })
    return jsonify(out)


# -----------------------------------------------------
# MAIN
# -----------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True)