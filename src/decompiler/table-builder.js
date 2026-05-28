const { luaKey } = require('./lua-formatters');

class TableBuilder {
  constructor() {
    this.hashParts = [];
    this.arrayParts = [];
  }

  addHashEntry(key, value) {
    this.hashParts.push({ key, value });
  }

  addArrayItems(startIndex, items) {
    for (let index = 0; index < items.length; index += 1) {
      this.arrayParts[startIndex - 1 + index] = items[index];
    }
  }

  build() {
    const arrayItems = this.arrayParts.filter((item) => item !== undefined);
    const hashItems = this.hashParts.map((entry) => `${luaKey(entry.key)} = ${entry.value}`);

    if (arrayItems.length === 0 && hashItems.length === 0) {
      return '{}';
    }

    if (arrayItems.length === 0 && this.#shouldUsePrettyObjectLayout()) {
      return this.#buildPrettyObjectTable(hashItems);
    }

    if (arrayItems.length > 0) {
      return this.#buildArrayTable(arrayItems, hashItems);
    }

    if (this.#shouldUseMultilineHashLayout()) {
      return this.#buildMultilineHashTable(hashItems);
    }

    return this.#buildHashOnlyTable(hashItems);
  }

  #buildArrayTable(arrayItems, hashItems) {
    const parts = [];

    for (const item of arrayItems) {
      parts.push(this.#indentMultilineItem(this.#compactSimpleArrayTable(item)));
    }

    for (const item of hashItems) {
      parts.push(this.#indentMultilineItem(item));
    }

    return `{\n${parts.join('\n')}\n}`;
  }

  #buildHashOnlyTable(hashItems) {
    return `{ ${hashItems.join(', ')} }`;
  }

  #buildMultilineHashTable(hashItems) {
    return `{\n${hashItems.map((item) => `  ${this.#indentNestedHashValue(item)},`).join('\n')}\n}`;
  }

  #indentMultilineItem(item) {
    const lines = String(item).split('\n');
    if (lines.length === 1) {
      return `  ${item},`;
    }

    const [first, ...rest] = lines;
    const indented = [`  ${first}`];
    for (const line of rest) {
      indented.push(`  ${line}`);
    }

    indented[indented.length - 1] = `${indented[indented.length - 1]},`;
    return indented.join('\n');
  }

  #shouldUsePrettyObjectLayout() {
    const keySignature = this.hashParts.map((entry) => String(entry.key)).join(',');
    return keySignature === 'name,bundle,realm' || keySignature === 'name,auto,prio,next,text,prereq';
  }

  #shouldUseMultilineHashLayout() {
    if (this.hashParts.some((entry) => this.#isMultilineValue(entry.value))) {
      return true;
    }

    if (this.hashParts.length >= 4 && this.#isNestedTableMap()) {
      return true;
    }

    return this.hashParts.length >= 2 && this.#isFlagConfigTable();
  }

  #buildPrettyObjectTable(hashItems) {
    return `{\n${hashItems.map((item) => `  ${item},`).join('\n')}\n}`;
  }

  #compactSimpleArrayTable(item) {
    const text = String(item);
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return text;
    }

    const lines = trimmed.split('\n');
    if (lines.length < 3) {
      return text;
    }

    const middle = lines.slice(1, -1).map((line) => line.trim().replace(/,$/, ''));
    if (middle.length === 0 || middle.length > 4) {
      return text;
    }

    if (middle.some((line) => line.includes('=') || line.includes('{') || line.includes('}'))) {
      return text;
    }

    return `{ ${middle.join(', ')} }`;
  }

  #indentNestedHashValue(item) {
    const text = String(item);
    if (!this.#isMultilineValue(text)) {
      return text;
    }

    const [first, ...rest] = text.split('\n');
    const lines = [first];
    for (const line of rest) {
      lines.push(`  ${line}`);
    }
    return lines.join('\n');
  }

  #isMultilineValue(value) {
    return String(value).includes('\n');
  }

  #isNestedTableMap() {
    return this.hashParts.every((entry) => this.#isTableLiteral(entry.value));
  }

  #isFlagConfigTable() {
    return this.hashParts.every((entry) => /^k[A-Z0-9_]/.test(String(entry.key)));
  }

  #isTableLiteral(value) {
    const text = String(value).trim();
    return text.startsWith('{') && text.endsWith('}');
  }
}

module.exports = {
  TableBuilder,
};
