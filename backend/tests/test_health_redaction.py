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

class PublicErrorBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_server_error_hides_exception_details(self):
        from app.main import public_http_error
        from starlette.requests import Request
        request = Request({"type": "http", "method": "GET", "path": "/test", "headers": [], "query_string": b""})
        response = await public_http_error(request, HTTPException(500, "private SQL with credential material"))
        self.assertEqual(response.status_code, 500)
        self.assertNotIn(b"private SQL", response.body)
        self.assertIn(b"Service temporarily unavailable", response.body)

    async def test_client_errors_keep_actionable_validation(self):
        from app.main import public_http_error
        from starlette.requests import Request
        request = Request({"type": "http", "method": "GET", "path": "/test", "headers": [], "query_string": b""})
        response = await public_http_error(request, HTTPException(401, "Authentication required"))
        self.assertEqual(response.status_code, 401)
        self.assertIn(b"Authentication required", response.body)

class PublicResponseHeadersTests(unittest.TestCase):
    def test_untrusted_origin_cannot_read_authenticated_responses(self):
        from app import main
        from app.database import get_db
        from fastapi.testclient import TestClient
        main.app.dependency_overrides[get_db] = lambda: Mock()
        try:
            with TestClient(main.app) as client:
                response = client.get("/users/", headers={"Origin": "https://untrusted.invalid"})
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("access-control-allow-origin", response.headers)
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        finally:
            main.app.dependency_overrides.clear()
