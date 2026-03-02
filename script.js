const ratioMap = {
  "1:5": 1 / 5,
  "1:4": 1 / 4,
  "1:3": 1 / 3,
  "1:2": 1 / 2,
  "1:1": 1 / 1
};

const trendData = [
  { day: "Mon", focus: 125, brk: 34 },
  { day: "Tue", focus: 142, brk: 41 },
  { day: "Wed", focus: 120, brk: 38 },
  { day: "Thu", focus: 168, brk: 45 },
  { day: "Fri", focus: 136, brk: 39 },
  { day: "Sat", focus: 82, brk: 30 },
  { day: "Sun", focus: 97, brk: 28 }
];

const hourlyHeat = [
  ["06:00", 12],
  ["08:00", 18],
  ["10:00", 34],
  ["12:00", 22],
  ["14:00", 17],
  ["16:00", 11],
  ["18:00", 26],
  ["19:00", 39],
  ["20:00", 36],
  ["22:00", 21]
];

const legacyDefaultTaskIds = new Set(["t1", "t2", "t3"]);

const state = {
  view: "work",
  tab: "focus",
  insightTab: "dashboard",
  dark: false,
  profile: null,
  ratioKey: "1:3",
  focusRunning: false,
  breakRunning: false,
  focusSeconds: 0,
  breakSeconds: 0,
  breakBankSeconds: 0,
  tasks: [],
  sessionHistory: []
};

let focusTimer = null;
let breakTimer = null;
let breakSegmentStart = null;

const el = (id) => document.getElementById(id);

