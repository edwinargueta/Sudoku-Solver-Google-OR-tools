#!/bin/sh
# Prints an overlay, rendered. Given a commit, prod's images are pinned to it
# first: the overlay's placeholder tag is swapped for the commit in a scratch
# copy of deploy/k8s, so the tree itself never changes.
#
#   deploy/k8s/render.sh dev
#   deploy/k8s/render.sh prod <full sha of a commit CI built>
set -eu

env=${1:?usage: render.sh <overlay> [<commit sha>]}
tag=${2:-}
k8s=$(cd "$(dirname "$0")" && pwd)
placeholder=set-by-make-deploy

if [ -z "$tag" ]; then
    exec kubectl kustomize "$k8s/overlays/$env"
fi

if [ "$env" != prod ]; then
    echo "render.sh: only prod is pinned to a commit; $env runs what make images builds" >&2
    exit 1
fi
# CI and `make publish` tag the full sha. Anything shorter names an image
# that does not exist, which would only show once the pods try to pull it.
if ! printf '%s\n' "$tag" | grep -Eqx '[0-9a-f]{40}'; then
    echo "render.sh: '$tag' is not a full commit sha, as git rev-parse HEAD prints" >&2
    exit 1
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cp -R "$k8s/." "$scratch/"
sed "s/newTag: $placeholder\$/newTag: $tag/" "$k8s/overlays/prod/kustomization.yaml" \
    > "$scratch/overlays/prod/kustomization.yaml"

rendered=$(kubectl kustomize "$scratch/overlays/prod")

# Every image has to have taken the commit. One that has not means the
# overlay's images block no longer looks the way the sed above expects.
if printf '%s\n' "$rendered" | grep -E '^[ -]*image: ' | grep -v ":$tag\$" >&2; then
    echo "render.sh: the images above are not pinned to $tag" >&2
    exit 1
fi
printf '%s\n' "$rendered"
