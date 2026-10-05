"use strict";

const DAY_TYPES = ["Рабочий", "Выходной", "Отпуск", "Больничный"];
const CATEGORIES = ["Работа", "Маркетинг", "Логистика", "Контент", "Личное"];

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, amount) {
  const c = new Date(date);
  c.setDate(c.getDate() + amount);
  return c;
}

function defaultEntityForSection(section) {
  const map = {
    today: "task",
    tasks: "task",
    habits: "task",
    projects: "project",
    finance: "finance",
    more: "task",
    settings: "task",
  };
  return map[section] || "task";
}

function detectEntityType(text, sectionDefault) {
  const lower = text.toLowerCase();
  if (/финанс|накоп|копить|подушк|целев\w* сумм|рубл|₽|тысяч|млн/.test(lower)) return "finance";
  if (/проект|этап|запуск|дорожн/.test(lower)) return "project";
  if (/задач|сделать|провер|позвон|написать|отправ|подготов|созвон|встреч/.test(lower)) return "task";
  return sectionDefault;
}

function parsePriority(text) {
  const lower = text.toLowerCase();
  if (/срочн|высок|важн|asap|критич/.test(lower)) return "high";
  if (/низк|не сроч|потом|когда-нибудь/.test(lower)) return "low";
  if (/средн/.test(lower)) return "medium";
  return null;
}

function parseCategory(text) {
  const lower = text.toLowerCase();
  for (const cat of CATEGORIES) {
    if (lower.includes(cat.toLowerCase())) return cat;
  }
  if (/маркет|реклам|instagram|инст/.test(lower)) return "Маркетинг";
  if (/логист|достав|склад/.test(lower)) return "Логистика";
  if (/контент|публикац|пост/.test(lower)) return "Контент";
  if (/личн|семь|дом/.test(lower)) return "Личное";
  return null;
}

function parseDueDate(text) {
  const lower = text.toLowerCase();
  const today = new Date();
  if (/сегодня/.test(lower)) return localDateKey(today);
  if (/завтра/.test(lower)) return localDateKey(addDays(today, 1));
  if (/послезавтра/.test(lower)) return localDateKey(addDays(today, 2));
  const weekdays = [
    ["воскресен", 0],
    ["понедельник", 1],
    ["вторник", 2],
    ["сред", 3],
    ["четверг", 4],
    ["пятниц", 5],
    ["суббот", 6],
  ];
  for (const [name, dayIndex] of weekdays) {
    if (lower.includes(name)) {
      const d = new Date(today);
      let diff = (dayIndex - d.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (/следующ/.test(lower)) diff += 7;
      return localDateKey(addDays(today, diff));
    }
  }
  const iso = text.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const dmy = text.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](20\d{2}))?/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = dmy[3] ? Number(dmy[3]) : today.getFullYear();
    return localDateKey(new Date(year, month - 1, day));
  }
  return null;
}

function parseAmount(text) {
  const lower = text.replace(/\s/g, " ").toLowerCase();
  let m = lower.match(/(\d[\d\s]*)\s*(?:тыс|тысяч)/);
  if (m) return Number(m[1].replace(/\s/g, "")) * 1000;
  m = lower.match(/(\d[\d\s]*)\s*(?:млн|миллион)/);
  if (m) return Number(m[1].replace(/\s/g, "")) * 1_000_000;
  m = lower.match(/(?:на\s+)?(\d[\d\s]{2,})/);
  if (m) return Number(m[1].replace(/\s/g, ""));
  return null;
}

function stripCommandPhrases(text) {
  return text
    .replace(/^(?:добавь|создай|новая|новый|нужно|надо|поставь|запиши|хочу)\s+/i, "")
    .replace(/^(?:задачу|задача|проект|цель|финансовую цель)\s+/i, "")
    .replace(/\s+(?:задачу|задача|пожалуйста)\.?$/i, "")
    .trim();
}

function extractTitle(text, entityType) {
  let t = stripCommandPhrases(text);
  t = t
    .replace(/(?:высок|низк|средн)(?:ий|ая|ое)?\s+приоритет/gi, "")
    .replace(/к\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресен)\w*/gi, "")
    .replace(/(?:до|к|на)\s+\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?/gi, "")
    .replace(/завтра|сегодня|послезавтра/gi, "")
    .replace(/ежедневн\w*|каждый день|регулярн\w*/gi, "")
    .replace(/(?:накопить|цель|сумма)\s+\d[\d\s]*(?:тыс|млн|руб\w*)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (entityType === "finance") {
    const named = text.match(/(?:цель|накопить|коплю)\s+(?:на\s+)?["«]?([^"».,\d]+)/i);
    if (named?.[1]?.trim()) return named[1].trim();
  }
  if (entityType === "project") {
    const named = text.match(/проект\s+["«]?([^"».,]+)/i);
    if (named?.[1]?.trim()) return named[1].trim();
  }
  if (t.length < 3) {
    const quoted = text.match(/["«]([^"»]+)["»]/);
    if (quoted) return quoted[1].trim();
  }
  return t || null;
}

