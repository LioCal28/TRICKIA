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

// Chargement initial du thème
if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark");
    themeToggleBtn.textContent = "☼ Light mode";
}

// ----------------------------------------------------
// AU CHARGEMENT : récupérer les catégories
// ----------------------------------------------------
window.addEventListener("load", async () => {
    // Charger catégories pour le sélecteur de thèmes
    try {
        const res = await fetch("https://opentdb.com/api_category.php");
        const categories = (await res.json()).trivia_categories;

        const list = document.getElementById("theme-checkboxes");
        categories.forEach(cat => {
            const li = document.createElement("li");
            li.innerHTML = `
                <label>
                    <input type="checkbox" class="theme-check" value="${cat.id}" checked>
                    ${cat.name}
                </label>`;
            list.appendChild(li);
        });
    } catch (err) {
        console.error("Erreur chargement catégories :", err);
    }

    // Tooltip pie chart
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
// CHOIX DU MODE DE SESSION
// ----------------------------------------------------
document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        sessionTotalQuestions = parseInt(btn.dataset.count, 10);
        sessionCurrentQuestion = 0;
        sessionCorrectAnswers = 0;

        // Passer à la sélection des thèmes
        document.getElementById("mode-selector").classList.add("hidden");
        document.getElementById("theme-selector").classList.remove("hidden");
    });
});

// ----------------------------------------------------
// SÉLECTION DES THÈMES
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
// DÉMARRAGE QUIZ
// ----------------------------------------------------
function startQuiz() {
    document.getElementById("theme-selector").classList.add("hidden");
    document.getElementById("quiz-area").classList.remove("hidden");

    updateQuestionCounterDisplay();
    loadStats();
}

// Mise à jour affichage "Question X / N"
function updateQuestionCounterDisplay() {
    const displayIndex = Math.min(sessionCurrentQuestion + 1, sessionTotalQuestions);
    document.getElementById("q-number").textContent =
        `${displayIndex} / ${sessionTotalQuestions}`;
}

// ----------------------------------------------------
// CHARGER UNE QUESTION
// ----------------------------------------------------
document.getElementById("btn-new").addEventListener("click", loadQuestion);

async function loadQuestion() {
    // Si la session est terminée, ne pas continuer
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
// AFFICHER LA QUESTION + RÉPONSES
// ----------------------------------------------------
function displayQuestion(q) {
    document.getElementById("question-text").textContent = q.question;
    document.getElementById("category").textContent = q.category;
    document.getElementById("difficulty").textContent = q.difficulty;

    const answersBox = document.getElementById("answers");
    answersBox.innerHTML = "";

    q.answers.forEach(a => {
        const b = document.createElement("button");
        b.className = "answer-btn";
        b.textContent = a;
        b.onclick = () => sendAnswer(q.id, a);
        answersBox.appendChild(b);
    });
}

// ----------------------------------------------------
// ENVOYER RÉPONSE
// ----------------------------------------------------
async function sendAnswer(id, answer) {
    // Empêcher double clic
    disableAnswers();

    try {
        const response = await fetch("/api/answer", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ question_id: id, answer: answer })
        });

        const r = await response.json();

        // Score global
        document.getElementById("score").textContent = r.score;

        // Statistiques de session
        sessionCurrentQuestion += 1;
        if (r.status === "success") {
            sessionCorrectAnswers += 1;
        }

        // Feedback visuel
        const fb = document.getElementById("feedback");
        fb.className = "";
        if (r.status === "success") {
            fb.textContent = "Bonne réponse !";
            fb.classList.add("feedback-good");
        } else {
            fb.textContent = "Mauvaise réponse. La bonne réponse était : " + r.correct;
            fb.classList.add("feedback-bad");
        }

        // Stats globales + pie chart
        await loadStats();

        // Si la session est terminée, afficher l'écran final
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
        b.classList.remove("disabled");
    });
}

// ----------------------------------------------------
// CHARGER STATISTIQUES + METTRE À JOUR LE CAMEMBERT
// ----------------------------------------------------
async function loadStats() {
    try {
        const response = await fetch("/api/stats");
        const stats = await response.json();

        const list = document.getElementById("stats-list");
        list.innerHTML = "";

        let totalCorrect = 0;
        let totalQuestions = 0;

        stats.forEach(entry => {
            totalCorrect += entry.correct;
            totalQuestions += entry.total;

            const cls = entry.percent >= 50 ? "stat-good" : "stat-bad";

            const li = document.createElement("li");
            li.innerHTML = `
                ${entry.theme}<br>
                <span class="${cls}">${entry.percent}%</span>
                &nbsp; | ${entry.correct}/${entry.total}
            `;
            list.appendChild(li);
        });

        lastCorrectGlobal = totalCorrect;
        lastTotalGlobal = totalQuestions;

        drawPieChart(totalCorrect, totalQuestions);
    } catch (err) {
        console.error("Erreur chargement stats :", err);
    }
}

// ----------------------------------------------------
// DESSIN DU DIAGRAMME CAMEMBERT
// ----------------------------------------------------
function drawPieChart(correct, total) {
    const canvas = document.getElementById("piechart");
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = 70;
    const centerY = 70;
    const radius = 60;

    if (total === 0) {
        // Cercle gris si aucune donnée
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
    const wrongPct = 1 - correctPct;

    const successColor = getComputedStyle(document.body).getPropertyValue("--success").trim();
    const errorColor = getComputedStyle(document.body).getPropertyValue("--error").trim();

    // Tranche "bonne réponse"
    const endAngleCorrect = Math.PI * 2 * correctPct;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.fillStyle = successColor;
    ctx.arc(centerX, centerY, radius, 0, endAngleCorrect);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Tranche "mauvaise réponse"
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
// FIN DE SESSION
// ----------------------------------------------------
function endSession() {
    // Masquer la zone quiz, afficher le résumé
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

// Redémarrer une nouvelle session
document.getElementById("restart-session").addEventListener("click", () => {
    // Pour le POC, on recharge simplement la page
    window.location.reload();
});
