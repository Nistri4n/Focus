const STORAGE_KEY = "focus-planner-state-v1";

const HABITS = [
  { id: "reading", name: "Чтение", icon: "📚", color: "#00c98b" },
  { id: "workout", name: "Тренировка", icon: "🏋️", color: "#22d3ee" },
  { id: "sleep", name: "Сон 7+ часов", icon: "😴", color: "#ffb800" },
  { id: "food", name: "Здоровое питание", icon: "🥗", color: "#c05cff" },
  { id: "water", name: "Вода 2 литра", icon: "💧", color: "#3b82f6" },
];

const DAY_TYPES = ["Рабочий", "Выходной", "Отпуск", "Больничный"];
const PRIORITY_ORDER = { high: 3, medium: 2, low: 1 };
const TASK_CATEGORIES = ["Работа", "Маркетинг", "Логистика", "Контент", "Личное"];
const MORE_ROUTES = new Set(["more", "projects", "finance", "settings"]);

const routeMeta = {
  today: ["СЕГОДНЯ", "Задачи и сверка"],
  habits: ["ЛИЧНЫЙ РИТМ", "Трекер привычек"],
  tasks: ["РАБОЧАЯ СИСТЕМА", "Все задачи и статусы"],
  projects: ["ДВИЖЕНИЕ К ЦЕЛЯМ", "Проекты"],
  finance: ["ЛИЧНЫЙ КАПИТАЛ", "Финансовые цели"],
  more: ["ЕЩЁ", "Разделы и настройки"],
  settings: ["НАСТРОЙКИ", "Интерфейс и данные"],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function uid(prefix = "id") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat("ru-RU", options).format(date);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currency(value) {
  const code = state.settings?.currency || "RUB";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function defaultUi() {
  return {
    viewDateKey: localDateKey(),
    taskKindFilter: "all",
    taskCategoryFilter: "all",
    projectTab: "active",
    habitTableRange: "month",
    habitDetailChart: false,
    regularExpanded: true,
    financeSummaryOpen: true,
    todayShowDone: false,
  };
}

function createEmptyState() {
  const today = new Date();
  const todayKey = localDateKey(today);
  const defaultType = today.getDay() === 0 || today.getDay() === 6 ? "Выходной" : "Рабочий";
  return {
    version: 2,
    dayTypes: { [todayKey]: defaultType },
    tasks: [],
    projects: [],
    finance: [],
    habits: {},
    habitViewMonth: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
    focusPins: [],
    assistantMessages: [
      {
        role: "assistant",
        text: "Я подсказываю по вашему плану локально. Нажмите сценарий выше или спросите своими словами.",
      },
    ],
    settings: {
      defaultDayType: "Рабочий",
      currency: "RUB",
      showProjectWidget: true,
      showFinanceWidget: true,
    },
    ui: defaultUi(),
  };
}

function normalizeState(raw) {
  const base = createEmptyState();
  return {
    ...base,
    ...raw,
    focusPins: raw.focusPins || [],
    settings: { ...base.settings, ...raw.settings },
    ui: { ...base.ui, ...raw.ui },
    assistantMessages: raw.assistantMessages || base.assistantMessages,
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.tasks)) {
      return normalizeState(stored);
    }
  } catch (error) {
    console.warn("Не удалось прочитать сохранённые данные", error);
  }
  return createEmptyState();
}

let state = loadState();
let activeRoute = location.hash.replace("#", "") || "today";
let modalType = "task";
let taskSheetId = null;
let toastActionHandler = null;
let suppressTaskClick = false;

function getViewDateKey() {
  return state.ui.viewDateKey || localDateKey();
}

function getViewDate() {
  return dateFromKey(getViewDateKey());
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateSidebarScore();
}

function dayTypeForDateKey(dateKey) {
  if (state.dayTypes[dateKey]) return state.dayTypes[dateKey];
  const date = dateFromKey(dateKey);
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  return dateKey === localDateKey() ? currentDayType() : weekend ? "Выходной" : state.settings.defaultDayType;
}

function currentDayType() {
  const key = getViewDateKey();
  if (state.dayTypes[key]) return state.dayTypes[key];
  const date = dateFromKey(key);
  if (date.getDay() === 0 || date.getDay() === 6) return "Выходной";
  return state.settings.defaultDayType || "Рабочий";
}

function taskDoneOn(task, dateKey) {
  if (task.kind === "recurring") return task.completedDates?.includes(dateKey);
  return task.status === "done";
}

function normalizeDateKey(value) {
  if (value == null || value === "") return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isTaskVisibleOnDate(task, dateKey) {
  const savedDayType = state.dayTypes[dateKey];
  const date = dateFromKey(dateKey);
  const type =
    savedDayType ||
    (date.getDay() === 0 || date.getDay() === 6 ? "Выходной" : state.settings.defaultDayType || "Рабочий");
  if (task.status === "cancelled") return false;
  if (task.kind === "recurring") {
    return task.dayType === "Любой" || task.dayType === type;
  }
  if (task.status === "done") return false;
  // «В работе» — часть ежедневной сверки на главном экране
  if (task.status === "progress") return true;
  const due = normalizeDateKey(task.due);
  return !due || due <= dateKey;
}

function dueTasksForDate(dateKey = getViewDateKey()) {
  const statusOrder = { progress: 2, new: 1 };
  return state.tasks
    .filter((task) => isTaskVisibleOnDate(task, dateKey))
    .sort((a, b) => {
      if (a.kind === "simple" && b.kind === "simple") {
        const orderDiff = (statusOrder[b.status] || 0) - (statusOrder[a.status] || 0);
        if (orderDiff !== 0) return orderDiff;
      }
      return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    });
}

function projectProgress(project) {
  if (!project.stages.length) return 0;
  return project.stages.filter((stage) => stage.done).length / project.stages.length;
}

function habitScoreForDate(dateKey) {
  const entry = state.habits[dateKey] || {};
  return HABITS.filter((habit) => entry[habit.id]).length / HABITS.length;
}

function weekHabitScore() {
  const today = new Date();
  const mondayOffset = today.getDay() === 0 ? -6 : 1 - today.getDay();
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, mondayOffset + index)).filter(
    (date) => date <= today,
  );
  if (!days.length) return 0;
  return days.reduce((total, date) => total + habitScoreForDate(localDateKey(date)), 0) / days.length;
}

function updateSidebarScore() {
  const score = Math.round(weekHabitScore() * 100);
  $("#sidebar-score").textContent = `${score}%`;
  $("#sidebar-score-bar").style.width = `${score}%`;
  const todayKey = localDateKey();
  const visible = dueTasksForDate(todayKey);
  const completed = visible.filter((task) => taskDoneOn(task, todayKey)).length;
  const ctx = $("#sidebar-context");
  if (ctx) ctx.textContent = `${completed}/${visible.length} задач сегодня · ${score}% привычек за неделю`;
}

