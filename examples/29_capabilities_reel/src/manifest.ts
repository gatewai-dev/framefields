/** What `pnpm assets` downloads; see fetch-assets.ts for sources and licences. */
/** Noto animated emoji: codepoint → file name. */
export const NOTO = {
	fire: "1f525",
	rocket: "1f680",
	sparkles: "2728",
	party: "1f389",
	heartEyes: "1f60d",
	starStruck: "1f929",
	mindBlown: "1f92f",
	hundred: "1f4af",
	rainbow: "1f308",
	heart: "2764_fe0f",
	thumbsUp: "1f44d",
	clap: "1f44f",
	zap: "26a1",
	robot: "1f916",
	alien: "1f47e",
	cool: "1f60e",
	partying: "1f973",
	boom: "1f4a5",
	eyes: "1f440",
	clapper: "1f3ac",
	popcorn: "1f37f",
	globe: "1f30d",
	gem: "1f48e",
	brain: "1f9e0",
	unicorn: "1f984",
	volcano: "1f30b",
	melting: "1fae0",
	flash: "1f4f8",
	star: "2b50",
	glowingStar: "1f31f",
	dizzy: "1f4ab",
	cyclone: "1f300",
	crystalBall: "1f52e",
	bullseye: "1f3af",
	trophy: "1f3c6",
	raisingHands: "1f64c",
	rofl: "1f923",
	inLove: "1f970",
	octopus: "1f419",
	snail: "1f40c",
	catHeart: "1f63b",
} as const;
export type NotoName = keyof typeof NOTO;

const IOS =
	"https://raw.githubusercontent.com/airbnb/lottie-ios/master/Tests/Samples";
const WEB = "https://raw.githubusercontent.com/airbnb/lottie-web/master/demo";

/** Lottie animations: file name → URL. */
export const LOTTIES = {
	fireworks: `${IOS}/LottieFiles/fireworks.json`,
	growth: `${IOS}/LottieFiles/growth.json`,
	dogCar: `${IOS}/LottieFiles/dog_car_ride.json`,
	cactus: `${IOS}/LottieFiles/cactus.json`,
	infinity: `${IOS}/LottieFiles/infinity_loader.json`,
	gradientShapes: `${IOS}/LottieFiles/gradient_shapes.json`,
	gradientStrokes: `${IOS}/LottieFiles/loading_gradient_strokes.json`,
	shop: `${IOS}/LottieFiles/shop.json`,
	stepLoader: `${IOS}/LottieFiles/step_loader.json`,
	bounceStrokes: `${IOS}/LottieFiles/bounce_strokes.json`,
	boat: `${IOS}/Boat_Loader.json`,
	squares: `${IOS}/9squares_AlBoardman.json`,
	watermelon: `${IOS}/Watermelon.json`,
	pinJump: `${IOS}/PinJump.json`,
	motionCorpse: `${IOS}/MotionCorpse_Jrcanest.json`,
	iconTransitions: `${IOS}/IconTransitions.json`,
	success: `${IOS}/success.json`,
	gatin: `${WEB}/gatin/data.json`,
	adrock: `${WEB}/adrock/data.json`,
	happy2016: `${WEB}/happy2016/data.json`,
	navidad: `${WEB}/navidad/data.json`,
	bodymovin: `${WEB}/bodymovin/data.json`,
} as const;
export type LottieName = keyof typeof LOTTIES;

/** Fluent Emoji color SVGs: file name → folder in microsoft/fluentui-emoji/assets. */
export const FLUENT = {
	rocket: "Rocket",
	fire: "Fire",
	sparkles: "Sparkles",
	party: "Party popper",
	heart: "Red heart",
	starStruck: "Star-struck",
	unicorn: "Unicorn",
	robot: "Robot",
	crystalBall: "Crystal ball",
	gem: "Gem stone",
	rainbow: "Rainbow",
	alien: "Alien monster",
	palette: "Artist palette",
	clapper: "Clapper board",
	movieCamera: "Movie camera",
	film: "Film frames",
	laptop: "Laptop",
	bulb: "Light bulb",
	wand: "Magic wand",
	joystick: "Joystick",
	zap: "High voltage",
	planet: "Ringed planet",
	comet: "Comet",
	galaxy: "Milky way",
	dna: "Dna",
	headphone: "Headphone",
	notes: "Musical notes",
	trophy: "Trophy",
	crown: "Crown",
	ghost: "Ghost",
	ufo: "Flying saucer",
	mushroom: "Mushroom",
	blossom: "Cherry blossom",
	butterfly: "Butterfly",
	dragon: "Dragon",
	octopus: "Octopus",
} as const;
export type FluentName = keyof typeof FLUENT;

/** Twemoji SVGs: file name → codepoint. */
export const TWEMOJI = {
	rocket: "1f680",
	fire: "1f525",
	sparkles: "2728",
	heart: "2764",
	star: "2b50",
	zap: "26a1",
	rainbow: "1f308",
	party: "1f389",
	gem: "1f48e",
	unicorn: "1f984",
	alien: "1f47e",
	robot: "1f916",
} as const;

/** Lucide icons used as stroke paths (drawn on with trimEnd). */
export const LUCIDE = [
	"clapperboard",
	"wand-sparkles",
	"layers",
	"cpu",
	"zap",
	"palette",
	"music",
	"box",
	"type",
	"shapes",
	"aperture",
	"orbit",
	"atom",
	"rocket",
	"brush",
	"scan-face",
	"chart-pie",
	"waves",
	"sparkles",
	"film",
] as const;

/**
 * Sound effects from Freesound, all CC0 (public domain): the HQ preview of each sound.
 * `peakSec` is where the sound hits (measured from its envelope), so it can be placed on the
 * frame it belongs to rather than where the file starts.
 */
export const SFX = {
	/** Air builds for a second and stops dead: into a hard cut. */
	riser: {
		id: 648837,
		user: "AudioPapkin",
		title: "Cinematic Woosh SFX-013",
		peakSec: 2.9,
		durSec: 4.44,
		url: "https://cdn.freesound.org/previews/648/648837_8698658-hq.mp3",
	},
	/** A light, airy stereo pass-by: under a whip, push or slide. */
	whoosh: {
		id: 701104,
		user: "xkeril",
		title: "Whoosh stereo light (transition)",
		peakSec: 0.45,
		durSec: 2.32,
		url: "https://cdn.freesound.org/previews/701/701104_13504080-hq.mp3",
	},
	/** A warm, soft low hit with a two-second tail: the downbeat of a drop. */
	impact: {
		id: 560156,
		user: "Rizzard",
		title: "Soft Cinematic Impact",
		peakSec: 0.15,
		durSec: 6,
		url: "https://cdn.freesound.org/previews/560/560156_10825267-hq.mp3",
	},
	/** A deep title hit: the last downbeat, on the lockup. */
	titleHit: {
		id: 671306,
		user: "xkeril",
		title: "Cinematic Hit Bass (title)",
		peakSec: 0.05,
		durSec: 7.5,
		url: "https://cdn.freesound.org/previews/671/671306_13504080-hq.mp3",
	},
	/** A short bright pop: emoji popping in. */
	pop: {
		id: 824189,
		user: "Sadiquecat",
		title: "Pop in sfx",
		peakSec: 0.15,
		durSec: 0.56,
		url: "https://cdn.freesound.org/previews/824/824189_5287430-hq.mp3",
	},
} as const;
export type SfxName = keyof typeof SFX;
