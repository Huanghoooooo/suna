#!/bin/sh
set -eu

# Install stable channel CLI wrappers into /usr/local/bin.
# They always point to immutable runtime code under /ephemeral.

install_wrapper() {
  name="$1"
  target="$2"
  cat >"/usr/local/bin/$name" <<EOF
#!/bin/sh
exec bun run $target "\$@"
EOF
  chmod +x "/usr/local/bin/$name"
}

install_wrapper ktelegram /ephemeral/kortix-master/channels/telegram.ts
install_wrapper kslack /ephemeral/kortix-master/channels/slack.ts
install_wrapper kchannel /ephemeral/kortix-master/channels/kchannel.ts

echo "[channel-clis] Installed: ktelegram, kslack, kchannel"
