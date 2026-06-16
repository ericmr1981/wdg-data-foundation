"""
conftest.py — pytest 全局配置

让 `from scripts.xxx import ...` 这种 import 不用每个测试文件重复 sys.path.insert。
项目惯例 (见 tests/test_classify.py)。
"""
import sys
from pathlib import Path

# 把项目根 (含 scripts/) 加进 sys.path, 这样 from scripts.xxx import 才找得到
_PROJECT_ROOT = Path(__file__).parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
