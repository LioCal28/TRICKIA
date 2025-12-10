console.log("Script chargé !");

let allowedThemes = [];
let excludedThemes = [];

let sessionTotalQuestions = 0;
let sessionCurrentQuestion = 0;
let sessionCorrectAnswers = 0;

let lastCorrectGlobal = 0;
let lastTotalGlobal = 0;

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
document.getElementById("btn-new").addEventListener("click", loadQuestion);

async function loadQuestion() {
    // If session finished, don't continue
    if (sessionCurrentQuestion >= sessionTotalQuestions) {
        endSession();
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
        document.getElementById("feedback").textContent = "";
        document.getElementById("feedback").className = "";
        enableAnswers();
        updateQuestionCounterDisplay();
    } catch (err) {
        console.error("Erreur chargement question :", err);
    }
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
                // Correct answer
                btn.classList.add("answer-correct", "answer-highlight");
            } else if (btn === clickedButton && r.status !== "success") {
                // Wrong answer clicked by user
                btn.classList.add("answer-wrong", "answer-highlight");
            }
        });

        // Update stats panels + pie chart
        await loadStats();

        // End of session?
        if (sessionCurrentQuestion >= sessionTotalQuestions) {
            endSession();
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
function endSession() {
    // Hide quiz, show summary
    document.getElementById("quiz-area").classList.add("hidden");
    document.getElementById("session-summary").classList.remove("hidden");

    const percent = sessionTotalQuestions === 0
        ? 0
        : Math.round((sessionCorrectAnswers / sessionTotalQuestions) * 100);

    const summaryScore = document.getElementById("summary-score");
    const summaryMessage = document.getElementById("summary-message");

    summaryScore.textContent =
        `You answered ${sessionCorrectAnswers} out of ` +
        `${sessionTotalQuestions} questions correctly (${percent}%).`;

    let msg;
    if (percent < 50) {
        msg = "Keep going! Every session helps you improve. Review your weak topics and try again soon.";
    } else if (percent <= 80) {
        msg = "Nice job! You're building solid knowledge. A bit more practice and you'll master these topics.";
    } else {
        msg = "Outstanding performance! 🎉 You're crushing this quiz. Keep up the great work!";
    }

    summaryMessage.textContent = msg;
}

// Restart: reload page (simple for POC)
document.getElementById("restart-session").addEventListener("click", () => {
    window.location.reload();
});