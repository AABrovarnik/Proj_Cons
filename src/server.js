import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const analyses = new Map();
const chats = new Map();
const analyzeAttempts = new Map();

const MODEL_LEVELS = ["basic", "standard", "advanced"];

const runtimeConfig = {
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  defaultModelLevel: "standard"
};

const MODEL_BY_LEVEL = {
  basic: process.env.OPENAI_MODEL_BASIC || process.env.OPENAI_MODEL || "gpt-4.1-mini",
  standard: process.env.OPENAI_MODEL_STANDARD || process.env.OPENAI_MODEL || "gpt-4.1-mini",
  advanced: process.env.OPENAI_MODEL_ADVANCED || process.env.OPENAI_MODEL || "gpt-4.1-mini"
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

const IDEAS_POOL = [
  "AI-ассистент продаж",
  "Интеллектуальная поддержка клиентов",
  "Автоматический аудит договоров",
  "Прогноз спроса и планирование",
  "Умная база знаний",
  "Контроль качества коммуникаций",
  "AI-аналитик маркетинга",
  "Автоматизация документооборота",
  "Рекомендательная система продуктов",
  "Мониторинг операционных рисков"
];

const QUESTION_FLOW = [
  {
    id: "q1",
    text: "Какая ключевая бизнес-цель у этого проекта?",
    type: "single",
    options: [
      { id: "q1_o1", label: "Рост выручки" },
      { id: "q1_o2", label: "Снижение затрат" },
      { id: "q1_o3", label: "Ускорение процессов" }
    ]
  },
  {
    id: "q2",
    text: "Какие подразделения затрагивает проект?",
    type: "multi",
    options: [
      { id: "q2_o1", label: "Продажи" },
      { id: "q2_o2", label: "Маркетинг" },
      { id: "q2_o3", label: "Операции" },
      { id: "q2_o4", label: "Поддержка" }
    ]
  },
  {
    id: "q3",
    text: "Какой уровень зрелости данных в компании?",
    type: "single",
    options: [
      { id: "q3_o1", label: "Низкий" },
      { id: "q3_o2", label: "Средний" },
      { id: "q3_o3", label: "Высокий" }
    ]
  },
  {
    id: "q4",
    text: "Какие ограничения наиболее критичны?",
    type: "multi",
    options: [
      { id: "q4_o1", label: "Бюджет" },
      { id: "q4_o2", label: "Сроки" },
      { id: "q4_o3", label: "Интеграции" },
      { id: "q4_o4", label: "Компетенции команды" }
    ]
  },
  {
    id: "q5",
    text: "Есть ли пилотный процесс, где можно быстро запустить MVP?",
    type: "single",
    options: [
      { id: "q5_o1", label: "Да" },
      { id: "q5_o2", label: "Нет" }
    ]
  },
  {
    id: "q6",
    text: "Добавьте важный контекст в свободной форме (по желанию).",
    type: "free",
    options: []
  }
];

function normalizeModelLevel(input) {
  return MODEL_LEVELS.includes(input) ? input : runtimeConfig.defaultModelLevel;
}

function normalizeUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProto);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sample(text, max = 1200) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function checkAnalyzeRateLimit(ip) {
  const now = Date.now();
  const current = analyzeAttempts.get(ip) || [];
  const fresh = current.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (fresh.length >= RATE_LIMIT_MAX) {
    analyzeAttempts.set(ip, fresh);
    return false;
  }

  fresh.push(now);
  analyzeAttempts.set(ip, fresh);
  return true;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "KonsultantBot/0.4" }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, { retries = 2, timeoutMs = 7000 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, timeoutMs);
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("fetch_failed");
}

function getOpenAiKey() {
  return runtimeConfig.openaiApiKey;
}

function hasOpenAiKey() {
  return Boolean(getOpenAiKey());
}

function getModelForLevel(modelLevel) {
  return MODEL_BY_LEVEL[normalizeModelLevel(modelLevel)] || MODEL_BY_LEVEL.standard;
}

function getTemperatureByLevel(modelLevel) {
  if (modelLevel === "basic") return 0.55;
  if (modelLevel === "advanced") return 0.3;
  return 0.45;
}