function navRouteActive(route) {
  if (MORE_ROUTES.has(activeRoute) && route === "more") return true;
  return activeRoute === route;
}

function setRoute(route) {
  activeRoute = routeMeta[route] ? route : "today";
  location.hash = activeRoute;
  let [eyebrow, title] = routeMeta[activeRoute];
  const viewKey = getViewDateKey();
  if (activeRoute === "today" && viewKey !== localDateKey()) {
    title = formatDate(getViewDate(), { weekday: "long", day: "numeric", month: "long" });
  }
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  $("#current-day-type").textContent = `${currentDayType()} день`;
  $$("[data-route]").forEach((link) => {
    const routeName = link.dataset.route;
    const group = link.dataset.routeGroup;
    const active = group ? navRouteActive(group) : navRouteActive(routeName);
    link.classList.toggle("active", active);
  });
  $("#sidebar").classList.remove("open");
  closeQuickAddMenu();
  render();
}

function voiceSectionForRoute(route = activeRoute) {
  if (route === "more" || route === "settings") return "today";
  return route;
}

function voiceAgentBar() {
  const section = voiceSectionForRoute();
  return `<div class="voice-agent-bar">
    <button type="button" class="voice-mic-button" data-action="open-voice-agent" data-section="${section}" aria-label="Голосовой ввод для ассистента">
      <span class="mic-icon" aria-hidden="true">🎤</span>
      <span class="voice-mic-label">Голосом ассистенту</span>
    </button>
  </div>`;
}

function metricCard(icon, value, label, tone) {
  return `
    <article class="metric-card col-3 ${tone}">
      <span class="metric-icon">${icon}</span>
      <strong class="metric-value">${value}</strong>
      <span class="metric-label">${label}</span>
    </article>`;
}

function priorityTag(priority) {
  const labels = { high: "Высокий", medium: "Средний", low: "Низкий" };
  return `<span class="tag ${priority}">${labels[priority]}</span>`;
}

function todayTaskStats(tasks, dateKey) {
  let done = 0;
  let progress = 0;
  let fresh = 0;
  for (const task of tasks) {
    if (taskDoneOn(task, dateKey)) {
      done += 1;
      continue;
    }
    if (task.kind === "simple" && task.status === "progress") progress += 1;
    else fresh += 1;
  }
  const total = tasks.length;
  return { done, progress, fresh, total };
}

function todayStatusDonut(stats) {
  const { done, progress, fresh, total } = stats;
  if (!total) {
    return `<div class="today-donut empty"><div class="today-donut-hole"><strong>0%</strong><small>нет задач</small></div></div>`;
  }
  const d = Math.round((done / total) * 100);
  const p = Math.round((progress / total) * 100);
  const n = Math.max(0, 100 - d - p);
  const dEnd = d;
  const pEnd = d + p;
  return `
    <div class="today-donut" style="--seg-done:${dEnd}%; --seg-progress:${pEnd}%;" role="img" aria-label="Готово ${d}%, в работе ${p}%, не взято ${n}%">
      <div class="today-donut-hole">
        <strong>${d}%</strong>
        <small>готово</small>
      </div>
    </div>
    <ul class="today-donut-legend">
      <li><i class="dot done"></i>Готово <b>${done}</b> (${d}%)</li>
      <li><i class="dot progress"></i>В работе <b>${progress}</b> (${p}%)</li>
      <li><i class="dot fresh"></i>Не взято <b>${fresh}</b> (${n}%)</li>
    </ul>`;
}

function taskRow(task, dateKey = getViewDateKey()) {
  const done = taskDoneOn(task, dateKey);
  const dateLabel =
    task.kind === "recurring"
      ? task.schedule === "daily"
        ? "Ежедневно"
        : "Регулярно"
      : task.due
        ? formatDate(new Date(`${task.due}T12:00:00`), { day: "numeric", month: "short" })
        : "Без срока";
  return `
    <div class="list-row ${done ? "done" : ""}">
      <button class="check ${done ? "checked" : ""}" data-action="toggle-task" data-id="${task.id}" aria-label="Изменить статус">${done ? "✓" : ""}</button>
      <div class="row-main" data-action="open-task-sheet" data-id="${task.id}" role="button" tabindex="0">
        <div class="row-title">${escapeHtml(task.title)}</div>
        <div class="row-meta"><span>${escapeHtml(task.category)}</span><span>•</span><span>${dateLabel}</span>${task.kind === "simple" && task.status === "progress" ? `<span>•</span><span class="tag medium">В работе</span>` : ""}</div>
      </div>
      <div class="row-actions">
        ${priorityTag(task.priority)}
        <button type="button" class="row-delete" data-action="cancel-task" data-id="${task.id}" aria-label="Отменить задачу" title="Отменить (не выполнять)">×</button>
      </div>
    </div>`;
}

function renderToday() {
  const viewKey = getViewDateKey();
  const isToday = viewKey === localDateKey();
  const visible = dueTasksForDate(viewKey);
  const open = visible.filter((task) => !taskDoneOn(task, viewKey));
  const done = visible.filter((task) => taskDoneOn(task, viewKey));
  const overdue = state.tasks.filter((task) => {
    if (task.kind !== "simple" || task.status === "done" || task.status === "cancelled") return false;
    const due = normalizeDateKey(task.due);
    return due && due < localDateKey();
  }).length;
  const todayLimit = 8;
  const openPreview = open.slice(0, todayLimit);
  const list = [...openPreview, ...(state.ui.todayShowDone ? done : [])];
  const dayStats = todayTaskStats(visible, viewKey);

  const dateLine = isToday
    ? formatDate(getViewDate(), { weekday: "long", day: "numeric", month: "long" })
    : `${formatDate(getViewDate(), { weekday: "long", day: "numeric", month: "long" })} · <button type="button" class="link-button" data-action="pick-date" data-date="${localDateKey()}">сегодня</button>`;

  return `
    <div class="today-minimal">
      <section class="today-hero panel">
        <p class="today-hero-lead">Создайте задачу или отметьте, что уже сделано.</p>
        <div class="today-hero-actions">
          <button type="button" class="today-cta primary" data-action="open-voice-agent" data-section="today">
            <span aria-hidden="true">🎤</span> Голосом
          </button>
          <button type="button" class="today-cta" data-action="open-modal" data-type="task">
            <span aria-hidden="true">＋</span> Задача
          </button>
        </div>
      </section>

      <div class="today-meta">
        <span class="today-meta-date">${dateLine}</span>
        <span class="tag day-type-tag">${currentDayType()}</span>
        <span class="today-meta-stats">${open.length} открыто · ${done.length} готово${overdue ? ` · <a href="#tasks" class="today-meta-warn">${overdue} просрочено</a>` : ""}</span>
      </div>

      <section class="panel today-list-panel">
        <div class="panel-head today-list-head">
          <div>
            <span class="eyebrow">СВЕРКА</span>
            <h2>На ${isToday ? "сегодня" : "этот день"}</h2>
          </div>
          ${done.length ? `<button type="button" class="ghost-button mini" data-action="toggle-today-done">${state.ui.todayShowDone ? "Скрыть готовые" : `Готовые (${done.length})`}</button>` : ""}
        </div>
        <div class="today-stats-bar">${todayStatusDonut(dayStats)}</div>
        <div class="task-list today-task-list">
          ${list.length ? list.map((task) => taskRow(task, viewKey)).join("") : `<div class="empty-state"><strong>${open.length === 0 && done.length ? "Всё закрыто" : "Задач нет"}</strong>${open.length === 0 && !done.length ? "Добавьте задачу кнопкой выше или голосом." : "Можно добавить новую в разделе «Задачи»."}</div>`}
        </div>
        ${open.length > todayLimit ? `<p class="panel-subtitle today-more"><a href="#tasks">Ещё ${open.length - todayLimit} в разделе «Задачи» →</a></p>` : ""}
      </section>
    </div>`;
}

