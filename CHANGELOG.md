# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Pages load faster: the scripts and the game data are requested at once instead of one after another, and the
  session and the page's data are asked for in parallel.
- The browser keeps game pictures for a week and the game data between visits instead of asking for them every time.
- Going back to a list, or opening the same build again within two minutes, draws without a new request.
- LOADING shows only on a long wait, and a new filter keeps the old cards on screen until the new ones arrive.

## [0.1.0] - 2026-11-22

### Added

- Browse builds by class, weapon and overclock; sort by HOT, NEW or TOP of the week, month or all time.
- Build pages drawn like the game's loadout screen, with weapon stats, the build code and a Markdown description.
- An editor shaped like the game's loadout screen; it opens with your build from the mod's PUBLISH MY BUILD.
- Steam sign-in to publish, edit, like and report builds; your builds on your own page.
- Admin page with the report queue.
- Profanity filter for titles and descriptions.

[unreleased]: https://github.com/byrodi/dwarf-builds-web/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/byrodi/dwarf-builds-web/releases/tag/v0.1.0
