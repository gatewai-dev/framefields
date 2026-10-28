/**
 * @file packages/webgpu-renderers/src/renderer3d/swarm3d-pipeline.ts
 * GPU Compute Simulation & Instancing Pipeline for 3D Particle Swarms, Faceted Shards & Secondary Sparks.
 * Supports 3D curl noise, 3D attractors, centripetally-confined 3D vortex/cyclone fields,
 * floor collision with Coulomb sliding friction, angular tumble, kinetic/friction HDR heat emission,
 * multi-variant mesh slice packing, and GPU-coupled secondary spark emission.
 */

export const SWARM_PARTICLE_BYTES = 80; // 5 x vec4<f32>
export const SWARM_INSTANCE_BYTES = 64; // 4 x vec4<f32>
export const SWARM_PARAM_VEC4S = 32;
export const SWARM_MAX_ATTRACTORS = 5;
export const SWARM_SNAPSHOT_EVERY = 24;
export const SWARM_MAX_SNAPSHOTS = 64;
export const SWARM_WORKGROUP = 64;

export const SWARM_SIM_WGSL = /* wgsl */ `
struct SwarmParticle3D {
	pos      : vec3<f32>, // world-space position (px, y down)
	age      : f32,       // seconds alive
	vel      : vec3<f32>, // world-space velocity (px/s)
	life     : f32,       // total lifetime (seconds; <= 0 means dead)
	quat     : vec4<f32>, // unit orientation quaternion
	angVel   : vec3<f32>, // angular velocity (rad/s)
	heat     : f32,       // smoothed kinetic/friction heat [0..1+]
	scale    : f32,       // size multiplier (for sparks: radius in px)
	variant  : u32,       // mesh variant index
	seed     : u32,       // per-particle deterministic random id
	contact  : f32,       // floor contact factor [0..1]
};

struct InstanceData {
	posScale : vec4<f32>, // xyz = translation, w = mesh scale
	quat     : vec4<f32>, // xyzw = orientation quaternion
	color    : vec4<f32>, // rgba = color multiplier
	emissive : vec4<f32>, // rgb = sRGB emissive color, w = emissiveIntensity
};

struct Params { v : array<vec4<f32>, ${SWARM_PARAM_VEC4S}> };

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> particles : array<SwarmParticle3D>;
@group(0) @binding(2) var<storage, read_write> instances : array<InstanceData>;

fn pcg(v : u32) -> u32 {
	let state = v * 747796405u + 2891336453u;
	let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}

fn rnd(idx : u32, channel : u32, seed : u32) -> f32 {
	return f32(pcg(idx * 16u + channel + pcg(seed))) / 4294967295.0;
}

fn hash3(p : vec3<f32>) -> f32 {
	let q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
	let r = q + dot(q, q.yzx + 33.33);
	return fract((r.x + r.y) * r.z);
}

fn vnoise3(p : vec3<f32>) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let u = f * f * (3.0 - 2.0 * f);
	let n000 = hash3(i);
	let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
	let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
	let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
	let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
	let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
	let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
	let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
	return mix(
		mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
		mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
		u.z
	);
}

fn fbm3(p : vec3<f32>) -> f32 {
	return vnoise3(p) * 0.6 + vnoise3(p * 2.02 + 13.5) * 0.3 + vnoise3(p * 4.05 + 31.7) * 0.1;
}

fn curl3(p : vec3<f32>) -> vec3<f32> {
	let e = 0.02;
	let dx = vec3<f32>(e, 0.0, 0.0);
	let dy = vec3<f32>(0.0, e, 0.0);
	let dz = vec3<f32>(0.0, 0.0, e);

	let p0 = p;
	let p1 = p + vec3<f32>(31.4, 15.9, 26.5);
	let p2 = p + vec3<f32>(65.3, 58.9, 79.3);

	let dAy_dz = (fbm3(p1 + dz) - fbm3(p1 - dz)) / (2.0 * e);
	let dAz_dy = (fbm3(p2 + dy) - fbm3(p2 - dy)) / (2.0 * e);

	let dAz_dx = (fbm3(p2 + dx) - fbm3(p2 - dx)) / (2.0 * e);
	let dAx_dz = (fbm3(p0 + dz) - fbm3(p0 - dz)) / (2.0 * e);

	let dAx_dy = (fbm3(p0 + dy) - fbm3(p0 - dy)) / (2.0 * e);
	let dAy_dx = (fbm3(p1 + dx) - fbm3(p1 - dx)) / (2.0 * e);

	return vec3<f32>(dAz_dy - dAy_dz, dAx_dz - dAz_dx, dAy_dx - dAx_dy);
}

fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
	return vec4<f32>(
		a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	);
}

fn spawn3D(i : u32, idx : u32, birthFrac : f32) {
	let baseSeed = u32(P.v[1].y);
	let timeSalt = u32(max(0.0, P.v[0].y + 100.0) * 997.0);
	let seed = baseSeed + timeSalt;
	let shape = u32(P.v[4].x); // 0=point, 1=box, 2=sphere, 3=shell, 4=ring, 5=disc
	let ex = P.v[4].y; let ey = P.v[4].z; let ez = P.v[4].w;
	let ew = P.v[5].x; let eh = P.v[5].y; let ed = P.v[5].z; let er = P.v[5].w;

	let r0 = rnd(idx, 0u, seed);
	let r1 = rnd(idx, 1u, seed);
	let r2 = rnd(idx, 2u, seed);

	var pos = vec3<f32>(ex, ey, ez);
	if (shape == 1u) {
		pos = vec3<f32>(ex + (r0 - 0.5) * ew, ey + (r1 - 0.5) * eh, ez + (r2 - 0.5) * ed);
	} else if (shape == 2u) {
		let phi = r0 * 6.2831853;
		let cosTheta = (r1 * 2.0) - 1.0;
		let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
		let rad = er * pow(r2, 0.33333);
		pos = vec3<f32>(ex + cos(phi) * sinTheta * rad, ey + sin(phi) * sinTheta * rad, ez + cosTheta * rad);
	} else if (shape == 3u) {
		let phi = r0 * 6.2831853;
		let cosTheta = (r1 * 2.0) - 1.0;
		let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
		pos = vec3<f32>(ex + cos(phi) * sinTheta * er, ey + sin(phi) * sinTheta * er, ez + cosTheta * er);
	} else if (shape == 4u || shape == 5u) {
		let phi = r0 * 6.2831853;
		let ringJitter = 1.0 + (r1 - 0.5) * 0.35;
		let rad = select(er * ringJitter, er * sqrt(r1), shape == 5u);
		pos = vec3<f32>(ex + cos(phi) * rad, ey + (r2 - 0.5) * eh, ez + sin(phi) * rad);
	}

	let dir = P.v[6].xyz;
	let spread = P.v[6].w;
	let speedMin = P.v[7].x;
	let speedMax = P.v[7].y;
	let spd = mix(speedMin, speedMax, rnd(idx, 3u, seed));

	var vDir = normalize(dir);
	if (length(dir) < 0.001) {
		vDir = vec3<f32>(0.0, -1.0, 0.0);
	}
	if (spread > 0.001) {
		let theta = (rnd(idx, 4u, seed) - 0.5) * spread;
		let phi = rnd(idx, 5u, seed) * 6.2831853;
		var tangent = cross(vDir, vec3<f32>(0.0, 1.0, 0.0));
		if (length(tangent) < 0.01) {
			tangent = cross(vDir, vec3<f32>(1.0, 0.0, 0.0));
		}
		tangent = normalize(tangent);
		let bitangent = cross(vDir, tangent);
		vDir = normalize(vDir + (tangent * cos(phi) + bitangent * sin(phi)) * tan(theta));
	}

	// If vortex is active, give newly spawned shards an initial orbital velocity component
	var initVel = vDir * spd;
	let vortexSwirl = P.v[14].w;
	if (abs(vortexSwirl) > 0.001) {
		let vCenter = P.v[14].xyz;
		let vAxis = normalize(P.v[15].xyz);
		let r = pos - vCenter;
		let rPerp = r - vAxis * dot(r, vAxis);
		if (length(rPerp) > 1.0) {
			let orbTangent = normalize(cross(vAxis, rPerp));
			initVel += orbTangent * (spd * 0.85 * sign(vortexSwirl));
		}
	}

	let lifeMin = P.v[7].z;
	let lifeMax = P.v[7].w;
	let life = mix(lifeMin, lifeMax, rnd(idx, 6u, seed));

	let angSpeed = mix(P.v[8].x, P.v[8].y, rnd(idx, 7u, seed));
	let angAxis = normalize(vec3<f32>(
		rnd(idx, 8u, seed) - 0.5,
		rnd(idx, 9u, seed) - 0.5,
		rnd(idx, 10u, seed) - 0.5,
	));

	let qAngle = rnd(idx, 11u, seed) * 6.2831853;
	let qAxis = normalize(vec3<f32>(
		rnd(idx, 12u, seed) - 0.5,
		rnd(idx, 13u, seed) - 0.5,
		rnd(idx, 14u, seed) - 0.5,
	));
	let initQuat = vec4<f32>(qAxis * sin(qAngle * 0.5), cos(qAngle * 0.5));

	let sizeJitter = P.v[16].w;
	let pScale = max(0.25, 1.0 + (rnd(idx, 15u, seed) - 0.5) * sizeJitter * 2.0);

	var p: SwarmParticle3D;
	p.pos = pos;
	p.age = birthFrac * P.v[0].x;
	p.vel = initVel;
	p.life = life;
	p.quat = initQuat;
	p.angVel = angAxis * angSpeed;
	p.heat = 0.0;
	p.scale = pScale;
	p.variant = idx % max(1u, u32(P.v[8].z));
	p.seed = pcg(idx + seed);
	p.contact = 0.0;

	particles[i] = p;
}

fn spawnSpark3D(i : u32, sparkIdx : u32, maxParticles : u32, birthFrac : f32) {
	let baseSeed = u32(P.v[1].y);
	let timeSalt = u32(max(0.0, P.v[0].y + 100.0) * 1319.0);
	let seed = baseSeed ^ timeSalt;

	// Search up to 6 candidate shards to find a hot or scraping parent shard
	var parentIdx = pcg(sparkIdx * 7u + seed) % maxParticles;
	var parent = particles[parentIdx];
	let threshold = P.v[29].x;
	for (var attempt = 1u; attempt < 6u; attempt = attempt + 1u) {
		if (parent.life > 0.0 && (parent.heat >= threshold || parent.contact > 0.5)) {
			break;
		}
		let candIdx = pcg(sparkIdx * 13u + attempt * 37u + seed) % maxParticles;
		let cand = particles[candIdx];
		if (cand.life > 0.0 && (cand.heat > parent.heat || parent.life <= 0.0)) {
			parent = cand;
			parentIdx = candIdx;
		}
	}

	if (parent.life <= 0.0) {
		return;
	}

	let r0 = rnd(sparkIdx, 0u, seed) - 0.5;
	let r1 = rnd(sparkIdx, 1u, seed) - 0.5;
	let r2 = rnd(sparkIdx, 2u, seed) - 0.5;
	let scatterDir = normalize(vec3<f32>(r0, r1 - 0.25, r2));
	let sparkSpd = mix(P.v[29].w, P.v[30].w, rnd(sparkIdx, 3u, seed));

	var p: SwarmParticle3D;
	p.pos = parent.pos + scatterDir * 8.0;
	p.age = birthFrac * P.v[0].x;
	p.vel = parent.vel * 0.6 + scatterDir * sparkSpd;
	p.life = mix(P.v[30].x, P.v[30].y, rnd(sparkIdx, 4u, seed));
	p.quat = parent.quat;
	p.angVel = vec3<f32>(r0, r1, r2) * 18.0;
	p.heat = max(0.75, parent.heat * 1.25);
	p.scale = mix(P.v[29].y, P.v[29].z, rnd(sparkIdx, 5u, seed));
	p.variant = 0u;
	p.seed = pcg(sparkIdx + seed);
	p.contact = 0.0;

	particles[i] = p;
}

@compute @workgroup_size(${SWARM_WORKGROUP})
fn stepSimulation(@builtin(global_invocation_id) id : vec3<u32>) {
	let idx = id.x;
	let maxParticles = u32(P.v[1].x);
	let sparkMax = u32(P.v[1].w);
	let totalSlots = maxParticles + sparkMax;
	if (idx >= totalSlots) { return; }

	let isSpark = idx >= maxParticles;

	if (!isSpark) {
		let emitStart = u32(P.v[0].z);
		let emitCount = u32(P.v[0].w);
		if (emitCount > 0u) {
			let end = emitStart + emitCount;
			var spawned = false;
			if (end <= maxParticles) {
				if (idx >= emitStart && idx < end) {
					let birthFrac = f32(idx - emitStart) / f32(emitCount);
					spawn3D(idx, idx, birthFrac);
					spawned = true;
				}
			} else {
				if (idx >= emitStart || idx < (end % maxParticles)) {
					let slot = select(idx - emitStart, idx + (maxParticles - emitStart), idx < emitStart);
					let birthFrac = f32(slot) / f32(emitCount);
					spawn3D(idx, idx, birthFrac);
					spawned = true;
				}
			}
			if (spawned) { return; }
		}
	} else if (sparkMax > 0u) {
		let sparkIdx = idx - maxParticles;
		let sEmitStart = u32(P.v[2].w);
		let sEmitCount = u32(P.v[16].z);
		if (sEmitCount > 0u) {
			let end = sEmitStart + sEmitCount;
			var spawned = false;
			if (end <= sparkMax) {
				if (sparkIdx >= sEmitStart && sparkIdx < end) {
					let birthFrac = f32(sparkIdx - sEmitStart) / f32(sEmitCount);
					spawnSpark3D(idx, sparkIdx, maxParticles, birthFrac);
					spawned = true;
				}
			} else {
				if (sparkIdx >= sEmitStart || sparkIdx < (end % sparkMax)) {
					let slot = select(sparkIdx - sEmitStart, sparkIdx + (sparkMax - sEmitStart), sparkIdx < sEmitStart);
					let birthFrac = f32(slot) / f32(sEmitCount);
					spawnSpark3D(idx, sparkIdx, maxParticles, birthFrac);
					spawned = true;
				}
			}
			if (spawned) { return; }
		}
	}

	var p = particles[idx];
	if (p.life <= 0.0) { return; }

	let dt = P.v[0].x;
	p.age += dt;
	if (p.age >= p.life) {
		p.life = 0.0;
		particles[idx] = p;
		return;
	}

	var acc = P.v[2].xyz * select(1.0, 0.55, isSpark);

	// Linear Drag
	let drag = P.v[3].x * select(1.0, 2.2, isSpark);
	acc -= p.vel * drag;

	// 3D Curl Noise
	let noiseStrength = P.v[3].y * select(1.0, 1.35, isSpark);
	if (noiseStrength > 0.001) {
		let noiseScale = max(P.v[3].z, 1.0);
		let noiseSpeed = P.v[3].w;
		let time = P.v[0].y;
		let noisePos = (p.pos / noiseScale) + vec3<f32>(0.0, time * noiseSpeed, 0.0);
		let curl = curl3(noisePos);
		acc += curl * noiseStrength;
	}

	// Attractors (up to 5)
	let numAttractors = min(5u, u32(P.v[8].w));
	for (var a = 0u; a < numAttractors; a = a + 1u) {
		let attr = P.v[9u + a];
		let toAttr = attr.xyz - p.pos;
		let dist = length(toAttr);
		let maxRadius = attr.w;
		if (dist > 0.1 && (maxRadius <= 0.0 || dist < maxRadius)) {
			var strength = 0.0;
			if (a == 0u) { strength = P.v[17].x; }
			else if (a == 1u) { strength = P.v[17].y; }
			else if (a == 2u) { strength = P.v[17].z; }
			else if (a == 3u) { strength = P.v[17].w; }
			else { strength = P.v[21].w; }
			let factor = select(1.0, 1.0 - dist / maxRadius, maxRadius > 0.0);
			acc += (toAttr / dist) * (strength * factor);
		}
	}

	// 3D Vortex / Cyclone Field with Hollow Eye & Orbital Belt Equilibrium
	let vortexSwirl = P.v[14].w;
	if (abs(vortexSwirl) > 0.001 || abs(P.v[15].w) > 0.001) {
		let vCenter = P.v[14].xyz;
		let vAxis = normalize(P.v[15].xyz);
		let vPull = P.v[15].w;
		let vAxial = P.v[16].x;
		let vRadius = P.v[16].y;

		let r = p.pos - vCenter;
		let h = dot(r, vAxis);
		let rPerp = r - (vAxis * h);
		let dPerp = length(rPerp);

		if (dPerp > 0.1 && (vRadius <= 0.0 || dPerp < vRadius * 1.35)) {
			let effRadius = select(650.0, vRadius, vRadius > 0.0);
			let eyeRadius = max(effRadius * 0.24, 145.0);
			let bandWidth = max(effRadius * 0.54, 240.0);
			let bandRadius = eyeRadius + rnd(idx, 13u, p.seed) * bandWidth;

			let falloff = clamp(1.0 - (dPerp / (effRadius * 1.25)), 0.18, 1.0);
			let tangent = normalize(cross(vAxis, rPerp));
			let radialInward = -rPerp / dPerp;
			let vTan = dot(p.vel, tangent);
			let vRadOut = dot(p.vel, -radialInward);

			// Target tangential speed for this orbital band so shards don't accelerate to infinity
			let targetVTan = vortexSwirl * (0.55 + 0.45 * falloff);
			let swirlAcc = (targetVTan - vTan) * 2.2;

			// Centripetal balance outside the hollow eye + spring toward each shard's orbital band
			let eyeMask = smoothstep(eyeRadius * 0.55, eyeRadius * 1.15, dPerp);
			let centripetal = ((vTan * vTan) / max(dPerp, 80.0)) * eyeMask * 0.92;
			let bandPull = ((dPerp - bandRadius) / bandWidth) * vPull * 2.4;
			let eyeRepel = select(0.0, -vPull * 3.8 * (1.0 - dPerp / eyeRadius), dPerp < eyeRadius);
			let radialAcc = centripetal + bandPull + eyeRepel - vRadOut * 2.1;

			acc += tangent * swirlAcc + radialInward * radialAcc + vAxis * (vAxial * falloff);
		}
	}

	// Integrate velocity
	p.vel += acc * dt;

	// Floor Collision with Coulomb Sliding Friction & Angular Roll
	p.contact = 0.0;
	if (P.v[18].w > 0.5) {
		let floorY = P.v[18].x;
		let bounce = P.v[18].y;
		let friction = P.v[18].z;
		let progress = clamp(p.age / max(p.life, 0.001), 0.0, 1.0);
		let shardRadius = select(mix(P.v[19].x, P.v[19].y, progress) * p.scale, p.scale, isSpark);

		if (p.pos.y + shardRadius >= floorY) {
			let impactSpeed = max(0.0, p.vel.y);
			p.pos.y = floorY - shardRadius;
			p.contact = 1.0;

			if (p.vel.y > 0.0) {
				p.vel.y = -p.vel.y * select(bounce, min(0.55, bounce + 0.2), isSpark);
			}

			let vSlide = length(vec2<f32>(p.vel.x, p.vel.z));
			let fDamp = exp(-friction * dt * 0.85);
			p.vel.x *= fDamp;
			p.vel.z *= fDamp;

			let normal = vec3<f32>(0.0, -1.0, 0.0);
			let vTan = vec3<f32>(p.vel.x, 0.0, p.vel.z);
			let rollTorque = cross(normal, vTan) / max(shardRadius, 1.0);
			p.angVel += rollTorque * clamp(friction * dt * 2.5, 0.0, 1.0);

			let heatGain = P.v[25].x;
			let thermal = pow(rnd(idx, 14u, p.seed), 2.4);
			let slideHeat = max(0.0, vSlide - 180.0) * friction * dt * 0.0032;
			let impactHeat = smoothstep(30.0, 260.0, impactSpeed) * 0.45;
			p.heat = min(1.35, p.heat + (slideHeat + impactHeat) * heatGain * (0.15 + 1.35 * thermal));
		}
	}

	// Integrate position
	p.pos += p.vel * dt;

	// Angular drag & Quaternion integration
	let angDrag = P.v[25].y;
	p.angVel *= exp(-angDrag * dt);
	let omega = p.angVel;
	let dq = quatMul(vec4<f32>(omega * (0.5 * dt), 0.0), p.quat);
	p.quat = normalize(p.quat + dq);

	// Heat cooldown exponential decay
	let heatDecay = max(P.v[25].z, 0.05);
	p.heat *= exp(-dt / heatDecay);

	particles[idx] = p;
}

@compute @workgroup_size(${SWARM_WORKGROUP})
fn packInstances(@builtin(global_invocation_id) id : vec3<u32>) {
	let idx = id.x;
	let maxParticles = u32(P.v[1].x);
	let sparkMax = u32(P.v[1].w);
	let totalSlots = maxParticles + sparkMax;
	if (idx >= totalSlots) { return; }

	let isSpark = idx >= maxParticles;
	let numVariants = max(1u, u32(P.v[8].z));
	let sliceCount = max(1u, u32(P.v[20].y));
	let meshRadius = max(0.001, P.v[20].x);

	var outIdx = idx;
	if (!isSpark) {
		let vIdx = idx % numVariants;
		let localIdx = idx / numVariants;
		outIdx = vIdx * sliceCount + localIdx;
	} else {
		let sparkIdx = idx - maxParticles;
		outIdx = (numVariants * sliceCount) + sparkIdx;
	}

	let p = particles[idx];
	var out: InstanceData;

	if (p.life <= 0.0 || p.age >= p.life) {
		out.posScale = vec4<f32>(0.0, 0.0, 0.0, 0.0);
		out.quat = vec4<f32>(0.0, 0.0, 0.0, 1.0);
		out.color = vec4<f32>(0.0);
		out.emissive = vec4<f32>(0.0);
		instances[outIdx] = out;
		return;
	}

	let progress = p.age / p.life;
	let fadeIn = smoothstep(0.0, max(0.001, P.v[19].z), progress);
	let fadeOut = 1.0 - smoothstep(max(0.0, 1.0 - P.v[19].w), 1.0, progress);

	if (isSpark) {
		let sparkRadius = max(0.0, p.scale * fadeIn * fadeOut);
		out.posScale = vec4<f32>(p.pos, sparkRadius / meshRadius);
		out.quat = p.quat;
		let sparkCol = mix(P.v[28].rgb, P.v[31].rgb, smoothstep(0.0, 0.55, progress));
		out.color = vec4<f32>(sparkCol, 1.0);
		out.emissive = vec4<f32>(sparkCol, P.v[30].z * fadeOut);
		instances[outIdx] = out;
		return;
	}

	let lifeRadius = mix(P.v[19].x, P.v[19].y, progress) * fadeIn * fadeOut;
	let worldRadius = max(0.0, p.scale * lifeRadius);

	out.posScale = vec4<f32>(p.pos, worldRadius / meshRadius);
	out.quat = p.quat;

	// Base color palette interpolation
	let numColors = u32(P.v[21].x);
	var baseCol = P.v[22];
	if (numColors > 1u) {
		let colorT = progress * f32(numColors - 1u);
		let cIdx = min(u32(floor(colorT)), numColors - 2u);
		let cFrac = colorT - f32(cIdx);
		baseCol = mix(P.v[22u + cIdx], P.v[23u + cIdx], cFrac);
	}

	// Dynamic emissive from friction heat and/or speed, modulated per-shard for natural rock/glow contrast
	let heatSource = u32(P.v[20].z); // 0=both, 1=friction, 2=speed
	let maxSpd = max(P.v[20].w, 1.0);
	let thermal = pow(rnd(idx, 14u, p.seed), 2.2);
	let speedFactor = smoothstep(0.62, 1.0, length(p.vel) / maxSpd) * thermal;
	var heatVal = p.heat;
	if (heatSource == 0u) {
		heatVal = max(p.heat, speedFactor);
	} else if (heatSource == 2u) {
		heatVal = speedFactor;
	}

	let heatCurve = P.v[21].y;
	let curvedHeat = pow(clamp(heatVal, 0.0, 1.0), select(1.0, heatCurve, heatCurve > 0.0));
	let heatRamp = mix(
		P.v[26].rgb,
		mix(P.v[27].rgb, P.v[28].rgb, smoothstep(0.55, 0.95, curvedHeat)),
		smoothstep(0.08, 0.55, curvedHeat),
	);
	let heatIntensity = curvedHeat * P.v[21].z * smoothstep(0.08, 0.65, curvedHeat);

	// Blend base albedo color toward the hot color only for significantly heated shards
	out.color = vec4<f32>(mix(baseCol.rgb, heatRamp, smoothstep(0.12, 0.75, curvedHeat)), baseCol.a);

	if (heatIntensity > 0.01) {
		out.emissive = vec4<f32>(heatRamp, heatIntensity);
	} else {
		out.emissive = vec4<f32>(0.0);
	}

	instances[outIdx] = out;
}
`;

