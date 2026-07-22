#!/usr/bin/env python3
import argparse
import base64
import json
import os
import sys
import tempfile
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


MODEL_ID = "signature_detector/1"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Detect signatures in image files and PDF documents with Roboflow."
    )
    parser.add_argument("files", nargs="*", help="Image files, PDF files, or folders to scan.")
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="Scan all supported files on your Desktop.",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="When scanning folders, include subfolders too.",
    )
    parser.add_argument(
        "--pdf-only",
        action="store_true",
        help="When scanning folders or Desktop, use only PDF files.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("ROBOFLOW_API_KEY"),
        help="Roboflow API key. Prefer setting ROBOFLOW_API_KEY instead.",
    )
    parser.add_argument(
        "--output",
        default="signature_results.json",
        help="Where to save detection results as JSON.",
    )
    parser.add_argument(
        "--pdf-dpi",
        type=int,
        default=200,
        help="PDF render quality. Higher is slower but may improve detection.",
    )
    parser.add_argument(
        "--confidence",
        type=int,
        default=10,
        help="Minimum confidence percent to return. Lower can find faint signatures.",
    )
    parser.add_argument(
        "--overlap",
        type=int,
        default=30,
        help="Overlap percent for merging duplicate boxes. Higher can keep more close boxes.",
    )
    parser.add_argument(
        "--model-id",
        default=MODEL_ID,
        help=f"Roboflow model ID to use. Default: {MODEL_ID}",
    )
    parser.add_argument(
        "--mode",
        choices=["roboflow", "blue-ink", "slots", "hybrid", "photo"],
        default="roboflow",
        help="Use Roboflow, blue ink, signature slots, hybrid local detection, or photo detection.",
    )
    parser.add_argument(
        "--expected-count",
        type=int,
        default=None,
        help="If you know each page should have this many signatures, keep the best N boxes.",
    )
    parser.add_argument(
        "--save-debug",
        action="store_true",
        help="Save annotated page images with detected boxes.",
    )
    parser.add_argument(
        "--debug-dir",
        default="output/signature_debug",
        help="Folder for annotated debug images.",
    )
    return parser.parse_args()


def supported_file(path, pdf_only=False):
    if not path.is_file():
        return False
    if pdf_only:
        return path.suffix.lower() == ".pdf"
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def collect_files(paths, include_desktop=False, recursive=False, pdf_only=False):
    collected = []
    if include_desktop:
        paths = [Path.home() / "Desktop", *paths]

    for raw_path in paths:
        path = Path(raw_path).expanduser()
        if path.is_dir():
            iterator = path.rglob("*") if recursive else path.iterdir()
            collected.extend(sorted(item for item in iterator if supported_file(item, pdf_only)))
        elif supported_file(path, pdf_only):
            collected.append(path)
        else:
            print(f"SKIP unsupported or missing: {path}", file=sys.stderr)

    unique_files = []
    seen = set()
    for path in collected:
        resolved = path.resolve()
        if resolved not in seen:
            unique_files.append(path)
            seen.add(resolved)

    return unique_files


def render_pdf_pages(pdf_path, temp_dir, dpi):
    try:
        import fitz
    except ImportError:
        raise RuntimeError(
            "PDF support needs PyMuPDF. Install it with: python3 -m pip install -r requirements.txt"
        )

    rendered_pages = []
    document = fitz.open(pdf_path)
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)

    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        output_path = Path(temp_dir) / f"{Path(pdf_path).stem}_page_{page_index + 1}.jpg"
        pixmap.save(output_path)
        rendered_pages.append((page_index + 1, output_path))

    document.close()
    return rendered_pages


