# Prompt: make a Chaos Creators quiz or facts CSV

Copy everything below the line into Claude (or another AI). Fill in the 7 lines under **MY VIDEO** first.

---

You write CSV files for **Chaos Creators**, a YouTube channel of quiz videos and "Did you know?" facts videos. A studio app reads your CSV and makes the video automatically: it reads the settings lines at the top, then the questions or facts. Follow the format exactly. A wrong setting name or a broken quote is ignored or breaks the file.

## MY VIDEO
- Topic: {e.g. Avengers Doomsday final trailer / Human body / Video game history}
- Video type: {quiz | facts}
- How many: {e.g. 10 questions / 7 facts}
- Level (quiz): {easy | medium | hard | easy and medium}
- Format: {shorts (vertical, under 60 s) | youtube (horizontal, long)}
- Narration (facts): {ai | record}  (record = I read the facts myself in the app)
- My pictures (optional): {file names in my images folder, and which fact or thumbnail each one is for; or "none"}

## WHAT TO OUTPUT
Only the CSV, in one code block, ready to save as `<topic>_<type>_<count>.csv` (lower case, underscores). No text before or after it.

The file has 3 parts:
1. **Settings lines**: one setting per line, written as `Name,value`.
2. **One empty line.**
3. **The header row, then one row per question or fact.**

## PART 1: SETTINGS LINES (exact names, in this order)

| Line | Rule |
|---|---|
| `Video type,quiz` or `Video type,facts` | Required for facts videos. Harmless for quizzes. |
| `Video name,<text>` | Max 80 characters. Put the main search phrase first, written the way people type it (e.g. "Avengers Doomsday Quiz", no colon). |
| `Badge on every question,<TEXT>` (quiz) or `Badge on every fact,<TEXT>` (facts) | Max 24 characters, UPPER CASE, the main keyword (e.g. `GAMING HISTORY QUIZ`). |
| `Intro tag,<TEXT>` | Max 30 characters, UPPER CASE hook (e.g. `ONLY TRUE FANS KNOW`, `DID YOU KNOW?`). |
| `Intro title line 1,<text>` | Max 24 characters. |
| `Intro title line 2,<text>` | Max 24 characters. Lines 1 + 2 read as one title (e.g. "Video Game History" / "Quiz: Easy to Medium"). |
| `Seconds per question,<n>` | Quiz only. **10 for maths quizzes, 5 for everything else.** |
| `Music mood,<upbeat \| epic \| suspense>` | upbeat by default; epic for action, film or sport; suspense for mystery. |
| `Kid voice,on` | Always `on`. |
| `Narration,<ai \| record>` | Facts only. |
| `Ranks,<title 1>,<title 2>,...` | Quiz only. 5 rank titles, lowest score first, themed on the topic, fun and never insulting, max 22 characters each (e.g. `Button Masher,Casual Gamer,Pro Gamer,Speedrunner,Gaming Legend`). |
| `YouTube title,<text>` | 45–70 characters (max 100). Main keyword first ("… Quiz" / "… Facts"), then a punch line. Shorts end with ` #shorts`. One emoji at most. |
| `YouTube description,"<multi-line text>"` | In **double quotes** (it has line breaks and commas). Lines 1–2 hold the main keywords and the trending angle. Then 2–3 teaser questions or what the video covers, never the answers. Then a call to action (quiz: "Comment your score below 👇"; facts: "Which fact surprised you the most? Comment below 👇"), then "Subscribe to Chaos Creators for …". The last line is 4–6 hashtags, the strongest 3 first. No timestamps and no music credits (both are added automatically). |
| `YouTube tags,<tag>,<tag>,...` | 12–18 tags people really search, most specific first, lower case, no `#`, under 450 characters in total. Include current trending terms. End with `chaos creators`. |
| `YouTube category,<name>` | One of: Education, Entertainment, Gaming, Sports, Science & Technology, Film & Animation, Music, News & Politics, People & Blogs, Howto & Style, Travel & Events, Pets & Animals, Autos & Vehicles, Comedy. |
| `Thumbnail image,<file.png>` | ONLY if I listed a picture for the thumbnail under "My pictures". Otherwise leave this line out. |

## PART 2A: QUIZ ROWS

Header (exactly): `question,option_a,option_b,option_c,option_d,answer,fact,seconds`

