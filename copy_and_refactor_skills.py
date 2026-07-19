import os
import shutil
from pathlib import Path

TARGET_SKILLS_DIR = Path("/home/zeazdev/zc/.zc/skills")
TARGET_AGENTS_DIR = Path("/home/zeazdev/zc/.zc/agents")

TARGET_SKILLS_DIR.mkdir(parents=True, exist_ok=True)
TARGET_AGENTS_DIR.mkdir(parents=True, exist_ok=True)

# Sources
SKILL_SOURCES = [
    "/home/zeazdev/openclaw/skills",
    "/home/zeazdev/9router/skills",
    "/home/zeazdev/.config/poolside/skills",
    "/home/zeazdev/.config/devin/skills",
    "/home/zeazdev/.config/crush/skills",
    "/home/zeazdev/.config/goose/skills",
    "/home/zeazdev/.forge/skills",
    "/home/zeazdev/.moxby/skills",
    "/home/zeazdev/.iflow/skills",
    "/home/zeazdev/GPTxCODEX-CONFIG/.claude/skills",
    "/home/zeazdev/GPTxCODEX-CONFIG/.agents/skills",
    "/home/zeazdev/free-coding-models/.pi/skills",
    "/home/zeazdev/free-coding-models/.claude/skills"
]

AGENT_SOURCES = [
    "/home/zeazdev/openclaw/src/agents",
    "/home/zeazdev/openclaw/.agents",
    "/home/zeazdev/GPTxCODEX-CONFIG/.codex/agents",
    "/home/zeazdev/GPTxCODEX-CONFIG/.agents"
]

def refactor_file(file_path: Path):
    if not file_path.is_file() or file_path.is_symlink():
        return
    try:
        content = file_path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return  # skip binary files
    
    # Simple replacements
    replacements = {
        "openclaw": "zaicoder",
        "Openclaw": "zAICoder",
        "OpenClaw": "zAICoder",
        "Claude": "zAICoder",
        "claude": "zaicoder",
        "devin": "zaicoder",
        "Devin": "zAICoder",
        "poolside": "zaicoder",
        "Poolside": "zAICoder",
        "goose": "zaicoder",
        "Goose": "zAICoder",
        "crush": "zaicoder",
        "Crush": "zAICoder",
        "moxby": "zaicoder",
        "Moxby": "zAICoder",
        "iflow": "zaicoder",
        "iFlow": "zAICoder",
        "9router": "zaicoder",
        "pi": "zaicoder",
        "Pi": "zAICoder",
        "forge": "zaicoder",
        "Forge": "zAICoder"
    }
    
    new_content = content
    for old, new in replacements.items():
        new_content = new_content.replace(old, new)
        
    if new_content != content:
        file_path.write_text(new_content, encoding='utf-8')

def copy_and_refactor(src_dirs, target_dir):
    for src in src_dirs:
        src_path = Path(src)
        if not src_path.exists():
            continue
        for item in src_path.iterdir():
            if item.is_symlink():
                continue
            if item.is_dir() and item.name not in ["skills", "agents", ".git", "node_modules"]:
                dest = target_dir / item.name
                if not dest.exists():
                    shutil.copytree(item, dest)
                # Refactor contents
                for root, _dirs, files in os.walk(dest):
                    for f in files:
                        refactor_file(Path(root) / f)
            elif item.is_file():
                dest = target_dir / item.name
                if not dest.exists():
                    shutil.copy2(item, dest)
                refactor_file(dest)

copy_and_refactor(SKILL_SOURCES, TARGET_SKILLS_DIR)
copy_and_refactor(AGENT_SOURCES, TARGET_AGENTS_DIR)

print("Done copying and refactoring.")
