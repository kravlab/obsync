# Images for the project's devcontainers (docs/specs/claude-devcontainer.md).
# Each configuration picks a stage with build.target: `base` for everyday
# development, `claude` for running Claude Code wired to hostrunner.
#
# From the devcontainer template (github.com/kravlad/devcontainer-template),
# which owns this file: `mise run dc-template-update` updates it and merges
# local edits.
# The specs named here are in its docs/specs/.

FROM mcr.microsoft.com/devcontainers/base:trixie AS base

# pipefail: a failed download must fail the build, not feed an empty
# script to sh.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# mise brings the toolchain pinned in mise.toml (postCreateCommand runs the
# setup task, the project's own or the template's default, which installs
# it); its shims put the tools in PATH. mise itself is not pinned: the
# installer picks the newest release at least five days old, the cooldown
# of the template's mise config, which the image does not read
# (docs/specs/devcontainer-unpinned-versions.md). The build cache keeps the
# version of the build that filled it: `mise run dev-rebuild` takes a new one.
# The tools are not in the image either: a container installs them into,
# or takes them from, the store the host's projects share (see the mount
# points below).
RUN curl -fsSL https://mise.run \
      | MISE_MINIMUM_RELEASE_AGE=5d MISE_INSTALL_PATH=/usr/local/bin/mise sh
ENV PATH=/home/vscode/.local/share/mise/shims:$PATH

# Bash history lives in a named volume at ~/.commandhistory. It is under
# the home folder because that is what the devcontainer CLI chowns when it
# changes vscode's UID to the host's (updateRemoteUserUID); a new, empty
# volume then takes the directory's ownership. `history -a` saves every
# command at once: a shell killed by a container stop never writes its
# history on exit.
RUN install -d -o vscode -g vscode /home/vscode/.commandhistory \
 && printf '%s\n' \
      'HISTFILE=~/.commandhistory/.bash_history' \
      'PROMPT_COMMAND="history -a${PROMPT_COMMAND:+; $PROMPT_COMMAND}"' \
      >> /home/vscode/.bashrc

# Where the volumes of docs/specs/devcontainer-shared-store.md are mounted:
# the store of the tools mise installs, which the host's projects share,
# and the package cache. Owned by vscode for the reason above, a new volume
# taking the directory's ownership. The parents too: an engine creates a
# missing parent of a mount point as root, and mise keeps its own
# directory (the shims in PATH) beside the store.
RUN install -d -o vscode -g vscode \
      /home/vscode/.local /home/vscode/.local/share \
      /home/vscode/.local/share/mise-store /home/vscode/.cache

# The host's user.name and user.email, written by
# .devcontainer/git-identity.sh and mounted at /run/host-config.
# git skips a missing include, so the image works without the mount; the
# system level leaves ~/.gitconfig, which overrides it, to the container.
RUN git config --system include.path /run/host-config/gitconfig

# The host's global git excludes, copied by .devcontainer/git-excludes.sh
# to /run/host-config/gitignore (docs/specs/devcontainer-git-excludes.md).
# ~/.config/git/ignore is git's and ripgrep's default excludes path, so
# neither needs core.excludesFile; ripgrep, which Claude Code searches
# with, reads neither the system config nor includes. Created as vscode,
# so other tools can still write to ~/.config. Without the mount the link
# dangles, which both treat as no excludes.
USER vscode
RUN mkdir -p /home/vscode/.config/git \
 && ln -s /run/host-config/gitignore /home/vscode/.config/git/ignore
USER root

FROM base AS claude

# Claude's config lives in a named volume at ~/.claude; created here so the
# volume is owned by vscode. CLAUDE_CONFIG_DIR keeps .claude.json in it too,
# and the host's tool store, not the auto-updater, decides the version.
ENV CLAUDE_CONFIG_DIR=/home/vscode/.claude \
    DISABLE_AUTOUPDATER=1

# Claude Code is not in the image: vscode's global mise config names it,
# and mise takes the newest version in the host's tool store, mounted
# read-only (docs/specs/devcontainer-shared-store.md); its shim puts
# `claude` in PATH. `mise run agent-update` puts a newer release in the
# store, for every project and with no build. Where the store has none,
# postCreateCommand installs one in the container.
USER vscode
RUN install -d /home/vscode/.claude /home/vscode/.config/mise \
 && printf '%s\n' '[tools]' 'claude = "latest"' \
      > /home/vscode/.config/mise/config.toml
USER root

# The host user's global skills, and the hooks and enabled plugins of the
# host's settings, copied by .devcontainer/claude/skills.sh and settings.sh
# to /run/host-config/claude
# (docs/specs/devcontainer-claude-skills-hooks.md). /etc/claude-code is
# Claude Code's system directory: it loads the skills in .claude/skills
# there, and applies a managed-settings.d file alongside the container's
# own settings, running its hooks and enabling its plugins. Not in the
# ~/.claude volume, which Claude Code writes itself (its settings, the
# account's synced skills), and not writable by the agent. Without the
# mount the links dangle: no skills, no hooks, no plugin enabled.
RUN install -d /etc/claude-code/.claude /etc/claude-code/managed-settings.d \
 && ln -s /run/host-config/claude/skills /etc/claude-code/.claude/skills \
 && ln -s /run/host-config/claude/host-settings.json /etc/claude-code/managed-settings.d/host-settings.json

# The host user's plugins, copied by .devcontainer/claude/plugins.sh to
# /run/host-config/claude/plugins
# (docs/specs/devcontainer-claude-plugins.md): a seed directory, from which
# Claude Code loads the plugins in place and to which it never writes. In
# ENV, so any `claude` process has it. The seed only holds the plugins:
# the managed settings file above enables the ones the host enables.
# Without the mount the directory is missing, which is no seed.
ENV CLAUDE_CODE_PLUGIN_SEED_DIR=/run/host-config/claude/plugins
