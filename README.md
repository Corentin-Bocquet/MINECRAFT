# Budget Copilot Parser

This repository contains a lightweight parser that transforms natural language budgeting requests into structured JSON actions expected by the BudgetCopilot local app.

## Usage

```
from budget_copilot import parse_request

context = {
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

print(parse_request("Netflix 13,99€ le 3 de chaque mois", context))
```

## Testing

Run the unit suite with `pytest`:

```
pytest
```

## Web demo (HTML/CSS/JS)

A lightweight, local-only web UI is available in `web/` to try the parser in-browser.

1. Start a static server from the repo root (example):
   ```
   python -m http.server 8000
   ```
2. Open `http://localhost:8000/web/index.html` in your browser.
3. Paste/adjust the context JSON, type a natural-language request, and click "Générer le JSON" to see the structured output. All logic runs locally in the browser.
