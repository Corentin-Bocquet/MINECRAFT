const MONTHS = {
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const DAYS = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 7,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

const SAMPLE_CONTEXT = {
  today: "2024-04-10",
  timezone: "Europe/Paris",
  currency: "EUR",
  starting_balance: 0,
  budget_period: { start_day: 25, end_day: 24, mode: "custom" },
  categories: ["Loyer", "Abonnements", "Courses", "Transport", "Santé", "Loisirs", "Impôts", "Autres"],
  known_merchants: ["Netflix", "Spotify", "Amazon", "Apple", "Free", "Orange"],
  existing_items_summary: [],
  user_language_preference: "fr",
};

const SAMPLES = {
  netflix: "Netflix 13,99€ le 3 de chaque mois",
  installment: "J'ai acheté un PC 900€ en 3 fois à partir du 12 janvier",
  query: "Quand est-ce que je passe en négatif ?",
};

function parseRequest(userInput, contextData) {
  const normalized = userInput.trim();
  const lower = normalized.toLowerCase();
  const intent = detectIntent(lower);

  const actions = [];
  const warnings = [];
  let clarifyingQuestions = [];

  const amount = extractAmount(lower);
  const dateInfo = extractDate(lower, contextData.today);
  const frequency = extractFrequency(lower);
  const { isInstallment, installments } = extractInstallment(lower);
  const isSubscription = lower.includes("abo") || lower.includes("abonnement");

  let resolvedIntent = intent;
  if (resolvedIntent === "unknown" && (amount !== null || dateInfo || frequency || isInstallment)) {
    resolvedIntent = "create";
  }

  if (resolvedIntent === "query") {
    actions.push({
      action: "query_projection",
      payload: {
        range: { from: contextData.today, to: contextData.today },
        view: "timeline",
        group_by: "budget_period",
      },
    });
    actions.push({
      action: "explain_negative_risk",
      payload: { range: { from: contextData.today, to: contextData.today } },
    });
    return buildResponse(contextData, resolvedIntent, actions, warnings, clarifyingQuestions, assistantHint(contextData.user_language_preference, "Projection demandée"));
  }

  if (isInstallment && resolvedIntent === "create") {
    if (amount === null || !dateInfo) {
      clarifyingQuestions = missingAmountOrDateQuestions(contextData.user_language_preference);
      return buildResponse(contextData, "create", actions, warnings, clarifyingQuestions);
    }
    const plan = buildInstallmentPlan(amount, installments, dateInfo, lower, contextData);
    actions.push(plan);
    return buildResponse(
      contextData,
      resolvedIntent,
      actions,
      warnings,
      clarifyingQuestions,
      assistantHint(contextData.user_language_preference, "Paiement en plusieurs fois détecté", contextData.categories)
    );
  }

  if (frequency && resolvedIntent === "create") {
    if (amount === null || !dateInfo) {
      clarifyingQuestions = missingAmountOrDateQuestions(contextData.user_language_preference);
      return buildResponse(contextData, "create", actions, warnings, clarifyingQuestions);
    }
    actions.push(buildRecurring(lower, amount, dateInfo, frequency, isSubscription, contextData));
    return buildResponse(
      contextData,
      resolvedIntent,
      actions,
      warnings,
      clarifyingQuestions,
      assistantHint(contextData.user_language_preference, "Récurrence détectée", contextData.categories)
    );
  }

  if (resolvedIntent === "create") {
    if (amount === null || !dateInfo) {
      clarifyingQuestions = missingAmountOrDateQuestions(contextData.user_language_preference);
      return buildResponse(contextData, resolvedIntent, actions, warnings, clarifyingQuestions);
    }
    actions.push(buildSingle(lower, amount, dateInfo, contextData));
    return buildResponse(
      contextData,
      resolvedIntent,
      actions,
      warnings,
      clarifyingQuestions,
      assistantHint(contextData.user_language_preference, "Transaction simple détectée", contextData.categories)
    );
  }

  return buildResponse(
    contextData,
    "unknown",
    actions,
    warnings,
    clarifyingQuestions,
    assistantHint(contextData.user_language_preference, "Action non reconnue")
  );
}

function detectIntent(text) {
  if (["quand", "negatif", "négatif", "negative"].some((v) => text.includes(v))) return "query";
  if (["supprime", "delete"].some((v) => text.includes(v))) return "delete";
  if (["modifie", "update", "edite", "éedite", "change"].some((v) => text.includes(v))) return "update";
  if (["ajoute", "crée", "cree", "add", "nouveau", "payer", "payé", "payé"].some((v) => text.includes(v))) return "create";
  return "unknown";
}

function extractAmount(text) {
  const reAmount = /(\d+[\.,]?\d{0,2})(\s?(?:€|eur|euros|euro)?)/gi;
  let match;
  while ((match = reAmount.exec(text))) {
    const value = match[1].replace(",", ".");
    const currencyHint = (match[2] || "").trim();
    const prefix = text.slice(Math.max(0, match.index - 3), match.index);
    if (!currencyHint && /\b(le|du|au)\s*$/.test(prefix)) continue;
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) return num;
  }
  return null;
}

