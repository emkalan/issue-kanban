from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from dotenv import load_dotenv
import os
import json
import requests

import google.generativeai as genai


load_dotenv()

app = Flask(__name__)
CORS(app)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise RuntimeError("bruh moment: Missing GEMINI_API_KEY in environment, Emma's fault")

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.5-flash")


def fetch_github_issues(repo, github_token):
    url = f"https://api.github.com/repos/{repo}/issues"
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github+json",
    }

    try:
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"bruh moment! GitHub request failed: {e}")

    raw_items = response.json()
    
    issues = []
    for item in raw_items:
        # dont care abt prs
        if "pull_request" in item:
            continue

        issues.append({
            "number": item.get("number"),
            "title": item.get("title"),
            "body": (item.get("body") or "")[:200], #save tokens live better
            "state": item.get("state"),
            "labels": [label["name"] for label in item.get("labels", [])],
            "assignees": [a["login"] for a in item.get("assignees", [])],
            "html_url": item.get("html_url"),
        })

    return issues


def build_prompt(issues):
    issue_json = json.dumps(issues, ensure_ascii=False, indent=2)

    return f"""
You are converting GitHub issues into a Kanban board.

Return ONLY valid JSON.
Do not include markdown fences.
Do not include explanations.
Do not include any text before or after the JSON.

Use exactly this schema:
{{
  "columns": [
    {{
      "name": "Backlog",
      "cards": [
        {{
          "id": 123,
          "title": "Example issue title",
          "body": "Short summary",
          "labels": ["bug"],
          "assignees": ["emma"],
          "state": "open",
          "url": "https://github.com/..."
        }}
      ]
    }},
    {{
      "name": "Todo",
      "cards": []
    }},
    {{
      "name": "Doing",
      "cards": []
    }},
    {{
      "name": "Done",
      "cards": []
    }}
  ]
}}

Rules:
- Put closed issues in "Done".
- Put open issues with labels like "in progress", "doing", or "active" in "Doing".
- Put open issues with labels like "todo", "to-do", "ready", or "next" in "Todo".
- Put all other open issues in "Backlog".
- Preserve the original GitHub issue number as "id".
- Keep "body" short and useful. Summarize if needed.
- Never invent issues that do not exist.
- Every issue must appear in exactly one column.
- If the issue body describes multiple concrete steps, include a short task checklist in the body instead of creating new cards.
- Your entire output must be valid JSON and must start with '{' and end with '}'.

GitHub issues:
{issue_json}
""".strip()


def extract_json(text):
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # fallback in case of strange formatting output from api
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            cleaned = part.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                continue

    raise ValueError("bruh moment: Gemini yapped too much and didn't return valid JSON!")


@app.route("/", methods=["GET"])
def home():
    return jsonify({"swag moment": "Kanban backend is running :3"})


@app.route("/kanban", methods=["POST"])
def generate_kanban():
    try:
        data = request.get_json()

        if not data:
            return jsonify({"bruh moment": "Missing JSON body! Gemini's fault probably?!"}), 400

        repo = data.get("repo")
        github_token = data.get("github_token")

        if not repo:
            return jsonify({"bruh moment": "what `repo` am I meant to look at! Use format owner/repo"}), 400

        if not github_token:
            return jsonify({"bruh moment": "authentication failed, nice try tho. Missing 'github_token'"}), 400

        issues = fetch_github_issues(repo, github_token)

        prompt = build_prompt(issues)
        gemini_response = model.generate_content(prompt)

        text = getattr(gemini_response, "text", None)

        if not text:
            try:
                text = gemini_response.candidates[0].content.parts[0].text
            except Exception:
                raise RuntimeError("bruh moment: Gemini returned something cursed and unreadable")

        kanban_json = extract_json(text)


        return jsonify({"repo": repo, "issue_count": len(issues), "board": kanban_json})

    except Exception as e:
        return jsonify({"bruh moment": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