def infer_image(client, image_path, model_id, confidence, overlap):
    image_bytes = Path(image_path).read_bytes()
    encoded_image = base64.b64encode(image_bytes)
    query = urllib.parse.urlencode(
        {
            "api_key": client["api_key"],
            "name": Path(image_path).name,
            "confidence": confidence,
            "overlap": overlap,
        }
    )
    url = f"https://detect.roboflow.com/{model_id}?{query}"

    request = urllib.request.Request(
        url,
        data=encoded_image,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    context = None
    try:
        import certifi

        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass

    try:
        with urllib.request.urlopen(request, timeout=120, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Roboflow API error {error.code}: {details}") from error


def detect_blue_ink(image_path):
    try:
        import numpy as np
        from scipy import ndimage
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Blue-ink mode needs Pillow, numpy, and scipy. "
            "Install with: python3 -m pip install Pillow numpy scipy"
        )

    image = Image.open(image_path).convert("RGB")
    rgb = np.array(image)
    height, width = rgb.shape[:2]
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)

    lower_page = np.zeros((height, width), dtype=np.uint8)
    lower_page[int(height * 0.55) : int(height * 0.84), :] = 1

    blue_mask = (
        (blue > 95)
        & (blue - red > 25)
        & (blue - green > 8)
        & (lower_page == 1)
    ).astype(np.uint8) * 255

    structure = np.ones((13, 45), dtype=bool)
    merged = ndimage.binary_closing(blue_mask.astype(bool), structure=structure, iterations=2)
    merged = ndimage.binary_dilation(merged, structure=structure, iterations=1)

    labels, component_count = ndimage.label(merged)
    objects = ndimage.find_objects(labels)
    predictions = []
    for label_index, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        y_slice, x_slice = slices
        y = y_slice.start
        x = x_slice.start
        box_height = y_slice.stop - y_slice.start
        box_width = x_slice.stop - x_slice.start
        area = int(np.count_nonzero(labels[slices] == label_index))
        aspect = box_width / max(box_height, 1)
        page_area = width * height

        if area < page_area * 0.0004:
            continue
        if area > page_area * 0.035:
            continue
        if aspect < 1.7:
            continue
        if box_height > height * 0.09:
            continue
        if box_width < width * 0.05:
            continue

        predictions.append(
            {
                "class": "blue_signature",
                "confidence": 1.0,
                "x": int(x + box_width / 2),
                "y": int(y + box_height / 2),
                "width": int(box_width),
                "height": int(box_height),
            }
        )

    predictions.sort(key=lambda item: (item["y"], item["x"]))
    return {"predictions": predictions, "image": {"width": width, "height": height}}


def detect_signature_slots(image_path):
    try:
        import numpy as np
        from scipy import ndimage
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Slots mode needs Pillow, numpy, and scipy. "
            "Install with: python3 -m pip install Pillow numpy scipy"
        )

    image = Image.open(image_path).convert("RGB")
    rgb = np.array(image)
    height, width = rgb.shape[:2]
    gray = (
        rgb[:, :, 0].astype(np.float32) * 0.299
        + rgb[:, :, 1].astype(np.float32) * 0.587
        + rgb[:, :, 2].astype(np.float32) * 0.114
    )

    x1 = int(width * 0.17)
    x2 = int(width * 0.47)
    y1 = int(height * 0.64)
    y2 = int(height * 0.80)
    crop = gray[y1:y2, x1:x2]

    dark = crop < 185

    # Remove long ruled lines; the remaining dense blobs are usually signatures/text.
    row_dark = dark.sum(axis=1)
    long_line_rows = row_dark > (dark.shape[1] * 0.38)
    dark[long_line_rows, :] = False

    # Signature scribbles are wider and denser than the small caption text under each line.
    structure = np.ones((9, 35), dtype=bool)
    merged = ndimage.binary_closing(dark, structure=structure, iterations=1)
    merged = ndimage.binary_dilation(merged, structure=structure, iterations=1)
    labels, component_count = ndimage.label(merged)
    objects = ndimage.find_objects(labels)

    candidates = []
    page_area = width * height
    for label_index, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        y_slice, x_slice = slices
        local_y = y_slice.start
        local_x = x_slice.start
        box_height = y_slice.stop - y_slice.start
        box_width = x_slice.stop - x_slice.start
        area = int(np.count_nonzero(labels[slices] == label_index))
        aspect = box_width / max(box_height, 1)

        if area < page_area * 0.00015:
            continue
        if box_width < width * 0.07:
            continue
        if box_width > width * 0.30:
            continue
        if box_height < height * 0.024:
            continue
        if box_height > height * 0.06:
            continue
        if aspect < 2.0:
            continue

        candidates.append(
            {
                "class": "filled_signature_slot",
                "confidence": 1.0,
                "x": int(x1 + local_x + box_width / 2),
                "y": int(y1 + local_y + box_height / 2),
                "width": int(box_width),
                "height": int(box_height),
                "area": area,
            }
        )

    candidates.sort(key=lambda item: (item["y"], item["x"]))
    grouped = []
    for candidate in candidates:
        if grouped and abs(grouped[-1]["y"] - candidate["y"]) < height * 0.025:
            existing = grouped[-1]
            left = min(existing["x"] - existing["width"] / 2, candidate["x"] - candidate["width"] / 2)
            right = max(existing["x"] + existing["width"] / 2, candidate["x"] + candidate["width"] / 2)
            top = min(existing["y"] - existing["height"] / 2, candidate["y"] - candidate["height"] / 2)
            bottom = max(existing["y"] + existing["height"] / 2, candidate["y"] + candidate["height"] / 2)
            existing["x"] = int((left + right) / 2)
            existing["y"] = int((top + bottom) / 2)
            existing["width"] = int(right - left)
            existing["height"] = int(bottom - top)
            existing["area"] += candidate["area"]
        else:
            grouped.append(candidate)

    return {"predictions": grouped, "image": {"width": width, "height": height}}