async function callResponsesApi({ prompt, modelLevel = "standard" }) {
  const apiKey = getOpenAiKey();
  if (!apiKey) throw new Error("OPENAI_KEY_MISSING");

  const model = getModelForLevel(modelLevel);
  const temperature = getTemperatureByLevel(modelLevel);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature,
      input: prompt
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OPENAI_API_ERROR:${response.status}:${errText.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = typeof data?.output_text === "string" ? data.output_text : "";
  return text.trim();
}

function parseIdeaListFromText(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;

    return parsed
      .map((item) => ({
        title: String(item?.title || "").trim(),
        description: String(item?.description || "").trim()
      }))
      .filter((item) => item.title && item.description)
      .slice(0, 5);
  } catch {
    return null;
  }
}

async function generateIdeasWithLlm(companyContext, excludedTitles, modelLevel) {
  const prompt = [
    "Ты консультант по внедрению ИИ.",
    "Сформируй ровно 5 уникальных идей проектов на русском языке.",
    "Верни только JSON-массив без markdown и пояснений.",
    "Формат каждого элемента: {\"title\":\"...\",\"description\":\"...\"}.",
    "Описание 80-220 символов, практично и конкретно.",
    `Исключи названия: ${excludedTitles.length ? excludedTitles.join(", ") : "нет"}.`,
    "Контекст компании:",
    companyContext
  ].join("\n");

  const llmText = await callResponsesApi({ prompt, modelLevel });
  return parseIdeaListFromText(llmText);
}

async function generateFinalWithLlm({ ideaTitle, answers, companyContext, modelLevel }) {
  const answersText = answers.map((item) => `- ${item.question}: ${item.value}`).join("\n");

  const prompt = [
    "Подготовь консультацию по проекту внедрения ИИ на русском языке.",
    "Структура строго из 6 разделов с заголовками:",
    "1) Суть проекта",
    "2) Потенциальная выгода",
    "3) Оценка сроков",
    "4) Оценка бюджета",
    "5) Ключевые риски",
    "6) Что критически важно учесть",
    "Без markdown-таблиц и без лишних вводных фраз.",
    `Название проекта: ${ideaTitle}`,
    "Контекст компании:",
    companyContext,
    "Ответы пользователя:",
    answersText
  ].join("\n");

  return callResponsesApi({ prompt, modelLevel });
}

