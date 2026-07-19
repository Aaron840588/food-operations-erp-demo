import base64
import unittest
from datetime import datetime
from io import BytesIO
from unittest.mock import patch

from fastapi import HTTPException, Request, Response
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, main, models, schemas
from app.database import Base, get_db
from app.services.login_rate_limiter import LoginRateLimiter
from app.services.login_rate_limiter import client_limiter, username_limiter
from app.services.database_login_rate_limiter import DatabaseLoginRateLimiter
from app.services.proof_images import InvalidProofImage, normalize_proof_image


class LoginRateLimiterTests(unittest.TestCase):
    def tearDown(self):
        client_limiter.reset()
        username_limiter.reset()

    def test_locks_after_failure_limit_and_recovers_after_lock(self):
        limiter = LoginRateLimiter(max_failures=2, window_seconds=60, lock_seconds=30)
        self.assertEqual(limiter.record_failure("user", now=10), 0)
        self.assertEqual(limiter.record_failure("user", now=11), 30)
        self.assertGreater(limiter.retry_after("user", now=12), 0)
        self.assertEqual(limiter.retry_after("user", now=42), 0)

    def test_success_clear_removes_username_failures(self):
        limiter = LoginRateLimiter(max_failures=2, window_seconds=60, lock_seconds=30)
        limiter.record_failure("user", now=10)
        limiter.clear("user")
        self.assertEqual(limiter.retry_after("user", now=11), 0)

    @patch("time.sleep", return_value=None)
    def test_login_endpoint_returns_429_after_repeated_failures(self, _sleep):
        class MissingUserQuery:
            def filter(self, *_args):
                return self

            def first(self):
                return None

        class FakeDb:
            def query(self, *_args):
                return MissingUserQuery()

        request = Request({"type": "http", "client": ("127.0.0.1", 12345), "headers": []})
        payload = schemas.LoginRequest(username="rate-limited-user", password="wrong")
        with patch.object(main.db_username_limiter, "retry_after", return_value=0), \
             patch.object(main.db_client_limiter, "retry_after", return_value=0), \
             patch.object(main.db_username_limiter, "record_failure", return_value=0), \
             patch.object(main.db_client_limiter, "record_failure", return_value=0):
            for _ in range(8):
                with self.assertRaises(HTTPException) as failure:
                    main.login(payload, request, Response(), FakeDb())
                self.assertEqual(failure.exception.status_code, 401)
            with self.assertRaises(HTTPException) as locked:
                main.login(payload, request, Response(), FakeDb())
        self.assertEqual(locked.exception.status_code, 429)
        self.assertIn("Retry-After", locked.exception.headers)


class DatabaseLoginRateLimiterTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_separate_instances_share_hashed_failure_state(self):
        first = DatabaseLoginRateLimiter("username", max_failures=2, window_seconds=60, lock_seconds=30)
        second = DatabaseLoginRateLimiter("username", max_failures=2, window_seconds=60, lock_seconds=30)
        with self.session_factory() as db:
            self.assertEqual(first.record_failure(db, "private-user", now=datetime(2026, 7, 18, 8, 0, 0)), 0)
            self.assertEqual(first.record_failure(db, "private-user", now=datetime(2026, 7, 18, 8, 0, 1)), 30)
        with self.session_factory() as db:
            self.assertGreater(second.retry_after(db, "private-user", now=datetime(2026, 7, 18, 8, 0, 2)), 0)
            stored = db.query(models.LoginRateLimit).one()
            self.assertNotIn("private-user", stored.identifier_hash)


