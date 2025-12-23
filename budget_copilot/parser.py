from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple


@dataclass
class Context:
    today: date
    timezone: str
    currency: str
    starting_balance: float
    budget_period: Dict
    categories: List[str]
    known_merchants: List[str]
    existing_items_summary: List[Dict]
    user_language_preference: str = "fr"


MONTHS_FR = {
    "janvier": 1,
    "février": 2,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "août": 8,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "décembre": 12,
    "decembre": 12,
}

MONTHS_EN = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

MONTHS_ES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}

DAY_OF_WEEK = {
    "lundi": 1,
    "mardi": 2,
    "mercredi": 3,
    "jeudi": 4,
    "vendredi": 5,
    "samedi": 6,
    "dimanche": 7,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
    "sunday": 7,
    "lunes": 1,
    "martes": 2,
    "miercoles": 3,
    "miércoles": 3,
    "jueves": 4,
    "viernes": 5,
    "sabado": 6,
    "sábado": 6,
    "domingo": 7,
}

MONTH_LOOKUP = {**MONTHS_FR, **MONTHS_EN, **MONTHS_ES}


def parse_request(user_input: str, context_data: Dict) -> Dict:
    context = _context_from_dict(context_data)
    normalized = user_input.strip()
    lower_input = normalized.lower()
    intent = _detect_intent(lower_input)

    actions: List[Dict] = []
    warnings: List[str] = []
    clarifying_questions: List[str] = []

    amount = _extract_amount(lower_input)
    date_info = _extract_date(lower_input, context.today)
    frequency = _extract_frequency(lower_input)
    is_installment, installments = _extract_installment(lower_input)
    is_subscription = "abo" in lower_input or "abonnement" in lower_input

    if intent == "unknown" and (amount is not None or date_info is not None or frequency or is_installment):
        intent = "create"

    if intent == "query":
        actions.append(
            {
                "action": "query_projection",
                "payload": {
                    "range": {"from": context.today.isoformat(), "to": context.today.isoformat()},
                    "view": "timeline",
                    "group_by": "budget_period",
                },
            }
        )
        actions.append(
            {
                "action": "explain_negative_risk",
                "payload": {"range": {"from": context.today.isoformat(), "to": context.today.isoformat()}},
            }
        )
        assistant_message = _assistant_hint(language=context.user_language_preference, note="Projection demandée")
        return _build_response(context, intent, actions, warnings, clarifying_questions, assistant_message)

    if is_installment and intent == "create":
        if amount is None or date_info is None:
            clarifying_questions = _missing_amount_or_date_questions(context.user_language_preference)
            return _build_response(context, "create", actions, warnings, clarifying_questions)

        plan = _build_installment_plan(amount, installments, date_info, lower_input, context)
        actions.append(plan)
        assistant_message = _assistant_hint(
            context.user_language_preference,
            note="Paiement en plusieurs fois détecté",
            categories=context.categories,
        )
        return _build_response(context, intent, actions, warnings, clarifying_questions, assistant_message)

    if frequency and intent == "create":
        if amount is None or date_info is None:
            clarifying_questions = _missing_amount_or_date_questions(context.user_language_preference)
            return _build_response(context, "create", actions, warnings, clarifying_questions)

        actions.append(
            _build_recurring(lower_input, amount, date_info, frequency, is_subscription, context)
        )
        assistant_message = _assistant_hint(
            context.user_language_preference,
            note="Récurrence détectée",
            categories=context.categories,
        )
        return _build_response(context, intent, actions, warnings, clarifying_questions, assistant_message)

    if intent == "create":
        if amount is None or date_info is None:
            clarifying_questions = _missing_amount_or_date_questions(context.user_language_preference)
            return _build_response(context, intent, actions, warnings, clarifying_questions)

        actions.append(_build_single(lower_input, amount, date_info, context))
        assistant_message = _assistant_hint(
            context.user_language_preference,
            note="Transaction simple détectée",
            categories=context.categories,
        )
        return _build_response(context, intent, actions, warnings, clarifying_questions, assistant_message)

    assistant_message = _assistant_hint(context.user_language_preference, note="Action non reconnue")
    return _build_response(context, "unknown", actions, warnings, clarifying_questions, assistant_message)