function extractDate(text, todayIso) {
  const today = new Date(todayIso);
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const slash = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const yearText = slash[3];
    const year = !yearText ? today.getUTCFullYear() : yearText.length === 4 ? Number(yearText) : Number(`20${yearText}`);
    const parsed = makeDate(year, month, day);
    if (parsed) {
      const isoString = parsed.toISOString().slice(0, 10);
      return parsed >= today ? isoString : makeDate(year + 1, month, day).toISOString().slice(0, 10);
    }
  }

  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  const monthMatch = new RegExp(`(\\d{1,2})\\s+(${monthNames})`, "i").exec(text);
  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const monthName = monthMatch[2].toLowerCase();
    const month = MONTHS[monthName];
    if (month) {
      const year = today.getUTCFullYear();
      const candidate = makeDate(year, month, day);
      if (candidate) {
        const isoCandidate = candidate.toISOString().slice(0, 10);
        return candidate >= today
          ? isoCandidate
          : makeDate(year + 1, month, day).toISOString().slice(0, 10);
      }
    }
  }

  const dayOnly = /le\s+(\d{1,2})(?![\d/])/.exec(text);
  if (dayOnly) {
    const targetDay = Number(dayOnly[1]);
    const candidate = makeDate(today.getUTCFullYear(), today.getUTCMonth() + 1, targetDay);
    if (!candidate) return null;
    if (candidate < today) {
      let month = today.getUTCMonth() + 2;
      let year = today.getUTCFullYear();
      if (month > 12) {
        month = 1;
        year += 1;
      }
      const next = makeDate(year, month, targetDay);
      return next ? next.toISOString().slice(0, 10) : null;
    }
    return candidate.toISOString().slice(0, 10);
  }

  return null;
}

function makeDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return d;
  return null;
}

function extractFrequency(text) {
  if (text.includes("chaque semaine") || text.includes("toutes les semaines")) {
    return { unit: "week", interval: 1, kind: "week" };
  }
  if (text.includes("chaque") && Object.keys(DAYS).some((day) => text.includes(day))) {
    for (const [day, value] of Object.entries(DAYS)) {
      if (text.includes(day)) {
        return { unit: "week", interval: 1, kind: "day_of_week", day_of_week: value };
      }
    }
  }
  if (["tous les mois", "chaque mois", "mensuel", "mensuelle", "mensuellement"].some((v) => text.includes(v))) {
    const dayMatch = /le\s+(\d{1,2})/.exec(text);
    const dayOfMonth = dayMatch ? Number(dayMatch[1]) : null;
    return { unit: "month", interval: 1, kind: "day_of_month", day_of_month: dayOfMonth };
  }
  return null;
}

function extractInstallment(text) {
  const match = /(\d+)\s*(?:x|fois|payments?)/.exec(text);
  if (match) return { isInstallment: true, installments: Number(match[1]) };
  return { isInstallment: false, installments: 0 };
}

function missingAmountOrDateQuestions(language) {
  if (language.startsWith("fr")) return ["Quel est le montant ?", "Quelle est la date ?"];
  if (language.startsWith("es")) return ["¿Cuál es el monto?", "¿Cuál es la fecha?"];
  return ["What is the amount?", "What is the date?"];
}

