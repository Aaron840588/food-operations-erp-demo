import unittest
from unittest.mock import Mock
from fastapi import HTTPException
from app.main import health_check

class HealthRedactionTests(unittest.TestCase):
    def test_unavailable_database_does_not_disclose_connection_details(self):
        db = Mock()
        db.execute.side_effect = RuntimeError("postgres://private-user:private-password@internal-host")
        with self.assertRaises(HTTPException) as raised:
            health_check(db)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "Database service temporarily unavailable.")

    def test_healthy_database_reports_online(self):
        self.assertEqual(health_check(Mock())["database"], "online")