function monthFromState() {
  const [year, month] = state.habitViewMonth.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function monthDates(monthDate) {
  const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, index) => new Date(monthDate.getFullYear(), monthDate.getMonth(), index + 1));
}

function weekDatesAroundToday() {
  const today = new Date();
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function habitTableDates() {
  if (state.ui.habitTableRange === "week") return weekDatesAroundToday();
  return monthDates(monthFromState());
}

function monthHabitValues(dates) {
  return dates.map((date) => habitScoreForDate(localDateKey(date)));
}

function barChartSvg(values, color = "#00c98b") {
  const width = 560;
  const height = 170;
  const padding = 22;
  const innerHeight = height - 40;
  const gap = 4;
  const barWidth = Math.max(4, (width - padding * 2) / values.length - gap);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Выполнение по дням">
    ${[0.25, 0.5, 0.75, 1].map((level) => `<line class="chart-grid" x1="${padding}" y1="${height - 22 - innerHeight * level}" x2="${width - padding}" y2="${height - 22 - innerHeight * level}"/>`).join("")}
    ${values.map((value, index) => {
      const barHeight = value * innerHeight;
      const x = padding + index * (barWidth + gap);
      const y = height - 22 - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${color}" opacity="${index === values.length - 1 ? 1 : 0.82}"/>`;
    }).join("")}
    ${values.map((_, index) => (index % 5 === 0 ? `<text class="chart-label" x="${padding + index * (barWidth + gap)}" y="${height - 6}">${index + 1}</text>` : "")).join("")}
  </svg>`;
}

function donutSvg(percent) {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - circumference * percent;
  return `<div class="progress-ring">
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <circle class="track" cx="80" cy="80" r="${radius}"></circle>
      <circle class="value" cx="80" cy="80" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
    </svg>
    <div class="ring-label"><strong>${Math.round(percent * 100)}%</strong><small>общий результат</small></div>
  </div>`;
}

function habitsTodayDock() {
  const todayKey = localDateKey();
  return `<div class="habits-dock">
    <span class="eyebrow">СЕГОДНЯ</span>
    <div class="habits-dock-row">
      ${HABITS.map((habit) => {
        const checked = Boolean(state.habits[todayKey]?.[habit.id]);
        return `<button type="button" class="habit-dock-btn ${checked ? "checked" : ""}" data-action="toggle-habit" data-habit="${habit.id}" data-date="${todayKey}" aria-label="${habit.name}">${habit.icon}</button>`;
      }).join("")}
    </div>
  </div>`;
}

function renderHabits() {
  const monthDate = monthFromState();
  const tableDates = habitTableDates();
  const chartDates = state.ui.habitTableRange === "week" ? tableDates : monthDates(monthDate);
  const values = monthHabitValues(chartDates);
  const overall = values.reduce((total, value) => total + value, 0) / values.length;
  const todayKey = localDateKey();

  const habitRows = HABITS.map((habit) => {
    const completed = tableDates.filter((date) => state.habits[localDateKey(date)]?.[habit.id]).length;
    const percent = completed / tableDates.length;
    return `<tr>
      <td class="habit-name">${habit.icon} ${habit.name}</td>
      ${tableDates.map((date) => {
        const key = localDateKey(date);
        const checked = Boolean(state.habits[key]?.[habit.id]);
        return `<td><button class="habit-check ${checked ? "checked" : ""}" data-action="toggle-habit" data-habit="${habit.id}" data-date="${key}">${checked ? "✓" : ""}</button></td>`;
      }).join("")}
      <td class="summary">${Math.round(percent * 100)}%</td>
      <td class="bar-cell"><div class="habit-progress"><i style="width:${percent * 100}%"></i></div></td>
    </tr>`;
  }).join("");

  const detailChart = state.ui.habitDetailChart
    ? `<section class="panel chart-card">
        <div class="panel-head"><div><span class="eyebrow">ДИНАМИКА</span><h3>Ритм периода</h3></div></div>
        <div class="chart-container">${barChartSvg(values, "#22d3ee")}</div>
      </section>`
    : "";

  return `
    ${voiceAgentBar()}
    <div class="section-toolbar habits-toolbar">
      <div class="month-control">
        <button data-action="change-month" data-delta="-1" ${state.ui.habitTableRange === "week" ? "disabled" : ""}>‹</button>
        <strong>${state.ui.habitTableRange === "week" ? "Текущая неделя" : formatDate(monthDate, { month: "long", year: "numeric" })}</strong>
        <button data-action="change-month" data-delta="1" ${state.ui.habitTableRange === "week" ? "disabled" : ""}>›</button>
      </div>
      <div class="segmented">
        <button type="button" class="${state.ui.habitTableRange === "week" ? "active" : ""}" data-action="set-habit-range" data-value="week">Неделя</button>
        <button type="button" class="${state.ui.habitTableRange === "month" ? "active" : ""}" data-action="set-habit-range" data-value="month">Месяц</button>
      </div>
      <span class="tag">${Math.round(overall * 100)}% периода</span>
    </div>

    <div class="habit-hero">
      <section class="panel chart-card">
        <div class="panel-head">
          <div><span class="eyebrow">ДИСЦИПЛИНА</span><h3>Выполнение по дням</h3></div>
          <button type="button" class="ghost-button mini" data-action="toggle-habit-detail">${state.ui.habitDetailChart ? "Меньше графиков" : "Подробнее"}</button>
        </div>
        <div class="chart-container">${barChartSvg(values)}</div>
      </section>
      ${detailChart}
      <section class="panel chart-card">
        <div class="panel-head"><div><span class="eyebrow">РЕЗУЛЬТАТ</span><h3>Общий прогресс</h3></div></div>
        ${donutSvg(overall)}
      </section>
    </div>

    <div class="habit-table-wrap ${state.ui.habitTableRange === "week" ? "habit-table-week" : ""}">
      <table class="habit-table">
        <thead>
          <tr>
            <th class="habit-name">ПРИВЫЧКА</th>
            ${tableDates.map((date) => `<th class="day-head ${date.getDay() === 0 || date.getDay() === 6 ? "weekend" : ""} ${localDateKey(date) === todayKey ? "today" : ""}">${date.getDate()}<br><small>${formatDate(date, { weekday: "short" }).slice(0, 2)}</small></th>`).join("")}
            <th class="summary">%</th>
            <th class="bar-cell">ПРОГРЕСС</th>
          </tr>
        </thead>
        <tbody>${habitRows}</tbody>
      </table>
    </div>
    ${habitsTodayDock()}`;
}

function filteredTasksList() {
  let list = state.tasks;
  if (state.ui.taskKindFilter === "recurring") list = list.filter((t) => t.kind === "recurring");
  if (state.ui.taskKindFilter === "simple") list = list.filter((t) => t.kind === "simple");
  if (state.ui.taskCategoryFilter !== "all") list = list.filter((t) => t.category === state.ui.taskCategoryFilter);
  return list;
}

function renderRecurringTasks() {
  const todayKey = localDateKey();
  const tasks = filteredTasksList().filter((t) => t.kind === "recurring" && t.status !== "cancelled");
  return `<div class="recurring-list">
    ${tasks
      .map((task) => {
        const done = taskDoneOn(task, todayKey);
        return `<article class="recurring-card">
          <div class="recurring-head">
            <h4>${escapeHtml(task.title)}</h4>
            ${priorityTag(task.priority)}
          </div>
          <p>${escapeHtml(task.category)} · ${task.dayType} · ${task.schedule === "daily" ? "Ежедневно" : "Регулярно"}</p>
          <div class="recurring-actions">
            <span class="tag ${done ? "low" : ""}">${done ? "Сегодня выполнено" : "Не отмечено сегодня"}</span>
            <button type="button" class="ghost-button mini" data-action="toggle-task" data-id="${task.id}">${done ? "Снять" : "Отметить"}</button>
            <button type="button" class="ghost-button mini" data-action="open-task-sheet" data-id="${task.id}">Детали</button>
            <button type="button" class="ghost-button mini danger-text" data-action="cancel-task" data-id="${task.id}">Отменить</button>
          </div>
        </article>`;
      })
      .join("") || `<div class="panel empty-state"><strong>Регулярных задач нет</strong>Добавьте задачу с типом «Регулярная».</div>`}
  </div>`;
}

function renderTasksKanban() {
  const columns = [
    { id: "new", title: "НОВЫЕ" },
    { id: "progress", title: "В РАБОТЕ" },
    { id: "done", title: "ГОТОВО" },
  ];
  const base = filteredTasksList().filter((t) => t.kind === "simple" && t.status !== "cancelled");
  return `<div class="task-board">
    ${columns
      .map((column) => {
        const tasks = base.filter((task) => task.status === column.id);
        return `<section class="board-column" data-board-column="${column.id}">
          <div class="board-title"><span>${column.title}</span><b>${tasks.length}</b></div>
          <div class="board-dropzone" data-drop-status="${column.id}">
          ${tasks
            .map(
              (task) => `
            <article class="task-card" draggable="true" data-task-id="${task.id}" data-action="open-task-sheet" data-id="${task.id}">
              <span class="task-card-grip" aria-hidden="true" title="Перетащите">⋮⋮</span>
              <button type="button" class="task-card-delete" data-action="cancel-task" data-id="${task.id}" aria-label="Отменить задачу">×</button>
              <h4>${escapeHtml(task.title)}</h4>
              <div class="task-card-footer">
                <span>${escapeHtml(task.category)}</span>
                ${priorityTag(task.priority)}
              </div>
            </article>`,
            )
            .join("") || `<div class="board-empty-hint empty-state"><strong>Зона пуста</strong>Перетащите сюда карточку</div>`}
          </div>
        </section>`;
      })
      .join("")}
  </div>`;
}

function categoryChips() {
  return `<div class="filter-chips">
    <button type="button" class="${state.ui.taskCategoryFilter === "all" ? "active" : ""}" data-action="set-task-category" data-value="all">Все категории</button>
    ${TASK_CATEGORIES.map(
      (cat) =>
        `<button type="button" class="${state.ui.taskCategoryFilter === cat ? "active" : ""}" data-action="set-task-category" data-value="${cat}">${cat}</button>`,
    ).join("")}
  </div>`;
}

function renderTasks() {
  const kind = state.ui.taskKindFilter;
  return `
    ${voiceAgentBar()}
    <p class="route-lead panel-subtitle">Канбан для разовых задач. Регулярные процессы — отдельным списком правил.</p>
    <div class="section-toolbar">
      <div class="segmented">
        <button type="button" class="${kind === "all" ? "active" : ""}" data-action="set-task-filter" data-value="all">Все</button>
        <button type="button" class="${kind === "recurring" ? "active" : ""}" data-action="set-task-filter" data-value="recurring">Регулярные</button>
        <button type="button" class="${kind === "simple" ? "active" : ""}" data-action="set-task-filter" data-value="simple">Разовые</button>
      </div>
      <button class="primary-button" data-action="open-modal" data-type="task">＋ Новая задача</button>
    </div>
    ${categoryChips()}
    ${kind === "recurring" ? renderRecurringTasks() : renderTasksKanban()}`;
}

function projectStagesList(project) {
  if (!project.stages?.length) return `<p class="panel-subtitle">Этапы не заданы.</p>`;
  return `<ul class="stage-list">
    ${project.stages
      .map(
        (stage) => `<li>
        <button type="button" class="check ${stage.done ? "checked" : ""}" data-action="toggle-stage" data-project="${project.id}" data-stage="${stage.id}">${stage.done ? "✓" : ""}</button>
        <span class="${stage.done ? "done" : ""}">${escapeHtml(stage.title)}</span>
      </li>`,
      )
      .join("")}
  </ul>`;
}

function renderProjects() {
  const tab = state.ui.projectTab;
  const projects = state.projects.filter((p) => {
    if (tab === "active") return p.status === "active";
    if (tab === "paused") return p.status === "paused";
    return p.status === "completed";
  });
  return `
    ${voiceAgentBar()}
    <div class="section-toolbar">
      <div class="segmented">
        <button type="button" class="${tab === "active" ? "active" : ""}" data-action="set-project-tab" data-value="active">Активные</button>
        <button type="button" class="${tab === "paused" ? "active" : ""}" data-action="set-project-tab" data-value="paused">На паузе</button>
        <button type="button" class="${tab === "completed" ? "active" : ""}" data-action="set-project-tab" data-value="completed">Завершённые</button>
      </div>
      <button class="primary-button" data-action="open-modal" data-type="project">＋ Новый проект</button>
    </div>
    <div class="project-grid">
      ${projects
        .map((project) => {
          const progress = projectProgress(project);
          const completed = project.stages.filter((stage) => stage.done).length;
          return `<article class="project-card">
          <div class="project-card-head">
            <div><span class="eyebrow">${project.status === "active" ? "АКТИВНЫЙ" : project.status === "paused" ? "ПАУЗА" : "ЗАВЕРШЁН"}</span><h3>${escapeHtml(project.title)}</h3></div>
            ${priorityTag(project.priority)}
          </div>
          <p>${escapeHtml(project.goal)}</p>
          <div class="next-step-box">
            <span class="eyebrow">СДЕЛАТЬ СЕЙЧАС</span>
            <strong>${escapeHtml(project.nextStep || "Укажите следующий шаг")}</strong>
            <button type="button" class="primary-button mini" data-action="pin-project-focus" data-id="${project.id}">В фокус на сегодня</button>
          </div>
          ${projectStagesList(project)}
          <div class="project-progress"><i style="width:${progress * 100}%"></i></div>
          <div class="project-stats"><span>${completed} из ${project.stages.length} этапов</span><strong>${Math.round(progress * 100)}%</strong></div>
          <div class="project-stats"><span>Дедлайн</span><span>${project.deadline ? formatDate(new Date(`${project.deadline}T12:00:00`), { day: "numeric", month: "long" }) : "Без срока"}</span></div>
          <div class="project-card-actions">
            ${project.status !== "paused" ? `<button type="button" class="ghost-button mini" data-action="set-project-status" data-id="${project.id}" data-status="paused">Пауза</button>` : ""}
            ${project.status !== "active" ? `<button type="button" class="ghost-button mini" data-action="set-project-status" data-id="${project.id}" data-status="active">Активировать</button>` : ""}
            ${project.status !== "completed" ? `<button type="button" class="ghost-button mini" data-action="set-project-status" data-id="${project.id}" data-status="completed">Завершить</button>` : ""}
          </div>
        </article>`;
        })
        .join("") || `<div class="panel empty-state"><strong>Проектов в этой вкладке нет</strong>Создайте проект или смените фильтр.</div>`}
    </div>`;
}

function renderFinanceSummary() {
  const totalTarget = state.finance.reduce((sum, goal) => sum + Number(goal.target || 0), 0);
  const totalSaved = state.finance.reduce((sum, goal) => sum + Number(goal.saved || 0), 0);
  const totalProgress = totalTarget ? totalSaved / totalTarget : 0;
  const open = state.ui.financeSummaryOpen;
  return `
    <section class="panel finance-summary ${open ? "open" : "closed"}">
      <button type="button" class="finance-summary-toggle" data-action="toggle-finance-summary">
        <span><strong>${currency(totalSaved)}</strong> накоплено · ${Math.round(totalProgress * 100)}% · ${state.finance.length} целей</span>
        <span class="chev">${open ? "▴" : "▾"}</span>
      </button>
      <div class="finance-summary-body">
        <div class="dashboard-grid compact-metrics">
          ${metricCard("₽", currency(totalSaved), "всего", "gold")}
          ${metricCard("◎", currency(Math.max(totalTarget - totalSaved, 0)), "осталось", "purple")}
          ${metricCard("↗", `${Math.round(totalProgress * 100)}%`, "прогресс", "mint")}
        </div>
      </div>
    </section>`;
}

function renderFinance() {
  return `
    ${voiceAgentBar()}
    ${renderFinanceSummary()}
    <div class="section-toolbar">
      <p class="panel-subtitle">Без учёта расходов — только движение к целям.</p>
      <button class="primary-button" data-action="open-modal" data-type="finance">＋ Новая цель</button>
    </div>
    <div class="finance-grid">
      ${state.finance
        .map((goal) => {
          const progress = goal.target ? Math.min(goal.saved / goal.target, 1) : 0;
          const left = Math.max(Number(goal.target) - Number(goal.saved), 0);
          return `<article class="finance-card">
          <div class="finance-card-head">
            <div><span class="eyebrow">ФИНАНСОВАЯ ЦЕЛЬ</span><h3>${escapeHtml(goal.title)}</h3></div>
            ${priorityTag(goal.priority)}
          </div>
          <p class="finance-remaining">Осталось <strong>${currency(left)}</strong></p>
          <p class="finance-sub">${escapeHtml(goal.note || "Дедлайн не обязателен.")}</p>
          <div class="finance-progress"><i style="width:${progress * 100}%"></i></div>
          <div class="finance-stats"><strong>${currency(goal.saved)}</strong><span>из ${currency(goal.target)}</span></div>
          <button type="button" class="primary-button mini" data-action="open-deposit" data-id="${goal.id}">Внести сумму</button>
        </article>`;
        })
        .join("") || `<div class="panel empty-state" style="grid-column:1/-1"><strong>Добавьте первую финансовую цель</strong>Крупно видно «осталось» и быстрый ввод суммы.</div>`}
    </div>`;
}

function renderMore() {
  return `
    ${voiceAgentBar()}
    <div class="more-grid">
      <a href="#projects" class="more-card"><span>◇</span><div><strong>Проекты</strong><small>Этапы и следующий шаг</small></div></a>
      <a href="#finance" class="more-card"><span>₽</span><div><strong>Финансы</strong><small>Цели и накопления</small></div></a>
      <button type="button" class="more-card" data-action="open-assistant"><span>✦</span><div><strong>Подсказки</strong><small>Сценарии по плану</small></div></button>
      <a href="#settings" class="more-card"><span>⚙</span><div><strong>Настройки</strong><small>Главная и тип дня</small></div></a>
    </div>`;
}

function renderSettings() {
  const s = state.settings;
  return `
    ${voiceAgentBar()}
    <section class="panel settings-panel">
      <div class="panel-head"><div><span class="eyebrow">ИНТЕРФЕЙС</span><h2>Настройки</h2></div></div>
      <div class="settings-list">
        <label class="settings-row">
          <span>Тип дня по умолчанию (будни)</span>
          <select data-action="setting-change" data-key="defaultDayType">
            ${DAY_TYPES.map((t) => `<option value="${t}" ${s.defaultDayType === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="panel-subtitle">Данные хранятся только в этом браузере.</p>
    </section>`;
}

function render() {
  const view = $("#app-view");
  const renderers = {
    today: renderToday,
    habits: renderHabits,
    tasks: renderTasks,
    projects: renderProjects,
    finance: renderFinance,
    more: renderMore,
    settings: renderSettings,
  };
  view.innerHTML = renderers[activeRoute]?.() || renderToday();
  updateSidebarScore();
  setupTaskBoardDnD();
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const dateKey = getViewDateKey();
  if (task.kind === "recurring") {
    task.completedDates ||= [];
    task.completedDates = task.completedDates.includes(dateKey)
      ? task.completedDates.filter((date) => date !== dateKey)
      : [...task.completedDates, dateKey];
  } else {
    task.status = task.status === "done" ? "new" : "done";
  }
  saveState();
  render();
  if (taskSheetId === id) openTaskSheet(id);
}

function cycleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.kind === "recurring") return;
  const statuses = ["new", "progress", "done"];
  task.status = statuses[(statuses.indexOf(task.status) + 1) % statuses.length];
  saveState();
  render();
  if (taskSheetId === id) openTaskSheet(id);
}

function cancelTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.status = "cancelled";
  if (task.kind === "recurring") {
    task.completedDates = [];
  }
  state.focusPins = state.focusPins.filter((pinId) => pinId !== id);
  saveState();
  if (taskSheetId === id) {
    taskSheetId = null;
    $("#task-sheet").close();
  }
  render();
  showToast("Задача отменена — выполнять не нужно");
}

