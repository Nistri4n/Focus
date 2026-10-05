(() => {
  const TASK_CATEGORIES = ["Работа", "Маркетинг", "Логистика", "Контент", "Личное"];
  const PRIORITY_LABELS = { high: "Высокий", medium: "Средний", low: "Низкий" };

  const dialog = () => document.getElementById("voice-agent-dialog");
  const messagesEl = () => document.getElementById("voice-agent-messages");
  const previewEl = () => document.getElementById("voice-agent-preview");
  const previewBox = () => document.getElementById("voice-agent-preview-box");
  const inputEl = () => document.getElementById("voice-agent-input");
  const micBtn = () => document.getElementById("voice-agent-mic");
  const statusEl = () => document.getElementById("voice-agent-status");

  let section = "today";
  let turns = [];
  let draft = null;
  let draftStatus = "idle";
  let listening = false;
  let recognition = null;

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderMessages() {
    const el = messagesEl();
    if (!el) return;
    el.innerHTML = turns
      .map(
        (t) =>
          `<div class="message ${t.role === "user" ? "user" : ""}">${t.role === "user" ? escapeHtml(t.text) : t.text}</div>`,
      )
      .join("");
    el.scrollTop = el.scrollHeight;
  }

  function isDraftReady(d = draft) {
    if (!d?.entityType || !d.fields) return false;
    const f = d.fields;
    if (d.entityType === "task") return Boolean(f.title?.trim());
    if (d.entityType === "project") {
      return Boolean(f.title?.trim()) && Boolean(f.nextStep?.trim() || f.goal?.trim());
    }
    if (d.entityType === "finance") {
      return Boolean(f.title?.trim()) && f.target != null && String(f.target).trim() !== "";
    }
    return false;
  }

  function renderTaskForm(f) {
    return `
      <div class="voice-preview-form">
        <label class="field full"><span>Название</span><input type="text" name="title" value="${escapeHtml(f.title || "")}" /></label>
        <label class="field"><span>Категория</span>
          <select name="category">
            ${TASK_CATEGORIES.map((c) => `<option value="${c}" ${f.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </label>
        <label class="field"><span>Приоритет</span>
          <select name="priority">
            ${["high", "medium", "low"].map((p) => `<option value="${p}" ${f.priority === p ? "selected" : ""}>${PRIORITY_LABELS[p]}</option>`).join("")}
          </select>
        </label>
        <label class="field"><span>Срок</span><input type="date" name="due" value="${escapeHtml(f.due || "")}" /></label>
        <label class="field"><span>Тип</span>
          <select name="kind">
            <option value="simple" ${f.kind !== "recurring" ? "selected" : ""}>Разовая</option>
            <option value="recurring" ${f.kind === "recurring" ? "selected" : ""}>Регулярная</option>
          </select>
        </label>
      </div>`;
  }

  function renderProjectForm(f) {
    return `
      <div class="voice-preview-form">
        <label class="field full"><span>Название проекта</span><input type="text" name="title" value="${escapeHtml(f.title || "")}" /></label>
        <label class="field full"><span>Следующий шаг</span><input type="text" name="nextStep" value="${escapeHtml(f.nextStep || "")}" /></label>
        <label class="field full"><span>Результат</span><textarea name="goal">${escapeHtml(f.goal || "")}</textarea></label>
        <label class="field"><span>Приоритет</span>
          <select name="priority">
            ${["high", "medium", "low"].map((p) => `<option value="${p}" ${f.priority === p ? "selected" : ""}>${PRIORITY_LABELS[p]}</option>`).join("")}
          </select>
        </label>
        <label class="field"><span>Дедлайн</span><input type="date" name="deadline" value="${escapeHtml(f.deadline || "")}" /></label>
      </div>`;
  }

  function renderFinanceForm(f) {
    return `
      <div class="voice-preview-form">
        <label class="field full"><span>Название цели</span><input type="text" name="title" value="${escapeHtml(f.title || "")}" /></label>
        <label class="field"><span>Целевая сумма</span><input type="number" name="target" value="${f.target ?? ""}" min="0" /></label>
        <label class="field"><span>Уже накоплено</span><input type="number" name="saved" value="${f.saved ?? 0}" min="0" /></label>
        <label class="field"><span>Приоритет</span>
          <select name="priority">
            ${["high", "medium", "low"].map((p) => `<option value="${p}" ${f.priority === p ? "selected" : ""}>${PRIORITY_LABELS[p]}</option>`).join("")}
          </select>
        </label>
      </div>`;
  }

  function renderPreviewForm(d) {
    const f = d.fields || {};
    if (d.entityType === "project") return renderProjectForm(f);
    if (d.entityType === "finance") return renderFinanceForm(f);
    return renderTaskForm(f);
  }

  function syncDraftFromForm() {
    const root = previewEl();
    if (!root || !draft?.entityType) return draft;
    const get = (name) => root.querySelector(`[name="${name}"]`)?.value;
    const fields = { ...draft.fields };
    if (draft.entityType === "task") {
      fields.title = get("title")?.trim() || "";
      fields.category = get("category") || "Личное";
      fields.priority = get("priority") || "medium";
      fields.due = get("due") || "";
      fields.kind = get("kind") || "simple";
    } else if (draft.entityType === "project") {
      fields.title = get("title")?.trim() || "";
      fields.nextStep = get("nextStep")?.trim() || "";
      fields.goal = get("goal")?.trim() || "";
      fields.priority = get("priority") || "medium";
      fields.deadline = get("deadline") || "";
    } else if (draft.entityType === "finance") {
      fields.title = get("title")?.trim() || "";
      fields.target = get("target") === "" ? null : Number(get("target"));
      fields.saved = Number(get("saved")) || 0;
      fields.priority = get("priority") || "medium";
    }
    draft = { ...draft, fields };
    return draft;
  }

  function updateConfirmButton() {
    syncDraftFromForm();
    const confirmBtn = document.getElementById("voice-agent-confirm");
    if (confirmBtn) confirmBtn.disabled = !isDraftReady();
  }

  function setPreview(data) {
    const box = previewBox();
    const prev = previewEl();
    if (!data?.draft) {
      box?.setAttribute("hidden", "");
      updateConfirmButton();
      return;
    }
    draft = data.draft;
    draftStatus = data.status || "idle";
    box?.removeAttribute("hidden");
    if (prev) {
      prev.innerHTML = renderPreviewForm(draft);
      prev.querySelectorAll("input, select, textarea").forEach((el) => {
        el.addEventListener("input", updateConfirmButton);
        el.addEventListener("change", updateConfirmButton);
      });
    }
    updateConfirmButton();
  }

  function dismissPreview() {
    syncDraftFromForm();
    draft = null;
    draftStatus = "idle";
    previewBox()?.setAttribute("hidden", "");
    turns.push({
      role: "assistant",
      text: "Черновик сброшен. Опишите задачу заново или уточните детали голосом — я останусь в этом диалоге.",
    });
    renderMessages();
    setStatus("Можно снова нажать 🎤 и добавить информацию");
  }

  function setStatus(text, tone = "") {
    const el = statusEl();
    if (!el) return;
    el.textContent = text;
    el.className = `voice-agent-status ${tone}`;
  }

  function getSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = "ru-RU";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    return r;
  }

  function stopListening() {
    listening = false;
    micBtn()?.classList.remove("listening");
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    setStatus(draft ? "Поправьте поля или отправьте уточнение голосом" : "Микрофон выключен");
  }

  function startListening() {
    recognition = getSpeechRecognition();
    if (!recognition) {
      setStatus("Браузер не поддерживает голос. Введите текст вручную.", "warn");
      return;
    }
    listening = true;
    micBtn()?.classList.add("listening");
    setStatus("Слушаю… дополните описание", "active");
    inputEl().value = "";

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += part;
        else interim += part;
      }
      inputEl().value = (final || interim).trim();
    };

    recognition.onerror = () => {
      stopListening();
      setStatus("Не удалось распознать речь. Попробуйте ещё раз или введите текст.", "warn");
    };

    recognition.onend = () => {
      if (!listening) return;
      stopListening();
      const text = inputEl().value.trim();
      if (text) submitText(text);
    };

    recognition.start();
  }

  async function callAgent() {
    syncDraftFromForm();
    const res = await fetch("/api/voice-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, turns, draft }),
    });
    if (!res.ok) throw new Error("agent unavailable");
    return res.json();
  }

  async function submitText(text) {
    if (!text.trim()) return;
    syncDraftFromForm();
    turns.push({ role: "user", text: text.trim() });
    renderMessages();
    inputEl().value = "";
    setStatus("Думаю…");

    try {
      const data = await callAgent();
      if (data.message) {
        turns.push({ role: "assistant", text: data.message });
        renderMessages();
      }
      setPreview(data);
      if (data.status === "ready" || isDraftReady()) {
        setStatus("Проверьте поля, при необходимости измените и нажмите «Создать»");
      } else if (data.status === "need_info") {
        setStatus("Нужно уточнение — ответьте голосом или текстом", "warn");
      }
    } catch {
      turns.push({
        role: "assistant",
        text: "Не удалось связаться с ассистентом. Проверьте, что запущен <strong>node server.js</strong>.",
      });
      renderMessages();
      setStatus("Ошибка связи", "warn");
    }
  }

  function openVoiceAgent(sectionId) {
    section = sectionId || "today";
    turns = [{ role: "assistant", text: getIntro(section) }];
    draft = null;
    draftStatus = "idle";
    renderMessages();
    previewBox()?.setAttribute("hidden", "");
    setStatus("Нажмите микрофон и опишите задачу");
    dialog()?.showModal();
  }

  function getIntro(sec) {
    const labels = {
      today: "задачу на сегодня",
      tasks: "задачу",
      habits: "задачу (привычки отмечаются отдельно)",
      projects: "проект",
      finance: "финансовую цель",
      more: "запись",
      settings: "задачу",
    };
    return `Опишите голосом ${labels[sec] || "запись"}. Перед созданием вы сможете изменить категорию, приоритет и срок — или дополнить описание через 🎤.`;
  }

  function closeDialog() {
    stopListening();
    dialog()?.close();
  }

  function confirmDraft() {
    syncDraftFromForm();
    if (!isDraftReady() || !window.FOCUS_applyVoiceDraft) {
      setStatus("Заполните обязательные поля в черновике", "warn");
      return;
    }
    window.FOCUS_applyVoiceDraft(draft);
    closeDialog();
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "open-voice-agent") {
      openVoiceAgent(btn.dataset.section || "today");
    }
  });

  document.getElementById("voice-agent-close")?.addEventListener("click", closeDialog);
  document.getElementById("voice-agent-cancel")?.addEventListener("click", dismissPreview);
  document.getElementById("voice-agent-confirm")?.addEventListener("click", confirmDraft);

  micBtn()?.addEventListener("click", () => {
    if (listening) stopListening();
    else startListening();
  });

  document.getElementById("voice-agent-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitText(inputEl().value);
  });

  window.FOCUS_voiceAssistant = { openVoiceAgent, submitText };
})();
