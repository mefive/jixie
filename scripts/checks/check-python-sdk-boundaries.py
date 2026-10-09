from __future__ import annotations

import ast
import sys
from pathlib import Path


def inspect_sdk_dependencies(source: str, module: str) -> list[tuple[int, str]]:
    """Inspect import ownership without importing or executing SDK code."""
    tree = ast.parse(source)
    compile(tree, module, "exec", dont_inherit=True)
    package = module.split(".")[:-1]
    issues: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parents = package[:len(package) - node.level + 1]
                names = [".".join([*parents, node.module or ""])]
            else:
                names = [node.module or ""]
        elif isinstance(node, ast.Call) and (
            isinstance(node.func, ast.Name) and node.func.id == "__import__"
            or isinstance(node.func, ast.Attribute) and node.func.attr == "import_module"
        ):
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                names = [node.args[0].value]
            else:
                issues.append((node.lineno, "<dynamic import>"))
        for name in names:
            parts = name.split(".")
            if parts[0] in {"factor", "strategy", "research", "backtesting", "infra", "jobs"}:
                if parts[:2] != [package[0], "sdk"]:
                    issues.append((node.lineno, name))
            elif "runtime" in parts or "sandboxd" in parts:
                issues.append((node.lineno, name))
    return issues


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
    source_root = root / "apps/api/src"
    files = sorted(path for business in ("factor", "strategy", "research")
                   for path in (source_root / business / "sdk").rglob("*.py"))
    issues: list[str] = []
    for path in files:
        module = ".".join(path.relative_to(source_root).with_suffix("").parts)
        for line, target in inspect_sdk_dependencies(path.read_text(), module):
            issues.append(f"{path.relative_to(root)}:{line}: SDK depends on {target}")
    for issue in issues:
        print(issue)
    print(f"Python SDK boundaries: {len(files)} files, {len(issues)} violations")
    raise SystemExit(bool(issues))


if __name__ == "__main__":
    main()
