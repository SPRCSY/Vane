# Vane workspace instructions

## Repository and deployment branch

- `origin` is the user's public fork: `git@github.com:SPRCSY/Vane.git`.
- `upstream` is the official repository: `https://github.com/ItzCrazyKns/Vane.git`.
- Put deployable local changes on `deploy`; Alibaba Cloud ACR watches this branch.
- The fork is public. Never commit API keys, passwords, tokens, `.env*`, local model credentials, or registry credentials.
- Preserve unrelated user changes in a dirty worktree. Do not reset, checkout over, or broadly stage them.

## Container architecture

The Alpine deployment is deliberately split into three named images:

1. `vane-next-deps`: Node build tools and `node_modules`. Rebuild only when `package.json`, `yarn.lock`, the Node image, or dependency build tools change.
2. `vane-runtime-base`: Alpine runtime, system Chromium for Playwright, Python, and a pinned SearXNG installation. Rebuild only for an intentional runtime update.
3. `vane`: frequently changing Next.js output, Playwright packages, SearXNG configuration, entrypoint, and application code.

Relevant files:

- `Dockerfile.alpine.base` defines the `next-deps` and `runtime-base` targets.
- `Dockerfile.alpine` builds the final application from versioned public-endpoint ACR base images.
- `Dockerfile.aliyun` is the ACR-specific variant using the Wulanchabu `-vpc` endpoints. Keep its application stages in sync with `Dockerfile.alpine`.
- `docker-compose.yaml` overrides those remote defaults with the local aliases `localhost/vane-next-deps:local` and `localhost/vane-runtime-base:local`.
- `scripts/build-alpine-images.sh` is for intentional base-image rebuilds, not routine code changes.

## Frozen ACR base images

Registry namespace:

`crpi-nhogexmk1j5bm5vt.cn-wulanchabu.personal.cr.aliyuncs.com/wrcloudcc`

Next.js dependency image:

- Tag: `vane-next-deps:node24-lock-d03c1d1ad5c`
- Digest: `sha256:8cd83e260cca042bb50cf518bac4b1e7962d6093af3e3eb17e1bbd526c681ce6`

Runtime image:

- Tag: `vane-runtime-base:node24-searxng-277d8469cdd4`
- Digest: `sha256:6c861b06f38e3698eee302403adea3de45148ee8b931026faf3ba26a1453efe4`
- SearXNG commit: `277d8469cdd4af423a42783ad426e0de09f4e2e9`
- Verified contents: Node 24.5.0, Chromium 142.0.7444.59, Python 3.12.13, SearXNG 2026.7.18+277d846.

The local copies of both base images were intentionally deleted after upload to save about 10 GB. Their remote ACR copies remain authoritative.

## Routine code-only builds

Do not rebuild either base image for TypeScript, CSS, prompt, Social search, `searxng/settings.yml`, limiter, or entrypoint changes.

ACR rejected the Podman-recorded `@sha256` values as `not found`, even though authentication succeeded. Final Dockerfiles therefore use versioned tags that must never be overwritten.

For an ACR build, try `Dockerfile.aliyun`, which uses the user-provided Wulanchabu `-vpc` endpoints. If the Personal Edition builder cannot reach VPC endpoints, switch the build rule to `Dockerfile.alpine`; it uses the same tags through the public endpoint.

For a local Compose rebuild, first restore the local aliases if they are absent:

```sh
podman pull crpi-nhogexmk1j5bm5vt.cn-wulanchabu.personal.cr.aliyuncs.com/wrcloudcc/vane-next-deps:node24-lock-d03c1d1ad5c
podman tag crpi-nhogexmk1j5bm5vt.cn-wulanchabu.personal.cr.aliyuncs.com/wrcloudcc/vane-next-deps:node24-lock-d03c1d1ad5c localhost/vane-next-deps:local
podman pull crpi-nhogexmk1j5bm5vt.cn-wulanchabu.personal.cr.aliyuncs.com/wrcloudcc/vane-runtime-base:node24-searxng-277d8469cdd4
podman tag crpi-nhogexmk1j5bm5vt.cn-wulanchabu.personal.cr.aliyuncs.com/wrcloudcc/vane-runtime-base:node24-searxng-277d8469cdd4 localhost/vane-runtime-base:local
podman-compose build vane
podman-compose up -d vane
```

