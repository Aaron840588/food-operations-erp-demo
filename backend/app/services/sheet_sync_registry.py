"""Immutable allowlist for the first controlled Google Sheets rollout.

The frontend and API callers must select a ``source_key`` from this registry.
They never provide a spreadsheet ID, tab name, range, or destination field.
Keeping those values in code makes a database mapping configuration incapable
of expanding Google or ORM access without a reviewed deployment.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from types import MappingProxyType
from typing import Mapping, Tuple


FOOD_TRACKERS_SPREADSHEET_ID = "14Ha7QnZ14VcigXaO1popUmSgsBNTVQ92P-4lb569INg"
PRODUCTION_INVENTORY_SPREADSHEET_ID = "11r5JTvYFL4Ud_xtOk0wzghEcrYBnOVNZ2aQeIUi0GsA"
PARTNER_INVENTORY_SPREADSHEET_ID = "1cwxsw5sm00eSyMvaCAeLyJ2RZ5prSGNtsCFpdBH1qi4"

# These files were audited and may be listed in server configuration. Only
# ranges represented by V1_SOURCES below can actually be read.
AUDITED_SPREADSHEET_IDS = frozenset(
    {
        FOOD_TRACKERS_SPREADSHEET_ID,
        PRODUCTION_INVENTORY_SPREADSHEET_ID,
        PARTNER_INVENTORY_SPREADSHEET_ID,
    }
)


@dataclass(frozen=True)
class SheetFieldMapping:
    source_header: str
    destination_entity: str
    destination_field: str
    expected_type: str
    risk_level: str
    approval_mode: str = "manual_review"
    auto_apply_eligible: bool = False
    required: bool = False

    @property
    def destination_key(self) -> str:
        return f"{self.destination_entity}.{self.destination_field}"


@dataclass(frozen=True)
class SheetSourceDefinition:
    key: str
    display_name: str
    spreadsheet_id: str
    sheet_name: str
    cell_range: str
    header_row: int
    identifier_header: str
    identifier_type: str
    mappings: Tuple[SheetFieldMapping, ...]

    @property
    def full_a1_range(self) -> str:
        quoted_sheet = self.sheet_name.replace("'", "''")
        return f"'{quoted_sheet}'!{self.cell_range}"

    @property
    def bounded_cell_count(self) -> int:
        start_column, start_row, end_column, end_row = cell_range_bounds(self.cell_range)
        return (end_column - start_column + 1) * (end_row - start_row + 1)

    @property
    def allowed_headers(self) -> frozenset[str]:
        return frozenset(
            {self.identifier_header, *(mapping.source_header for mapping in self.mappings)}
        )


_CELL_RANGE_RE = re.compile(r"([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)")


def _column_number(column: str) -> int:
    number = 0
    for character in column:
        number = number * 26 + (ord(character) - ord("A") + 1)
    return number


def cell_range_bounds(cell_range: str) -> tuple[int, int, int, int]:
    """Return one-based start column/row and end column/row for a bounded A1 range."""
    match = _CELL_RANGE_RE.fullmatch(cell_range)
    if not match:
        raise ValueError("Range must be a bounded cell rectangle")
    start_col, start_row, end_col, end_row = match.groups()
    return (
        _column_number(start_col),
        int(start_row),
        _column_number(end_col),
        int(end_row),
    )


_SOURCE_ITEMS = (
    SheetSourceDefinition(
        key="partner_skus",
        display_name="Partner Inventory - SKUs",
        spreadsheet_id=PARTNER_INVENTORY_SPREADSHEET_ID,
        sheet_name="SKUs",
        cell_range="A4:F200",
        header_row=4,
        identifier_header="SKU",
        identifier_type="sku",
        mappings=(
            SheetFieldMapping(
                source_header="Product Name",
                destination_entity="product",
                destination_field="product_name",
                expected_type="string",
                risk_level="low",
                required=True,
            ),
            SheetFieldMapping(
                source_header="Size",
                destination_entity="product",
                destination_field="size",
                expected_type="string",
                risk_level="high",
            ),
            SheetFieldMapping(
                source_header="Category",
                destination_entity="product",
                destination_field="category",
                expected_type="string",
                risk_level="high",
            ),
            SheetFieldMapping(
                source_header="Pack QTY",
                destination_entity="product",
                destination_field="pack_qty",
                expected_type="non_negative_integer",
                risk_level="medium",
            ),
        ),
    ),
    SheetSourceDefinition(
        key="partner_rte_food_info",
        display_name="Partner Inventory - RTE Food Info",
        spreadsheet_id=PARTNER_INVENTORY_SPREADSHEET_ID,
        sheet_name="RTE Food Info",
        cell_range="B5:H200",
        header_row=5,
        identifier_header="SKU",
        identifier_type="sku",
        mappings=(
            SheetFieldMapping(
                source_header="Product Name",
                destination_entity="product",
                destination_field="product_name",
                expected_type="string",
                risk_level="low",
                required=True,
            ),
            SheetFieldMapping(
                source_header="H+H Price",
                destination_entity="product",
                destination_field="retail_price",
                expected_type="money",
                risk_level="high",
                auto_apply_eligible=True,
            ),
            SheetFieldMapping(
                source_header="Reseller's Price",
                destination_entity="product",
                destination_field="reseller_price",
                expected_type="money",
                risk_level="high",
                auto_apply_eligible=True,
            ),
        ),
    ),
)

V1_SOURCES: Mapping[str, SheetSourceDefinition] = MappingProxyType(
    {source.key: source for source in _SOURCE_ITEMS}
)


class UnknownSheetSourceError(ValueError):
    pass


def get_sheet_source(source_key: str) -> SheetSourceDefinition:
    try:
        return V1_SOURCES[source_key]
    except KeyError as exc:
        raise UnknownSheetSourceError("Unknown or inactive Google Sheets source") from exc


def is_exact_registered_range(spreadsheet_id: str, full_a1_range: str) -> bool:
    return any(
        source.spreadsheet_id == spreadsheet_id
        and source.full_a1_range == full_a1_range
        for source in V1_SOURCES.values()
    )


def validate_registry() -> None:
    seen_ranges: set[tuple[str, str]] = set()
    seen_destinations: set[tuple[str, str]] = set()
    for source in V1_SOURCES.values():
        if source.spreadsheet_id not in AUDITED_SPREADSHEET_IDS:
            raise ValueError("Registry source is not from an audited spreadsheet")
        match = _CELL_RANGE_RE.fullmatch(source.cell_range)
        if not match:
            raise ValueError("Registry range must be a bounded cell rectangle")
        start_col, start_row, end_col, end_row = match.groups()
        if int(start_row) != source.header_row:
            raise ValueError("Registry range must begin on its declared header row")
        if _column_number(end_col) < _column_number(start_col) or int(end_row) < int(start_row):
            raise ValueError("Registry range bounds are reversed")
        range_key = (source.spreadsheet_id, source.full_a1_range)
        if range_key in seen_ranges:
            raise ValueError("Duplicate registry range")
        seen_ranges.add(range_key)
        normalized_headers = [mapping.source_header.casefold() for mapping in source.mappings]
        if len(normalized_headers) != len(set(normalized_headers)):
            raise ValueError("Duplicate mapped source header")
        for mapping in source.mappings:
            destination_key = (source.key, mapping.destination_key)
            if destination_key in seen_destinations:
                raise ValueError("Duplicate destination mapping")
            seen_destinations.add(destination_key)
            if mapping.approval_mode != "manual_review":
                raise ValueError("V1 mappings must require manual review")
            if mapping.auto_apply_eligible and mapping.destination_key not in {
                "product.retail_price",
                "product.reseller_price",
            }:
                raise ValueError("Only reviewed product price fields may be auto-applied")


validate_registry()
