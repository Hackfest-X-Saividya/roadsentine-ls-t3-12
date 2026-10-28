const CATEGORY_OPTIONS = {
  transport: { unit: "km", hint: "Enter distance in kilometers.", options: [["car_petrol","Petrol car"],["car_diesel","Diesel car"],["car_hybrid","Hybrid car"],["car_electric","Electric car (charging proxy included)"],["motorcycle","Motorcycle"],["bus","Bus"],["rail","Rail"]] },
  electricity: { unit: "kWh", hint: "Enter total electricity in kilowatt-hours, including any EV charging.", options: [["electricity","Grid electricity"]] },
  fuel: { unit: "L", hint: "Non-transport fuel only. Do not enter vehicle fuel again.", options: [["petrol","Petrol (non-transport)"],["diesel","Diesel (non-transport)"],["lpg","LPG (non-transport)"],["other","Other non-transport fuel"]] },
  waste: { unit: "kg", hint: "Enter one non-overlapping waste stream in kilograms.", options: [["food","Food waste"],["paper","Paper waste"],["plastic","Plastic waste"],["other","Other waste"]] },
};
const CATEGORY_NAMES = { transport: "Transportation", electricity: "Electricity", fuel: "Non-transport fuel", waste: "Waste" };
const CATEGORY_ICONS = { transport: "↗", electricity: "ϟ", fuel: "◉", waste: "♧" };
let activities = [];
let currentTarget = null;
let chart = null;
let challengeDone = new Set(JSON.parse(localStorage.getItem("carbonChallengeDone") || "[]"));
let factorInfo = null;
let cloudReachable = false;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  let body = {};
  try { body = await response.json(); } catch { /* handled as an HTTP error below */ }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function notify(message, error = false) {
  const node = document.getElementById("notice");
  node.textContent = message;
  node.className = `notice${error ? " error" : ""}`;
  node.hidden = false;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => { node.hidden = true; }, 4800);
}
function setLoading(loading, message = "Loading your saved activities…") {
  const state = document.getElementById("loadingState");
  state.hidden = !loading;
  state.setAttribute("aria-busy", String(loading));
  document.getElementById("loadingMessage").textContent = message;
}
function number(value, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function dateToday() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}
function setCategoryOptions(preserve = false) {
  const category = document.getElementById("category").value;
  const config = CATEGORY_OPTIONS[category];
  const select = document.getElementById("subcategory");
  const previous = preserve ? select.value : "";
  select.innerHTML = config.options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  if (config.options.some(([value]) => value === previous)) select.value = previous;
  document.getElementById("quantityUnit").textContent = config.unit;
  document.getElementById("quantityHint").textContent = config.hint;
  document.getElementById("evChargingField").hidden = category !== "electricity";
  if (category !== "electricity") document.getElementById("evCharging").value = 0;
  previewCalculation();
}
function activityPayload() {
  return {
    category: document.getElementById("category").value,
    subcategory: document.getElementById("subcategory").value,
    quantity: Number(document.getElementById("quantity").value),
    ev_charging_kwh: document.getElementById("category").value === "electricity" ? Number(document.getElementById("evCharging").value || 0) : 0,
    date: document.getElementById("activityDate").value,
    note: document.getElementById("activityNote").value,
  };
}
async function previewCalculation() {
  const amount = Number(document.getElementById("quantity").value);
  const box = document.getElementById("calculationPreview");
  if (!amount || amount <= 0) {
    box.innerHTML = "<b>Calculation preview</b><p>Enter an amount to preview its estimated footprint.</p>";
    return;
  }
  try {
    const data = await api("/api/calculate", { method: "POST", body: JSON.stringify(activityPayload()) });
    const c = data.calculation;
    box.innerHTML = `<b>Calculation preview · ${number(c.kg_co2e, 3)} kg CO₂e</b><p>${c.calculation}<br>${c.factor_label} · ${c.geography}, ${c.year} · Provisional estimate.</p>`;
  } catch (error) {
    box.innerHTML = `<b>Calculation preview</b><p>${escapeHtml(error.message)}</p>`;
  }
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function clearActivityForm() {
  document.getElementById("activityForm").reset();
  document.getElementById("editId").value = "";
  document.getElementById("activityDate").value = dateToday();
  document.getElementById("activityFormTitle").textContent = "Log an activity";
  document.getElementById("saveActivity").textContent = "Save activity";
  document.getElementById("cancelEdit").hidden = true;
  setCategoryOptions();
}
function formatActivity(item) {
  const option = CATEGORY_OPTIONS[item.category].options.find(([value]) => value === item.subcategory);
  return option ? option[1] : item.subcategory;
}
function renderActivities() {
  const rows = document.getElementById("activityRows");
  document.getElementById("recordCount").textContent = `${activities.length} record${activities.length === 1 ? "" : "s"}`;
  document.getElementById("activityEmpty").hidden = activities.length > 0;
  rows.innerHTML = activities.map(item => `<tr>
    <td>${escapeHtml(item.date)}</td><td><b>${escapeHtml(formatActivity(item))}</b><br><span class="table-sub">${escapeHtml(CATEGORY_NAMES[item.category])}</span></td>
    <td>${number(item.quantity)} ${escapeHtml(item.unit)}</td><td><b>${number(item.calculation.kg_co2e, 3)} kg</b> CO₂e</td>
    <td>${number(item.calculation.factor, 3)} ${escapeHtml(item.calculation.factor_unit)}<br><span class="table-sub">${escapeHtml(item.calculation.geography)} · ${item.calculation.year}</span></td>
    <td><button class="table-action" data-edit="${item.id}">Edit</button><button class="table-action delete" data-delete="${item.id}">Delete</button></td></tr>`).join("");
}
function recommendationMarkup(item) {
  return `<div class="recommendation-item"><span class="rec-icon">${CATEGORY_ICONS[item.category] || "✳"}</span><div class="rec-body"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.advice)} · ${escapeHtml(item.cost)} cost · ${escapeHtml(item.difficulty)}</p></div><span class="rec-saving">${number(item.estimated_savings_kg_co2e, 2)} kg</span></div>`;
}
function renderBreakdown(summary) {
  const root = document.getElementById("categoryBreakdown");
  const total = summary.total_kg_co2e;
  root.innerHTML = Object.entries(summary.by_category).map(([category, value]) => `<div class="category-row"><div class="category-row-top"><span>${CATEGORY_NAMES[category]}</span><b>${number(value, 2)} kg</b></div><div class="category-bar"><i style="width:${total ? Math.min(100, value / total * 100) : 0}%"></i></div></div>`).join("");
}
function renderTrend(trend) {
  const emptyNode = document.getElementById("trendEmpty");
  const empty = !activities.length;
  emptyNode.textContent = empty
    ? "Add activities to see your trend."
    : "Chart library unavailable. Your activity data is still saved.";
  emptyNode.style.display = empty || !window.Chart ? "flex" : "none";
  const ctx = document.getElementById("trendChart");
  if (chart) chart.destroy();
  if (!window.Chart) return;
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: trend.map(item => item.date.slice(5)), datasets: [{ data: trend.map(item => item.kg_co2e), borderColor: "#368353", backgroundColor: "rgba(54,131,83,.09)", fill: true, tension: .35, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => `${number(item.raw, 3)} kg CO₂e` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7, color: "#89938c", font: { size: 9 } } }, y: { beginAtZero: true, grid: { color: "#edf0ed" }, ticks: { color: "#89938c", font: { size: 9 } } } } },
  });
}
function renderTarget(target) {
  currentTarget = target;
  document.getElementById("targetProgress").textContent = target ? `${number(target.progress_percentage, 0)}%` : "—";
  document.getElementById("targetProgressUnit").textContent = target ? "" : "";
  document.getElementById("targetCaption").textContent = target ? `${number(target.remaining_gap_kg_co2e)} kg CO₂e remaining` : "Set a target to start tracking";
  document.getElementById("targetBar").style.width = target ? `${target.progress_percentage}%` : "0";
  const detail = document.getElementById("targetDetails");
  if (!detail) return;
  detail.innerHTML = target ? `<div class="target-stat-grid"><div class="target-stat"><span>Baseline · ${target.measurement_period_days} days</span><b>${number(target.baseline_kg_co2e)} kg</b></div><div class="target-stat"><span>Target</span><b>${number(target.target_kg_co2e)} kg</b></div><div class="target-stat"><span>Latest ${target.measurement_period_days} days</span><b>${number(target.latest_period_kg_co2e)} kg</b></div></div><p>${target.reduction_percentage}% reduction by ${escapeHtml(target.target_date)} · ${number(target.remaining_gap_kg_co2e)} kg CO₂e remaining. Baseline and latest footprints use equal-length periods.</p>` : "<p>Log activities before setting your first target.</p>";
}
async function loadDashboard() {
  const period = document.getElementById("dashboardPeriod").value;
  const data = await api(`/api/dashboard?period=${period}`);
  document.getElementById("totalEmissions").textContent = number(data.total_kg_co2e);
  document.getElementById("activityCount").textContent = data.activity_count;
  document.getElementById("periodCaption").textContent = `in the last ${data.period_days} day${data.period_days === 1 ? "" : "s"}`;
  document.getElementById("actionSavings").textContent = number(data.estimated_action_savings_kg_co2e);
  renderBreakdown(data);
  renderTrend(data.trend);
  renderTarget(data.target);
  document.getElementById("dashboardRecommendations").innerHTML = data.recommendations.length ? data.recommendations.slice(0, 3).map(recommendationMarkup).join("") : '<div class="empty-state">Log a few activities to get tailored suggestions.</div>';
  document.getElementById("largestSources").innerHTML = data.largest_sources.length ? data.largest_sources.map(item => `<div class="source-row"><span>${escapeHtml(item.label)} · ${escapeHtml(item.date)}</span><b>${number(item.kg_co2e)} kg</b></div>`).join("") : '<div class="empty-state">Your largest sources will appear here.</div>';
}
async function loadPlanner() {
  const data = await api("/api/actions");
  const target = await api("/api/targets");
  renderTarget(target);
  document.getElementById("plannerSummary").innerHTML = data.available.length ? `<strong>${number(data.available.reduce((sum, item) => sum + item.estimated_savings_kg_co2e, 0))} kg CO₂e</strong>estimated action opportunity. Savings are planning estimates, calculated from saved factors.` : "Add activities to see action ideas based on your footprint.";
  document.getElementById("plannerActions").innerHTML = data.available.length ? data.available.map(item => `<div class="action-card"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.advice)}</p><div class="action-meta"><span class="tag">${escapeHtml(item.cost)} cost</span><span class="tag">${escapeHtml(item.difficulty)}</span></div></div><button class="complete-button" data-complete="${item.id}">Mark done</button><div class="action-estimate">${number(item.estimated_savings_kg_co2e)} kg CO₂e estimated opportunity</div></div>`).join("") : '<div class="empty-state">Suggestions will appear when you log activities.</div>';
  document.getElementById("completedActions").innerHTML = data.completed.length ? data.completed.map(completedMarkup).join("") : '<div class="empty-state">No completed actions yet.</div>';
}
function completedMarkup(item) {
  return `<div class="completed-row"><span>${escapeHtml(item.title)}<small>Completed ${escapeHtml(item.completed_date)} · estimate, not verified</small></span><strong>${number(item.estimated_savings_kg_co2e)} kg*</strong></div>`;
}
async function loadProgress() {
  const days = document.getElementById("progressDays").value;
  const data = await api(`/api/progress?days=${days}`);
  document.getElementById("progressCurrent").textContent = number(data.current.total_kg_co2e);
  document.getElementById("progressCurrentCount").textContent = `${data.current.activity_count} activities · latest ${days} days`;
  document.getElementById("progressBaseline").textContent = number(data.baseline.total_kg_co2e);
  const up = data.absolute_change_kg_co2e > 0;
  document.getElementById("progressChange").textContent = `${up ? "+" : ""}${number(data.absolute_change_kg_co2e)}`;
  document.getElementById("progressChange").style.color = up ? "#a35b4f" : "#35764b";
  document.getElementById("progressPercent").textContent = data.percentage_change === null ? "No previous activity baseline" : `${up ? "+" : ""}${number(data.percentage_change)}% vs previous equal-length period`;
  document.getElementById("progressEstimated").textContent = number(data.estimated_action_savings_kg_co2e);
  document.getElementById("progressInterpretation").textContent = data.interpretation;
  document.getElementById("progressTarget").innerHTML = data.target ? `Target: reduce ${data.target.reduction_percentage}% from ${number(data.target.baseline_kg_co2e)} kg CO₂e to ${number(data.target.target_kg_co2e)} kg. Latest ${data.target.measurement_period_days}-day estimate: ${number(data.target.latest_period_kg_co2e)} kg, with ${number(data.target.remaining_gap_kg_co2e)} kg remaining. ${number(data.target.progress_percentage, 0)}% progress toward the target calculation.` : "No target set. Set one in the Reduction planner when you are ready.";
  document.getElementById("progressActions").innerHTML = data.completed_actions.length ? data.completed_actions.map(completedMarkup).join("") : '<div class="empty-state">Completed actions will appear here.</div>';
}
async function loadAdvisor() {
  const recs = await api("/api/recommendations");
  document.getElementById("advisorSuggestions").innerHTML = recs.length ? recs.slice(0, 4).map(recommendationMarkup).join("") : '<div class="empty-state">Log activities to receive personalized suggestions.</div>';
}
async function loadFactors() {
  factorInfo = await api("/api/factors");
  document.getElementById("factorSource").textContent = factorInfo.source;
  document.getElementById("factorGeoYear").textContent = `${factorInfo.geography} · ${factorInfo.year}`;
  document.getElementById("factorBoundary").textContent = factorInfo.boundary;
  document.getElementById("factorAssumptions").textContent = factorInfo.assumptions;
}
async function loadAll() {
  setLoading(true, "Loading your saved activities…");
  try {
    activities = await api("/api/activities");
    renderActivities();
    await loadDashboard();
    await loadPlanner();
    await loadAdvisor();
    await loadProgress();
    await refreshSimulator();
    document.getElementById("serviceStatus").textContent = cloudReachable
      ? "Local-first · cloud backup available"
      : "Local-only · private on this device";
  } catch (error) {
    notify(`Could not load your data: ${error.message}`, true);
    document.getElementById("serviceStatus").textContent = "Local service unavailable";
    return false;
  } finally {
    setLoading(false);
  }
  return true;
}
async function refreshSimulator() {
  const reduction = Number(document.getElementById("simulationSlider").value);
  const data = await api("/api/simulate", { method: "POST", body: JSON.stringify({ reduction_percentage: reduction }) });
  document.getElementById("simulationLabel").textContent = `${reduction}%`;
  document.getElementById("simPct").textContent = `${reduction}%`;
  document.getElementById("simSavings").textContent = number(data.estimated_savings_kg_co2e);
  document.getElementById("simTotal").textContent = number(data.scenario_kg_co2e);
}
const CHALLENGE_ITEMS = [
  ["Plan a no-waste meal", "Check what you have before your next grocery trip.", "food-waste"],
  ["Try a short walk", "Replace one nearby vehicle trip with a walk if it's safe.", "walk-bike"],
  ["Switch off idle devices", "Unplug or switch off one device you're not using.", "electricity"],
  ["Sort one recycling stream", "Check local guidance and separate one material.", "waste-sort"],
  ["Share a ride", "Coordinate one shared journey with someone nearby.", "car-share"],
  ["Try public transport", "Use a bus or train for one trip this week.", "transit"],
];
async function loadChallenge() {
  document.getElementById("challengeCount").textContent = challengeDone.size;
  document.getElementById("challengeBar").style.width = `${challengeDone.size / 30 * 100}%`;
  document.getElementById("challengeDays").innerHTML = Array.from({ length: 30 }, (_, index) => {
    const day = index + 1, [title, description, action] = CHALLENGE_ITEMS[index % CHALLENGE_ITEMS.length], done = challengeDone.has(day);
    return `<article class="challenge-day${done ? " done" : ""}"><span class="day-number">${done ? "✓" : String(day).padStart(2, "0")}</span><div><h3>Day ${day} · ${title}</h3><p>${description}</p><button data-challenge="${day}" data-action="${action}">${done ? "Completed" : "Mark complete"}</button></div></article>`;
  }).join("");
}
function showPage(name) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === `page-${name}`));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.page === name));
  const link = document.querySelector(`.nav-link[data-page="${name}"]`);
  document.getElementById("pageTitle").textContent = link ? link.textContent.trim().replace(/^[◫＋✳◎⌁♧↗]\s*/, "") : "Overview";
  document.querySelector(".sidebar").classList.remove("open");
  if (name === "dashboard") loadDashboard().catch(error => notify(error.message, true));
  if (name === "planner") loadPlanner().catch(error => notify(error.message, true));
  if (name === "progress") loadProgress().catch(error => notify(error.message, true));
  if (name === "advisor") loadAdvisor().catch(error => notify(error.message, true));
}
function bindEvents() {
  document.getElementById("navigation").addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (button) showPage(button.dataset.page);
  });
  document.body.addEventListener("click", async event => {
    const go = event.target.closest("[data-go]");
    if (go) showPage(go.dataset.go);
    const edit = event.target.closest("[data-edit]");
    if (edit) {
      const item = activities.find(row => row.id === edit.dataset.edit);
      if (!item) return;
      document.getElementById("editId").value = item.id;
      document.getElementById("category").value = item.category;
      setCategoryOptions();
      document.getElementById("subcategory").value = item.subcategory;
      document.getElementById("quantity").value = item.quantity;
      document.getElementById("activityDate").value = item.date;
      document.getElementById("activityNote").value = item.note;
      document.getElementById("evCharging").value = item.ev_charging_kwh || 0;
      previewCalculation();
      document.getElementById("activityFormTitle").textContent = "Edit activity";
      document.getElementById("saveActivity").textContent = "Save changes";
      document.getElementById("cancelEdit").hidden = false;
      showPage("activities");
    }
    const remove = event.target.closest("[data-delete]");
    if (remove) {
      if (!confirm("Delete this activity record? This cannot be undone.")) return;
      try { await api(`/api/activities/${remove.dataset.delete}`, { method: "DELETE" }); await loadAll(); notify("Activity deleted."); }
      catch (error) { notify(error.message, true); }
    }
    const complete = event.target.closest("[data-complete]");
    if (complete) {
      try { await api(`/api/actions/${complete.dataset.complete}/complete`, { method: "POST", body: "{}" }); await loadAll(); notify("Action marked complete. Its savings remain an estimate."); }
      catch (error) { notify(error.message, true); }
    }
    const challenge = event.target.closest("[data-challenge]");
    if (challenge && !challengeDone.has(Number(challenge.dataset.challenge))) {
      const day = Number(challenge.dataset.challenge);
      challengeDone.add(day);
      localStorage.setItem("carbonChallengeDone", JSON.stringify([...challengeDone]));
      try {
        await api(`/api/actions/${challenge.dataset.action}/complete`, { method: "POST", body: "{}" });
      } catch (error) {
        notify(`Challenge day saved on this device, but action history could not be updated: ${error.message}`, true);
      }
      loadChallenge();
    }
  });
  document.getElementById("category").addEventListener("change", () => setCategoryOptions());
  document.getElementById("subcategory").addEventListener("change", previewCalculation);
  document.getElementById("quantity").addEventListener("input", previewCalculation);
  document.getElementById("evCharging").addEventListener("input", previewCalculation);
  document.getElementById("activityDate").addEventListener("change", previewCalculation);
  document.getElementById("activityForm").addEventListener("submit", async event => {
    event.preventDefault();
    const id = document.getElementById("editId").value;
    const saveButton = document.getElementById("saveActivity");
    saveButton.disabled = true;
    saveButton.textContent = id ? "Saving…" : "Adding…";
    try {
      const saved = await api(id ? `/api/activities/${id}` : "/api/activities", { method: id ? "PUT" : "POST", body: JSON.stringify(activityPayload()) });
      clearActivityForm();
      await loadAll();
      document.getElementById("formMessage").textContent = `${number(saved.calculation.kg_co2e, 3)} kg CO₂e estimated.`;
      notify(id ? "Activity updated." : "Activity saved.");
    } catch (error) {
      document.getElementById("formMessage").textContent = error.message;
      notify(error.message, true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = document.getElementById("editId").value ? "Save changes" : "Save activity";
    }
  });
  document.getElementById("cancelEdit").addEventListener("click", clearActivityForm);
  document.getElementById("dashboardPeriod").addEventListener("change", () => loadDashboard().catch(error => notify(error.message, true)));
  document.getElementById("progressDays").addEventListener("change", () => loadProgress().catch(error => notify(error.message, true)));
  document.getElementById("targetForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      await api("/api/targets", { method: "POST", body: JSON.stringify({ reduction_percentage: Number(document.getElementById("targetReduction").value), duration_days: Number(document.getElementById("targetDuration").value) }) });
      await loadAll();
      notify("Your target has been saved.");
    } catch (error) { notify(error.message, true); }
    finally { submit.disabled = false; submit.textContent = "Set my target"; }
  });
  document.getElementById("simulationSlider").addEventListener("input", () => refreshSimulator().catch(error => notify(error.message, true)));
  document.getElementById("advisorForm").addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.getElementById("advisorQuestion"), question = input.value.trim();
    if (!question) return;
    const history = document.getElementById("chatHistory");
    history.insertAdjacentHTML("beforeend", `<div class="chat-message user-message">${escapeHtml(question)}</div>`);
    input.value = "";
    const submit = event.submitter;
    if (submit) { submit.disabled = true; submit.textContent = "Thinking…"; }
    try {
      const result = await api("/api/advisor", { method: "POST", body: JSON.stringify({ question }) });
      history.insertAdjacentHTML("beforeend", `<div class="chat-message assistant-message">${escapeHtml(result.answer)}${result.notice ? `<br><small>${escapeHtml(result.notice)}</small>` : ""}</div>`);
      document.getElementById("advisorMode").textContent = result.mode === "ai-assisted" ? "AI-assisted wording · calculations remain deterministic" : "Deterministic guidance is ready";
    } catch (error) {
      history.insertAdjacentHTML("beforeend", `<div class="chat-message assistant-message">I couldn’t answer just now: ${escapeHtml(error.message)}</div>`);
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = "Ask advisor <span>→</span>"; }
      history.scrollTop = history.scrollHeight;
    }
  });
  document.getElementById("mobileMenu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.getElementById("refreshButton").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (await loadAll()) notify("Your dashboard is up to date.");
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("cloudButton").addEventListener("click", () => {
    renderCloudAccount();
    document.getElementById("cloudDialog").showModal();
  });
  document.getElementById("cloudAuthForm").addEventListener("submit", async event => {
    event.preventDefault();
    await authenticateCloud("/api/cloud/sign-in");
  });
  document.getElementById("cloudSignUp").addEventListener("click", () => authenticateCloud("/api/cloud/sign-up"));
  document.getElementById("cloudSignOut").addEventListener("click", () => {
    sessionStorage.removeItem("carbonCloudToken");
    sessionStorage.removeItem("carbonCloudEmail");
    renderCloudAccount();
  });
  document.getElementById("cloudBackup").addEventListener("click", async () => {
    const message = document.getElementById("cloudBackupMessage");
    const backupButton = document.getElementById("cloudBackup");
    backupButton.disabled = true;
    backupButton.textContent = "Backing up…";
    message.textContent = "Backing up…";
    message.classList.remove("error");
    try {
      const result = await api("/api/cloud/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionStorage.getItem("carbonCloudToken")}` },
        body: "{}",
      });
      message.textContent = `${result.activity_count} activities, ${result.target_backed_up ? "1 target" : "no target"}, and ${result.completed_actions_count} completed actions backed up.`;
      notify("Cloud backup completed.");
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    } finally {
      backupButton.disabled = false;
      backupButton.textContent = "Back up local data";
    }
  });
}
function renderCloudAccount() {
  const signedIn = Boolean(sessionStorage.getItem("carbonCloudToken"));
  document.getElementById("cloudSignedOut").hidden = signedIn;
  document.getElementById("cloudSignedIn").hidden = !signedIn;
  if (signedIn) {
    document.getElementById("cloudUserEmail").textContent = sessionStorage.getItem("carbonCloudEmail") || "Authenticated account";
  }
}
async function authenticateCloud(endpoint) {
  const message = document.getElementById("cloudAuthMessage");
  const buttons = [...document.querySelectorAll("#cloudAuthForm button")];
  const labels = buttons.map(button => button.textContent);
  buttons.forEach(button => { button.disabled = true; });
  message.textContent = "Contacting your configured Supabase Auth service…";
  message.classList.remove("error");
  try {
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("cloudEmail").value,
        password: document.getElementById("cloudPassword").value,
      }),
    });
    if (result.access_token) {
      sessionStorage.setItem("carbonCloudToken", result.access_token);
      sessionStorage.setItem("carbonCloudEmail", result.user.email || "");
      document.getElementById("cloudPassword").value = "";
      renderCloudAccount();
    } else {
      message.textContent = "Account created. Check your email to confirm the address, then sign in.";
    }
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    buttons.forEach((button, index) => {
      button.disabled = false;
      button.textContent = labels[index];
    });
  }
}
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("activityDate").value = dateToday();
  document.getElementById("activityDate").max = dateToday();
  setCategoryOptions();
  bindEvents();
  loadChallenge();
  try {
    const health = await api("/api/health");
    cloudReachable = health.cloudReachable;
    document.getElementById("serviceStatus").textContent = cloudReachable ? "Local-first · cloud backup available" : "Local-only · private on this device";
    if (!cloudReachable) {
      document.getElementById("cloudAuthMessage").textContent = "Supabase is not configured or reachable. Your local app remains available without it.";
    }
    document.getElementById("advisorMode").textContent = health.aiEnabled ? "AI available for wording · deterministic fallback ready" : "Deterministic guidance is ready";
    await loadFactors();
  } catch (error) {
    notify(`Service status unavailable: ${error.message}`, true);
    document.getElementById("serviceStatus").textContent = "Local service unavailable";
  }
  renderCloudAccount();
  await loadAll();
});