async function collectContext(normalizedUrl) {
  const warnings = [];
  let html = "";

  try {
    const response = await fetchWithRetry(normalizedUrl, { retries: 2, timeoutMs: 7000 });

    if (!response.ok) {
      warnings.push(`Источник сайта вернул статус ${response.status}. Сформирован частичный контекст.`);
    } else {
      html = await response.text();
    }
  } catch {
    warnings.push("Не удалось получить главную страницу сайта после повторов. Использован ограниченный контекст.");
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "Без названия";
  const text = sample(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

  const companyName = new URL(normalizedUrl).hostname.replace(/^www\./i, "");
  const context = [
    `Компания: ${companyName}.`,
    `URL: ${normalizedUrl}.`,
    `Заголовок сайта: ${title}.`,
    text ? `Фрагмент контента: ${text}.` : "Контент страницы недоступен.",
    "Дополнительные веб-источники/соцсети в MVP помечаются как сигнал для ручной проверки."
  ].join("\n");

  const sources = [{ title: `Сайт компании (${companyName})`, url: normalizedUrl }];

  return { companyContext: context, sources, warnings };
}

function makeIdeasFallback(companyContext, exclude = []) {
  const excludeSet = new Set(exclude);
  const usedTitles = new Set();
  const ideas = [];
  const shuffled = [...IDEAS_POOL].sort(() => Math.random() - 0.5);
  const contextHint = companyContext.slice(0, 160);

  for (const baseTitle of shuffled) {
    if (ideas.length === 5) break;
    if (excludeSet.has(baseTitle) || usedTitles.has(baseTitle)) continue;

    usedTitles.add(baseTitle);
    ideas.push({
      id: uniqId("idea"),
      title: baseTitle,
      description: `Проект направлен на измеримый бизнес-эффект и использует контекст компании для запуска пилота за 4–8 недель. Контекст: ${contextHint}...`
    });
  }

  while (ideas.length < 5) {
    const title = `AI-инициатива ${ideas.length + 1}`;
    if (usedTitles.has(title)) continue;

    usedTitles.add(title);
    ideas.push({
      id: uniqId("idea"),
      title,
      description: "Резервная идея для сохранения обязательного количества карточек в выдаче."
    });
  }

  return ideas;
}

async function makeIdeas(companyContext, exclude = [], modelLevel = "standard") {
  if (hasOpenAiKey()) {
    try {
      const llmIdeas = await generateIdeasWithLlm(companyContext, exclude, modelLevel);
      if (Array.isArray(llmIdeas) && llmIdeas.length === 5) {
        return {
          ideas: llmIdeas.map((item) => ({
            id: uniqId("idea"),
            title: item.title,
            description: item.description
          })),
          source: "llm"
        };
      }
    } catch (error) {
      console.error("llm_ideas_failed", { message: error?.message, modelLevel });
    }
  }

  return { ideas: makeIdeasFallback(companyContext, exclude), source: "fallback" };
}

function getNextQuestion(index) {
  return QUESTION_FLOW[index] || null;
}

function resolveOptionLabels(question, selectedOptions = []) {
  if (!question || !Array.isArray(selectedOptions)) return [];
  const optionMap = new Map((question.options || []).map((option) => [option.id, option.label]));
  return selectedOptions.map((optionId) => optionMap.get(optionId)).filter(Boolean);
}

function buildFinalConsultationFallback(ideaTitle, answers) {
  const brief = answers.map((answer) => `${answer.question}: ${answer.value}`).join("; ");

  return [
    `**Суть проекта**\n${ideaTitle} фокусируется на прикладном внедрении ИИ в приоритетный процесс компании с быстрым запуском MVP и последующим масштабированием на смежные функции.`,
    "**Потенциальная выгода**\nОжидаемый эффект: снижение ручных операций на 20–40%, рост скорости принятия решений, повышение конверсии/качества сервиса при наличии прозрачных KPI на каждом этапе.",
    "**Оценка сроков**\nMVP: 4–8 недель (подготовка данных, прототип, пилот). Full version: 3–6 месяцев с интеграциями, дообучением и управлением изменениями.",
    "**Оценка бюджета**\nОриентир: S/M/L/XL зависит от числа интеграций и зрелости данных. Типовой старт MVP — категория M, при сложных интеграциях — L.",
    "**Ключевые риски**\nРиски: низкое качество исходных данных, сопротивление процессным изменениям, недостаток владельца продукта, ограничение по срокам и требованиям безопасности.",
    `**Что критически важно учесть**\nЗафиксировать бизнес-цель и метрики успеха до разработки, назначить владельца процесса, утвердить границы пилота, предусмотреть контур безопасности и этапы приемки.\n\nКонтекст ответов: ${brief}`
  ].join("\n\n");
}

async function buildFinalConsultation({ ideaTitle, answers, companyContext, modelLevel }) {
  if (hasOpenAiKey()) {
    try {
      const generated = await generateFinalWithLlm({ ideaTitle, answers, companyContext, modelLevel });
      if (generated && generated.length >= 300) return { text: generated, source: "llm" };
    } catch (error) {
      console.error("llm_final_failed", { message: error?.message, modelLevel });
    }
  }

  return { text: buildFinalConsultationFallback(ideaTitle, answers), source: "fallback" };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/api/settings", (_req, res) => {
  res.json({
    hasServerKey: hasOpenAiKey(),
    keySource: process.env.OPENAI_API_KEY ? "env" : "runtime",
    defaultModelLevel: runtimeConfig.defaultModelLevel,
    modelLevels: MODEL_LEVELS,
    modelsByLevel: MODEL_BY_LEVEL
  });
});

app.post("/api/settings", (req, res) => {
  const rawKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : null;
  const rawLevel = typeof req.body?.modelLevel === "string" ? req.body.modelLevel : null;

  if (rawKey !== null) {
    if (!rawKey) {
      runtimeConfig.openaiApiKey = "";
    } else if (!rawKey.startsWith("sk-")) {
      return res.status(400).json({ error: "Некорректный формат API-ключа" });
    } else {
      runtimeConfig.openaiApiKey = rawKey;
    }
  }

  if (rawLevel !== null) {
    runtimeConfig.defaultModelLevel = normalizeModelLevel(rawLevel);
  }

  return res.json({
    ok: true,
    hasServerKey: hasOpenAiKey(),
    defaultModelLevel: runtimeConfig.defaultModelLevel
  });
});

app.post("/api/analyze", async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkAnalyzeRateLimit(clientIp)) {
    return res.status(429).json({ error: "Слишком много запусков анализа. Повторите через минуту." });
  }

  const normalizedUrl = normalizeUrl(req.body?.url);
  if (!normalizedUrl) {
    return res.status(400).json({ error: "Некорректный URL. Укажите адрес сайта в формате company.com или https://company.com" });
  }

  const modelLevel = normalizeModelLevel(req.body?.modelLevel);
  const analysisId = uniqId("an");
  const { companyContext, sources, warnings } = await collectContext(normalizedUrl);

  analyses.set(analysisId, {
    analysisId,
    normalizedUrl,
    companyContext,
    sources,
    warnings,
    modelLevel,
    createdAt: Date.now(),
    ideas: []
  });

  return res.json({
    analysisId,
    status: "done",
    companyContext,
    sources,
    warnings,
    modelLevel
  });
});

