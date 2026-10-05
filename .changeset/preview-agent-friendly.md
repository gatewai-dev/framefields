---
"gitframes": patch
---

Preview: the page's errors and the server's lifecycle are printed where the preview runs, `session.closed` resolves with why it stopped, the playhead survives reloads and `#t=` links, and `window.gitframesPreview` lets scripts seek, play and read state. The audio mixer no longer prints its progress at info level.

Preview notes: pause and click the picture (or drag an area) to pin a note to that spot and moment. Notes are saved in `.gitframes/preview-notes/` (`notes.json` plus the frame with the spot marked), printed in the preview's output, listed in a Notes panel and on the timeline, and can be ticked off or copied for a chat. `notesDir` moves them, `false` turns them off.

Preview playback: pausing keeps the frames rendered ahead (and keeps filling them), so playing on starts at once; moving the playhead clears them. Fixes a seek that could wait forever when it landed while a buffered frame was drawing.
