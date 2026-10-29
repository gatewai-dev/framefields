# @framefields/client-utils

## 2.8.0

## 2.7.0

## 2.6.2

## 2.6.1

## 2.6.0

## 2.5.5

### Patch Changes

- demos

## 2.5.4

## 2.5.3

### Patch Changes

- docs-fixes

## 2.5.2

## 2.5.1

## 2.5.0

## 2.4.3

## 2.4.2

## 2.4.1

## 2.4.0

## 2.3.2

## 2.3.1

## 2.3.0

## 2.2.0

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

## 2.2.0-beta.4

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

## 2.2.0-beta.3

## 2.2.0-beta.2

## 2.2.0-beta.1

## 2.2.0-beta.0

## 2.1.3

## 2.1.2

## 2.1.1

### Patch Changes

- rm aws bundle

## 2.1.0

## 2.0.11

## 2.0.10

## 2.0.9

## 2.0.8

## 2.0.7

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

## 2.0.2

## 2.0.1

## 2.0.0

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
