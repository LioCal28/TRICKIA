# TRICKIA — Adaptive & Personalized Quiz Platform

TRICKIA is an evolving quiz application designed to adapt dynamically to a user’s strengths and weaknesses.  
Built with **Flask (backend)** and **JavaScript (frontend)**, it integrates external trivia APIs to generate diverse questions and tracks user performance to refine difficulty and topic selection over time.

This project began as a simple POC and progressively grew into a structured learning platform with session modes, statistics, theme filters, and interactive visual feedback.
---

## 🚀 Features

### 🎯 Core Quiz System
- Live questions fetched from OpenTriviaDB  
- Multiple-choice question interface  
- Automatic answer validation  
- Per-question feedback displayed clearly below answer buttons  
- Score tracking and question progression counter  

### 🧠 Adaptive Learning Tools
- Per-theme performance statistics  
- Weak-topic identification  
- Pie chart visualization of correct vs. incorrect answers  
- (Planned) Adaptive difficulty model: 50% weak categories, 30% medium, 20% strong  

### 🗂️ Session Modes
Choose one of three quiz modes:
- **EXPRESS** — 20 questions  
- **COMMIT** — 50 questions  
- **FULL-STACK** — 100 questions  

Each mode ends with a **session summary** including:
- Total score  
- Percentage  
- Personalized message based on performance  

### 🎛️ Theme Selection
- Fetch all themes from the API  
- Users can *exclude* themes via checkboxes  
- Excluded themes displayed in a dedicated sidebar  

### 🌗 Light & Dark Theme
- Toggle system using CSS variables  
- Complete visual restyling for each theme mode  

### 📊 Visual Enhancements
- Interactive pie chart with hover tooltip  
- Sidebar statistics panel with color-coded performance  
- Professional UI with improved spacing, buttons, and headers  

### 🛠️ Technical Foundation
- Flask backend serving JSON endpoints  
- Vanilla JavaScript-driven UI updates  
- JSON storage for stats (POC-level local persistence)  
- CSS-based layout with responsive elements  

---

## 🏗️ Project Structure

```
TRICKIA/
│
├── static/
│   ├── style.css
│   ├── script.js
│   └── images/           (optional assets)
│
├── data/
│   └── user_stats.json   (auto-generated)
│
├── app.py                (Flask backend)
├── requirements.txt
└── README.md
```

---

## ⚙️ Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/your-username/trickia.git
cd trickia
```

### 2. Create a virtual environment
```bash
python -m venv venv
```

### 3. Activate it  
**Windows:**
```bash
venv\Scripts\activate
```
**macOS & Linux:**
```bash
source venv/bin/activate
```

### 4. Install dependencies
```bash
pip install -r requirements.txt
```

### 5. Run the application
```bash
python app.py
```

Open your browser at:

👉 **http://localhost:5000**

---

## 🧭 Roadmap

### 🔜 Near-term features
- Integration of **The Trivia API** as a second question source  
- Unified question normalization layer  
- Category harmonization between APIs  
- Smoother screen transitions  
- Improved end-of-session analytics

### 🔧 Mid-term developments
- SQLite/PostgreSQL migration  
- User accounts + saved sessions  
- Full historical analytics  
- Export stats (CSV / PDF)  
- Multiple difficulty profiles  

### 🤖 Long-term vision
- Machine Learning engine:
  - Weak-topic prediction  
  - Reinforcement-learning–based question selection  
  - Personalized learning curve tracking  
- Mobile app (React Native or Flutter)  
- Multiplayer challenge mode  
- OAuth login and cloud sync  

---

## 🙌 Contributions
Contributions, feature suggestions, and improvements are welcome.  
Feel free to open issues, submit pull requests, or fork the project.
