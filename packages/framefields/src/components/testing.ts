/**
 * Test-only: every registry component bound to framefields from its source,
 * so render tests exercise the code `framefields add` installs (which
 * differs only in its import paths). Not a build entry; not shipped.
 */
import {
	annotate,
	appFrame,
	backdrop,
	beforeAfter,
	callout,
	captions,
	cardStack,
	chatThread,
	codeBlock,
	confetti,
	counter,
	deviceFrame,
	focusZoom,
	logoReveal,
	lowerThird,
	meter,
	mousePointer,
	selection,
	spotlight,
	terminal,
	textReveal,
	titleCard,
	toasts,
	touchPoint,
	waveform,
	wordCycle,
} from "@framefields/components";
import { bindComponent } from "./index.js";

export const Annotate = bindComponent(annotate);
export const AppFrame = bindComponent(appFrame);
export const Backdrop = bindComponent(backdrop);
export const BeforeAfter = bindComponent(beforeAfter);
export const Callout = bindComponent(callout);
export const Captions = bindComponent(captions);
export const CardStack = bindComponent(cardStack);
export const ChatThread = bindComponent(chatThread);
export const CodeBlock = bindComponent(codeBlock);
export const Confetti = bindComponent(confetti);
export const Counter = bindComponent(counter);
export const DeviceFrame = bindComponent(deviceFrame);
export const FocusZoom = bindComponent(focusZoom);
export const LogoReveal = bindComponent(logoReveal);
export const LowerThird = bindComponent(lowerThird);
export const Meter = bindComponent(meter);
export const MousePointer = bindComponent(mousePointer);
export const Selection = bindComponent(selection);
export const Spotlight = bindComponent(spotlight);
export const Terminal = bindComponent(terminal);
export const TextReveal = bindComponent(textReveal);
export const TitleCard = bindComponent(titleCard);
export const Toasts = bindComponent(toasts);
export const TouchPoint = bindComponent(touchPoint);
export const Waveform = bindComponent(waveform);
export const WordCycle = bindComponent(wordCycle);