function moveTaskToStatus(id, status) {
  const task = state.tasks.find((item) => item.id === id);
  const allowed = ["new", "progress", "done"];
  if (!task || task.kind !== "simple" || !allowed.includes(status) || task.status === status) return;
  task.status = status;
  saveState();
  render();
}

let draggedTaskId = null;

function setupTaskBoardDnD() {
  if (activeRoute !== "tasks" || state.ui.taskKindFilter === "recurring") return;
  const board = document.querySelector(".task-board");
  if (!board || board.dataset.dndBound === "1") return;
  board.dataset.dndBound = "1";

  board.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".task-card[draggable]");
    if (!card) return;
    draggedTaskId = card.dataset.taskId;
    card.classList.add("dragging");
    event.dataTransfer.setData("application/x-focus-task", draggedTaskId);
    event.dataTransfer.setData("text/plain", draggedTaskId);
    event.dataTransfer.effectAllowed = "move";
  });

  board.addEventListener("dragend", (event) => {
    event.target.closest(".task-card")?.classList.remove("dragging");
    board.querySelectorAll(".board-dropzone").forEach((zone) => zone.classList.remove("drop-over"));
    setTimeout(() => {
      draggedTaskId = null;
      suppressTaskClick = true;
      setTimeout(() => {
        suppressTaskClick = false;
      }, 120);
    }, 0);
  });

  board.addEventListener("dragover", (event) => {
    const zone = event.target.closest(".board-dropzone");
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    board.querySelectorAll(".board-dropzone").forEach((z) => z.classList.toggle("drop-over", z === zone));
  });

  board.addEventListener("dragleave", (event) => {
    const zone = event.target.closest(".board-dropzone");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("drop-over");
  });

  board.addEventListener("drop", (event) => {
    const zone = event.target.closest(".board-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("drop-over");
    const id = event.dataTransfer.getData("application/x-focus-task") || draggedTaskId;
    moveTaskToStatus(id, zone.dataset.dropStatus);
  });
}

