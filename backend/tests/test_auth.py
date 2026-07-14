import unittest
from datetime import timedelta

from app import auth
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

    def test_sensitive_market_event_routes_require_authentication(self):
        protected_routes = {
            ("DELETE", "/market-events/{event_id}"),
            ("GET", "/market-events/{event_id}/sales"),
            ("DELETE", "/market-events/{event_id}/sales/{sale_id}/undo"),
        }
        route_dependencies = {
            (method, route.path): {dependency.call for dependency in route.dependant.dependencies}
            for route in market_events.router.routes
            for method in route.methods
        }

        for route_key in protected_routes:
            self.assertIn(route_key, route_dependencies)
            self.assertIn(auth.get_current_user, route_dependencies[route_key])


if __name__ == "__main__":
    unittest.main()
