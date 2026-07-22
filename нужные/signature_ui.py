#!/usr/bin/env python3
import queue
import re
import subprocess
import threading
import tempfile
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

from detect_signature import (
    detect_photo_signature,
    detect_hybrid,
    keep_expected_count,
    prediction_count,
    render_pdf_pages,
    save_debug_image,
)
from local_onnx_signature import detect_stamps


PDF_DPI = 200
EXPECTED_COUNT = 3
SAMPLE_EXPECTED_COUNT = 1
ONNX_PYTHON = Path(".venv312/bin/python")
ONNX_SCRIPT = Path("local_onnx_signature.py")
ONNX_CONFIDENCE = 0.25
SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


class SignatureViewer(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Signature Detector")
        self.geometry("1180x820")
        self.minsize(920, 620)

        self.work_queue = queue.Queue()
        self.rows = []
        self.current_image = None
        self.current_photo = None
        self.temp_dir = tempfile.TemporaryDirectory()
        self.debug_dir = Path("output/signature_debug")
        self.debug_dir.mkdir(parents=True, exist_ok=True)

        self.create_widgets()
        self.after(120, self.process_queue)

    def create_widgets(self):
        toolbar = ttk.Frame(self, padding=8)
        toolbar.pack(side=tk.TOP, fill=tk.X)

        ttk.Button(toolbar, text="Choose PDF / Images", command=self.choose_files).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="Best PDF", command=self.choose_files_best).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Choose ONNX", command=self.choose_files_onnx).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Scan Desktop PDFs", command=self.scan_desktop).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Desktop Best", command=self.scan_desktop_best).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Choose Folder", command=self.choose_folder).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Folder ONNX", command=self.choose_folder_onnx).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Scan Sample Images", command=self.scan_samples).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Scan Good Docs", command=self.scan_good_docs).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Good ONNX", command=self.scan_good_docs_onnx).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="Scan Roboflow Docs", command=self.scan_roboflow_docs).pack(side=tk.LEFT, padx=(8, 0))

        self.status_var = tk.StringVar(value="Choose documents to scan.")
        ttk.Label(toolbar, textvariable=self.status_var).pack(side=tk.LEFT, padx=14)

        body = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        body.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        left = ttk.Frame(body, padding=8)
        body.add(left, weight=1)

        ttk.Label(left, text="Pages").pack(anchor=tk.W)
        self.listbox = tk.Listbox(left, width=46, activestyle="dotbox")
        self.listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, pady=(6, 0))
        self.listbox.bind("<<ListboxSelect>>", self.show_selected_page)

        scrollbar = ttk.Scrollbar(left, orient=tk.VERTICAL, command=self.listbox.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y, pady=(6, 0))
        self.listbox.configure(yscrollcommand=scrollbar.set)

        right = ttk.Frame(body, padding=8)
        body.add(right, weight=4)

        self.page_title = tk.StringVar(value="No page selected")
        ttk.Label(right, textvariable=self.page_title).pack(anchor=tk.W)

        canvas_frame = ttk.Frame(right)
        canvas_frame.pack(fill=tk.BOTH, expand=True, pady=(6, 0))

        self.canvas = tk.Canvas(canvas_frame, background="#202020", highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.bind("<Configure>", lambda _event: self.redraw_image())

    def choose_files(self):
        paths = filedialog.askopenfilenames(
            title="Choose PDF or image files",
            filetypes=[
                ("Documents", "*.pdf *.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"),
                ("PDF", "*.pdf"),
                ("Images", "*.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"),
                ("All files", "*.*"),
            ],
        )
        if paths:
            self.start_scan([Path(path) for path in paths], EXPECTED_COUNT, "auto")

    def choose_files_best(self):
        paths = filedialog.askopenfilenames(
            title="Choose PDF or image files for best signature + stamp mode",
            filetypes=[
                ("Documents", "*.pdf *.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"),
                ("PDF", "*.pdf"),
                ("Images", "*.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"),
                ("All files", "*.*"),
            ],
        )
        if paths:
            self.start_scan([Path(path) for path in paths], EXPECTED_COUNT, "best")

    def choose_files_onnx(self):
        paths = filedialog.askopenfilenames(
            title="Choose PDF or image files for local ONNX model",
            filetypes=[
                ("Documents", "*.pdf *.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"),
                ("PDF", "*.pdf"),
                ("Images", "*.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"),
                ("All files", "*.*"),
            ],
        )
        if paths:
            self.start_scan([Path(path) for path in paths], expected_count=None, mode="onnx")

    def choose_folder(self):
        folder = filedialog.askdirectory(title="Choose folder with PDF or image files")
        if not folder:
            return
        files = self.collect_folder_files(Path(folder))
        if not files:
            messagebox.showinfo("No files", "No PDF or image files found in this folder.")
            return
        self.start_scan(files, expected_count=None, mode="auto")

    def choose_folder_onnx(self):
        folder = filedialog.askdirectory(title="Choose folder for local ONNX model")
        if not folder:
            return
        files = self.collect_folder_files(Path(folder))
        if not files:
            messagebox.showinfo("No files", "No PDF or image files found in this folder.")
            return
        self.start_scan(files, expected_count=None, mode="onnx")

    def scan_desktop(self):
        desktop = Path.home() / "Desktop"
        files = sorted(path for path in desktop.iterdir() if path.suffix.lower() == ".pdf")
        if not files:
            messagebox.showinfo("No PDFs", "No PDF files found on Desktop.")
            return
        self.start_scan(files, EXPECTED_COUNT, "hybrid")

    def scan_desktop_best(self):
        desktop = Path.home() / "Desktop"
        files = sorted(path for path in desktop.iterdir() if path.suffix.lower() == ".pdf")
        if not files:
            messagebox.showinfo("No PDFs", "No PDF files found on Desktop.")
            return
        self.start_scan(files, EXPECTED_COUNT, "best")

    def scan_samples(self):
        sample_folder = Path("samples/signature/images/val")
        if not sample_folder.exists():
            messagebox.showinfo(
                "Samples not found",
                "Run download_signature_samples.command first, then try again.",
            )
            return
        files = self.collect_folder_files(sample_folder)
        if not files:
            messagebox.showinfo("No sample images", "No images found in samples/signature/images/val.")
            return
        self.start_scan(files, SAMPLE_EXPECTED_COUNT, "photo")

    def scan_good_docs(self):
        docs_folder = Path("good_signature_docs/images")
        if not docs_folder.exists():
            messagebox.showinfo(
                "Good docs not found",
                "No filtered good documents folder found yet.",
            )
            return
        files = self.collect_folder_files(docs_folder)
        if not files:
            messagebox.showinfo("No good docs", "No images found in good_signature_docs/images.")
            return
        self.start_scan(files, expected_count=None, mode="roboflow-labels")

    def scan_good_docs_onnx(self):
        docs_folder = Path("good_signature_docs/images")
        if not docs_folder.exists():
            messagebox.showinfo(
                "Good docs not found",
                "No filtered good documents folder found yet.",
            )
            return
        files = self.collect_folder_files(docs_folder)
        if not files:
            messagebox.showinfo("No good docs", "No images found in good_signature_docs/images.")
            return
        self.start_scan(files, expected_count=None, mode="onnx")

    def scan_roboflow_docs(self):
        docs_folder = Path("roboflow_samples/versig_purchase_documents/images")
        if not docs_folder.exists():
            messagebox.showinfo(
                "Roboflow docs not found",
                "Run download_roboflow_versig.command first, then try again.",
            )
            return
        files = self.collect_folder_files(docs_folder)
        if not files:
            messagebox.showinfo("No Roboflow docs", "No images found in Roboflow docs folder.")
            return
        self.start_scan(files, expected_count=None, mode="roboflow-labels")

    def collect_folder_files(self, folder):
        return sorted(
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        )

    def start_scan(self, files, expected_count, mode):
        self.rows = []
        self.listbox.delete(0, tk.END)
        self.canvas.delete("all")
        self.current_image = None
        self.current_photo = None
        self.page_title.set("Scanning...")
        self.status_var.set(f"Scanning {len(files)} file(s)...")

        worker = threading.Thread(target=self.scan_files, args=(files, expected_count, mode), daemon=True)
        worker.start()

    def scan_files(self, files, expected_count, mode):
        try:
            total_files = len(files)
            for file_index, path in enumerate(files, start=1):
                self.work_queue.put(("status", f"Scanning {file_index}/{total_files}: {path.name}"))
                if path.suffix.lower() == ".pdf":
                    page_images = render_pdf_pages(path, self.temp_dir.name, PDF_DPI)
                else:
                    page_images = [(None, path)]

                for page_number, image_path in page_images:
                    if mode == "roboflow-labels":
                        result = self.detect_from_yolo_label(image_path)
                    elif mode == "onnx":
                        result = self.detect_with_local_onnx(image_path)
                    elif mode == "best":
                        result = self.detect_best(image_path, expected_count)
                    elif mode == "photo":
                        result = detect_photo_signature(image_path)
                    else:
                        result = detect_hybrid(image_path)
                    if mode != "best":
                        result = keep_expected_count(result, expected_count)
                    debug_name = (
                        f"{path.stem}_page_{page_number}.jpg"
                        if page_number
                        else f"{path.stem}_debug.jpg"
                    )
                    debug_path = self.debug_dir / debug_name
                    if result.get("debug_path"):
                        debug_path = Path(result["debug_path"])
                    else:
                        save_debug_image(image_path, result.get("predictions", []), debug_path)
                    count = prediction_count(result)
                    label = f"{path.name}"
                    if page_number:
                        label += f" page {page_number}"
                    if result.get("summary"):
                        label += f": {result['summary']}"
                    else:
                        label += f": {count} signature(s)"
                    self.work_queue.put(
                        (
                            "row",
                            {
                                "label": label,
                                "path": debug_path,
                                "count": count,
                            },
                        )
                    )
            self.work_queue.put(("done", "Done. Click a page to view it."))
        except Exception as error:
            self.work_queue.put(("error", str(error)))

    def detect_from_yolo_label(self, image_path):
        image = Image.open(image_path).convert("RGB")
        width, height = image.size
        label_path = image_path.parent.parent / "labels" / f"{image_path.stem}.txt"
        predictions = []
        if label_path.exists():
            for line in label_path.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) != 5:
                    continue
                _class_id, x_center, y_center, box_width, box_height = map(float, parts)
                predictions.append(
                    {
                        "class": "signature",
                        "confidence": 1.0,
                        "x": int(x_center * width),
                        "y": int(y_center * height),
                        "width": int(box_width * width),
                        "height": int(box_height * height),
                    }
                )
        return {"predictions": predictions, "image": {"width": width, "height": height}}

    def detect_best(self, image_path, expected_count):
        image = Image.open(image_path).convert("RGB")
        width, height = image.size

        signature_result = keep_expected_count(detect_hybrid(image_path), expected_count)
        signatures = []
        for prediction in signature_result.get("predictions", []):
            item = dict(prediction)
            item["class"] = "signature"
            signatures.append(item)

        stamp_signatures = []
        for signature in signatures:
            left = signature["x"] - signature["width"] / 2
            top = signature["y"] - signature["height"] / 2
            right = signature["x"] + signature["width"] / 2
            bottom = signature["y"] + signature["height"] / 2
            stamp_signatures.append({**signature, "box": (left, top, right, bottom)})
        stamps = detect_stamps(image, stamp_signatures)
        predictions = [
            *signatures,
            *[
                {
                    "class": "stamp",
                    "confidence": stamp["confidence"],
                    "x": stamp["x"],
                    "y": stamp["y"],
                    "width": stamp["width"],
                    "height": stamp["height"],
                }
                for stamp in stamps
            ],
        ]
        return {
            "predictions": predictions,
            "image": {"width": width, "height": height},
            "summary": f"{len(signatures)} signature(s), {len(stamps)} stamp(s)",
        }

    def detect_with_local_onnx(self, image_path):
        if not ONNX_PYTHON.exists():
            raise RuntimeError("Missing .venv312/bin/python. Run the ONNX setup first.")
        if not ONNX_SCRIPT.exists():
            raise RuntimeError("Missing local_onnx_signature.py.")

        onnx_debug_dir = self.debug_dir / "onnx"
        command = [
            str(ONNX_PYTHON),
            str(ONNX_SCRIPT),
            "--confidence",
            str(ONNX_CONFIDENCE),
            "--output-dir",
            str(onnx_debug_dir),
            str(image_path),
        ]
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(message)

        count = 0
        summary = None
        saved_path = None
        for line in completed.stdout.splitlines():
            count_match = re.search(r":\s+(\d+)\s+signature\(s\),\s+(\d+)\s+stamp\(s\)", line)
            if count_match:
                signature_count = int(count_match.group(1))
                stamp_count = int(count_match.group(2))
                count = signature_count + stamp_count
                summary = f"{signature_count} signature(s), {stamp_count} stamp(s)"
            if line.strip().startswith("saved:"):
                saved_path = Path(line.split("saved:", 1)[1].strip())

        image = Image.open(image_path).convert("RGB")
        width, height = image.size
        predictions = [
            {
                "class": "signature",
                "confidence": 1.0,
                "x": 0,
                "y": 0,
                "width": 0,
                "height": 0,
            }
            for _ in range(count)
        ]
        return {
            "predictions": predictions,
            "image": {"width": width, "height": height},
            "debug_path": saved_path,
            "summary": summary,
        }

    def process_queue(self):
        try:
            while True:
                event, payload = self.work_queue.get_nowait()
                if event == "status":
                    self.status_var.set(payload)
                elif event == "row":
                    self.rows.append(payload)
                    self.listbox.insert(tk.END, payload["label"])
                    if len(self.rows) == 1:
                        self.listbox.selection_set(0)
                        self.show_row(0)
                elif event == "done":
                    self.status_var.set(payload)
                elif event == "error":
                    self.status_var.set("Error")
                    messagebox.showerror("Scan error", payload)
        except queue.Empty:
            pass
        self.after(120, self.process_queue)

    def show_selected_page(self, _event=None):
        selection = self.listbox.curselection()
        if selection:
            self.show_row(selection[0])

    def show_row(self, index):
        row = self.rows[index]
        self.page_title.set(row["label"])
        self.current_image = Image.open(row["path"]).convert("RGB")
        self.redraw_image()

    def redraw_image(self):
        if self.current_image is None:
            return

        canvas_width = max(self.canvas.winfo_width(), 1)
        canvas_height = max(self.canvas.winfo_height(), 1)
        image_width, image_height = self.current_image.size
        scale = min(canvas_width / image_width, canvas_height / image_height)
        display_size = (
            max(1, int(image_width * scale)),
            max(1, int(image_height * scale)),
        )
        resized = self.current_image.resize(display_size, Image.Resampling.LANCZOS)
        self.current_photo = ImageTk.PhotoImage(resized)

        self.canvas.delete("all")
        x = (canvas_width - display_size[0]) // 2
        y = (canvas_height - display_size[1]) // 2
        self.canvas.create_image(x, y, image=self.current_photo, anchor=tk.NW)

    def destroy(self):
        self.temp_dir.cleanup()
        super().destroy()


if __name__ == "__main__":
    app = SignatureViewer()
    app.mainloop()
