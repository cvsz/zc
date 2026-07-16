#!/usr/bin/env python3
"""Deep rebrand - comprehensive cleanup of all claude references"""
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
        if any(x in str(filepath) for x in ['rebrand', 'update_model', 'deep_rebrand']):
            return False
        
        # Comprehensive replacements
        replacements = [
            # URLs and domains
            ('platform.claude.com', 'platform.zaicoder.com'),
            ('docs.claude.com', 'docs.zaicoder.com'),
            ('claude.ai', 'zaicoder.ai'),
            
            # Command line args
            ('--claude-code-usage-report', '--zc-code-usage-report'),
            ('claude_code_usage_report', 'zc_code_usage_report'),
            
            # Directories and files
            ('.claude/', '.zc/'),
            ('.claude`', '.zc`'),
            ('claude_*.py', 'zc_*.py'),
            ('test_claude_', 'test_zc_'),
            
            # CLI references
            ('`claude ', '`zc '),
            ('like `claude -p`', 'like `zc -p`'),
            ('claude›', 'zc›'),
            ('claude\\u203a', 'zc\\u203a'),
            
            # Paths
            ('anthropics/claude-code/', 'zaicoder/zc-code/'),
            ('Claude Code', 'ZaiCoder Code'),
            ('Claude Cowork', 'ZaiCoder Cowork'),
            
            # Model names (any remaining)
            ('"claude-', '"zc-'),
            ("'claude-", "'zc-"),
            ('claude-sonnet-4-6', 'zc-sonnet-4-6'),
            ('claude-mythos-5', 'zc-mythos-5'),
            
            # Comments and docstrings
            ('per platform.claude.com', 'per platform.zaicoder.com'),
            ('Per platform.claude.com', 'Per platform.zaicoder.com'),
            ('(platform.claude.com', '(platform.zaicoder.com'),
            ('checked 2026', 'checked 2026'),  # Keep dates
        ]
        
        for old, new in replacements:
            content = content.replace(old, new)
        
        # Regex patterns
        patterns = [
            (r'build-with-claude', 'build-with-zc'),
            (r'manage-claude', 'manage-zc'),
            (r'claude\.com/docs', 'zaicoder.com/docs'),
        ]
        
        for pattern, replacement in patterns:
            content = re.sub(pattern, replacement, content)
        
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"ERROR updating {filepath}: {e}")
        return False

def main():
    print("Deep rebrand cleanup...")
    
    all_files = list(WORKSPACE.glob("**/*.py")) + list(WORKSPACE.glob("**/*.md"))
    updated = 0
    
    for f in all_files:
        if update_file(f):
            updated += 1
    
    print(f"Updated {updated} files")

if __name__ == "__main__":
    main()
