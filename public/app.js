const STORAGE_KEY = "konsultant_state_v2";
const MODEL_LEVELS = ["basic", "standard", "advanced"];

const state = {
  analysisId: null,
  companyContext: "",
  ideas: [],
  tabs: [],
  activeTabId: null,
  hasServerKey: false,
  modelLevel: "standard",
  lastGenerationSource: "fallback",
  lastGenerationLevel: "standard",
  currentQuestionByTab: {},
  selectedOptionsByTab: {}
};

const progressSteps = [
  "Изучаю структуру сайта...",
  "Читаю страницы: Главная, Услуги...",
  "Ищу упоминания в сети...",
  "Проверяю социальные сети...",
  "Синтезирую контекст..."
];

const elements = {
  urlInput: document.getElementById("urlInput"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  progressBox: document.getElementById("progressBox"),
  analyzeError: document.getElementById("analyzeError"),
  ideasSection: document.getElementById("ideasSection"),
  ideasList: document.getElementById("ideasList"),
  regenerateBtn: document.getElementById("regenerateBtn"),
  chatSection: document.getElementById("chatSection"),
  chatTabs: document.getElementById("chatTabs"),
  projectListFixed: document.getElementById("projectListFixed"),
  messages: document.getElementById("messages"),
  questionBlock: document.getElementById("questionBlock"),
  freeInput: document.getElementById("freeInput"),
  sendFreeBtn: document.getElementById("sendFreeBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  modelLevelSelect: document.getElementById("modelLevelSelect"),
  modeStatus: document.getElementById("modeStatus"),
  generationMeta: document.getElementById("generationMeta")
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement("div");
  toastContainer.className = "toast-container";
  document.body.appendChild(toastContainer);
  return toastContainer;
}

function showToast(text, type = "info") {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 240);
  }, 2600);
}

function serializeState() {
  return JSON.stringify({
    analysisId: state.analysisId,
    companyContext: state.companyContext,
    ideas: state.ideas,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    modelLevel: state.modelLevel,
    lastGenerationSource: state.lastGenerationSource,
    lastGenerationLevel: state.lastGenerationLevel,
    currentQuestionByTab: state.currentQuestionByTab,
    selectedOptionsByTab: state.selectedOptionsByTab
  });
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, serializeState());
}

function hydrateState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    state.analysisId = parsed.analysisId || null;
    state.companyContext = parsed.companyContext || "";
    state.ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    state.tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    state.activeTabId = parsed.activeTabId || state.tabs[0]?.chatId || null;
    state.modelLevel = MODEL_LEVELS.includes(parsed.modelLevel) ? parsed.modelLevel : state.modelLevel;
    state.lastGenerationSource = parsed.lastGenerationSource || state.lastGenerationSource;
    state.lastGenerationLevel = MODEL_LEVELS.includes(parsed.lastGenerationLevel) ? parsed.lastGenerationLevel : state.lastGenerationLevel;
    state.currentQuestionByTab = parsed.currentQuestionByTab && typeof parsed.currentQuestionByTab === "object"
      ? parsed.currentQuestionByTab
      : {};
    state.selectedOptionsByTab = parsed.selectedOptionsByTab && typeof parsed.selectedOptionsByTab === "object"
      ? parsed.selectedOptionsByTab
      : {};
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function mapErrorMessage(error) {
  const text = String(error?.message || "");
  if (text.includes("Failed to fetch")) return "Сервер недоступен. Проверьте, что приложение запущено на localhost:3001.";
  if (text.includes("429")) return "Слишком много запросов. Подождите минуту и повторите.";
  return text || "Произошла ошибка";
}

function showError(text) {
  const friendly = mapErrorMessage({ message: text });
  elements.analyzeError.textContent = friendly;
  elements.analyzeError.classList.remove("hidden");
  showToast(friendly, "error");
}

function clearError() {
  elements.analyzeError.classList.add("hidden");
  elements.analyzeError.textContent = "";
}

function normalizeInputUrl(raw) {
  if (!raw?.trim()) return "";
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
}

function getLevelLabel(level) {
  if (level === "basic") return "Базовый";
  if (level === "advanced") return "Продвинутый";
  return "Стандартный";
}

