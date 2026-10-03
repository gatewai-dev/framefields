export const mapBlendModeToSkia = (mode?: string): string => {
	if (!mode) return "srcOver";

	switch (mode) {
		case "source-over":
			return "srcOver";
		case "source-in":
			return "srcIn";
		case "source-out":
			return "srcOut";
		case "source-atop":
			return "srcATop";
		case "destination-over":
			return "dstOver";
		case "destination-in":
			return "dstIn";
		case "destination-out":
			return "dstOut";
		case "destination-atop":
			return "dstATop";
		case "copy":
			return "src";
		case "xor":
			return "xor";
		case "multiply":
			return "multiply";
		case "screen":
			return "screen";
		case "overlay":
			return "overlay";
		case "darken":
			return "darken";
		case "lighten":
		case "lighter": // Aliasing lighter to lighten
			return "lighten";
		case "color-dodge":
			return "colorDodge";
		case "color-burn":
			return "colorBurn";
		case "hard-light":
			return "hardLight";
		case "soft-light":
			return "softLight";
		case "difference":
			return "difference";
		case "exclusion":
			return "exclusion";
		case "hue":
			return "hue";
		case "saturation":
			return "saturation";
		case "color":
			return "color";
		case "luminosity":
			return "luminosity";
		default:
			return "srcOver";
	}
};

export const requiresIsolation = (mode?: string): boolean => {
	return mode === "destination-in" || mode === "source-in";
};
