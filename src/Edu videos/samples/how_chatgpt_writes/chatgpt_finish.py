"""Join the rendered animation with the narration track into the final Short.

Run with the engine venv:  python finish.py <explainer folder> <work folder>
Output: src/Chaos creators/videos/<title> - Shorts - <date>.mp4"""
import datetime, json, pathlib, subprocess, sys

import imageio_ffmpeg

HERE = pathlib.Path(__file__).resolve().parent
src, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
if not src.is_absolute():
    src = HERE / src
title = json.loads((src / "script.json").read_text(encoding="utf-8"))["title"]
anim = next(p for p in (work / "media" / "videos").rglob("animation.mp4") if "partial" not in str(p))
out_dir = HERE.parent / "videos"
out = out_dir / f"{title} - Shorts - {datetime.datetime.now():%Y-%m-%d %H%M}.mp4"
cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-v", "error", "-i", str(anim), "-i", str(work / "audio.wav"),
       "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)]
subprocess.run(cmd, check=True)
print(out)
