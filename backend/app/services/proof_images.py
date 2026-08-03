"""Validation and canonicalization for manually uploaded time-entry proof images."""

from __future__ import annotations

import base64
import binascii
import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_INPUT_BYTES = 2_500_000
MAX_IMAGE_PIXELS = 20_000_000
MAX_DIMENSION = 1600
ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class InvalidProofImage(ValueError):
    pass


def normalize_proof_image(data_url: str, declared_type: str) -> tuple[str, str]:
    prefix = f"data:{declared_type};base64,"
    if not data_url.startswith(prefix):
        raise InvalidProofImage("Proof image data does not match its declared type.")

    try:
        raw = base64.b64decode(data_url[len(prefix):], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidProofImage("Proof image is not valid base64 data.") from exc
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise InvalidProofImage("Proof image must be 2.5 MB or smaller.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise InvalidProofImage("Proof image dimensions are too large.")
                detected_type = ALLOWED_FORMATS.get(image.format or "")
                if detected_type != declared_type:
                    raise InvalidProofImage("Proof image content does not match its declared type.")
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image = ImageOps.exif_transpose(image)
                image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
                if image.mode != "RGB":
                    background = Image.new("RGB", image.size, "white")
                    if "A" in image.getbands():
                        background.paste(image, mask=image.getchannel("A"))
                    else:
                        background.paste(image.convert("RGB"))
                    image = background
                output = BytesIO()
                image.save(output, format="JPEG", quality=82, optimize=True)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise InvalidProofImage("Proof image is corrupted or uses an unsupported format.") from exc

    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}", "image/jpeg"
