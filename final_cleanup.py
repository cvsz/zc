#!/usr/bin/env python3
"""Final cleanup - handle remaining specific claude references"""
import re
from pathlib import Path

WORKSPACE = Path("/workspace")

def update_file(filepath):
    """Update remaining claude references"""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        original = content
        
        # Skip rebrand scripts
        if any(x in str(filepath) for x in ['rebrand', 'update_model', 'deep_rebrand', 'final_cleanup']):
            return False
        
        # Specific replacements for remaining items
        replacements = [
            ('about-claude/', 'about-zc/'),
            ('claude-haiku-4-5-20251001', 'zc-haiku-4-5-20251001'),
            ('claude-sonnet-4-5', 'zc-sonnet-4-5'),
            ('claude-sonnet-4-2', 'zc-sonnet-4-2'),
            ('claude-sonnet-4-0', 'zc-sonnet-4-0'),
            ('claude-sonnet-4-20250514', 'zc-sonnet-4-20250514'),
            ('.claude-plugin/', '.zc-plugin/'),
            ('.claude-plugin`', '.zc-plugin`'),
        ]
        
        for old, new in replacements:
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
    print("Final cleanup...")
    
    all_files = list(WORKSPACE.glob("**/*.py")) + list(WORKSPACE.glob("**/*.md"))
    updated = 0
    
    for f in all_files:
        if update_file(f):
            updated += 1
    
    print(f"Updated {updated} files")

if __name__ == "__main__":
    main()