app.post("/api/ideas/generate", async (req, res) => {
  const analysis = analyses.get(req.body?.analysisId);
  if (!analysis) return res.status(404).json({ error: "analysisId не найден" });

  const generated = await makeIdeas(analysis.companyContext, [], analysis.modelLevel);
  analysis.ideas = generated.ideas;
  analyses.set(analysis.analysisId, analysis);

  return res.json({ ideas: generated.ideas, generatedBy: generated.source, modelLevel: analysis.modelLevel });
});

app.post("/api/ideas/regenerate", async (req, res) => {
  const analysis = analyses.get(req.body?.analysisId);
  if (!analysis) return res.status(404).json({ error: "analysisId не найден" });

  const excludeIdeaIds = Array.isArray(req.body?.excludeIdeaIds) ? req.body.excludeIdeaIds : [];
  const excludedTitles = analysis.ideas
    .filter((idea) => excludeIdeaIds.includes(idea.id))
    .map((idea) => idea.title);

  const generated = await makeIdeas(analysis.companyContext, excludedTitles, analysis.modelLevel);
  analysis.ideas = generated.ideas;
  analyses.set(analysis.analysisId, analysis);

  return res.json({ ideas: generated.ideas, generatedBy: generated.source, modelLevel: analysis.modelLevel });
});

app.post("/api/chat/start", (req, res) => {
  const { analysisId, ideaId } = req.body ?? {};
  const analysis = analyses.get(analysisId);
  if (!analysis) return res.status(404).json({ error: "analysisId не найден" });

  const idea = analysis.ideas.find((item) => item.id === ideaId);
  if (!idea) return res.status(404).json({ error: "ideaId не найден" });

  const chatId = uniqId("chat");
  chats.set(chatId, {
    chatId,
    analysisId,
    ideaId,
    ideaTitle: idea.title,
    step: 0,
    answers: []
  });

  return res.json({
    chatId,
    greeting: `Вы выбрали проект «${idea.title}». Чтобы подготовить консультацию, задам 5–7 вопросов.`,
    questions: [getNextQuestion(0)]
  });
});

app.post("/api/chat/message", async (req, res) => {
  const { chatId, message, selectedOptions } = req.body ?? {};
  const chat = chats.get(chatId);
  if (!chat) return res.status(404).json({ error: "chatId не найден" });

  const currentQuestion = getNextQuestion(chat.step);
  if (!currentQuestion) {
    return res.status(400).json({ error: "Опрос уже завершен" });
  }

  if (currentQuestion.type === "multi" && (!Array.isArray(selectedOptions) || selectedOptions.length === 0)) {
    return res.status(400).json({ error: "Для множественного выбора нужно выбрать минимум один вариант" });
  }

  const value = currentQuestion.type === "free"
    ? String(message || "").trim()
    : resolveOptionLabels(currentQuestion, selectedOptions).join(", ");

  chat.answers.push({ question: currentQuestion.text, value: value || "(без ответа)" });
  chat.step += 1;
  chats.set(chatId, chat);

  const nextQuestion = getNextQuestion(chat.step);
  if (nextQuestion) {
    return res.json({
      assistantMessage: "Принято, двигаемся дальше.",
      nextQuestion,
      isFinal: false
    });
  }

  const analysis = analyses.get(chat.analysisId);
  const finalResult = await buildFinalConsultation({
    ideaTitle: chat.ideaTitle,
    answers: chat.answers,
    companyContext: analysis?.companyContext || "Контекст не найден",
    modelLevel: analysis?.modelLevel || runtimeConfig.defaultModelLevel
  });

  return res.json({
    assistantMessage: finalResult.text,
    nextQuestion: null,
    isFinal: true,
    generatedBy: finalResult.source,
    modelLevel: analysis?.modelLevel || runtimeConfig.defaultModelLevel
  });
});

app.use((error, _req, res, _next) => {
  console.error("unhandled_error", { message: error?.message });
  return res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

app.listen(PORT, () => {
  console.log(`Konsultant server running: http://localhost:${PORT}`);
});
