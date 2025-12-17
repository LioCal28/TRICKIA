import random
from datetime import datetime

def beta_mean(alpha: float, beta: float) -> float:
    denom = alpha + beta
    return (alpha / denom) if denom > 0 else 0.5

def ensure_bandit_state(db, ModelState, user_id: int, theme: str):
    row = ModelState.query.filter_by(user_id=user_id, theme=theme).first()
    if row:
        return row
    row = ModelState(user_id=user_id, theme=theme, alpha=1.0, beta=1.0)
    db.session.add(row)
    db.session.commit()
    return row

def update_bandit_for_session(db, ModelState, ModelSnap, user_id: int, theme_stats: dict, discount: float, step: int):
    """
    theme_stats: {theme: {"total": int, "correct": int}}
    discount: 0.0..1.0 (ex: 0.85) => plus petit = plus de récence
    step: numéro de session (pour snapshots)
    """
    for theme, s in theme_stats.items():
        total = int(s.get("total", 0))
        correct = int(s.get("correct", 0))
        if total <= 0:
            continue
        wrong = total - correct

        state = ensure_bandit_state(db, ModelState, user_id, theme)

        # Récence par discount exponentiel (simple et efficace)
        state.alpha = discount * state.alpha + correct
        state.beta  = discount * state.beta  + wrong
        state.updated_at = datetime.utcnow()

        mean = beta_mean(state.alpha, state.beta)

        db.session.add(ModelSnap(
            user_id=user_id,
            theme=theme,
            step=step,
            mean=mean,
            alpha=state.alpha,
            beta=state.beta
        ))

    db.session.commit()

def make_relative_buckets(themes, theme_to_score):
    """
    themes: list[str]
    theme_to_score: dict[str] -> float (0..1)
    retourne: (weak, mid, strong)
    """
    if not themes:
        return [], [], []

    ranked = sorted(themes, key=lambda t: theme_to_score.get(t, 0.5))
    n = len(ranked)

    low_n = max(1, int(round(0.3 * n)))
    high_n = max(1, int(round(0.3 * n)))

    weak = ranked[:low_n]
    strong = ranked[-high_n:]
    mid = [t for t in ranked if t not in weak and t not in strong]

    # si n est petit, mid peut être vide, c'est OK
    return weak, mid, strong

def choose_bucket():
    r = random.random()
    if r < 0.50:
        return "strong"
    if r < 0.80:
        return "mid"
    return "weak"

def choose_difficulty(bucket: str):
    if bucket == "strong":
        return "hard"
    if bucket == "weak":
        return "easy"
    return random.choice(["easy", "medium", "hard"])