def _context_from_dict(data: Dict) -> Context:
    today = datetime.strptime(data.get("today"), "%Y-%m-%d").date()
    return Context(
        today=today,
        timezone=data.get("timezone", "Europe/Paris"),
        currency=data.get("currency", "EUR"),
        starting_balance=float(data.get("starting_balance", 0)),
        budget_period=data.get("budget_period", {}),
        categories=data.get("categories", []),
        known_merchants=data.get("known_merchants", []),
        existing_items_summary=data.get("existing_items_summary", []),
        user_language_preference=data.get("user_language_preference", "fr"),
    )


def _detect_intent(text: str) -> str:
    if any(q in text for q in ["quand", "negatif", "négatif", "negative"]):
        return "query"
    if any(v in text for v in ["supprime", "delete"]):
        return "delete"
    if any(v in text for v in ["modifie", "update", "edite", "éedite", "change"]):
        return "update"
    if any(v in text for v in ["ajoute", "crée", "cree", "add", "nouveau", "payer", "payé", "payé"]):
        return "create"
    return "unknown"


def _extract_amount(text: str) -> Optional[float]:
    amount_pattern = re.compile(r"(\d+[\.,]?\d{0,2})(\s?(?:€|eur|euros|euro)?)")
    for match in amount_pattern.finditer(text):
        value = match.group(1).replace(",", ".")
        currency_hint = match.group(2).strip()
        prefix = text[max(0, match.start() - 3) : match.start()]
        if not currency_hint and re.search(r"\b(le|du|au)\s*$", prefix):
            continue
        try:
            return float(value)
        except ValueError:
            continue
    return None


