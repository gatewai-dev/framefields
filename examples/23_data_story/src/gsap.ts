/**
 * gsap ships CommonJS to Node, where its default import is the module object
 * and the gsap instance sits on `.default`. Resolve it once here.
 */
import gsapModule from "gsap";

type Gsap = typeof gsapModule;
export const gsap: Gsap =
	(gsapModule as Gsap & { default?: Gsap }).default ?? gsapModule;
