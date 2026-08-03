import unittest
from datetime import timedelta
from unittest.mock import MagicMock

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth
from app import models
from app.routers import market_events


class AuthenticationTests(unittest.TestCase):
    def test_password_hash_round_trip(self):
        password = "test-only-passcode"
        hashed = auth.get_password_hash(password)

        self.assertNotEqual(password, hashed)
        self.assertTrue(auth.verify_password(password, hashed))
        self.assertFalse(auth.verify_password("incorrect-passcode", hashed))

    def test_access_token_round_trip(self):
        token = auth.create_access_token(
            {"sub": "test-user", "id": 1, "role": "owner"},
            expires_delta=timedelta(minutes=1),
        )

        payload = auth.decode_access_token(token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["sub"], "test-user")
        self.assertEqual(payload["role"], "owner")

    def test_existing_access_token_uses_current_database_role(self):
        token = auth.create_access_token(
            {"sub": "role-change-user", "id": 41, "role": "owner"},
            expires_delta=timedelta(minutes=5),
        )
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        database_user = models.User(
            id=41,
            username="role-change-user",
            hashed_password="unused-test-hash",
            role="owner",
            is_active=True,
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = database_user

        self.assertEqual(auth.get_current_user(credentials=credentials, db=db).role, "owner")

        database_user.role = "staff"
        current_user = auth.get_current_user(credentials=credentials, db=db)

        self.assertEqual(current_user.role, "staff")
        self.assertNotEqual(current_user.role, auth.decode_access_token(token)["role"])
        self.assertEqual(db.query.call_count, 2)

    def test_existing_access_token_rejects_deactivated_database_user(self):
        token = auth.create_access_token(
            {"sub": "deactivated-user", "id": 42, "role": "staff"},
            expires_delta=timedelta(minutes=5),
        )
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        database_user = models.User(
            id=42,
            username="deactivated-user",
            hashed_password="unused-test-hash",
            role="staff",
            is_active=True,
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = database_user

        self.assertEqual(auth.get_current_user(credentials=credentials, db=db).username, "deactivated-user")

        database_user.is_active = False
        with self.assertRaises(HTTPException) as raised:
            auth.get_current_user(credentials=credentials, db=db)

        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(raised.exception.detail, "User account is inactive or not found.")

    def test_sensitive_market_event_routes_require_authentication(self):
        protected_routes = {
            ("DELETE", "/market-events/{event_id}"),
            ("GET", "/market-events/{event_id}/sales"),
            ("DELETE", "/market-events/{event_id}/sales/{sale_id}/undo"),
        }

        def collect_dependency_calls(dependencies):
            calls = set()
            for dependency in dependencies:
                calls.add(dependency.call)
                calls.update(collect_dependency_calls(dependency.dependencies))
            return calls

        route_dependencies = {
            (method, route.path): collect_dependency_calls(route.dependant.dependencies)
            for route in market_events.router.routes
            for method in route.methods
        }

        for route_key in protected_routes:
            self.assertIn(route_key, route_dependencies)
            self.assertIn(auth.get_current_user, route_dependencies[route_key])


if __name__ == "__main__":
    unittest.main()