Do not put registry passwords or access tokens into scripts, Dockerfiles, Git, or chat output. Use the existing Podman login state or ask the user to authenticate interactively.

## Intentional base-image updates

Before rebuilding a base, explain why it must change and which input invalidated it.

- Dependency base: changes are keyed by the first 12 characters of the input `yarn.lock` SHA-256. Keep Yarn as the authoritative package manager; do not commit `package-lock.json`.
- Runtime base: pin a full SearXNG commit. Build with `--http-proxy=false`; automatic Podman build proxy injection caused Alpine mirror failures in this environment.
- `Dockerfile.alpine.base` defaults to the USTC Alpine HTTPS mirror. USTC worked reliably when the build proxy was disabled. BFSU produced TLS EOF/package download errors during a full Chromium installation; do not switch mirrors without testing from a temporary Alpine container.
- After pushing a new base tag, update the corresponding default `ARG` in both final Dockerfiles, build and test the final image, then commit the version change to `deploy`.
- Never overwrite the documented version tags. Create a new versioned tag and digest.

## Required verification

For material application or container changes:

1. Run `git diff --check` and shell syntax checks for modified shell scripts.
2. Build a separate image such as `localhost/vane:deploy-check`; do not overwrite the running `localhost/vane:latest` before verification.
3. Start a temporary container on a non-production port such as `3010` without mounting `vane-data`.
4. Verify the Vane homepage returns HTTP 200 and the internal SearXNG JSON endpoint responds.
5. For Social/video changes, query the Bilibili engine and confirm it returns results. A verified test returned 20 results.
6. Remove the temporary test container and image after verification.

The expected SearXNG Wikidata engine may receive an external HTTP 403 during startup. This does not invalidate the container if Vane, SearXNG, and the required engines pass their checks.

## Runtime and data safety

- Production container: `vane_vane_1`, image `localhost/vane:latest`, host port 3000.
- The Zotero container `zotero-pdf2zh` is unrelated and must not be stopped, rebuilt, or deleted.
- Persistent Vane data is in the named volume `vane-data`. Never run `podman volume prune`, `podman system prune --volumes`, or remove/recreate this volume during an image rebuild.
- Do not use `podman image prune -a` without first identifying every image to preserve. It treats tagged but container-unused base images as reclaimable.
- For cleanup, remove exact temporary tags and ordinary dangling layers. Inspect `podman ps -a --external` for failed Buildah `Storage` containers before forcing removal, and only remove IDs proven to belong to failed builds.
- Do not stop the working Vane container merely to build an image. Recreate it only after the replacement image has passed verification.

## ACR automatic build settings

The intended final repository is `wrcloudcc/vane`, bound to GitHub `SPRCSY/Vane`:

- Source type: Branch
- Branch: `deploy`
- Context: repository root
- Dockerfile: `Dockerfile.aliyun`; fall back to `Dockerfile.alpine` if the Personal Edition builder cannot reach the VPC endpoint.
- Tag: `latest`
- Automatic build on code change: enabled
- Overseas build: disabled
- “Do not use cache”: disabled

ACR rebuilds only when the bound Git repository changes. Updating a base image alone does not trigger the final image; after an intentional base digest change, push the Dockerfile update to `deploy` or trigger an immediate build in ACR.

## Application-specific behavior

- The UI sources are `web`, `academic`, and `discussions` (Social).
- Social search currently targets Reddit and native Bilibili plus domain-directed Zhihu and Xiaohongshu searches. One platform failure must not fail all Social results.
- Video search uses both YouTube and Bilibili.
- SearXNG has no Playwright mode. Vane uses the system Chromium through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser` for post-discovery page scraping.
