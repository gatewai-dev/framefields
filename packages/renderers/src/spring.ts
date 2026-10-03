import { interpolate } from "./interpolate.js";

type AnimationNode = {
	lastTimestamp: number;
	toValue: number;
	current: number;
	velocity: number;
	prevPosition?: number;
};

export type SpringConfig = {
	damping: number;
	mass: number;
	stiffness: number;
	overshootClamping: boolean;
};

const defaultSpringConfig: SpringConfig = {
	damping: 10,
	mass: 1,
	stiffness: 100,
	overshootClamping: false,
};

const advanceCache: { [key: string]: AnimationNode } = {};

function advance({
	animation,
	now,
	config,
}: {
	animation: AnimationNode;
	now: number;
	config: SpringConfig;
}): AnimationNode {
	const { toValue, lastTimestamp, current, velocity } = animation;

	const deltaTime = Math.min(now - lastTimestamp, 64);

	if (config.damping <= 0) {
		throw new Error(
			"Spring damping must be greater than 0, otherwise the spring() animation will never end, causing an infinite loop.",
		);
	}
	if (config.stiffness <= 0) {
		throw new Error("Spring stiffness must be greater than 0.");
	}
	if (config.mass <= 0) {
		throw new Error("Spring mass must be greater than 0.");
	}

	const c = config.damping;
	const m = config.mass;
	const k = config.stiffness;

	const cacheKey = [
		toValue,
		lastTimestamp,
		current,
		velocity,
		c,
		m,
		k,
		now,
	].join("-");
	if (advanceCache[cacheKey]) {
		return advanceCache[cacheKey];
	}

	const v0 = -velocity;
	const x0 = toValue - current;

	const zeta = c / (2 * Math.sqrt(k * m)); // damping ratio
	const omega0 = Math.sqrt(k / m); // undamped angular frequency of the oscillator (rad/ms)
	const omega1 = omega0 * Math.sqrt(1 - zeta ** 2); // exponential decay

	const t = deltaTime / 1000;

	const sin1 = Math.sin(omega1 * t);
	const cos1 = Math.cos(omega1 * t);

	// under damped
	const underDampedEnvelope = Math.exp(-zeta * omega0 * t);
	const underDampedFrag1 =
		underDampedEnvelope *
		(sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);

	const underDampedPosition = toValue - underDampedFrag1;
	const underDampedVelocity =
		zeta * omega0 * underDampedFrag1 -
		underDampedEnvelope *
			(cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);

	// critically damped
	const criticallyDampedEnvelope = Math.exp(-omega0 * t);
	const criticallyDampedPosition =
		toValue - criticallyDampedEnvelope * (x0 + (v0 + omega0 * x0) * t);

	const criticallyDampedVelocity =
		criticallyDampedEnvelope *
		(v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);

	const animationNode: AnimationNode = {
		toValue,
		prevPosition: current,
		lastTimestamp: now,
		current: zeta < 1 ? underDampedPosition : criticallyDampedPosition,
		velocity: zeta < 1 ? underDampedVelocity : criticallyDampedVelocity,
	};
	advanceCache[cacheKey] = animationNode;
	return animationNode;
}

const calculationCache: { [key: string]: AnimationNode } = {};

export function springCalculation({
	frame,
	fps,
	config = {},
}: {
	frame: number;
	fps: number;
	config?: Partial<SpringConfig>;
}): AnimationNode {
	const from = 0;
	const to = 1;
	const cacheKey = [
		frame,
		fps,
		config.damping,
		config.mass,
		config.overshootClamping,
		config.stiffness,
	].join("-");
	if (calculationCache[cacheKey]) {
		return calculationCache[cacheKey];
	}

	let animation: AnimationNode = {
		lastTimestamp: 0,
		current: from,
		toValue: to,
		velocity: 0,
		prevPosition: 0,
	};
	const frameClamped = Math.max(0, frame);
	const unevenRest = frameClamped % 1;
	for (let f = 0; f <= Math.floor(frameClamped); f++) {
		if (f === Math.floor(frameClamped)) {
			f += unevenRest;
		}

		const time = (f / fps) * 1000;
		animation = advance({
			animation,
			now: time,
			config: {
				...defaultSpringConfig,
				...config,
			},
		});
	}

	calculationCache[cacheKey] = animation;
	return animation;
}

