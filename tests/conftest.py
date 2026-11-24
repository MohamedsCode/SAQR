import os
import tempfile
from pathlib import Path

_db = Path(tempfile.mkdtemp(prefix="saqr-test-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db.as_posix()}"
os.environ["NETWORK_ENABLED"] = "false"
os.environ["SEED_FIXTURES"] = "true"
os.environ["BROWSER_ENABLED"] = "false"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["LLM_MODEL"] = ""