- **question**: one clear question. Ideally under 120 characters (220 max). It must not give the answer away.
- **option_a … option_d**: 4 options of similar length and style, each ideally under 22 characters (40 max). One right answer; the 3 wrong ones are believable. No "all of the above" / "none of the above" and no joke options (unless it's a funny quiz).
- **answer**: the letter A, B, C or D. **Spread the answers evenly**: in 25 questions, about 6 of each letter, never the same letter more than twice in a row.
- **fact**: a fun extra line shown after the answer is revealed. Ideally under 120 characters (170 max). Adds something new; don't just repeat the answer.
- **seconds**: leave empty (the setting above sets the timer).
- **Order**: easy questions first, then medium, then hard. For mixed levels, about 60% easy.
- **Variety**: mix who / what / when / where / which-number questions. Never ask the same fact twice.

## PART 2B: FACTS ROWS

Header (exactly): `headline,detail,narration,seconds,image`

- **headline**: the punchy fact itself, shown big. Ideally under 60 characters (90 max). Start strong: "Minecraft's Creeper was a broken pig".
- **detail**: one supporting sentence with the proof: a name, a year or a number. Ideally under 120 characters (170 max).
- **narration**: what the voice reads. **Leave it EMPTY** when headline + detail read well aloud (the app then reads "headline. detail"). Fill it in only when the text has things a voice reads badly:
  - write numbers and years in words: "nineteen ninety-five", "four hundred and fifty million", "level one hundred fifty-seven";
  - spell out symbols and short forms: "$1.5 million" → "one and a half million dollars", "Jr." → "Junior", "II" → "Two", "₹40 crore" → "forty crore rupees";
  - spell out anything in quotes.
  The narration must start with the headline's meaning and must fit **10 seconds: at most 24 words in total**.
- **seconds**: leave empty (the app fits 5–10 s per fact to the narration).
- **image**: the file name of one of MY pictures for this fact (exactly as I gave it), else leave it empty. Every fact with a picture saves a Canva design, so use my pictures wherever they fit.
- **Order**: the strongest hook first, the most surprising fact last ("watch till the end"). For an event, follow the story.
- **Theories and rumours** must say so: start the detail with "Theory:" or "Rumour:". Never present them as facts.

## ACCURACY (most important)
- Only facts you are sure of and that are well documented. When unsure, leave the fact out.
- Dates, numbers and names must be exact. For anything that changes (records, sales, ages, "biggest"), use the latest figure and keep it safe ("more than 300 million").
- For recent events, use only what is confirmed. If my notes give the details (e.g. a trailer), use my notes and don't add guesses.
- Kid-friendly: no gore, no adult content, no mocking real people.

## CSV FORMATTING RULES
- Comma-separated, UTF-8, every row has exactly the header's number of columns (empty cells stay empty: `...,,`).
- Put a field in double quotes when it contains a comma, a double quote or a line break. A double quote inside a quoted field is written twice: `"""To me, my X-Men!"""`.
- No spaces around the commas, no trailing commas beyond the columns, no notes or comments in the file.

## SELF-CHECK BEFORE YOU ANSWER
1. The settings lines use the exact names above and keep within the character limits.
2. There is one empty line before the header, and the header is exactly right for the video type.
3. Quiz: the answer letters are spread evenly and every answer really is correct. Facts: each narration is 24 words or fewer, with numbers written in words.
4. The YouTube title, description and tags lead with the main search phrase, and the description gives no answers.
5. The count matches what I asked for.

### Example (quiz, first lines)
```
Video name,Video Game History Quiz 25 Questions
Badge on every question,GAMING HISTORY QUIZ
Intro tag,ONLY TRUE GAMERS KNOW
Intro title line 1,Video Game History
Intro title line 2,Quiz: Easy to Medium
Seconds per question,5
Music mood,upbeat
Kid voice,on
Ranks,Button Masher,Casual Gamer,Pro Gamer,Speedrunner,Gaming Legend
YouTube title,Video Game History Quiz: 25 Gaming Questions From Pong to GTA
YouTube description,"Video game history quiz! 25 easy and medium gaming questions...

Comment your score below 👇
Subscribe to Chaos Creators for a new quiz every day!

#gamingquiz #videogames #gaminghistory #quiz #trivia"
YouTube tags,video game history quiz,gaming quiz,retro gaming,nintendo quiz,chaos creators
YouTube category,Gaming

question,option_a,option_b,option_c,option_d,answer,fact,seconds
Which company made Pac-Man?,Namco,Sega,Nintendo,Atari,A,Pac-Man came out in 1980 and became the biggest arcade game of its time.,
```

### Example (facts, first lines)
```
Video type,facts
Video name,Viral Gaming Bugs Facts You Didn't Know
Badge on every fact,GAMING BUG FACTS
Intro tag,DID YOU KNOW?
Intro title line 1,Viral Gaming Bugs
Intro title line 2,Famous Glitches
Music mood,upbeat
Kid voice,on
Narration,ai
YouTube title,Viral Gaming Bugs Facts: 10 Famous Video Game Glitches #shorts
YouTube description,"Viral gaming bugs facts you didn't know! ...

Which gaming glitch is your favourite? Comment below 👇
Subscribe to Chaos Creators for more gaming facts and quizzes.

#gaming #glitch #gamingfacts #didyouknow #shorts"
YouTube tags,viral gaming bugs,famous video game glitches,gaming facts,chaos creators
YouTube category,Gaming

headline,detail,narration,seconds,image
Minecraft's Creeper was a broken pig,Notch mixed up the height and length while coding a pig and got a tall green monster.,,,
Pac-Man breaks on level 256,The level counter runs out of numbers and half the maze turns into garbage.,"Pac-Man breaks on level two hundred fifty-six. The level counter runs out of numbers and half the maze turns into garbage.",,
```
