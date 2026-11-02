#!/bin/sh
# install-typst.sh — install the typst press is built and audited with, for a repository's CI.
#
# Run from anywhere, with the directory to put typst in, which is made if it is not there:
#
#   sh third_party/press/tools/install-typst.sh "$RUNNER_TEMP/bin"
#
# Linux only, x86_64 or aarch64: typst's static builds, which run on any CI runner. Anywhere
# else it refuses and says so; a workstation installs typst from its package manager.
#
# The pin is here, in press's folder, so a repository holds no copy of it: moving to a press
# release moves its typst with it, and nothing falls behind unseen. press's own CI installs
# typst through this same file.
#
# Pinned by version AND by digest: a version alone is a pin against accident, not against
# substitution, and this runs on every pull request of every repository that uses it. A bump
# changes the version and both digests together, and press's CI checks both against the release.
set -eu

TYPST_VERSION=0.15.1
TYPST_SHA256_X86_64=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c
TYPST_SHA256_AARCH64=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee

fail() { echo "install-typst: $*" >&2; exit 1; }
[ $# -eq 1 ] && [ -n "$1" ] || { echo "usage: sh install-typst.sh <directory>" >&2; exit 2; }
dir=$1

[ "$(uname -s)" = Linux ] \
    || fail "installs typst on Linux only, for CI; here, install typst $TYPST_VERSION from the system's packages"
case $(uname -m) in
    x86_64 | amd64) arch=x86_64 sum=$TYPST_SHA256_X86_64 ;;
    aarch64 | arm64) arch=aarch64 sum=$TYPST_SHA256_AARCH64 ;;
    *) fail "has no typst pinned for $(uname -m); install typst $TYPST_VERSION from the system's packages" ;;
esac
mkdir -p "$dir"

name=typst-$arch-unknown-linux-musl
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --fail so an HTML error page is an error rather than an archive that fails to extract with a
# message about xz.
curl --fail --silent --show-error --location \
    "https://github.com/typst/typst/releases/download/v$TYPST_VERSION/$name.tar.xz" \
    --output "$tmp/typst.tar.xz"
# Verified BEFORE extraction. A digest checked after unpacking has already let the archive
# choose its own paths.
echo "$sum  $tmp/typst.tar.xz" | sha256sum -c - >/dev/null \
    || fail "the download is not the typst $TYPST_VERSION press pins: its digest differs"
tar -xJf "$tmp/typst.tar.xz" -C "$tmp" "$name/typst"
cp "$tmp/$name/typst" "$dir/typst"
chmod 0755 "$dir/typst"
"$dir/typst" --version
