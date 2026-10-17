# Server: the software encoder fallback can pick a hardware encoder (h264_rkmpp on linux-arm64)

`NodeAvVideoEncoder` uses `NodeAv.Codec.findEncoder(codecId)` as its software encoder (`getSoftwareCodec()` in `video-encoder.ts`). FFmpeg returns whichever encoder it registered first for that codec ID, and that isn't always a software one. In node-av's linux-arm64 build, the first H.264 and HEVC encoders are `h264_rkmpp` and `hevc_rkmpp` (Rockchip MPP), listed before libx264 and libx265. So on any arm64 Linux machine that isn't a Rockchip board (AWS Graviton, Ampere, Docker on Apple silicon), the encoder that should be the safe fallback is a hardware one that can't run there.

## What happens

On @mediabunny/server 1.61.6 with node-av 6.x in a linux-arm64 container (Debian, no Rockchip hardware):

- `bitrateMode: 'quantizer'` with `hardwareAcceleration: 'prefer-software'` (or with no usable hardware encoder) throws: `Encoder 'h264_rkmpp' cannot be used for quantizer-based encoding.`
- In the other bitrate modes, `h264_rkmpp` is still the encoder that gets chosen, on a machine with no MPP device.

`Codec.findEncoderByName('libx264')` returns the encoder fine on the same machine, so libx264 is in the build; it just isn't the first one registered.

## Suggested fix

`getSoftwareCodec()` already prefers `prores_ks` by name for ProRes, and the alpha path prefers `libvpx-vp9`. The same approach would work for the other codecs: try known software encoders by name first, then fall back to `findEncoder`:

| Codec | Preferred software encoders |
|---|---|
| avc | `libx264`, `libopenh264` |
| hevc | `libx265` |
| vp8 | `libvpx` |
| vp9 | `libvpx-vp9` |
| av1 | `libsvtav1`, `libaom-av1` |

Something like:

```ts
const SOFTWARE_ENCODERS: Partial<Record<VideoCodec, string[]>> = {
	avc: ['libx264', 'libopenh264'],
	hevc: ['libx265'],
	vp8: ['libvpx'],
	vp9: ['libvpx-vp9'],
	av1: ['libsvtav1', 'libaom-av1'],
	prores: ['prores_ks'],
};

const getSoftwareCodec = () => {
	for (const name of SOFTWARE_ENCODERS[this.codec] ?? []) {
		const codec = NodeAv.Codec.findEncoderByName(name as NodeAv.FFEncoderCodec);
		if (codec) return codec;
	}
	return NodeAv.Codec.findEncoder(codecId);
};
```

A side benefit: the quantizer mapping that follows already knows these encoder names, so a quantizer encode would no longer reach the `cannot be used for quantizer-based encoding` branch on builds that include a hardware encoder.

## Workaround

We currently wrap `Codec.findEncoder` on the node-av instance that @mediabunny/server loads, so it returns the encoders above when they exist. It works, but it relies on loading the exact same node-av module instance as the server, which is fragile.
