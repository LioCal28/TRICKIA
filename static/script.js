console.log("Script chargé !");

let allowedThemes = [];
let excludedThemes = [];

let sessionTotalQuestions = 0;
let sessionCurrentQuestion = 0;
let sessionCorrectAnswers = 0;

let lastCorrectGlobal = 0;
let lastTotalGlobal = 0;

let quizStartTime = null;
let quizTimerInterval = null;
let quizTotalTimeSeconds = 0;

let currentStreak = 0;
let bestStreak = 0;

let canLoadNextQuestion = false;

// =============================================
// PAGE DETECTION (PATCH IA)
// =============================================
const IS_PROFILE_PAGE = window.location.pathname.includes("/profile");
const IS_QUIZ_PAGE = !IS_PROFILE_PAGE;

// ----------------------------------------------------
    // HEADER ACTIONS
    // ----------------------------------------------------
    const profileBtn = document.getElementById("profile-btn");
    const logoutBtn = document.getElementById("logout-btn");

    if (profileBtn) {
        if (window.location.pathname === "/profile") {
            profileBtn.textContent = "Return to quiz";
            profileBtn.onclick = () => {
                window.location.href = "/app";
            };
        } else {
            profileBtn.textContent = "Your Trickia profile";
            profileBtn.onclick = () => {
                window.location.href = "/profile";
            };
        }
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            window.location.href = "/logout";
        });
    }