function updateModeStatus() {
  if (!elements.modeStatus) return;
  const levelLabel = getLevelLabel(state.modelLevel);

  if (state.hasServerKey) {
    elements.modeStatus.textContent = `LLM: ${levelLabel}`;
    elements.modeStatus.classList.add("llm");
    elements.modeStatus.classList.remove("fallback");
  } else {
    elements.modeStatus.textContent = `Fallback: ${levelLabel}`;
    elements.modeStatus.classList.add("fallback");
    elements.modeStatus.classList.remove("llm");
  }
}

function updateGenerationMeta() {
  if (!elements.generationMeta) return;
  const levelLabel = getLevelLabel(state.lastGenerationLevel);
  const sourceLabel = state.lastGenerationSource === "llm" ? "LLM" : "Fallback";

  elements.generationMeta.textContent = `Режим генерации: ${sourceLabel} · ${levelLabel}`;
  elements.generationMeta.classList.toggle("llm", sourceLabel === "LLM");
  elements.generationMeta.classList.toggle("fallback", sourceLabel !== "LLM");
}

async function apiGet(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

function renderIdeas() {
  elements.ideasList.innerHTML = "";

  state.ideas.forEach((idea) => {
    const card = document.createElement("article");
    card.className = "idea-card";
    card.innerHTML = `
      <div class="idea-title">${idea.title}</div>
      <div class="idea-description">${idea.description}</div>
      <button class="primary" data-idea-id="${idea.id}">Обсудить</button>
    `;

    card.querySelector("button").addEventListener("click", () => startDiscussion(idea.id));
    elements.ideasList.appendChild(card);
  });

  elements.projectListFixed.innerHTML = state.ideas
    .map((idea) => `<div class="projects-item">${idea.title}</div>`)
    .join("");
}

function renderTabs() {
  elements.chatTabs.innerHTML = "";

  state.tabs.forEach((tab) => {
    const tabEl = document.createElement("button");
    tabEl.className = `tab ${tab.chatId === state.activeTabId ? "active" : ""}`;
    tabEl.innerHTML = `<span>${tab.ideaTitle}</span><span data-close="${tab.chatId}">✕</span>`;

    tabEl.addEventListener("click", (event) => {
      if (event.target.dataset.close) {
        closeTab(event.target.dataset.close);
        return;
      }

      state.activeTabId = tab.chatId;
      renderTabs();
      renderMessages();
      renderQuestion();
      persistState();
    });

    elements.chatTabs.appendChild(tabEl);
  });
}


function updateChatMeta() {
  if (!elements.chatMeta) return;
  const active = getActiveTab();
  if (!active) {
    elements.chatMeta.textContent = "Источник вопросов: —";
    elements.chatMeta.classList.remove("llm", "fallback");
    return;
  }

  const source = active.questionSource === "llm" ? "LLM" : "Fallback";
  const levelLabel = getLevelLabel(state.modelLevel);
  elements.chatMeta.textContent = `Источник вопросов: ${source} · ${levelLabel}`;
  elements.chatMeta.classList.toggle("llm", source === "LLM");
  elements.chatMeta.classList.toggle("fallback", source !== "LLM");
}
function renderMessages() {
  const active = state.tabs.find((item) => item.chatId === state.activeTabId);
  updateChatMeta();
  if (!active) {
    elements.messages.innerHTML = "<div class='message bot'>Выберите проект для обсуждения.</div>";
    return;
  }

  elements.messages.innerHTML = active.messages
    .map((msg) => `<div class="message ${msg.role}">${msg.text}</div>`)
    .join("");
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function closeTab(chatId) {
  state.tabs = state.tabs.filter((tab) => tab.chatId !== chatId);
  delete state.currentQuestionByTab[chatId];
  delete state.selectedOptionsByTab[chatId];

  if (state.activeTabId === chatId) {
    state.activeTabId = state.tabs[0]?.chatId || null;
  }

  renderTabs();
  renderMessages();
  renderQuestion();
  persistState();
}

function getActiveTab() {
  return state.tabs.find((item) => item.chatId === state.activeTabId) || null;
}

function setFreeInputEnabled(enabled) {
  elements.freeInput.disabled = !enabled;
  elements.sendFreeBtn.disabled = !enabled;
  elements.sendFreeBtn.style.opacity = enabled ? "1" : "0.5";
  elements.sendFreeBtn.style.pointerEvents = enabled ? "auto" : "none";
}

function renderQuestion() {
  const active = getActiveTab();
  elements.questionBlock.innerHTML = "";

  if (!active) {
    setFreeInputEnabled(false);
    return;
  }

  const question = state.currentQuestionByTab[active.chatId];
  if (!question) {
    setFreeInputEnabled(false);
    delete state.selectedOptionsByTab[active.chatId];
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `<div><strong>${question.text}</strong></div>`;

  if (question.type === "free") {
    setFreeInputEnabled(true);
  } else {
    const optionList = document.createElement("div");
    optionList.className = "option-list";
    const selected = new Set(Array.isArray(state.selectedOptionsByTab[active.chatId])
      ? state.selectedOptionsByTab[active.chatId]
      : []);

    (question.options || []).forEach((opt) => {
      const button = document.createElement("button");
      button.className = "option-btn";
      button.textContent = opt.label;

      button.addEventListener("click", async () => {
        if (question.type === "single") {
          delete state.selectedOptionsByTab[active.chatId];
          await submitAnswer({ selectedOptions: [opt.id], message: "" });
          return;
        }

        if (selected.has(opt.id)) {
          selected.delete(opt.id);
          button.classList.remove("active");
        } else {
          selected.add(opt.id);
          button.classList.add("active");
        }

        state.selectedOptionsByTab[active.chatId] = Array.from(selected);
        persistState();
      });

      if (selected.has(opt.id)) {
        button.classList.add("active");
      }

      optionList.appendChild(button);
    });

    wrapper.appendChild(optionList);

    if (question.type === "multi") {
      const sendMulti = document.createElement("button");
      sendMulti.className = "primary";
      sendMulti.textContent = "Отправить выбор";

      sendMulti.addEventListener("click", async (event) => {
        event.preventDefault();
        const selectedOptions = Array.from(selected);
        if (!selectedOptions.length) {
          showToast("Выберите хотя бы один вариант", "warn");
          return;
        }

        sendMulti.disabled = true;
        sendMulti.textContent = "Отправляю...";

        try {
          await submitAnswer({ selectedOptions, message: "" });
        } finally {
          sendMulti.disabled = false;
          sendMulti.textContent = "Отправить выбор";
        }
      });

      wrapper.appendChild(sendMulti);
    }

    if (question.type === "multi") {
      elements.freeInput.disabled = true;
      elements.sendFreeBtn.disabled = false;
      elements.sendFreeBtn.style.opacity = "1";
      elements.sendFreeBtn.style.pointerEvents = "auto";
    } else {
      setFreeInputEnabled(false);
    }
  }

  elements.questionBlock.appendChild(wrapper);
}

async function recoverChatSession(activeTab) {
  if (!activeTab?.ideaId || !state.analysisId) {
    showToast("Сессия чата устарела. Откройте проект заново.", "warn");
    return;
  }

  showToast("Сессия чата устарела, переоткрываю...", "warn");
  state.tabs = state.tabs.filter((tab) => tab.chatId !== activeTab.chatId);
  delete state.currentQuestionByTab[activeTab.chatId];
  delete state.selectedOptionsByTab[activeTab.chatId];
  state.activeTabId = null;

  renderTabs();
  renderMessages();
  renderQuestion();
  persistState();

  await startDiscussion(activeTab.ideaId);
}
async function submitAnswer({ selectedOptions, message }) {
  const active = getActiveTab();
  if (!active) return;

  const currentQuestion = state.currentQuestionByTab[active.chatId];
  if (!currentQuestion) return;

  const userText = currentQuestion.type === "free"
    ? (message || "")
    : (currentQuestion.type === "single"
      ? currentQuestion.options.find((opt) => opt.id === selectedOptions[0])?.label
      : currentQuestion.options
        .filter((opt) => selectedOptions.includes(opt.id))
        .map((opt) => opt.label)
        .join(", "));

  active.messages.push({ role: "user", text: userText || "(без ответа)" });
  renderMessages();

  try {
    const result = await apiPost("/api/chat/message", {
      chatId: active.chatId,
      message,
      selectedOptions
    });

    active.messages.push({ role: "bot", text: result.assistantMessage });
    state.currentQuestionByTab[active.chatId] = result.nextQuestion;
    delete state.selectedOptionsByTab[active.chatId];

    if (result.isFinal) {
      state.currentQuestionByTab[active.chatId] = null;
      setFreeInputEnabled(false);
      showToast(`Консультация сформирована (${result.generatedBy || "fallback"})`, "success");
    }
  } catch (error) {
    const friendly = mapErrorMessage(error);
    active.messages.push({ role: "bot", text: `Ошибка: ${friendly}` });
    showToast(friendly, "error");

    if (friendly.includes("chatId не найден")) {
      await recoverChatSession(active);
      return;
    }
  }

  elements.freeInput.value = "";
  renderMessages();
  renderQuestion();
  persistState();
}

async function animateProgress() {
  elements.progressBox.classList.remove("hidden");
  for (const step of progressSteps) {
    elements.progressBox.textContent = step;
    await sleep(850);
  }
}

async function runAnalyze() {
  clearError();

  const normalized = normalizeInputUrl(elements.urlInput.value);
  if (!normalized) {
    showError("Введите корректный URL сайта.");
    return;
  }

  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = "Анализирую...";
  await animateProgress();

  try {
    const data = await apiPost("/api/analyze", { url: normalized, modelLevel: state.modelLevel });
    state.analysisId = data.analysisId;
    state.companyContext = data.companyContext;

    const ideasResponse = await apiPost("/api/ideas/generate", { analysisId: state.analysisId });
    state.ideas = ideasResponse.ideas;
    state.lastGenerationSource = ideasResponse.generatedBy || "fallback";
    state.lastGenerationLevel = ideasResponse.modelLevel || state.modelLevel;
    state.tabs = [];
    state.activeTabId = null;
    state.currentQuestionByTab = {};
    state.selectedOptionsByTab = {};

    elements.ideasSection.classList.remove("hidden");
    elements.chatSection.classList.remove("hidden");

    renderIdeas();
    updateGenerationMeta();
    renderTabs();
    renderMessages();
    renderQuestion();
    persistState();

    showToast(`Анализ завершён, идеи: ${ideasResponse.generatedBy || "fallback"}`, "success");
    if (Array.isArray(data.warnings) && data.warnings.length) {
      showToast(data.warnings.join(" "), "warn");
    }
  } catch (error) {
    showError(mapErrorMessage(error));
  } finally {
    elements.analyzeBtn.disabled = false;
    elements.analyzeBtn.textContent = "Проанализировать";
  }
}

async function regenerateIdeas() {
  if (!state.analysisId) {
    showToast("Сначала выполните анализ сайта", "warn");
    return;
  }

  elements.regenerateBtn.disabled = true;
  elements.regenerateBtn.textContent = "Генерирую...";

  const excludeIdeaIds = state.ideas.map((idea) => idea.id);
  try {
    const result = await apiPost("/api/ideas/regenerate", { analysisId: state.analysisId, excludeIdeaIds });
    state.ideas = result.ideas;
    state.lastGenerationSource = result.generatedBy || "fallback";
    state.lastGenerationLevel = result.modelLevel || state.modelLevel;
    renderIdeas();
    updateGenerationMeta();
    persistState();
    showToast(`Новый набор идей готов (${result.generatedBy || "fallback"})`, "success");
  } catch (error) {
    showError(mapErrorMessage(error));
  } finally {
    elements.regenerateBtn.disabled = false;
    elements.regenerateBtn.textContent = "Перегенерировать";
  }
}

async function startDiscussion(ideaId) {
  const idea = state.ideas.find((item) => item.id === ideaId);
  if (!idea) return;

  const existing = state.tabs.find((tab) => tab.ideaId === ideaId);
  if (existing) {
    state.activeTabId = existing.chatId;
    renderTabs();
    renderMessages();
    renderQuestion();
    persistState();
    return;
  }

  try {
    const response = await apiPost("/api/chat/start", { analysisId: state.analysisId, ideaId });
    const tab = {
      chatId: response.chatId,
      ideaId,
      ideaTitle: idea.title,
      messages: [{ role: "bot", text: response.greeting }],
      questionSource: response.questionSource || "fallback"
    };

    state.tabs.push(tab);
    state.activeTabId = tab.chatId;
    state.currentQuestionByTab[tab.chatId] = response.questions?.[0] || null;
    state.selectedOptionsByTab[tab.chatId] = [];
    showToast(`Опрос: ${response.questionSource || "fallback"} · ${response.modelLevel || state.modelLevel}`, "info");

    renderTabs();
    renderMessages();
    renderQuestion();
    persistState();
  } catch (error) {
    showError(mapErrorMessage(error));
  }
}

async function loadSettingsState() {
  try {
    const data = await apiGet("/api/settings");
    state.hasServerKey = Boolean(data.hasServerKey);
    state.modelLevel = MODEL_LEVELS.includes(data.defaultModelLevel) ? data.defaultModelLevel : state.modelLevel;

    if (elements.modelLevelSelect) {
      elements.modelLevelSelect.value = state.modelLevel;
    }

    updateModeStatus();
    updateGenerationMeta();
    if (state.hasServerKey) {
      showToast("Backend-ключ активен", "info");
    } else {
      showToast("Ключ не задан: используется fallback-режим", "warn");
    }
  } catch {
    showToast("Не удалось загрузить настройки backend", "warn");
  }
}

function bindSettings() {
  elements.apiKeyInput.value = "";

  elements.settingsBtn.addEventListener("click", () => {
    elements.settingsModal.classList.remove("hidden");
  });

  elements.closeSettingsBtn.addEventListener("click", () => {
    elements.settingsModal.classList.add("hidden");
    elements.apiKeyInput.value = "";
  });

  elements.saveSettingsBtn.addEventListener("click", async () => {
    const apiKey = elements.apiKeyInput.value.trim();

    try {
      const result = await apiPost("/api/settings", { apiKey, modelLevel: state.modelLevel });
      state.hasServerKey = Boolean(result.hasServerKey);
      elements.apiKeyInput.value = "";
      elements.settingsModal.classList.add("hidden");
      updateModeStatus();
      showToast(state.hasServerKey ? "Ключ сохранён на backend" : "Ключ очищен", "success");
    } catch (error) {
      showToast(mapErrorMessage(error), "error");
    }
  });

  elements.modelLevelSelect.addEventListener("change", async (event) => {
    state.modelLevel = MODEL_LEVELS.includes(event.target.value) ? event.target.value : "standard";
    state.lastGenerationLevel = state.modelLevel;
    persistState();
    updateModeStatus();
    updateGenerationMeta();

    try {
      await apiPost("/api/settings", { modelLevel: state.modelLevel });
      showToast(`Уровень модели: ${state.modelLevel}`, "info");
    } catch (error) {
      showToast(mapErrorMessage(error), "warn");
    }
  });
}

function restoreUiFromState() {
  if (elements.modelLevelSelect) {
    elements.modelLevelSelect.value = state.modelLevel;
  }

  updateGenerationMeta();

  if (!state.ideas.length) return;

  elements.ideasSection.classList.remove("hidden");
  elements.chatSection.classList.remove("hidden");

  renderIdeas();
  renderTabs();
  renderMessages();
  renderQuestion();
}

elements.analyzeBtn.addEventListener("click", runAnalyze);
elements.regenerateBtn.addEventListener("click", regenerateIdeas);
elements.sendFreeBtn.addEventListener("click", async () => {
  const active = getActiveTab();
  const question = active ? state.currentQuestionByTab[active.chatId] : null;
  if (!question) return;

  if (question.type === "multi") {
    const selectedOptions = Array.isArray(state.selectedOptionsByTab[active.chatId])
      ? state.selectedOptionsByTab[active.chatId]
      : [];
    if (!selectedOptions.length) {
      showToast("Выберите хотя бы один вариант", "warn");
      return;
    }
    await submitAnswer({ selectedOptions, message: "" });
    return;
  }

  if (question.type !== "free") return;

  await submitAnswer({ selectedOptions: [], message: elements.freeInput.value.trim() });
});

hydrateState();
bindSettings();
restoreUiFromState();
loadSettingsState();

