import os
import json
from sqlalchemy.orm import Session
from pywebpush import webpush, WebPushException
from . import models

def trigger_push_notifications(title: str, body: str, db: Session):
    vapid_public = os.getenv("VAPID_PUBLIC_KEY")
    vapid_private = os.getenv("VAPID_PRIVATE_KEY")
    claim_email = os.getenv("VAPID_CLAIM_EMAIL")

    if not vapid_public or not vapid_private or not claim_email:
        print("Warning: VAPID keys or claim email not configured in environment. Skipping push alerts.")
        return

    # Replace escaped newlines if any
    vapid_private = vapid_private.replace("\\n", "\n")

    subs = db.query(models.PushSubscription).all()
    print(f"Attempting to dispatch push alert '{title}' to {len(subs)} registered subscribers...")

    for sub in subs:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {
                "p256dh": sub.p256dh,
                "auth": sub.auth
            }
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=json.dumps({"title": title, "body": body}),
                vapid_private_key=vapid_private,
                vapid_claims={"sub": claim_email}
            )
            print(f"  Successfully sent push to endpoint: {sub.endpoint[:40]}...")
        except WebPushException as ex:
            # Self-cleaning: if expired or gone (e.g. 404/410), delete subscription
            if ex.response is not None and ex.response.status_code in [404, 410]:
                print(f"  Push subscription expired (Status {ex.response.status_code}). Removing subscription id {sub.id}.")
                db.delete(sub)
                db.commit()
            else:
                print(f"  WebPushException sending to {sub.id}: {ex}")
        except Exception as e:
            print(f"  Unexpected error sending to subscription id {sub.id}: {e}")

def check_and_trigger_low_stock_alerts(raw_ingredient_ids: list, db: Session):
    for raw_id in raw_ingredient_ids:
        ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == raw_id).first()
        if ing and ing.available_stock <= ing.reorder_level:
            try:
                trigger_push_notifications(
                    title="Low Stock Alert",
                    body=f"{ing.name} has fallen to {ing.available_stock}{ing.unit} (Limit: {ing.reorder_level}{ing.unit}).",
                    db=db
                )
            except Exception as e:
                print(f"Error triggering low stock alert for {raw_id}: {e}")
