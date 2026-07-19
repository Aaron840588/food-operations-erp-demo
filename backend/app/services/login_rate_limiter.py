"""Small process-local login abuse guard.

Vercel may run multiple backend instances, so this is a per-instance safety net. It
still prevents rapid guessing against any warm instance without adding another
production datastore dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic


@dataclass
class _AttemptWindow:
    failures: int
    started_at: float
    locked_until: float = 0.0


class LoginRateLimiter:
    def __init__(self, max_failures: int, window_seconds: int, lock_seconds: int):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.lock_seconds = lock_seconds
        self._attempts: dict[str, _AttemptWindow] = {}
        self._lock = Lock()

    def retry_after(self, key: str, now: float | None = None) -> int:
        current = monotonic() if now is None else now
        with self._lock:
            window = self._attempts.get(key)
            if not window:
                return 0
            if window.locked_until > current:
                return max(1, int(window.locked_until - current) + 1)
            if current - window.started_at >= self.window_seconds:
                self._attempts.pop(key, None)
            return 0

    def record_failure(self, key: str, now: float | None = None) -> int:
        current = monotonic() if now is None else now
        with self._lock:
            window = self._attempts.get(key)
            if not window or current - window.started_at >= self.window_seconds:
                window = _AttemptWindow(failures=0, started_at=current)
                self._attempts[key] = window
            window.failures += 1
            if window.failures >= self.max_failures:
                window.locked_until = current + self.lock_seconds
                return self.lock_seconds
            return 0

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._attempts.clear()


username_limiter = LoginRateLimiter(max_failures=8, window_seconds=15 * 60, lock_seconds=15 * 60)
client_limiter = LoginRateLimiter(max_failures=30, window_seconds=15 * 60, lock_seconds=15 * 60)