const measureCache = new Map<string, number>();

type MeasureSpringProps = {
	fps: number;
	config?: Partial<SpringConfig>;
	threshold?: number;
};

export function measureSpring({
	fps,
	config = {},
	threshold = 0.005,
}: MeasureSpringProps): number {
	if (typeof threshold !== "number") {
		throw new TypeError(`threshold must be a number, got ${threshold}`);
	}

	if (threshold === 0) {
		return Infinity;
	}

	if (threshold === 1) {
		return 0;
	}

	if (Number.isNaN(threshold)) {
		throw new TypeError("Threshold is NaN");
	}

	if (!Number.isFinite(threshold)) {
		throw new TypeError("Threshold is not finite");
	}

	if (threshold < 0) {
		throw new TypeError("Threshold is below 0");
	}

	const cacheKey = [
		fps,
		config.damping,
		config.mass,
		config.overshootClamping,
		config.stiffness,
		threshold,
	].join("-");
	if (measureCache.has(cacheKey)) {
		return measureCache.get(cacheKey)!;
	}

	let frame = 0;
	let finishedFrame = 0;
	const calc = () => {
		return springCalculation({
			fps,
			frame,
			config,
		});
	};

	let animation = calc();
	const calcDifference = () => {
		return Math.abs(animation.current - animation.toValue);
	};

	let difference = calcDifference();
	while (difference >= threshold) {
		frame++;
		animation = calc();
		difference = calcDifference();
	}

	finishedFrame = frame;
	for (let i = 0; i < 20; i++) {
		frame++;
		animation = calc();
		difference = calcDifference();
		if (difference >= threshold) {
			i = 0;
			finishedFrame = frame + 1;
		}
	}

	measureCache.set(cacheKey, finishedFrame);

	return finishedFrame;
}

export function spring({
	frame: passedFrame,
	fps,
	config = {},
	from = 0,
	to = 1,
	durationInFrames: passedDurationInFrames,
	durationRestThreshold,
	delay = 0,
	reverse = false,
}: {
	frame: number;
	fps: number;
	config?: Partial<SpringConfig>;
	from?: number;
	to?: number;
	durationInFrames?: number;
	durationRestThreshold?: number;
	delay?: number;
	reverse?: boolean;
}): number {
	const needsToCalculateNaturalDuration =
		reverse || typeof passedDurationInFrames !== "undefined";

	const naturalDuration = needsToCalculateNaturalDuration
		? measureSpring({
				fps,
				config,
				threshold: durationRestThreshold,
			})
		: undefined;

	const naturalDurationGetter = needsToCalculateNaturalDuration
		? {
				get: () => naturalDuration as number,
			}
		: {
				get: () => {
					throw new Error("did not calculate natural duration");
				},
			};

	const reverseProcessed = reverse
		? (passedDurationInFrames ?? naturalDurationGetter.get()) - passedFrame
		: passedFrame;

	const delayProcessed = reverseProcessed + (reverse ? delay : -delay);

	const durationProcessed =
		passedDurationInFrames === undefined
			? delayProcessed
			: delayProcessed / (passedDurationInFrames / naturalDurationGetter.get());

	if (passedDurationInFrames && delayProcessed > passedDurationInFrames) {
		return to;
	}

	const spr = springCalculation({
		fps,
		frame: durationProcessed,
		config,
	});

	const inner = config.overshootClamping
		? to >= from
			? Math.min(spr.current, to)
			: Math.max(spr.current, to)
		: spr.current;

	const interpolated =
		from === 0 && to === 1 ? inner : interpolate(inner, [0, 1], [from, to]);

	return interpolated;
}
