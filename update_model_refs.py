#!/usr/bin/env python3
"""Update Anthropic model name references to use zc- prefix for CLI defaults"""
import re
from pathlib import Path

WORKSPACE = Path("/workspace")

# Model name mappings - keep API compatibility but update CLI defaults
MODEL_MAP = {
    'zc-sonnet-5': 'zc-sonnet-5',
    'zc-opus-4-8': 'zc-opus-4-8', 
    'zc-fable-5': 'zc-fable-5',
    'zc-opus-4': 'zc-opus-4',
}

def update_file(filepath):
    """Update model references in a file"""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        original = content
        
        # Replace model names in defaults and help text
        for old, new in MODEL_MAP.items():
            # Replace in string literals (defaults, help text)
            content = content.replace(old, new)
        
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"ERROR updating {filepath}: {e}")
        return False

def main():
    print("Updating model name references...")
    
    all_files = list(WORKSPACE.glob("**/*.py")) + list(WORKSPACE.glob("**/*.md"))
    updated = 0
    
    for f in all_files:
        if update_file(f):
            updated += 1
    
    print(f"Updated {updated} files")

if __name__ == "__main__":
    main()
