# Explainers (sample, 2026-11-22)

Animated 1-minute Shorts and Reels that explain how something works, made of moving diagrams plus AI
narration. There's no background music; Rahul adds his own. The first sample is
`how_chatgpt_writes/`.

## How a video is made

1. `script.json` holds the title and one narration line per scene, about 150 words for under 60 s.
2. `voice.py` (engine venv) makes the Kokoro voice for each scene. It writes the scene timings, the
   caption chunks and `audio.wav` (voice plus a whoosh on each scene change).
3. `scenes.py` (anim venv, Manim) draws the animation. Each scene lasts exactly as long as its
   narration, and key moments wait for the caption that mentions them (`self.cue`).
4. `finish.py` (engine venv) joins the picture and the sound into `videos/<title> - Shorts - <date>.mp4`.

The work files go to `%LOCALAPPDATA%\RSC Classroom\chaos\explainers\<name>`. The anim venv
(`chaos\anim-venv`) has Manim and fontTools. Text is drawn from the Poppins font files by
`gtext.py`, because Manim's normal text takes 1–20 s per line on this PC.

```
V=%LOCALAPPDATA%\RSC Classroom\chaos
venv\python  voice.py  how_chatgpt_writes  %V%\explainers\how_chatgpt_writes
anim-venv\python scenes.py how_chatgpt_writes %V%\explainers\how_chatgpt_writes [preview]
venv\python  finish.py how_chatgpt_writes  %V%\explainers\how_chatgpt_writes
```

## The same recipe for any AI model

Every AI-model Short follows one shape. Only the middle scenes change from model to model:

| Beat | What's on screen |
|---|---|
| Hook (5 s) | The model doing its job: a chat reply typing, a picture appearing, a voice turning into text |
| What goes in | The input split into pieces: tokens, image pixels/patches, sound waves |
| Turned into numbers | A grid of numbers per piece |
| The core trick (2–3 scenes) | Depends on the model, see below |
| What comes out | Score bars, a picture sharpening, words appearing |
| How it learned | Pages of training data, a guess marked wrong then right, parameters changing, human feedback |
| Outro | One-line takeaway, logo, follow |

Core-trick scenes by kind of model:

- **Chat models (ChatGPT, Claude, Gemini, Llama):** attention links, layers, next-token scores, the repeat loop.
- **Image generators (Midjourney, DALL·E, Stable Diffusion):** a picture of pure noise cleaned up step by step, guided by the prompt's words.
- **Speech models (Whisper, Siri):** sound wave, then a spectrogram, then letters.
- **Translators:** the same meaning grid feeding two languages.
- **Recommenders (YouTube, Netflix):** you and the videos as dots, with similar ones close together.

Model-specific facts, like the number of layers or parameters, go in only when they're public and checked.
Scores that are just examples are labelled "example scores" on screen.
