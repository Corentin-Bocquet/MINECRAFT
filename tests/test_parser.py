import datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from budget_copilot import parse_request


CONTEXT = {
    "today": "2024-04-10",
    "timezone": "Europe/Paris",
    "currency": "EUR",
    "starting_balance": 0,
    "budget_period": {"start_day": 25, "end_day": 24, "mode": "custom"},
    "categories": ["Loyer", "Abonnements", "Courses", "Transport", "Santé", "Loisirs", "Impôts", "Autres"],
    "known_merchants": ["Netflix", "Spotify", "Amazon", "Apple", "Free", "Orange"],
    "existing_items_summary": [],
    "user_language_preference": "fr",
}


def test_recurring_subscription_day_of_month():
    result = parse_request("Netflix 13,99€ le 3 de chaque mois", CONTEXT)
    assert result["intent"] == "create"
    assert result["actions"][0]["action"] == "create_recurring"
    payload = result["actions"][0]["payload"]
    assert payload["name"] == "Netflix"
    assert payload["amount"] == 13.99
    assert payload["schedule"]["day_of_month"] == 3


def test_installment_default_three_times():
    result = parse_request("J'ai acheté un PC 900€ en 3 fois à partir du 12 janvier", CONTEXT)
    assert result["actions"][0]["action"] == "create_installment_plan"
    payload = result["actions"][0]["payload"]
    assert payload["installments_count"] == 3
    assert payload["total_amount"] == 900.0
    assert payload["first_payment_date"].endswith("-01-12")


def test_query_negative_projection():
    result = parse_request("Quand est-ce que je passe en négatif ?", CONTEXT)
    assert result["intent"] == "query"
    assert result["actions"][0]["action"] == "query_projection"
    assert result["actions"][1]["action"] == "explain_negative_risk"


def test_missing_amount_prompts_questions():
    result = parse_request("payer le 5", CONTEXT)
    assert result["clarifying_questions"]
    assert not result["actions"]


def test_day_only_rolls_forward():
    result = parse_request("courses 40€ le 5", CONTEXT)
    target_date = datetime.date(2024, 5, 5)
    assert result["actions"][0]["payload"]["date"] == target_date.isoformat()
