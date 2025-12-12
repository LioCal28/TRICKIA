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


// ----------------------------------------------------
// THEME MODE (dark / light)
// ----------------------------------------------------
const themeToggleBtn = document.getElementById("theme-toggle");

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

// ----------------------------------------------------
// WELCOME SCREEN
// ----------------------------------------------------
const welcomeBtn = document.getElementById("welcome-start");
welcomeBtn.addEventListener("click", () => {
    document.getElementById("welcome-screen").classList.add("hidden");
    document.getElementById("mode-selector").classList.remove("hidden");
});

// ----------------------------------------------------
// LOAD CATEGORIES ON PAGE LOAD
// ----------------------------------------------------
window.addEventListener("load", async () => {
    // Load OpenTrivia categories for theme selector
    try {
        const res = await fetch("https://opentdb.com/api_category.php");
        const categories = (await res.json()).trivia_categories;

        const list = document.getElementById("theme-checkboxes");
        categories.forEach(cat => {
            let name = cat.name;
            // Remove "Entertainment:" prefix for display
            if (name.startsWith("Entertainment:")) {
                name = name.split(":")[1].trim();
            }
            const li = document.createElement("li");
            li.innerHTML = `
                <label>
                    <input type="checkbox" class="theme-check" value="${cat.id}" checked>
                    ${name}
                </label>`;
            list.appendChild(li);
        });
    } catch (err) {
        console.error("Erreur chargement catégories :", err);
    }

    // Tooltip for pie chart (session-based)
    const canvas = document.getElementById("piechart");
    const tooltip = document.getElementById("chart-tooltip");

    canvas.addEventListener("mouseenter", () => {
        if (lastTotalGlobal === 0) return;
        tooltip.classList.remove("hidden");
        const correctPct = lastTotalGlobal === 0 ? 0 : Math.round((lastCorrectGlobal / lastTotalGlobal) * 100);
        const wrongPct = 100 - correctPct;
        tooltip.textContent = `Correct: ${correctPct}% | Incorrect: ${wrongPct}%`;
    });

    canvas.addEventListener("mouseleave", () => {
        tooltip.classList.add("hidden");
    });
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
document.getElementById("save-themes").addEventListener("click", () => {
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

    drawPieChart(0, 0);

    // Reset sidebar lists & source label
    document.getElementById("stats-list").innerHTML = "";
    document.getElementById("api-stats-list").innerHTML = "";
    document.getElementById("current-source").textContent = "-";

    // Inform backend of new session (reset used questions, score, stats, etc.)
    try {
        await fetch("/api/session/start", { method: "POST" });
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
document.getElementById("btn-new").addEventListener("click", () => {
    const btn = document.getElementById("btn-new");

    // Prevent double trigger
    if (btn.classList.contains("loading")) return;

    btn.classList.add("loading");

    setTimeout(() => {
        btn.classList.remove("loading");

        // If we are at the end, go to results
        if (btn.dataset.action === "results") {
    endSession();
} else {
    loadQuestion();
}
    }, 1500);
});

async function loadQuestion() {
        // If session finished, don't load any more questions
    if (sessionCurrentQuestion >= sessionTotalQuestions) {
        return;
    }

    let url = "/api/question";

    if (allowedThemes.length > 0) {
        const theme = allowedThemes[Math.floor(Math.random() * allowedThemes.length)];
        url += "?category=" + theme;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

                displayQuestion(data);

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
            headers: {"Content-Type": "application/json"},
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
    // Stop global quiz timer and compute total time
    stopQuizTimer();

    // Remove existing streak summary line if any (avoid duplicates)
const existingStreak = document.getElementById("summary-streak-line");
if (existingStreak) {
    existingStreak.remove();
}

    // Hide quiz, show summary
    document.getElementById("quiz-area").classList.add("hidden");
    document.getElementById("session-summary").classList.remove("hidden");

    const percent = sessionTotalQuestions === 0
        ? 0
        : Math.round((sessionCorrectAnswers / sessionTotalQuestions) * 100);

    const summaryScore = document.getElementById("summary-score");
    const summaryMessage = document.getElementById("summary-message");
    const topList = document.getElementById("summary-top-themes");
    const bottomList = document.getElementById("summary-bottom-themes");
    const badgeContainer = document.getElementById("badge-container");

    // Global recap text
    summaryScore.textContent =
        `Well done! You answered ${sessionCorrectAnswers} out of ` +
        `${sessionTotalQuestions} questions correctly (${percent}% correct answers) ` +
        `in ${formatDurationForSummary(quizTotalTimeSeconds)}!`;
    
    // Insert streak info immediately after the global recap line
        const streakLine = document.createElement("p");
        streakLine.id = "summary-streak-line";
        streakLine.textContent = `Your highest streak was ${bestStreak}!`;

        // Apply same streak class as in-game
        if (bestStreak >= 5) {
            streakLine.classList.add("streak-5");
        } else if (bestStreak === 4) {
            streakLine.classList.add("streak-4");
        } else if (bestStreak === 3) {
            streakLine.classList.add("streak-3");
        } else if (bestStreak === 2) {
            streakLine.classList.add("streak-2");
        } else if (bestStreak === 1) {
            streakLine.classList.add("streak-1");
        }

summaryScore.insertAdjacentElement("afterend", streakLine);


    let msg;
    if (percent < 50) {
        msg = "Keep going! Every session helps you improve. Focus on your weakest themes and try again soon.";
    } else if (percent <= 80) {
        msg = "Nice job! You're building solid knowledge. A bit more practice and you'll master these topics.";
    } else {
        msg = "Outstanding performance! 🎉 You really mastered this quiz. Be proud of your achievement!";
    }
    summaryMessage.textContent = msg;

    // Clear previous lists & badges
    topList.innerHTML = "";
    bottomList.innerHTML = "";
    badgeContainer.innerHTML = "";

    try {
        const response = await fetch("/api/stats");
        const stats = await response.json();

        // Exclude themes with less than 2 questions
        const filtered = stats.filter(entry => entry.total >= 2);

        if (filtered.length === 0) {
            topList.innerHTML = "<li>Not enough data to compute per-theme statistics yet.</li>";
            bottomList.innerHTML = "<li>Not enough data to compute per-theme statistics yet.</li>";
            const p = document.createElement("p");
            p.textContent = "Play more questions to unlock achievements!";
            badgeContainer.appendChild(p);
            return;
        }

        const bestSorted = [...filtered].sort((a, b) => b.percent - a.percent);
        const worstSorted = [...filtered].sort((a, b) => a.percent - b.percent);

        const top3 = bestSorted.slice(0, 3);
        const bottom3 = worstSorted.slice(0, 3);

        top3.forEach(entry => {
            const li = document.createElement("li");
            li.innerHTML =
                `<strong>${entry.theme}</strong> — ${entry.percent}% (${entry.correct}/${entry.total})<br>` +
                `<span class="theme-comment">${buildThemeComment(entry.percent, true)}</span>`;
            topList.appendChild(li);
        });

        bottom3.forEach(entry => {
            const li = document.createElement("li");
            li.innerHTML =
                `<strong>${entry.theme}</strong> — ${entry.percent}% (${entry.correct}/${entry.total})<br>` +
                `<span class="theme-comment">${buildThemeComment(entry.percent, false)}</span>`;
            bottomList.appendChild(li);
        });

        // Achievements: themes with > 85% and at least 2 questions
        const achievements = bestSorted.filter(e => e.percent > 85 && e.total >= 2).slice(0, 3);
        if (achievements.length === 0) {
            const p = document.createElement("p");
            p.textContent = "No achievements unlocked yet. Keep playing to earn some!";
            badgeContainer.appendChild(p);
        } else {
            achievements.forEach(entry => {
                const badge = document.createElement("div");
                badge.className = "badge-hexagon";
                badge.textContent = `Expert in ${entry.theme}!`;
                badgeContainer.appendChild(badge);
            });
        }
    } catch (err) {
        console.error("Error loading stats for summary:", err);
        topList.innerHTML = "<li>Could not load detailed statistics.</li>";
        bottomList.innerHTML = "<li>Could not load detailed statistics.</li>";
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
document.getElementById("restart-session").addEventListener("click", () => {
    window.location.reload();
});
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
// PROFILE PAGE LOGIC
// ----------------------------------------------------
if (window.location.pathname === "/profile") {
    fetch("/api/profile")
        .then(res => {
            if (!res.ok) throw new Error("Not authenticated");
            return res.json();
        })
        .then(data => {
            // Username
            document.getElementById("profile-username").textContent = data.username;

            // Total questions
            document.getElementById("profile-total-questions")
                .textContent = `You answered ${data.total_questions} questions`;

            // Best streak
            const streakEl = document.getElementById("profile-best-streak");
            streakEl.textContent = `Best streak: ${data.best_streak}`;

            streakEl.className = "";
            if (data.best_streak >= 5) streakEl.classList.add("streak-5");
            else if (data.best_streak === 4) streakEl.classList.add("streak-4");
            else if (data.best_streak === 3) streakEl.classList.add("streak-3");
            else if (data.best_streak === 2) streakEl.classList.add("streak-2");
            else if (data.best_streak === 1) streakEl.classList.add("streak-1");

            // Theme performance
            const list = document.getElementById("profile-theme-list");
            list.innerHTML = "";

            if (data.themes.length === 0) {
                list.innerHTML = "<li>No data yet. Play some quizzes!</li>";
                return;
            }

            data.themes.forEach(t => {
                const li = document.createElement("li");
                li.innerHTML = `
                    <strong>${t.theme}</strong> — ${t.percent}%
                    (${t.correct}/${t.total})
                `;
                list.appendChild(li);
            });
        })
        .catch(err => {
            console.error("Profile error:", err);
            window.location.href = "/login";
        });
}