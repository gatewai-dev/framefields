---
"framefields": patch
"@framefields/renderer": patch
"@framefields/webgpu-renderers": patch
---

Requires mediabunny and @mediabunny/server 1.61.6 or newer. Encoded video now carries correct colour: older versions converted RGB to YUV with BT.601 and left the output untagged, so reds came out dull and blues shifted. 1.61.5, the first release with the colour fix, also slowed RGB encoding about 5×; 1.61.6 fixes that, and the new minimum keeps installs off 1.61.5.