function toggleHabit(habitId, dateKey) {
  state.habits[dateKey] ||= {};
  state.habits[dateKey][habitId] = !state.habits[dateKey][habitId];
  saveState();
  render();
}

function changeMonth(delta) {
  const date = monthFromState();
  date.setMonth(date.getMonth() + delta);
  state.habitViewMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  saveState();
  render();
}

function cycleDayType() {
  const key = getViewDateKey();
  const currentIndex = DAY_TYPES.indexOf(currentDayType());
  state.dayTypes[key] = DAY_TYPES[(currentIndex + 1) % DAY_TYPES.length];
  saveState();
  setRoute(activeRoute);
  showToast(`Тип дня: ${state.dayTypes[key]}`);
}

function pinProjectFocus(projectId) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;
  const title = project.nextStep || project.title;
  const task = {
    id: uid("task"),
    title,
    category: "Личное",
    priority: project.priority || "high",
    kind: "simple",
    schedule: null,
    dayType: "Любой",
    due: localDateKey(),
    status: "new",
    completedDates: [],
    projectId,
  };
  state.tasks.unshift(task);
  state.focusPins = [task.id, ...state.focusPins.filter((id) => id !== task.id)].slice(0, 5);
  saveState();
  state.ui.viewDateKey = localDateKey();
  showToast("Шаг добавлен в фокус", { label: "Открыть", onClick: () => setRoute("today") });
  setRoute("today");
}