def detect_photo_signature(image_path):
    try:
        import numpy as np
        from scipy import ndimage
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Photo mode needs Pillow, numpy, and scipy. "
            "Install with: python3 -m pip install Pillow numpy scipy"
        )

    image = Image.open(image_path).convert("RGB")
    rgb = np.array(image)
    height, width = rgb.shape[:2]
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    gray = (
        red.astype(np.float32) * 0.299
        + green.astype(np.float32) * 0.587
        + blue.astype(np.float32) * 0.114
    )

    blue_ink = (blue > 55) & (blue - red > 12) & (blue - green > 0)
    dark_ink = (gray < 115) & (np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue]) > 10)
    mask = blue_ink | dark_ink

    # Ignore tiny text fragments, then connect nearby strokes into one signature box.
    structure = np.ones((17, 45), dtype=bool)
    merged = ndimage.binary_opening(mask, structure=np.ones((2, 2), dtype=bool), iterations=1)
    merged = ndimage.binary_closing(merged, structure=structure, iterations=1)
    merged = ndimage.binary_dilation(merged, structure=np.ones((9, 25), dtype=bool), iterations=1)

    labels, component_count = ndimage.label(merged)
    objects = ndimage.find_objects(labels)
    predictions = []
    page_area = width * height
    for label_index, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        y_slice, x_slice = slices
        y = y_slice.start
        x = x_slice.start
        box_height = y_slice.stop - y_slice.start
        box_width = x_slice.stop - x_slice.start
        area = int(np.count_nonzero(labels[slices] == label_index))
        aspect = box_width / max(box_height, 1)

        if area < page_area * 0.0005:
            continue
        if area > page_area * 0.20:
            continue
        if box_width < width * 0.08:
            continue
        if box_height < height * 0.04:
            continue
        if aspect < 0.7:
            continue

        predictions.append(
            {
                "class": "photo_signature",
                "confidence": 1.0,
                "x": int(x + box_width / 2),
                "y": int(y + box_height / 2),
                "width": int(box_width),
                "height": int(box_height),
                "area": area,
            }
        )

    predictions.sort(key=lambda item: item.get("area", 0), reverse=True)
    return {"predictions": predictions, "image": {"width": width, "height": height}}


def detect_hybrid(image_path):
    blue_result = detect_blue_ink(image_path)
    blue_predictions = blue_result.get("predictions", [])
    has_stamp_like_box = any(
        prediction.get("height", 0) > prediction.get("width", 0) * 0.45
        for prediction in blue_predictions
    )
    if len(blue_predictions) == 3 and not has_stamp_like_box:
        return blue_result
    return detect_signature_slots(image_path)


def keep_expected_count(result, expected_count):
    if not expected_count:
        return result

    predictions = result.get("predictions", [])
    if len(predictions) <= expected_count:
        return result

    best = sorted(
        predictions,
        key=lambda item: (
            item.get("height", 0),
            min(item.get("width", 0), 500),
            item.get("area", 0),
        ),
        reverse=True,
    )[:expected_count]
    best.sort(key=lambda item: (item["y"], item["x"]))
    result = dict(result)
    result["predictions"] = best
    return result


