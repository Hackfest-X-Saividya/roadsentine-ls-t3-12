"use strict";

(() => {
  const STORAGE_KEY = "carbon-copilot-demo-v1";
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
    auto: 0.06,
    bus: 0.105,
    rail: 0.041,
    active: 0
  });
  const FACTOR_DETAILS = Object.freeze({
    electricity: { unit: "kWh", source: "CEA India grid-baseline proxy; confirm region and year.", illustrative: false },
    petrol: { unit: "litre", source: "UK Government combustion reference; direct emissions only.", illustrative: false },
    diesel: { unit: "litre", source: "UK Government combustion reference; direct emissions only.", illustrative: false },
    lpg: { unit: "kg", source: "UK Government combustion reference; direct emissions only.", illustrative: false },
    otherFuel: { unit: "litre", source: "Broad planning placeholder; replace for the specific fuel.", illustrative: true },
    foodWaste: { unit: "kg", source: "Treatment-dependent planning placeholder; not location-specific.", illustrative: true },
    paperWaste: { unit: "kg", source: "Treatment-dependent planning placeholder; not location-specific.", illustrative: true },
    plasticWaste: { unit: "kg", source: "Treatment-dependent planning placeholder; not location-specific.", illustrative: true },
    otherWaste: { unit: "kg", source: "Composition- and treatment-dependent placeholder.", illustrative: true },
    petrolCar: { unit: "vehicle-km", source: "Illustrative fleet-average vehicle-km proxy.", illustrative: true },
    dieselCar: { unit: "vehicle-km", source: "Illustrative fleet-average vehicle-km proxy.", illustrative: true },
    electricCar: { unit: "vehicle-km", source: "Grid-dependent illustrative vehicle-km proxy.", illustrative: true },
    motorcycle: { unit: "vehicle-km", source: "Illustrative fleet-average vehicle-km proxy.", illustrative: true },
    auto: { unit: "vehicle-km", source: "Illustrative auto-rickshaw proxy; vehicle type, fuel, occupancy and location vary.", illustrative: true },
    bus: { unit: "passenger-km", source: "Illustrative average; occupancy and vehicle type vary.", illustrative: true },
    rail: { unit: "passenger-km", source: "Illustrative grid- and occupancy-dependent proxy.", illustrative: true },
    active: { unit: "km", source: "Direct operational emissions only; excludes equipment and infrastructure.", illustrative: true }
  });
  const SIM_FIELDS = Object.freeze({
    vehicleDistance: { label: "Personal vehicle distance", unit: "km", factor: null },
    busDistance: { label: "Bus / shared transit", unit: "passenger-km", factor: "bus" },
    railDistance: { label: "Rail / metro", unit: "passenger-km", factor: "rail" },
    electricityKwh: { label: "Electricity", unit: "kWh", factor: "electricity" },
    petrolLitres: { label: "Non-transport petrol", unit: "litre", factor: "petrol" },
    dieselLitres: { label: "Non-transport diesel", unit: "litre", factor: "diesel" },
    lpgKg: { label: "Non-transport LPG", unit: "kg", factor: "lpg" },
    otherFuelLitres: { label: "Other liquid fuel", unit: "litre", factor: "otherFuel" },
    foodWasteKg: { label: "Food waste", unit: "kg", factor: "foodWaste" },
    paperWasteKg: { label: "Paper waste", unit: "kg", factor: "paperWaste" },
    plasticWasteKg: { label: "Plastic waste", unit: "kg", factor: "plasticWaste" },
    otherWasteKg: { label: "Other mixed waste", unit: "kg", factor: "otherWaste" },
    foodEmissionsKg: { label: "Food purchases and meals", unit: "kg CO₂e", factor: null }
  });
  const TEAM_SAMPLE = Object.freeze([
    { name: "Maya", saving: 18.4 },
    { name: "Leo", saving: 12.2 },
    { name: "Ari", saving: 9.5 }
  ]);
  const FOOD_ESTIMATES = Object.freeze({
    plant: { label: "Plant-based", value: 0.5, serving: "250 g meal" },
    dairy: { label: "Dairy", value: 1.2, serving: "50 g serving" },
    poultry: { label: "Chicken / poultry", value: 1.0, serving: "150 g serving" },
    fish: { label: "Fish", value: 0.8, serving: "150 g serving" },
    redMeat: { label: "Beef / lamb", value: 6.0, serving: "100 g serving" },
    mixed: { label: "Mixed / unknown meal", value: 1.2, serving: "one meal" }
  });
  const INPUT_FIELDS = [
    "vehicleDistance", "busDistance", "railDistance", "electricityKwh",
    "petrolLitres", "dieselLitres", "lpgKg", "otherFuelLitres",
    "foodWasteKg", "paperWasteKg", "plasticWasteKg", "otherWasteKg", "foodEmissionsKg"
  ];
  const INPUT_LIMITS = {
    vehicleDistance: 2000, busDistance: 2000, railDistance: 3000,
    electricityKwh: 5000, petrolLitres: 500, dieselLitres: 500,
    lpgKg: 500, otherFuelLitres: 500, foodWasteKg: 500, foodEmissionsKg: 500,
    paperWasteKg: 500, plasticWasteKg: 500, otherWasteKg: 500
  };
  const CATEGORY_LABELS = {
    transport: "Transportation",
    electricity: "Electricity",
    fuel: "Other fuel",
    waste: "Waste",
    food: "Food"
  };
  const CATEGORY_COLORS = {
    transport: "#8fc89a",
    electricity: "#e6b45e",
    fuel: "#d79568",
    waste: "#aaa1d2",
    food: "#9fc3b0"
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
    startedActions: [],
    chat: [],
    challenge: null
  });
  let state = loadState();
  let chart = null;
  let toastTimer;
  let tesseractLoad = null;
  let scannerText = "";
  let quickLogDraft = null;
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
        startedActions: Array.isArray(parsed.startedActions) ? parsed.startedActions.slice(-20) : [],
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
  function monthKey(iso) {
    return iso.slice(0, 7);
  }
  function previousMonthKey(iso) {
    const date = new Date(`${monthKey(iso)}-01T12:00:00`);
    date.setMonth(date.getMonth() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  function monthLabel(key) {
    return dateLabel(`${key}-01`, { month: "long", year: "numeric" });
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
    const vehicleFactor = record.vehicleType === "electricCar" || record.vehicleType === "motorcycle" || record.vehicleType === "active" || record.vehicleType === "auto"
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
    const food = num(record.foodEmissionsKg);
    return { transport, electricity, fuel, waste, food, total: transport + electricity + fuel + waste + food };
  }
  function sortedRecords() {
    return [...state.records].sort((a, b) => a.date.localeCompare(b.date));
  }
  function statsFor(records) {
    if (!records.length) return { days: 0, average: 0, total: 0, categories: { transport: 0, electricity: 0, fuel: 0, waste: 0, food: 0 } };
    const categories = { transport: 0, electricity: 0, fuel: 0, waste: 0, food: 0 };
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
    renderBudget();
    renderProof();
    renderSimulator();
    renderHabitNudge();
    renderChallenge();
    renderTeamChallenge();
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
    setValue("currentFootprint", latest.days ? kg(latest.total) : "0.0");
    setValue("footprintPeriod", latest.days
      ? `Across the latest ${latest.days} recorded ${latest.days === 1 ? "day" : "days"}`
      : "Log activity to see your total footprint");
    $("#footprintEmpty").hidden = latest.days > 0;
    const largest = Object.entries(latest.categories).sort((a, b) => b[1] - a[1])[0];
    setValue("largestSource", latest.total && largest ? CATEGORY_LABELS[largest[0]] : latest.days ? "No emissions" : "—");
    setValue("largestSourceAmount", latest.total && largest
      ? `${kg(largest[1])} kg CO₂e across this period`
      : latest.days ? "Your recorded activity is at zero." : "Log activity to see your largest source.");

    const currentMonth = todayISO().slice(0, 7);
    const previousMonthDate = new Date(`${currentMonth}-01T12:00:00`);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const previousMonth = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthStats = statsFor(state.records.filter(record => record.date.startsWith(currentMonth)));
    const previousMonthStats = statsFor(state.records.filter(record => record.date.startsWith(previousMonth)));
    const badge = $("#changeBadge");
    if (currentMonthStats.days && previousMonthStats.days && previousMonthStats.average > 0) {
      const change = (currentMonthStats.average - previousMonthStats.average) / previousMonthStats.average * 100;
      badge.className = `summary-change ${change < 0 ? "down" : change > 0 ? "up" : "neutral"}`;
      badge.textContent = `${change < 0 ? "↓" : change > 0 ? "↑" : "→"} ${Math.abs(change).toFixed(0)}%`;
      setValue("changeCaption", "vs. last month’s average per recorded day");
    } else if (currentMonthStats.days && previousMonthStats.days && previousMonthStats.average === 0) {
      badge.className = `summary-change ${currentMonthStats.average > 0 ? "up" : "neutral"}`;
      badge.textContent = currentMonthStats.average > 0 ? "New" : "→ 0%";
      setValue("changeCaption", "Last month had no recorded emissions.");
    } else {
      badge.className = "summary-change neutral";
      badge.textContent = "—";
      setValue("changeCaption", currentMonthStats.days
        ? "Log activity last month for a comparison."
        : "Log activity this month to compare.");
    }
    $("#todayPill").textContent = todayISO() === (state.records.at(-1) || {}).date ? "UPDATED TODAY" : "MEASURED";
    const goal = state.goal;
    if (!goal) {
      setValue("targetStatus", "GET STARTED");
      setValue("targetSummary", "Make a goal that works for you");
      setValue("targetDescription", "Set a target and Carbon Copilot will help you turn it into practical weekly actions.");
      setValue("goalProgressText", "0%");
      setValue("monthlyGoalText", "Set a goal and log activity to track progress.");
      $("#goalProgressBar").style.width = "0%";
      $(".target-card .progress-track").setAttribute("aria-valuenow", "0");
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
    $(".target-card .progress-track").setAttribute("aria-valuenow", String(Math.round(progress)));
    const monthlyTarget = Math.max(0, (values.baseline - values.target) * 30);
    const monthlyReduction = baseline.days && hasPostBaselineData()
      ? Math.max(0, (baseline.average - latest.average) * 30)
      : 0;
    setValue("monthlyGoalText", values.target === null
      ? `Log activity beyond the first 7 days to establish progress toward your monthly target.`
      : !hasPostBaselineData()
        ? `Your estimated target is ${kg(monthlyTarget)} kg CO₂e/month. Log beyond your baseline to track progress.`
        : `${kg(Math.min(monthlyReduction, monthlyTarget))} of ${kg(monthlyTarget)} kg CO₂e/month estimated reduction.`);
  }
  function renderCategories() {
    const stats = statsFor(selectedRecords());
    const total = stats.total;
    for (const key of Object.keys(CATEGORY_LABELS)) {
      setValue(`${key}Value`, `${kg(stats.categories[key])} kg CO₂e`);
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
          { label: "Measured footprint", data: values, borderColor: "#9bcf9c", backgroundColor: "rgba(123,181,128,.16)", borderWidth: 2, pointRadius: values.length > 14 ? 1 : 3, pointHoverRadius: 5, tension: .35, fill: true },
          ...(goal.target !== null ? [{ label: "Target daily average", data: labels.map(() => goal.target), borderColor: "#d4ae69", borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false }] : [])
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${kg(context.parsed.y, 2)} kg CO₂e` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#a0ada1", maxTicksLimit: 7, font: { size: 10 } }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: "rgba(178,195,178,.12)" }, ticks: { color: "#a0ada1", font: { size: 10 }, callback: value => `${value} kg` }, border: { display: false } }
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
        : record.vehicleType === "auto"
          ? factorForRecord(record, "auto")
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
        title: "Replace 20% of car travel with rail",
        reason: `Your petrol or diesel car travel is a major opportunity. Replacing 20% of your average car distance with rail is a practical starting point${state.profile.location ? ` if available in ${state.profile.location}` : ""}.`,
        saving: Math.max(0, fossilCarEmissions - fossilRailEmissions) * 0.2,
        impact: "High", cost: "Low cost", difficulty: state.profile.transport === "transit" ? "Easy" : "Moderate",
        why: `Estimate: 20% of ${kg(fossilCarKm, 1)} km/day shifted from personal petrol/diesel car travel (weighted ${kg(weightedFactor, 3)} → ${kg(weightedRailFactor, 3)} kg CO₂e/km). Check local routes${state.profile.location ? ` around ${state.profile.location}` : ""}.`
      });
    }
    if (hasCar) {
      add({
        id: "carpool", category: "transport", icon: "↗",
        title: "Reduce personal-vehicle travel by 15%",
        reason: "Fewer solo vehicle kilometres can lower transport emissions without requiring a new purchase.",
        saving: averageCarEmissions * 0.15,
        impact: "Medium", cost: "Free", difficulty: "Easy",
        why: `Estimate: reduce personal-vehicle distance by 15%; uses your recorded vehicle mix (${kg(averageCarEmissions, 2)} kg CO₂e/day).`
      });
    }
    if (avgCats.electricity > 0) {
      add({
        id: "electricity-trim", category: "electricity", icon: "ϟ",
        title: "Reduce electricity use by 10%",
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
        title: "Prevent 25% of food waste",
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
        title: "Sort plastic and mixed waste for recycling",
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
      container.innerHTML = '<div class="empty-inline">Log one day of travel, electricity, fuel, or waste to get practical recommendations matched to your biggest source.</div>';
      return;
    }
    container.innerHTML = items.slice(0, 3).map(item => `
      <div class="recommendation-item">
        <span class="recommendation-icon">${item.icon}</span>
        <span class="recommendation-copy"><small class="recommendation-source">${escapeHtml(CATEGORY_LABELS[item.category])}</small><strong>${escapeHtml(item.title)}</strong><small>Potential saving: ~${kg(item.saving)} kg CO₂e/week · ${escapeHtml(item.impact)} impact</small></span>
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
  function renderBudget() {
    const values = goalValues();
    const recent = latestStats();
    const track = $(".budget-card .progress-track");
    if (!state.goal || values.target === null) {
      setValue("weeklyBudget", "—");
      setValue("weeklyBudgetCopy", "Set a reduction goal and log activity to calculate your weekly carbon budget.");
      setValue("budgetStatus", "Set a goal");
      setValue("budgetProgressLabel", "Weekly progress");
      setValue("budgetProgressValue", "—");
      setValue("budgetNote", "Your weekly target is based on your baseline daily average and selected reduction goal.");
      $("#budgetProgressBar").style.width = "0%";
      track.setAttribute("aria-valuenow", "0");
      $(".budget-card").classList.remove("over-budget");
      return;
    }
    const targetWeekly = Math.max(0, values.target * 7);
    const currentWeekly = recent.days ? recent.average * 7 : null;
    const percent = currentWeekly === null || targetWeekly <= 0
      ? 0
      : Math.min(100, currentWeekly / targetWeekly * 100);
    const onTrack = currentWeekly !== null && currentWeekly <= targetWeekly;
    setValue("weeklyBudget", kg(targetWeekly));
    setValue("weeklyBudgetCopy", currentWeekly === null
      ? "Log activity to compare this budget with your latest recorded week."
      : `${kg(currentWeekly)} kg CO₂e estimated from the latest ${recent.days} recorded ${recent.days === 1 ? "day" : "days"}.`);
    setValue("budgetStatus", currentWeekly === null ? "Log activity" : onTrack ? "On track" : "Over budget");
    setValue("budgetProgressLabel", currentWeekly === null ? "Weekly budget usage" : onTrack ? "Budget used" : "Over weekly budget");
    setValue("budgetProgressValue", currentWeekly === null ? "—" : `${Math.round(percent)}%`);
    const baselineDays = baselineStats().days;
    setValue("budgetNote", `Weekly limit = ${kg(values.target)} kg CO₂e/day × 7. Based on your first ${baselineDays} baseline ${baselineDays === 1 ? "day" : "days"} and recent records.`);
    $("#budgetProgressBar").style.width = `${percent}%`;
    track.setAttribute("aria-valuenow", String(Math.round(percent)));
    $(".budget-card").classList.toggle("over-budget", currentWeekly !== null && !onTrack);
  }
  function renderProof() {
    const select = $("#proofActionSelect");
    const items = recommendations();
    const selected = select.value;
    select.innerHTML = `<option value="">${items.length ? "Choose an action…" : "Log activity to choose an action"}</option>`
      + items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(CATEGORY_LABELS[item.category])} · ${escapeHtml(item.title)}</option>`).join("");
    if (items.some(item => item.id === selected)) select.value = selected;
    const active = state.startedActions.at(-1);
    const result = $("#proofResult");
    if (!active) {
      result.innerHTML = '<div class="empty-inline">Choose a recommended action and mark it started. Your before-and-after estimate will update as you log activity.</div>';
      return;
    }
    const afterRecords = state.records.filter(record => record.date > active.startedAt);
    const afterMonths = [...new Set(afterRecords.map(record => monthKey(record.date)))].sort();
    const afterMonth = afterMonths.at(-1);
    const beforeRecords = state.records.filter(record => monthKey(record.date) === active.beforeMonth);
    if (!beforeRecords.length || !afterMonth) {
      result.innerHTML = `
        <div class="proof-active"><span class="proof-action-category">${escapeHtml(CATEGORY_LABELS[active.category])}</span><strong>${escapeHtml(active.title)}</strong></div>
        <div class="proof-months"><span>Before · ${escapeHtml(monthLabel(active.beforeMonth))}</span><b>→</b><span>After · ${afterMonth ? escapeHtml(monthLabel(afterMonth)) : "waiting for a later entry"}</span></div>
        <p class="proof-waiting">${beforeRecords.length ? "Log activity after the start date to see an after comparison." : `Log activity in ${monthLabel(active.beforeMonth)} and after the start date to compare.`}</p>
        <button type="button" class="text-button proof-clear" data-clear-proof>Clear started action</button>`;
      return;
    }
    const beforeStats = statsFor(beforeRecords);
    const afterRecordsInMonth = afterRecords.filter(record => monthKey(record.date) === afterMonth);
    const afterStats = statsFor(afterRecordsInMonth);
    const beforeAverage = beforeStats.categories[active.category] / beforeStats.days;
    const afterAverage = afterStats.categories[active.category] / afterStats.days;
    const avoided = Math.max(0, (beforeAverage - afterAverage) * afterStats.days);
    const difference = afterAverage - beforeAverage;
    result.innerHTML = `
      <div class="proof-active"><span class="proof-action-category">${escapeHtml(CATEGORY_LABELS[active.category])}</span><strong>${escapeHtml(active.title)}</strong></div>
      <div class="proof-months"><span>Before · ${escapeHtml(monthLabel(active.beforeMonth))}<small>${beforeStats.days} recorded ${beforeStats.days === 1 ? "day" : "days"} · ${kg(beforeStats.categories[active.category])} kg</small></span><b>→</b><span>After · ${escapeHtml(monthLabel(afterMonth))}<small>${afterStats.days} recorded ${afterStats.days === 1 ? "day" : "days"} · ${kg(afterStats.categories[active.category])} kg</small></span></div>
      <div class="proof-estimate"><span>Estimated CO₂e avoided</span><strong>~${kg(avoided)} kg</strong><small>${difference > 0 ? `This source average increased by ${kg(difference)} kg per recorded day.` : `Source average changed by ${kg(Math.abs(difference))} kg per recorded day.`}</small></div>
      <button type="button" class="text-button proof-clear" data-clear-proof>Clear started action</button>`;
  }
  function renderTeamChallenge() {
    const recent = latestStats();
    const personalContribution = baselineStats().days && hasPostBaselineData()
      ? Math.max(0, (baselineStats().average - recent.average) * 7)
      : 0;
    const contributions = [...TEAM_SAMPLE, { name: "You", saving: personalContribution }];
    const total = contributions.reduce((sum, member) => sum + member.saving, 0);
    const target = 100;
    const progress = Math.min(100, total / target * 100);
    setValue("teamProgress", `${kg(total)} / ${target} kg`);
    setValue("teamProgressCaption", `${kg(Math.max(0, target - total))} kg CO₂e estimated to reach the shared monthly target`);
    $("#teamProgressBar").style.width = `${progress}%`;
    $(".team-challenge-section .progress-track").setAttribute("aria-valuenow", String(Math.round(progress)));
    $("#teamMembers").innerHTML = contributions.map(member => `
      <div class="team-member ${member.name === "You" ? "team-you" : ""}">
        <span class="team-avatar">${escapeHtml(member.name.slice(0, 1))}</span>
        <span class="team-member-name">${escapeHtml(member.name)}${member.name === "You" ? " · local estimate" : " · demo sample"}</span>
        <strong>${kg(member.saving)} kg</strong>
      </div>
    `).join("");
  }
  function renderHabitNudge() {
    const weekdayGroups = new Map();
    for (const record of sortedRecords()) {
      if (record.foodSource !== "delivery" || num(record.foodEmissionsKg) <= 0) continue;
      const date = new Date(`${record.date}T12:00:00`);
      const weekday = date.getDay();
      const group = weekdayGroups.get(weekday) || [];
      group.push(record);
      weekdayGroups.set(weekday, group);
    }
    const recurring = [...weekdayGroups.entries()]
      .filter(([, records]) => new Set(records.map(record => {
        const date = new Date(`${record.date}T12:00:00`);
        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        return date.toISOString().slice(0, 10);
      })).size >= 3)
      .sort((left, right) => right[1].length - left[1].length)[0];
    const container = $("#habitNudgeContent");
    if (!recurring) {
      container.innerHTML = '<div class="empty-inline">After three or more food-delivery logs on the same weekday, a contextual suggestion can appear here. Mark a scanned or quick-logged meal as “Takeaway / delivery” to build this pattern.</div>';
      return;
    }
    const [weekday, records] = recurring;
    const currentDay = new Date(`${todayISO()}T12:00:00`).getDay();
    const daysUntil = (weekday - currentDay + 7) % 7;
    const nextDate = new Date(`${todayISO()}T12:00:00`);
    nextDate.setDate(nextDate.getDate() + daysUntil);
    const dateText = dateLabel(`${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`, { weekday: "long", month: "short", day: "numeric" });
    const averageFood = records.reduce((sum, record) => sum + num(record.foodEmissionsKg), 0) / records.length;
    const timing = daysUntil === 0 ? `Your usual delivery day is today (${dateText}).` : `Your next recurring delivery day is ${dateText}.`;
    container.innerHTML = `
      <div class="habit-nudge-copy"><span class="habit-nudge-mark">✦</span><div><strong>${escapeHtml(timing)}</strong><p>You logged takeaway or delivery on ${escapeHtml(new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(2026, 0, 4 + weekday)))} in ${records.length} separate weeks. Consider a plant-forward meal or cooking at home this time.</p><small>Potential change: ~${kg(averageFood * 0.2)} kg CO₂e compared with your average logged food estimate. Illustrative, not guaranteed; no restaurant or location data is used.</small></div></div>`;
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
    renderAmountScenario(records);
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
  function renderAmountScenario(records) {
    const field = $("#simAmountField").value;
    const definition = SIM_FIELDS[field];
    if (!definition) {
      setValue("simAmountUnit", "unit");
      $("#simMonthResult").innerHTML = "<span>Monthly footprint scenario</span><strong>Choose an activity to preview.</strong>";
      return;
    }
    setValue("simAmountUnit", definition.unit);
    if (!records.length) {
      $("#simMonthResult").innerHTML = "<span>Monthly footprint scenario</span><strong>Log activity to preview a typical month.</strong>";
      return;
    }
    const averageAmount = records.reduce((sum, record) => sum + num(record[field]), 0) / records.length;
    let averageFactor = 0;
    if (field === "foodEmissionsKg") {
      averageFactor = 1;
    } else if (field === "vehicleDistance") {
      averageFactor = records.reduce((sum, record) => {
        const factors = { ...state.factors, ...(record.factors || {}) };
        const key = record.vehicleType === "electricCar" || record.vehicleType === "motorcycle" || record.vehicleType === "active" || record.vehicleType === "auto"
          ? record.vehicleType
          : record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar";
        return sum + num(factors[key]) / records.length;
      }, 0);
    } else {
      averageFactor = records.reduce((sum, record) => {
        const factors = { ...state.factors, ...(record.factors || {}) };
        return sum + num(factors[definition.factor]) / records.length;
      }, 0);
    }
    const currentQuantity = Number($("#simAmountValue").value);
    const proposedAmount = Number.isFinite(currentQuantity) && currentQuantity >= 0 ? currentQuantity : 0;
    const currentDaily = records.reduce((sum, record) => sum + calculateRecord(record).total, 0) / records.length;
    const dailyDifference = (proposedAmount - averageAmount) * averageFactor;
    const currentMonthly = Math.max(0, currentDaily * 30);
    const scenarioMonthly = Math.max(0, (currentDaily + dailyDifference) * 30);
    const difference = currentMonthly - scenarioMonthly;
    const direction = difference >= 0 ? "potential reduction" : "potential increase";
    $("#simMonthResult").innerHTML = `
      <span>Typical 30-day estimate · based on ${records.length} recent recorded ${records.length === 1 ? "day" : "days"}</span>
      <strong>${kg(currentMonthly)} → ${kg(scenarioMonthly)} kg CO₂e/month</strong>
      <small>${kg(Math.abs(difference))} kg/month ${direction} by changing ${escapeHtml(definition.label)} from ${kg(averageAmount, 2)} to ${kg(proposedAmount, 2)} ${escapeHtml(definition.unit)} per day. Not saved.</small>`;
  }
  function setSimulatorAmountToRecentAverage() {
    const field = $("#simAmountField").value;
    const records = sortedRecords().slice(-7);
    const average = records.length
      ? records.reduce((sum, record) => sum + num(record[field]), 0) / records.length
      : 0;
    $("#simAmountValue").value = average.toFixed(1);
  }
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractLoad) return tesseractLoad;
    tesseractLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      script.onload = () => window.Tesseract
        ? resolve(window.Tesseract)
        : reject(new Error("The browser OCR library did not initialize."));
      script.onerror = () => reject(new Error("Could not load browser OCR. Check your connection and try again."));
      document.head.append(script);
    }).catch(error => {
      tesseractLoad = null;
      throw error;
    });
    return tesseractLoad;
  }
  function numberFromText(value) {
    const parsed = Number(String(value || "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function classifyFoodItem(text) {
    if (/\b(beef|lamb|mutton|steak)\b/i.test(text)) return "redMeat";
    if (/\b(chicken|poultry|turkey)\b/i.test(text)) return "poultry";
    if (/\b(fish|salmon|tuna|prawn|shrimp|seafood)\b/i.test(text)) return "fish";
    if (/\b(milk|cheese|paneer|curd|yogurt|yoghurt|butter|cream)\b/i.test(text)) return "dairy";
    if (/\b(vegetarian|plant[- ]based|vegetable|fruit|salad|rice|dal|lentil|bean|tofu|spinach|potato|bread)\b/i.test(text)
      || /\bveg(?:gie)?\s+(?:biryani|pizza|burger|sandwich|thali)\b/i.test(text)) return "plant";
    return "mixed";
  }
  function scanFoodLines(text) {
    const foodWord = /\b(rice|dal|lentil|bean|tofu|paneer|milk|cheese|curd|yogurt|chicken|poultry|beef|lamb|mutton|fish|salmon|tuna|prawn|shrimp|seafood|veg|vegetable|fruit|salad|spinach|potato|bread|noodle|biryani|pizza|burger|sandwich|thali|meal)\b/i;
    const skipLine = /\b(total|subtotal|tax|gst|cgst|sgst|discount|delivery|platform fee|invoice|order id|thank you)\b/i;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line =>
      line.length >= 3 && line.length <= 100 && foodWord.test(line) && !skipLine.test(line)
    );
    return [...new Set(lines)].slice(0, 20).map(line => ({
      name: line,
      type: classifyFoodItem(line),
      servings: 1
    }));
  }
  function scanReceiptText(text) {
    const numberPattern = String.raw`([\d,]+(?:\.\d+)?)`;
    const electricityMatches = [
      ...text.matchAll(new RegExp(String.raw`(?:units?\s*(?:consumed|used|billed)|electricity\s*(?:consumed|used)|energy\s*consumed)\s*[:#=-]?\s*${numberPattern}`, "gi")),
      ...text.matchAll(new RegExp(String.raw`${numberPattern}\s*kwh\b`, "gi"))
    ];
    const fuelMatches = text.split(/\r?\n/).flatMap(line => {
      if (!/\b(?:fuel|petrol|gasoline|diesel)\b/i.test(line)) return [];
      return [...line.matchAll(new RegExp(String.raw`${numberPattern}\s*(?:l|litres?|liters?|ltrs?|ltr)\b`, "gi"))];
    });
    const readUniqueAmount = matches => {
      const amounts = [...new Set(matches
        .flatMap(match => match.slice(1).filter(value => value !== undefined).map(value => Number(value.replace(/,/g, ""))))
        .filter(value => Number.isFinite(value) && value > 0))];
      return amounts.length === 1 ? amounts[0] : 0;
    };
    const hasElectricityContext = /\b(?:electricity|kwh|units?\s+(?:consumed|used|billed))\b/i.test(text);
    const hasFuelContext = /\b(?:petrol|gasoline|diesel|fuel|fuel pump)\b/i.test(text);
    const kind = hasElectricityContext === hasFuelContext ? "" : hasElectricityContext ? "electricity" : "fuel";
    const mealLines = scanFoodLines(text);
    const hasPetrol = /\b(?:petrol|gasoline)\b/i.test(text);
    const hasDiesel = /\bdiesel\b/i.test(text);
    return {
      kind,
      electricityKwh: readUniqueAmount(electricityMatches),
      fuelLitres: readUniqueAmount(fuelMatches),
      vehicleFuel: hasDiesel === hasPetrol ? "" : hasDiesel ? "diesel" : "petrol",
      meals: mealLines
    };
  }
  function scannerFoodEstimate() {
    return $$(".scanner-food-row").reduce((sum, row) => {
      const type = row.querySelector("[data-food-type]").value;
      const servings = Math.max(0, numberFromText(row.querySelector("[data-food-servings]").value));
      return sum + FOOD_ESTIMATES[type].value * servings;
    }, 0);
  }
  function updateScannerFoodEstimate() {
    const estimate = scannerFoodEstimate();
    const output = $("#scannerFoodEstimate");
    if (output) output.textContent = `Estimated food footprint: ~${kg(estimate, 2)} kg CO₂e`;
  }
  function renderScannerFields(parsed) {
    const kind = $("#scannerKind").value;
    if (!kind) {
      $("#scannerFields").innerHTML = '<p class="scanner-estimate">Choose a document type to review its extracted amount.</p>';
      return;
    }
    if (kind === "electricity") {
      $("#scannerFields").innerHTML = `
        <div class="scanner-field-grid">
          <label>Bill-period electricity <span>kWh on bill</span><input id="scanElectricity" type="number" min="0" max="5000" step="0.1" value="${parsed.electricityKwh || ""}" placeholder="e.g. 180"></label>
          <label>Billing period <span>days · enter from bill</span><input id="scanBillingDays" type="number" min="1" max="365" step="1" placeholder="Enter billing days"></label>
        </div>
        <p class="scanner-estimate" id="scannerElectricityEstimate">Enter and confirm bill-period usage and billing days to calculate the daily average.</p>`;
      const update = () => {
        const kwh = numberFromText($("#scanElectricity").value);
        const days = numberFromText($("#scanBillingDays").value);
        $("#scannerElectricityEstimate").textContent = kwh > 0 && kwh <= 5000 && Number.isInteger(days) && days >= 1 && days <= 365
          ? `Daily average: ${kg(kwh / days, 2)} kWh/day. Confirm the bill-period usage and days.`
          : "Enter and confirm bill-period usage and billing days to calculate the daily average.";
      };
      $("#scanElectricity").addEventListener("input", update);
      $("#scanBillingDays").addEventListener("input", update);
      update();
      return;
    }
    if (kind === "fuel") {
      $("#scannerFields").innerHTML = `
        <div class="scanner-field-grid">
          <label>Fuel purchased <span>litres</span><input id="scanFuelLitres" type="number" min="0" max="500" step="0.01" value="${parsed.fuelLitres || ""}" placeholder="e.g. 6.4"></label>
          <label>Vehicle fuel type<select id="scanVehicleFuel"><option value="">Confirm fuel type</option><option value="petrol">Petrol</option><option value="diesel">Diesel</option></select></label>
          <label>Vehicle efficiency assumption <span>km per litre · enter your value</span><input id="scanKmPerLitre" type="number" min="1" max="100" step="0.1" placeholder="Enter km/L"></label>
          <label>Days represented <span>days · enter your value</span><input id="scanFuelDays" type="number" min="1" max="30" step="1" placeholder="Enter days"></label>
        </div>
        <p class="scanner-estimate" id="scannerFuelEstimate">Enter and confirm fuel type, vehicle efficiency, and days represented to estimate daily distance.</p>`;
      $("#scanVehicleFuel").value = parsed.vehicleFuel || "";
      const update = () => {
        const litres = numberFromText($("#scanFuelLitres").value);
        const efficiency = numberFromText($("#scanKmPerLitre").value);
        const days = numberFromText($("#scanFuelDays").value);
        $("#scannerFuelEstimate").textContent = litres > 0 && litres <= 500 && ["petrol", "diesel"].includes($("#scanVehicleFuel").value)
          && efficiency >= 1 && efficiency <= 100 && Number.isInteger(days) && days >= 1 && days <= 30
          ? `Estimated average distance: ${kg(litres * efficiency / days, 1)} km/day across ${days} days. This purchase-based proxy uses your confirmed efficiency; it is not measured distance.`
          : "Enter and confirm fuel type, vehicle efficiency, and days represented to estimate daily distance.";
      };
      $("#scanFuelLitres").addEventListener("input", update);
      $("#scanKmPerLitre").addEventListener("input", update);
      $("#scanFuelDays").addEventListener("input", update);
      $("#scanVehicleFuel").addEventListener("change", update);
      update();
      return;
    }
    const rows = parsed.meals.map((meal, index) => `
      <div class="scanner-food-row">
        <label>Recognized item ${index + 1}<input type="text" maxlength="100" value="${escapeHtml(meal.name)}" data-food-name></label>
        <label>Food type<select data-food-type>${Object.entries(FOOD_ESTIMATES).map(([key, factor]) => `<option value="${key}" ${key === meal.type ? "selected" : ""}>${escapeHtml(factor.label)}</option>`).join("")}</select></label>
        <label>Servings<input type="number" min="0" max="100" step="0.5" value="${meal.servings}" data-food-servings></label>
        <button type="button" class="text-button scanner-remove-item" aria-label="Remove item ${index + 1}">×</button>
      </div>`).join("");
    const factorRows = Object.entries(FOOD_ESTIMATES).map(([, factor]) =>
      `<span>${escapeHtml(factor.label)} · ${kg(factor.value, 1)} kg CO₂e / ${escapeHtml(factor.serving)}</span>`
    ).join("");
    $("#scannerFields").innerHTML = `
      <div class="scanner-food-list">${rows}</div>
      <button type="button" class="text-button scanner-add-item" id="scannerAddItem">＋ Add item</button>
      <div class="scanner-estimate" id="scannerFoodEstimate"></div>
      <details class="scanner-factor-details"><summary>Food estimate assumptions</summary><div>${factorRows}</div><p>Broad illustrative proxies with heuristic serving conversions; these are not exact values from a source dataset. Actual recipes, portion size, origin and preparation vary. <a href="https://ourworldindata.org/environmental-impacts-of-food" target="_blank" rel="noreferrer">Context: Our World in Data</a>.</p></details>`;
    $("#scannerFields").oninput = updateScannerFoodEstimate;
    $("#scannerFields").onchange = updateScannerFoodEstimate;
    $("#scannerFields").onclick = event => {
      if (event.target.closest(".scanner-remove-item")) {
        event.target.closest(".scanner-food-row").remove();
        updateScannerFoodEstimate();
      }
      if (event.target.closest("#scannerAddItem")) {
        const row = document.createElement("div");
        row.className = "scanner-food-row";
        row.innerHTML = `<label>Food item<input type="text" maxlength="100" value="Added item" data-food-name></label><label>Food type<select data-food-type>${Object.entries(FOOD_ESTIMATES).map(([key, factor]) => `<option value="${key}">${escapeHtml(factor.label)}</option>`).join("")}</select></label><label>Servings<input type="number" min="0" max="100" step="0.5" value="1" data-food-servings></label><button type="button" class="text-button scanner-remove-item" aria-label="Remove item">×</button>`;
        $(".scanner-food-list").append(row);
        updateScannerFoodEstimate();
      }
    };
    updateScannerFoodEstimate();
  }
  async function processReceiptImage(file) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showToast("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast("Choose an image smaller than 10 MB.");
      return;
    }
    $("#scannerReview").hidden = true;
    $("#scannerProgress").hidden = false;
    $("#scannerProgress").textContent = "Loading browser OCR… Your image stays on this device.";
    let worker;
    try {
      const tesseract = await loadTesseract();
      worker = await tesseract.createWorker("eng", 1, {
        logger: message => {
          if (message.status === "recognizing text") {
            $("#scannerProgress").textContent = `Reading image… ${Math.round(message.progress * 100)}%`;
          }
        }
      });
      const result = await worker.recognize(file);
      scannerText = result.data.text || "";
      if (!scannerText.trim()) throw new Error("No readable text was found. Try a sharper, well-lit image.");
      const parsed = scanReceiptText(scannerText);
      $("#scannerKind").value = parsed.kind || "";
      $("#scannerOcrText").value = scannerText;
      $("#scannerFileName").textContent = `${file.name} · recognized in your browser`;
      $("#scannerReview").hidden = false;
      renderScannerFields(parsed);
      $("#scannerProgress").textContent = "Image read. Review the extracted values before applying them.";
      if (!parsed.kind) $("#scannerProgress").textContent = "Choose the document type and review the extracted values.";
      $("#scannerReview").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      console.error("Receipt OCR failed.", error);
      $("#scannerProgress").textContent = error.message || "Could not read the image. Try another image.";
      showToast(error.message || "Could not read the image. Try another image.");
    } finally {
      if (worker) await worker.terminate();
    }
  }
  function applyReceiptScan() {
    const kind = $("#scannerKind").value;
    if (!["electricity", "fuel", "food"].includes(kind)) {
      showToast("Choose a document type and review the extracted amount first.");
      return;
    }
    if (kind === "electricity") {
      const kwh = numberFromText($("#scanElectricity").value);
      const days = numberFromText($("#scanBillingDays").value);
      if (kwh <= 0 || kwh > 5000 || !Number.isInteger(days) || days < 1 || days > 365) {
        showToast("Check bill kWh (up to 5,000) and billing days (1–365).");
        return;
      }
      $("#electricityKwh").value = (kwh / days).toFixed(2);
    } else if (kind === "fuel") {
      const litres = numberFromText($("#scanFuelLitres").value);
      const efficiency = numberFromText($("#scanKmPerLitre").value);
      const days = numberFromText($("#scanFuelDays").value);
      if (litres <= 0 || litres > 500 || !["petrol", "diesel"].includes($("#scanVehicleFuel").value)
        || efficiency < 1 || efficiency > 100 || !Number.isInteger(days) || days < 1 || days > 30) {
        showToast("Check fuel quantity (up to 500 L), efficiency (1–100 km/L), and days represented (1–30).");
        return;
      }
      $("#vehicleDistance").value = (litres * efficiency / days).toFixed(1);
      $("#vehicleType").value = "petrolCar";
      $("#vehicleFuel").value = $("#scanVehicleFuel").value;
    } else {
      const estimate = scannerFoodEstimate();
      if (!$(".scanner-food-row") || estimate <= 0 || estimate > 500) {
        showToast("Add at least one food item with a serving amount to apply the estimate.");
        return;
      }
      $("#foodEmissionsKg").value = estimate.toFixed(2);
      $("#foodSource").value = /(?:swiggy|zomato|delivery|takeaway|restaurant order)/i.test(scannerText)
        ? "delivery"
        : /(?:grocery|supermarket|shopping cart)/i.test(scannerText) ? "groceries" : "home";
    }
    renderCalculationPreview();
    $("#scannerReview").hidden = true;
    setValue("saveMessage", "Receipt values applied to the activity form. Review the daily totals and save to add them to your tracker.");
    document.querySelector("#activityForm").scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("Receipt values applied. Review and save your daily activity.");
  }
  function parseQuickLogText(text) {
    const draft = { vehicleDistance: 0, vehicleType: "", vehicleFuel: "petrol", foodEmissionsKg: 0, foodSource: "home", electricityKwh: 0, details: [] };
    const tripFirst = text.match(/\b(auto(?:[- ]?rickshaw)?|rickshaw|tuk[- ]?tuk|car|motorcycle|bike)\b[\s\S]{0,24}?(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:er|re)s?)\b/i);
    const tripLast = tripFirst ? null : text.match(/(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:er|re)s?)\s*(?:in|by|on)?\s*\b(auto(?:[- ]?rickshaw)?|rickshaw|tuk[- ]?tuk|car|motorcycle|bike)\b/i);
    if (tripFirst || tripLast) {
      const vehicle = (tripFirst ? tripFirst[1] : tripLast[2]).toLowerCase();
      draft.vehicleDistance = numberFromText(tripFirst ? tripFirst[2] : tripLast[1]);
      draft.vehicleType = /auto|rickshaw|tuk/.test(vehicle) ? "auto" : /bike|motorcycle/.test(vehicle) ? "motorcycle" : "petrolCar";
      if (/\bdiesel\b/i.test(text)) draft.vehicleFuel = "diesel";
      if (draft.vehicleDistance > 0) draft.details.push(`${kg(draft.vehicleDistance, 1)} km by ${draft.vehicleType === "auto" ? "auto-rickshaw" : draft.vehicleType === "motorcycle" ? "motorcycle" : "car"}`);
    }
    const electricity = text.match(/(?:electricity|used|consumed|bill)\s*(?:was|of|:)?\s*(\d+(?:\.\d+)?)\s*kwh\b/i)
      || text.match(/(\d+(?:\.\d+)?)\s*kwh\b/i);
    if (electricity) {
      draft.electricityKwh = numberFromText(electricity[1]);
      draft.details.push(`${kg(draft.electricityKwh, 1)} kWh electricity`);
    }
    const foodMention = /\b(ate|eaten|ordered|had|meal|biryani|pizza|burger|chicken|beef|lamb|fish|paneer|dal|salad|sandwich|noodles|thali)\b/i.test(text);
    if (foodMention) {
      const kind = classifyFoodItem(text);
      draft.foodEmissionsKg = FOOD_ESTIMATES[kind].value;
      draft.foodSource = /(?:swiggy|zomato|ordered|delivery|takeaway)/i.test(text)
        ? "delivery"
        : /(?:grocery|groceries|supermarket)/i.test(text) ? "groceries" : "home";
      draft.details.push(`one ${FOOD_ESTIMATES[kind].label.toLowerCase()} serving (~${kg(draft.foodEmissionsKg, 1)} kg CO₂e estimate)`);
    }
    return draft.details.length ? draft : null;
  }
  function prepareQuickLog() {
    const text = $("#quickLogText").value.trim();
    quickLogDraft = parseQuickLogText(text);
    const result = $("#quickLogResult");
    if (!quickLogDraft) {
      result.hidden = false;
      result.innerHTML = "<p>I couldn't identify a supported activity. Try “I took an auto 8 km and ate chicken biryani.”</p>";
      return;
    }
    result.hidden = false;
    result.innerHTML = `<p><strong>Review this estimate:</strong> ${quickLogDraft.details.map(escapeHtml).join(" · ")}</p><p>These are editable activity values, not an automatic save. Confirm the type and amount, then save the daily log.</p><button class="button button-dark" id="applyQuickLog" type="button">Apply to daily log <span>→</span></button>`;
  }
  function applyQuickLog() {
    if (!quickLogDraft) return;
    const draft = quickLogDraft;
    if (draft.vehicleDistance) {
      $("#vehicleDistance").value = draft.vehicleDistance.toFixed(1);
      $("#vehicleType").value = draft.vehicleType;
      $("#vehicleFuel").value = draft.vehicleFuel;
    }
    if (draft.electricityKwh) $("#electricityKwh").value = draft.electricityKwh.toFixed(1);
    if (draft.foodEmissionsKg) {
      $("#foodEmissionsKg").value = draft.foodEmissionsKg.toFixed(1);
      $("#foodSource").value = draft.foodSource;
    }
    $("#quickLogResult").hidden = true;
    quickLogDraft = null;
    renderCalculationPreview();
    setValue("saveMessage", "Quick-log values applied. Review the activity details and save to add them to your tracker.");
    document.querySelector("#activityForm").scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("Quick-log values applied. Review and save your daily activity.");
  }
  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice recognition is not available in this browser. Type your activity instead.");
      return;
    }
    const button = $("#voiceInputButton");
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    button.disabled = true;
    button.textContent = "Listening…";
    recognition.onresult = event => {
      $("#quickLogText").value = event.results[0][0].transcript;
      prepareQuickLog();
    };
    recognition.onerror = event => {
      showToast(event.error === "not-allowed"
        ? "Microphone permission was denied. You can still type an activity."
        : `Voice recognition failed (${event.error}). You can still type an activity.`);
    };
    recognition.onend = () => {
      button.disabled = false;
      button.innerHTML = "Start voice input <span>◖</span>";
    };
    try {
      recognition.start();
    } catch (error) {
      button.disabled = false;
      button.innerHTML = "Start voice input <span>◖</span>";
      showToast(`Could not start voice recognition: ${error.message}`);
    }
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
      body.innerHTML = '<tr><td class="table-empty" colspan="8">No activity recorded yet. Use the daily log to get started.</td></tr>';
      return;
    }
    body.innerHTML = records.slice(0, 30).map(record => {
      const totals = calculateRecord(record);
      return `<tr><td>${dateLabel(record.date, { year: "numeric", month: "short", day: "numeric" })}</td><td>${kg(totals.transport)} kg</td><td>${kg(totals.electricity)} kg</td><td>${kg(totals.fuel)} kg</td><td>${kg(totals.waste)} kg</td><td>${kg(totals.food)} kg</td><td><strong>${kg(totals.total)} kg</strong></td><td><button class="delete-entry" type="button" data-delete-date="${record.date}" aria-label="Delete activity for ${record.date}">×</button></td></tr>`;
    }).join("");
  }
  function renderFactorInputs() {
    $$("[data-factor]").forEach(input => {
      const key = input.dataset.factor;
      if (document.activeElement !== input) input.value = state.factors[key];
    });
    const factorLabel = key => ({
      electricity: "Grid electricity", otherFuel: "Other liquid fuel",
      foodWaste: "Food waste", paperWaste: "Paper waste",
      plasticWaste: "Plastic waste", otherWaste: "Other mixed waste",
      petrolCar: "Petrol car", dieselCar: "Diesel car",
      electricCar: "Electric car", motorcycle: "Motorcycle", auto: "Auto-rickshaw",
      bus: "Bus / shared transit", rail: "Rail / metro", active: "Walking / cycling"
    })[key] || key;
    const rows = Object.entries(FACTOR_DETAILS).map(([key, details]) => {
      const custom = state.factors[key] !== DEFAULT_FACTORS[key];
      return `<tr><th scope="row">${escapeHtml(factorLabel(key))}</th><td>${kg(state.factors[key], 4)}</td><td>kg CO₂e / ${escapeHtml(details.unit)}</td><td>${escapeHtml(custom ? `User-edited value; original source: ${details.source}` : details.source)}</td><td><span class="factor-tag ${details.illustrative || custom ? "illustrative" : "reference"}">${details.illustrative || custom ? "Illustrative" : "Reference"}</span></td></tr>`;
    }).join("");
    const foodRows = Object.entries(FOOD_ESTIMATES).map(([, details]) =>
      `<tr><th scope="row">${escapeHtml(details.label)}</th><td>${kg(details.value, 1)}</td><td>kg CO₂e / ${escapeHtml(details.serving)}</td><td>Illustrative proxy with heuristic serving conversion; not an exact source-dataset value.</td><td><span class="factor-tag illustrative">Estimate</span></td></tr>`
    ).join("");
    $("#factorReference").innerHTML = `
      <div class="factor-reference-heading"><strong>Factor values &amp; sources</strong><span>Values shown are the ones currently used in your calculations.</span></div>
      <div class="factor-reference-scroll"><table><thead><tr><th>Activity</th><th>Value</th><th>Unit</th><th>Source / note</th><th>Type</th></tr></thead><tbody>${rows}${foodRows}</tbody></table></div>
      <p>All values are planning estimates, not a formal greenhouse-gas inventory. The grid factor is a regional/year proxy; fuel references are direct combustion only. Transport and waste factors are illustrative placeholders. Food serving context: <a href="https://ourworldindata.org/environmental-impacts-of-food" target="_blank" rel="noreferrer">Our World in Data</a>; serving conversions are illustrative. Use verified local factors for reporting.</p>`;
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
      INPUT_FIELDS.forEach(field => { $(`#${field}`).value = ""; });
      $("#vehicleType").value = "petrolCar";
      $("#vehicleFuel").value = "petrol";
      $("#foodSource").value = "home";
      return;
    }
    INPUT_FIELDS.forEach(field => { $(`#${field}`).value = existing[field] || 0; });
    $("#vehicleType").value = existing.vehicleType || "petrolCar";
    $("#vehicleFuel").value = existing.vehicleFuel || "petrol";
    $("#foodSource").value = existing.foodSource || "home";
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
      ["Personal vehicle", record.vehicleDistance, "vehicle-km", record.vehicleType === "electricCar" || record.vehicleType === "motorcycle" || record.vehicleType === "active" || record.vehicleType === "auto" ? record.vehicleType : record.vehicleFuel === "diesel" ? "dieselCar" : "petrolCar"],
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
    $("#parseQuickLog").addEventListener("click", prepareQuickLog);
    $("#voiceInputButton").addEventListener("click", startVoiceInput);
    $("#quickLogResult").addEventListener("click", event => {
      if (event.target.closest("#applyQuickLog")) applyQuickLog();
    });
    $("#receiptImage").addEventListener("change", event => {
      const file = event.target.files[0];
      if (file) processReceiptImage(file);
    });
    $("#scannerKind").addEventListener("change", () => {
      renderScannerFields(scanReceiptText(scannerText));
    });
    $("#applyScan").addEventListener("click", applyReceiptScan);
    $("#discardScan").addEventListener("click", () => {
      $("#scannerReview").hidden = true;
      $("#scannerProgress").hidden = true;
      $("#receiptImage").value = "";
      $("#scannerFileName").textContent = "PNG, JPG, or WebP · up to 10 MB";
      scannerText = "";
    });
    $("#simAmountField").innerHTML = Object.entries(SIM_FIELDS)
      .map(([key, details]) => `<option value="${key}">${escapeHtml(details.label)}</option>`).join("");
    $("#simAmountField").value = "vehicleDistance";
    setSimulatorAmountToRecentAverage();
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
      record.foodSource = $("#foodSource").value;
      const index = state.records.findIndex(item => item.date === date);
      if (index >= 0) state.records[index] = record;
      else state.records.push(record);
      record.factors = { ...state.factors };
      state.records.sort((a, b) => a.date.localeCompare(b.date));
      saveState();
      render();
      setValue("saveMessage", `Activity for ${dateLabel(date, { year: "numeric", month: "long", day: "numeric" })} saved. Estimates updated using your configured factors.`);
      showToast(index >= 0 ? "Nice work—your daily activity has been updated." : "Nice work—your daily activity has been saved.");
      if (cloud.token && cloud.enabled) {
        const activity = Object.fromEntries(["date", "vehicleType", "vehicleFuel", "foodSource", ...INPUT_FIELDS].map(key => [key, record[key]]));
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
    $("#proofForm").addEventListener("submit", event => {
      event.preventDefault();
      const item = recommendations().find(candidate => candidate.id === $("#proofActionSelect").value);
      if (!item) {
        showToast("Choose a recommended action first.");
        return;
      }
      state.startedActions.push({
        id: item.id,
        title: item.title,
        category: item.category,
        startedAt: todayISO(),
        beforeMonth: previousMonthKey(todayISO())
      });
      state.startedActions = state.startedActions.slice(-20);
      saveState();
      render();
      showToast("Action started. Log later activity to compare monthly estimates.");
    });
    $("#advisorForm").addEventListener("submit", event => {
      event.preventDefault();
      sendMessage($("#advisorInput").value);
    });
    $$(".suggestion-chip").forEach(button => button.addEventListener("click", () => sendMessage(button.textContent)));
    $$("#simCarPercent, #simElectricityPercent, #simFoodPercent").forEach(input =>
      input.addEventListener("input", renderSimulator)
    );
    $("#simAmountField").addEventListener("change", () => {
      setSimulatorAmountToRecentAverage();
      renderSimulator();
    });
    $("#simAmountValue").addEventListener("input", renderSimulator);
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
      const clearProofButton = event.target.closest("[data-clear-proof]");
      if (clearProofButton) {
        state.startedActions = [];
        saveState();
        render();
        showToast("Started action cleared.");
      }
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
