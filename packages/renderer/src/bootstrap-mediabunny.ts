import fsSync from "node:fs";
import { registerMediabunnyServer } from "@mediabunny/server";
import * as webcodecs from "@napi-rs/webcodecs";

export const isAMD = (): boolean => {
	if (process.platform !== "linux") return false;
	try {
		if (
			fsSync.existsSync("/sys/module/amdgpu") ||
			fsSync.existsSync("/dev/kfd")
		) {
			return true;
		}
		const drmDir = "/sys/class/drm";
		if (fsSync.existsSync(drmDir)) {
			const files = fsSync.readdirSync(drmDir);
			for (const file of files) {
				const vendorPath = `${drmDir}/${file}/device/vendor`;
				if (fsSync.existsSync(vendorPath)) {
					const vendor = fsSync.readFileSync(vendorPath, "utf8").trim();
					if (vendor === "0x1002") {
						return true;
					}
				}
			}
		}
	} catch {}
	return false;
};

export const bootstrapMediabunny = (): void => {
	const getHardwareContextOption = () => {
		if (isAMD()) {
			return { hardwareContext: null };
		}
		return {};
	};

	registerMediabunnyServer(getHardwareContextOption());

	for (const key of Object.keys(webcodecs)) {
		if (typeof (globalThis as any)[key] === "undefined") {
			(globalThis as any)[key] = (webcodecs as any)[key];
		}
	}
};