def save_debug_image(image_path, predictions, output_path):
    from PIL import Image, ImageDraw

    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    for index, prediction in enumerate(predictions, start=1):
        label = prediction.get("class", "signature")
        color = (0, 90, 255) if label == "stamp" else (255, 0, 0)
        x = prediction["x"]
        y = prediction["y"]
        width = prediction["width"]
        height = prediction["height"]
        left = x - width / 2
        top = y - height / 2
        right = x + width / 2
        bottom = y + height / 2
        draw.rectangle((left, top, right, bottom), outline=color, width=5)
        draw.text((left, max(0, top - 22)), f"{index} {label}", fill=color)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def scan_file(
    client,
    file_path,
    temp_dir,
    pdf_dpi,
    model_id,
    confidence,
    overlap,
    mode,
    debug_dir,
    expected_count,
):
    path = Path(file_path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    extension = path.suffix.lower()
    if extension == ".pdf":
        results = []
        for page_number, image_path in render_pdf_pages(path, temp_dir, pdf_dpi):
            if mode == "blue-ink":
                result = detect_blue_ink(image_path)
            elif mode == "slots":
                result = detect_signature_slots(image_path)
            elif mode == "hybrid":
                result = detect_hybrid(image_path)
            elif mode == "photo":
                result = detect_photo_signature(image_path)
            else:
                result = infer_image(client, image_path, model_id, confidence, overlap)
            result = keep_expected_count(result, expected_count)

            debug_path = None
            if debug_dir:
                debug_path = Path(debug_dir) / f"{path.stem}_page_{page_number}.jpg"
                save_debug_image(image_path, result.get("predictions", []), debug_path)

            results.append(
                {
                    "source_file": str(path),
                    "page": page_number,
                    "rendered_image": str(image_path),
                    "debug_image": str(debug_path) if debug_path else None,
                    "result": result,
                }
            )
        return results

    if extension in IMAGE_EXTENSIONS:
        if mode == "blue-ink":
            result = detect_blue_ink(path)
        elif mode == "slots":
            result = detect_signature_slots(path)
        elif mode == "hybrid":
            result = detect_hybrid(path)
        elif mode == "photo":
            result = detect_photo_signature(path)
        else:
            result = infer_image(client, path, model_id, confidence, overlap)
        result = keep_expected_count(result, expected_count)

        debug_path = None
        if debug_dir:
            debug_path = Path(debug_dir) / f"{path.stem}_debug.jpg"
            save_debug_image(path, result.get("predictions", []), debug_path)

        return [
            {
                "source_file": str(path),
                "page": None,
                "debug_image": str(debug_path) if debug_path else None,
                "result": result,
            }
        ]

    raise ValueError(f"Unsupported file type: {path.suffix}")


def prediction_count(result):
    predictions = result.get("predictions", [])
    return len(predictions)


def prediction_summary(result):
    predictions = result.get("predictions", [])
    if not predictions:
        return "no boxes"

    parts = []
    for prediction in predictions:
        confidence = prediction.get("confidence", 0)
        label = prediction.get("class", "signature")
        x = round(prediction.get("x", 0))
        y = round(prediction.get("y", 0))
        width = round(prediction.get("width", 0))
        height = round(prediction.get("height", 0))
        parts.append(f"{label} {confidence:.0%} at x={x}, y={y}, w={width}, h={height}")
    return "; ".join(parts)


def main():
    args = parse_args()
    if args.mode == "roboflow" and not args.api_key:
        print("Set your API key first: export ROBOFLOW_API_KEY='your_key_here'", file=sys.stderr)
        return 2

    client = {"api_key": args.api_key}
    include_desktop = args.desktop or (not args.files and args.mode != "roboflow")
    if include_desktop and not args.desktop:
        print("No files specified. Scanning supported files on Desktop.")
    files = collect_files(
        args.files,
        include_desktop=include_desktop,
        recursive=args.recursive,
        pdf_only=args.pdf_only,
    )
    if not files:
        print(
            "No files found. Drag files into Terminal after the command, or use --desktop.",
            file=sys.stderr,
        )
        return 2

    print(f"Found {len(files)} file(s) to scan.", flush=True)
    all_results = []
    debug_dir = args.debug_dir if args.save_debug else None
    with tempfile.TemporaryDirectory() as temp_dir:
        for file_index, file_path in enumerate(files, start=1):
            print(f"Scanning {file_index}/{len(files)}: {file_path}", flush=True)
            try:
                file_results = scan_file(
                    client,
                    file_path,
                    temp_dir,
                    args.pdf_dpi,
                    args.model_id,
                    args.confidence,
                    args.overlap,
                    args.mode,
                    debug_dir,
                    args.expected_count,
                )
            except Exception as error:
                print(f"ERROR {file_path}: {error}", file=sys.stderr)
                continue

            for item in file_results:
                page = f" page {item['page']}" if item["page"] else ""
                count = prediction_count(item["result"])
                summary = prediction_summary(item["result"])
                print(f"{item['source_file']}{page}: {count} signature prediction(s) - {summary}")
            all_results.extend(file_results)

    output_path = Path(args.output)
    output_path.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved results to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
