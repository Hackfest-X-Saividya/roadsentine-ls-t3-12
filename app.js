"use strict";

(() => {
  const STORAGE_KEY = "carbon-copilot-v1";
  const DEFAULT_FACTORS = Object.freeze({
    electricity: 0.716,
    petrol: 2.31,
    diesel: 2.68,
    lpg: 3.0,
    otherFuel: 2.5,
    foodWaste: 2.5,
    paperWaste: 1.0,
    plasticWaste: 2.5,
    otherWaste: 0.5,
    petrolCar: 0.192,
    dieselCar: 0.171,
    electricCar: 0.053,
    motorcycle: 0.103,
    bus: 0.105,
    rail: 0.041,
    active: 0
  });
  const INPUT_FIELDS = [
    "vehicleDistance", "busDistance", "railDistance", "electricityKwh",
    "petrolLitres", "dieselLitres", "lpgKg", "otherFuelLitres",
    "foodWasteKg", "paperWasteKg", "plasticWasteKg", "otherWasteKg"
  ];
  const INPUT_LIMITS = {
    vehicleDistance: 2000, busDistance: 2000, railDistance: 3000,
    electricityKwh: 5000, petrolLitres: 500, dieselLitres: 500,
    lpgKg: 500, otherFuelLitres: 500, foodWasteKg: 500,
    paperWasteKg: 500, plasticWasteKg: 500, otherWasteKg: 500
  };
  const CATEGORY_LABELS = {
    transport: "Transportation",
    electricity: "Electricity",
    fuel: "Other fuel",
    waste: "Waste"
  };
  const CATEGORY_COLORS = {
    transport: "#57936a",
    electricity: "#d8a550",
    fuel: "#db9660",
    waste: "#8884b7"
  };
  const ICONS = { transport: "↗", electricity: "ϟ", fuel: "♨", waste: "♻" };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const todayISO = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const emptyState = () => ({
    version: 1,
    records: [],
    factors: { ...DEFAULT_FACTORS },
    goal: null,
    profile: { name: "", location: "", budget: "any", transport: "any", preferences: "" },
    planned: [],
    completed: [],
    chat: [],
    challenge: null
  });
  let state = loadState();
  let chart = null;
  let toastTimer;
  const cloud = {
    apiAvailable: false,
    enabled: false,
    token: sessionStorage.getItem("carbon-copilot-access-token") || "",
    user: null,
    signup: false,
    actionIds: {}
  };

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return emptyState();
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) return emptyState();
      const fresh = emptyState();
      return {
        ...fresh,
        ...parsed,
        factors: { ...DEFAULT_FACTORS, ...(parsed.factors || {}) },
        profile: { ...fresh.profile, ...(parsed.profile || {}) },
        planned: Array.isArray(parsed.planned) ? parsed.planned : [],
        completed: Array.isArray(parsed.completed) ? parsed.completed : [],
        chat: Array.isArray(parsed.chat) ? parsed.chat.slice(-30) : []
      };
    } catch (error) {
      console.error("Could not read Carbon Copilot data from local storage.", error);
      return emptyState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save Carbon Copilot data to local storage.", error);
      showToast("Your browser could not save the latest changes. Check local storage availability.");
    }
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function kg(value, digits = 1) {
    return `${num(value).toFixed(digits)}`;
  }
  function dateLabel(iso, options = { month: "short", day: "numeric" }) {
    const date = new Date(`${iso}T12:00:00`);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, options);
  }
  function calendarDaysBetween(startISO, endISO) {
    const start = Date.parse(`${startISO}T00:00:00Z`);
    const end = Date.parse(`${endISO}T00:00:00Z`);
    return Math.floor((end - start) / 86400000);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
  function calculateRecord(record) {
    const factor = { ...state.factors, ...(record.factors || {}) };
    const vehicleFactor = record.vehicleType === "electricCar" || record.vehicleType === "motorcycle" || record.vehicleType === "active"
      ? factor[record.vehicleType]
      : factor[record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar"];
    const transport = num(record.vehicleDistance) * num(vehicleFactor)
      + num(record.busDistance) * num(factor.bus)
      + num(record.railDistance) * num(factor.rail);
    const electricity = num(record.electricityKwh) * num(factor.electricity);
    const fuel = num(record.petrolLitres) * num(factor.petrol)
      + num(record.dieselLitres) * num(factor.diesel)
      + num(record.lpgKg) * num(factor.lpg)
      + num(record.otherFuelLitres) * num(factor.otherFuel);
    const waste = num(record.foodWasteKg) * num(factor.foodWaste)
      + num(record.paperWasteKg) * num(factor.paperWaste)
      + num(record.plasticWasteKg) * num(factor.plasticWaste)
      + num(record.otherWasteKg) * num(factor.otherWaste);
    return { transport, electricity, fuel, waste, total: transport + electricity + fuel + waste };
  }
  function sortedRecords() {
    return [...state.records].sort((a, b) => a.date.localeCompare(b.date));
  }
  function statsFor(records) {
    if (!records.length) return { days: 0, average: 0, total: 0, categories: { transport: 0, electricity: 0, fuel: 0, waste: 0 } };
    const categories = { transport: 0, electricity: 0, fuel: 0, waste: 0 };
    let total = 0;
    for (const record of records) {
      const result = calculateRecord(record);
      total += result.total;
      for (const key of Object.keys(categories)) categories[key] += result[key];
    }
    return { days: records.length, average: total / records.length, total, categories };
  }
  function baselineStats() {
    return statsFor(sortedRecords().slice(0, 7));
  }
  function latestStats() {
    const records = sortedRecords();
    return statsFor(records.length > 7 ? records.slice(7).slice(-7) : records);
  }
  function hasPostBaselineData() {
    return sortedRecords().length > 7;
  }
  function goalValues() {
    const baseline = baselineStats();
    if (!state.goal || !baseline.days) return { baseline: baseline.average, target: null, reduction: state.goal ? state.goal.percent : null };
    return { baseline: baseline.average, target: baseline.average * (1 - state.goal.percent / 100), reduction: state.goal.percent };
  }

  function showToast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 3000);
  }
  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
  function selectedRecords() {
    const period = $("#categoryPeriod").value;
    const records = sortedRecords();
    if (period === "all") return records;
    return records.slice(-Number(period));
  }

  function render() {
    renderProfile();
    renderSummary();
    renderCategories();
    renderTrend();
    renderSources();
    renderRecommendations();
    renderPlanner();
    renderSimulator();
    renderChallenge();
    renderProgress();
    renderHistory();
    renderFactorInputs();
    renderChat();
    updateDateEntry();
    renderCalculationPreview();
  }
  function renderProfile() {
    const displayName = state.profile.name || "Your profile";
    setValue("profileName", displayName);
    setValue("profileLocation", state.profile.location || "Your sustainability profile");
    $(".avatar").textContent = displayName === "Your profile" ? "A" : displayName.trim().charAt(0).toUpperCase();
  }
  function renderSummary() {
    const latest = latestStats();
    const baseline = baselineStats();
    const values = goalValues();
    setValue("currentFootprint", latest.days ? kg(latest.average) : "0.0");
    setValue("footprintPeriod", latest.days
      ? `Average per recorded day · ${hasPostBaselineData() ? "since baseline" : "baseline period"}`
      : "Average per recorded day · last 7 days");
    setValue("targetDaily", values.target !== null ? `${kg(values.target)} kg / day` : "Set a target");
    const badge = $("#changeBadge");
    if (latest.days && hasPostBaselineData()) {
      const change = latest.average - baseline.average;
      const percent = baseline.average ? Math.abs(change / baseline.average * 100) : 0;
      badge.className = `delta-badge ${change < 0 ? "down" : change > 0 ? "up" : "neutral"}`;
      badge.textContent = `${change < 0 ? "↓" : change > 0 ? "↑" : "→"} ${percent.toFixed(0)}%`;
      setValue("changeCaption", `${latest.days} later recorded ${latest.days === 1 ? "day" : "days"} vs. baseline`);
    } else {
      badge.className = "delta-badge neutral";
      badge.textContent = "—";
      setValue("changeCaption", "Log activity beyond the first 7 days to measure change");
    }
    $("#todayPill").textContent = todayISO() === (state.records.at(-1) || {}).date ? "UPDATED TODAY" : "MEASURED";
    const goal = state.goal;
    if (!goal) {
      setValue("targetStatus", "GET STARTED");
      setValue("targetSummary", "Make a goal that works for you");
      setValue("targetDescription", "Set a target and Carbon Copilot will help you turn it into practical weekly actions.");
      setValue("goalProgressText", "0%");
      $("#goalProgressBar").style.width = "0%";
      return;
    }
    setValue("targetStatus", values.target === null ? "LOG BASELINE" : "IN PROGRESS");
    setValue("targetSummary", `Reduce your footprint by ${goal.percent}%`);
    setValue("targetDescription", values.target === null
      ? `Target set for ${goal.days} days. Log activity to establish your baseline.`
      : `Your goal: reach ${kg(values.target)} kg CO₂e per recorded day in ${goal.days} days.`);
    const progress = baseline.days && values.target !== null && hasPostBaselineData()
      ? Math.max(0, Math.min(100, (baseline.average - latest.average) / Math.max(baseline.average - values.target, 0.001) * 100))
      : 0;
    setValue("goalProgressText", `${Math.round(progress)}%`);
    $("#goalProgressBar").style.width = `${progress}%`;
  }
  function renderCategories() {
    const stats = statsFor(selectedRecords());
    const total = stats.total;
    for (const key of Object.keys(CATEGORY_LABELS)) {
      setValue(`${key}Value`, `${kg(stats.categories[key])} kg`);
      setValue(`${key}Share`, total ? `${Math.round(stats.categories[key] / total * 100)}% of selected period` : "No data yet");
    }
  }
  function renderTrend() {
    const records = sortedRecords();
    const grouping = $("#trendPeriod").value;
    const groups = new Map();
    for (const record of records) {
      let label = record.date;
      if (grouping === "weekly") {
        const date = new Date(`${record.date}T12:00:00`);
        const day = (date.getDay() + 6) % 7;
        date.setDate(date.getDate() - day);
        label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      } else if (grouping === "monthly") {
        label = record.date.slice(0, 7);
      }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(calculateRecord(record).total);
    }
    const labels = [...groups.keys()];
    const values = labels.map(key => {
      const list = groups.get(key);
      return list.reduce((sum, item) => sum + item, 0) / list.length;
    });
    const prettyLabels = labels.map(label => {
      if (grouping === "monthly") return dateLabel(`${label}-01`, { month: "short", year: "2-digit" });
      if (grouping === "weekly") return `Week of ${dateLabel(label)}`;
      return dateLabel(label);
    });
    const goal = goalValues();
    setValue("trendSummary", values.length ? `${kg(values[values.length - 1])} kg CO₂e average` : "Start logging to see your trend");
    setValue("trendSubsummary", grouping === "daily" ? "Each point is one recorded day." : `Each point is the average across recorded days in that ${grouping === "weekly" ? "week" : "month"}.`);
    $("#chartEmpty").hidden = values.length > 0;
    if (!window.Chart) {
      if (values.length) {
        $("#chartEmpty").hidden = false;
        $("#chartEmpty").textContent = "The chart library could not load; your activity and estimates are still available.";
      }
      return;
    }
    const canvas = $("#trendChart");
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: prettyLabels,
        datasets: [
          { label: "Measured footprint", data: values, borderColor: "#57936a", backgroundColor: "rgba(87,147,106,.12)", borderWidth: 2, pointRadius: values.length > 14 ? 1 : 3, pointHoverRadius: 5, tension: .35, fill: true },
          ...(goal.target !== null ? [{ label: "Target daily average", data: labels.map(() => goal.target), borderColor: "#bdc5bd", borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false }] : [])
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${kg(context.parsed.y, 2)} kg CO₂e` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#98a29a", maxTicksLimit: 7, font: { size: 8 } }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: "#f0f2ef" }, ticks: { color: "#a1aaa2", font: { size: 8 }, callback: value => `${value} kg` }, border: { display: false } }
        }
      }
    });
  }
  function renderSources() {
    const stats = statsFor(selectedRecords());
    const sorted = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);
    const list = $("#sourceList");
    if (!stats.days || !stats.total) {
      list.innerHTML = '<div class="empty-inline">Log activity to see your largest emission sources.</div>';
      setValue("sourceInsight", "Your personalized insight will appear once you log activity.");
      return;
    }
    list.innerHTML = sorted.filter(item => item[1] > 0).slice(0, 4).map(([key, value]) => `
      <div class="source-row"><span>${CATEGORY_LABELS[key]}</span><div class="source-meter"><span style="width:${Math.max(3, value / stats.total * 100)}%;background:${CATEGORY_COLORS[key]}"></span></div><span>${Math.round(value / stats.total * 100)}%</span></div>
    `).join("") || '<div class="empty-inline">No emissions in the selected period.</div>';
    const leading = sorted[0];
    setValue("sourceInsight", `${CATEGORY_LABELS[leading[0]]} is your largest source at ${Math.round(leading[1] / stats.total * 100)}% of recorded emissions in this period.`);
  }

  function recommendations() {
    const records = sortedRecords().slice(-7);
    const stats = statsFor(records);
    if (!stats.days || !stats.total) return [];
    const avgCats = Object.fromEntries(Object.entries(stats.categories).map(([key, value]) => [key, value / stats.days]));
    const avgInputs = {};
    for (const field of INPUT_FIELDS) avgInputs[field] = records.reduce((sum, record) => sum + num(record[field]), 0) / records.length;
    const factorForRecord = (record, key) => num((record.factors || {})[key] ?? state.factors[key]);
    const averageEmissions = (field, factorKey) => records.reduce(
      (sum, record) => sum + num(record[field]) * factorForRecord(record, factorKey),
      0
    ) / records.length;
    const options = [];
    const add = (data) => {
      if (data.saving > 0.005) options.push({ ...data, saving: data.saving * 7 });
    };
    let averageCarKm = 0;
    let averageCarEmissions = 0;
    for (const record of records) {
      const factor = record.vehicleType === "electricCar"
        ? factorForRecord(record, "electricCar")
        : record.vehicleType === "motorcycle"
          ? factorForRecord(record, "motorcycle")
          : record.vehicleType === "active"
            ? factorForRecord(record, "active")
            : factorForRecord(record, record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar");
      averageCarKm += num(record.vehicleDistance) / records.length;
      averageCarEmissions += num(record.vehicleDistance) * num(factor) / records.length;
    }
    let fossilCarKm = 0;
    let fossilCarEmissions = 0;
    let fossilRailEmissions = 0;
    for (const record of records) {
      if (!["petrolCar", "dieselCar"].includes(record.vehicleType)) continue;
      const carFactor = factorForRecord(record, record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar");
      fossilCarKm += num(record.vehicleDistance) / records.length;
      fossilCarEmissions += num(record.vehicleDistance) * carFactor / records.length;
      fossilRailEmissions += num(record.vehicleDistance) * factorForRecord(record, "rail") / records.length;
    }
    const hasCar = averageCarKm > 0;
    if (fossilCarKm > 0 && state.profile.transport !== "limited") {
      const weightedFactor = fossilCarEmissions / fossilCarKm;
      const weightedRailFactor = fossilRailEmissions / fossilCarKm;
      add({
        id: "transit-swap", category: "transport", icon: "↗",
        title: "Swap one short car trip for transit",
        reason: `Your petrol or diesel car travel is a major opportunity. Replacing 20% of your average car distance with rail is a practical starting point${state.profile.location ? ` if available in ${state.profile.location}` : ""}.`,
        saving: Math.max(0, fossilCarEmissions - fossilRailEmissions) * 0.2,
        impact: "High", cost: "Low cost", difficulty: state.profile.transport === "transit" ? "Easy" : "Moderate",
        why: `Estimate: 20% of ${kg(fossilCarKm, 1)} km/day shifted from personal petrol/diesel car travel (weighted ${kg(weightedFactor, 3)} → ${kg(weightedRailFactor, 3)} kg CO₂e/km). Check local routes${state.profile.location ? ` around ${state.profile.location}` : ""}.`
      });
    }
    if (hasCar) {
      add({
        id: "carpool", category: "transport", icon: "↗",
        title: "Combine errands or carpool",
        reason: "Fewer solo vehicle kilometres can lower transport emissions without requiring a new purchase.",
        saving: averageCarEmissions * 0.15,
        impact: "Medium", cost: "Free", difficulty: "Easy",
        why: `Estimate: reduce personal-vehicle distance by 15%; uses your recorded vehicle mix (${kg(averageCarEmissions, 2)} kg CO₂e/day).`
      });
    }
    if (avgCats.electricity > 0) {
      add({
        id: "electricity-trim", category: "electricity", icon: "ϟ",
        title: "Trim electricity use by 10%",
        reason: "Small changes to cooling, standby power, and lighting can add up across the week.",
        saving: avgCats.electricity * 0.1,
        impact: avgCats.electricity > stats.average * 0.3 ? "High" : "Medium",
        cost: "Free", difficulty: "Easy",
        why: `Estimate: 10% of recent factor-weighted electricity emissions (${kg(avgCats.electricity, 2)} kg CO₂e/day across ${kg(avgInputs.electricityKwh, 1)} kWh/day).`
      });
    }
    if (avgInputs.lpgKg > 0 || avgInputs.petrolLitres > 0 || avgInputs.dieselLitres > 0 || avgInputs.otherFuelLitres > 0) {
      add({
        id: "fuel-efficiency", category: "fuel", icon: "♨",
        title: "Reduce non-transport fuel use by 10%",
        reason: "Check burner maintenance and avoid unnecessary heating or cooking fuel use where practical.",
        saving: avgCats.fuel * 0.1,
        impact: avgCats.fuel > stats.average * 0.3 ? "High" : "Medium",
        cost: "Free", difficulty: "Easy",
        why: `Estimate: 10% reduction in your recorded non-transport fuel emissions (${kg(avgCats.fuel, 2)} kg CO₂e/day). Transport fuel is not counted here.`
      });
    }
    if (avgInputs.foodWasteKg > 0) {
      const averageFoodWasteEmissions = averageEmissions("foodWasteKg", "foodWaste");
      add({
        id: "food-waste", category: "waste", icon: "♻",
        title: "Prevent one quarter of food waste",
        reason: "Planning meals and storing leftovers well can prevent avoidable food waste.",
        saving: averageFoodWasteEmissions * 0.25,
        impact: avgCats.waste > stats.average * 0.2 ? "High" : "Medium",
        cost: "Free", difficulty: "Easy",
        why: `Estimate: prevent 25% of recent average food-waste emissions (${kg(averageFoodWasteEmissions, 2)} kg CO₂e/day; provisional disposal factors).`
      });
    }
    if (avgInputs.plasticWasteKg > 0 || avgInputs.otherWasteKg > 0) {
      const potential = averageEmissions("plasticWasteKg", "plasticWaste")
        + averageEmissions("otherWasteKg", "otherWaste");
      add({
        id: "waste-sort", category: "waste", icon: "♻",
        title: "Sort recyclable waste locally",
        reason: `If local collection accepts these materials${state.profile.location ? ` near ${state.profile.location}` : ""}, sorting them can reduce mixed-waste disposal.`,
        saving: potential * 0.2,
        impact: "Low", cost: "Free", difficulty: "Easy",
        why: `Planning estimate only: 20% of the recorded plastic and other-waste emissions may be avoidable; actual savings depend on local treatment.`
      });
    }
    const preferenceText = state.profile.preferences.toLowerCase();
    const prefersEasy = /low[- ]effort|simple|easy|less time|busy/.test(preferenceText);
    const prefersTransit = /public transit|public transport|bus|rail|metro/.test(preferenceText);
    const budgetScore = item => state.profile.budget === "free" ? (item.cost === "Free" ? 1 : 0) : 0;
    const preferenceScore = item => (prefersEasy && item.difficulty === "Easy" ? 1 : 0)
      + (prefersTransit && item.id === "transit-swap" ? 1 : 0);
    const impactScore = item => ({ High: 3, Medium: 2, Low: 1 }[item.impact] || 0);
    const costScore = item => item.cost === "Free" ? 2 : item.cost === "Low cost" ? 1 : 0;
    const difficultyScore = item => ({ Easy: 3, Moderate: 2, Hard: 1 }[item.difficulty] || 0);
    options.sort((a, b) => preferenceScore(b) - preferenceScore(a)
      || budgetScore(b) - budgetScore(a)
      || impactScore(b) - impactScore(a)
      || costScore(b) - costScore(a)
      || difficultyScore(b) - difficultyScore(a)
      || b.saving - a.saving);
    return options;
  }
  function renderRecommendations() {
    const items = recommendations();
    const container = $("#recommendationPreview");
    if (!items.length) {
      container.innerHTML = '<div class="empty-inline">Add activity to unlock personalized recommendations.</div>';
      return;
    }
    container.innerHTML = items.slice(0, 3).map(item => `
      <div class="recommendation-item">
        <span class="recommendation-icon">${item.icon}</span>
        <span class="recommendation-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.impact)} impact · ${escapeHtml(item.cost)} · ${escapeHtml(item.difficulty)}</small></span>
        <span class="recommendation-saving">~${kg(item.saving)} kg/wk</span>
        <button type="button" class="mini-add" data-add-plan="${escapeHtml(item.id)}" aria-label="Add ${escapeHtml(item.title)} to plan">＋</button>
      </div>
    `).join("");
  }
  function renderPlanner() {
    const values = goalValues();
    const latest = latestStats();
    setValue("baselineMetric", `${values.baseline ? kg(values.baseline) : "—"} kg / day`);
    setValue("baselineMeta", baselineStats().days ? `Average of first ${baselineStats().days} recorded days` : "Log activity to establish your baseline");
    setValue("plannerTargetMetric", `${values.target !== null ? kg(values.target) : "—"} kg / day`);
    setValue("plannerTargetMeta", state.goal ? `${state.goal.percent}% below baseline · ${state.goal.days} days` : "Set a reduction target");
    setValue("latestMetric", `${latest.days ? kg(latest.average) : "—"} kg / day`);
    setValue("latestMeta", latest.days ? `Average of latest ${latest.days} recorded days` : "Based on recent recorded days");
    const gap = values.target === null || !latest.days ? null : Math.max(0, latest.average - values.target);
    setValue("remainingGap", gap === null ? "Set a goal and log activity" : `${kg(gap)} kg CO₂e / day`);
    const progress = baselineStats().days && values.target !== null && latest.days && hasPostBaselineData()
      ? Math.max(0, Math.min(100, (values.baseline - latest.average) / Math.max(values.baseline - values.target, 0.001) * 100))
      : 0;
    $("#plannerProgressBar").style.width = `${progress}%`;
    const plannedList = $("#planList");
    const items = recommendations();
    const planned = state.planned.map(id => items.find(item => item.id === id)).filter(Boolean);
    setValue("plannedCount", `${planned.length} selected`);
    if (!planned.length) {
      plannedList.innerHTML = '<div class="empty-inline">Choose recommended actions below to build your plan.</div>';
    } else {
      plannedList.innerHTML = planned.map(item => `
        <div class="plan-item"><button class="plan-check" type="button" data-complete-plan="${escapeHtml(item.id)}" aria-label="Mark ${escapeHtml(item.title)} complete">✓</button><span class="plan-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.why)} · This week</small></span><span class="plan-saving">~${kg(item.saving)} kg/wk</span></div>
      `).join("");
    }
    const completed = state.completed.slice().reverse();
    setValue("completedCount", `${completed.length} completed`);
    const completedList = $("#completedList");
    completedList.innerHTML = completed.length
      ? completed.slice(0, 6).map(item => `<div class="completed-item"><span class="completed-icon">✓</span><span class="completed-copy"><strong>${escapeHtml(item.title)}</strong><small>Completed ${dateLabel(item.date)} · estimated ${kg(item.saving)} kg CO₂e/week potential; not verified</small></span><span class="plan-saving">Estimate</span></div>`).join("")
      : '<div class="empty-inline">Completed actions will be recorded here. They are estimates until activity confirms a change.</div>';
  }
  function renderSimulator() {
    const records = sortedRecords().slice(-7);
    const controls = [
      ["simCarPercent", "simCarLabel"],
      ["simElectricityPercent", "simElectricityLabel"],
      ["simFoodPercent", "simFoodLabel"]
    ];
    for (const [inputId, labelId] of controls) {
      setValue(labelId, $( `#${inputId}`).value);
    }
    if (!records.length) {
      setValue("simBaseline", "— kg/day");
      setValue("simResult", "— kg/day");
      setValue("simSaving", "0.0 kg/week");
      setValue("simulatorNote", "No activity yet. Log a few days to compare scenarios. Combined category scenarios are illustrative and are not guarantees.");
      return;
    }
    let dailyTotal = 0;
    let dailyElectricity = 0;
    let dailyFoodWaste = 0;
    let dailyCarKm = 0;
    let dailyCarEmissions = 0;
    let dailyRailEmissions = 0;
    for (const record of records) {
      const factor = { ...state.factors, ...(record.factors || {}) };
      dailyTotal += calculateRecord(record).total / records.length;
      dailyElectricity += num(record.electricityKwh) * num(factor.electricity) / records.length;
      dailyFoodWaste += num(record.foodWasteKg) * num(factor.foodWaste) / records.length;
      if (["petrolCar", "dieselCar"].includes(record.vehicleType)) {
        const carFactor = num(factor[record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar"]);
        dailyCarKm += num(record.vehicleDistance) / records.length;
        dailyCarEmissions += num(record.vehicleDistance) * carFactor / records.length;
        dailyRailEmissions += num(record.vehicleDistance) * num(factor.rail) / records.length;
      }
    }
    const carPercent = Number($("#simCarPercent").value) / 100;
    const electricityPercent = Number($("#simElectricityPercent").value) / 100;
    const foodPercent = Number($("#simFoodPercent").value) / 100;
    const carSaving = dailyCarKm ? carPercent * Math.max(0, dailyCarEmissions - dailyRailEmissions) : 0;
    const electricitySaving = dailyElectricity * electricityPercent;
    const foodSaving = dailyFoodWaste * foodPercent;
    const saving = carSaving + electricitySaving + foodSaving;
    setValue("simBaseline", `${kg(dailyTotal)} kg/day`);
    setValue("simResult", `${kg(Math.max(0, dailyTotal - saving))} kg/day`);
    setValue("simSaving", `${kg(saving * 7)} kg/week`);
    const factorText = dailyCarKm
      ? ` Scenario uses ${kg(dailyCarKm, 2)} fossil-car km/day, current electricity, and food-waste factors.`
      : " No fossil-car distance is present in the selected recent days.";
    setValue("simulatorNote", `${records.length} recent recorded days; reductions are applied to distinct categories. A scenario is an estimate, not a measured or guaranteed outcome.${factorText}`);
  }
  function renderChallenge() {
    const challenge = state.challenge;
    if (!challenge || !challenge.started) {
      setValue("challengeDayLabel", "A month of small experiments");
      setValue("challengeLogCount", "0 / 30 logged days");
      $("#challengeProgress").style.width = "0%";
      setValue("challengeMessage", "Your check-ins are based on recorded days, not a perfect streak.");
      $("#challengeButton").textContent = "Start 30-day challenge →";
      $$(".challenge-weeks > div").forEach((week, index) => {
        week.classList.toggle("current", index === 0);
        week.classList.remove("done");
      });
      return;
    }
    const elapsed = Math.max(1, Math.min(30, calendarDaysBetween(challenge.started, todayISO()) + 1));
    const challengeRecords = sortedRecords().filter(record => record.date >= challenge.started && record.date <= todayISO());
    const logDays = challengeRecords.length;
    const weekIndex = Math.min(3, Math.floor((elapsed - 1) / 7));
    setValue("challengeDayLabel", elapsed >= 30 ? "Day 30 · take stock of what changed" : `Day ${elapsed} of your challenge`);
    setValue("challengeLogCount", `${Math.min(logDays, 30)} / 30 logged days`);
    $("#challengeProgress").style.width = `${Math.min(logDays / 30 * 100, 100)}%`;
    setValue("challengeMessage", elapsed >= 30
      ? "Challenge window complete. Compare your recorded averages; actions are not treated as verified savings."
      : `${30 - elapsed} days left · Keep logging representative days. There is no penalty for missed days.`);
    $("#challengeButton").textContent = elapsed >= 30 ? "Start another 30 days ↻" : "Reset challenge ↻";
    $$(".challenge-weeks > div").forEach((week, index) => {
      const from = index * 7;
      const to = index === 3 ? 30 : (index + 1) * 7;
      const logged = challengeRecords.filter(record => {
        const daysAfterStart = calendarDaysBetween(challenge.started, record.date);
        return daysAfterStart >= from && daysAfterStart < to;
      }).length;
      week.classList.toggle("current", index === weekIndex);
      week.classList.toggle("done", logged >= 3);
    });
  }
  function renderProgress() {
    const baseline = baselineStats();
    const latest = latestStats();
    const savings = state.planned.reduce((sum, id) => sum + (recommendations().find(item => item.id === id)?.saving || 0), 0);
    const change = baseline.days && latest.days && hasPostBaselineData() ? latest.average - baseline.average : null;
    const percent = baseline.average && change !== null ? change / baseline.average * 100 : null;
    setValue("absoluteChange", change === null ? "—" : `${change > 0 ? "+" : ""}${kg(change)} kg / day`);
    setValue("percentageChange", percent === null ? "Waiting for enough data" : `${percent > 0 ? "+" : ""}${percent.toFixed(1)}% average change`);
    setValue("observedChange", change === null ? "—" : `${change < 0 ? "−" : change > 0 ? "+" : ""}${kg(Math.abs(change))} kg / day`);
    setValue("observedDescription", change === null ? "Daily-average comparison" : `${baseline.days} baseline days vs. ${latest.days} latest days`);
    setValue("estimatedSavings", `${kg(savings)} kg / week`);
  }
  function renderHistory() {
    const records = sortedRecords().slice().reverse();
    const body = $("#historyBody");
    if (!records.length) {
      body.innerHTML = '<tr><td class="table-empty" colspan="7">No activity recorded yet. Use the daily log to get started.</td></tr>';
      return;
    }
    body.innerHTML = records.slice(0, 30).map(record => {
      const totals = calculateRecord(record);
      return `<tr><td>${dateLabel(record.date, { year: "numeric", month: "short", day: "numeric" })}</td><td>${kg(totals.transport)} kg</td><td>${kg(totals.electricity)} kg</td><td>${kg(totals.fuel)} kg</td><td>${kg(totals.waste)} kg</td><td><strong>${kg(totals.total)} kg</strong></td><td><button class="delete-entry" type="button" data-delete-date="${record.date}" aria-label="Delete activity for ${record.date}">×</button></td></tr>`;
    }).join("");
  }
  function renderFactorInputs() {
    $$("[data-factor]").forEach(input => {
      const key = input.dataset.factor;
      if (document.activeElement !== input) input.value = state.factors[key];
    });
  }
  function renderChat() {
    const log = $("#chatLog");
    const messages = state.chat;
    if (!messages.length) return;
    log.innerHTML = messages.map(message => message.role === "user"
      ? `<div class="chat-message user-message"><p>${escapeHtml(message.text)}</p></div>`
      : `<div class="chat-message assistant-message"><span class="chat-avatar">✳</span><p>${escapeHtml(message.text).replace(/\n/g, "<br>")}</p></div>`).join("");
    log.scrollTop = log.scrollHeight;
  }
  function updateDateEntry() {
    const date = $("#entryDate").value;
    const existing = state.records.find(record => record.date === date);
    setValue("dateExisting", existing ? "Existing entry loaded · saving will update it" : "");
    if (!existing) {
      INPUT_FIELDS.forEach(field => { $(`#${field}`).value = 0; });
      $("#vehicleType").value = "petrolCar";
      $("#vehicleFuel").value = "petrol";
      return;
    }
    INPUT_FIELDS.forEach(field => { $(`#${field}`).value = existing[field] || 0; });
    $("#vehicleType").value = existing.vehicleType || "petrolCar";
    $("#vehicleFuel").value = existing.vehicleFuel || "petrol";
  }
  function renderCalculationPreview() {
    const record = {
      date: $("#entryDate").value || todayISO(),
      vehicleType: $("#vehicleType").value,
      vehicleFuel: $("#vehicleFuel").value,
      factors: { ...state.factors }
    };
    INPUT_FIELDS.forEach(field => { record[field] = num($(`#${field}`).value); });
    const factor = { ...state.factors, ...record.factors };
    const result = calculateRecord(record);
    const lines = [
      ["Personal vehicle", record.vehicleDistance, "vehicle-km", record.vehicleType === "electricCar" || record.vehicleType === "motorcycle" || record.vehicleType === "active" ? record.vehicleType : record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar"],
      ["Bus / shared transit", record.busDistance, "passenger-km", "bus"],
      ["Rail / metro", record.railDistance, "passenger-km", "rail"],
      ["Electricity", record.electricityKwh, "kWh", "electricity"],
      ["Non-transport petrol", record.petrolLitres, "litre", "petrol"],
      ["Non-transport diesel", record.dieselLitres, "litre", "diesel"],
      ["Non-transport LPG", record.lpgKg, "kg", "lpg"],
      ["Other non-transport fuel", record.otherFuelLitres, "litre", "otherFuel"],
      ["Food waste", record.foodWasteKg, "kg", "foodWaste"],
      ["Paper waste", record.paperWasteKg, "kg", "paperWaste"],
      ["Plastic waste", record.plasticWasteKg, "kg", "plasticWaste"],
      ["Other mixed waste", record.otherWasteKg, "kg", "otherWaste"]
    ];
    const sourceLabel = key => factor[key] !== DEFAULT_FACTORS[key]
      ? "User-configured factor; source not independently verified"
      : key === "electricity"
      ? "CEA India grid proxy; verify region/year"
      : ["petrol", "diesel", "lpg"].includes(key)
        ? "UK Gov combustion reference; verify year"
        : "Provisional planning example";
    const visibleLines = lines.filter(([, quantity]) => quantity > 0);
    const output = $("#calculationPreview");
    if (!visibleLines.length) {
      output.innerHTML = '<div class="calc-preview-heading"><span class="calc-preview-icon">∑</span><div><strong>Calculation preview</strong><small>Enter quantities to see each factor and estimated contribution.</small></div></div><div class="calc-preview-empty">Emissions are calculated as entered quantity × the selected factor. Non-transport fuel is separate from vehicle distance to avoid double counting.</div>';
      return;
    }
    const rows = visibleLines.map(([label, quantity, unit, key]) => {
      const value = factor[key];
      const amount = quantity * value;
      return `<div class="calc-row"><span><strong>${escapeHtml(label)}</strong><small>${kg(quantity, 2)} ${unit} × ${kg(value, 4)} kg CO₂e/${unit} <i>${escapeHtml(sourceLabel(key))}</i></small></span><b>${kg(amount, 3)} kg</b></div>`;
    }).join("");
    output.innerHTML = `
      <div class="calc-preview-heading"><span class="calc-preview-icon">∑</span><div><strong>Calculation preview · ${dateLabel(record.date, { year: "numeric", month: "short", day: "numeric" })}</strong><small>Selected factor × user-entered quantity · kg CO₂e</small></div></div>
      <div class="calc-rows">${rows}</div>
      <div class="calc-category-totals">${Object.entries(CATEGORY_LABELS).map(([key, label]) => `<span>${label}<b>${kg(result[key], 2)} kg</b></span>`).join("")}</div>
      <div class="calc-total"><span>Estimated daily total</span><strong>${kg(result.total, 3)} kg CO₂e</strong></div>
      <p class="calc-preview-note">Planning estimates only. Grid region/year and transport, fuel, and waste boundaries affect accuracy. Values are not independently verified.</p>
    `;
  }

  function addToPlan(id) {
    if (!state.planned.includes(id)) {
      state.planned.push(id);
      saveState();
      render();
      showToast("Action added to your weekly plan.");
      persistCloudRecommendations().catch(error => {
        showToast(`Action saved locally; cloud backup failed: ${error.message}`);
      });
    } else {
      showToast("That action is already in your weekly plan.");
    }
  }
  async function completePlan(id) {
    const item = recommendations().find(recommendation => recommendation.id === id);
    if (!item) {
      showToast("This recommendation is no longer available. Review your latest recommendations.");
      return;
    }
    let cloudError = "";
    if (cloud.token && cloud.enabled) {
      try {
        if (!cloud.actionIds[id]) await persistCloudRecommendations();
        const actionId = cloud.actionIds[id];
        if (!actionId) throw new Error("Cloud recommendation ID is not available. Sync your account first.");
        await apiRequest(`/api/actions/${actionId}/completion`, {
          method: "POST",
          body: {}
        });
      } catch (error) {
        cloudError = error.message;
      }
    }
    state.planned = state.planned.filter(plannedId => plannedId !== id);
    state.completed.push({ id, title: item.title, saving: item.saving, date: todayISO() });
    saveState();
    render();
    showToast(cloudError
      ? `Action marked complete locally; cloud update failed: ${cloudError}`
      : "Action marked complete. Estimated savings are not counted as measured reductions.");
  }

  function answerQuestion(question) {
    const text = question.toLowerCase();
    const items = recommendations();
    const latest = latestStats();
    const preferenceNote = state.profile.preferences ? ` I’ll keep your preference in mind: ${state.profile.preferences}.` : "";
    if (!state.records.length) return `Start by logging a typical day of transportation, electricity, non-transport fuel, and waste. Then I can estimate your biggest sources using the factors shown in the calculator.${preferenceNote}`;
    if (/\b(biggest|focus|source|highest|first)\b/.test(text)) {
      const sorted = Object.entries(latest.categories).sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      return `${CATEGORY_LABELS[top[0]]} is your largest source in the latest ${latest.days} recorded days (${kg(top[1] / latest.days)} kg CO₂e per recorded day, ${latest.total ? Math.round(top[1] / latest.total * 100) : 0}% of that period). ${items[0] ? `A practical next step is “${items[0].title},” with an estimated potential of about ${kg(items[0].saving)} kg CO₂e per week. ${items[0].why}` : "Keep logging activity to unlock recommendations tied to reducible sources."}`;
    }
    if (/\b(20%|20 percent|target|goal|month|reduce|reduction|cut)\b/.test(text)) {
      const baseline = baselineStats();
      const percentMatch = text.match(/(\d{1,2})\s*%/);
      const percent = percentMatch ? Math.min(Number(percentMatch[1]), 90) : (state.goal?.percent || 20);
      if (!baseline.days) return "I need at least one recorded day to estimate a target. I’ll compare average emissions per recorded day—not raw totals—so periods with different numbers of logs are more comparable.";
      const target = baseline.average * (1 - percent / 100);
      const actionText = items.slice(0, 3).map(item => `• ${item.title}: ~${kg(item.saving)} kg CO₂e/week potential (${item.impact.toLowerCase()} impact, ${item.cost.toLowerCase()}, ${item.difficulty.toLowerCase()}). ${item.why}`).join("\n");
      return `A ${percent}% goal means moving from your baseline of ${kg(baseline.average)} to ${kg(target)} kg CO₂e per recorded day. ${items.length ? `Here are your highest-potential options (their savings overlap and should not be added together):\n${actionText}\nChoose the actions that fit your circumstances; these estimates are not guaranteed and only new activity logs show observed change.` : "I need more activity details before I can calculate potential savings. Add daily data for your main emission sources first."}`;
    }
    if (/\b(budget|cost|cheap|free|afford)\b/.test(text)) {
      const free = items.filter(item => item.cost === "Free");
      return free.length ? `Based on the activity you’ve logged, these no-cost options are available:\n${free.slice(0, 3).map(item => `• ${item.title} (~${kg(item.saving)} kg/week estimated potential): ${item.why}`).join("\n")}\nTell me if you want to explore another category.` : "Log more activity to find no-cost options matched to your main emission sources.";
    }
    if (/\b(transport|bus|train|car|bike|walk|travel)\b/.test(text)) {
      const transport = items.filter(item => item.category === "transport");
      return transport.length ? `Your transport-specific options are:\n${transport.map(item => `• ${item.title} (~${kg(item.saving)} kg/week estimated potential). ${item.why}`).join("\n")}` : "I don't have a transport-specific opportunity from the activity logged so far. Add your personal vehicle, bus, or rail distance to refine the estimate.";
    }
    if (items.length) {
      const first = items[0];
      return `Based on your recent recorded activity, start with “${first.title}.” ${first.why} The estimated potential is about ${kg(first.saving)} kg CO₂e per week—not a guaranteed or verified reduction. You can ask me about your biggest source, transport, or low-cost options.`;
    }
    return "I can give more specific advice after you add activity data. All numerical savings come from your logged quantities and the configurable factors, not from a language model.";
  }
  async function sendMessage(text) {
    const clean = text.trim();
    if (!clean) return;
    state.chat.push({ role: "user", text: clean });
    if (cloud.token && cloud.enabled) {
      state.chat.push({ role: "assistant", text: "Checking your calculated activity and recommendations…" });
      renderChat();
      try {
        const result = await apiRequest("/api/advisor", { method: "POST", body: { question: clean } });
        state.chat.pop();
        state.chat.push({ role: "assistant", text: result.notice ? `${result.answer}\n\n${result.notice}` : result.answer });
      } catch (error) {
        state.chat.pop();
        state.chat.push({ role: "assistant", text: `${answerQuestion(clean)}\n\nCloud advisor unavailable; answered with the local rule-based advisor.` });
      }
    } else {
      state.chat.push({ role: "assistant", text: answerQuestion(clean) });
    }
    state.chat = state.chat.slice(-30);
    saveState();
    renderChat();
    $("#advisorInput").value = "";
  }

  async function apiRequest(path, { method = "GET", body } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cloud.token) headers.Authorization = `Bearer ${cloud.token}`;
    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch (error) {
      throw new Error("Cannot reach the Flask server. Start it with python run.py and try again.");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      if (response.ok) return {};
    }
    if (!response.ok) throw new Error(payload.error || `The server returned ${response.status}.`);
    return payload;
  }
  function showAuthModal() {
    $("#authModal").hidden = false;
    $("#authError").textContent = "";
    const connected = Boolean(cloud.token && cloud.user);
    $("#cloudConnected").hidden = !connected;
    $("#authForm").hidden = connected;
    $(".auth-footer").hidden = connected;
    if (connected) {
      setValue("cloudUserLabel", cloud.user.email || "Signed in");
      $("#authDescription").textContent = "Your activity is still available locally. Sync when you want to back up this browser to your account.";
    } else if (!cloud.apiAvailable) {
      $("#authDescription").textContent = "Cloud accounts require the Flask server. Start it with python run.py; local tracking is available right now without an account.";
      $("#authError").textContent = "The Flask API is not reachable in this browser session.";
    } else if (!cloud.enabled) {
      $("#authDescription").textContent = "The Flask server is running in local-only mode. Configure Supabase URL and anon key in .env to enable secure accounts and cloud sync.";
      $("#authError").textContent = "Supabase is not configured. Local tracking remains available.";
    } else {
      $("#authDescription").textContent = "Create a Supabase account or sign in to sync your activity across devices. Local tracking works without an account.";
    }
    updateAuthMode();
  }
  function updateAuthMode() {
    $("#authTitle").textContent = cloud.signup ? "Create your account" : "Connect your account";
    $("#authSubmit").innerHTML = cloud.signup ? "Create account <span>→</span>" : "Sign in securely <span>→</span>";
    $("#authModeLabel").textContent = cloud.signup ? "Already registered?" : "New here?";
    $("#authModeToggle").textContent = cloud.signup ? "Sign in" : "Create an account";
    $("#authPassword").autocomplete = cloud.signup ? "new-password" : "current-password";
    $("#authPassword").minLength = cloud.signup ? 10 : 1;
    $("#authPassword").placeholder = cloud.signup ? "At least 10 characters" : "Your password";
  }
  function updateCloudBadge() {
    const badge = $("#backendStatus");
    const button = $("#cloudButton");
    badge.className = "live-status";
    if (cloud.token && cloud.user) {
      badge.classList.add("cloud-signed-in");
      badge.innerHTML = "<span></span> Cloud account connected";
      button.textContent = "Account";
      setValue("storageNote", "Local copy plus your connected Supabase account.");
    } else if (cloud.enabled) {
      badge.classList.add("cloud-ready");
      badge.innerHTML = "<span></span> Secure cloud sync available";
      button.textContent = "Connect account";
      setValue("storageNote", "Activity stays local until you connect and sync an account.");
    } else if (cloud.apiAvailable) {
      badge.innerHTML = "<span></span> Local mode · cloud not configured";
      button.textContent = "Cloud setup";
      setValue("storageNote", "Activity is stored in this browser; cloud is not configured.");
    } else {
      badge.innerHTML = "<span></span> Local-only · data stays here";
      button.textContent = "Local mode";
      setValue("storageNote", "Activity is stored in this browser.");
    }
  }
  async function checkApiStatus() {
    try {
      const result = await apiRequest("/api/health");
      cloud.apiAvailable = true;
      cloud.enabled = Boolean(result.cloudEnabled);
    } catch (error) {
      cloud.apiAvailable = false;
      cloud.enabled = false;
    }
    updateCloudBadge();
    if (cloud.token && cloud.enabled) {
      try {
        const profile = await apiRequest("/api/profile");
        cloud.user = { email: profile.email || "" };
      } catch (error) {
        cloud.token = "";
        cloud.user = null;
        sessionStorage.removeItem("carbon-copilot-access-token");
      }
      updateCloudBadge();
    }
  }
  function fromCloudProfile(profile) {
    return {
      name: profile.name || "",
      location: profile.location || "",
      budget: profile.budget || "any",
      transport: profile.transport || "any",
      preferences: profile.preferences || ""
    };
  }
  async function persistCloudRecommendations() {
    if (!cloud.token || !cloud.enabled) return;
    const items = recommendations();
    if (!items.length) return;
    const saved = await apiRequest("/api/recommendations", {
      method: "POST",
      body: { recommendations: items.map(item => ({
        id: item.id,
        title: item.title,
        category: item.category,
        estimatedWeeklySavingsKgCo2e: item.saving,
        impact: item.impact,
        cost: item.cost,
        difficulty: item.difficulty,
        rationale: item.why
      })) }
    });
    cloud.actionIds = Object.fromEntries((saved.actions || []).map(item => [
      item.recommendation_key, item.id
    ]));
    sessionStorage.setItem("carbon-copilot-action-ids", JSON.stringify(cloud.actionIds));
  }
  async function syncCloudData() {
    if (!cloud.token || !cloud.enabled) throw new Error("Sign in to a configured Supabase project first.");
    $("#syncButton").classList.add("cloud-loading");
    $("#syncButton").textContent = "Syncing safely…";
    try {
      const remoteProfile = await apiRequest("/api/profile");
      const hasLocalProfile = Boolean(state.profile.name || state.profile.location || state.profile.preferences);
      if (!hasLocalProfile && remoteProfile.user_id) state.profile = fromCloudProfile(remoteProfile);
      for (const record of state.records) {
        await apiRequest("/api/activities", {
          method: "POST",
          body: {
            activity: Object.fromEntries([
              "date", "vehicleType", "vehicleFuel", ...INPUT_FIELDS
            ].map(key => [key, record[key] ?? (key === "vehicleType" ? "petrolCar" : key === "vehicleFuel" ? "petrol" : 0)])),
            factors: record.factors || state.factors
          }
        });
      }
      const profile = await apiRequest("/api/profile", {
        method: "PUT",
        body: state.profile
      });
      state.profile = fromCloudProfile(profile);
      const result = await apiRequest("/api/activities");
      const remoteRecords = result.records || [];
      const merged = new Map(state.records.map(record => [record.date, record]));
      for (const record of remoteRecords) merged.set(record.date, record);
      state.records = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
      const latestFactors = state.records.at(-1)?.factors;
      if (latestFactors && Object.keys(latestFactors).length) {
        state.factors = { ...DEFAULT_FACTORS, ...latestFactors };
      }
      const dashboard = await apiRequest("/api/dashboard");
      if (dashboard.target) {
        state.goal = {
          percent: dashboard.target.reduction_percent,
          days: dashboard.target.duration_days,
          started: String(dashboard.target.created_at || todayISO()).slice(0, 10)
        };
      } else if (state.goal && state.records.length) {
        await apiRequest("/api/targets", {
          method: "POST",
          body: { reductionPercent: state.goal.percent, durationDays: state.goal.days }
        });
      }
      const progress = await apiRequest("/api/progress");
      for (const completion of progress.completedActions || []) {
        const action = completion.recommendation || {};
        const completionId = completion.recommended_action_id;
        if (!state.completed.some(item => item.cloudId === completionId)) {
          state.completed.push({
            cloudId: completionId,
            id: action.id || completionId,
            title: action.title || "Completed action",
            saving: Number(action.estimatedWeeklySavingsKgCo2e) || 0,
            date: String(completion.completed_at || todayISO()).slice(0, 10)
          });
        }
      }
      cloud.actionIds = JSON.parse(sessionStorage.getItem("carbon-copilot-action-ids") || "{}");
      saveState();
      await persistCloudRecommendations();
      render();
      showToast(`Cloud sync complete: ${state.records.length} dated entries available.`);
    } finally {
      $("#syncButton").classList.remove("cloud-loading");
      $("#syncButton").innerHTML = "Sync this browser <span>↻</span>";
    }
  }
  async function authenticate() {
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!cloud.apiAvailable || !cloud.enabled) {
      $("#authError").textContent = "Cloud authentication is unavailable. Follow the setup instructions in README.md.";
      return;
    }
    $("#authSubmit").disabled = true;
    $("#authSubmit").textContent = cloud.signup ? "Creating account…" : "Signing in…";
    $("#authError").textContent = "";
    try {
      const result = await apiRequest(cloud.signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        body: { email, password }
      });
      if (!result.access_token) {
        $("#authError").textContent = "Check your email to confirm the account, then return here to sign in.";
        return;
      }
      cloud.token = result.access_token;
      cloud.user = result.user || { email };
      sessionStorage.setItem("carbon-copilot-access-token", cloud.token);
      updateCloudBadge();
      $("#authForm").hidden = true;
      $(".auth-footer").hidden = true;
      $("#cloudConnected").hidden = false;
      setValue("cloudUserLabel", cloud.user.email || email);
      $("#authDescription").textContent = "Your activity is still available locally. Sync when you want to back up this browser to your account.";
      await syncCloudData();
    } catch (error) {
      $("#authError").textContent = error.message;
    } finally {
      $("#authSubmit").disabled = false;
      updateAuthMode();
    }
  }

  function bindEvents() {
    $("#entryDate").value = todayISO();
    $("#activityForm").addEventListener("submit", event => {
      event.preventDefault();
      const date = $("#entryDate").value;
      if (!date) {
        showToast("Choose a date before saving.");
        return;
      }
      if (date > todayISO()) {
        showToast("Activity dates cannot be in the future.");
        return;
      }
      const record = { date, vehicleType: $("#vehicleType").value, vehicleFuel: $("#vehicleFuel").value };
      INPUT_FIELDS.forEach(field => {
        const input = $(`#${field}`);
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0 || value > INPUT_LIMITS[field]) {
          input.focus();
          showToast(`Enter a value between 0 and ${INPUT_LIMITS[field]} for each activity amount.`);
          return;
        }
        record[field] = value;
      });
      if (INPUT_FIELDS.some(field => record[field] === undefined)) return;
      const index = state.records.findIndex(item => item.date === date);
      if (index >= 0) state.records[index] = record;
      else state.records.push(record);
      record.factors = { ...state.factors };
      state.records.sort((a, b) => a.date.localeCompare(b.date));
      saveState();
      render();
      setValue("saveMessage", `Activity for ${dateLabel(date, { year: "numeric", month: "long", day: "numeric" })} saved. Estimates updated using your configured factors.`);
      showToast(index >= 0 ? "Daily activity updated." : "Daily activity saved.");
      if (cloud.token && cloud.enabled) {
        const activity = Object.fromEntries(["date", "vehicleType", "vehicleFuel", ...INPUT_FIELDS].map(key => [key, record[key]]));
        apiRequest("/api/activities", { method: "POST", body: { activity, factors: record.factors } })
          .then(() => persistCloudRecommendations())
          .catch(error => showToast(`Saved locally; cloud update failed: ${error.message}`));
      }
    });
    $("#activityForm").addEventListener("input", renderCalculationPreview);
    $("#activityForm").addEventListener("change", renderCalculationPreview);
    $("#entryDate").addEventListener("change", () => {
      updateDateEntry();
      renderCalculationPreview();
    });
    $("#categoryPeriod").addEventListener("change", () => { renderCategories(); renderSources(); });
    $("#trendPeriod").addEventListener("change", renderTrend);
    $("#toggleFactors").addEventListener("click", () => {
      const panel = $("#factorPanel");
      panel.hidden = !panel.hidden;
      $("#toggleFactors").innerHTML = panel.hidden ? "Calculation factors <span>＋</span>" : "Hide factors <span>−</span>";
    });
    $$("[data-factor]").forEach(input => input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0 || value > 10000) {
        input.value = state.factors[input.dataset.factor];
        showToast("Emission factors must be between 0 and 10000.");
        return;
      }
      state.factors[input.dataset.factor] = value;
      state.records.forEach(record => { record.factors = { ...state.factors }; });
      saveState();
      render();
      showToast("Emission factor updated; saved entries recalculated.");
    }));
    $("#resetFactors").addEventListener("click", () => {
      state.factors = { ...DEFAULT_FACTORS };
      state.records.forEach(record => { record.factors = { ...state.factors }; });
      saveState();
      render();
      showToast("Default emission factors restored.");
    });
    $("#editGoalButton").addEventListener("click", () => {
      const editor = $("#goalEditor");
      editor.hidden = !editor.hidden;
      if (!editor.hidden) {
        $("#goalPercent").value = state.goal?.percent || 20;
        $("#goalDays").value = state.goal?.days || 30;
        $("#userName").value = state.profile.name || "";
        $("#userLocation").value = state.profile.location || "";
        $("#userBudget").value = state.profile.budget || "any";
        $("#userTransport").value = state.profile.transport || "any";
        $("#userPreferences").value = state.profile.preferences || "";
      }
    });
    $("#profileButton").addEventListener("click", () => {
      $("#goalEditor").hidden = false;
      $("#userName").value = state.profile.name || "";
      $("#userLocation").value = state.profile.location || "";
      $("#userBudget").value = state.profile.budget || "any";
      $("#userTransport").value = state.profile.transport || "any";
      $("#userPreferences").value = state.profile.preferences || "";
      $("#goalPercent").value = state.goal?.percent || 20;
      $("#goalDays").value = state.goal?.days || 30;
      document.querySelector("#planner").scrollIntoView({ behavior: "smooth" });
    });
    $("#goalForm").addEventListener("submit", event => {
      event.preventDefault();
      const percent = Number($("#goalPercent").value);
      if (!Number.isFinite(percent) || percent < 1 || percent > 90) {
        showToast("Choose a reduction target between 1% and 90%.");
        return;
      }
      state.goal = { percent, days: Number($("#goalDays").value), started: todayISO() };
      state.profile = {
        name: $("#userName").value.trim(),
        location: $("#userLocation").value.trim(),
        budget: $("#userBudget").value,
        transport: $("#userTransport").value,
        preferences: $("#userPreferences").value.trim()
      };
      saveState();
      render();
      $("#goalEditor").hidden = true;
      showToast("Your goal and sustainability profile are saved.");
      if (cloud.token && cloud.enabled) {
        apiRequest("/api/profile", { method: "PUT", body: state.profile })
          .then(() => state.goal && apiRequest("/api/targets", {
            method: "POST",
            body: { reductionPercent: state.goal.percent, durationDays: state.goal.days }
          }))
          .catch(error => showToast(`Saved locally; cloud goal/profile update failed: ${error.message}`));
      }
    });
    $("#advisorForm").addEventListener("submit", event => {
      event.preventDefault();
      sendMessage($("#advisorInput").value);
    });
    $$(".suggestion-chip").forEach(button => button.addEventListener("click", () => sendMessage(button.textContent)));
    $$("#simCarPercent, #simElectricityPercent, #simFoodPercent").forEach(input =>
      input.addEventListener("input", renderSimulator)
    );
    $("#challengeButton").addEventListener("click", () => {
      if (state.challenge && calendarDaysBetween(state.challenge.started, todayISO()) < 30) {
        state.challenge = null;
        showToast("Challenge reset. Your activity history remains unchanged.");
      } else {
        if (!state.records.length) {
          showToast("Log a day of activity to establish a baseline before starting the challenge.");
          document.querySelector("#activity").scrollIntoView({ behavior: "smooth" });
          return;
        }
        state.challenge = { started: todayISO() };
        if (!state.goal) state.goal = { percent: 20, days: 30, started: todayISO() };
        showToast("Your 30-day challenge has started. Log representative days as you go.");
      }
      saveState();
      render();
    });
    $("#cloudButton").addEventListener("click", showAuthModal);
    $("#closeAuth").addEventListener("click", () => { $("#authModal").hidden = true; });
    $("#authModal").addEventListener("click", event => {
      if (event.target === $("#authModal")) $("#authModal").hidden = true;
    });
    $("#authModeToggle").addEventListener("click", () => {
      cloud.signup = !cloud.signup;
      $("#authError").textContent = "";
      updateAuthMode();
    });
    $("#authForm").addEventListener("submit", event => {
      event.preventDefault();
      authenticate();
    });
    $("#syncButton").addEventListener("click", () => {
      syncCloudData().catch(error => {
        $("#authError").textContent = error.message;
        showToast(`Cloud sync failed: ${error.message}`);
      });
    });
    $("#signOutButton").addEventListener("click", () => {
      cloud.token = "";
      cloud.user = null;
      cloud.actionIds = {};
      sessionStorage.removeItem("carbon-copilot-access-token");
      sessionStorage.removeItem("carbon-copilot-action-ids");
      $("#authModal").hidden = true;
      updateCloudBadge();
      showToast("Signed out. Your local activity remains on this device.");
    });
    document.addEventListener("click", event => {
      const addButton = event.target.closest("[data-add-plan]");
      if (addButton) addToPlan(addButton.dataset.addPlan);
      const completeButton = event.target.closest("[data-complete-plan]");
      if (completeButton) completePlan(completeButton.dataset.completePlan);
      const deleteButton = event.target.closest("[data-delete-date]");
      if (deleteButton) {
        const date = deleteButton.dataset.deleteDate;
        state.records = state.records.filter(record => record.date !== date);
        saveState();
        render();
        showToast(`Activity for ${dateLabel(date)} deleted.`);
        if (cloud.token && cloud.enabled) {
          apiRequest(`/api/activities/${date}`, { method: "DELETE" })
            .catch(error => showToast(`Deleted locally; cloud delete failed: ${error.message}`));
        }
      }
      const scrollButton = event.target.closest("[data-scroll]");
      if (scrollButton) document.querySelector(scrollButton.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    });
    $("#exportButton").addEventListener("click", exportData);
    $("#clearDataButton").addEventListener("click", () => { $("#confirmModal").hidden = false; });
    $("#cancelClear").addEventListener("click", () => { $("#confirmModal").hidden = true; });
    $("#confirmClear").addEventListener("click", () => {
      state = emptyState();
      saveState();
      $("#confirmModal").hidden = true;
      $("#entryDate").value = todayISO();
      setValue("saveMessage", "");
      render();
      showToast("Local Carbon Copilot data cleared.");
    });
    $("#settingsButton").addEventListener("click", () => {
      $("#factorPanel").hidden = false;
      $("#toggleFactors").innerHTML = "Hide factors <span>−</span>";
      document.querySelector("#activity").scrollIntoView({ behavior: "smooth" });
    });
    $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $$(".side-nav a").forEach(link => link.addEventListener("click", () => {
      $("#sidebar").classList.remove("open");
      $$(".side-nav a").forEach(item => item.classList.toggle("active", item === link));
      setValue("breadcrumbPage", link.textContent.trim());
    }));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") $("#confirmModal").hidden = true;
    });
    checkApiStatus();
  }
  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: "Activity entries are user-entered. Emissions are estimates recalculated from the included configurable factors.",
      factors: state.factors,
      profile: state.profile,
      goal: state.goal,
      records: sortedRecords().map(record => ({ ...record, emissions: calculateRecord(record) })),
      plannedActions: state.planned,
      completedActions: state.completed
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `carbon-copilot-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  bindEvents();
  render();
})();