// ----------------------------------------------------
// THEME MODE (dark / light)
// ----------------------------------------------------
const themeToggleBtn = document.getElementById("theme-toggle");
if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
        document.body.classList.toggle("dark");

        if (document.body.classList.contains("dark")) {
            themeToggleBtn.textContent = "☼ Light mode";
            localStorage.setItem("theme", "dark");
        } else {
            themeToggleBtn.textContent = "☾ Dark mode";
            localStorage.setItem("theme", "light");
        }
    });

    // Initial theme
    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark");
        themeToggleBtn.textContent = "☼ Light mode";
    }
}
if (IS_QUIZ_PAGE) {
// ----------------------------------------------------
// WELCOME SCREEN
// ----------------------------------------------------
const welcomeBtn = document.getElementById("welcome-start");
if (welcomeBtn) {
    welcomeBtn.addEventListener("click", () => {
        document.getElementById("welcome-screen").classList.add("hidden");
        document.getElementById("mode-selector").classList.remove("hidden");
    });
}

// ----------------------------------------------------
// LOAD CATEGORIES ON PAGE LOAD
// ----------------------------------------------------
window.addEventListener("load", async () => {
    const res = await fetch("/api/themes");
    const themes = await res.json();

    const list = document.getElementById("theme-checkboxes");
    list.innerHTML = "";

    themes.forEach(theme => {
        const li = document.createElement("li");
        li.innerHTML = `
            <label>
                <input type="checkbox" class="theme-check" value="${theme}" checked>
                ${theme}
            </label>
        `;
        list.appendChild(li);
    });

    // Tooltip for pie chart (session-based)
    const canvas = document.getElementById("piechart");
    const tooltip = document.getElementById("chart-tooltip");

    if (canvas && tooltip) {
        canvas.addEventListener("mouseenter", () => {
            if (lastTotalGlobal === 0) return;
            tooltip.classList.remove("hidden");
            const correctPct = lastTotalGlobal === 0
                ? 0
                : Math.round((lastCorrectGlobal / lastTotalGlobal) * 100);
            const wrongPct = 100 - correctPct;
            tooltip.textContent = `Correct: ${correctPct}% | Incorrect: ${wrongPct}%`;
        });

        canvas.addEventListener("mouseleave", () => {
            tooltip.classList.add("hidden");
        });
    }
});

    // ----------------------------------------------------
    // SESSION MODE SELECTION
    // ----------------------------------------------------
    document.querySelectorAll(".mode-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            sessionTotalQuestions = parseInt(btn.dataset.count, 10);
            sessionCurrentQuestion = 0;
            sessionCorrectAnswers = 0;

            // Go to theme selection
            document.getElementById("mode-selector").classList.add("hidden");
            document.getElementById("theme-selector").classList.remove("hidden");
        });
    });

    // ----------------------------------------------------
    // THEME SELECTION
    // ----------------------------------------------------
    const saveThemesBtn = document.getElementById("save-themes");
    if (saveThemesBtn) {
        saveThemesBtn.addEventListener("click", () => {
            allowedThemes = [];
            excludedThemes = [];

            document.querySelectorAll(".theme-check").forEach(cb => {
                if (cb.checked) {
                    allowedThemes.push(cb.value);
                } else {
                    excludedThemes.push(cb.labels[0].innerText.trim());
                }
            });

            const infoText = document.getElementById("theme-info-text");
            const list = document.getElementById("theme-checkboxes");

            if (allowedThemes.length < 5) {
                infoText.classList.add("error");
                list.classList.add("theme-shake");

                setTimeout(() => {
                    list.classList.remove("theme-shake");
                }, 400);

                return;
            }

            infoText.classList.remove("error");
            updateExcludedPanel();
            startQuiz();
        });
    }

    function updateExcludedPanel() {
        const list = document.getElementById("excluded-list");
        list.innerHTML = "";
        excludedThemes.forEach(t => {
            const li = document.createElement("li");
            li.textContent = t;
            list.appendChild(li);
        });
    }

    function startQuizTimerIfNeeded() {
        if (quizTimerInterval !== null) return;  // Already running

        quizStartTime = Date.now();
        quizTimerInterval = setInterval(() => {
            const elapsedSec = Math.floor((Date.now() - quizStartTime) / 1000);
            updateQuizTimerDisplay(elapsedSec);
        }, 1000);
    }

    function updateQuizTimerDisplay(seconds) {
        const timerEl = document.getElementById("quiz-timer");
        if (!timerEl) return;

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        let text;
        if (h > 0) {
            const mm = String(m).padStart(2, "0");
            const ss = String(s).padStart(2, "0");
            text = `${h}:${mm}:${ss}`;
        } else {
            const mm = String(m).padStart(2, "0");
            const ss = String(s).padStart(2, "0");
            text = `${mm}:${ss}`;
        }

        timerEl.textContent = text;
    }

    function stopQuizTimer() {
        if (quizTimerInterval !== null) {
            clearInterval(quizTimerInterval);
            quizTimerInterval = null;
        }
        if (quizStartTime !== null) {
            quizTotalTimeSeconds = Math.floor((Date.now() - quizStartTime) / 1000);
        }
    }

    function formatDurationForSummary(seconds) {
        if (seconds <= 0) return "0s";

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        const parts = [];
        if (h > 0) parts.push(`${h}h`);
        if (m > 0 || h > 0) parts.push(`${m}m`);
        parts.push(`${s}s`);
        return parts.join(" ");
    }

    // ----------------------------------------------------
    // START QUIZ (NEW SESSION)
    // ----------------------------------------------------
    async function startQuiz() {
        // Reset session counters
        sessionCurrentQuestion = 0;
        sessionCorrectAnswers = 0;
        lastCorrectGlobal = 0;
        lastTotalGlobal = 0;
        bestStreak = 0;

        drawPieChart(0, 0);

        // Reset sidebar lists & source label
        document.getElementById("stats-list").innerHTML = "";
        document.getElementById("api-stats-list").innerHTML = "";
        document.getElementById("current-source").textContent = "-";

        // Inform backend of new session (reset used questions, score, stats, etc.)
        try {
            await fetch("/api/session/start", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ themes: allowedThemes })
            });
        } catch (err) {
            console.error("Erreur démarrage session backend :", err);
        }

        document.getElementById("theme-selector").classList.add("hidden");
        document.getElementById("quiz-area").classList.remove("hidden");

        updateQuestionCounterDisplay();
        loadStats();      // Theme stats + API stats (reset)

        const btn = document.getElementById("btn-new");
        btn.textContent = "New question";
        btn.classList.remove("result-button");
        btn.dataset.action = "next";
        btn.classList.remove("loading");

        canLoadNextQuestion = true; // autorise la 1ère question
    }

    // Update "Question X / N" text and progress bar
    function updateQuestionCounterDisplay() {
        const displayIndex = Math.min(sessionCurrentQuestion + 1, sessionTotalQuestions);
        document.getElementById("q-number").textContent =
            `${displayIndex} / ${sessionTotalQuestions}`;

        const progressBar = document.getElementById("progress-bar");
        const ratio = sessionTotalQuestions === 0 ? 0 : sessionCurrentQuestion / sessionTotalQuestions;
        progressBar.style.width = (ratio * 100) + "%";
    }

    // ----------------------------------------------------
    // LOAD QUESTION
    // ----------------------------------------------------
    const btnNew = document.getElementById("btn-new");
    if (btnNew) {
    btnNew.addEventListener("click", () => {

        // 🚫 Cas 1 : bouton bloqué (pas répondu ou en chargement)
        if (!canLoadNextQuestion) return;

        // 🚫 Cas 2 : déjà en loading
        if (btnNew.classList.contains("loading")) return;

        // 🔒 Verrou immédiat
        canLoadNextQuestion = false;
        btnNew.classList.add("loading");

        setTimeout(() => {
            btnNew.classList.remove("loading");

            if (btnNew.dataset.action === "results") {
                endSession();
            } else {
                loadQuestion();
            }
        }, 1500);
    });
}

    async function loadQuestion() {
        // If session finished, don't load any more questions
        if (sessionCurrentQuestion >= sessionTotalQuestions) {
            return;
        }

        let url = "/api/question";
        
        try {
            canLoadNextQuestion = false;
            const response = await fetch(url);
            const data = await response.json();

            displayQuestion(data);
            canLoadNextQuestion = false; // réponse pas encore donnée

            // Start global quiz timer when first question is shown
            if (!quizStartTime) {
                startQuizTimerIfNeeded();
            }

            document.getElementById("feedback").textContent = "";
            document.getElementById("feedback").className = "";
            enableAnswers();
            updateQuestionCounterDisplay();
        } catch (err) {
            console.error("Erreur chargement question :", err);
        }
    }

    function prepareEndOfQuizButton() {
        const btn = document.getElementById("btn-new");
        if (!btn) return;

        btn.textContent = "See your results!";
        btn.classList.add("result-button");
        btn.dataset.action = "results"; // <-- état explicite
    }

    // ----------------------------------------------------
    // DISPLAY QUESTION + ANSWERS
    // ----------------------------------------------------
    function displayQuestion(q) {
        document.getElementById("question-text").textContent = q.question;
        document.getElementById("category").textContent = q.category;
        document.getElementById("difficulty").textContent = q.difficulty;

        // Display source immediately
        if (q.source) {
            document.getElementById("current-source").textContent = q.source;
        }

        const answersBox = document.getElementById("answers");
        answersBox.innerHTML = "";

        q.answers.forEach(a => {
            const b = document.createElement("button");
            b.className = "answer-btn";
            b.textContent = a;
            b.onclick = () => sendAnswer(q.id, a, b);
            answersBox.appendChild(b);
        });
    }

    // ----------------------------------------------------
    // SEND ANSWER
    // ----------------------------------------------------
    async function sendAnswer(id, answer, clickedButton) {
        // Prevent multiple clicks
        disableAnswers();

        try {
            const response = await fetch("/api/answer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question_id: id, answer: answer })
            });

            const r = await response.json();

            // Global score from backend
            document.getElementById("score").textContent = r.score;

            // Session stats
            sessionCurrentQuestion += 1;
            if (r.status === "success") {
                sessionCorrectAnswers += 1;
            }
            // --- STREAK SYSTEM ---
            if (r.status === "success") {
                currentStreak += 1;
                if (currentStreak > bestStreak) {
                    bestStreak = currentStreak;
                }
            } else {
                currentStreak = 0;
            }

            // Update display
            updateStreakDisplay();

            function updateStreakDisplay() {
                const s = document.getElementById("streak");
                s.textContent = currentStreak;

                // Remove previous classes
                s.className = "";

                if (currentStreak >= 5) {
                    s.classList.add("streak-5");
                } else if (currentStreak === 4) {
                    s.classList.add("streak-4");
                } else if (currentStreak === 3) {
                    s.classList.add("streak-3");
                } else if (currentStreak === 2) {
                    s.classList.add("streak-2");
                } else if (currentStreak === 1) {
                    s.classList.add("streak-1");
                }
            }


            // Remove textual bold feedback (now using only highlight)
            const fb = document.getElementById("feedback");
            fb.textContent = "";
            fb.className = "";

            // Update current source label (for safety)
            if (r.source) {
                const srcLabel = document.getElementById("current-source");
                srcLabel.textContent = r.source;
            }

            // Animated highlight on answers
            const buttons = document.querySelectorAll(".answer-btn");
            buttons.forEach(btn => {
                // Clean previous highlight classes just in case
                btn.classList.remove("answer-correct", "answer-wrong", "answer-highlight");

                if (btn.textContent === r.correct) {
                    // Correct answer: green + highlight animation
                    btn.classList.add("answer-correct", "answer-highlight");
                } else {
                    // All other answers become red (no highlight animation)
                    btn.classList.add("answer-wrong");
                }
            });

            // Update stats panels + pie chart
            await loadStats();

            // End of session?
            if (sessionCurrentQuestion >= sessionTotalQuestions) {
                prepareEndOfQuizButton();
            } else {
                updateQuestionCounterDisplay();
            }

            canLoadNextQuestion = true;

        } catch (err) {
            console.error("Erreur envoi réponse :", err);
        
        }
    }

    function disableAnswers() {
        document.querySelectorAll(".answer-btn").forEach(b => {
            b.disabled = true;
            b.classList.add("disabled");
        });
    }
    function enableAnswers() {
        document.querySelectorAll(".answer-btn").forEach(b => {
            b.disabled = false;
            b.classList.remove("disabled", "answer-correct", "answer-wrong", "answer-highlight");
        });
    }

    // ----------------------------------------------------
    // LOAD THEME STATS + UPDATE PIE CHART + API STATS
    // ----------------------------------------------------
    async function loadStats() {
        try {
            const response = await fetch("/api/stats");
            if (!response.ok) {
                throw new Error("Stats API error");
            }
            const stats = await response.json();

            const list = document.getElementById("stats-list");
            list.innerHTML = "";

            stats.forEach(entry => {
                const cls = entry.percent >= 50 ? "stat-good" : "stat-bad";

                const li = document.createElement("li");
                li.innerHTML = `
                ${entry.theme}<br>
                <span class="${cls}">${entry.percent}%</span>
                &nbsp; | ${entry.correct}/${entry.total}
            `;
                list.appendChild(li);
            });

            // Pie chart is now session-based
            lastCorrectGlobal = sessionCorrectAnswers;
            lastTotalGlobal = sessionCurrentQuestion;
            drawPieChart(sessionCorrectAnswers, sessionCurrentQuestion);

            // Load per-API stats
            await loadApiStats();
        } catch (err) {
            console.error("Erreur chargement stats :", err);
        }
    }

    // Load API stats and update API performance panel
    async function loadApiStats() {
        try {
            const response = await fetch("/api/api_stats");
            const stats = await response.json();

            const list = document.getElementById("api-stats-list");
            list.innerHTML = "";

            stats.forEach(entry => {
                const li = document.createElement("li");
                li.textContent = `${entry.source}: ${entry.percent}% (${entry.correct}/${entry.total})`;
                list.appendChild(li);
            });
        } catch (err) {
            console.error("Erreur chargement stats API :", err);
        }
    }

    // ----------------------------------------------------
    // PIE CHART (SESSION-BASED)
    // ----------------------------------------------------
    function drawPieChart(correct, total) {
        const canvas = document.getElementById("piechart");
        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const centerX = 70;
        const centerY = 70;
        const radius = 60;

        if (total === 0) {
            // Grey circle when no data
            ctx.fillStyle = "#cccccc";
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 1;
            ctx.stroke();
            return;
        }

        const correctPct = correct / total;

        const successColor = getComputedStyle(document.body).getPropertyValue("--success").trim();
        const errorColor = getComputedStyle(document.body).getPropertyValue("--error").trim();

        const endAngleCorrect = Math.PI * 2 * correctPct;

        // Correct slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.fillStyle = successColor;
        ctx.arc(centerX, centerY, radius, 0, endAngleCorrect);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Wrong slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.fillStyle = errorColor;
        ctx.arc(centerX, centerY, radius, endAngleCorrect, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ----------------------------------------------------
    // END OF SESSION
    // ----------------------------------------------------
   async function endSession() {

    // ------------------------------------------
    // DOM ELEMENTS
    // ------------------------------------------
    const quizArea = document.getElementById("quiz-area");
    const summary = document.getElementById("session-summary");

    const summaryScore = document.getElementById("summary-score");
    const summaryMessage = document.getElementById("summary-message");

    const topList = document.getElementById("summary-top-themes");
    const bottomList = document.getElementById("summary-bottom-themes");
    const badgeContainer = document.getElementById("badge-container");

    // ------------------------------------------
    // 1️⃣ SAVE SESSION STATS (NON BLOQUANT)
    // ------------------------------------------
    let sessionThemeStats = [];

    try {
        const statsResponse = await fetch("/api/stats");
        sessionThemeStats = await statsResponse.json();

        const themeStatsPayload = {};
        sessionThemeStats.forEach(s => {
            if (s.total > 0) {
                themeStatsPayload[s.theme] = {
                    total: s.total,
                    correct: s.correct
                };
            }
        });

        if (Object.keys(themeStatsPayload).length > 0) {
            await fetch("/api/session/end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    total_questions: sessionTotalQuestions,
                    score: sessionCorrectAnswers,
                    best_streak: bestStreak,
                    total_time: quizTotalTimeSeconds,
                    theme_stats: themeStatsPayload
                })
            });
        }

    } catch (err) {
        console.error("Session save failed", err);
    }

    // ------------------------------------------
    // 2️⃣ SWITCH VIEW
    // ------------------------------------------
    quizArea.classList.add("hidden");
    summary.classList.remove("hidden");

    // ------------------------------------------
    // 3️⃣ STATIC SUMMARY TEXTS
    // ------------------------------------------
    if (summaryScore) {
        summaryScore.textContent =
            `Score: ${sessionCorrectAnswers} / ${sessionTotalQuestions}`;
    }

    if (summaryMessage) {
        summaryMessage.textContent =
            sessionCorrectAnswers / sessionTotalQuestions >= 0.7
                ? "Great job! You're on the right track 💪"
                : "Nice effort! Keep playing to improve 🚀";
    }

    // ------------------------------------------
    // 4️⃣ RENDER THEME STATS
    // ------------------------------------------
    topList.innerHTML = "";
    bottomList.innerHTML = "";
    badgeContainer.innerHTML = "";

    const filtered = sessionThemeStats.filter(s => s.total >= 2);

    if (filtered.length < 2) {
        topList.innerHTML = "<li>Not enough data yet.</li>";
        bottomList.innerHTML = "<li>Not enough data yet.</li>";
        badgeContainer.innerHTML =
            "<p>Play more quizzes to unlock achievements.</p>";
    } else {

        // Sort once, descending
        const sorted = [...filtered].sort((a, b) => b.percent - a.percent);

        // Top 2 best themes
        const bestThemes = sorted.slice(0, 2);

        // Top 2 worst themes (from the end, reversed for readability)
        const worstThemes = sorted.slice(-2).reverse();

        bestThemes.forEach(e => {
            const li = document.createElement("li");
            li.innerHTML = `
                <strong>${e.theme}</strong> — ${e.percent}% (${e.correct}/${e.total})<br>
                <span class="theme-comment">
                    ${buildThemeComment(e.percent, true)}
                </span>
            `;
            topList.appendChild(li);
        });

        worstThemes.forEach(e => {
            const li = document.createElement("li");
            li.innerHTML = `
                <strong>${e.theme}</strong> — ${e.percent}% (${e.correct}/${e.total})<br>
                <span class="theme-comment">
                    ${buildThemeComment(e.percent, false)}
                </span>
            `;
            bottomList.appendChild(li);
        });

        // Badges: only from best themes, with sufficient data
        bestThemes
            .filter(e => e.percent >= 85 && e.total >= 2)
            .forEach(e => {
                const badge = document.createElement("div");
                badge.className = "badge-hexagon";
                badge.textContent = `Expert in ${e.theme}!`;
                badgeContainer.appendChild(badge);
            });
    }
}

    function buildThemeComment(percent, isTop) {
        if (isTop) {
            if (percent >= 90) {
                return "Outstanding mastery of this theme. Keep challenging yourself!";
            } else if (percent >= 75) {
                return "You have strong knowledge here. A few more sessions and you'll be unstoppable.";
            } else {
                return "You are above average on this theme. Keep going to reach excellence.";
            }
        } else {
            if (percent < 40) {
                return "This theme is challenging for you. A bit of focused practice will help a lot.";
            } else if (percent < 60) {
                return "You're on the right track, but there's still room for improvement.";
            } else {
                return "You're doing fairly well here, but you can still push your limits.";
            }
        }
    }

    // Restart: reload page (simple for POC)
    const restartBtn = document.getElementById("restart-session");
    if (restartBtn) {
        restartBtn.addEventListener("click", () => {
            window.location.reload();
        });
    }
}
// =============================================
// PROFILE PAGE LOGIC (PATCH IA)
// =============================================
if (IS_PROFILE_PAGE) {
  
    // -----------------------------
    // PROFILE DATA
    // -----------------------------
    fetch("/api/profile")
      .then(res => res.json())
      .then(data => {
        document.getElementById("profile-username").textContent = data.username;
        document.getElementById("profile-total-questions").textContent =
          `You answered ${data.total_questions} questions`;
        document.getElementById("profile-best-streak").textContent =
          data.best_streak ?? 0;

        const list = document.getElementById("profile-theme-list");
        list.innerHTML = "";

        if (!data.themes.length) {
          list.innerHTML = "<li>No data yet. Play some quizzes!</li>";
        } else {
          data.themes
            .sort((a, b) => b.percent - a.percent)
            .forEach(t => {
                const row = document.createElement("div");
                row.className = "theme-row";

                row.innerHTML = `
                <div class="theme-name">${t.theme}</div>

                <div class="theme-percent">
                    ${t.percent}%
                    <span>${t.correct}/${t.total}</span>
                </div>

                <div class="theme-bar">
                    <div class="theme-bar-fill" style="width: ${t.percent}%"></div>
                </div>
                `;

                list.appendChild(row);
            });
        }

        const badges = document.getElementById("profile-badges");
        badges.innerHTML = "";
        data.achievements.forEach(a => {
            const div = document.createElement("div");
            div.className = "badge-hexagon";
            div.textContent = `${a.label} ×${a.count}`;
            badges.appendChild(div);
        });
      });

    // -----------------------------
    // AI MODEL GRAPH
    // -----------------------------
    fetch("/api/model/history")
    .then(res => res.json())
    .then(data => {
        const themes = data.themes || {};
        const canvas = document.getElementById("model-chart");

        if (!canvas || Object.keys(themes).length === 0) return;

        // Compute max step FIRST
        const maxStep = Math.max(
        ...Object.values(themes).flat().map(p => p.step)
        );

        // Rank themes by final AI confidence (relative ranking)
        const rankedThemes = Object.entries(themes)
        .filter(([_, points]) => points.length >= 2)
        .map(([theme, points]) => ({
            theme,
            finalMean: points.at(-1).mean
        }))
        .sort((a, b) => b.finalMean - a.finalMean)
        .map(e => e.theme);

        // Make canvas width depend on number of sessions
        const MIN_WIDTH = 900;
        const STEP_WIDTH = 90; // px per session

        canvas.width = Math.max(
        MIN_WIDTH,
        maxStep * STEP_WIDTH
        );

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const padding = 40;
        const w = canvas.width - padding * 2;
        const h = canvas.height - padding * 2;

        // Axes
        ctx.strokeStyle = "#888";
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, canvas.height - padding);
        ctx.lineTo(canvas.width - padding, canvas.height - padding);
        ctx.stroke();

        // -----------------------------
        // Y AXIS LABELS (0% → 100%)
        // -----------------------------
        ctx.fillStyle = "#888";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        [0, 0.25, 0.5, 0.75, 1].forEach(value => {
        const y = padding + (1 - value) * h;

        ctx.beginPath();
        ctx.moveTo(padding - 5, y);
        ctx.lineTo(padding, y);
        ctx.stroke();

        ctx.fillText(`${Math.round(value * 100)}%`, padding - 8, y);
        });

        let i = 0;
        Object.entries(themes).forEach(([theme, points]) => {
        if (points.length < 2) return;

        // Determine color based on relative ranking
        const rank = rankedThemes.indexOf(theme);

        let color;
        if (rank <= 1) {
        color = "#4caf50"; // green: strong themes
        } else if (rank <= 3) {
        color = "#ffb300"; // orange: medium themes
        } else {
        color = "#e53935"; // red: weak themes
        }

        ctx.strokeStyle = color;
        ctx.beginPath();

        points.forEach((p, idx) => {
            const x = padding + (p.step - 1) * (w / Math.max(1, maxStep - 1));
            const y = padding + (1 - p.mean) * h;
            idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });

        ctx.stroke();

        // Theme label (improved readability)
        ctx.save();
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = "#111";        // texte foncé, lisible
        ctx.shadowColor = "rgba(255,255,255,0.8)";
        ctx.shadowBlur = 4;
        ctx.fillText(
        theme,
        padding + w + 8,
        padding + (1 - points.at(-1).mean) * h
        );
        ctx.restore();

        i++;
        });
    });
  };