function parseKind(text) {
  const lower = text.toLowerCase();
  if (/ежедневн|каждый день|регулярн|по будням|каждый рабоч/.test(lower)) return "recurring";
  return "simple";
}

function parseDayType(text) {
  const lower = text.toLowerCase();
  for (const dt of DAY_TYPES) {
    if (lower.includes(dt.toLowerCase())) return dt;
  }
  if (/выходн/.test(lower)) return "Выходной";
  if (/больнич/.test(lower)) return "Больничный";
  if (/отпуск/.test(lower)) return "Отпуск";
  if (/рабоч/.test(lower) || /по будням/.test(lower)) return "Рабочий";
  return null;
}

function mergeFields(entityType, draft, text) {
  const fields = { ...draft.fields };
  const lower = text.toLowerCase();

  const title = extractTitle(text, entityType);
  if (title && (!fields.title || fields.title.length < title.length)) fields.title = title;

  const pr = parsePriority(text);
  if (pr) fields.priority = pr;

  const cat = parseCategory(text);
  if (cat) fields.category = cat;

  const due = parseDueDate(text);
  if (due) fields.due = due;

  if (entityType === "task") {
    if (parseKind(text) === "recurring") fields.kind = "recurring";
    const dt = parseDayType(text);
    if (dt) fields.dayType = dt;
    if (/разов/.test(lower)) fields.kind = "simple";
  }

  if (entityType === "project") {
    const goal = text.match(/(?:результат|цель проекта|чтобы|чтоб)\s+(.+?)(?:\.|$)/i);
    if (goal?.[1]) fields.goal = goal[1].trim();
    const step = text.match(/(?:следующ\w* шаг|шаг|сначала)\s*[:\-]?\s*(.+?)(?:\.|$)/i);
    if (step?.[1]) fields.nextStep = step[1].trim();
    const dl = parseDueDate(text);
    if (dl) fields.deadline = dl;
  }

  if (entityType === "finance") {
    const amount = parseAmount(text);
    if (amount != null) {
      if (/уже|есть|накоплено/.test(lower)) fields.saved = amount;
      else fields.target = amount;
    }
    const note = text.match(/(?:зачем|потому что|чтобы)\s+(.+?)(?:\.|$)/i);
    if (note?.[1]) fields.note = note[1].trim();
  }

  return fields;
}

function defaultFields(entityType) {
  const today = localDateKey();
  if (entityType === "task") {
    return {
      title: null,
      category: "Личное",
      priority: "medium",
      kind: "simple",
      due: today,
      dayType: "Любой",
    };
  }
  if (entityType === "project") {
    return {
      title: null,
      goal: "",
      priority: "medium",
      deadline: "",
      nextStep: "",
    };
  }
  return {
    title: null,
    target: null,
    saved: 0,
    priority: "medium",
    note: "",
  };
}

function missingFields(entityType, fields) {
  const miss = [];
  if (entityType === "task") {
    if (!fields.title) miss.push("title");
    return miss;
  }
  if (entityType === "project") {
    if (!fields.title) miss.push("title");
    if (!fields.nextStep && !fields.goal) miss.push("nextStep");
    return miss;
  }
  if (!fields.title) miss.push("title");
  if (!fields.target) miss.push("target");
  return miss;
}

const FIELD_QUESTIONS = {
  title: "Как назвать? Скажите коротко, что нужно сделать или как называется цель.",
  nextStep: "Какой первый конкретный шаг по проекту?",
  target: "Какая целевая сумма (в рублях)?",
  due: "На какой день или дату поставить задачу?",
};

