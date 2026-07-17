import os
import glob
import re

files = glob.glob("src/wire/**/*.py", recursive=True) + glob.glob("app/**/*.py", recursive=True)
count = 0

for file in files:
    with open(file, "r") as f:
        content = f.read()

    # We want to replace:
    # anthropic.Anthropic(api_key=api_key)
    # _anthropic.Anthropic(api_key=api_key)
    # anthropic.Anthropic()
    
    if "Anthropic(" in content and "api_key" in content:
        # A simple replacement won't be enough if api_key is named differently.
        # Let's see all matches in the project first.
        pass

