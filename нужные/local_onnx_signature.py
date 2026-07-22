#!/usr/bin/env python3
from pathlib import Path
import argparse
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw


MODEL_PATH = Path("roboflow_model_weights/versig_signature_v6_cached/weights.onnx")
DEFAULT_IMAGE = Path(
    "roboflow_samples/versig_purchase_documents/images/"
    "purchase_1015-5_6_png.rf.f5d8f50b096c58bff04553a670ad1544.jpg"
)
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def letterbox(image, size=640, color=255):
    height, width = image.shape[:2]
    scale = min(size / width, size / height)
    new_width = int(round(width * scale))
    new_height = int(round(height * scale))
    pad_x = (size - new_width) / 2
    pad_y = (size - new_height) / 2

    resized = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), color, dtype=np.uint8)
    left = int(round(pad_x - 0.1))
    top = int(round(pad_y - 0.1))
    canvas[top : top + new_height, left : left + new_width] = resized
    return canvas, scale, left, top


def nms(boxes, scores, threshold):
    if len(boxes) == 0:
        return []

    boxes = boxes.astype(np.float32)
    x1, y1, x2, y2 = boxes.T
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]
    keep = []

    while order.size > 0:
        current = order[0]
        keep.append(current)
        if order.size == 1:
            break

        xx1 = np.maximum(x1[current], x1[order[1:]])
        yy1 = np.maximum(y1[current], y1[order[1:]])
        xx2 = np.minimum(x2[current], x2[order[1:]])
        yy2 = np.minimum(y2[current], y2[order[1:]])
        inter_w = np.maximum(0, xx2 - xx1)
        inter_h = np.maximum(0, yy2 - yy1)
        intersection = inter_w * inter_h
        union = areas[current] + areas[order[1:]] - intersection
        iou = intersection / np.maximum(union, 1e-6)
        order = order[1:][iou <= threshold]

    return keep


def detect_signatures(session, image_path, confidence=0.25, iou=0.45):
    pil_image = Image.open(image_path).convert("RGB")
    original = np.array(pil_image)
    height, width = original.shape[:2]

    boxed, scale, pad_x, pad_y = letterbox(original, size=640, color=255)
    tensor = boxed.astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[None, ...]

    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: tensor})[0][0].T

    scores = np.clip(output[:, 4], 0, 1)
    mask = scores >= confidence
    output = output[mask]
    scores = scores[mask]

    if len(output) == 0:
        return pil_image, []

    x_center, y_center, box_width, box_height = output[:, 0], output[:, 1], output[:, 2], output[:, 3]
    x1 = (x_center - box_width / 2 - pad_x) / scale
    y1 = (y_center - box_height / 2 - pad_y) / scale
    x2 = (x_center + box_width / 2 - pad_x) / scale
    y2 = (y_center + box_height / 2 - pad_y) / scale

    boxes = np.stack(
        [
            np.clip(x1, 0, width),
            np.clip(y1, 0, height),
            np.clip(x2, 0, width),
            np.clip(y2, 0, height),
        ],
        axis=1,
    )
    keep = nms(boxes, scores, iou)

    detections = []
    for index in keep:
        left, top, right, bottom = boxes[index]
        detections.append(
            {
                "class": "signature",
                "confidence": float(scores[index]),
                "x": float((left + right) / 2),
                "y": float((top + bottom) / 2),
                "width": float(right - left),
                "height": float(bottom - top),
                "box": (float(left), float(top), float(right), float(bottom)),
            }
        )
    detections.sort(key=lambda item: item["confidence"], reverse=True)
    return pil_image, detections


def overlaps_signature(box, signatures, max_overlap=0.25):
    left, top, right, bottom = box
    area = max(0, right - left) * max(0, bottom - top)
    if area <= 0:
        return False

    for signature in signatures:
        other_left, other_top, other_right, other_bottom = signature["box"]
        inter_left = max(left, other_left)
        inter_top = max(top, other_top)
        inter_right = min(right, other_right)
        inter_bottom = min(bottom, other_bottom)
        inter_area = max(0, inter_right - inter_left) * max(0, inter_bottom - inter_top)
        if inter_area / area > max_overlap:
            return True
    return False


