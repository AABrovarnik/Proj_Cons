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

async function collectContext(normalizedUrl) {
  const warnings = [];
  let html = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "KonsultantBot/0.1" }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      warnings.push(`Источник сайта вернул статус ${res.status}.`);
    } else {
      html = await res.text();
    }
  } catch {
    warnings.push("Не удалось получить главную страницу сайта, использован ограниченный контекст.");
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "Без названия";
  const text = sample(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));

  const companyName = new URL(normalizedUrl).hostname.replace(/^www\./i, "");
  const context = [
    `Компания: ${companyName}.`,
    `URL: ${normalizedUrl}.`,
    `Заголовок сайта: ${title}.`,
    text ? `Фрагмент контента: ${text}.` : "Контент страницы недоступен.",
    "Дополнительные веб-источники/соцсети в MVP помечаются как сигнал для ручной проверки."
  ].join("\n");

  const sources = [
    { title: `Сайт компании (${companyName})`, url: normalizedUrl }
  ];

  return { companyContext: context, sources, warnings };
}

function uniqId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function makeIdeas(companyContext, exclude = []) {
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

function getNextQuestion(index) {
  return QUESTION_FLOW[index] || null;
}

function resolveOptionLabels(question, selectedOptions = []) {
  if (!question || !Array.isArray(selectedOptions)) return [];
  const optionMap = new Map(question.options.map((option) => [option.id, option.label]));
  return selectedOptions.map((optionId) => optionMap.get(optionId)).filter(Boolean);
}

function buildFinalConsultation(ideaTitle, answers) {
  const brief = answers
    .map((answer) => `${answer.question}: ${answer.value}`)
    .join("; ");

  return [
    `**Суть проекта**\n${ideaTitle} фокусируется на прикладном внедрении ИИ в приоритетный процесс компании с быстрым запуском MVP и последующим масштабированием на смежные функции.`,
    "**Потенциальная выгода**\nОжидаемый эффект: снижение ручных операций на 20–40%, рост скорости принятия решений, повышение конверсии/качества сервиса при наличии прозрачных KPI на каждом этапе.",
    "**Оценка сроков**\nMVP: 4–8 недель (подготовка данных, прототип, пилот). Full version: 3–6 месяцев с интеграциями, дообучением и управлением изменениями.",
    "**Оценка бюджета**\nОриентир: S/M/L/XL зависит от числа интеграций и зрелости данных. Типовой старт MVP — категория M, при сложных интеграциях — L.",
    "**Ключевые риски**\nРиски: низкое качество исходных данных, сопротивление процессным изменениям, недостаток владельца продукта, ограничение по срокам и требованиям безопасности.",
    `**Что критически важно учесть**\nЗафиксировать бизнес-цель и метрики успеха до разработки, назначить владельца процесса, утвердить границы пилота, предусмотреть контур безопасности и этапы приемки.\n\nКонтекст ответов: ${brief}`
  ].join("\n\n");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/api/analyze", async (req, res) => {
  const normalizedUrl = normalizeUrl(req.body?.url);
  if (!normalizedUrl) {
    return res.status(400).json({ error: "Некорректный URL. Укажите адрес сайта в формате company.com или https://company.com" });
  }

  const analysisId = uniqId("an");
  const { companyContext, sources, warnings } = await collectContext(normalizedUrl);

  analyses.set(analysisId, {
    analysisId,
    normalizedUrl,
    companyContext,
    sources,
    warnings,
    createdAt: Date.now(),
    ideas: []
  });

  return res.json({
    analysisId,
    status: "done",
    companyContext,
    sources,
    warnings
  });
});

app.post("/api/ideas/generate", (req, res) => {
  const analysis = analyses.get(req.body?.analysisId);
  if (!analysis) return res.status(404).json({ error: "analysisId не найден" });

  const ideas = makeIdeas(analysis.companyContext);
  analysis.ideas = ideas;
  analyses.set(analysis.analysisId, analysis);

  return res.json({ ideas });
});

app.post("/api/ideas/regenerate", (req, res) => {
  const analysis = analyses.get(req.body?.analysisId);
  if (!analysis) return res.status(404).json({ error: "analysisId не найден" });

  const excludeIdeaIds = Array.isArray(req.body?.excludeIdeaIds) ? req.body.excludeIdeaIds : [];
  const excludedTitles = analysis.ideas
    .filter((idea) => excludeIdeaIds.includes(idea.id))
    .map((idea) => idea.title);

  const ideas = makeIdeas(analysis.companyContext, excludedTitles);
  analysis.ideas = ideas;
  analyses.set(analysis.analysisId, analysis);

  return res.json({ ideas });
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

app.post("/api/chat/message", (req, res) => {
  const { chatId, message, selectedOptions } = req.body ?? {};
  const chat = chats.get(chatId);
  if (!chat) return res.status(404).json({ error: "chatId не найден" });

  const currentQuestion = getNextQuestion(chat.step);
  if (!currentQuestion) {
    return res.status(400).json({ error: "Опрос уже завершен" });
  }

  if (currentQuestion.type === "multi") {
    if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
      return res.status(400).json({ error: "Для множественного выбора нужно выбрать минимум один вариант" });
    }
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

  const finalText = buildFinalConsultation(chat.ideaTitle, chat.answers);
  return res.json({
    assistantMessage: finalText,
    nextQuestion: null,
    isFinal: true
  });
});

app.listen(PORT, () => {
  console.log(`Konsultant server running: http://localhost:${PORT}`);
});
