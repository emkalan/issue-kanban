import requests
import os 

pip install google-generativeai

from google.generativeai import GenerativeModel  
from dotenv import load_dotenv

#GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
### boilerplate, setup envs lator!
#repo = 'owner/repo'

gh_response = requests.get(
    f'https://api.github.com/repos/{repo}/issues',
    headers={'Authorization': f'token {GITHUB_TOKEN}'} #lowk copyd schema from google
).json()

model = GenerativeModel('gemini-2.5-flash', api_key=GEMINI_API_KEY)
prompt = f"Convert this GitHub issues data to Kanban JSON: {gh_response}. Schema: {{'columns': [{{'name': 'To Do', 'cards': [...]}}, ...]}}"
gemini_response = model.generate_content(prompt)
kanban_json = gemini_response.text  

print(kanban_json)  
