"""One-time download of the narration voice model (~120 MB) into ./models."""
import pathlib, urllib.request

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {"kokoro.onnx": "kokoro-v1.0.int8.onnx", "voices.bin": "voices-v1.0.bin"}
models = pathlib.Path(__file__).resolve().parent / "models"
models.mkdir(exist_ok=True)
for local, remote in FILES.items():
    dest = models / local
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"already there: {dest.name}")
        continue
    print(f"downloading {remote} ...")
    urllib.request.urlretrieve(BASE + remote, dest)
    print(f"  saved {dest.name} ({dest.stat().st_size // 1_000_000} MB)")
print("Voice model ready.")
