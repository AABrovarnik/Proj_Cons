const state = {
  analysisId: null,
  companyContext: "",
  ideas: [],
  tabs: [],
  activeTabId: null,
  apiKey: localStorage.getItem("openai_api_key") || "",
  currentQuestionByTab: {}
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
  closeSettingsBtn: document.getElementById("closeSettingsBtn")
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function showError(text) {
  elements.analyzeError.textContent = text;
  elements.analyzeError.classList.remove("hidden");
}

function clearError() {
  elements.analyzeError.classList.add("hidden");
  elements.analyzeError.textContent = "";
}

function normalizeInputUrl(raw) {
  if (!raw?.trim()) return "";
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(state.apiKey ? { "x-openai-key": state.apiKey } : {})
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка API");
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
    });

    elements.chatTabs.appendChild(tabEl);
  });
}

function renderMessages() {
  const active = state.tabs.find((item) => item.chatId === state.activeTabId);
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
  if (state.activeTabId === chatId) {
    state.activeTabId = state.tabs[0]?.chatId || null;
  }
  renderTabs();
  renderMessages();
  renderQuestion();
}

function getActiveTab() {
  return state.tabs.find((item) => item.chatId === state.activeTabId) || null;
}

function renderQuestion() {
  const active = getActiveTab();
  if (!active) {
    elements.questionBlock.innerHTML = "";
    return;
  }

  const question = state.currentQuestionByTab[active.chatId];
  if (!question) {
    elements.questionBlock.innerHTML = "";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `<div><strong>${question.text}</strong></div>`;

  if (question.type === "free") {
    elements.freeInput.disabled = false;
    elements.sendFreeBtn.disabled = false;
    elements.sendFreeBtn.style.opacity = "1";
    elements.sendFreeBtn.style.pointerEvents = "auto";
  } else {
    const optionList = document.createElement("div");
    optionList.className = "option-list";
    const selected = new Set();

    question.options.forEach((opt) => {
      const button = document.createElement("button");
      button.className = "option-btn";
      button.textContent = opt.label;
      button.addEventListener("click", async () => {
        if (question.type === "single") {
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
        updateMultiSendBtn(Array.from(selected));
      });
      optionList.appendChild(button);
    });

    wrapper.appendChild(optionList);

    if (question.type === "multi") {
      const sendMulti = document.createElement("button");
      sendMulti.className = "primary";
      sendMulti.textContent = "Отправить";
      sendMulti.style.opacity = "0.5";
      sendMulti.style.pointerEvents = "none";
      sendMulti.addEventListener("click", async () => {
        const selectedOptions = Array.from(selected);
        if (!selectedOptions.length) return;
        await submitAnswer({ selectedOptions, message: "" });
      });

      function updateMultiSendBtn(selectedOptions) {
        if (selectedOptions.length) {
          sendMulti.style.opacity = "1";
          sendMulti.style.pointerEvents = "auto";
        } else {
          sendMulti.style.opacity = "0.5";
          sendMulti.style.pointerEvents = "none";
        }
      }

      wrapper.appendChild(sendMulti);
      elements.freeInput.disabled = true;
      elements.sendFreeBtn.disabled = true;
    }
  }

  elements.questionBlock.innerHTML = "";
  elements.questionBlock.appendChild(wrapper);
}

async function submitAnswer({ selectedOptions, message }) {
  const active = getActiveTab();
  if (!active) return;

  const currentQuestion = state.currentQuestionByTab[active.chatId];
  if (!currentQuestion) return;

  const userText = currentQuestion.type === "free"
    ? message
    : (currentQuestion.type === "single"
      ? currentQuestion.options.find((opt) => opt.id === selectedOptions[0])?.label
      : currentQuestion.options.filter((opt) => selectedOptions.includes(opt.id)).map((opt) => opt.label).join(", "));

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

    if (result.isFinal) {
      state.currentQuestionByTab[active.chatId] = null;
      elements.freeInput.disabled = true;
      elements.sendFreeBtn.disabled = true;
    }
  } catch (error) {
    active.messages.push({ role: "bot", text: `Ошибка: ${error.message}` });
  }

  elements.freeInput.value = "";
  renderMessages();
  renderQuestion();
}

async function animateProgress() {
  elements.progressBox.classList.remove("hidden");
  for (const step of progressSteps) {
    elements.progressBox.textContent = step;
    await sleep(450);
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
  await animateProgress();

  try {
    const data = await apiPost("/api/analyze", { url: normalized });
    state.analysisId = data.analysisId;
    state.companyContext = data.companyContext;

    const ideasResponse = await apiPost("/api/ideas/generate", { analysisId: state.analysisId });
    state.ideas = ideasResponse.ideas;

    elements.ideasSection.classList.remove("hidden");
    elements.chatSection.classList.remove("hidden");

    renderIdeas();
    renderTabs();
    renderMessages();
    renderQuestion();

    if (Array.isArray(data.warnings) && data.warnings.length) {
      showError(data.warnings.join(" "));
    }
  } catch (error) {
    showError(error.message);
  } finally {
    elements.analyzeBtn.disabled = false;
  }
}

async function regenerateIdeas() {
  if (!state.analysisId) return;
  const excludeIdeaIds = state.ideas.map((idea) => idea.id);
  try {
    const result = await apiPost("/api/ideas/regenerate", { analysisId: state.analysisId, excludeIdeaIds });
    state.ideas = result.ideas;
    renderIdeas();
  } catch (error) {
    showError(error.message);
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
    return;
  }

  try {
    const response = await apiPost("/api/chat/start", { analysisId: state.analysisId, ideaId });
    const tab = {
      chatId: response.chatId,
      ideaId,
      ideaTitle: idea.title,
      messages: [{ role: "bot", text: response.greeting }]
    };

    state.tabs.push(tab);
    state.activeTabId = tab.chatId;
    state.currentQuestionByTab[tab.chatId] = response.questions?.[0] || null;

    renderTabs();
    renderMessages();
    renderQuestion();
  } catch (error) {
    showError(error.message);
  }
}

function bindSettings() {
  elements.apiKeyInput.value = state.apiKey;

  elements.settingsBtn.addEventListener("click", () => {
    elements.settingsModal.classList.remove("hidden");
  });

  elements.closeSettingsBtn.addEventListener("click", () => {
    elements.settingsModal.classList.add("hidden");
  });

  elements.saveSettingsBtn.addEventListener("click", () => {
    state.apiKey = elements.apiKeyInput.value.trim();
    localStorage.setItem("openai_api_key", state.apiKey);
    elements.settingsModal.classList.add("hidden");
  });
}

elements.analyzeBtn.addEventListener("click", runAnalyze);
elements.regenerateBtn.addEventListener("click", regenerateIdeas);
elements.sendFreeBtn.addEventListener("click", async () => {
  const active = getActiveTab();
  const question = active ? state.currentQuestionByTab[active.chatId] : null;
  if (!question || question.type !== "free") return;
  await submitAnswer({ selectedOptions: [], message: elements.freeInput.value.trim() });
});

bindSettings();
