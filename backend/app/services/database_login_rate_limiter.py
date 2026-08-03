"""Database-backed login throttling shared by all serverless instances."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models


class DatabaseLoginRateLimiter:
    def __init__(self, scope: str, max_failures: int, window_seconds: int, lock_seconds: int):
        self.scope = scope
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.lock_seconds = lock_seconds

    @staticmethod
    def _hash(key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    def _query(self, db: Session, key: str):
        return db.query(models.LoginRateLimit).filter(
            models.LoginRateLimit.scope == self.scope,
            models.LoginRateLimit.identifier_hash == self._hash(key),
        )

    def retry_after(self, db: Session, key: str, now: datetime | None = None) -> int:
        current = now or datetime.utcnow()
        record = self._query(db, key).first()
        if not record or not record.locked_until or record.locked_until <= current:
            return 0
        return max(1, int((record.locked_until - current).total_seconds()) + 1)

    def record_failure(self, db: Session, key: str, now: datetime | None = None) -> int:
        current = now or datetime.utcnow()
        window_delta = timedelta(seconds=self.window_seconds)
        record = self._query(db, key).with_for_update().first()
        if record is None:
            record = models.LoginRateLimit(
                scope=self.scope,
                identifier_hash=self._hash(key),
                failures=0,
                window_started_at=current,
            )
            db.add(record)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                record = self._query(db, key).with_for_update().first()
                if record is None:
                    raise

        if current - record.window_started_at >= window_delta:
            record.failures = 0
            record.window_started_at = current
            record.locked_until = None
        record.failures += 1
        if record.failures >= self.max_failures:
            record.locked_until = current + timedelta(seconds=self.lock_seconds)
        db.commit()
        if record.locked_until and record.locked_until > current:
            return self.lock_seconds
        return 0

    def clear(self, db: Session, key: str) -> None:
        self._query(db, key).delete(synchronize_session=False)
        db.commit()


db_username_limiter = DatabaseLoginRateLimiter(
    scope="username", max_failures=8, window_seconds=15 * 60, lock_seconds=15 * 60
)
db_client_limiter = DatabaseLoginRateLimiter(
    scope="client", max_failures=30, window_seconds=15 * 60, lock_seconds=15 * 60
)
