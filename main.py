from flask import Flask, request, jsonify
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
    raise RuntimeError(
        "bruh moment: Missing GEMINI_API_KEY in environment, Emma's fault"
    )

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    generation_config={
        "response_mime_type": "application/json",
        "response_schema": {
            "type": "object",
            "properties": {
                "columns": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "cards": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "integer"},
                                        "title": {"type": "string"},
                                        "body": {"type": "string"},
                                        "labels": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                        },
                                        "assignees": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                        },
                                        "state": {"type": "string"},
                                        "url": {"type": "string"},
                                    },
                                    "required": [
                                        "id",
                                        "title",
                                        "body",
                                        "labels",
                                        "assignees",
                                        "state",
                                        "url",
                                    ],
                                },
                            },
                        },
                        "required": ["name", "cards"],
                    },
                }
            },
            "required": ["columns"],
        },
    },
)

GITHUB_API_VERSION = "2022-11-28"

COLUMN_NAMES = {"Backlog", "Todo", "Doing", "Done"}

TODO_LABEL_CANONICAL = "todo"
DOING_LABEL_CANONICAL = "in progress"

TODO_LABEL_ALIASES = {"todo", "to-do", "ready", "next"}
DOING_LABEL_ALIASES = {"in progress", "doing", "active"}

WORKFLOW_LABEL_ALIASES = TODO_LABEL_ALIASES | DOING_LABEL_ALIASES


def github_headers(github_token):
    return {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
    }


def repo_issue_url(repo, issue_number=None):
    base = f"https://api.github.com/repos/{repo}/issues"
    if issue_number is None:
        return base
    return f"{base}/{issue_number}"


def normalize_label(label_name):
    return label_name.strip().lower()


def is_valid_repo_format(repo):
    if not isinstance(repo, str):
        return False
    parts = repo.strip().split("/")
    return len(parts) == 2 and all(part.strip() for part in parts)


def dedupe_preserve_order(items):
    seen = set()
    output = []
    for item in items:
        if item not in seen:
            seen.add(item)
            output.append(item)
    return output


def fetch_github_issues(repo, github_token):
    url = repo_issue_url(repo)
    headers = github_headers(github_token)
    params = {
        "state": "all",
        "per_page": 100,
    }

    try:
        response = requests.get(url, headers=headers, params=params, timeout=20)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"bruh moment! GitHub request failed: {e}")

    raw_items = response.json()

    issues = []
    for item in raw_items:
        # GitHub issues endpoint also returns PRs. annoying but true.
        if "pull_request" in item:
            continue

        issues.append(
            {
                "number": item.get("number"),
                "title": item.get("title"),
                "body": (item.get("body") or "")[:400],
                "state": item.get("state"),
                "labels": [label["name"] for label in item.get("labels", [])],
                "assignees": [a["login"] for a in item.get("assignees", [])],
                "html_url": item.get("html_url"),
            }
        )

    return issues


def build_prompt(issues):
    issue_data = json.dumps(issues, ensure_ascii=False)

    return f"""
Categorize these GitHub issues into a 4-column Kanban board: Backlog, Todo, Doing, and Done.

Logistics:
1. "Done": Any issue where state is 'closed'.
2. "Doing": Open issues with labels like 'in progress', 'doing', or 'active'.
3. "Todo": Open issues with labels like 'todo', 'ready', or 'next'.
4. "Backlog": All other open issues.

Content Rules:
- Summarize long 'body' text into a concise 1-2 sentence description.
- If an issue body contains a task list (e.g., "- [ ]"), preserve those specific tasks in the summary.
- Map the GitHub 'number' to the 'id' field.
- Ensure every issue provided is assigned to exactly one column.

Input Data:
{issue_data}
""".strip()


def extract_json(text):
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

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

    # weak fallback: try to grab the outermost JSON object
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidate = text[first_brace : last_brace + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    raise ValueError(
        "bruh moment: Gemini yapped too much and didn't return valid JSON!"
    )


def validate_board_shape(board):
    if not isinstance(board, dict):
        raise ValueError("Gemini returned non-object JSON somehow. Impressive.")

    columns = board.get("columns")
    if not isinstance(columns, list):
        raise ValueError("Gemini forgot `columns`.")

    names = [col.get("name") for col in columns if isinstance(col, dict)]
    missing = [
        name for name in ["Backlog", "Todo", "Doing", "Done"] if name not in names
    ]
    if missing:
        raise ValueError(f"Missing expected columns: {missing}")

    return board


def generate_board_from_issues(issues):
    prompt = build_prompt(issues)
    gemini_response = model.generate_content(prompt)
    board = extract_json(gemini_response.text)
    return validate_board_shape(board)


def get_issue(repo, issue_number, github_token):
    url = repo_issue_url(repo, issue_number)
    headers = github_headers(github_token)

    try:
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"could not fetch issue #{issue_number}: {e}")

    issue = response.json()

    if "pull_request" in issue:
        raise ValueError("that card is a PR, not an issue")

    return issue


