"""Strict, deterministic helpers for approved Google Sheets source rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import re
from types import MappingProxyType
from typing import Mapping, Sequence
import unicodedata

from .sheet_sync_registry import SheetFieldMapping, SheetSourceDefinition


_WHITESPACE_RE = re.compile(r"\s+")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
_SKU_RE = re.compile(r"^[A-Z0-9][A-Z0-9._/\-]{0,99}$")
_MONEY_RE = re.compile(
    r"^(?:(?:PHP)\s*|₱\s*)?"
    r"([+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)$",
    re.IGNORECASE,
)
_NON_NEGATIVE_INTEGER_RE = re.compile(
    r"^[+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.0+)?$"
)


class SheetNormalizationError(ValueError):
    pass


class HeaderValidationError(SheetNormalizationError):
    pass


class ValueNormalizationError(SheetNormalizationError):
    def __init__(self, field_key: str, message: str):
        super().__init__(message)
        self.field_key = field_key


@dataclass(frozen=True)
class ResolvedHeaders:
    identifier_index: int
    mapping_indices: Mapping[str, int]


@dataclass(frozen=True)
class MappedSourceRow:
    identifier: str
    row_number: int
    raw_values: Mapping[str, object | None]


@dataclass(frozen=True)
class ParsedSourceRows:
    rows: tuple[MappedSourceRow, ...]
    duplicate_identifiers: Mapping[str, tuple[int, ...]]
    missing_identifier_rows: tuple[int, ...]
    invalid_identifier_rows: tuple[int, ...]
    blank_rows: tuple[int, ...]


@dataclass(frozen=True)
class NormalizedSourceRow:
    identifier: str
    row_number: int
    values: Mapping[str, object | None]


def _canonical_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    return _WHITESPACE_RE.sub(" ", text.replace("\u00a0", " ")).strip()


def normalize_header(value: object) -> str:
    return _canonical_text(value).casefold()


def normalize_identifier(value: object, identifier_type: str = "sku") -> str:
    identifier = _canonical_text(value)
    if not identifier:
        raise SheetNormalizationError("Stable identifier is blank")
    if identifier_type == "sku":
        identifier = identifier.upper()
        if not _SKU_RE.fullmatch(identifier):
            raise SheetNormalizationError("Stable SKU identifier has an invalid format")
    else:
        if len(identifier) > 255 or _CONTROL_RE.search(identifier):
            raise SheetNormalizationError("Stable identifier has an invalid format")
    return identifier


def _is_blank(value: object | None) -> bool:
    return value is None or (isinstance(value, str) and not _canonical_text(value))


def resolve_headers(
    header_row: Sequence[object],
    source: SheetSourceDefinition,
) -> ResolvedHeaders:
    positions: dict[str, list[int]] = {}
    for index, raw_header in enumerate(header_row):
        normalized = normalize_header(raw_header)
        if normalized:
            positions.setdefault(normalized, []).append(index)

    expected = {
        normalize_header(source.identifier_header): source.identifier_header,
        **{
            normalize_header(mapping.source_header): mapping.source_header
            for mapping in source.mappings
        },
    }
    missing = [display for normalized, display in expected.items() if normalized not in positions]
    if missing:
        raise HeaderValidationError(
            "Missing required mapped header(s): " + ", ".join(sorted(missing))
        )
    duplicated = [
        expected[normalized]
        for normalized, indices in positions.items()
        if normalized in expected and len(indices) > 1
    ]
    if duplicated:
        raise HeaderValidationError(
            "Duplicate mapped header(s): " + ", ".join(sorted(duplicated))
        )

    identifier_index = positions[normalize_header(source.identifier_header)][0]
    mapping_indices = {
        mapping.destination_key: positions[normalize_header(mapping.source_header)][0]
        for mapping in source.mappings
    }
    return ResolvedHeaders(
        identifier_index=identifier_index,
        mapping_indices=MappingProxyType(mapping_indices),
    )


def _row_value(row: Sequence[object], index: int) -> object | None:
    return row[index] if index < len(row) else None


def parse_source_rows(
    values: Sequence[Sequence[object]],
    source: SheetSourceDefinition,
) -> ParsedSourceRows:
    if not values:
        raise HeaderValidationError("Approved range did not return its header row")
    resolved = resolve_headers(values[0], source)
    candidates: list[MappedSourceRow] = []
    missing_rows: list[int] = []
    invalid_rows: list[int] = []
    blank_rows: list[int] = []

    for offset, row in enumerate(values[1:], start=1):
        row_number = source.header_row + offset
        if not row or all(_is_blank(value) for value in row):
            blank_rows.append(row_number)
            continue
        raw_identifier = _row_value(row, resolved.identifier_index)
        if _is_blank(raw_identifier):
            missing_rows.append(row_number)
            continue
        try:
            identifier = normalize_identifier(raw_identifier, source.identifier_type)
        except SheetNormalizationError:
            invalid_rows.append(row_number)
            continue
        raw_values = {
            destination_key: _row_value(row, index)
            for destination_key, index in resolved.mapping_indices.items()
        }
        candidates.append(
            MappedSourceRow(
                identifier=identifier,
                row_number=row_number,
                raw_values=MappingProxyType(raw_values),
            )
        )

    rows_by_identifier: dict[str, list[MappedSourceRow]] = {}
    for row in candidates:
        rows_by_identifier.setdefault(row.identifier, []).append(row)
    duplicates = {
        identifier: tuple(row.row_number for row in rows)
        for identifier, rows in rows_by_identifier.items()
        if len(rows) > 1
    }
    unique_rows = tuple(
        rows[0]
        for identifier, rows in rows_by_identifier.items()
        if identifier not in duplicates
    )
    return ParsedSourceRows(
        rows=unique_rows,
        duplicate_identifiers=MappingProxyType(duplicates),
        missing_identifier_rows=tuple(missing_rows),
        invalid_identifier_rows=tuple(invalid_rows),
        blank_rows=tuple(blank_rows),
    )


def normalize_string(value: object, *, max_length: int = 255) -> str:
    normalized = _canonical_text(value)
    if not normalized:
        raise SheetNormalizationError("Value is blank")
    if len(normalized) > max_length or _CONTROL_RE.search(normalized):
        raise SheetNormalizationError("Text value has an invalid format")
    return normalized


def normalize_non_negative_integer(value: object) -> int:
    if isinstance(value, bool):
        raise SheetNormalizationError("Boolean is not a quantity")
    candidate = _canonical_text(value)
    if not _NON_NEGATIVE_INTEGER_RE.fullmatch(candidate):
        raise SheetNormalizationError("Quantity is not a valid whole number")
    try:
        decimal_value = Decimal(candidate.replace(",", ""))
    except (InvalidOperation, AttributeError):
        raise SheetNormalizationError("Quantity is not a valid number") from None
    if not decimal_value.is_finite() or decimal_value < 0 or decimal_value != decimal_value.to_integral_value():
        raise SheetNormalizationError("Quantity must be a non-negative whole number")
    return int(decimal_value)


def normalize_money(value: object) -> Decimal:
    if isinstance(value, bool):
        raise SheetNormalizationError("Boolean is not a money value")
    if isinstance(value, (int, float, Decimal)):
        candidate = str(value)
    else:
        candidate = _canonical_text(value)
    match = _MONEY_RE.fullmatch(candidate)
    if not match:
        raise SheetNormalizationError("Money value has an invalid currency format")
    try:
        normalized = Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:
        raise SheetNormalizationError("Money value is not a valid decimal") from None
    if not normalized.is_finite() or normalized < 0:
        raise SheetNormalizationError("Money value must be non-negative")
    return normalized


def normalize_boolean(value: object) -> bool:
    if isinstance(value, bool):
        return value
    normalized = _canonical_text(value).casefold()
    if normalized in {"true", "yes", "1"}:
        return True
    if normalized in {"false", "no", "0"}:
        return False
    raise SheetNormalizationError("Boolean value is invalid")


def normalize_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, bool):
        raise SheetNormalizationError("Boolean is not a date")
    if isinstance(value, (int, float, Decimal)):
        try:
            return date(1899, 12, 30) + timedelta(days=int(Decimal(str(value))))
        except (InvalidOperation, OverflowError):
            raise SheetNormalizationError("Google Sheets date serial is invalid") from None
    try:
        return date.fromisoformat(_canonical_text(value))
    except ValueError:
        raise SheetNormalizationError("Date must be ISO YYYY-MM-DD") from None


def normalize_mapped_value(
    mapping: SheetFieldMapping,
    raw_value: object | None,
) -> object | None:
    if _is_blank(raw_value):
        if mapping.required:
            raise ValueNormalizationError(mapping.destination_key, "Required mapped value is blank")
        return None
    try:
        if mapping.expected_type == "string":
            return normalize_string(raw_value)
        if mapping.expected_type == "non_negative_integer":
            return normalize_non_negative_integer(raw_value)
        if mapping.expected_type == "money":
            return normalize_money(raw_value)
        if mapping.expected_type == "boolean":
            return normalize_boolean(raw_value)
        if mapping.expected_type == "date":
            return normalize_date(raw_value)
    except SheetNormalizationError as exc:
        raise ValueNormalizationError(mapping.destination_key, str(exc)) from exc
    raise ValueNormalizationError(mapping.destination_key, "Unsupported mapped value type")


def normalize_source_row(
    row: MappedSourceRow,
    source: SheetSourceDefinition,
) -> NormalizedSourceRow:
    normalized = {
        mapping.destination_key: normalize_mapped_value(
            mapping,
            row.raw_values.get(mapping.destination_key),
        )
        for mapping in source.mappings
    }
    return NormalizedSourceRow(
        identifier=row.identifier,
        row_number=row.row_number,
        values=MappingProxyType(normalized),
    )


def canonical_value(value: object | None) -> str:
    """Stable comparison representation used by later fingerprinting code."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Decimal):
        if value == 0:
            return "0"
        return format(value.normalize(), "f")
    if isinstance(value, date):
        return value.isoformat()
    return normalize_string(value)