class ProofImageTests(unittest.TestCase):
    def _data_url(self, image_format: str = "PNG", size: tuple[int, int] = (24, 24)) -> str:
        output = BytesIO()
        Image.new("RGBA", size, (255, 0, 0, 128)).save(output, format=image_format)
        mime = "image/png" if image_format == "PNG" else "image/jpeg"
        return f"data:{mime};base64,{base64.b64encode(output.getvalue()).decode('ascii')}"

    def test_valid_image_is_resized_and_canonicalized_without_metadata(self):
        original_pixel_limit = Image.MAX_IMAGE_PIXELS
        normalized, mime = normalize_proof_image(self._data_url(size=(2400, 1200)), "image/png")
        self.assertEqual(mime, "image/jpeg")
        self.assertEqual(Image.MAX_IMAGE_PIXELS, original_pixel_limit)
        raw = base64.b64decode(normalized.split(",", 1)[1])
        with Image.open(BytesIO(raw)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertLessEqual(max(image.size), 1600)

    def test_rejects_mime_spoofing(self):
        spoofed = self._data_url().replace("data:image/png", "data:image/jpeg")
        with self.assertRaises(InvalidProofImage):
            normalize_proof_image(spoofed, "image/jpeg")

    def test_rejects_non_image_payload(self):
        payload = base64.b64encode(b"not an image").decode("ascii")
        with self.assertRaises(InvalidProofImage):
            normalize_proof_image(f"data:image/png;base64,{payload}", "image/png")


class TimesheetSecurityIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.current_user = models.User(id=1, username="staff-one", role="staff", is_active=True)
        with self.session_factory() as db:
            db.add_all([
                models.User(id=1, username="staff-one", hashed_password="unused", role="staff", is_active=True),
                models.User(id=2, username="staff-two", hashed_password="unused", role="staff", is_active=True),
            ])
            db.commit()

        def override_db():
            with self.session_factory() as db:
                yield db

        main.app.dependency_overrides[get_db] = override_db
        main.app.dependency_overrides[auth.get_current_user] = lambda: self.current_user
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        self.client.close()
        self.engine.dispose()

    @staticmethod
    def _proof_data_url() -> str:
        output = BytesIO()
        Image.new("RGB", (32, 32), "green").save(output, format="PNG")
        return f"data:image/png;base64,{base64.b64encode(output.getvalue()).decode('ascii')}"

    def test_manual_entry_uses_authenticated_identity_and_canonical_image(self):
        response = self.client.post("/timesheets/manual", json={
            "client_reference": "manual-test-valid-1",
            "work_date": "2026-07-18",
            "clock_in": "2026-07-18T08:00:00",
            "clock_out": "2026-07-18T17:00:00",
            "proof_image_data": self._proof_data_url(),
            "proof_image_type": "image/png",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["employee_name"], "staff-one")
        self.assertTrue(response.json()["has_proof"])
        self.assertNotIn("proof_image_data", response.json())
        with self.session_factory() as db:
            self.assertEqual(db.query(models.TimesheetEntry).count(), 1)

    def test_invalid_image_does_not_create_partial_entry(self):
        response = self.client.post("/timesheets/manual", json={
            "client_reference": "manual-test-invalid-1",
            "work_date": "2026-07-18",
            "clock_in": "2026-07-18T08:00:00",
            "proof_image_data": "data:image/png;base64," + base64.b64encode(b"not-image").decode("ascii"),
            "proof_image_type": "image/png",
        })
        self.assertEqual(response.status_code, 400)
        with self.session_factory() as db:
            self.assertEqual(db.query(models.TimesheetEntry).count(), 0)

    def test_repeated_manual_submission_returns_original_entry_once(self):
        payload = {
            "client_reference": "manual-test-duplicate-1",
            "work_date": "2026-07-18",
            "clock_in": "2026-07-18T08:00:00",
            "proof_image_data": self._proof_data_url(),
            "proof_image_type": "image/png",
        }
        first = self.client.post("/timesheets/manual", json=payload)
        second = self.client.post("/timesheets/manual", json=payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["id"], second.json()["id"])
        with self.session_factory() as db:
            self.assertEqual(db.query(models.TimesheetEntry).count(), 1)

    def test_staff_list_is_scoped_and_owner_routes_reject_staff(self):
        with self.session_factory() as db:
            db.add_all([
                models.TimesheetEntry(employee_user_id=1, employee_name="staff-one", work_date="2026-07-18", source="manual", review_status="Pending"),
                models.TimesheetEntry(employee_user_id=2, employee_name="staff-two", work_date="2026-07-18", source="manual", review_status="Pending"),
            ])
            db.commit()
        response = self.client.get("/timesheets")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual([entry["employee_name"] for entry in response.json()["items"]], ["staff-one"])
        self.assertEqual(self.client.post("/timesheets/import", json={"rows": [{"values": {"ID": "1", "Date": "2026-07-18", "Time": "08:00"}}]}).status_code, 403)
        self.assertEqual(self.client.patch("/timesheets/1/review", json={"review_status": "Approved"}).status_code, 403)

    def test_proof_requires_record_ownership_and_is_not_in_ledger(self):
        with self.session_factory() as db:
            own = models.TimesheetEntry(
                employee_user_id=1,
                employee_name="staff-one",
                work_date="2026-07-18",
                source="manual",
                review_status="Pending",
                proof_image_data=self._proof_data_url(),
                proof_image_type="image/png",
            )
            other = models.TimesheetEntry(
                employee_user_id=2,
                employee_name="staff-two",
                work_date="2026-07-18",
                source="manual",
                review_status="Pending",
                proof_image_data=self._proof_data_url(),
                proof_image_type="image/png",
            )
            db.add_all([own, other])
            db.commit()
            own_id, other_id = own.id, other.id
        ledger = self.client.get("/timesheets").json()
        self.assertNotIn("proof_image_data", ledger["items"][0])
        proof = self.client.get(f"/timesheets/{own_id}/proof")
        self.assertEqual(proof.status_code, 200)
        self.assertEqual(proof.headers["cache-control"], "private, no-store")
        self.assertEqual(self.client.get(f"/timesheets/{other_id}/proof").status_code, 404)
        owner = models.User(id=3, username="owner", role="owner", is_active=True)
        main.app.dependency_overrides[auth.get_current_user] = lambda: owner
        self.assertEqual(self.client.get(f"/timesheets/{other_id}/proof").status_code, 200)

    def test_manual_work_date_must_match_clock_in(self):
        response = self.client.post("/timesheets/manual", json={
            "client_reference": "manual-date-mismatch-1",
            "work_date": "2026-07-18",
            "clock_in": "2026-07-19T08:00:00",
            "proof_image_data": self._proof_data_url(),
            "proof_image_type": "image/png",
        })
        self.assertEqual(response.status_code, 400)
        with self.session_factory() as db:
            self.assertEqual(db.query(models.TimesheetEntry).count(), 0)

    def test_import_rejects_ambiguous_rows_without_partial_writes(self):
        owner = models.User(id=3, username="owner", role="owner", is_active=True)
        main.app.dependency_overrides[auth.get_current_user] = lambda: owner
        main.app.dependency_overrides[auth.require_owner] = lambda: owner
        response = self.client.post("/timesheets/import", json={"rows": [
            {"values": {"ID": "1", "Date": "2026-07-18", "Time": "08:00"}},
            {"values": {"ID": "2", "Date": "07/08/2026", "Time": "09:00"}},
        ]})
        self.assertEqual(response.status_code, 400)
        with self.session_factory() as db:
            self.assertEqual(db.query(models.TimesheetEntry).count(), 0)

    def test_machine_import_is_idempotent_for_unambiguous_day_first_dates(self):
        owner = models.User(id=3, username="owner", role="owner", is_active=True)
        main.app.dependency_overrides[auth.get_current_user] = lambda: owner
        main.app.dependency_overrides[auth.require_owner] = lambda: owner
        payload = {"rows": [
            {"values": {"ID": "7", "Name": "staff-one", "Date": "18/07/2026", "Time": "08:00"}},
            {"values": {"ID": "7", "Name": "staff-one", "Date": "18/07/2026", "Time": "17:00"}},
        ]}
        first = self.client.post("/timesheets/import", json=payload)
        second = self.client.post("/timesheets/import", json=payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()[0]["id"], second.json()[0]["id"])
        with self.session_factory() as db:
            self.assertEqual(db.query(models.TimesheetEntry).count(), 1)

    def test_ledger_paginates_without_returning_proof_content(self):
        with self.session_factory() as db:
            for day in range(1, 4):
                db.add(models.TimesheetEntry(
                    employee_user_id=1,
                    employee_name="staff-one",
                    work_date=f"2026-07-0{day}",
                    source="manual",
                    review_status="Pending",
                    proof_image_data=self._proof_data_url(),
                    proof_image_type="image/png",
                ))
            db.commit()
        first = self.client.get("/timesheets?limit=2&offset=0").json()
        second = self.client.get("/timesheets?limit=2&offset=2").json()
        self.assertEqual(first["total"], 3)
        self.assertEqual(len(first["items"]), 2)
        self.assertEqual(len(second["items"]), 1)
        self.assertTrue(all("proof_image_data" not in entry for entry in first["items"] + second["items"]))


if __name__ == "__main__":
    unittest.main()
