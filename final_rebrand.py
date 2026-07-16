#!/usr/bin/env python3
"""Final rebrand cleanup - update remaining claude references"""
import re
from pathlib import Path

WORKSPACE = Path("/workspace")

def update_file(filepath):
    """Update remaining claude references"""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        original = content
        
        # Skip rebrand scripts themselves
        if 'rebrand' in str(filepath) or 'update_model' in str(filepath) or 'final_rebrand' in str(filepath):
            return False
        
        # Update command line argument names (claude-code-usage-report -> zc-code-usage-report)
        content = content.replace('--claude-code-usage-report', '--zc-code-usage-report')
        content = content.replace('claude_code_usage_report', 'zc_code_usage_report')
        
        # Update platform URLs 
        content = content.replace('platform.claude.com', 'platform.zaicoder.com')
        content = content.replace('claude.ai/cowork', 'zaicoder.ai/cowork')
        
        # Update .claude directory references
        content = re.sub(r'\.claude/', '.zc/', content)
        content = re.sub(r'`claude ', '`zc ', content)
        content = re.sub(r'like `claude -p`', 'like `zc -p`', content)
        content = re.sub(r'anthropics/claude-code/', 'zaicoder/zc-code/', content)
        
        # Update docstring/module references  
        content = content.replace('claude_*.py', 'zc_*.py')
        content = content.replace('test_claude_', 'test_zc_')
        
        # Model name updates for any missed ones
        content = content.replace('\"claude-haiku-4-5\"', '\"zc-haiku-4-5\"')
        content = content.replace('\"claude-haiku-4-5-20251001\"', '\"zc-haiku-4-5-20251001\"')
        
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"ERROR updating {filepath}: {e}")
        return False

def main():
    print("Final rebrand cleanup...")
    
    all_files = list(WORKSPACE.glob("**/*.py")) + list(WORKSPACE.glob("**/*.md"))
    updated = 0
    
    for f in all_files:
        if update_file(f):
            updated += 1
            print(f"  Updated: {f}")
    
    print(f"\nUpdated {updated} files")

if __name__ == "__main__":
    main()
