/** Art-directed lighting for `material: "toon"`, on meshes, cards and text. */
export interface ToonShading {
	/** Shadow-side albedo multiplier. Defaults to the model's shade color or #80808c. */
	shadowColor?: string;
	/** Lit-side albedo multiplier, in addition to the scene light's color. Default white. */
	lightColor?: string;
	/** Cosine of the light angle at the middle of the light/shade transition. Default 0.075. */
	threshold?: number;
	/** Width of the light/shade transition in cosine space. Default 0.25. */
	softness?: number;
	/** Cosine modelling within the lit region: 0 flat, 1 Lambert. Default 0. */
	diffuse?: number;
}

/** Geometry outlines use surface depth and normals, independently of texture or lighting. */
export interface GeometryOutlineOptions {
	/** Ink color. Default #16131c. */
	color?: string;
	/** Line width in pixels at `referenceHeight`. Default 1.5. */
	width?: number;
	/** Height at which width is specified; exports scale it proportionally. Default 1080. */
	referenceHeight?: number;
	/** Normal discontinuity in degrees that starts a crease. 180 disables creases. Default 45. */
	creaseAngle?: number;
	/** Relative inverse-depth curvature that starts a silhouette/depth edge. Default 0.01. */
	depthThreshold?: number;
	/** Overall ink opacity. Default 1. */
	opacity?: number;
}