def detect_stamps(image, signatures):
    original = np.array(image.convert("RGB"))
    height, width = original.shape[:2]
    hsv = cv2.cvtColor(original, cv2.COLOR_RGB2HSV)

    # Blue/purple ink range. This is a heuristic, not a trained stamp model.
    lower_blue = np.array([85, 35, 45], dtype=np.uint8)
    upper_blue = np.array([150, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower_blue, upper_blue)

    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.dilate(mask, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    stamps = []
    page_area = width * height
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if box_width <= 0 or box_height <= 0:
            continue

        box_area = box_width * box_height
        contour_area = cv2.contourArea(contour)
        aspect = box_width / box_height
        fill_ratio = contour_area / max(box_area, 1)
        relative_area = box_area / page_area

        if relative_area < 0.0012 or relative_area > 0.09:
            continue
        if not 0.55 <= aspect <= 1.85:
            continue
        if fill_ratio < 0.08:
            continue
        if box_width < width * 0.035 or box_height < height * 0.025:
            continue

        box = (float(x), float(y), float(x + box_width), float(y + box_height))
        if overlaps_signature(box, signatures):
            continue

        confidence = min(0.95, 0.45 + fill_ratio + min(relative_area * 8, 0.25))
        stamps.append(
            {
                "class": "stamp",
                "confidence": float(confidence),
                "x": float(x + box_width / 2),
                "y": float(y + box_height / 2),
                "width": float(box_width),
                "height": float(box_height),
                "box": box,
            }
        )

    stamps.sort(key=lambda item: item["confidence"], reverse=True)
    return stamps


def save_visualization(image, detections, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    draw = ImageDraw.Draw(image)
    for index, detection in enumerate(detections, start=1):
        left, top, right, bottom = detection["box"]
        confidence = detection["confidence"]
        label = detection["class"]
        color = (255, 0, 0) if label == "signature" else (0, 90, 255)
        draw.rectangle((left, top, right, bottom), outline=color, width=4)
        draw.text((left, max(0, top - 22)), f"{index} {label} {confidence:.0%}", fill=color)
    image.save(output_path)


def collect_images(paths):
    images = []
    for path in paths:
        path = Path(path)
        if path.is_dir():
            images.extend(sorted(p for p in path.iterdir() if p.suffix.lower() in SUPPORTED_EXTENSIONS))
        elif path.suffix.lower() in SUPPORTED_EXTENSIONS:
            images.append(path)
    return images


def main():
    parser = argparse.ArgumentParser(description="Find signatures using the downloaded local ONNX model.")
    parser.add_argument("paths", nargs="*", help="Image file(s) or folder(s). Drag files here from Finder.")
    parser.add_argument("--model", default=str(MODEL_PATH), help="Path to weights.onnx.")
    parser.add_argument("--confidence", type=float, default=0.25, help="Minimum confidence, 0.25 = 25%%.")
    parser.add_argument("--iou", type=float, default=0.45, help="Overlap threshold for merging boxes.")
    parser.add_argument("--output-dir", default="output/local_onnx_predictions", help="Folder for result images.")
    parser.add_argument(
        "--no-stamps",
        action="store_true",
        help="Disable local heuristic stamp detection.",
    )
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        print(f"Model not found: {model_path}", file=sys.stderr)
        return 2

    image_paths = collect_images(args.paths) if args.paths else [DEFAULT_IMAGE]
    if not image_paths:
        print("No images found. Drag images or a folder after the command.", file=sys.stderr)
        return 2

    import onnxruntime as ort

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    output_dir = Path(args.output_dir)

    for image_path in image_paths:
        image, signatures = detect_signatures(session, image_path, args.confidence, args.iou)
        stamps = [] if args.no_stamps else detect_stamps(image, signatures)
        detections = [*signatures, *stamps]
        output_path = output_dir / f"{image_path.stem}_onnx.jpg"
        save_visualization(image, detections, output_path)

        print(f"{image_path}: {len(signatures)} signature(s), {len(stamps)} stamp(s)")
        for index, detection in enumerate(detections, start=1):
            print(
                f"  {index}: {detection['class']} {detection['confidence']:.0%} "
                f"x={detection['x']:.1f}, y={detection['y']:.1f}, "
                f"w={detection['width']:.1f}, h={detection['height']:.1f}"
            )
        print(f"  saved: {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