export interface Swarm3DStaticConfig {
	max: number;
	seed: number;
	substeps: number;
	prewarm: number;
	meshRadius?: number;
	emitter: {
		shape: "point" | "box" | "sphere" | "shell" | "ring" | "disc";
		x: number;
		y: number;
		z: number;
		width: number;
		height: number;
		depth: number;
		radius: number;
	};
	speed: [number, number];
	direction: [number, number, number];
	spread: number;
	angularSpeed: [number, number];
	angularDrag: number;
	lifetime: [number, number];
	size: [number, number];
	sizeJitter: number;
	fade: [number, number];
	colors: Array<[number, number, number, number]>;
	heat: {
		source: "both" | "friction" | "speed";
		maxSpeed: number;
		curve: number;
		intensity: number;
		colors: [
			[number, number, number],
			[number, number, number],
			[number, number, number],
		];
	};
	sparks?: {
		max: number;
		rate: number;
		threshold: number;
		size: [number, number];
		lifetime: [number, number];
		speed: [number, number];
		intensity: number;
		color: [number, number, number];
	};
	variants: number;
}

export interface Swarm3DFrameInput {
	rate: number;
	gravity: [number, number, number];
	drag: number;
	noise: { strength: number; scale: number; speed: number };
	attractors: Array<{
		x: number;
		y: number;
		z: number;
		strength: number;
		radius?: number;
	}>;
	vortex?: {
		x: number;
		y: number;
		z: number;
		axis: [number, number, number];
		swirl: number;
		pull: number;
		axial: number;
		radius: number;
	};
	floor?: {
		y: number;
		bounce: number;
		friction: number;
		heatGain: number;
		heatDecay: number;
	};
	emitterPos?: [number, number, number];
}

