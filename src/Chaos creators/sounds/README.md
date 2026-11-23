# Chaos Creators sound library

Drop audio files (mp3, wav, ogg, m4a, flac) into these folders. Each video picks from them at
random. If a folder is empty, the engine uses its built-in synthetic sound instead.

| Folder      | Used for                                         | Good length |
|-------------|--------------------------------------------------|-------------|
| `applause/` | after every answer reveal (up to 4 rotate)       | 2–4 s       |
| `reveal/`   | the "correct answer" ding                        | 0.5–2 s     |
| `intro/`    | sting / hit at the very start                    | 2–6 s       |
| `outro/`    | sting under "Thanks for watching"                | 3–9 s       |
| `whoosh/`   | transition into each question (up to 3 rotate)   | 0.3–1.2 s   |
| `music/<mood>/` | quiet background tune under the whole video, looped and dipped under the voice. Moods: `upbeat` (default), `epic`, `suspense`; chosen in the studio or with a CSV line `Music mood,epic` | any |
| `kid voice sounds/` | recorded kid voice, on by default (studio "Kid voice" tick box, CSV line `Kid voice,off` to skip): `1_intro/FULL_intro` or `2_intro_alternative/FULL_intro_alternative` as the intro; a `5_mixture/` middle line before question 3 or 4 of a Short (about every 5 questions in long videos: `mix_06` halfway, `mix_07` almost there, `mix_04` before question 11); the ending is `3_ending/` lines 01, 02, 03, 07 in a Short and `FULL_ending_assembled` in long videos. Every voice clip (recorded or AI) is levelled to the same speech loudness | any |
| `unused/`   | parked files the engine never plays              |             |

**Credits:** Creative Commons (CC BY) tracks need their credit line in `CREDITS.json`
(`"file name": "credit text"`). When a video uses one, the line is added to its YouTube description.

Loudness is levelled automatically, and long files are trimmed and faded out.
File names starting with `_` are ignored, so rename a file that way to switch it off.

## Licence rules (important for YouTube)

Only use sounds whose licence allows use in monetised YouTube videos, with no Content ID:

- **YouTube Audio Library** (YouTube Studio → Audio library). Best for `music/`. Filter by
  "No attribution required". These tracks never get Content ID claims on your channel.
- **Pixabay** music and sound effects (Pixabay Content License). Free for commercial use with no
  attribution. Avoid tracks marked as registered with Content ID.
- **Mixkit** sound effects and music (Mixkit free licence).
- **Freesound.org**, only files marked **CC0**.

Don't use Canva library music here. Canva licenses its audio per design and per video, so
reusing it across auto-generated videos can trigger Content ID claims.

Keep a note of where each file came from, e.g. `music/upbeat-quiz.mp3` plus a line in
`SOURCES.txt` such as `upbeat-quiz.mp3 - YouTube Audio Library - "Track name" by Artist`.

## Blocked tracks (Content ID claims; never use again)

| Track | Problem | Date |
|---|---|---|
| `unused/_CLAIMED-alexander-nakarada-superepic(chosic.com).mp3` ("Superepic" by Alexander Nakarada, chosic.com, CC BY 4.0) | Content ID claim blocked the MS Dhoni Short (73 s). Shorts over 1 minute with a claim are blocked worldwide, whatever the licence or credit line says. | 2026-11-19 |
| `unused/_CLAIMED-roa-music-summer-madness(chosic.com).mp3` ("Summer Madness" by Roa Music, chosic.com, CC BY 4.0) | Copyrighted / Content ID risk; Rahul excluded it from the audio list. | 2026-11-20 |
