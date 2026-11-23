"""Makes one edu video in its item folder: voice -> animation -> final MP4 -> thumbnail.

Run with the Chaos engine venv (the web app starts it, detached):  python run.py <item folder>
Writes progress.json as it goes; at the end video.mp4, thumbnail.jpg and result.json
(duration, chapters, which thumbnail was used). On failure: error.txt."""
import json, os, pathlib, re, subprocess, sys, time, traceback

import imageio_ffmpeg

HERE = pathlib.Path(__file__).resolve().parent
HOME = pathlib.Path(os.environ.get("CHAOS_HOME") or pathlib.Path(os.environ["LOCALAPPDATA"]) / "RSC Classroom" / "chaos")
ANIM_PY = HOME / "anim-venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main(item):
    item = pathlib.Path(item)
    t0 = time.time()

    def progress(stage, pct, msg):
        data = {"stage": stage, "percent": round(pct, 1), "message": msg, "elapsed": round(time.time() - t0, 1), "updated": time.time()}
        tmp = item / "progress.json.tmp"
        tmp.write_text(json.dumps(data), encoding="utf-8")
        for _ in range(20):
            try:
                os.replace(tmp, item / "progress.json")
                break
            except OSError:
                time.sleep(0.05)

    for f in ("video.mp4", "result.json", "error.txt"):
        (item / f).unlink(missing_ok=True)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "CHAOS_HOME": str(HOME)}

    progress("voice", 2, "Recording the narration")
    r = subprocess.run([sys.executable, str(HERE / "voice.py"), str(item)], cwd=str(HERE), env=env, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError("Narration failed: " + (r.stderr or r.stdout)[-800:])
    timing = json.loads((item / "timing.json").read_text(encoding="utf-8"))
    n = len(timing["scenes"])

    progress("render", 10, f"Animating scene 1 of {n}")
    if not ANIM_PY.exists():
        raise RuntimeError(f"The animation engine isn't installed (no {ANIM_PY}).")
    log = open(item / "render.log", "w", encoding="utf-8")
    p = subprocess.Popen([str(ANIM_PY), "-u", str(HERE / "scenes.py"), str(item)], cwd=str(HERE), env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    fallbacks = []
    for line in p.stdout:
        log.write(line)
        m = re.match(r"\[scene\] (\d+)/(\d+)", line)
        if m:
            done = int(m.group(1))
            progress("render", 10 + 80 * done / n, f"Animating scene {min(done + 1, n)} of {n}")
        if "fell back to a card" in line or "no picture" in line or "can't be drawn" in line:
            fallbacks.append(line.strip())
    p.wait()
    log.close()
    if p.returncode != 0:
        tail = (item / "render.log").read_text(encoding="utf-8", errors="replace")[-1200:]
        raise RuntimeError("Animation failed: " + tail)
    anim = next((x for x in (item / "media" / "videos").rglob("animation.mp4") if "partial" not in str(x)), None)
    if not anim:
        raise RuntimeError("The animation finished but no video file was found.")

    progress("finish", 92, "Joining picture and sound")
    out = item / "video.mp4"
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-v", "error", "-i", str(anim), "-i", str(item / "audio.wav"),
           "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out) + ".tmp.mp4"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError("Joining the video failed: " + r.stderr[-600:])
    os.replace(str(out) + ".tmp.mp4", out)

    progress("finish", 96, "Making the thumbnail")
    sys.path.insert(0, str(HERE))
    import thumb
    thumb_kind = thumb.make(item)

    script = json.loads((item / "script.json").read_text(encoding="utf-8"))
    chapters = []
    for sc, tm in zip(script["scenes"], timing["scenes"]):
        title = (sc.get("chapter") or "").strip()
        if title:
            chapters.append({"t": round(tm["start"], 2), "title": title})
    result = {"duration": timing["total"], "scenes": n, "chapters": chapters, "thumbnail": thumb_kind,
              "scene_fallbacks": fallbacks, "render_seconds": round(time.time() - t0, 1),
              "width": 1080 if script.get("format", "short") == "short" else 1920,
              "height": 1920 if script.get("format", "short") == "short" else 1080}
    (item / "result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    # the big intermediate files are not needed any more
    for x in (item / "media").rglob("partial_movie_files"):
        subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", str(x)] if os.name == "nt" else ["rm", "-rf", str(x)], capture_output=True)
    progress("done", 100, "Video ready")


if __name__ == "__main__":
    item = pathlib.Path(sys.argv[1])
    try:
        main(item)
    except Exception as e:
        (item / "error.txt").write_text(f"{e}\n\n{traceback.format_exc()}", encoding="utf-8")
        try:
            (item / "progress.json").write_text(json.dumps({"stage": "error", "percent": 0, "message": str(e)[:300], "updated": time.time()}), encoding="utf-8")
        except OSError:
            pass
        sys.exit(1)
