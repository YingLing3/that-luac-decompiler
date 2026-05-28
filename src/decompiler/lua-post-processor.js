class LuaPostProcessor {
  process(lines) {
    let current = Array.isArray(lines) ? [...lines] : String(lines).split(/\r?\n/);

    current = this.#collapseTrivialReturnFunctions(current);
    current = this.#mergeNestedAndConditions(current);
    current = this.#simplifyWrappedNotConditions(current);
    current = this.#alignSpecialCallBlocks(current);
    current = this.#normalizeReferenceConstructors(current);
    current = this.#normalizeFunctionDeclarationSpacing(current);
    current = this.#normalizeCommonCallSpacing(current);
    current = this.#normalizeCallExpressionSpacing(current);
    current = this.#normalizeNilComparisons(current);
    current = this.#formatVarsStyleRootTable(current);
    current = this.#formatVarsClassicLayout(current);
    current = this.#insertTopLevelBlockSpacing(current);
    current = this.#compactVarsRootSpacing(current);

    return current;
  }

  #collapseTrivialReturnFunctions(lines) {
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const next = lines[index + 1];
      const third = lines[index + 2];

      if (!line || !next || !third) {
        output.push(line);
        continue;
      }

      const indent = this.#leadingSpaces(line);
      const trimmed = line.trim();
      const nextTrimmed = next.trim();
      const thirdTrimmed = third.trim();

      if (
        trimmed.startsWith('function ')
        && trimmed.endsWith(')')
        && this.#leadingSpaces(next) === indent + 2
        && nextTrimmed.startsWith('return ')
        && this.#leadingSpaces(third) === indent
        && thirdTrimmed === 'end'
      ) {
        output.push(`${line} ${nextTrimmed} end`);
        index += 2;
        continue;
      }

      output.push(line);
    }

    return output;
  }

  #mergeNestedAndConditions(lines) {
    let current = [...lines];
    let changed = true;

    while (changed) {
      changed = false;
      const output = [];

      for (let index = 0; index < current.length; index += 1) {
        const merged = this.#tryMergeNestedIf(current, index);
        if (!merged) {
          output.push(current[index]);
          continue;
        }

        output.push(...merged.lines);
        index = merged.nextIndex;
        changed = true;
      }

      current = output;
    }

    return current;
  }

  #tryMergeNestedIf(lines, startIndex) {
    const firstLine = lines[startIndex];
    const secondLine = lines[startIndex + 1];

    if (!firstLine || !secondLine) {
      return null;
    }

    const firstMatch = firstLine.match(/^(\s*)if (.+) then$/);
    const secondMatch = secondLine.match(/^(\s*)if (.+) then$/);

    if (!firstMatch || !secondMatch) {
      return null;
    }

    const outerIndent = firstMatch[1];
    const innerIndent = secondMatch[1];

    if (innerIndent.length !== outerIndent.length + 2) {
      return null;
    }

    const innerEndIndex = this.#findBlockEnd(lines, startIndex + 1, innerIndent);
    if (innerEndIndex < 0 || innerEndIndex + 1 >= lines.length) {
      return null;
    }

    const outerEndLine = lines[innerEndIndex + 1];
    if (outerEndLine !== `${outerIndent}end`) {
      return null;
    }

    const bodyLines = lines.slice(startIndex + 2, innerEndIndex);
    if (!this.#canInlineNestedIfBody(bodyLines, innerIndent.length + 2)) {
      return null;
    }

    return {
      lines: [
        `${outerIndent}if ${firstMatch[2]} and ${secondMatch[2]} then`,
        ...this.#dedentLines(bodyLines, 2),
        `${outerIndent}end`,
      ],
      nextIndex: innerEndIndex + 1,
    };
  }

  #findBlockEnd(lines, startIndex, indent) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (lines[index] === `${indent}end`) {
        return index;
      }
    }

    return -1;
  }

  #canInlineNestedIfBody(lines, minimumIndent) {
    if (lines.length === 0) {
      return false;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed === 'else' || trimmed.startsWith('elseif ')) {
        return false;
      }

      if (this.#leadingSpaces(line) < minimumIndent) {
        return false;
      }
    }

    return true;
  }

  #simplifyWrappedNotConditions(lines) {
    return lines.map((line) => line.replace(/^(\s*if not) \((.+)\) then$/, '$1 $2 then'));
  }

  #alignSpecialCallBlocks(lines) {
    const output = [...lines];
    let index = 0;

    while (index < output.length) {
      const block = this.#readSpecialCallBlock(output, index);
      if (!block) {
        index += 1;
        continue;
      }

      const formatted = this.#formatSpecialCallBlock(block.kind, block.lines);
      for (let offset = 0; offset < formatted.length; offset += 1) {
        output[block.start + offset] = formatted[offset];
      }

      index = block.end + 1;
    }

    return output;
  }

  #readSpecialCallBlock(lines, startIndex) {
    const startLine = lines[startIndex];
    if (!startLine || !startLine.trim().endsWith('{')) {
      return null;
    }

    let kind = null;
    const blockLines = [];
    let index = startIndex + 1;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (trimmed === '}') {
        break;
      }

      if (!trimmed) {
        return null;
      }

      if (!kind) {
        if (trimmed.startsWith('level(')) {
          kind = 'level';
        } else if (trimmed.startsWith('bundle(')) {
          kind = 'bundle';
        } else {
          return null;
        }
      }

      if (!trimmed.startsWith(`${kind}(`) || !trimmed.endsWith('),')) {
        return null;
      }

      blockLines.push(line);
      index += 1;
    }

    if (!kind || blockLines.length === 0 || index >= lines.length || lines[index].trim() !== '}') {
      return null;
    }

    return {
      kind,
      start: startIndex + 1,
      end: index - 1,
      lines: blockLines,
    };
  }

  #formatSpecialCallBlock(kind, lines) {
    const parsed = lines.map((line) => this.#parseSpecialCallLine(kind, line));
    if (parsed.some((item) => !item)) {
      return lines;
    }

    const columnCount = Math.max(...parsed.map((item) => item.args.length));
    const widths = new Array(columnCount).fill(0);

    for (const item of parsed) {
      for (let index = 0; index < item.args.length; index += 1) {
        widths[index] = Math.max(widths[index], item.args[index].length);
      }
    }

    return parsed.map((item) => {
      const paddedArgs = item.args.map((arg, index) => {
        const isLast = index === item.args.length - 1;
        if (isLast) {
          return arg;
        }

        return arg.padEnd(widths[index], ' ');
      });

      return `${item.indent}${kind}( ${paddedArgs.join(', ')} ),`;
    });
  }

  #parseSpecialCallLine(kind, line) {
    const match = line.match(/^(\s*)[A-Za-z_][A-Za-z0-9_]*\((.*)\),$/);
    if (!match) {
      return null;
    }

    const args = this.#splitTopLevelArgs(match[2].trim());
    if (args.length === 0) {
      return null;
    }

    return {
      indent: match[1],
      args,
      kind,
    };
  }

  #splitTopLevelArgs(text) {
    const args = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        current += char;
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        current += char;
        continue;
      }

      if (char === '{' || char === '(' || char === '[') {
        depth += 1;
        current += char;
        continue;
      }

      if (char === '}' || char === ')' || char === ']') {
        depth = Math.max(0, depth - 1);
        current += char;
        continue;
      }

      if (char === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  #dedentLines(lines, spaces) {
    return lines.map((line) => {
      if (!line.trim()) {
        return line;
      }

      const removable = Math.min(this.#leadingSpaces(line), spaces);
      return line.slice(removable);
    });
  }

  #normalizeReferenceConstructors(lines) {
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
      const levelReplacement = this.#tryNormalizeLevelConstructor(lines, index);
      if (levelReplacement) {
        output.push(...levelReplacement.lines);
        index = levelReplacement.nextIndex;
        continue;
      }

      const bundleReplacement = this.#tryNormalizeBundleConstructor(lines, index);
      if (bundleReplacement) {
        output.push(...bundleReplacement.lines);
        index = bundleReplacement.nextIndex;
        continue;
      }

      output.push(lines[index]);
    }

    return output;
  }

  #normalizeFunctionDeclarationSpacing(lines) {
    return lines.map((line) => {
      const match = line.match(/^(\s*function\s+[A-Za-z_][A-Za-z0-9_:.]*)\((.*)\)(.*)$/);
      if (!match) {
        return line;
      }

      const [, prefix, paramsText, suffix] = match;
      const params = paramsText.trim();
      if (!params) {
        return `${prefix}()${suffix}`;
      }

      return `${prefix}( ${params} )${suffix}`;
    });
  }

  #normalizeCommonCallSpacing(lines) {
    return lines.map((line) => line
      .replace(/\b(ipairs|pairs|table\.concat|table\.insert|print|error)\(([^()]+)\)/g, (_, name, args) => `${name}( ${args.trim()} )`)
      .replace(/([A-Za-z_][A-Za-z0-9_:.]*)\(([^()"]*)\)/g, (match, name, args) => {
        if (!args.includes(',') && !args.trim()) {
          return `${name}()`;
        }

        if (args.includes('"') || args.includes("'")) {
          return match;
        }

        return `${name}( ${args.trim()} )`;
      })
      .replace(/\)\s+then\b/g, ') then'));
  }

  #normalizeCallExpressionSpacing(lines) {
    return lines.map((line) => this.#normalizeLineCallExpressions(line));
  }

  #normalizeLineCallExpressions(line) {
    const patterns = [
      /^(\s*)([A-Za-z_][A-Za-z0-9_:.]*)\((.*)\)$/,
      /^(\s*return\s+)([A-Za-z_][A-Za-z0-9_:.]*)\((.*)\)$/,
      /^(\s*if\s+not\s+)([A-Za-z_][A-Za-z0-9_:.]*)\((.*)\)(\s+then)$/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      if (pattern === patterns[2]) {
        const [, prefix, name, argsText, suffix] = match;
        const normalized = this.#normalizeCallText(name, argsText);
        return `${prefix}${normalized}${suffix}`;
      }

      const [, prefix, name, argsText] = match;
      const normalized = this.#normalizeCallText(name, argsText);
      return `${prefix}${normalized}`;
    }

    return line;
  }

  #normalizeCallText(name, argsText) {
    const args = this.#splitTopLevelArgs(argsText);
    if (args.length === 0) {
      return `${name}()`;
    }

    const normalizedArgs = args.map((arg) => this.#normalizeCallArgument(arg));
    return `${name}( ${normalizedArgs.join(', ')} )`;
  }

  #normalizeCallArgument(arg) {
    const trimmed = String(arg).trim();
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_:.]*)\((.*)\)$/);
    if (!match) {
      return trimmed;
    }

    return this.#normalizeCallText(match[1], match[2]);
  }

  #normalizeNilComparisons(lines) {
    return lines.map((line) => line
      .replace(/\s+~= nil\b/g, ' ~= nil')
      .replace(/\s+== nil\b/g, ' == nil')
      .replace(/^(\s*if )(.+?) == nil then$/, '$1$2 == nil then')
      .replace(/^(\s*elseif )(.+?) == nil then$/, '$1$2 == nil then')
      .replace(/^(\s*if )(.+?) ~= nil then$/, '$1$2 ~= nil then')
      .replace(/^(\s*elseif )(.+?) ~= nil then$/, '$1$2 ~= nil then'));
  }

  #formatVarsStyleRootTable(lines) {
    if (!Array.isArray(lines) || lines.length < 3) {
      return lines;
    }

    if (!lines[0].startsWith('Vars = {') || lines[lines.length - 1] !== '}') {
      return lines;
    }

    const body = [];
    for (let index = 1; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (!line.trim()) {
        continue;
      }

      if (line.startsWith('  ')) {
        body.push(line.slice(2));
      } else {
        body.push(line);
      }
    }

    if (body.length === 0) {
      return ['Vars =', '{}'];
    }

    const output = ['Vars =', `{${body[0]}`];
    for (let index = 1; index < body.length; index += 1) {
      output.push(body[index]);
    }
    output.push('}');
    return output;
  }

  #formatVarsClassicLayout(lines) {
    if (!Array.isArray(lines) || lines.length < 3 || lines[0] !== 'Vars =' || !lines[1].startsWith('{')) {
      return lines;
    }

    const entries = this.#parseVarsTopLevelEntries(lines.slice(1, -1));
    if (entries.length === 0) {
      return lines;
    }

    const formatted = ['Vars = '];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = this.#formatParsedVarsEntry(entries[index], index === 0);
      formatted.push(...entry);
    }
    formatted.push('}');
    return formatted;
  }

  #parseVarsTopLevelEntries(lines) {
    const entries = [];
    let index = 0;

    while (index < lines.length) {
      const line = String(lines[index] || '').trim();
      if (!line) {
        index += 1;
        continue;
      }

      const match = line.match(/^\{?([A-Za-z_][A-Za-z0-9_]*) = (.+)$/);
      if (!match) {
        index += 1;
        continue;
      }

      const [, key, valueText] = match;
      const value = valueText.trim().replace(/,$/, '');
      if (!value.startsWith('{')) {
        entries.push({ key, inline: true, parts: [value] });
        index += 1;
        continue;
      }

      if (value !== '{') {
        const inlineMatch = value.match(/^\{(.*)\}$/);
        if (inlineMatch) {
          const inner = inlineMatch[1].trim();
          const parts = inner ? this.#splitTopLevelArgs(inner) : [];
          entries.push({ key, inline: false, parts });
          index += 1;
          continue;
        }
      }

      const parts = [];
      index += 1;
      while (index < lines.length) {
        const innerLine = String(lines[index] || '').trim();
        if (innerLine === '}' || innerLine === '},') {
          break;
        }
        parts.push(innerLine.replace(/,$/, ''));
        index += 1;
      }

      entries.push({ key, inline: false, parts });
      index += 1;
    }

    return entries;
  }

  #formatParsedVarsEntry(entry, isFirst) {
    const prefix = isFirst ? '{\t' : ',\t';
    const output = [`${prefix}${entry.key} = `];
    const parts = Array.isArray(entry.parts) ? entry.parts.filter(Boolean) : [];

    if (parts.length === 0) {
      output.push('\t{ }');
      return output;
    }

    output.push(`\t{\t${parts[0]}`);
    for (let index = 1; index < parts.length; index += 1) {
      output.push(`\t,\t${parts[index]}`);
    }
    output.push('\t}');
    return output;
  }

  #compactVarsRootSpacing(lines) {
    if (!Array.isArray(lines) || lines.length < 3 || lines[0] !== 'Vars =' || !lines[1].startsWith('{')) {
      return lines;
    }

    const output = [lines[0], lines[1]];
    for (let index = 2; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === '') {
        continue;
      }
      output.push(line);
    }
    return output;
  }

  #tryNormalizeLevelConstructor(lines, startIndex) {
    const block = lines.slice(startIndex, startIndex + 8);
    if (block.length < 8) {
      return null;
    }

    if (
      block[0] !== 'function level(name, bundle, realm)'
      || block[1] !== '  local obj = {'
      || block[2] !== '    name = name,'
      || block[3] !== '    bundle = bundle,'
      || block[4] !== '    realm = realm ~= nil and realm or bundle,'
      || block[5] !== '  }'
      || block[6] !== '  return obj'
      || block[7] !== 'end'
    ) {
      return null;
    }

    return {
      lines: [
        'function level( name, bundle, realm )',
        '  local obj = {',
        '    ["name"] = name,',
        '    ["bundle"] = bundle,',
        '    ["realm"] = realm ~= nil and realm or bundle,',
        '  }',
        '  return obj',
        'end',
      ],
      nextIndex: startIndex + 7,
    };
  }

  #tryNormalizeBundleConstructor(lines, startIndex) {
    const block = lines.slice(startIndex, startIndex + 11);
    if (block.length < 11) {
      return null;
    }

    if (
      block[0] !== 'function bundle(name, autoRequest, defaultPriority, next, text, prerequisites)'
      || block[1] !== '  local obj = {'
      || block[2] !== '    name = name,'
      || block[3] !== '    auto = autoRequest,'
      || block[4] !== '    prio = defaultPriority,'
      || block[5] !== '    next = next,'
      || block[6] !== '    text = text,'
      || block[7] !== '    prereq = prerequisites,'
      || block[8] !== '  }'
      || block[9] !== '  return obj'
      || block[10] !== 'end'
    ) {
      return null;
    }

    return {
      lines: [
        'function bundle( name, autoRequest, defaultPriority, next, text, prerequisites )',
        '  local obj = { ["name"] = name, ["auto"] = autoRequest, ["prio"] = defaultPriority, ["next"] = next, ["text"] = text, ["prereq"] = prerequisites }',
        '  return obj',
        'end',
      ],
      nextIndex: startIndex + 10,
    };
  }

  #insertTopLevelBlockSpacing(lines) {
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();
      const previous = output.length > 0 ? output[output.length - 1] : null;

      if (
        trimmed
        && this.#leadingSpaces(line) === 0
        && output.length > 0
        && previous !== ''
        && !this.#shouldKeepAdjacentTopLevel(previous, trimmed)
        && this.#shouldSeparateTopLevelBlock(trimmed)
      ) {
        output.push('');
      }

      output.push(line);
    }

    return output;
  }

  #shouldKeepAdjacentTopLevel(previousLine, currentTrimmed) {
    const previousTrimmed = String(previousLine).trim();
    if (!previousTrimmed) {
      return false;
    }

    const previousIsOneLineFunction = /^function\s+[A-Za-z_][A-Za-z0-9_:.]*\([^)]*\)\s+return\s+.+\s+end$/.test(previousTrimmed);
    const currentIsOneLineFunction = /^function\s+[A-Za-z_][A-Za-z0-9_:.]*\([^)]*\)\s+return\s+.+\s+end$/.test(currentTrimmed);

    if (previousIsOneLineFunction && currentIsOneLineFunction) {
      return true;
    }

    return false;
  }

  #shouldSeparateTopLevelBlock(trimmed) {
    if (trimmed.startsWith('function ')) {
      return true;
    }

    if (trimmed.startsWith('if ')) {
      return true;
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*{$/.test(trimmed)) {
      return true;
    }

    return /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed);
  }

  #leadingSpaces(line) {
    const match = String(line).match(/^ */);
    return match ? match[0].length : 0;
  }
}

module.exports = {
  LuaPostProcessor,
};
