---
"@framefields/vision-sam": minor
"framefields": minor
---

`sam3: { redetect: N }` runs the last text prompt again every N frames and adds the instances no tracked object covers yet: people who walk in, step out from behind someone, or were lost. With `merge` they join the one object (what it already tracks stays at full resolution); otherwise they become new track IDs up to `maxObjects`. The text features are encoded once per prompt.
