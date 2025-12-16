from flask import Flask, jsonify, request, redirect, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash
from flask_sqlalchemy import SQLAlchemy
from functools import wraps
from datetime import datetime
from services.themes import get_all_trickia_themes, is_valid_trickia_theme, get_opentdb_categories, get_triviaapi_tags
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

class UserAchievement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    label = db.Column(db.String(100), nullable=False)
    count = db.Column(db.Integer, default=1)
    unlocked_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "label", name="uq_user_achievement"),
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

def fetch_triviaapi(tags=None):
    url = "https://the-trivia-api.com/v2/questions?limit=1"

    if tags:
        # ex: categories=science,history
        joined = ",".join(tags)
        url += f"&categories={joined}"

    q = requests.get(url, timeout=5).json()[0]

    question = q["question"]["text"]
    correct = q["correctAnswer"]
    answers = q["incorrectAnswers"] + [correct]
    random.shuffle(answers)

    return (
        question,
        correct,
        answers,
        q.get("difficulty", "unknown"),
        q.get("category", "")
    )

# =====================================================
# SESSION START
# =====================================================
@login_required
@app.route("/api/session/start", methods=["POST"])
def start_session():
    data = request.get_json(silent=True) or {}

    # ✅ thèmes choisis par l'utilisateur (Trickia themes)
    selected = data.get("themes")

    # Fallback : si rien reçu → tous les thèmes Trickia
    if not selected:
        selected = get_all_trickia_themes()

    # Nettoyage de sécurité : garder uniquement des thèmes Trickia valides
    selected = [t for t in selected if is_valid_trickia_theme(t)]

    # Fallback ultime : si tout a été filtré
    if not selected:
        selected = get_all_trickia_themes()

    session["quiz_state"] = {
        "question_number": 0,
        "score": 0,
        "used_questions": [],   # session-level memory (fast)
        "theme_stats": {},
        "best_streak": 0,
        "current_streak": 0,
        "start_time": datetime.utcnow(),
        "last": {},

        # ✅ NEW: thèmes autorisés pour cette session
        "allowed_themes": selected,

        # 📊 API STATS (SESSION-BASED)
        "api_stats": {
            "OpenTriviaDB": {"total": 0, "correct": 0},
            "TheTriviaAPI": {"total": 0, "correct": 0}
        }
    }

    session.modified = True
    return jsonify({"status": "ok", "allowed_themes": selected})

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

    allowed = state.get("allowed_themes") or get_all_trickia_themes()

    chosen = None

    # --------------------------------------------------
    # SAFE FETCH WITH TRICKIA THEMES + DEDUPE
    # --------------------------------------------------
    for _ in range(6):
        try:
            # 🎯 1. Choose Trickia theme
            theme = random.choice(allowed)

            opentdb_cats = get_opentdb_categories(theme)
            trivia_tags = get_triviaapi_tags(theme)

            # 🎯 2. Choose source (MIXED APIs - SAFE)
            use_triviaapi = bool(trivia_tags) and random.random() < 0.3

            if opentdb_cats and not use_triviaapi:
                cid = random.choice(opentdb_cats)
                q_text, c, a, d = fetch_opentdb(cid)
                source = "OpenTriviaDB"

            elif trivia_tags:
                q_text, c, a, d, _ = fetch_triviaapi(trivia_tags)
                source = "TheTriviaAPI"

            else:
                continue

            # 🎯 3. Hash & dedupe
            q_hash = compute_question_hash(q_text)

            state.setdefault("used_hashes", [])

            if q_hash in state["used_hashes"]:
                continue

            if UserSeenQuestion.query.filter_by(
                user_id=user.id,
                question_hash=q_hash
            ).first():
                continue

            chosen = (q_text, c, a, d, theme, source, q_hash)
            break

        except Exception:
            continue

    if not chosen:
        return jsonify({"error": "No question available"}), 200

    q_text, c, a, d, theme, source, q_hash = chosen

    # --------------------------------------------------
    # Persist question
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
        "question": q_text,
        "correct": c,
        "answers": a,
        "difficulty": d,
        "theme": theme,   # ✅ Trickia theme ONLY
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
    if "correct" not in last or "theme" not in last or "source" not in last:
        return jsonify({"error": "No active question to answer"}), 400

    data = request.get_json(silent=True) or {}
    user_answer = data.get("answer")

    is_correct = (user_answer == last["correct"])

    # -----------------------------
    # THEME STATS (SESSION)
    # -----------------------------
    theme = last["theme"]
    state.setdefault("theme_stats", {})
    state["theme_stats"].setdefault(theme, {"total": 0, "correct": 0})
    state["theme_stats"][theme]["total"] += 1

    # -----------------------------
    # SCORE & STREAK
    # -----------------------------
    state.setdefault("score", 0)
    state.setdefault("current_streak", 0)
    state.setdefault("best_streak", 0)

    if is_correct:
        state["score"] += 1
        state["current_streak"] += 1
        state["best_streak"] = max(
            state["best_streak"],
            state["current_streak"]
        )
        state["theme_stats"][theme]["correct"] += 1
    else:
        state["current_streak"] = 0

    # -----------------------------
    # 📊 API STATS (SESSION)
    # -----------------------------
    state.setdefault("api_stats", {})
    source = last.get("source")

    if source:
        state["api_stats"].setdefault(
            source,
            {"total": 0, "correct": 0}
        )
        state["api_stats"][source]["total"] += 1
        if is_correct:
            state["api_stats"][source]["correct"] += 1

    # -----------------------------
    # SAVE SESSION
    # -----------------------------
    session["quiz_state"] = state
    session.modified = True

    return jsonify({
        "status": "success" if is_correct else "fail",
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

            # 📊 Update stats
            entry.total_questions += total
            entry.correct_answers += correct
            entry.best_streak = max(entry.best_streak, best_streak_session)
            entry.last_played = datetime.utcnow()

            # 🏆 ACHIEVEMENT: Expert in <theme> (SESSION-BASED ONLY)
            accuracy = correct / total if total > 0 else 0

            # 🎯 Conditions strictes
            if total >= 2 and accuracy >= 0.85:
                label = f"Expert in {theme}!"

                achievement = UserAchievement.query.filter_by(
                    user_id=user.id,
                    label=label
                ).first()

                if achievement:
                    # ➕ Badge déjà existant → on incrémente
                    achievement.count += 1
                else:
                    # 🆕 Nouveau badge réellement gagné
                    db.session.add(
                        UserAchievement(
                            user_id=user.id,
                            label=label,
                            count=1
                        )
                    )

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
# API STATS (SESSION-BASED)
# =====================================================
@login_required
@app.route("/api/api_stats")
def api_stats():
    state = session.get("quiz_state", {})
    api_stats = state.get("api_stats", {})

    result = []
    for source, s in api_stats.items():
        total = s.get("total", 0)
        correct = s.get("correct", 0)
        percent = round((correct / total) * 100, 1) if total > 0 else 0

        result.append({
            "source": source,
            "total": total,
            "correct": correct,
            "percent": percent
        })

    return jsonify(result)

# =====================================================
# MAIN
# =====================================================

@app.route("/api/profile")
@login_required
def api_profile():
    user = get_current_user()

    # --- THEME STATS ---
    theme_entries = UserThemeStats.query.filter_by(user_id=user.id).all()

    themes = []
    total_questions = 0
    best_streak_global = 0

    for entry in theme_entries:
        total = entry.total_questions
        correct = entry.correct_answers
        percent = round((correct / total) * 100, 1) if total > 0 else 0

        themes.append({
            "theme": entry.theme,
            "total": total,
            "correct": correct,
            "percent": percent
        })

        total_questions += total
        best_streak_global = max(best_streak_global, entry.best_streak)

    # --- ACHIEVEMENTS ---
    achievements = UserAchievement.query.filter_by(user_id=user.id).all()

    return jsonify({
    "username": user.username,
    "total_questions": total_questions,
    "best_streak": best_streak_global,
    "themes": themes,
    "achievements": [
        {
            "label": a.label,
            "count": a.count,
            "unlocked_at": a.unlocked_at.isoformat()
        } for a in achievements
    ]
})

@app.route("/api/themes")
@login_required
def get_themes():
    return jsonify(get_all_trickia_themes())

with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True)