function buildInstallmentPlan(amount, installments, firstDate, text, context) {
  const name = inferName(text, context);
  const perPayment = Math.round((amount / installments) * 100) / 100;
  return {
    action: "create_installment_plan",
    payload: {
      type: "expense",
      name,
      total_amount: amount,
      installments_count: installments,
      first_payment_date: firstDate,
      installment_amount_mode: "equal_split",
      frequency: { unit: "month", interval: 1 },
      category: null,
      tags: [],
      notes: `Chaque mensualité ~${perPayment} ${context.currency}`,
    },
  };
}

function buildRecurring(text, amount, firstDate, frequency, isSubscription, context) {
  const name = inferName(text, context);
  let schedule = { kind: "day_of_month", day_of_month: new Date(firstDate).getUTCDate() };
  if (frequency.kind === "day_of_week") {
    schedule = { kind: "day_of_week", day_of_week: frequency.day_of_week };
  } else if (frequency.day_of_month) {
    schedule = { kind: "day_of_month", day_of_month: frequency.day_of_month || new Date(firstDate).getUTCDate() };
  }
  return {
    action: "create_recurring",
    payload: {
      type: isSubscription || text.includes("pay") ? "expense" : text.includes("recu") || text.includes("reçu") ? "income" : "expense",
      name,
      amount,
      start_date: firstDate,
      end_date: null,
      frequency: { unit: frequency.unit || "month", interval: frequency.interval || 1 },
      schedule,
      month_short_rule: "last_day",
      category: null,
      tags: [],
      notes: null,
    },
  };
}

function buildSingle(text, amount, dateIso, context) {
  const name = inferName(text, context);
  const txnType = ["recu", "reçu", "salaire", "revenu", "income"].some((w) => text.includes(w)) ? "income" : "expense";
  return {
    action: "create_transaction",
    payload: {
      type: txnType,
      name,
      amount,
      date: dateIso,
      category: null,
      tags: [],
      notes: null,
    },
  };
}

function assistantHint(language, note) {
  if (language.startsWith("es")) return `${note}. Puedes choisir la categoría más tarde.`;
  if (language.startsWith("en")) return `${note}. You can pick a category later.`;
  return `${note}. Vous pourrez choisir la catégorie ensuite.`;
}

function inferName(text, context) {
  if (context.known_merchants) {
    for (const merchant of context.known_merchants) {
      if (text.includes(merchant.toLowerCase())) return merchant;
    }
  }
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length ? capitalize(tokens[0]) : "Transaction";
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildResponse(context, intent, actions, warnings, clarifyingQuestions, assistantMessage = "") {
  return {
    language: context.user_language_preference,
    intent,
    actions,
    assistant_message: assistantMessage,
    warnings,
    clarifying_questions: clarifyingQuestions,
  };
}

function safeParseContext(raw) {
  let parsed = SAMPLE_CONTEXT;
  try {
    parsed = JSON.parse(raw);
    if (!parsed.today) throw new Error("today manquant");
  } catch (err) {
    throw new Error("Contexte invalide : " + err.message);
  }
  return parsed;
}

function formatJson(obj) {
  return JSON.stringify(obj, null, 2);
}

function renderOutput(json) {
  document.getElementById("output").textContent = formatJson(json);
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function hydrateContextTextarea() {
  document.getElementById("contextInput").value = formatJson(SAMPLE_CONTEXT);
}

function attachHandlers() {
  hydrateContextTextarea();
  document.getElementById("parseBtn").addEventListener("click", () => {
    try {
      const context = safeParseContext(document.getElementById("contextInput").value);
      const userInput = document.getElementById("userInput").value;
      if (!userInput.trim()) {
        setStatus("Ajoutez une demande à parser.", true);
        return;
      }
      const result = parseRequest(userInput, context);
      renderOutput(result);
      setStatus("JSON généré localement.");
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  document.querySelectorAll("button[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-sample");
      document.getElementById("userInput").value = SAMPLES[key] || "";
      setStatus("");
    });
  });

  document.getElementById("resetContext").addEventListener("click", () => {
    hydrateContextTextarea();
    setStatus("Contexte réinitialisé.");
  });

  document.getElementById("copyBtn").addEventListener("click", async () => {
    const text = document.getElementById("output").textContent;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("JSON copié dans le presse-papiers.");
    } catch (err) {
      setStatus("Impossible de copier : permissions clipboard refusées.", true);
    }
  });
}

attachHandlers();