function toggleStage(projectId, stageId) {
  const project = state.projects.find((p) => p.id === projectId);
  const stage = project?.stages?.find((s) => s.id === stageId);
  if (!stage) return;
  stage.done = !stage.done;
  const next = project.stages.find((s) => !s.done);
  if (next) project.nextStep = next.title;
  saveState();
  render();
}

function setProjectStatus(id, status) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  project.status = status;
  saveState();
  render();
}

function openDepositModal(goalId) {
  modalType = "deposit";
  const goal = state.finance.find((g) => g.id === goalId);
  if (!goal) return;
  $("#modal-eyebrow").textContent = "ПОПОЛНЕНИЕ";
  $("#modal-title").textContent = goal.title;
  $("#modal-fields").innerHTML = fieldTemplate({
    name: "amount",
    label: "Сумма",
    type: "number",
    full: true,
    placeholder: "5000",
    value: "",
  });
  $("#entity-modal").dataset.goalId = goalId;
  $("#entity-modal").showModal();
}

function fieldTemplate(field) {
  const className = `field ${field.full ? "full" : ""}`;
  if (field.type === "select") {
    return `<div class="${className}"><label for="${field.name}">${field.label}</label><select id="${field.name}" name="${field.name}" required>${field.options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>`;
  }
  if (field.type === "textarea") {
    return `<div class="${className}"><label for="${field.name}">${field.label}</label><textarea id="${field.name}" name="${field.name}" placeholder="${field.placeholder || ""}"></textarea></div>`;
  }
  return `<div class="${className}"><label for="${field.name}">${field.label}</label><input id="${field.name}" name="${field.name}" type="${field.type || "text"}" ${field.required === false ? "" : "required"} placeholder="${field.placeholder || ""}" value="${field.value || ""}"></div>`;
}

