# Estilográfica

*Simply write.*

Estilográfica is the Spanish word for a fountain pen, and that's the idea behind this app: something you pick up, write with, and put down. No accounts, no sync service, no plugins to manage. Just a clean page and your words.

It runs on Linux and Windows, and it comes in two colors: Tokyo Night for late sessions and Tokyo Day for everything else. It follows your system theme until you tell it otherwise.

## Your notes are just files

Every note is a plain Markdown file in `Documents/Estilografica`. You can open them in any other editor, back them up however you like, sync them with Syncthing or git, or grep through them from a terminal. If you ever stop using Estilográfica, your notes don't care.

Deleting a note moves it to a `.trash` folder in that same place, so nothing is ever really gone by accident.

## What it does

- Write in Markdown, or use the toolbar if you'd rather not remember the syntax
- Switch between writing, a side-by-side preview, and a reading view
- Lists keep themselves going when you press Enter, and stop when you press it on an empty line
- Checklists you can tick right in the preview
- Search across every note, not just titles
- Everything saves on its own while you type

## Installing

**Windows:** grab the `setup.exe` from the [Releases](https://github.com/ItsWakil/estilografica/releases) page. Windows will probably warn you that it doesn't recognize the app, since it isn't code-signed. Click **More info**, then **Run anyway**.

**Linux:** the Releases page has `.rpm` and `.deb` packages. Or build it yourself (below).

## Building it yourself

You'll need Node.js and Rust. On Fedora, you'll also need a few system libraries:

    sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
      libappindicator-gtk3-devel librsvg2-devel libxdo-devel
    sudo dnf group install c-development

Then, from the project folder:

    npm install
    npm run dev             # try it out
    npm run install-local   # build and install it on Fedora

`install-local` works for updates too. Run it again after changing something and the installed app gets replaced. Your notes are never touched.

If you only want to fiddle with the look, `npx serve src` runs the interface in a normal browser, no Rust required. Nothing gets saved in that mode, so it's safe to poke at.

### Making a release

Windows installers have to be built on Windows, so a GitHub Action takes care of that. Bump the version in `src-tauri/tauri.conf.json`, then either push a tag like `v0.2.0` or hit **Run workflow** under the Actions tab. A few minutes later, a draft release shows up with installers for both systems.

## Keyboard shortcuts

| Keys | What it does |
|---|---|
| Ctrl+N | New note |
| Ctrl+F | Search |
| Ctrl+/ | Cycle between write, split, and read |
| Ctrl+Shift+L | Switch between Tokyo Night and Tokyo Day |
| Ctrl+B / Ctrl+I | Bold / italic |
| Ctrl+K | Link |
| Ctrl+E | Inline code (Ctrl+Shift+E for a code block) |
| Ctrl+Shift+X | Strikethrough |
| Ctrl+Shift+Q | Quote |
| Ctrl+1 / 2 / 3 | Heading sizes |
| Ctrl+Shift+7 / 8 / 9 | Numbered list / bullet list / checklist |
| Tab / Shift+Tab | Indent or outdent a list item |

## Thanks

Made by [Wakil](https://github.com/ItsWakil).

The colors come from folke's wonderful [Tokyo Night](https://github.com/folke/tokyonight.nvim). Markdown is rendered by [marked](https://github.com/markedjs/marked), and the whole thing is held together by [Tauri](https://tauri.app).