export interface Swarm3DState {
	device: GPUDevice;
	particles: GPUBuffer;
	instances: GPUBuffer;
	ubo: GPUBuffer;
	frame: number;
	emitted: number;
	carry: number;
	sparkEmitted: number;
	sparkCarry: number;
	sliceCount: number;
	totalParticleSlots: number;
	totalInstanceSlots: number;
	snapshots: Map<
		number,
		{
			buffer: GPUBuffer;
			emitted: number;
			carry: number;
			sparkEmitted: number;
			sparkCarry: number;
		}
	>;
}

export class Swarm3DPipeline {
	private device: GPUDevice;
	private simPipeline: GPUComputePipeline;
	private packPipeline: GPUComputePipeline;
	private bindGroupLayout: GPUBindGroupLayout;

	constructor(device: GPUDevice) {
		this.device = device;
		const module = device.createShaderModule({
			label: "swarm3d.wgsl",
			code: SWARM_SIM_WGSL,
		});

		this.bindGroupLayout = device.createBindGroupLayout({
			label: "Swarm3DBindGroupLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
			],
		});

		const pipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.bindGroupLayout],
		});

		this.simPipeline = device.createComputePipeline({
			label: "Swarm3DSimPipeline",
			layout: pipelineLayout,
			compute: { module, entryPoint: "stepSimulation" },
		});

		this.packPipeline = device.createComputePipeline({
			label: "Swarm3DPackPipeline",
			layout: pipelineLayout,
			compute: { module, entryPoint: "packInstances" },
		});
	}

	createState(config: Swarm3DStaticConfig): Swarm3DState {
		const numVariants = Math.max(1, config.variants);
		const sliceCount = Math.ceil(config.max / numVariants);
		const sparkMax = config.sparks?.max ?? 0;
		const totalParticleSlots = config.max + sparkMax;
		const totalInstanceSlots = sliceCount * numVariants + sparkMax;

		const size = totalParticleSlots * SWARM_PARTICLE_BYTES;
		const instSize = totalInstanceSlots * SWARM_INSTANCE_BYTES;
		return {
			device: this.device,
			particles: this.device.createBuffer({
				label: "Swarm3DParticles",
				size,
				usage:
					GPUBufferUsage.STORAGE |
					GPUBufferUsage.COPY_SRC |
					GPUBufferUsage.COPY_DST,
			}),
			instances: this.device.createBuffer({
				label: "Swarm3DInstances",
				size: instSize,
				usage:
					GPUBufferUsage.STORAGE |
					GPUBufferUsage.COPY_SRC |
					GPUBufferUsage.COPY_DST,
			}),
			ubo: this.device.createBuffer({
				label: "Swarm3DUbo",
				size: SWARM_PARAM_VEC4S * 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			}),
			frame: -999999,
			emitted: 0,
			carry: 0,
			sparkEmitted: 0,
			sparkCarry: 0,
			sliceCount,
			totalParticleSlots,
			totalInstanceSlots,
			snapshots: new Map(),
		};
	}

	packParams(
		s: Swarm3DStaticConfig,
		f: Swarm3DFrameInput,
		out: Float32Array,
		sim: {
			dt: number;
			time: number;
			emitStart: number;
			emitCount: number;
			sparkEmitStart: number;
			sparkEmitCount: number;
			frameDt: number;
			sliceCount: number;
		},
	): void {
		out.fill(0);
		const v = (i: number, a: number, b: number, c: number, d: number) =>
			out.set([a, b, c, d], i * 4);

		const sparkMax = s.sparks?.max ?? 0;
		v(0, sim.dt, sim.time, sim.emitStart, sim.emitCount);
		v(1, s.max, s.seed, sim.frameDt, sparkMax);
		v(2, f.gravity[0], f.gravity[1], f.gravity[2], sim.sparkEmitStart);
		v(3, f.drag, f.noise.strength, f.noise.scale, f.noise.speed);

		const shapeId =
			s.emitter.shape === "box"
				? 1
				: s.emitter.shape === "sphere"
					? 2
					: s.emitter.shape === "shell"
						? 3
						: s.emitter.shape === "ring"
							? 4
							: s.emitter.shape === "disc"
								? 5
								: 0;

		const ex = f.emitterPos ? f.emitterPos[0] : s.emitter.x;
		const ey = f.emitterPos ? f.emitterPos[1] : s.emitter.y;
		const ez = f.emitterPos ? f.emitterPos[2] : s.emitter.z;

		v(4, shapeId, ex, ey, ez);
		v(5, s.emitter.width, s.emitter.height, s.emitter.depth, s.emitter.radius);
		v(6, s.direction[0], s.direction[1], s.direction[2], s.spread);
		v(7, s.speed[0], s.speed[1], s.lifetime[0], s.lifetime[1]);

		const attractors = f.attractors.slice(0, SWARM_MAX_ATTRACTORS);
		v(8, s.angularSpeed[0], s.angularSpeed[1], s.variants, attractors.length);

		const attrStrengths = [0, 0, 0, 0, 0];
		for (let i = 0; i < attractors.length; i++) {
			const a = attractors[i];
			if (!a) continue;
			v(9 + i, a.x, a.y, a.z, a.radius ?? 0);
			attrStrengths[i] = a.strength;
		}
		v(
			17,
			attrStrengths[0],
			attrStrengths[1],
			attrStrengths[2],
			attrStrengths[3],
		);

		if (f.vortex) {
			v(14, f.vortex.x, f.vortex.y, f.vortex.z, f.vortex.swirl);
			v(
				15,
				f.vortex.axis[0],
				f.vortex.axis[1],
				f.vortex.axis[2],
				f.vortex.pull,
			);
			v(16, f.vortex.axial, f.vortex.radius, sim.sparkEmitCount, s.sizeJitter);
		} else {
			v(16, 0, 0, sim.sparkEmitCount, s.sizeJitter);
		}

		if (f.floor) {
			v(18, f.floor.y, f.floor.bounce, f.floor.friction, 1.0);
		} else {
			v(18, 0, 0, 0, 0);
		}

		v(19, s.size[0], s.size[1], s.fade[0], s.fade[1]);

		const heatSource =
			s.heat.source === "friction" ? 1 : s.heat.source === "speed" ? 2 : 0;
		v(20, s.meshRadius ?? 20, sim.sliceCount, heatSource, s.heat.maxSpeed);

		const colors = s.colors.slice(0, 3);
		v(21, colors.length, s.heat.curve, s.heat.intensity, attrStrengths[4]);
		for (let i = 0; i < colors.length; i++) {
			const c = colors[i];
			if (c) v(22 + i, c[0], c[1], c[2], c[3]);
		}

		v(
			25,
			f.floor?.heatGain ?? 1.0,
			s.angularDrag,
			f.floor?.heatDecay ?? 0.45,
			0,
		);
		v(26, s.heat.colors[0][0], s.heat.colors[0][1], s.heat.colors[0][2], 1);
		v(27, s.heat.colors[1][0], s.heat.colors[1][1], s.heat.colors[1][2], 1);
		v(28, s.heat.colors[2][0], s.heat.colors[2][1], s.heat.colors[2][2], 1);

		if (s.sparks) {
			v(
				29,
				s.sparks.threshold,
				s.sparks.size[0],
				s.sparks.size[1],
				s.sparks.speed[0],
			);
			v(
				30,
				s.sparks.lifetime[0],
				s.sparks.lifetime[1],
				s.sparks.intensity,
				s.sparks.speed[1],
			);
			v(31, s.sparks.color[0], s.sparks.color[1], s.sparks.color[2], 1.0);
		}
	}

	advance(
		state: Swarm3DState,
		config: Swarm3DStaticConfig,
		targetFrame: number,
		fps: number,
		frameSampler: (frame: number) => Swarm3DFrameInput,
	): void {
		const { device } = state;
		const prewarmFrames = Math.max(0, Math.round((config.prewarm ?? 0) * fps));

		if (targetFrame < state.frame || state.frame < -prewarmFrames - 1) {
			let best = -999999;
			for (const k of state.snapshots.keys()) {
				if (k <= targetFrame && k > best) best = k;
			}
			const encoder = device.createCommandEncoder({
				label: "swarm3d_restore",
			});
			if (best >= 0) {
				const snap = state.snapshots.get(best);
				if (snap) {
					encoder.copyBufferToBuffer(
						snap.buffer,
						0,
						state.particles,
						0,
						state.totalParticleSlots * SWARM_PARTICLE_BYTES,
					);
					state.emitted = snap.emitted;
					state.carry = snap.carry;
					state.sparkEmitted = snap.sparkEmitted;
					state.sparkCarry = snap.sparkCarry;
					state.frame = best;
				}
			} else {
				encoder.clearBuffer(state.particles);
				encoder.clearBuffer(state.instances);
				state.emitted = 0;
				state.carry = 0;
				state.sparkEmitted = 0;
				state.sparkCarry = 0;
				state.frame = -1 - prewarmFrames;
			}
			device.queue.submit([encoder.finish()]);
		}

		const params = new Float32Array(SWARM_PARAM_VEC4S * 4);
		const substeps = Math.max(1, Math.round(config.substeps));
		const frameDt = 1 / fps;
		const dt = frameDt / substeps;

		const bindGroup = device.createBindGroup({
			layout: this.bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: state.ubo } },
				{ binding: 1, resource: { buffer: state.particles } },
				{ binding: 2, resource: { buffer: state.instances } },
			],
		});

		const workgroups = Math.ceil(state.totalParticleSlots / SWARM_WORKGROUP);
		const sparkMax = config.sparks?.max ?? 0;
		const sparkRate = config.sparks?.rate ?? 0;

		for (let f = state.frame + 1; f <= targetFrame; f++) {
			const input = frameSampler(Math.max(0, f));
			const targetEmits = input.rate * frameDt + state.carry;
			const totalEmits = Math.floor(targetEmits);
			state.carry = targetEmits - totalEmits;
			const perSubstep = Math.floor(totalEmits / substeps);
			let remainder = totalEmits % substeps;

			const targetSparkEmits =
				sparkMax > 0 ? sparkRate * frameDt + state.sparkCarry : 0;
			const totalSparkEmits = Math.floor(targetSparkEmits);
			state.sparkCarry = targetSparkEmits - totalSparkEmits;
			const sparkPerSubstep = Math.floor(totalSparkEmits / substeps);
			let sparkRemainder = totalSparkEmits % substeps;

			for (let s = 0; s < substeps; s++) {
				const count = perSubstep + (remainder > 0 ? 1 : 0);
				if (remainder > 0) remainder--;

				const emitStart = state.emitted % config.max;
				state.emitted += count;

				const sCount = sparkPerSubstep + (sparkRemainder > 0 ? 1 : 0);
				if (sparkRemainder > 0) sparkRemainder--;

				const sEmitStart = sparkMax > 0 ? state.sparkEmitted % sparkMax : 0;
				state.sparkEmitted += sCount;

				this.packParams(config, input, params, {
					dt,
					time: f * frameDt + s * dt,
					emitStart,
					emitCount: count,
					sparkEmitStart: sEmitStart,
					sparkEmitCount: sCount,
					frameDt,
					sliceCount: state.sliceCount,
				});

				device.queue.writeBuffer(state.ubo, 0, params);

				const encoder = device.createCommandEncoder({
					label: `swarm3d_step_${f}_${s}`,
				});
				const pass = encoder.beginComputePass();
				pass.setPipeline(this.simPipeline);
				pass.setBindGroup(0, bindGroup);
				pass.dispatchWorkgroups(workgroups);
				pass.end();
				device.queue.submit([encoder.finish()]);
			}

			state.frame = f;

			if (
				f >= 0 &&
				f % SWARM_SNAPSHOT_EVERY === 0 &&
				state.snapshots.size < SWARM_MAX_SNAPSHOTS
			) {
				let snap = state.snapshots.get(f);
				if (!snap) {
					snap = {
						buffer: device.createBuffer({
							label: `swarm3d_snap_${f}`,
							size: state.totalParticleSlots * SWARM_PARTICLE_BYTES,
							usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
						}),
						emitted: state.emitted,
						carry: state.carry,
						sparkEmitted: state.sparkEmitted,
						sparkCarry: state.sparkCarry,
					};
					state.snapshots.set(f, snap);
				}
				const snapEncoder = device.createCommandEncoder({
					label: `swarm3d_snap_save_${f}`,
				});
				snapEncoder.copyBufferToBuffer(
					state.particles,
					0,
					snap.buffer,
					0,
					state.totalParticleSlots * SWARM_PARTICLE_BYTES,
				);
				device.queue.submit([snapEncoder.finish()]);
			}
		}

		// Final pack instances compute pass for the rendered frame
		const packEncoder = device.createCommandEncoder({
			label: "swarm3d_pack_instances",
		});
		const packPass = packEncoder.beginComputePass();
		packPass.setPipeline(this.packPipeline);
		packPass.setBindGroup(0, bindGroup);
		packPass.dispatchWorkgroups(workgroups);
		packPass.end();
		device.queue.submit([packEncoder.finish()]);
	}

	destroyState(state: Swarm3DState): void {
		state.particles.destroy();
		state.instances.destroy();
		state.ubo.destroy();
		for (const snap of state.snapshots.values()) {
			snap.buffer.destroy();
		}
		state.snapshots.clear();
	}
}
