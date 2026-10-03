export const lutViewerWgsl = `
struct Uniforms {
	rotation: vec2f,
	zoom: f32,
	aspect: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
	@location(0) pos: vec3f,
	@location(1) color: vec3f,
}

struct VertexOutput {
	@builtin(position) clip_position: vec4f,
	@location(0) color: vec3f,
	@location(1) uv: vec2f,
}

fn rotateY(pos: vec3f, angle: f32) -> vec3f {
	let s = sin(angle);
	let c = cos(angle);
	return vec3f(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
}

fn rotateX(pos: vec3f, angle: f32) -> vec3f {
	let s = sin(angle);
	let c = cos(angle);
	return vec3f(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

@vertex
fn vs_main(
	input: VertexInput,
	@builtin(vertex_index) vertex_index: u32,
) -> VertexOutput {
	var out: VertexOutput;

	var quad_pos = array<vec2f, 6>(
		vec2f(-0.5, -0.5),
		vec2f( 0.5, -0.5),
		vec2f(-0.5,  0.5),
		vec2f(-0.5,  0.5),
		vec2f( 0.5, -0.5),
		vec2f( 0.5,  0.5)
	);
	let offset = quad_pos[vertex_index];

	var rotated = rotateY(input.pos, uniforms.rotation.x);
	rotated = rotateX(rotated, uniforms.rotation.y);

	let camera_pos = vec3f(0.0, 0.0, uniforms.zoom);
	let view_pos = rotated - camera_pos;

	let point_size = 0.02;
	let billboard_pos = view_pos + vec3f(offset * point_size, 0.0);

	let f = 2.414;
	let near = 0.1;
	let far = 10.0;

	out.clip_position = vec4f(
		(billboard_pos.x * f) / uniforms.aspect,
		billboard_pos.y * f,
		billboard_pos.z * (far / (near - far)) + (far * near / (near - far)),
		-billboard_pos.z
	);
	out.color = input.color;
	out.uv = offset;
	return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
	let dist = dot(input.uv, input.uv);
	if (dist > 0.25) {
		discard;
	}
	let alpha = smoothstep(0.25, 0.22, dist);
	return vec4f(input.color, alpha);
}

var<private> cube_vertices: array<vec3f, 24> = array<vec3f, 24>(
	vec3f(-0.5, -0.5, -0.5), vec3f( 0.5, -0.5, -0.5),
	vec3f( 0.5, -0.5, -0.5), vec3f( 0.5,  0.5, -0.5),
	vec3f( 0.5,  0.5, -0.5), vec3f(-0.5,  0.5, -0.5),
	vec3f(-0.5,  0.5, -0.5), vec3f(-0.5, -0.5, -0.5),

	vec3f(-0.5, -0.5,  0.5), vec3f( 0.5, -0.5,  0.5),
	vec3f( 0.5, -0.5,  0.5), vec3f( 0.5,  0.5,  0.5),
	vec3f( 0.5,  0.5,  0.5), vec3f(-0.5,  0.5,  0.5),
	vec3f(-0.5,  0.5,  0.5), vec3f(-0.5, -0.5,  0.5),

	vec3f(-0.5, -0.5, -0.5), vec3f(-0.5, -0.5,  0.5),
	vec3f( 0.5, -0.5, -0.5), vec3f( 0.5, -0.5,  0.5),
	vec3f( 0.5,  0.5, -0.5), vec3f( 0.5,  0.5,  0.5),
	vec3f(-0.5,  0.5, -0.5), vec3f(-0.5,  0.5,  0.5)
);

@vertex
fn vs_wireframe(
	@builtin(vertex_index) vertex_index: u32,
) -> @builtin(position) vec4f {
	let pos = cube_vertices[vertex_index];
	var rotated = rotateY(pos, uniforms.rotation.x);
	rotated = rotateX(rotated, uniforms.rotation.y);
	let view_pos = rotated - vec3f(0.0, 0.0, uniforms.zoom);

	let f = 2.414;
	let near = 0.1;
	let far = 10.0;

	return vec4f(
		(view_pos.x * f) / uniforms.aspect,
		view_pos.y * f,
		view_pos.z * (far / (near - far)) + (far * near / (near - far)),
		-view_pos.z
	);
}

@fragment
fn fs_wireframe() -> @location(0) vec4f {
	return vec4f(1.0, 1.0, 1.0, 0.25);
}
`;
