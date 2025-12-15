from flask import Flask, jsonify, request, redirect, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash
from flask_sqlalchemy import SQLAlchemy
from functools import wraps
from datetime import datetime
import requests
import html
import random
import hashlib

# =====================================================
# APP & DB CONFIG
# =====================================================
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = "change_this_secret_key"

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///trickia.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# =====================================================
# MODELS
# =====================================================
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class UserThemeStats(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    theme = db.Column(db.String(50), nullable=False)

    total_questions = db.Column(db.Integer, default=0)
    correct_answers = db.Column(db.Integer, default=0)
    best_streak = db.Column(db.Integer, default=0)
    last_played = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "theme", name="user_theme_unique"),
    )

class UserSeenQuestion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    question_hash = db.Column(db.String(64), nullable=False)
    source = db.Column(db.String(30))
    theme = db.Column(db.String(50))

    first_seen = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "question_hash", name="uq_user_question"),
    )

# =====================================================
# AUTH HELPERS
# =====================================================
def get_current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return User.query.get(uid)

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not get_current_user():
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return wrapper

# =====================================================
# HELPERS
# =====================================================
def compute_question_hash(question_text: str) -> str:
    # Normalize to reduce duplicates caused by case/whitespace differences
    normalized = " ".join((question_text or "").lower().strip().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

# =====================================================
# FRONT ROUTES
# =====================================================
@app.route("/")
def index():
    return redirect("/app") if get_current_user() else redirect("/login")

@app.route("/app")
def app_page():
    if not get_current_user():
        return redirect("/login")
    return render_template("index.html")

@app.route("/profile")
def profile():
    if not get_current_user():
        return redirect("/login")
    return render_template("profile.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        u = request.form.get("username")
        p = request.form.get("password")
        user = User.query.filter_by(username=u).first()
        if not user or not check_password_hash(user.password_hash, p):
            return "Invalid credentials", 401
        session["user_id"] = user.id
        return redirect("/app")
    return render_template("login.html")

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        u = request.form.get("username")
        p = request.form.get("password")
        if User.query.filter_by(username=u).first():
            return "Username already exists", 400
        user = User(username=u, password_hash=generate_password_hash(p))
        db.session.add(user)
        db.session.commit()
        session["user_id"] = user.id
        return redirect("/app")
    return render_template("register.html")

@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")

# =====================================================
# CATEGORY NORMALIZATION
# =====================================================
OPENTDB_ID_TO_NAME = {
    9: "General Knowledge", 10: "Books", 11: "Film", 12: "Music",
    14: "Television", 15: "Video Games", 17: "Science",
    18: "Computers", 19: "Mathematics", 20: "Mythology",
    21: "Sports", 22: "Geography", 23: "History", 24: "Politics"
}

def canonical_theme_from_opentdb_id(cid):
    name = OPENTDB_ID_TO_NAME.get(cid, "").lower()
    if "math" in name: return "Mathematics"
    if "science" in name: return "Science"
    if "history" in name or "politics" in name: return "History"
    if "music" in name: return "Music"
    if "film" in name or "television" in name: return "Television"
    if "mythology" in name: return "Mythology"
    if "sports" in name: return "Sports"
    if "geography" in name: return "Geography"
    return "General Knowledge"

# =====================================================
# TRIVIA FETCH
# =====================================================
def fetch_opentdb(category_id):
    url = "https://opentdb.com/api.php?amount=1&type=multiple"
    if category_id:
        url += f"&category={category_id}"

    r = requests.get(url, timeout=5)
    data = r.json()

    # 🔐 Validation stricte
    if "results" not in data or not data["results"]:
        raise ValueError("OpenTriviaDB returned no results")

    q = data["results"][0]

    question = html.unescape(q["question"])
    correct = html.unescape(q["correct_answer"])
    answers = [html.unescape(a) for a in q["incorrect_answers"]] + [correct]
    random.shuffle(answers)

    return question, correct, answers, q["difficulty"]

def fetch_triviaapi():
    q = requests.get(
        "https://the-trivia-api.com/v2/questions?limit=1",
        timeout=5
    ).json()[0]
    question = q["question"]["text"]
    correct = q["correctAnswer"]
    answers = q["incorrectAnswers"] + [correct]
    random.shuffle(answers)
    return question, correct, answers, q.get("difficulty", "unknown"), q.get("category", "")

# =====================================================
# SESSION START
# =====================================================
@login_required
@app.route("/api/session/start", methods=["POST"])
def start_session():
    session["quiz_state"] = {
        "question_number": 0,
        "score": 0,
        "used_questions": [],   # session-level memory (fast)
        "theme_stats": {},
        "best_streak": 0,
        "current_streak": 0,
        "start_time": datetime.utcnow(),
        "last": {}
    }
    return jsonify({"status": "ok"})

# =====================================================
# QUESTION (STEP 4: PERSISTENT ANTI-DUPLICATES)
# =====================================================

@login_required
@app.route("/api/question")
def question():
    user = get_current_user()
    state = session.get("quiz_state")

    if not state:
        return jsonify({"error": "Quiz not started"}), 400

    cid = request.args.get("category", type=int)
    requested_theme = canonical_theme_from_opentdb_id(cid)

    state.setdefault("used_hashes", [])
    chosen = None

    # --------------------------------------------------
    # SAFE FETCH WITH RETRIES
    # --------------------------------------------------
    for _ in range(6):
        try:
            source = random.choice(["OpenTriviaDB", "TheTriviaAPI"])
            theme = requested_theme

            if source == "OpenTriviaDB":
                q_text, c, a, d = fetch_opentdb(cid)
            else:
                q_text, c, a, d, raw = fetch_triviaapi()
                raw = (raw or "").lower()
                if "music" in raw:
                    theme = "Music"
                elif "history" in raw or "politics" in raw:
                    theme = "History"
                elif "film" in raw or "tv" in raw:
                    theme = "Television"
                elif "science" in raw:
                    theme = "Science"

            q_hash = compute_question_hash(q_text)

            # Session-level dedupe (ABSOLUTE)
            if q_hash in state["used_hashes"]:
                continue

            # Persistent dedupe
            if UserSeenQuestion.query.filter_by(
                user_id=user.id,
                question_hash=q_hash
            ).first():
                continue

            chosen = (q_text, c, a, d, theme, source, q_hash)
            break

        except Exception:
            continue

    # --------------------------------------------------
    # NO QUESTION FOUND → CLEAN EXIT (NO 500)
    # --------------------------------------------------
    if not chosen:
        return jsonify({
            "error": "No question available"
        }), 200

    q_text, c, a, d, theme, source, q_hash = chosen

    # --------------------------------------------------
    # PERSIST SEEN QUESTION
    # --------------------------------------------------
    db.session.add(UserSeenQuestion(
        user_id=user.id,
        question_hash=q_hash,
        source=source,
        theme=theme
    ))
    db.session.commit()

    state["used_hashes"].append(q_hash)
    state["question_number"] = state.get("question_number", 0) + 1

    state["last"] = {
        "correct": c,
        "theme": theme,
        "question": q_text,
        "source": source
    }

    session["quiz_state"] = state
    session.modified = True

    return jsonify({
        "id": state["question_number"],
        "question": q_text,
        "answers": a,
        "difficulty": d,
        "category": theme,
        "source": source
    })

    # Normal accepted question
    q_text, c, a, d, theme, source, h, session_key = chosen

    db.session.add(UserSeenQuestion(
        user_id=user.id,
        question_hash=h,
        source=source,
        theme=theme
    ))
    db.session.commit()

    state.setdefault("used_questions", [])
    state["used_questions"].append(session_key)
    state["question_number"] = state.get("question_number", 0) + 1

    # ✅ ALWAYS set last with a predictable schema
    state["last"] = {"correct": c, "theme": theme, "question": q_text, "source": source}

    # Ensure session writes nested dict changes
    session["quiz_state"] = state
    session.modified = True

    return jsonify({
        "id": state["question_number"],
        "question": q_text,
        "answers": a,
        "difficulty": d,
        "category": theme,
        "source": source
    })

# =====================================================
# ANSWER - FIXED (NO MORE KeyError)
# =====================================================
@login_required
@app.route("/api/answer", methods=["POST"])
def answer():
    state = session.get("quiz_state")
    if not state:
        return jsonify({"error": "Quiz not started"}), 400

    last = state.get("last") or {}
    if "correct" not in last or "theme" not in last:
        # This prevents crashing and tells the frontend what's wrong
        return jsonify({"error": "No active question to answer"}), 400

    data = request.get_json(silent=True) or {}
    user_answer = data.get("answer")

    correct = (user_answer == last["correct"])

    theme = last["theme"]
    state.setdefault("theme_stats", {})
    state["theme_stats"].setdefault(theme, {"total": 0, "correct": 0})
    state["theme_stats"][theme]["total"] += 1

    state.setdefault("score", 0)
    state.setdefault("current_streak", 0)
    state.setdefault("best_streak", 0)

    if correct:
        state["score"] += 1
        state["current_streak"] += 1
        state["best_streak"] = max(state["best_streak"], state["current_streak"])
        state["theme_stats"][theme]["correct"] += 1
    else:
        state["current_streak"] = 0

    session["quiz_state"] = state
    session.modified = True

    return jsonify({
        "status": "success" if correct else "fail",
        "correct": last["correct"],
        "score": state["score"]
    })

# =====================================================
# END SESSION (3B) + keep persistence of theme stats (3A)
# =====================================================
@app.route("/api/session/end", methods=["POST"])
@login_required
def end_session():
    user = get_current_user()
    data = request.json or {}

    theme_stats = data.get("theme_stats", {})
    best_streak_session = data.get("best_streak", 0)

    # 🔐 Sécurité : rien à enregistrer
    if not isinstance(theme_stats, dict) or not theme_stats:
        return jsonify({"status": "no_stats"}), 200

    for theme, stats in theme_stats.items():
        total = stats.get("total", 0)
        correct = stats.get("correct", 0)

        # 🚫 Ignore thèmes sans vraies questions
        if total <= 0:
            continue

        entry = UserThemeStats.query.filter_by(
            user_id=user.id,
            theme=theme
        ).first()

        if not entry:
            entry = UserThemeStats(
                user_id=user.id,
                theme=theme,
                total_questions=0,
                correct_answers=0,
                best_streak=0
            )
            db.session.add(entry)

        entry.total_questions += total
        entry.correct_answers += correct
        entry.best_streak = max(entry.best_streak, best_streak_session)
        entry.last_played = datetime.utcnow()

    db.session.commit()
    return jsonify({"status": "ok"})

# =====================================================
# STATS (SESSION)
# =====================================================
@login_required
@app.route("/api/stats")
def stats():
    state = session.get("quiz_state", {})
    result = []
    for theme, s in state.get("theme_stats", {}).items():
        pct = round(100 * s["correct"] / s["total"], 1) if s["total"] else 0
        result.append({
            "theme": theme,
            "correct": s["correct"],
            "total": s["total"],
            "percent": pct
        })
    return jsonify(result)

# =====================================================
# MAIN
# =====================================================

@app.route("/api/profile")
@login_required
def api_profile():
    user = get_current_user()

    stats = UserThemeStats.query.filter_by(user_id=user.id).all()

    total_questions = 0
    themes = []
    best_streak = 0

    for s in stats:
        total_questions += s.total_questions
        best_streak = max(best_streak, s.best_streak)

        percent = round(
            (s.correct_answers / s.total_questions) * 100, 1
        ) if s.total_questions > 0 else 0

        themes.append({
            "theme": s.theme,
            "total": s.total_questions,
            "correct": s.correct_answers,
            "percent": percent
        })

    return jsonify({
    "username": user.username,
    "total_questions": total_questions,
    "best_streak": best_streak,
    "themes": themes
})

with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True)