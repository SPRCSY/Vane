#!/bin/sh
set -eu

SEARXNG_REF_DEFAULT=277d8469cdd4af423a42783ad426e0de09f4e2e9
RUNTIME_REVISION_DEFAULT=slim3
REGISTRY_PREFIX=${VANE_BASE_REGISTRY:-localhost}
APP_IMAGE=${VANE_APP_IMAGE:-localhost/vane:latest}
SEARXNG_REF=${SEARXNG_REF:-$SEARXNG_REF_DEFAULT}
RUNTIME_REVISION=${VANE_RUNTIME_REVISION:-$RUNTIME_REVISION_DEFAULT}
PUSH_BASES=0

usage() {
  echo "Usage: $0 [--registry-prefix REGISTRY/NAMESPACE] [--app-image IMAGE] [--push-bases]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --registry-prefix)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      REGISTRY_PREFIX=$2
      shift 2
      ;;
    --app-image)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      APP_IMAGE=$2
      shift 2
      ;;
    --push-bases)
      PUSH_BASES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

REGISTRY_PREFIX=${REGISTRY_PREFIX%/}
LOCK_HASH=$(sha256sum yarn.lock | cut -c 1-12)
SEARXNG_SHORT_REF=$(printf '%s' "$SEARXNG_REF" | cut -c 1-12)

DEPS_IMAGE="${REGISTRY_PREFIX}/vane-next-deps:node24-lock-${LOCK_HASH}"
RUNTIME_IMAGE="${REGISTRY_PREFIX}/vane-runtime-base:node24-searxng-${SEARXNG_SHORT_REF}-${RUNTIME_REVISION}"
LOCAL_DEPS_IMAGE="localhost/vane-next-deps:node24-lock-${LOCK_HASH}"
LOCAL_RUNTIME_IMAGE="localhost/vane-runtime-base:node24-searxng-${SEARXNG_SHORT_REF}-${RUNTIME_REVISION}"

if podman image exists "$DEPS_IMAGE"; then
  echo "Reusing existing Next.js dependency image:"
  echo "  $DEPS_IMAGE"
  podman tag "$DEPS_IMAGE" localhost/vane-next-deps:local
elif [ "$REGISTRY_PREFIX" != localhost ] && podman image exists "$LOCAL_DEPS_IMAGE"; then
  echo "Tagging the existing local Next.js dependency image:"
  echo "  $LOCAL_DEPS_IMAGE"
  echo "as:"
  echo "  $DEPS_IMAGE"
  podman tag "$LOCAL_DEPS_IMAGE" "$DEPS_IMAGE"
  podman tag "$LOCAL_DEPS_IMAGE" localhost/vane-next-deps:local
else
  echo "Building reusable Next.js dependency image:"
  echo "  $DEPS_IMAGE"
  podman build \
    --http-proxy=false \
    --target next-deps \
    --tag "$DEPS_IMAGE" \
    --tag localhost/vane-next-deps:local \
    --file Dockerfile.alpine.base \
    .
fi

if podman image exists "$RUNTIME_IMAGE"; then
  echo "Reusing existing Chromium and SearXNG runtime image:"
  echo "  $RUNTIME_IMAGE"
  podman tag "$RUNTIME_IMAGE" localhost/vane-runtime-base:local
elif [ "$REGISTRY_PREFIX" != localhost ] && podman image exists "$LOCAL_RUNTIME_IMAGE"; then
  echo "Tagging the existing local Chromium and SearXNG runtime image:"
  echo "  $LOCAL_RUNTIME_IMAGE"
  echo "as:"
  echo "  $RUNTIME_IMAGE"
  podman tag "$LOCAL_RUNTIME_IMAGE" "$RUNTIME_IMAGE"
  podman tag "$LOCAL_RUNTIME_IMAGE" localhost/vane-runtime-base:local
else
  echo "Building reusable Chromium and SearXNG runtime image:"
  echo "  $RUNTIME_IMAGE"
  podman build \
    --http-proxy=false \
    --target runtime-base \
    --build-arg "SEARXNG_REF=$SEARXNG_REF" \
    --tag "$RUNTIME_IMAGE" \
    --tag localhost/vane-runtime-base:local \
    --file Dockerfile.alpine.base \
    .
fi

if [ "$PUSH_BASES" -eq 1 ]; then
  if [ "$REGISTRY_PREFIX" = localhost ]; then
    echo "Refusing to push: set --registry-prefix to your registry namespace." >&2
    exit 2
  fi

  echo "Pushing the two reusable base images..."
  podman push "$DEPS_IMAGE"
  podman push "$RUNTIME_IMAGE"
fi

echo "Building application image:"
echo "  $APP_IMAGE"
podman build \
  --build-arg "NEXT_DEPS_IMAGE=$DEPS_IMAGE" \
  --build-arg "RUNTIME_BASE_IMAGE=$RUNTIME_IMAGE" \
  --tag "$APP_IMAGE" \
  --file Dockerfile.alpine \
  .

echo
echo "Build complete. Start or recreate Vane with:"
echo "  podman-compose up -d vane"
echo
echo "Reusable base images:"
echo "  $DEPS_IMAGE"
echo "  $RUNTIME_IMAGE"
