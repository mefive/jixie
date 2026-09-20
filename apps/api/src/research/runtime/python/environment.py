from __future__ import annotations

import platform
import sys
from importlib.metadata import PackageNotFoundError, version
from typing import Any


def _optional_modules() -> dict[str, Any]:
    modules: dict[str, Any] = {"numpy": None, "pandas": None, "matplotlib": None}
    try:
        import numpy

        modules["numpy"] = numpy
    except ImportError:
        pass
    try:
        import pandas

        modules["pandas"] = pandas
    except ImportError:
        pass
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot

        modules["matplotlib"] = matplotlib.pyplot
    except ImportError:
        pass
    return modules


def _environment(modules: dict[str, Any]) -> dict[str, Any]:
    return {
        "runtime": "research-py-v1",
        "python": platform.python_version(),
        "numpy": _module_version(modules["numpy"]),
        "pandas": _module_version(modules["pandas"]),
        "matplotlib": _module_version(modules["matplotlib"]),
        "scipy": _package_version("scipy"),
        "statsmodels": _package_version("statsmodels"),
        "scikit-learn": _package_version("scikit-learn"),
    }


def _module_version(module: Any) -> str | None:
    if module is None:
        return None
    root = sys.modules.get(module.__name__.split(".", 1)[0], module)
    return str(getattr(root, "__version__", "unknown"))


def _package_version(distribution: str) -> str | None:
    try:
        return version(distribution)
    except PackageNotFoundError:
        return None
