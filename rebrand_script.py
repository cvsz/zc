#!/usr/bin/env python3
"""
Rebrand Script: claude -> zc (ZaiCoder)
Renames all files and updates content references
"""
import os
import re
from pathlib import Path

WORKSPACE = Path("/workspace")

# Patterns for replacement
REPLACEMENTS = [
    # File/module name patterns
    (r'\bzc_code\b', 'zc_code'),
    (r'\bzc_files\b', 'zc_files'),
    (r'\bzc_models\b', 'zc_models'),
    (r'\bzc_metrics\b', 'zc_metrics'),
    (r'\bzc_tokens\b', 'zc_tokens'),
    (r'\bzc_cache\b', 'zc_cache'),
    (r'\bzc_sessions\b', 'zc_sessions'),
    (r'\bzc_git\b', 'zc_git'),
    (r'\bzc_search\b', 'zc_search'),
    (r'\bzc_eval\b', 'zc_eval'),
    (r'\bzc_workflow\b', 'zc_workflow'),
    (r'\bzc_router\b', 'zc_router'),
    (r'\bzc_batch\b', 'zc_batch'),
    (r'\bzc_tools\b', 'zc_tools'),
    (r'\bzc_skills\b', 'zc_skills'),
    (r'\bzc_memory\b', 'zc_memory'),
    (r'\bzc_rag\b', 'zc_rag'),
    (r'\bzc_agents\b', 'zc_agents'),
    (r'\bzc_admin\b', 'zc_admin'),
    (r'\bzc_advisor\b', 'zc_advisor'),
    (r'\bzc_observability\b', 'zc_observability'),
    (r'\bzc_embeddings\b', 'zc_embeddings'),
    (r'\bzc_sandbox\b', 'zc_sandbox'),
    (r'\bzc_vision\b', 'zc_vision'),
    (r'\bzc_chrome\b', 'zc_chrome'),
    (r'\bzc_powerpoint\b', 'zc_powerpoint'),
    (r'\bzc_pdf\b', 'zc_pdf'),
    (r'\bzc_excel\b', 'zc_excel'),
    (r'\bzc_word\b', 'zc_word'),
    (r'\bzc_stream\b', 'zc_stream'),
    (r'\bzc_settings\b', 'zc_settings'),
    (r'\bzc_research\b', 'zc_research'),
    (r'\bzc_interactive\b', 'zc_interactive'),
    (r'\bzc_prompt_optimizer\b', 'zc_prompt_optimizer'),
    (r'\bzc_structured\b', 'zc_structured'),
    (r'\bzc_citations\b', 'zc_citations'),
    (r'\bzc_plugins\b', 'zc_plugins'),
    (r'\bzc_cost_optimizer\b', 'zc_cost_optimizer'),
    (r'\bzc_fable5\b', 'zc_fable5'),
    (r'\bzc_mythos5\b', 'zc_mythos5'),
    (r'\bzc_live\b', 'zc_live'),
    (r'\bzc_wif\b', 'zc_wif'),
    (r'\bzc_thinking\b', 'zc_thinking'),
    (r'\bzc_output_styles\b', 'zc_output_styles'),
    (r'\bzc_github\b', 'zc_github'),
    (r'\bzc_hooks_perms_plan\b', 'zc_hooks_perms_plan'),
    (r'\bzc_code_exec\b', 'zc_code_exec'),
    (r'\bzc_compliance_api\b', 'zc_compliance_api'),
    (r'\bzc_skills_api\b', 'zc_skills_api'),
    (r'\bzc_evals\b', 'zc_evals'),
    
    # General pattern - any remaining claude_ becomes zc_
    (r'\bclaude_(\w+)\b', r'zc_\1'),
]

def rename_file(filepath):
    """Rename a single file from claude_* to zc_*"""
    parent = filepath.parent
    new_name = filepath.name.replace('claude_', 'zc_')
    new_path = parent / new_name
    
    if new_path.exists():
        print(f"  SKIP: {new_path} already exists")
        return None
    
    try:
        filepath.rename(new_path)
        print(f"  RENAMED: {filepath} -> {new_path}")
        return new_path
    except Exception as e:
        print(f"  ERROR: {filepath}: {e}")
        return None

def update_content(filepath):
    """Update file content to replace claude references with zc"""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        original = content
        
        # Replace module imports
        content = re.sub(r'from\s+claude_(\w+)', r'from zc_\1', content)
        content = re.sub(r'import\s+claude_(\w+)', r'import zc_\1', content)
        
        # Replace string references in comments and docstrings
        content = re.sub(r'claude_(\w+)', r'zc_\1', content)
        
        # Replace model names (keep Anthropic model names but update CLI references)
        # Note: We keep actual API model names like "zc-sonnet-5" as they are API identifiers
        
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"  ERROR updating {filepath}: {e}")
        return False

def main():
    print("=" * 70)
    print("REBRAND: claude -> zc (ZaiCoder)")
    print("=" * 70)
    
    # Find all claude_* files
    zc_files = list(WORKSPACE.glob("**/claude_*.py"))
    zc_files += list(WORKSPACE.glob("**/test_claude_*.py"))
    
    print(f"\nFound {len(zc_files)} files to rename")
    
    renamed = []
    for f in zc_files:
        new_path = rename_file(f)
        if new_path:
            renamed.append(new_path)
    
    print(f"\nRenamed {len(renamed)} files")
    print("\nNow updating content references...")
    
    # Update all Python files
    all_py_files = list(WORKSPACE.glob("**/*.py"))
    updated_count = 0
    for f in all_py_files:
        if update_content(f):
            updated_count += 1
    
    print(f"Updated content in {updated_count} files")
    print("\nRebrand complete!")

if __name__ == "__main__":
    main()
