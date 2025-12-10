from flask import Flask, jsonify, request, send_from_directory
import requests
import random
import html
import json
import os

app = Flask(__name__, static_folder="static", static_url_path="")

# -----------------------------------------------------
# VARIABLES GLOBALES
# -----------------------------------------------------
THEME_STATS = {}       # { "General Knowledge": {"correct": X, "total": Y}, ... }
QUESTION_NUMBER = 0
USER_SCORE = 0

LAST_CORRECT_ANSWER = None
LAST_CATEGORY = None
LAST_DIFFICULTY = None


# -----------------------------------------------------
# FRONTEND
# -----------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# -----------------------------------------------------
# FONCTION UTILITAIRE : Sauvegarde JSON
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
# RÉCUPÉRATION QUESTION OPEN TRIVIA
# -----------------------------------------------------
def fetch_trivia_question(category_id=None):
    base = "https://opentdb.com/api.php?amount=1&type=multiple"

    if category_id is not None:
        base += f"&category={category_id}"

    headers = {"User-Agent": "Mozilla/5.0"}
    resp = requests.get(base, headers=headers)

    if resp.status_code != 200:
        raise Exception("Erreur API OpenTriviaDB")

    data = resp.json()
    if data["response_code"] != 0:
        raise Exception("Aucune question valide renvoyée")

    q = data["results"][0]

    question = html.unescape(q.get("question", "Question indisponible"))
    correct = html.unescape(q.get("correct_answer", ""))
    incorrect = [html.unescape(a) for a in q.get("incorrect_answers", [])]

    answers = incorrect + [correct]
    random.shuffle(answers)

    category = html.unescape(q.get("category", "Inconnu"))
    difficulty = html.unescape(q.get("difficulty", "unknown"))

    return {
        "question": question,
        "correct": correct,
        "answers": answers,
        "category": category,
        "difficulty": difficulty
    }


# -----------------------------------------------------
# ROUTE : OBTENIR NOUVELLE QUESTION
# -----------------------------------------------------
@app.route("/api/question")
def get_question():
    global LAST_CORRECT_ANSWER, LAST_CATEGORY, LAST_DIFFICULTY
    global QUESTION_NUMBER

    QUESTION_NUMBER += 1

    category_param = request.args.get("category")
    category_id = int(category_param) if category_param else None

    q = fetch_trivia_question(category_id)

    LAST_CORRECT_ANSWER = q["correct"]
    LAST_CATEGORY = q["category"]
    LAST_DIFFICULTY = q["difficulty"]

    return jsonify({
        "id": QUESTION_NUMBER,
        "question": q["question"],
        "answers": q["answers"],
        "category": q["category"],
        "difficulty": q["difficulty"]
    })


# -----------------------------------------------------
# ROUTE : ENVOYER RÉPONSE UTILISATEUR
# -----------------------------------------------------
@app.route("/api/answer", methods=["POST"])
def answer():
    global LAST_CORRECT_ANSWER, USER_SCORE, THEME_STATS

    data = request.get_json()
    question_id = data.get("question_id")
    user_answer = data.get("answer")

    correct = (user_answer == LAST_CORRECT_ANSWER)

    if correct:
        USER_SCORE += 1

    theme = LAST_CATEGORY

    if theme not in THEME_STATS:
        THEME_STATS[theme] = {"correct": 0, "total": 0}

    THEME_STATS[theme]["total"] += 1
    if correct:
        THEME_STATS[theme]["correct"] += 1

    entry = {
        "question_id": question_id,
        "user_answer": user_answer,
        "correct_answer": LAST_CORRECT_ANSWER,
        "correct": correct,
        "score_after": USER_SCORE,
        "category": LAST_CATEGORY,
        "difficulty": LAST_DIFFICULTY
    }
    save_user_stat(entry)

    return jsonify({
        "status": "success" if correct else "fail",
        "correct": LAST_CORRECT_ANSWER,
        "score": USER_SCORE
    })


# -----------------------------------------------------
# ROUTE : STATISTIQUES PAR THÈME
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
# MAIN
# -----------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True)
