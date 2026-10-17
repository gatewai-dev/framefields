---
"framefields": patch
"@framefields/vision": patch
---

Instance segmentation does far less work per frame. The RTMDet-Ins export ran NMS on the CPU in the middle of its graph and returned a full 640×640 mask for every detection: about 40 per frame, 65 MB of floats, computed on the GPU and copied back. The runner now cuts the graph at load time before its first data-dependent step and does the rest itself: top-k, per-class NMS with the export's thresholds, and each mask's three dynamic 1×1 layers at 80×80, only for the detections a layer keeps. `detect()` computes no masks at all.

Results match the end2end graph: the same detections, scores and boxes, and masks with IoU above 0.98 on the reference frames (edges differ by one interpolation step). The model file and its SHA-256 check are unchanged; a model without the expected head tensors still runs end to end.

The smoke project's `vision` export on an Apple Silicon Mac: 22.3 s → 15 s.