def compute_updated_issue_fields(current_issue, target_column):
    if target_column not in COLUMN_NAMES:
        raise ValueError(f"invalid target column: {target_column}")

    current_labels = [label["name"] for label in current_issue.get("labels", [])]

    # strip any existing workflow-ish labels, preserve all other labels
    non_workflow_labels = [
        label
        for label in current_labels
        if normalize_label(label) not in WORKFLOW_LABEL_ALIASES
    ]

    new_labels = list(non_workflow_labels)
    new_state = "open"

    if target_column == "Backlog":
        new_state = "open"

    elif target_column == "Todo":
        new_state = "open"
        new_labels.append(TODO_LABEL_CANONICAL)

    elif target_column == "Doing":
        new_state = "open"
        new_labels.append(DOING_LABEL_CANONICAL)

    elif target_column == "Done":
        new_state = "closed"

    new_labels = dedupe_preserve_order(new_labels)

    return {
        "state": new_state,
        "labels": new_labels,
    }


def patch_issue(repo, issue_number, github_token, payload):
    url = repo_issue_url(repo, issue_number)
    headers = github_headers(github_token)

    try:
        response = requests.patch(url, headers=headers, json=payload, timeout=20)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"could not update issue #{issue_number}: {e}")

    return response.json()


@app.route("/", methods=["GET"])
def home():
    return jsonify({"swag moment": "Kanban backend is running :3"})


@app.route("/kanban", methods=["POST"])
def generate_kanban():
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({"bruh moment": "Missing JSON body!"}), 400

        repo = data.get("repo")
        github_token = data.get("github_token")

        if not repo:
            return jsonify({"bruh moment": "missing `repo`. Use owner/repo"}), 400

        if not is_valid_repo_format(repo):
            return jsonify({"bruh moment": "repo must look like owner/repo"}), 400

        if not github_token:
            return jsonify({"bruh moment": "Missing `github_token`"}), 400

        issues = fetch_github_issues(repo, github_token)
        board = generate_board_from_issues(issues)

        return jsonify(
            {
                "repo": repo,
                "issue_count": len(issues),
                "board": board,
            }
        )

    except Exception as e:
        return jsonify({"bruh moment": str(e)}), 500


@app.route("/move-issue", methods=["POST"])
def move_issue():
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({"bruh moment": "Missing JSON body!"}), 400

        repo = data.get("repo")
        github_token = data.get("github_token")
        issue_number = data.get("issue_number")
        target_column = data.get("target_column")

        if not repo:
            return jsonify({"bruh moment": "missing `repo`"}), 400

        if not is_valid_repo_format(repo):
            return jsonify({"bruh moment": "repo must look like owner/repo"}), 400

        if not github_token:
            return jsonify({"bruh moment": "missing `github_token`"}), 400

        if issue_number is None:
            return jsonify({"bruh moment": "missing `issue_number`"}), 400

        try:
            issue_number = int(issue_number)
        except (TypeError, ValueError):
            return jsonify({"bruh moment": "`issue_number` must be an integer"}), 400

        if target_column not in COLUMN_NAMES:
            return (
                jsonify({"bruh moment": f"invalid target column `{target_column}`"}),
                400,
            )

        current_issue = get_issue(repo, issue_number, github_token)
        payload = compute_updated_issue_fields(current_issue, target_column)
        updated_issue = patch_issue(repo, issue_number, github_token, payload)

        return jsonify(
            {
                "success": True,
                "repo": repo,
                "issue_number": issue_number,
                "target_column": target_column,
                "updated": {
                    "number": updated_issue.get("number"),
                    "title": updated_issue.get("title"),
                    "state": updated_issue.get("state"),
                    "labels": [
                        label["name"] for label in updated_issue.get("labels", [])
                    ],
                    "html_url": updated_issue.get("html_url"),
                },
            }
        )

    except ValueError as e:
        return jsonify({"bruh moment": str(e)}), 400
    except Exception as e:
        return jsonify({"bruh moment": str(e)}), 500


@app.route("/refresh-board", methods=["POST"])
def refresh_board():
    """
    Optional convenience endpoint:
    frontend can call this after several moves instead of rebuilding state manually.
    """
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({"bruh moment": "Missing JSON body!"}), 400

        repo = data.get("repo")
        github_token = data.get("github_token")

        if not repo or not is_valid_repo_format(repo):
            return jsonify({"bruh moment": "repo must look like owner/repo"}), 400

        if not github_token:
            return jsonify({"bruh moment": "Missing `github_token`"}), 400

        issues = fetch_github_issues(repo, github_token)
        board = generate_board_from_issues(issues)

        return jsonify(
            {
                "repo": repo,
                "issue_count": len(issues),
                "board": board,
            }
        )

    except Exception as e:
        return jsonify({"bruh moment": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