function formatClock(sec) {
  const s = Math.max(0, sec | 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatSigned(sec) {
  const sign = sec < 0 ? "-" : "";
  const abs = Math.abs(sec | 0);
  const m = Math.floor(abs / 60);
  const r = abs % 60;
  return `${sign}${m}:${String(r).padStart(2, "0")}`;
}

function getRatio() {
  return ratioMap[state.ratioKey] || ratioMap["1:3"];
}

function stateKey() {
  if (state.profile && state.profile.email) {
    return `eyb-static-${String(state.profile.email).toLowerCase()}`;
  }
  return "eyb-static-guest";
}

function sanitizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((task) => {
    if (!task || typeof task.text !== "string") return false;
    const text = task.text.trim();
    if (!text) return false;
    if (legacyDefaultTaskIds.has(task.id)) return false;
    return true;
  });
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function formatMinutes(mins) {
  return `${Math.max(0, Math.round(mins))}m`;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

function linearForecast(values) {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return intercept + slope * n;
}

function addHistory(type, seconds) {
  if (seconds < 60) return;
  state.sessionHistory.push({
    type,
    seconds,
    ts: new Date().toISOString(),
    ratioKey: state.ratioKey
  });
  if (state.sessionHistory.length > 300) {
    state.sessionHistory = state.sessionHistory.slice(-300);
  }
}

function saveState() {
  localStorage.setItem(stateKey(), JSON.stringify({
    ratioKey: state.ratioKey,
    breakBankSeconds: state.breakBankSeconds,
    tasks: state.tasks,
    sessionHistory: state.sessionHistory
  }));
  localStorage.setItem("eyb-static-theme", state.dark ? "dark" : "light");
  localStorage.setItem("eyb-static-profile", JSON.stringify(state.profile));
}

function loadState() {
  try {
    const p = localStorage.getItem("eyb-static-profile");
    if (p) {
      const parsed = JSON.parse(p);
      if (parsed && parsed.email) state.profile = parsed;
    }
  } catch {}

  const theme = localStorage.getItem("eyb-static-theme");
  state.dark = theme === "dark";

  try {
    const raw = localStorage.getItem(stateKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      state.ratioKey = parsed.ratioKey || state.ratioKey;
      if (!ratioMap[state.ratioKey]) state.ratioKey = "1:3";
      state.breakBankSeconds = parsed.breakBankSeconds || 0;
      state.tasks = sanitizeTasks(parsed.tasks);
      if (Array.isArray(parsed.sessionHistory)) {
        state.sessionHistory = parsed.sessionHistory
          .filter((x) => x && (x.type === "focus" || x.type === "break") && Number.isFinite(x.seconds))
          .slice(-300);
      }
    }
  } catch {}
}

function updateTheme() {
  document.documentElement.classList.toggle("dark", state.dark);
}

function setView(v) {
  state.view = v;
  el("workView").classList.toggle("hidden", v !== "work");
  el("insightsView").classList.toggle("hidden", v !== "insights");
  el("guideView").classList.toggle("hidden", v !== "guide");

  el("navWork").classList.toggle("active", v === "work");
  el("navInsights").classList.toggle("active", v === "insights");
  el("navGuide").classList.toggle("active", v === "guide");
}

function setTab(t) {
  state.tab = t;
  el("focusPanel").classList.toggle("hidden", t !== "focus");
  el("breakPanel").classList.toggle("hidden", t !== "break");
  el("tabFocus").classList.toggle("active", t === "focus");
  el("tabBreak").classList.toggle("active", t === "break");
}

function setInsightTab(t) {
  state.insightTab = t;
  el("dashPanel").classList.toggle("hidden", t !== "dashboard");
  el("aiPanel").classList.toggle("hidden", t !== "ai");
  el("dashTab").classList.toggle("active", t === "dashboard");
  el("aiTab").classList.toggle("active", t === "ai");
}

function renderTasks() {
  const list = el("taskList");
  list.innerHTML = "";
  if (!state.tasks.length) {
    const li = document.createElement("li");
    li.className = "task-item";
    li.innerHTML = "<span>No tasks yet. Add one to start your streak.</span>";
    list.appendChild(li);
    return;
  }
  state.tasks.forEach((t) => {
    const li = document.createElement("li");
    li.className = `task-item ${t.done ? "done" : ""}`;
    li.innerHTML = `<input type="checkbox" ${t.done ? "checked" : ""} /><span>${escapeHtml(t.text)}</span>`;
    li.querySelector("input").addEventListener("change", () => {
      t.done = !t.done;
      renderTasks();
      saveState();
    });
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderHeatmap() {
  const hm = el("heatmap");
  hm.innerHTML = "";
  hourlyHeat.forEach(([hour, val]) => {
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    cell.innerHTML = `<span>${hour}</span><strong>${val}m</strong>`;
    hm.appendChild(cell);
  });
}

function renderRecent() {
  const box = el("recentDays");
  box.innerHTML = "";
  trendData.forEach((r) => {
    const row = document.createElement("div");
    row.className = "recent-row";
    row.innerHTML = `<strong>${r.day}</strong><span>Session ${r.focus}m focus</span>`;
    box.appendChild(row);
  });
}

function renderInsights() {
  const focusToday = Math.round(trendData[trendData.length - 1].focus + state.focusSeconds / 60);
  const breakToday = Math.round(trendData[trendData.length - 1].brk + state.breakSeconds / 60);
  const weeklyFocus = trendData.reduce((a, x) => a + x.focus, 0);
  const weeklyBreak = trendData.reduce((a, x) => a + x.brk, 0);
  const avgSession = Math.round(weeklyFocus / trendData.length);
  const sessions = Math.max(1, Math.round(focusToday / 42));
  const score = Math.max(0, Math.min(100, Math.round(55 + state.focusSeconds / 120 - state.breakSeconds / 180)));
  const streak = trendData.filter((x) => x.focus > 0).length;
  const focusValues = trendData.map((d) => d.focus);
  const predictedTomorrow = Math.max(0, Math.round(linearForecast(focusValues)));
  const focusVolatility = stddev(focusValues);
  const consistencyScore = clamp(Math.round(100 - (focusVolatility / Math.max(1, mean(focusValues))) * 120), 40, 99);
  const breakRatioActual = weeklyBreak / Math.max(1, weeklyFocus);
  const peak = hourlyHeat.reduce((best, row) => (row[1] > best[1] ? row : best), hourlyHeat[0]);
  const debtMins = state.breakBankSeconds < 0 ? Math.ceil(Math.abs(state.breakBankSeconds) / getRatio() / 60) : 0;
  const modelConfidence = clamp(Math.round(58 + consistencyScore * 0.35 + Math.min(10, state.sessionHistory.length / 6)), 62, 98);

  const cycleTarget = state.breakBankSeconds < 0 ? breakRatioActual * 0.85 : breakRatioActual * 1.05;
  const bestCycle = Object.entries(ratioMap).sort((a, b) => Math.abs(a[1] - cycleTarget) - Math.abs(b[1] - cycleTarget))[0][0];

  const rewardTier =
    score >= 85 ? "Elite momentum" :
    score >= 70 ? "Strong rhythm" :
    score >= 55 ? "Building momentum" : "Recovery mode";

  el("mScore").textContent = `${score}`;
  el("mStreak").textContent = `${streak} days`;
  el("mFocus").textContent = `${focusToday}m`;
  el("mSessions").textContent = `${sessions}`;
  el("mWeekly").textContent = `${weeklyFocus}m focus / ${weeklyBreak}m break`;
  el("oneLiner").innerHTML = `⚡ <strong>${rewardTier}:</strong> Peak hour is <strong>${peak[0]}-${String(Number(peak[0].slice(0, 2)) + 1).padStart(2, "0")}:00</strong>. Forecast for tomorrow: <strong>${predictedTomorrow}m focus</strong>.`;

  el("aiHeadline").textContent = `Forecast: ${predictedTomorrow}m focus tomorrow with ${consistencyScore}% consistency potential.`;
  el("aiConfidence").textContent = `${modelConfidence}%`;

  const signalGrid = el("aiSignalGrid");
  signalGrid.innerHTML = "";
  const signals = [
    { label: "Predicted Focus", value: formatMinutes(predictedTomorrow), note: "Linear trend (7-day baseline)" },
    { label: "Consistency", value: `${consistencyScore}%`, note: `Volatility ${focusVolatility.toFixed(1)}m` },
    { label: "Peak Window", value: `${peak[0]}-${String(Number(peak[0].slice(0, 2)) + 1).padStart(2, "0")}:00`, note: `${peak[1]} avg mins` },
    { label: "Best Cycle", value: bestCycle, note: `Current data ratio ${(breakRatioActual * 100).toFixed(1)}%` }
  ];
  signals.forEach((sig) => {
    const card = document.createElement("div");
    card.className = "ai-signal";
    card.innerHTML = `<h5>${sig.label}</h5><strong>${sig.value}</strong><p>${sig.note}</p>`;
    signalGrid.appendChild(card);
  });

  const aiEvidence = el("aiEvidence");
  aiEvidence.innerHTML = "";
  const evidenceRows = [
    ["7-day focus total", formatMinutes(weeklyFocus)],
    ["7-day break total", formatMinutes(weeklyBreak)],
    ["Average session length", formatMinutes(avgSession)],
    ["Current bank status", formatSigned(state.breakBankSeconds)],
    ["Debt recovery estimate", debtMins ? formatMinutes(debtMins) : "No debt"]
  ];
  evidenceRows.forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "ai-evidence-row";
    row.innerHTML = `<span>${k}</span><span>${v}</span>`;
    aiEvidence.appendChild(row);
  });

  const ai = [
    `Momentum tier: ${rewardTier}. Keep this by finishing one more focused block above ${avgSession}m.`,
    `Forecast model projects ${predictedTomorrow}m focus tomorrow. Start your first session near ${peak[0]} to improve this projection.`,
    `Cycle recommendation: ${bestCycle}. It best matches your current focus-break balance (${(breakRatioActual * 100).toFixed(1)}% break-to-work).`,
    `Consistency model shows ${consistencyScore}% stability. Keep start time fixed to reduce volatility.`,
    `Live status: focus ${formatClock(state.focusSeconds)}, break ${formatClock(state.breakSeconds)}, bank ${formatSigned(state.breakBankSeconds)}.${debtMins ? ` Recover with about ${debtMins}m focused work.` : ""}`
  ];

  const aiList = el("aiList");
  aiList.innerHTML = "";
  ai.forEach((x) => {
    const li = document.createElement("li");
    li.textContent = x;
    aiList.appendChild(li);
  });
}

function renderBank() {
  const text = formatSigned(state.breakBankSeconds);
  const isPos = state.breakBankSeconds >= 0;
  el("bankInline").textContent = text;
  el("bankInline").className = isPos ? "positive" : "negative";

  el("bankLarge").textContent = text;
  el("bankLarge").className = `bank-large ${isPos ? "positive" : "negative"}`;

  const fill = el("bankFill");
  const pct = Math.max(8, Math.min(100, Math.round((Math.abs(state.breakBankSeconds) / 3600) * 100)));
  fill.style.width = `${pct}%`;
  fill.style.background = isPos ? "var(--green)" : "var(--red)";

  const debtHint = el("debtHint");
  if (state.breakBankSeconds < 0) {
    const mins = Math.ceil(Math.abs(state.breakBankSeconds) / getRatio() / 60);
    debtHint.textContent = `Debt alert: approximately ${mins}m focus needed to recover.`;
    debtHint.classList.remove("hidden");
  } else {
    debtHint.classList.add("hidden");
  }
}

function renderTimers() {
  const earned = Math.floor(state.focusSeconds * getRatio());
  el("focusTime").textContent = formatClock(state.focusSeconds);
  el("earnedTime").textContent = formatClock(earned);
  el("breakTime").textContent = formatClock(state.breakSeconds);
  el("focusStartStop").textContent = state.focusRunning ? "Stop & Bank" : "Start";
  el("breakStartStop").textContent = state.breakRunning ? "Pause Break" : "Start Break";

  const cycle = el("cycleSelect");
  cycle.disabled = state.focusRunning;
}

function stopAndBank() {
  addHistory("focus", state.focusSeconds);
  state.focusRunning = false;
  clearInterval(focusTimer);
  focusTimer = null;
  state.breakBankSeconds += Math.floor(state.focusSeconds * getRatio());
  state.focusSeconds = 0;
  syncAll();
}

function stopBreakSegment() {
  if (breakSegmentStart === null) return;
  const segment = state.breakSeconds - breakSegmentStart;
  addHistory("break", segment);
  breakSegmentStart = null;
}

function syncAll() {
  renderTimers();
  renderBank();
  renderTasks();
  renderInsights();
  updateProfileLabel();
  saveState();
}

function updateProfileLabel() {
  if (state.profile) {
    el("profileBtn").textContent = "Logout";
    el("signedState").textContent = `Signed in: ${state.profile.email}`;
  } else {
    el("profileBtn").textContent = "Profile";
    el("signedState").textContent = "Guest mode (data saved locally)";
  }
}

function bindEvents() {
  el("navWork").addEventListener("click", () => setView("work"));
  el("navInsights").addEventListener("click", () => setView("insights"));
  el("navGuide").addEventListener("click", () => setView("guide"));

  el("tabFocus").addEventListener("click", () => setTab("focus"));
  el("tabBreak").addEventListener("click", () => setTab("break"));

  el("dashTab").addEventListener("click", () => setInsightTab("dashboard"));
  el("aiTab").addEventListener("click", () => setInsightTab("ai"));

  el("focusStartStop").addEventListener("click", () => {
    if (state.focusRunning) {
      stopAndBank();
      return;
    }
    state.focusRunning = true;
    if (!focusTimer) {
      focusTimer = setInterval(() => {
        state.focusSeconds += 1;
        renderTimers();
        renderInsights();
      }, 1000);
    }
    renderTimers();
  });

  el("focusReset").addEventListener("click", () => {
    state.focusRunning = false;
    clearInterval(focusTimer);
    focusTimer = null;
    state.focusSeconds = 0;
    syncAll();
  });

  el("breakStartStop").addEventListener("click", () => {
    state.breakRunning = !state.breakRunning;
    if (state.breakRunning) {
      breakSegmentStart = state.breakSeconds;
      breakTimer = setInterval(() => {
        state.breakSeconds += 1;
        state.breakBankSeconds -= 1;
        renderTimers();
        renderBank();
        renderInsights();
      }, 1000);
    } else {
      stopBreakSegment();
      clearInterval(breakTimer);
      breakTimer = null;
    }
    renderTimers();
  });

  el("breakReset").addEventListener("click", () => {
    state.breakRunning = false;
    stopBreakSegment();
    clearInterval(breakTimer);
    breakTimer = null;
    state.breakSeconds = 0;
    syncAll();
  });

  el("cycleSelect").addEventListener("change", (e) => {
    if (state.focusRunning) {
      e.target.value = state.ratioKey;
      return;
    }
    state.ratioKey = e.target.value;
    syncAll();
  });

  function addTask() {
    const v = el("taskInput").value.trim();
    if (!v) return;
    state.tasks.push({ id: `t-${Date.now()}`, text: v, done: false });
    el("taskInput").value = "";
    syncAll();
  }

  el("taskAddBtn").addEventListener("click", addTask);
  el("taskInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTask();
  });

  el("themeBtn").addEventListener("click", () => {
    state.dark = !state.dark;
    updateTheme();
    saveState();
  });

  el("profileBtn").addEventListener("click", () => {
    if (state.profile) {
      state.profile = null;
      loadState();
      syncAll();
      return;
    }

    const email = prompt("Enter Google email (demo mode):");
    if (!email || !email.includes("@")) return;
    const name = prompt("Enter your name:") || "User";
    state.profile = { email: email.trim(), name: name.trim() };
    loadState();
    syncAll();
  });
}

function init() {
  loadState();
  updateTheme();
  bindEvents();
  setView("work");
  setTab("focus");
  setInsightTab("dashboard");
  el("cycleSelect").value = state.ratioKey;
  renderHeatmap();
  renderRecent();
  syncAll();
}

init();
