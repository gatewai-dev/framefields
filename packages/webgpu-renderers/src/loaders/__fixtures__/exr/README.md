# OpenEXR decoder fixtures

Encoded by independent tools so `exr-loader.test.ts` checks the decoder against
the reference implementation, not against an encoder of our own.

1. A 23×37 RGB float image whose pixels are `fixtureValue(x, y, c)` in
   `exr-loader.test.ts` was written as raw `gbrpf32le` and encoded with
   `ffmpeg -c:v exr -compression none -format float` (`src.exr`).
2. Each `<compression>-<half|float>.exr` is
   `exrmetrics --convert -z <compression> --pixelmode <half|float> src.exr -o …`
   (OpenEXR 3.x reference library).
3. `tiled-zip-half.exr` is `exrmaketiled -o -z zip -t 16 16 zip-half.exr`;
   `tiled-mip-piz-float.exr` is `exrmaketiled -m -z piz -t 16 8 piz-float.exr`.
4. `b44-half.exr` (lossy, unsupported) checks the error message.

37 rows span several ZIP (16-line) and PIZ (32-line) blocks with a partial last
block; the first five columns are constant runs for RLE.
