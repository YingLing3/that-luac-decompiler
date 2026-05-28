# that-luac-decompiler

This project is a specialized `luac` decompiler for the custom bytecode format used by the Chinese client of Sky: Children of the Light.

It is not a general-purpose Lua decompiler. It is tailored to the client-specific Lua chunk layout, function body structure, opcode remapping, and output style, with the goal of restoring `.luac` scripts into readable and analyzable Lua source that is as close as possible to the original project style.

In addition to decompilation, this project can also compile `.lua` back into the client-compatible custom `.luac` format:

- It first uses the official Lua 5.2 `luac` compiler to generate standard Lua 5.2 bytecode
- It then converts that standard chunk into the custom chunk format used by the Chinese client
- So the final `compile` output is not a standard Lua chunk, but a client-specific format

## Prerequisites

Compilation requires the official Lua 5.2 compiler. Download `luac52.exe` first:

- Download: [LuaBinaries 5.2.4 Tools Executables](https://sourceforge.net/projects/luabinaries/files/5.2.4/Tools%20Executables/)
- Place `luac52.exe` somewhere convenient on your machine

When using `compile`, pass its path explicitly with `-c` or `--compiler`.

## Usage

Show help:

```bash
node luac-decompiler.js
node luac-decompiler.js help
```

Decompile `.luac` into `.lua`:

```bash
node luac-decompiler.js decompile input.luac
node luac-decompiler.js decompile input.luac output.lua
node luac-decompiler.js decompile -i input.luac -o output.lua
```

Compile `.lua` into `.luac`:

```bash
node luac-decompiler.js compile input.lua output.luac -c "C:\\Lua\\luac52.exe"
node luac-decompiler.js compile -i input.lua -o output.luac -c "C:\\Lua\\luac52.exe"
```

## Notes

- Supported commands: `help`, `decompile`, `compile`
- Supported short options: `-i`, `-o`, `-c`
- Running without arguments shows help by default
- `compile` requires Lua 5.2 `luac52.exe`
- `-c` / `--compiler` specifies the path to `luac52.exe`
- If the input filename looks like `LevelSelect.lua.luac`, the default output name becomes `LevelSelect.lua`
