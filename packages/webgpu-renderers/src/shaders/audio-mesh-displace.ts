/**
 * @file audio-mesh-displace.ts
 * WGSL compute shader for audio FFT & latent vector 3D mesh vertex displacement.
 * Processes 16-float (64-byte) vertex streams in parallel at 256 threads per workgroup.
 */

export const audioMeshDisplaceWgsl = `
struct AudioLatentBuffer {
    fftBins       : array<f32, 1024>,
    bassEnergy    : f32,
    drumTransient : f32,
    vocalEnergy   : f32,
    timeMs        : f32,
};

struct DeformParams {
    mode                : u32, // 0 = normal_extrusion, 1 = radial_pulse, 2 = harmonic_wave, 3 = twist, 4 = ripple
    freqMinBin          : u32,
    freqMaxBin          : u32,
    vertexCount         : u32,
    amplitudeMultiplier : f32,
    damping             : f32,
    timeMs              : f32,
    pad                 : f32,
};

struct VertexData {
    // 16 floats = 64 bytes per vertex
    f : array<f32, 16>,
};

@group(0) @binding(0) var<storage, read>       audio       : AudioLatentBuffer;
@group(0) @binding(1) var<uniform>             params      : DeformParams;
@group(0) @binding(2) var<storage, read>       srcVertices : array<VertexData>;
@group(0) @binding(3) var<storage, read_write> dstVertices : array<VertexData>;

@compute @workgroup_size(256)
fn cs_displace(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.vertexCount) {
        return;
    }

    let src = srcVertices[idx];
    var outV = src;

    // Extract attributes
    let pos  = vec3<f32>(src.f[0], src.f[1], src.f[2]);
    let uv   = vec2<f32>(src.f[3], src.f[4]);
    var norm = vec3<f32>(src.f[5], src.f[6], src.f[7]);

    let normLen = length(norm);
    if (normLen > 0.0001) {
        norm = norm / normLen;
    } else {
        norm = vec3<f32>(0.0, 1.0, 0.0);
    }

    // Determine frequency bin
    let minBin = max(0u, params.freqMinBin);
    let maxBin = min(1023u, max(minBin, params.freqMaxBin));
    let freqNorm = clamp(uv.x, 0.0, 1.0);
    let binIdx = u32(clamp(f32(minBin) + freqNorm * f32(maxBin - minBin), 0.0, 1023.0));
    let freqAmplitude = audio.fftBins[binIdx];

    var displacedPos = pos;
    var displacedNorm = norm;

    if (params.mode == 0u) {
        // Mode 0: normal_extrusion
        let bassOsc = sin(params.timeMs * 0.01 + pos.y * 0.5);
        let displacementMag = (freqAmplitude * 45.0 + audio.bassEnergy * 20.0 * bassOsc) * params.amplitudeMultiplier;
        displacedPos = pos + norm * displacementMag;

        // Dynamic normal perturbation based on spatial gradient
        let tangentDelta = cos(params.timeMs * 0.01 + pos.y * 0.5) * 0.5 * audio.bassEnergy * params.amplitudeMultiplier;
        var perturbed = norm + vec3<f32>(0.0, -tangentDelta * 0.05, 0.0);
        let pLen = length(perturbed);
        if (pLen > 0.0001) {
            displacedNorm = perturbed / pLen;
        }
    } else if (params.mode == 1u) {
        // Mode 1: radial_pulse
        let rLen = length(pos);
        var dir = norm;
        if (rLen > 0.0001) {
            dir = pos / rLen;
        }
        let pulse = (audio.bassEnergy * 35.0 + audio.drumTransient * 45.0) * params.amplitudeMultiplier;
        let dampingFactor = exp(-max(0.0, params.damping) * rLen * 0.01);
        displacedPos = pos + dir * (pulse * dampingFactor);
        displacedNorm = norm;
    } else if (params.mode == 3u) {
        // Mode 3: twist. Each slice turns about Y by its height times the
        // twist rate; a resting twist plus the bass, so it winds on the drop.
        let rate = (0.35 + audio.bassEnergy) * 0.004 * params.amplitudeMultiplier;
        let a = pos.y * rate;
        let c = cos(a);
        let s = sin(a);
        displacedPos = vec3<f32>(c * pos.x - s * pos.z, pos.y, s * pos.x + c * pos.z);
        displacedNorm = vec3<f32>(c * norm.x - s * norm.z, norm.y, s * norm.x + c * norm.z);
    } else if (params.mode == 4u) {
        // Mode 4: ripple. Concentric waves travel out across XY from the
        // origin, struck harder by the drums and fading with distance.
        let r = length(pos.xy);
        let phase = r * 0.05 - params.timeMs * 0.015;
        let height = (6.0 + audio.drumTransient * 28.0 + audio.bassEnergy * 10.0) * params.amplitudeMultiplier;
        let fade = exp(-max(0.0, params.damping) * r * 0.002);
        displacedPos = pos + norm * (sin(phase) * height * fade);
        // The wave's slope tilts the normal toward the travel direction.
        var radial = vec3<f32>(0.0, 0.0, 0.0);
        if (r > 0.0001) {
            radial = vec3<f32>(pos.x / r, pos.y / r, 0.0);
        }
        let slope = cos(phase) * 0.05 * height * fade;
        var perturbed = norm - radial * slope;
        let pLen = length(perturbed);
        if (pLen > 0.0001) {
            displacedNorm = perturbed / pLen;
        }
    } else {
        // Mode 2: harmonic_wave
        let wavePhase = params.timeMs * 0.005 + pos.y * 0.2;
        let wave = (sin(wavePhase) * audio.bassEnergy * 25.0 + cos(wavePhase * 2.0 + pos.x * 0.1) * freqAmplitude * 20.0) * params.amplitudeMultiplier;
        displacedPos = pos + norm * wave;

        let dWaveDy = cos(wavePhase) * 0.2 * audio.bassEnergy * 25.0 * params.amplitudeMultiplier;
        var perturbed = norm - vec3<f32>(0.0, dWaveDy * 0.03, 0.0);
        let pLen = length(perturbed);
        if (pLen > 0.0001) {
            displacedNorm = perturbed / pLen;
        }
    }

    // Write deformed position and normal
    outV.f[0] = displacedPos.x;
    outV.f[1] = displacedPos.y;
    outV.f[2] = displacedPos.z;

    outV.f[5] = displacedNorm.x;
    outV.f[6] = displacedNorm.y;
    outV.f[7] = displacedNorm.z;

    dstVertices[idx] = outV;
}
`;
