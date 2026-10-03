import { ServerMediaService } from "@gitframes/media/server";
import {
	container,
	logger,
	R2StorageService,
	TOKENS,
} from "@gitframes/server-utils";
import { RENDERER_ENV_CONFIG } from "./env-config.js";

/**
 * Register backend-specific services into the DI container.
 */
export async function registerBackendServices() {
	// Register generic values
	container.bind(TOKENS.ENV).toConstantValue(RENDERER_ENV_CONFIG);
	container.bind(TOKENS.LOGGER).toConstantValue(logger);

	container.bind(TOKENS.STORAGE).to(R2StorageService).inSingletonScope();

	// Register Media
	container.bind(TOKENS.MEDIA).to(ServerMediaService).inSingletonScope();

	logger.info("Renderer services registered successfully.");
	return container;
}