function openModal(type) {
  modalType = type;
  delete $("#entity-modal").dataset.goalId;
  const today = localDateKey();
  const configs = {
    task: {
      eyebrow: "НОВАЯ ЗАДАЧА",
      title: "Добавить конкретное действие",
      fields: [
        { name: "title", label: "Что нужно сделать?", full: true, placeholder: "Например: подготовить отчёт" },
        {
          name: "category",
          label: "Категория",
          type: "select",
          options: TASK_CATEGORIES.map((c) => [c, c]),
        },
        { name: "priority", label: "Приоритет", type: "select", options: [["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]] },
        { name: "due", label: "Дата", type: "date", value: today },
        { name: "kind", label: "Тип", type: "select", options: [["simple", "Разовая"], ["recurring", "Регулярная"]] },
      ],
    },
    project: {
      eyebrow: "НОВЫЙ ПРОЕКТ",
      title: "Зафиксировать ожидаемый результат",
      fields: [
        { name: "title", label: "Название проекта", full: true, placeholder: "Например: запуск летнего меню" },
        { name: "goal", label: "Ожидаемый результат", type: "textarea", full: true, placeholder: "Что должно измениться?" },
        { name: "priority", label: "Приоритет", type: "select", options: [["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]] },
        { name: "deadline", label: "Дедлайн", type: "date", required: false },
        { name: "nextStep", label: "Следующий шаг", full: true, placeholder: "Одно конкретное действие" },
      ],
    },
    finance: {
      eyebrow: "НОВАЯ ЦЕЛЬ",
      title: "Добавить финансовую цель",
      fields: [
        { name: "title", label: "Название цели", full: true, placeholder: "Финансовая подушка" },
        { name: "target", label: "Целевая сумма", type: "number", placeholder: "300000" },
        { name: "saved", label: "Уже накоплено", type: "number", value: "0" },
        { name: "priority", label: "Приоритет", type: "select", options: [["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]] },
        { name: "note", label: "Заметка", type: "textarea", full: true, placeholder: "Зачем вам эта цель?" },
      ],
    },
  };
  const config = configs[type] || configs.task;
  $("#modal-eyebrow").textContent = config.eyebrow;
  $("#modal-title").textContent = config.title;
  $("#modal-fields").innerHTML = config.fields.map(fieldTemplate).join("");
  $("#entity-form")?.reset();
  $("#entity-modal").showModal();
  closeQuickAddMenu();
  requestAnimationFrame(() => $("#modal-fields input, #modal-fields select")?.focus());
}

function closeQuickAddMenu() {
  $("#quick-add-menu")?.setAttribute("hidden", "");
  $("#quick-add")?.setAttribute("aria-expanded", "false");
}

function closeEntityModal() {
  closeQuickAddMenu();
  $("#entity-form")?.reset();
  $("#entity-modal").close();
}

function submitModal(formData) {
  const form = $("#entity-form");
  if (form && !form.reportValidity()) return;
  const values = Object.fromEntries(formData.entries());
  if (modalType === "deposit") {
    const goalId = $("#entity-modal").dataset.goalId;
    const goal = state.finance.find((g) => g.id === goalId);
    if (goal) {
      goal.saved = Number(goal.saved || 0) + Number(values.amount || 0);
      saveState();
      showToast(`+ ${currency(values.amount)} к цели`);
    }
    $("#entity-modal").close();
    render();
    return;
  }
  let openRoute = activeRoute;
  if (modalType === "task") {
    state.tasks.unshift({
      id: uid("task"),
      title: values.title,
      category: values.category,
      priority: values.priority,
      kind: values.kind,
      schedule: values.kind === "recurring" ? "daily" : null,
      dayType: values.kind === "recurring" ? state.settings.defaultDayType : "Любой",
      due: values.due,
      status: "new",
      completedDates: [],
    });
    openRoute = "tasks";
  }
  if (modalType === "project") {
    state.projects.unshift({
      id: uid("project"),
      title: values.title,
      goal: values.goal,
      priority: values.priority,
      status: "active",
      nextStep: values.nextStep,
      deadline: values.deadline,
      stages: values.nextStep ? [{ id: uid("stage"), title: values.nextStep, done: false }] : [],
    });
    openRoute = "projects";
  }
  if (modalType === "finance") {
    state.finance.unshift({
      id: uid("finance"),
      title: values.title,
      target: Number(values.target),
      saved: Number(values.saved),
      priority: values.priority,
      note: values.note,
    });
    openRoute = "finance";
  }
  saveState();
  $("#entity-modal").close();
  showToast("Добавлено", {
    label: "Открыть",
    onClick: () => setRoute(openRoute),
  });
  render();
}

function openTaskSheet(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  taskSheetId = id;
  const labels = { new: "Новая", progress: "В работе", done: "Готово" };
  $("#task-sheet-title").textContent = task.title;
  $("#task-sheet-body").innerHTML = `
    <p class="panel-subtitle">${escapeHtml(task.category)} · ${task.kind === "recurring" ? "Регулярная" : "Разовая"}</p>
    ${priorityTag(task.priority)}
    <p>Статус: <strong>${task.kind === "recurring" ? (taskDoneOn(task, localDateKey()) ? "Выполнено сегодня" : "Не отмечено сегодня") : labels[task.status] || task.status}</strong></p>
    ${task.due ? `<p>Срок: ${formatDate(new Date(`${task.due}T12:00:00`), { day: "numeric", month: "long", year: "numeric" })}</p>` : ""}
  `;
  $("#task-sheet").showModal();
}

function localAssistantReply(query) {
  const lower = query.toLowerCase();
  const visible = dueTasksForDate(localDateKey());
  const unfinished = visible.filter((task) => !taskDoneOn(task, localDateKey()));
  if (lower.includes("сегодня") || lower.includes("план") || lower.includes("главн")) {
    const simple = unfinished.filter((t) => t.kind === "simple").slice(0, 3);
    const top = simple.map((task, index) => `${index + 1}. ${escapeHtml(task.title)}`).join("<br>");
    return top
      ? `<strong>Три главных (разовые):</strong><br>${top}<br><br>Всего открыто ${unfinished.length} задач на сегодня.`
      : "<strong>Разовые задачи закрыты.</strong><br>Осталась только рутина или отдых.";
  }
  if (lower.includes("перегруз") || lower.includes("перен") || lower.includes("устал")) {
    const movable = unfinished.filter((task) => task.kind === "simple" && task.priority !== "high");
    return movable.length
      ? `<strong>Можно снизить нагрузку:</strong><br>${movable.map((task) => `• ${escapeHtml(task.title)}`).join("<br>")}`
      : "Перегруз в основном из приоритетных задач — сократите объём внутри одной из них.";
  }
  if (lower.includes("проект") || lower.includes("обзор")) {
    const projects = state.projects.filter((project) => project.status === "active");
    return projects.length
      ? `<strong>Активные проекты:</strong><br>${projects.map((project) => `• ${escapeHtml(project.title)} — ${Math.round(projectProgress(project) * 100)}%<br>Шаг: ${escapeHtml(project.nextStep || "—")}`).join("<br><br>")}`
      : "Активных проектов пока нет.";
  }
  if (lower.includes("финанс")) {
    const saved = state.finance.reduce((sum, goal) => sum + goal.saved, 0);
    return state.finance.length
      ? `Целей: ${state.finance.length}. Накоплено <strong>${currency(saved)}</strong>.`
      : "Финансовых целей пока нет.";
  }
  return "Выберите сценарий выше или спросите про план, перегруз, проекты или финансы.";
}

function addAssistantMessage(role, text) {
  state.assistantMessages.push({ role, text });
  if (state.assistantMessages.length > 40) state.assistantMessages = state.assistantMessages.slice(-40);
  saveState();
  renderAssistantMessages();
}

function renderAssistantMessages() {
  const container = $("#assistant-messages");
  container.innerHTML = state.assistantMessages
    .map((message) => `<div class="message ${message.role === "user" ? "user" : ""}">${message.text}</div>`)
    .join("");
  container.scrollTop = container.scrollHeight;
}

function showToast(message, action) {
  const toast = $("#toast");
  $("#toast-text").textContent = message;
  const btn = $("#toast-action");
  toastActionHandler = action?.onClick || null;
  if (action?.label && toastActionHandler) {
    btn.hidden = false;
    btn.textContent = action.label;
  } else {
    btn.hidden = true;
  }
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    const { action, id, habit, date, delta, type, value, project, stage, status, prompt, key } = actionTarget.dataset;
    if (action === "toggle-task") toggleTask(id);
    if (action === "cycle-task") cycleTask(id);
    if (action === "toggle-habit") toggleHabit(habit, date);
    if (action === "change-month") changeMonth(Number(delta));
    if (action === "open-modal") {
      closeQuickAddMenu();
      openModal(type);
    }
    if (action === "cancel-task") {
      event.stopPropagation();
      cancelTask(id);
    }
    if (action === "set-task-filter") {
      state.ui.taskKindFilter = value;
      saveState();
      render();
    }
    if (action === "set-task-category") {
      state.ui.taskCategoryFilter = value;
      saveState();
      render();
    }
    if (action === "set-project-tab") {
      state.ui.projectTab = value;
      saveState();
      render();
    }
    if (action === "set-habit-range") {
      state.ui.habitTableRange = value;
      saveState();
      render();
    }
    if (action === "toggle-habit-detail") {
      state.ui.habitDetailChart = !state.ui.habitDetailChart;
      saveState();
      render();
    }
    if (action === "toggle-regular") {
      state.ui.regularExpanded = !state.ui.regularExpanded;
      saveState();
      render();
    }
    if (action === "toggle-today-done") {
      state.ui.todayShowDone = !state.ui.todayShowDone;
      saveState();
      render();
    }
    if (action === "toggle-finance-summary") {
      state.ui.financeSummaryOpen = !state.ui.financeSummaryOpen;
      saveState();
      render();
    }
    if (action === "pick-date") {
      state.ui.viewDateKey = date;
      saveState();
      setRoute("today");
    }
    if (action === "open-task-sheet") {
      if (!suppressTaskClick) openTaskSheet(id);
    }
    if (action === "pin-project-focus") pinProjectFocus(id);
    if (action === "toggle-stage") toggleStage(project, stage);
    if (action === "set-project-status") setProjectStatus(id, status);
    if (action === "open-deposit") openDepositModal(id);
    if (action === "open-assistant") {
      $("#assistant-panel").showModal();
      renderAssistantMessages();
    }
    if (action === "assistant-prompt") {
      addAssistantMessage("user", escapeHtml(prompt));
      setTimeout(() => addAssistantMessage("assistant", localAssistantReply(prompt)), 180);
    }
    return;
  }

  if (!event.target.closest(".quick-add-wrap")) {
    closeQuickAddMenu();
  }
});

document.addEventListener("change", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  if (el.dataset.action === "setting-change") {
    state.settings[el.dataset.key] = el.value;
    saveState();
  }
  if (el.dataset.action === "setting-toggle") {
    state.settings[el.dataset.key] = el.checked;
    saveState();
    render();
  }
});

window.addEventListener("hashchange", () => setRoute(location.hash.replace("#", "") || "today"));

$("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#day-type-button").addEventListener("click", cycleDayType);

$("#quick-add").addEventListener("click", (event) => {
  event.stopPropagation();
  if (activeRoute === "projects") {
    openModal("project");
    return;
  }
  if (activeRoute === "finance") {
    openModal("finance");
    return;
  }
  const menu = $("#quick-add-menu");
  const isHidden = menu.hasAttribute("hidden");
  if (isHidden) {
    menu.removeAttribute("hidden");
    $("#quick-add").setAttribute("aria-expanded", "true");
  } else {
    closeQuickAddMenu();
  }
});

$("#task-sheet-cancel-task").addEventListener("click", () => {
  if (taskSheetId) cancelTask(taskSheetId);
});

$("#entity-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitModal(new FormData(event.currentTarget));
});

$("#modal-close").addEventListener("click", closeEntityModal);
$("#modal-cancel").addEventListener("click", closeEntityModal);

$("#assistant-open").addEventListener("click", () => {
  $("#assistant-panel").showModal();
  renderAssistantMessages();
});
$("#assistant-close").addEventListener("click", () => $("#assistant-panel").close());
$("#assistant-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#assistant-query");
  const query = input.value.trim();
  if (!query) return;
  addAssistantMessage("user", escapeHtml(query));
  input.value = "";
  setTimeout(() => addAssistantMessage("assistant", localAssistantReply(query)), 220);
});

$("#task-sheet-close").addEventListener("click", () => $("#task-sheet").close());
$("#task-sheet-cycle").addEventListener("click", () => {
  if (!taskSheetId) return;
  const task = state.tasks.find((t) => t.id === taskSheetId);
  if (task?.kind === "recurring") toggleTask(taskSheetId);
  else cycleTask(taskSheetId);
});
$("#task-sheet-done").addEventListener("click", () => {
  if (!taskSheetId) return;
  const task = state.tasks.find((t) => t.id === taskSheetId);
  if (task?.kind === "recurring") toggleTask(taskSheetId);
  else if (task && task.status !== "done") {
    task.status = "done";
    saveState();
    render();
    openTaskSheet(taskSheetId);
  }
});

$("#toast-action").addEventListener("click", () => {
  toastActionHandler?.();
  $("#toast").classList.remove("show");
});

function applyVoiceDraft(draft) {
  const { entityType, fields: f } = draft;
  let openRoute = activeRoute;
  if (entityType === "task") {
    state.tasks.unshift({
      id: uid("task"),
      title: f.title,
      category: f.category || "Личное",
      priority: f.priority || "medium",
      kind: f.kind || "simple",
      schedule: f.kind === "recurring" ? "daily" : null,
      dayType: f.dayType || (f.kind === "recurring" ? state.settings.defaultDayType : "Любой"),
      due: f.due || localDateKey(),
      status: "new",
      completedDates: [],
    });
    openRoute = activeRoute === "today" ? "today" : "tasks";
  } else if (entityType === "project") {
    state.projects.unshift({
      id: uid("project"),
      title: f.title,
      goal: f.goal || "",
      priority: f.priority || "medium",
      status: "active",
      nextStep: f.nextStep || "",
      deadline: f.deadline || "",
      stages: f.nextStep ? [{ id: uid("stage"), title: f.nextStep, done: false }] : [],
    });
    openRoute = "projects";
  } else if (entityType === "finance") {
    state.finance.unshift({
      id: uid("finance"),
      title: f.title,
      target: Number(f.target),
      saved: Number(f.saved) || 0,
      priority: f.priority || "medium",
      note: f.note || "",
    });
    openRoute = "finance";
  }
  saveState();
  showToast("Создано голосовым ассистентом", { label: "Открыть", onClick: () => setRoute(openRoute) });
  setRoute(openRoute);
}

window.FOCUS_applyVoiceDraft = applyVoiceDraft;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.warn));
}

setRoute(activeRoute);
