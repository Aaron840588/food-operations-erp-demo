"""Commit-neutral validated mutations for shared master-data workflows."""

from __future__ import annotations

import re
from typing import Iterable, Mapping

from .. import models, schemas


_HTML_TAG_RE = re.compile(r"<.*?>")

PRODUCT_MUTABLE_FIELDS = frozenset(schemas.ProductSKUUpdate.model_fields)
SHEET_SYNC_PRODUCT_FIELDS = frozenset(
    {
        "product_name",
        "size",
        "category",
        "pack_qty",
        "retail_price",
        "reseller_price",
    }
)


class MasterDataValidationError(ValueError):
    pass


def sanitize_master_text(value: str) -> str:
    return _HTML_TAG_RE.sub("", value).strip()


def apply_product_updates(
    product: models.ProductSKU,
    changes: Mapping[str, object],
    *,
    permitted_fields: Iterable[str] = PRODUCT_MUTABLE_FIELDS,
) -> dict[str, object]:
    """Validate and apply a product patch without flushing or committing.

    The caller owns the surrounding transaction and any stock-ledger or cache
    side effects. Keeping this function commit-neutral lets owner UI edits and
    accepted Sheet changes use the same validation boundary atomically.
    """

    permitted = frozenset(permitted_fields)
    unknown = set(changes) - permitted
    if unknown:
        raise MasterDataValidationError(
            "Product field is not approved for this mutation: " + ", ".join(sorted(unknown))
        )

    try:
        validated = schemas.ProductSKUUpdate(**dict(changes)).model_dump(exclude_unset=True)
    except Exception as exc:
        raise MasterDataValidationError("Product update failed validation") from exc

    for field, value in validated.items():
        if isinstance(value, str):
            value = sanitize_master_text(value)
            if field in {"product_name", "category", "size"} and not value:
                raise MasterDataValidationError(f"{field} cannot be blank")
        setattr(product, field, value)
    return validated