def _extract_date(text: str, today: date) -> Optional[date]:
    iso_match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if iso_match:
        return datetime.strptime(iso_match.group(1), "%Y-%m-%d").date()

    slash_match = re.search(r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?", text)
    if slash_match:
        day = int(slash_match.group(1))
        month = int(slash_match.group(2))
        year_text = slash_match.group(3)
        year = today.year if year_text is None else int(year_text if len(year_text) == 4 else f"20{year_text}")
        parsed = date(year, month, day)
        return parsed if parsed >= today else date(year + 1, month, day)

    month_names = "|".join(sorted(MONTH_LOOKUP.keys(), key=len, reverse=True))
    month_match = re.search(rf"(\d{{1,2}})\s+({month_names})", text, flags=re.IGNORECASE)
    if month_match:
        day = int(month_match.group(1))
        month_name = month_match.group(2).lower()
        month = MONTH_LOOKUP.get(month_name)
        if month:
            year = today.year
            candidate = date(year, month, day)
            return candidate if candidate >= today else date(year + 1, month, day)

    day_only = re.search(r"le\s+(\d{1,2})(?![\d/])", text)
    if day_only:
        target_day = int(day_only.group(1))
        try:
            candidate = date(today.year, today.month, target_day)
        except ValueError:
            return None
        if candidate < today:
            month = today.month + 1
            year = today.year
            if month > 12:
                month = 1
                year += 1
            try:
                candidate = date(year, month, target_day)
            except ValueError:
                return None
        return candidate

    return None


def _extract_frequency(text: str) -> Optional[Dict]:
    if "chaque semaine" in text or "toutes les semaines" in text:
        return {"unit": "week", "interval": 1, "kind": "week"}
    if "chaque" in text and any(day in text for day in DAY_OF_WEEK):
        for day in DAY_OF_WEEK:
            if day in text:
                return {"unit": "week", "interval": 1, "kind": "day_of_week", "day_of_week": DAY_OF_WEEK[day]}
    if any(v in text for v in ["tous les mois", "chaque mois", "mensuel", "mensuelle", "mensuellement"]):
        day_match = re.search(r"le\s+(\d{1,2})", text)
        day_of_month = int(day_match.group(1)) if day_match else None
        return {"unit": "month", "interval": 1, "kind": "day_of_month", "day_of_month": day_of_month}
    return None


def _extract_installment(text: str) -> Tuple[bool, int]:
    match = re.search(r"(\d+)\s*(?:x|fois|payments?)", text)
    if match:
        count = int(match.group(1))
        return True, count
    return False, 0


def _missing_amount_or_date_questions(language: str) -> List[str]:
    if language.startswith("fr"):
        return ["Quel est le montant ?", "Quelle est la date ?"]
    if language.startswith("es"):
        return ["¿Cuál es el monto?", "¿Cuál es la fecha?"]
    return ["What is the amount?", "What is the date?"]


def _build_installment_plan(amount: float, installments: int, first_date: date, text: str, context: Context) -> Dict:
    name = _infer_name(text, context)
    installment_amount = round(amount / installments, 2)
    return {
        "action": "create_installment_plan",
        "payload": {
            "type": "expense",
            "name": name,
            "total_amount": amount,
            "installments_count": installments,
            "first_payment_date": first_date.isoformat(),
            "installment_amount_mode": "equal_split",
            "frequency": {"unit": "month", "interval": 1},
            "category": None,
            "tags": [],
            "notes": f"Chaque mensualité ~{installment_amount} {context.currency}",
        },
    }


def _build_recurring(text: str, amount: float, first_date: date, frequency: Dict, is_subscription: bool, context: Context) -> Dict:
    name = _infer_name(text, context)
    schedule = {"kind": "day_of_month", "day_of_month": first_date.day}
    if frequency.get("kind") == "day_of_week":
        schedule = {"kind": "day_of_week", "day_of_week": frequency["day_of_week"]}
    elif frequency.get("day_of_month"):
        schedule = {"kind": "day_of_month", "day_of_month": frequency["day_of_month"] or first_date.day}
    return {
        "action": "create_recurring",
        "payload": {
            "type": "expense" if is_subscription or "pay" in text else "income" if "recu" in text or "reçu" in text else "expense",
            "name": name,
            "amount": amount,
            "start_date": first_date.isoformat(),
            "end_date": None,
            "frequency": {"unit": frequency.get("unit", "month"), "interval": frequency.get("interval", 1)},
            "schedule": schedule,
            "month_short_rule": "last_day",
            "category": None,
            "tags": [],
            "notes": None,
        },
    }


def _build_single(text: str, amount: float, when: date, context: Context) -> Dict:
    name = _infer_name(text, context)
    txn_type = "income" if any(word in text for word in ["recu", "reçu", "salaire", "revenu", "income"]) else "expense"
    return {
        "action": "create_transaction",
        "payload": {
            "type": txn_type,
            "name": name,
            "amount": amount,
            "date": when.isoformat(),
            "category": None,
            "tags": [],
            "notes": None,
        },
    }


def _assistant_hint(language: str, note: str, categories: Optional[List[str]] = None) -> str:
    if language.startswith("es"):
        return f"{note}. Puedes choisir la categoría más tarde."
    if language.startswith("en"):
        return f"{note}. You can pick a category later."
    return f"{note}. Vous pourrez choisir la catégorie ensuite."


def _infer_name(text: str, context: Context) -> str:
    for merchant in context.known_merchants:
        if merchant.lower() in text:
            return merchant
    tokens = text.strip().split()
    if tokens:
        return tokens[0].capitalize()
    return "Transaction"


def _build_response(
    context: Context,
    intent: str,
    actions: List[Dict],
    warnings: List[str],
    clarifying_questions: List[str],
    assistant_message: Optional[str] = None,
) -> Dict:
    return {
        "language": context.user_language_preference,
        "intent": intent,
        "actions": actions,
        "assistant_message": assistant_message or "",
        "warnings": warnings,
        "clarifying_questions": clarifying_questions,
    }
