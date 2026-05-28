# that-luac-decompiler

这是一个面向《光遇》中国版客户端特化字节码格式的 `luac` 反编译器项目。

它不是通用 Lua 反编译器，而是专门针对国服客户端使用的改造版 Lua chunk、函数体布局、opcode 映射以及脚本输出风格做适配，用于把客户端里的 `.luac` 脚本尽可能还原成可读、可分析、尽量接近原始工程风格的 Lua 源码。

除了反编译，这个项目现在也支持把 `.lua` 回编译成客户端可读的自定义 `.luac`：

- 编译阶段先借助官方 Lua 5.2 `luac` 生成标准 5.2 bytecode
- 然后再转换为《光遇》中国版客户端所使用的自定义 chunk 格式
- 所以 `compile` 的最终输出不是标准 Lua chunk，而是面向客户端的特化格式

## 前置准备

编译功能依赖官方 Lua 5.2 编译器，请先下载 `luac52.exe`：

- 下载地址：[LuaBinaries 5.2.4 Tools Executables](https://sourceforge.net/projects/luabinaries/files/5.2.4/Tools%20Executables/)
- 下载后请将 `luac52.exe` 放到你方便指定的目录

使用 `compile` 时，通过 `-c` 或 `--compiler` 显式指定这个编译器路径。

## 用法

显示帮助：

```bash
node luac-decompiler.js
node luac-decompiler.js help
```

反编译 `.luac` 到 `.lua`：

```bash
node luac-decompiler.js decompile input.luac
node luac-decompiler.js decompile input.luac output.lua
node luac-decompiler.js decompile -i input.luac -o output.lua
```

编译 `.lua` 到 `.luac`：

```bash
node luac-decompiler.js compile input.lua output.luac -c "C:\\Lua\\luac52.exe"
node luac-decompiler.js compile -i input.lua -o output.luac -c "C:\\Lua\\luac52.exe"
```

## 说明

- 支持命令：`help`、`decompile`、`compile`
- 支持短参数：`-i`、`-o`、`-c`
- 不带参数时默认显示帮助
- `compile` 需要 Lua 5.2 的 `luac52.exe`
- `-c` / `--compiler` 用于指定 `luac52.exe` 路径
- 当输入文件名是 `LevelSelect.lua.luac` 这类形式时，默认输出会自动命名为 `LevelSelect.lua`