function questionFor(missing, entityType) {
  const key = missing[0];
  if (key === "title" && entityType === "finance") {
    return "Как назвать финансовую цель? Например: «подушка безопасности».";
  }
  return FIELD_QUESTIONS[key] || "Уточните, пожалуйста, детали.";
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPreview(entityType, fields) {
  const lines = [];
  if (entityType === "task") {
    lines.push(`<strong>Задача:</strong> ${esc(fields.title) || "—"}`);
    lines.push(`Категория: ${esc(fields.category) || "Личное"}`);
    lines.push(`Приоритет: ${esc(fields.priority) || "medium"}`);
    lines.push(`Тип: ${fields.kind === "recurring" ? "Регулярная" : "Разовая"}`);
    if (fields.kind === "recurring") lines.push(`Тип дня: ${esc(fields.dayType) || "Любой"}`);
    lines.push(`Срок: ${esc(fields.due) || "без даты"}`);
  } else if (entityType === "project") {
    lines.push(`<strong>Проект:</strong> ${esc(fields.title) || "—"}`);
    if (fields.goal) lines.push(`Результат: ${esc(fields.goal)}`);
    if (fields.nextStep) lines.push(`Следующий шаг: ${esc(fields.nextStep)}`);
    lines.push(`Приоритет: ${esc(fields.priority) || "medium"}`);
    if (fields.deadline) lines.push(`Дедлайн: ${esc(fields.deadline)}`);
  } else {
    lines.push(`<strong>Цель:</strong> ${esc(fields.title) || "—"}`);
    lines.push(`Сумма: ${fields.target ?? "—"} ₽`);
    lines.push(`Уже накоплено: ${fields.saved ?? 0} ₽`);
    if (fields.note) lines.push(`Заметка: ${esc(fields.note)}`);
  }
  return lines.join("<br>");
}

function userTexts(turns) {
  return turns.filter((t) => t.role === "user").map((t) => t.text).join(" ");
}

async function callOpenAI(payload) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const system = `Ты ассистент планнера FOCUS. Из диалога извлеки сущность для раздела "${payload.section}".
Верни ТОЛЬКО JSON: {"entityType":"task|project|finance","fields":{...},"status":"need_info|ready","message":"..."}
Поля task: title, category, priority (high|medium|low), kind (simple|recurring), due (YYYY-MM-DD), dayType.
Поля project: title, goal, priority, deadline (YYYY-MM-DD), nextStep.
Поля finance: title, target (number), saved (number), priority, note.
Если не хватает данных — status need_info и короткий message на русском.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ section: payload.section, turns: payload.turns, draft: payload.draft }) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function processVoiceAgent(payload) {
  const { section, turns = [], draft: incomingDraft } = payload;
  const sectionDefault = defaultEntityForSection(section);
  const combined = userTexts(turns);

  if (!combined.trim()) {
    return {
      status: "idle",
      message: "Нажмите микрофон и опишите, что нужно добавить.",
      draft: null,
      preview: "",
    };
  }

  let llm = await callOpenAI({ section, turns, draft: incomingDraft });
  let entityType = incomingDraft?.entityType || detectEntityType(combined, sectionDefault);
  let fields = { ...defaultFields(entityType), ...(incomingDraft?.fields || {}) };

  if (llm?.entityType && llm?.fields) {
    entityType = llm.entityType;
    fields = { ...defaultFields(entityType), ...llm.fields };
    if (llm.status === "ready" && llm.fields?.title) {
      return {
        status: "ready",
        message: llm.message || "Проверьте карточку и подтвердите создание.",
        draft: { entityType, fields },
        preview: buildPreview(entityType, fields),
      };
    }
    if (llm.status === "need_info") {
      return {
        status: "need_info",
        message: llm.message || questionFor(missingFields(entityType, fields), entityType),
        draft: { entityType, fields },
        preview: buildPreview(entityType, fields),
      };
    }
  }

  const userTurns = turns.filter((t) => t.role === "user");
  const turnsToMerge = incomingDraft?.fields && userTurns.length ? userTurns.slice(-1) : userTurns;
  for (const turn of turnsToMerge) {
    if (!incomingDraft?.entityType) {
      entityType = detectEntityType(userTexts(turns), sectionDefault);
    }
    fields = mergeFields(entityType, { fields: { ...defaultFields(entityType), ...fields } }, turn.text);
  }

  const missing = missingFields(entityType, fields);
  if (missing.length) {
    return {
      status: "need_info",
      message: questionFor(missing, entityType),
      draft: { entityType, fields },
      preview: buildPreview(entityType, fields),
    };
  }

  return {
    status: "ready",
    message: "Вот что получилось. Подтвердите или добавьте уточнение голосом.",
    draft: { entityType, fields },
    preview: buildPreview(entityType, fields),
  };
}

module.exports = { processVoiceAgent, buildPreview };
