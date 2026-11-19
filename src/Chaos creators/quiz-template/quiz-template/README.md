# Chaos Creators – Quiz Video Template

Turns a questions spreadsheet into a ready-to-upload 9:16 quiz video (YouTube Shorts / Reels):

- **Intro:** the Chaos Creators logo slams in with a narrated welcome.
- **Questions:** each one is announced as "Question N". The options appear 2 seconds later, then a ticking timer runs.
- **Answer:** the reveal plays a chime, applause and confetti, and the "Did you know?" fact stays on screen for 3 seconds.
- **Outro:** "What's your score?", the logo and a Subscribe button, with narration.

You only edit **`questions.csv`**. Everything else stays the same.

---

## 1. One-time setup

You need **Python 3.10+** and **ffmpeg**.

| | Windows | macOS |
|---|---|---|
| ffmpeg | `winget install ffmpeg` | `brew install ffmpeg` |

Then, inside this folder:

```bash
pip install -r requirements.txt
python setup_models.py        # downloads the narration voice (~120 MB), once
```

## 2. Make a video

1. Open **`questions.csv`** in Excel or Google Sheets and replace the sample rows with your questions.
2. Save it as CSV. Excel: *File › Save As › CSV UTF-8*.
3. Run:

```bash
python make_quiz.py
```

The video is saved as `output/questions.mp4`. Rendering takes about 1–3 minutes.

To keep several quizzes, use one file per quiz:

```bash
python make_quiz.py science_quiz.csv
python make_quiz.py olympiad_maths.csv output/maths_ep1.mp4
```

## 3. The questions file

| column | what to put | example |
|---|---|---|
| `question` | the question text | Which planet is known as the Red Planet? |
| `option_a` … `option_d` | the four options | Venus / Mars / Jupiter / Saturn |
| `answer` | **A, B, C or D** | B |
| `fact` | one or two lines for "Did you know?" (can be empty) | Mars looks red because of iron oxide… |
| `seconds` | timer for this question only (empty = default 5) | 15 |

Tips:
- Any number of questions works. The intro says "N questions" automatically.
- Keep options short: up to about 25 characters fits on one line, and longer text shrinks.
- Questions up to about 3 lines fit nicely.
- For Olympiad-level questions, put 15–20 in `seconds`.

## 4. Settings (`settings.json`)

Edit these when you need a different kind of quiz. Change the words; keep the quotes and commas.

| setting | what it does |
|---|---|
| `quiz_badge` | yellow tag at the top, e.g. `"SCIENCE QUIZ"`, `"OLYMPIAD"` |
| `title_lines` | big intro title, one line per entry, e.g. `["Science", "Olympiad"]` |
| `intro_voice`, `outro_voice` | what the narrator says. `{channel}`, `{n}` and `{seconds}` are filled in for you |
| `intro_lines`, `outro_lines` | small text lines on the intro and outro screens |
| `timer_seconds` | default timer (5) |
| `options_delay` | wait before options appear (2) |
| `answer_hold` | how long the answer and fact stay (3) |
| `question_voice` | what is said before each question; `{q}` = its number |
| `voice` | narrator voice: `af_heart` (default female), `af_bella`, `am_adam` (male), `bf_emma` (British) |
| Hindi narration | set `"voice": "hf_alpha"` (or `hm_omega` for male) and `"voice_lang": "hi"`, then write `intro_voice`, `outro_voice` and `question_voice` in Devanagari, e.g. `"प्रश्न {q}"` |
| `logo`, `logo_small` | logo files in `assets/`. The small one shows on every question |

## 5. Using it with Canva (optional)

Canva works best as the finishing step:

1. Upload the MP4 to Canva (*Uploads › Upload files*), or create a *Mobile Video* design and drop it in.
2. Add anything extra there: background music, stickers, your own voice, an end screen.
3. Download as MP4 and upload to YouTube.

## Folder

```
make_quiz.py      ← the generator (no need to edit)
questions.csv     ← YOUR QUESTIONS
settings.json     ← titles, voice, timings
assets/           ← logo.png (intro/outro), logo_small.png (corner logo)
fonts/            ← Poppins (SIL Open Font License, see OFL.txt)
models/           ← narration voice, created by setup_models.py
output/           ← finished videos
```
